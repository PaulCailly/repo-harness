/**
 * OpenRouter-powered, opt-in **privacy & compliance** audit of a pull request —
 * the agent layer that sits on top of the deterministic gate (scripts/compliance),
 * exactly as `/review` sits on top of `scripts/health`. Triggered by a
 * `/compliance` comment on a PR.
 *
 * It is grounded on the gate's JSON (.compliance/compliance.json): the score,
 * KPIs, findings and control register are fed to the model as objective facts, so
 * its judgement is anchored to what the deterministic scan already proved rather
 * than guessed. It then reasons about the things a regex can't — whether a new
 * data flow has a lawful basis, whether health data is leaving on an implicit
 * (not explicit) action, whether a change weakens a documented control — and
 * posts a single sticky "Privacy & Compliance audit" comment.
 *
 * Read-only over the repo at the PR head (read_file / list_directory), like the
 * code reviewer; it never writes code and posts exactly one comment. The model
 * is selectable in the comment (`/compliance <alias|provider/slug>`), routed
 * through OpenRouter; it defaults to Claude Opus.
 */

import type OpenAI from "openai";
import { context, core, octokit, owner, repo } from "./lib/gh.js";
import { costTable } from "./lib/markdown.js";
import { getClient, type ModelSpec, MODELS } from "./lib/openrouter.js";
import { fileTree, guidelineDocs, listDir, readFile } from "./lib/repo.js";
import type { Usage } from "./lib/types.js";

/** The model used when `/compliance` names none — Opus, for DPO-grade judgement. */
const DEFAULT_COMPLIANCE_KEY = "opus";

/**
 * Resolve the single model a `/compliance …` comment asks for:
 * a registered alias, a raw `provider/slug` (pricing unknown), else the default.
 */
function resolveModel(commentBody: string): ModelSpec {
  const after = commentBody.trim().replace(/^\/compliance\b/i, "").trim();
  for (const t of after.split(/\s+/).filter(Boolean).map((s) => s.toLowerCase())) {
    if (MODELS[t]) return MODELS[t];
    if (t.includes("/")) return { key: t, slug: t, label: t, input: NaN, output: NaN };
  }
  return MODELS[DEFAULT_COMPLIANCE_KEY];
}

const MARKER = "<!-- compliance-audit -->";
const MAX_TURNS = 14;
const MAX_READS = 50;

type RiskSeverity = "blocker" | "high" | "medium" | "low" | "info";
const RISK_EMOJI: Record<RiskSeverity, string> = {
  blocker: "⛔", high: "🟠", medium: "🟡", low: "🔵", info: "⚪",
};

interface ComplianceRisk {
  severity: RiskSeverity;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
  standards: string;
}
interface AuditResult {
  verdict: "pass" | "concerns" | "fail";
  summary: string;
  risks: ComplianceRisk[];
}

const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "concerns", "fail"],
      description: "pass = no privacy/compliance issues; concerns = tracked risks worth noting; fail = a likely breach of the governed-egress / consent / minimisation guarantees.",
    },
    summary: { type: "string", description: "2-4 sentences on how this change affects the app's privacy posture and compliance." },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["blocker", "high", "medium", "low", "info"] },
          area: { type: "string", description: "e.g. egress, secrets, consent, minimisation, data-subject-rights, retention, sub-processors." },
          title: { type: "string" },
          detail: { type: "string", description: "What the change does and why it is (or isn't) a privacy/compliance concern." },
          recommendation: { type: "string", description: "Concrete fix or the attestation needed." },
          standards: { type: "string", description: "Relevant clause(s), e.g. 'GDPR Art. 9(2)(a); ISO 27701 §7.2.3'. Empty if none." },
        },
        required: ["severity", "area", "title", "detail", "recommendation", "standards"],
      },
    },
  },
  required: ["verdict", "summary", "risks"],
};

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file at the PR's head commit — config (scripts/compliance/config.mjs, controls.mjs), the changed files, the analytics sanitiser/seam, services wiring, api/ handlers, docs/15 — whatever you need to judge the data flows.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List a directory at the PR head ('' or '.' for root).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_audit",
      description: "Submit your final privacy & compliance audit. Call exactly once.",
      parameters: AUDIT_SCHEMA as unknown as Record<string, unknown>,
    },
  },
];

const SYSTEM = `You are a Data Protection Officer and privacy engineer auditing a pull request for a LOCAL-FIRST health & fitness app.

The product promise (doc 01 principle 1) is "local-first, private; nothing leaves the device without an explicit, visible action." The real, enforced guarantee is GOVERNED EGRESS: a closed, documented set of destinations, each with a data category and lawful basis; everything else is forbidden. Health/training data is special-category data (GDPR Art. 9) — it may only leave the device on an explicit, opt-in action.

You are given the deterministic compliance gate's results (scripts/compliance) as objective grounding: the score, KPIs, findings, and the control register mapped to GDPR / ISO 27701 / ISO 27001 / SOC 2 / OWASP MASVS. Trust those facts; do not re-litigate them. Your job is the judgement a static scan can't make:
- Does this change introduce or alter a data flow off-device? If so, what category of data, to which destination, and what is the lawful basis? Is it gated behind explicit opt-in consent (for health data) or at least opt-out (for anonymous analytics)?
- Does it route personal/health data or secrets somewhere the deterministic scan wouldn't catch (e.g. through a server handler, a log, an error report, a new prop on an analytics event)?
- Does it weaken a documented control (consent gate, never-send sanitiser, data export/erase, proxying)?
- Does it add a sub-processor or destination without updating the egress allowlist and docs/15?

Use read_file / list_directory to inspect the relevant code and config before judging. Be specific and cite the standard clause when you can. Prefer precision: a clean change should return verdict "pass" with an empty or near-empty risks list. Reserve "fail" for a genuine likely breach. When done, call submit_audit.`;

function groundingFrom(reportJson: string | null): string {
  if (!reportJson) return "(deterministic gate report unavailable — audit from the diff and code alone)";
  try {
    const d = JSON.parse(reportJson) as {
      score: number; band: string; pass: boolean; kpis: Record<string, number>;
      findings: { file: string; line: number; rule: string; severity: string; message: string }[];
      controls: { id: string; title: string; status: string }[];
    };
    const findings = d.findings.map((f) => `- [${f.severity}] ${f.file}:${f.line} ${f.rule} — ${f.message}`).join("\n");
    const controls = d.controls.map((c) => `- ${c.id} (${c.status}): ${c.title}`).join("\n");
    return [
      `Gate verdict: ${d.pass ? "PASS" : "FAIL"} · score ${d.score}/100 (${d.band}).`,
      `KPIs: ${JSON.stringify(d.kpis)}`,
      "",
      "Deterministic findings:",
      findings || "(none)",
      "",
      "Control register:",
      controls || "(none)",
    ].join("\n");
  } catch {
    return "(deterministic gate report could not be parsed)";
  }
}

const VALID_VERDICTS: AuditResult["verdict"][] = ["pass", "concerns", "fail"];
const VALID_RISK_SEVERITIES: RiskSeverity[] = ["blocker", "high", "medium", "low", "info"];

/** Coerce a model's submit_audit payload into a well-formed AuditResult. Cross-provider
 *  models vary in how strictly they follow the schema, so defend every field. */
function normalizeResult(raw: unknown): AuditResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const verdict = VALID_VERDICTS.includes(obj.verdict as AuditResult["verdict"])
    ? (obj.verdict as AuditResult["verdict"])
    : "concerns";
  const rawRisks = Array.isArray(obj.risks) ? obj.risks : [];
  const risks: ComplianceRisk[] = [];
  for (const item of rawRisks) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (!r.title) continue;
    risks.push({
      severity: VALID_RISK_SEVERITIES.includes(r.severity as RiskSeverity) ? (r.severity as RiskSeverity) : "info",
      area: String(r.area ?? "general"),
      title: String(r.title),
      detail: String(r.detail ?? ""),
      recommendation: String(r.recommendation ?? ""),
      standards: String(r.standards ?? ""),
    });
  }
  return { verdict, summary: typeof obj.summary === "string" ? obj.summary : "", risks };
}

async function audit(
  model: ModelSpec,
  prTitle: string,
  prBody: string,
  diffText: string,
  headSha: string,
  grounding: string,
): Promise<{ result: AuditResult; usage: Usage; turns: number }> {
  const [docs, tree] = await Promise.all([guidelineDocs(headSha), fileTree(headSha)]);
  const initial = [
    `Pull request: ${prTitle}`,
    "",
    "## PR description",
    prBody.trim() || "(no description provided)",
    "",
    "## Deterministic compliance gate (scripts/compliance) — objective grounding",
    grounding,
    "",
    "## Project guidelines & architecture",
    docs || "(none found)",
    "",
    "## Repository file tree",
    "```",
    tree,
    "```",
    "",
    "## The diff to audit (changed files, unified patches)",
    diffText,
    "",
    "Inspect the data flows with your tools (start with scripts/compliance/config.mjs and docs/15), then call submit_audit.",
  ].join("\n");

  const client = getClient();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: initial },
  ];
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let reads = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const force = turn === MAX_TURNS - 1;
    const resp = await client.chat.completions.create({
      model: model.slug,
      max_tokens: 16000,
      messages,
      tools: TOOLS,
      tool_choice: force ? { type: "function", function: { name: "submit_audit" } } : "auto",
    });

    usage.input_tokens += resp.usage?.prompt_tokens ?? 0;
    usage.output_tokens += resp.usage?.completion_tokens ?? 0;

    const msg = resp.choices[0]?.message;
    if (!msg) throw new Error(`${model.label}: empty response from the model.`);
    if (msg.refusal) throw new Error(`${model.label} declined to audit this PR.`);
    messages.push(msg as OpenAI.Chat.Completions.ChatCompletionMessageParam);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      messages.push({ role: "user", content: "Call submit_audit now." });
      continue;
    }

    let submitted: AuditResult | null = null;
    for (const call of calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* leave args empty; tool result below explains the failure */
      }

      if (name === "submit_audit") {
        submitted = normalizeResult(args);
        messages.push({ role: "tool", tool_call_id: call.id, content: "Audit received." });
        continue;
      }

      const path = String(args.path ?? "");
      let out: string;
      try {
        if (name === "read_file") {
          out = ++reads > MAX_READS ? "Read budget exhausted — call submit_audit." : await readFile(path, headSha);
        } else if (name === "list_directory") {
          out = await listDir(path, headSha);
        } else {
          out = `Unknown tool: ${name}`;
        }
      } catch (err) {
        out = err instanceof Error ? err.message : String(err);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }

    if (submitted) return { result: submitted, usage, turns: turn + 1 };
  }
  throw new Error(`${model.label}: audit did not converge — the model never called submit_audit.`);
}

const VERDICT = {
  pass: "✅ PASS — no privacy/compliance concerns",
  concerns: "🟡 CONCERNS — tracked risks worth noting",
  fail: "⛔ FAIL — likely breach of the privacy guarantees",
};

async function upsert(prNumber: number, body: string): Promise<void> {
  const existing = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 });
  const mine = existing.find((c) => (c.body ?? "").includes(MARKER));
  if (mine) await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
}

async function run(): Promise<void> {
  const prNumber = context.payload.issue?.number ?? context.payload.pull_request?.number;
  if (!prNumber) {
    core.info("No pull request in context; nothing to audit.");
    return;
  }

  const model = resolveModel(context.payload.comment?.body ?? "/compliance");
  core.info(`Auditing with: ${model.label} (${model.slug})`);
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 });
  const reviewable = files.filter((f) => f.patch && f.status !== "removed");
  if (reviewable.length === 0) {
    core.info("No textual changes to audit.");
    return;
  }
  const diffText = reviewable
    .map((f) => `### File: ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${f.patch}`)
    .join("\n\n");

  let grounding: string;
  try {
    const { readFile: rf } = await import("node:fs/promises");
    grounding = groundingFrom(await rf(process.env.COMPLIANCE_REPORT ?? ".compliance/compliance.json", "utf8"));
  } catch {
    grounding = groundingFrom(null);
  }

  const { result, usage, turns } = await audit(model, pr.title, pr.body ?? "", diffText, pr.head.sha, grounding);

  const counts = result.risks.reduce((a, r) => ((a[r.severity] = (a[r.severity] ?? 0) + 1), a), {} as Record<string, number>);
  const parts = [
    MARKER,
    "## 🔐 Privacy & Compliance audit",
    "",
    `**${VERDICT[result.verdict]}**`,
    "",
    result.summary,
    "",
    result.risks.length === 0
      ? "_No risks raised for this change._"
      : `Raised **${result.risks.length}** item(s): ${(["blocker", "high", "medium", "low", "info"] as RiskSeverity[]).map((s) => `${counts[s] ?? 0} ${RISK_EMOJI[s]}`).join(" · ")}`,
  ];
  for (const r of result.risks) {
    parts.push(
      "",
      `### ${RISK_EMOJI[r.severity]} ${r.title} · \`${r.area}\``,
      r.detail,
      "",
      `**Recommendation:** ${r.recommendation}`,
      ...(r.standards ? [`**Standards:** ${r.standards}`] : []),
    );
  }
  parts.push("", costTable("💰 Audit cost", usage, turns, model), "", `<sub>Audited by \`${model.slug}\` via OpenRouter, grounded on \`scripts/compliance\`. See \`docs/15-compliance-and-certification.md\`.</sub>`);

  await upsert(prNumber, parts.join("\n"));
  core.info(`Posted compliance audit (verdict: ${result.verdict}, ${result.risks.length} risk(s)).`);
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
