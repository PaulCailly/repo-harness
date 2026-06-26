/**
 * CI "Privacy & Compliance" report. Renders the deterministic compliance gate's
 * JSON (scripts/compliance — score, KPIs, findings, control coverage) into one
 * sticky PR comment + the run's job summary, mirroring quality-report.ts. The
 * gate itself (pnpm compliance) is what blocks the build; this only surfaces the
 * numbers so the privacy posture is visible on every PR and trends over time.
 */

import { appendFile, readFile } from "node:fs/promises";

import { context, core, upsertComment } from "./lib/gh.js";
import { details } from "./lib/markdown.js";

const MARKER = "<!-- compliance-report -->";

interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: "violation" | "high" | "medium" | "low";
  message: string;
}
interface Control {
  id: string;
  family: string;
  title: string;
  kind: "rule" | "structural" | "manual";
  status: string;
}
interface ComplianceData {
  score: number;
  band: string;
  pass: boolean;
  standardsCovered: string[];
  kpis: Record<string, number>;
  bySeverity: Record<string, number>;
  byRule: Record<string, number>;
  findings: Finding[];
  controls: Control[];
}

async function readReport(file: string): Promise<ComplianceData | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as ComplianceData;
  } catch {
    return null;
  }
}

const SEV_EMOJI: Record<string, string> = { violation: "⛔", high: "🟠", medium: "🟡", low: "🔵" };
const STATUS_EMOJI: Record<string, string> = {
  pass: "✅", fail: "❌", attested: "✅", partial: "🟡", pending: "⏳", manual: "📝",
};

function kpiBlock(k: Record<string, number>): string {
  const row = (label: string, key: string) => `| ${label} | ${k[key] ?? "—"} |`;
  return details(
    "📈 Key numbers",
    [
      "| KPI | Value |",
      "| --- | --- |",
      row("Files scanned", "filesScanned"),
      row("Egress endpoints", "egressEndpoints"),
      row("Sub-processors", "subProcessors"),
      row("IP-leaking endpoints", "ipLeakingEndpoints"),
      row("Hard violations", "hardViolations"),
      row("Tracked risks", "trackedRisks"),
      row("Server secrets guarded", "serverSecretsGuarded"),
      row("Never-send key fragments", "neverSendKeyFragments"),
      row("Automated controls passing", "controlsAutomatedPassing"),
      row("Control coverage %", "controlCoveragePct"),
      row("Controls total", "controlsTotal"),
    ].join("\n"),
  );
}

function findingsBlock(findings: Finding[]): string {
  if (findings.length === 0) return "No findings — every scanned file is clean. ✅";
  const rows = findings.map(
    (f) =>
      `| ${SEV_EMOJI[f.severity] ?? ""} ${f.severity} | \`${f.file}${f.line ? `:${f.line}` : ""}\` | \`${f.rule}\` | ${f.message} |`,
  );
  return details(
    `🔎 Findings (${findings.length})`,
    ["| Severity | Location | Rule | Detail |", "| --- | --- | --- | --- |", ...rows].join("\n"),
  );
}

function controlsBlock(controls: Control[]): string {
  const rows = controls.map(
    (c) => `| ${STATUS_EMOJI[c.status] ?? ""} ${c.status} | \`${c.id}\` | ${c.family} | ${c.title} |`,
  );
  return details(
    `🛡️ Control register (${controls.length})`,
    ["| Status | ID | Family | Control |", "| --- | --- | --- | --- |", ...rows].join("\n"),
  );
}

function buildReport(data: ComplianceData | null): string {
  if (!data) {
    return [MARKER, "## 🔐 Privacy & Compliance", "", "_Compliance report unavailable for this run._"].join("\n");
  }
  const verdict = data.pass ? "✅ PASS" : "⛔ FAIL — privacy violation(s) present";
  const k = data.kpis;
  return [
    MARKER,
    "## 🔐 Privacy & Compliance",
    "",
    `**Gate: ${verdict}** · **Score ${data.score} / 100** (${data.band})`,
    "",
    `Governed egress across **${k.egressEndpoints} endpoint(s)** (${k.ipLeakingEndpoints} IP-leaking) · ` +
      `**${k.controlsAutomatedPassing}/${k.controlsAutomated}** automated controls passing (${k.controlCoveragePct}%) · ` +
      `**${k.controlsTotal}** controls mapped to ${data.standardsCovered.join(", ")}.`,
    "",
    kpiBlock(data.kpis),
    "",
    findingsBlock(data.findings),
    "",
    controlsBlock(data.controls),
    "",
    "<sub>Deterministic gate by `scripts/compliance` (scans `src/` + `api/`). Violations fail the build; " +
      "findings are tracked privacy risk. Bands: ≥85 good · 65–85 moderate · <65 poor. " +
      "See `docs/15-compliance-and-certification.md`. Raw JSON is attached as the `compliance-report` artifact.</sub>",
  ].join("\n");
}

async function run(): Promise<void> {
  const reportPath = process.env.COMPLIANCE_REPORT ?? ".compliance/compliance.json";
  const data = await readReport(reportPath);
  const body = buildReport(data);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }

  const prNumber = context.payload.pull_request?.number ?? context.payload.issue?.number;
  if (!prNumber) {
    core.info("No pull request in context; wrote the job summary only.");
    return;
  }
  await upsertComment(prNumber, MARKER, body, "compliance");
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
