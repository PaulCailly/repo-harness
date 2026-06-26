/**
 * Code-health CLI: analyze every source file under a directory, fold in jscpd
 * duplication when available, and emit a single SLOC-weighted score plus the
 * per-file findings. Writes JSON for the CI report and prints a human summary.
 *
 *   node scripts/health/index.mjs [srcDir] [--json <path>] [--jscpd <report>]
 *
 * Defaults: srcDir=src, json=.health/health.json. Exit code is always 0
 * (informational, like the previous code-health step).
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.mjs';
import { analyzeSource, band } from './analyze.mjs';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const srcDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'src';
const jsonOut = arg('--json', '.health/health.json');
const jscpdPath = arg('--jscpd', '.health/code-duplication-audit/jscpd-report.json');

/** All analyzable files under `dir`, as src-relative POSIX paths. */
function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const rel = String(entry).split(path.sep).join('/');
    if (config.include.test(rel) && !config.exclude.test(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Normalise a jscpd path to a srcDir-relative POSIX key matching `listFiles`.
 *  jscpd emits paths relative to the scanned root (`application/x.ts`), but can
 *  also surface them src-prefixed or absolute depending on version/invocation —
 *  so strip everything up to and including the `<srcRoot>/` segment, else use as-is. */
function toSrcRelative(name, srcRoot) {
  const norm = String(name).split(path.sep).join('/');
  const marker = `${srcRoot.split(path.sep).join('/')}/`;
  const idx = norm.lastIndexOf(marker);
  const rel = idx >= 0 ? norm.slice(idx + marker.length) : norm;
  return rel.replace(/^\.?\//, '');
}

/** Map of src-relative file -> duplicated line count, from a jscpd JSON report. */
function loadDuplication(reportPath, srcRoot) {
  if (!fs.existsSync(reportPath)) {
    return new Map();
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const dup = new Map();
  const bump = (name, lines) => {
    const rel = toSrcRelative(name, srcRoot);
    dup.set(rel, (dup.get(rel) ?? 0) + lines);
  };
  for (const d of report.duplicates ?? []) {
    bump(d.firstFile?.name ?? '', d.lines ?? 0);
    bump(d.secondFile?.name ?? '', d.lines ?? 0);
  }
  return dup;
}

const files = listFiles(srcDir);
const duplication = loadDuplication(jscpdPath, srcDir);

// Guard the silent-failure case: a jscpd report whose paths don't resolve to
// any analyzed file (a base-path mismatch) would drop all duplication penalties
// with no error. Warn loudly instead. (jscpd path wiring lands with CI.)
if (fs.existsSync(jscpdPath) && duplication.size > 0) {
  const matched = files.filter((f) => duplication.has(f)).length;
  if (matched === 0) {
    console.warn(
      `WARN: jscpd report at ${jscpdPath} has ${duplication.size} file(s) but ` +
        `none matched ${srcDir}/* — duplication not scored (check the jscpd base path).`,
    );
  }
}

const results = files
  .map((rel) => {
    const source = fs.readFileSync(path.join(srcDir, rel), 'utf8');
    return analyzeSource(rel, source, config, duplication.get(rel) ?? 0);
  })
  .sort((a, b) => a.score - b.score);

const totalSloc = results.reduce((s, r) => s + r.sloc, 0) || 1;
const weighted = results.reduce((s, r) => s + r.score * r.sloc, 0) / totalSloc;
const score = Math.round(weighted);

const findings = results.flatMap((r) => r.findings);
const byRule = {};
for (const f of findings) {
  byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
}

const output = {
  score,
  band: band(score, config.bands),
  files: results.length,
  totalSloc,
  findings: findings.length,
  byRule,
  perFile: results.map(({ file, score: s, penalty, sloc, findings: f }) => ({
    file,
    score: s,
    penalty,
    sloc,
    findings: f,
  })),
};

fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
fs.writeFileSync(jsonOut, JSON.stringify(output, null, 2));

// --- human summary ---
console.log(`\nCode health: ${score}/100 (${output.band}) — ${results.length} files, ${totalSloc} SLOC`);
console.log(`Findings: ${findings.length}  ${JSON.stringify(byRule)}`);
console.log('\nLowest-scoring files:');
for (const r of results.slice(0, 12)) {
  console.log(`  ${String(r.score).padStart(3)}  ${r.file}  (-${r.penalty})`);
}
console.log(`\nWrote ${jsonOut}`);
