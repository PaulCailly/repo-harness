/**
 * CI "Code Quality" report. Combines test coverage (vitest json-summary) with
 * deterministic static-analysis metrics (scripts/health, whole `src/` tree)
 * into one sticky PR comment + the run's job summary, and leaves the raw JSON as
 * CI artifacts. The opt-in /review LLM keeps its own changed-files static
 * analysis (see review.ts) — this surfaces the same class of data in CI.
 */

import { appendFile, readFile } from "node:fs/promises";

import { context, core, upsertComment } from "./lib/gh.js";
import { details } from "./lib/markdown.js";
import { collectHealth, rating, summarizeFindings, type HealthData } from "./lib/metrics.js";

const MARKER = "<!-- code-quality-report -->";
const WORST_FILES = 10;

interface Pct {
  total: number;
  covered: number;
  pct: number;
}
interface CoverageTotal {
  statements: Pct;
  branches: Pct;
  functions: Pct;
  lines: Pct;
}

async function readCoverage(file: string): Promise<CoverageTotal | null> {
  try {
    const json = JSON.parse(await readFile(file, "utf8")) as {
      total?: CoverageTotal;
    };
    return json.total ?? null;
  } catch {
    return null;
  }
}

function coverageTable(total: CoverageTotal): string {
  const row = (label: string, p: Pct) =>
    `| ${label} | ${p.pct.toFixed(2)}% | ${p.covered}/${p.total} |`;
  return [
    "| Metric | % | Covered / Total |",
    "| --- | --- | --- |",
    row("Statements", total.statements),
    row("Branches", total.branches),
    row("Functions", total.functions),
    row("Lines", total.lines),
  ].join("\n");
}

function totalFindings(health: HealthData): number {
  return Object.values(health.byRule).reduce((s, n) => s + n, 0);
}

function worstFilesBlock(health: HealthData): string {
  const rows = health.files
    .slice(0, WORST_FILES)
    .map(
      (f) =>
        `| \`${f.file}\` | ${f.score} (${rating(f.score)}) | ${f.sloc} | ${summarizeFindings(f.findings)} |`,
    );
  const body = [
    "| File | Score | SLOC | Findings |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
  return details(
    `🔧 Lowest-scoring files (${Math.min(WORST_FILES, health.files.length)} of ${health.files.length})`,
    body,
  );
}

function findingsBlock(health: HealthData): string {
  const lines = Object.entries(health.byRule)
    .sort((a, b) => b[1] - a[1])
    .map(([ruleId, n]) => `- \`${ruleId}\`: ${n}`);
  return details(`🧮 Findings by rule (${totalFindings(health)})`, lines.join("\n"));
}

function buildReport(total: CoverageTotal | null, health: HealthData | null): string {
  const parts = [MARKER, "## 🧭 Code Quality", ""];

  if (health?.score !== null && health?.score !== undefined && health.band) {
    parts.push(
      `**📊 Code health: ${health.score} / 100** (${health.band}) — ` +
        `${health.files.length} file(s) in \`src/\`, ${totalFindings(health)} finding(s).`,
      "",
    );
  }

  if (total) {
    parts.push(
      `**🧪 Test coverage** — ${total.lines.pct.toFixed(1)}% lines, ${total.branches.pct.toFixed(1)}% branches.`,
      "",
      coverageTable(total),
      "",
    );
  } else {
    parts.push("_Coverage report unavailable for this run._", "");
  }

  if (health) {
    if (health.files.length > 0) parts.push(worstFilesBlock(health), "");
    if (totalFindings(health) > 0) parts.push(findingsBlock(health), "");
    parts.push(
      "<sub>Code health starts each file at 100 and subtracts points for concrete violations " +
        "(complex/long functions, deep nesting, big files, duplication). Bands: ≥85 good · 65–85 moderate · <65 poor. " +
        "Static analysis by `scripts/health` (whole `src/`); coverage by vitest. " +
        "Raw JSON is attached to the run as the `code-quality-reports` artifact.</sub>",
    );
  } else {
    parts.push("_Static-analysis metrics unavailable for this run._");
  }

  return parts.join("\n");
}

async function run(): Promise<void> {
  const reportDir = process.env.HEALTH_REPORT_DIR;
  const covPath = process.env.COVERAGE_SUMMARY ?? "coverage/coverage-summary.json";

  const [health, total] = await Promise.all([
    reportDir ? collectHealth(reportDir, null).catch(() => null) : Promise.resolve(null),
    readCoverage(covPath),
  ]);

  const body = buildReport(total, health);

  // "Raw data here": always write to the run's job summary, even off a PR.
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }

  const prNumber =
    context.payload.pull_request?.number ?? context.payload.issue?.number;
  if (!prNumber) {
    core.info("No pull request in context; wrote the job summary only.");
    return;
  }
  await upsertComment(prNumber, MARKER, body, "code-quality");
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
