/**
 * Privacy-compliance CLI: scan every source file under the configured roots for
 * egress/secret/telemetry findings, run the structural privacy-mechanism checks,
 * map results onto the control register, and emit a single compliance score plus
 * the key numbers an auditor (or the CI report) tracks over time.
 *
 *   node scripts/compliance/index.mjs [baseDir] [--json <path>] [--no-fail]
 *
 * Defaults: baseDir='' (scan ./src + ./api), json=.compliance/compliance.json.
 * `baseDir` prefixes the scanned roots (e.g. `pr-head` to scan a PR checkout from
 * the trusted base) — files are only read/parsed, never executed, and reported
 * paths stay repo-relative. Exit code is 1 when any `violation` is present (the
 * air-gap guarantee is enforced), 0 otherwise — pass `--no-fail` to always exit 0
 * (informational run). Mirrors scripts/health's structure.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.mjs';
import { analyzeSource, band } from './analyze.mjs';
import { controls, standardsCovered, subProcessors } from './controls.mjs';

/** Severity ordering for a stable, total-order sort of findings. */
const SEVERITY_RANK = { violation: 0, high: 1, medium: 2, low: 3 };

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const baseDir =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2].replace(/[/\\]+$/, '')
    : '';
const jsonOut = arg('--json', '.compliance/compliance.json');
const noFail = process.argv.includes('--no-fail');

/** All scannable files under the configured roots. Returns `{ rel, abs }` where
 *  `rel` is the repo-relative POSIX path (used for scope + reporting) and `abs`
 *  is where to read it from (under `baseDir` when scanning a PR checkout). */
function listFiles() {
  const out = [];
  for (const root of config.roots) {
    const scanRoot = baseDir ? path.join(baseDir, root) : root;
    if (!fs.existsSync(scanRoot)) continue;
    for (const entry of fs.readdirSync(scanRoot, { recursive: true })) {
      const sub = String(entry).split(path.sep).join('/');
      const rel = `${root}/${sub}`;
      const abs = path.join(scanRoot, sub);
      if (config.include.test(rel) && !config.exclude.test(rel) && fs.statSync(abs).isFile()) {
        out.push({ rel, abs });
      }
    }
  }
  return out;
}

// ── 1. Per-file static findings ────────────────────────────────────────────
const files = listFiles();
const fileResults = files.map(({ rel, abs }) =>
  analyzeSource(rel, fs.readFileSync(abs, 'utf8'), config),
);
const findings = fileResults.flatMap((r) =>
  r.findings.map((f) => ({ file: r.file, ...f })),
);

// ── 2. Structural privacy-mechanism checks ─────────────────────────────────
const structural = config.structuralChecks.map((c) => {
  let present = false;
  try {
    // Read from the scanned tree (baseDir) so a PR audit reflects the PR head,
    // not the base branch — the finding still reports the clean repo-relative path.
    const at = baseDir ? path.join(baseDir, c.file) : c.file;
    present = fs.readFileSync(at, 'utf8').includes(c.mustContain);
  } catch {
    present = false;
  }
  if (!present) {
    findings.push({
      file: c.file,
      line: 0,
      rule: c.id,
      severity: 'high',
      message: `Privacy mechanism "${c.id}" missing: ${c.desc} (expected "${c.mustContain}" in ${c.file}).`,
      value: c.id,
    });
  }
  return { id: c.id, present, desc: c.desc };
});

// ── 2b. Register-completeness checks the line-scanner can't do ──────────────
// The URL scanner only sees https:// literals, so SDK/env egress (Resend,
// Supabase) and the vercel.json reverse-proxies are invisible to it. These two
// checks close that blind spot (doc 16 findings F4/F8): the Art. 30 allowlist
// must cover every app-level sub-processor, and every reverse-proxy destination.
const allowlistServices = config.egressAllowlist.map((e) => e.service);
for (const sp of subProcessors) {
  if (sp.appLevelEgress === false) continue; // platform host (e.g. Vercel)
  const covered = allowlistServices.some((s) => s.includes(sp.vendor));
  if (!covered) {
    findings.push({
      file: 'scripts/compliance/config.mjs',
      line: 0,
      rule: 'subprocessor-not-allowlisted',
      severity: 'medium',
      message: `Sub-processor "${sp.vendor}" (controls.mjs GOV-01) has no matching egress-allowlist entry — the Art. 30 register is incomplete. Add it to egressAllowlist or mark it appLevelEgress:false.`,
      value: sp.vendor,
    });
  }
}

// Reverse-proxy rewrites live in vercel.json, which the source scan never reads.
const allowedHosts = new Set(config.egressAllowlist.map((e) => e.host));
try {
  const vercelPath = baseDir ? path.join(baseDir, 'vercel.json') : 'vercel.json';
  const rewrites = JSON.parse(fs.readFileSync(vercelPath, 'utf8')).rewrites ?? [];
  for (const r of rewrites) {
    const m = /^https?:\/\/([a-z0-9.-]+)/i.exec(r.destination ?? '');
    if (m && !allowedHosts.has(m[1].toLowerCase())) {
      findings.push({
        file: 'vercel.json',
        line: 0,
        rule: 'unsanctioned-egress',
        severity: 'violation',
        message: `vercel.json reverse-proxies to un-allowlisted host "${m[1]}". Add it to the egress allowlist (config.mjs) or remove the rewrite.`,
        value: m[1].toLowerCase(),
      });
    }
  }
} catch {
  /* no vercel.json in this tree — nothing to check */
}

// ── 3. Score (start at 100, subtract per severity; mirrors scripts/health) ──
const byRule = {};
const bySeverity = { violation: 0, high: 0, medium: 0, low: 0 };
for (const f of findings) {
  byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
}
const penalty = findings.reduce((s, f) => s + (config.points[f.severity] ?? 0), 0);
const score = Math.max(0, 100 - penalty);

// ── 4. Control coverage ────────────────────────────────────────────────────
const ruleViolated = (rules) => rules.some((r) => (byRule[r] ?? 0) > 0);
const controlResults = controls.map((c) => {
  let status;
  if (c.kind === 'manual') {
    status = c.status ?? 'manual';
  } else {
    status = ruleViolated(c.evidence ?? []) ? 'fail' : 'pass';
  }
  return { id: c.id, family: c.family, title: c.title, kind: c.kind, status, standards: c.standards };
});
const automated = controlResults.filter((c) => c.kind !== 'manual');
const passing = automated.filter((c) => c.status === 'pass').length;

// ── 5. KPIs — the "interesting key numbers" tracked toward the codebase ─────
const allowlist = config.egressAllowlist;
const kpis = {
  filesScanned: files.length,
  egressEndpoints: allowlist.length,
  egressServerOnly: allowlist.filter((e) => e.scope === 'server').length,
  egressClientReachable: allowlist.filter((e) => e.scope === 'client').length,
  ipLeakingEndpoints: allowlist.filter((e) => e.ipLeak).length,
  subProcessors: subProcessors.length,
  hardViolations: bySeverity.violation,
  trackedRisks: bySeverity.high + bySeverity.medium + bySeverity.low,
  serverSecretsGuarded: config.serverOnlySecrets.length,
  neverSendKeyFragments: config.analytics.forbiddenKeyFragments.length,
  controlsTotal: controlResults.length,
  controlsAutomated: automated.length,
  controlsAutomatedPassing: passing,
  controlCoveragePct: automated.length ? Math.round((passing / automated.length) * 100) : 100,
  standardsCovered: standardsCovered.length,
};

const output = {
  score,
  band: band(score, config.bands),
  pass: bySeverity.violation === 0,
  standardsCovered,
  kpis,
  bySeverity,
  byRule,
  findings: findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  ),
  structural,
  controls: controlResults,
};

fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
fs.writeFileSync(jsonOut, JSON.stringify(output, null, 2));

// ── Human summary ──────────────────────────────────────────────────────────
const verdict = output.pass ? 'PASS' : 'FAIL';
console.log(`\nPrivacy & compliance: ${score}/100 (${output.band}) — gate ${verdict}`);
console.log(
  `KPIs: ${kpis.egressEndpoints} egress endpoints (${kpis.ipLeakingEndpoints} IP-leaking) · ` +
    `${kpis.subProcessors} sub-processors · ${kpis.controlsAutomatedPassing}/${kpis.controlsAutomated} ` +
    `automated controls passing (${kpis.controlCoveragePct}%) · ${kpis.controlsTotal} controls across ${kpis.standardsCovered} standards`,
);
console.log(
  `Findings: ${findings.length}  (violation: ${bySeverity.violation}, high: ${bySeverity.high}, ` +
    `medium: ${bySeverity.medium}, low: ${bySeverity.low})  ${JSON.stringify(byRule)}`,
);

if (bySeverity.violation > 0) {
  console.log('\nViolations (these fail the gate):');
  for (const f of findings.filter((f) => f.severity === 'violation')) {
    console.log(`  ✖ ${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
  }
}
const tracked = findings.filter((f) => f.severity !== 'violation');
if (tracked.length) {
  console.log('\nTracked risks (do not block, but watch the trend):');
  for (const f of tracked) {
    console.log(`  • ${f.file}:${f.line}  [${f.rule}, ${f.severity}]  ${f.message}`);
  }
}
console.log(`\nWrote ${jsonOut}`);

if (!output.pass && !noFail) {
  console.error('\nCompliance gate FAILED: privacy violation(s) present. See above.');
  process.exit(1);
}
