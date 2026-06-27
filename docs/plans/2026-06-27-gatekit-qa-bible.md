# gatekit QA bible — SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize backresto's exploratory-QA (generated routes + owned semantic overlay + divide-and-conquer) into a portable gatekit capability: a documented bible format, a config-driven route extractor (multiple routing styles), and an OpenRouter-**Opus**-powered overlay generator — and consolidate backresto's qa engine into the gatekit registry as the canonical managed `qa`.

**Architecture:** Work happens in the gatekit repo (`~/repo-harness`) under `packages/cli/registry/` — the `_lib` (shared sentinel) and `qa` (the bot + generators) registry items. We first **replace** the registry's older atlas-derived qa/lib with backresto's advanced sentinel (the source of truth), then **generalize** the route extractor into config-driven strategies and **add** the Opus overlay generator, all unit-tested via the sentinel's own `node:test` suite. The runtime divide-and-conquer is carried verbatim (already tested). Consumers own their `qa-map.overlay.ts` + `qa-map.generated.json` + a `gatekit.json` `qa` config block; the engine + generators are managed.

**Tech Stack:** TypeScript ESM, tsx, `node:test`+`node:assert/strict`, the `openai` SDK pointed at OpenRouter (existing `lib/openrouter.ts` `getClient()`), Node 22. The registry sentinel is its own npm project at `packages/cli/registry/_lib/`.

## Global Constraints

- Node 22 (`export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`); the test glob silently passes 0 tests under Node 20.
- Work on branch `feat/qa-bible` off `main` in `~/repo-harness`. Commits are plain (gatekit has no husky).
- ESM `.js` import specifiers in source AND tests (project convention; `.ts` specifiers break `tsc`).
- The **source of truth** for the advanced qa code is `featers/backresto` `origin/main` `.github/sentinel/` — copy from there (the local checkout `~/work/backresto/backresto` has it on `origin/main`; use `git -C ~/work/backresto/backresto show origin/main:<path>` to read canonical versions).
- Managed (registry) vs owned (consumer): `qa-map.overlay.ts`, `qa-map.generated.json`, `QA-MEMORY.md`, and the `gatekit.json` `qa` block are OWNED; everything else (engine, lib, generators, workflows) is managed.
- The Opus generator defaults to model slug **`anthropic/claude-opus-4`** via OpenRouter (overridable by config `bibleModel`); it reuses `OPENROUTER_API_KEY`. The LLM call is stubbed in unit tests — never call a live model in tests.
- The generator NEVER overwrites an existing owned overlay without `--force` (writes `qa-map.overlay.draft.ts` instead). LLM output is validated against the `QaOverlay` shape AND the generated routes before any write.
- Spec: `docs/specs/2026-06-27-gatekit-qa-bible-design.md`.

## Existing interfaces (from backresto sentinel — consume verbatim)

```ts
// lib/qa-map.ts
interface GeneratedRoute { path: string; section: string; module: string | null }
interface GeneratedFile { generatedAt: string | null; locales: string[]; routes: GeneratedRoute[] }
interface QaDomain { key: string; label: string; routes: string[]; preconditions: string[] }
interface QaOverlay { domains: QaDomain[]; routePreconditions: Record<string,string[]>; outOfScope: string[]; enabledModules: string[] }
interface QaMap { locales: string[]; routes: QaRoute[]; domains: QaDomain[]; outOfScope: string[]; enabledModules: string[] }
function mergeQaMap(generated: GeneratedFile, overlay: QaOverlay): QaMap   // throws on overlay→route drift
function loadQaMap(): QaMap
// scripts/gen-qa-map.ts
function generateMap(): GeneratedFile      // currently next-pages only
// lib/openrouter.ts
function getClient(): OpenAI               // OpenAI SDK bound to OpenRouter base URL + OPENROUTER_API_KEY
```

## File Structure (in `~/repo-harness/packages/cli/registry/`)

```
_lib/src/lib/*.ts            # MODIFY: replaced with backresto's advanced lib (Task 1)
_lib/src/lib/route-extract.ts        # NEW: config-driven route strategies (Task 3)
_lib/src/lib/route-extract.test.ts   # NEW (Task 3)
_lib/src/lib/bible-gen.ts            # NEW: prompt-assembly + validate + write (pure-ish; Task 4)
_lib/src/lib/bible-gen.test.ts       # NEW (Task 4)
qa/qa.ts                     # MODIFY: backresto's divide-and-conquer qa (Task 1)
qa/scripts/gen-qa-map.ts     # MODIFY: thin CLI over route-extract.ts (Task 3)
qa/scripts/gen-bible.ts      # NEW: thin CLI over bible-gen.ts + getClient (Task 4)
qa/qa.yml                    # MODIFY: backresto's fan-out workflow (Task 1)
qa/qa-map.overlay.ts         # NEW owned template (Task 5)
registry.json                # MODIFY: qa feature files + the two scripts + owned overlay (Tasks 1,5)
~/repo-harness/docs/public/qa-map.schema.json   # NEW (Task 2)
~/repo-harness/docs/src/content/docs/gates/qa-bible.md   # NEW (Task 7)
```

(Exact `_lib`/`qa` layout: follow whatever the registry already uses; the registry's sentinel has its own `package.json`/`tsconfig.json` under `_lib/`.)

---

### Task 1: Consolidate backresto's advanced sentinel into the registry

**Files:** replace `packages/cli/registry/qa/qa.ts`, `packages/cli/registry/qa/qa.yml`, and the `packages/cli/registry/_lib/src/lib/*` qa-related modules with backresto `origin/main` versions; update `registry.json`.

**Interfaces:**
- Produces: the canonical managed `qa` feature = backresto's `qa.ts` (divide-and-conquer) + `lib/{qa-core,qa-map,qa-memory,qa-shard,browser,recorder,openrouter,gemini,gh,markdown,diff,reactions,metrics,types,repo,qa-auth,benchmark,release-core,debate-core,debate-format}.ts` + `scripts/gen-qa-map.ts` + the fan-out `qa.yml`.

- [ ] **Step 1: Enumerate + copy the canonical sentinel files**

```bash
cd ~/repo-harness
git checkout -b feat/qa-bible
B=~/work/backresto/backresto
# the advanced qa runtime + the lib it needs + the route generator + fan-out workflow
for f in src/qa.ts src/lib/qa-core.ts src/lib/qa-map.ts src/lib/qa-map.test.ts \
         src/lib/qa-memory.ts src/lib/qa-shard.ts src/lib/qa-shard.test.ts \
         src/lib/browser.ts src/lib/recorder.ts src/lib/openrouter.ts src/lib/gemini.ts \
         src/lib/qa-auth.ts scripts/gen-qa-map.ts; do
  echo "=== $f ==="; git -C "$B" show "origin/main:.github/sentinel/$f" >/dev/null 2>&1 && echo present || echo MISSING
done
```
For each present file, write its `origin/main` content into the matching registry path: `lib/*` → `packages/cli/registry/_lib/src/lib/`, `qa.ts` → `packages/cli/registry/qa/qa.ts`, `scripts/gen-qa-map.ts` → `packages/cli/registry/qa/scripts/gen-qa-map.ts`. Use `git -C "$B" show origin/main:.github/sentinel/<f> > <dest>`. Also copy `.github/workflows/qa.yml` (the fan-out) → `packages/cli/registry/qa/qa.yml`. Keep the existing review/debate/release lib files that backresto didn't change.

- [ ] **Step 2: Verify the registry sentinel type-checks + its carried tests pass**

Assemble the sentinel and run its suite (the registry `_lib` has its own package.json/tsconfig; the qa.ts + scripts reference `../lib` — replicate a buildable layout):
```bash
cd ~/repo-harness/packages/cli/registry/_lib
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
npm i
# copy qa.ts + scripts next to src for a combined typecheck (temp, not committed)
cp ../qa/qa.ts src/qa.ts && mkdir -p src/scripts && cp ../qa/scripts/gen-qa-map.ts src/scripts/
npx tsc --noEmit -p tsconfig.json
node --import tsx --test 'src/**/*.test.ts' 2>&1 | grep -E "^# (tests|pass|fail)"
rm -f src/qa.ts; rm -rf src/scripts
```
Expected: tsc 0; the carried qa-map + qa-shard tests pass. If `tsconfig include` is `["src"]` and qa.ts must live elsewhere, run tsc over a temp combined dir instead — do NOT edit source to satisfy the check.

- [ ] **Step 3: Update `registry.json` qa item**

Ensure the `qa` registry item lists (managed): `qa/qa.ts`→`{sentinel}/src/qa.ts`, `qa/scripts/gen-qa-map.ts`→`{sentinel}/scripts/gen-qa-map.ts`, `qa/qa.yml`→`.github/workflows/qa.yml`; and the new `_lib` files (qa-shard, etc.) under `{sentinel}/src/lib/`. The owned `qa/qa-map.overlay.ts`→`{sentinel}/src/lib/qa-map.overlay.ts` (type `owned`) is added in Task 5. Keep `dependsOn:["_lib"]`, secrets unchanged.

- [ ] **Step 4: Commit**

```bash
cd ~/repo-harness
git add packages/cli/registry
git commit -m "feat(qa): consolidate backresto's advanced qa (divide-and-conquer) as canonical registry qa"
```

---

### Task 2: Standard bible format — JSON Schema + doc contract

**Files:**
- Create: `~/repo-harness/docs/public/qa-map.schema.json`
- Test: `packages/cli/registry/_lib/src/lib/qa-map.schema.test.ts`

**Interfaces:**
- Produces: a JSON Schema (draft-07) for `qa-map.generated.json` validating `{generatedAt: string|null, locales: string[], routes: [{path: string (^/), section: string, module: string|null}]}`.

- [ ] **Step 1: Write the failing test** (validates a sample generated map against the schema)

```ts
// packages/cli/registry/_lib/src/lib/qa-map.schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../docs/public/qa-map.schema.json", import.meta.url)), "utf8"));

test("schema requires the generated-map shape", () => {
  assert.equal(schema.type, "object");
  for (const k of ["generatedAt", "locales", "routes"]) assert.ok(k in schema.properties, `missing ${k}`);
  assert.equal(schema.properties.routes.items.properties.path.pattern, "^/");
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` in `_lib` → FAIL (schema file missing).

- [ ] **Step 3: Write the schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://paulcailly.github.io/gatekit/qa-map.schema.json",
  "title": "gatekit qa-map.generated.json",
  "type": "object",
  "required": ["generatedAt", "locales", "routes"],
  "additionalProperties": false,
  "properties": {
    "generatedAt": { "type": ["string", "null"] },
    "locales": { "type": "array", "items": { "type": "string" } },
    "routes": {
      "type": "array",
      "items": {
        "type": "object", "required": ["path", "section", "module"], "additionalProperties": false,
        "properties": {
          "path": { "type": "string", "pattern": "^/" },
          "section": { "type": "string" },
          "module": { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add docs/public/qa-map.schema.json packages/cli/registry/_lib/src/lib/qa-map.schema.test.ts && git commit -m "feat(qa): standard qa-map JSON Schema"`

---

### Task 3: Portable route extractor (config-driven strategies)

**Files:**
- Create: `packages/cli/registry/_lib/src/lib/route-extract.ts`
- Test: `packages/cli/registry/_lib/src/lib/route-extract.test.ts`
- Modify: `packages/cli/registry/qa/scripts/gen-qa-map.ts` (thin CLI over the lib)

**Interfaces:**
- Produces:
  - `interface QaConfig { routing: "next-pages"|"next-app"|"glob"|"opus-infer"; pagesDir?: string; appDir?: string; glob?: string; localesDir?: string|null; modulePrefix?: string|null; bibleModel?: string; docsForBible?: string[] }`
  - `extractRoutes(rootDir: string, cfg: QaConfig): GeneratedFile` — dispatches by `cfg.routing`. `next-pages` = backresto's existing logic (scan `<rootDir>/<pagesDir>/[locale]/**`). `next-app` = scan `<rootDir>/<appDir>/**/page.{tsx,jsx,ts,js}` → route = the dir path relative to appDir. `glob` = match `cfg.glob` files, derive path from a `<rootDir>`-relative rule (strip extension, `/index`). `opus-infer` returns `{generatedAt:null, locales, routes: []}` (routes come from the LLM step). `section` = first path segment; `module` = second segment when `section` matches `modulePrefix` (default `/modules`). Locales from `localesDir` (dir names) or `[]`.

- [ ] **Step 1: Write the failing test** (fixture trees per strategy)

```ts
// route-extract.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRoutes } from "./route-extract.js";

function tmp() { return mkdtempSync(join(tmpdir(), "rx-")); }

test("next-pages: locale-prefixed pages → routes, module derived", () => {
  const d = tmp();
  mkdirSync(join(d, "src/pages/[locale]/modules/cooling"), { recursive: true });
  writeFileSync(join(d, "src/pages/[locale]/modules/cooling/index.tsx"), "x");
  writeFileSync(join(d, "src/pages/[locale]/home.tsx"), "x");
  const r = extractRoutes(d, { routing: "next-pages", pagesDir: "src/pages", modulePrefix: "/modules" });
  const paths = r.routes.map((x) => x.path).sort();
  assert.deepEqual(paths, ["/home", "/modules/cooling"]);
  assert.equal(r.routes.find((x) => x.path === "/modules/cooling")!.module, "cooling");
});

test("next-app: page.tsx dirs → routes", () => {
  const d = tmp();
  mkdirSync(join(d, "app/blog/[slug]"), { recursive: true });
  writeFileSync(join(d, "app/blog/[slug]/page.tsx"), "x");
  writeFileSync(join(d, "app/page.tsx"), "x");
  const r = extractRoutes(d, { routing: "next-app", appDir: "app" });
  assert.deepEqual(r.routes.map((x) => x.path).sort(), ["/", "/blog/:slug"]);
});

test("glob: matched files → routes via strip rule", () => {
  const d = tmp();
  mkdirSync(join(d, "src/screens"), { recursive: true });
  writeFileSync(join(d, "src/screens/coach.screen.tsx"), "x");
  const r = extractRoutes(d, { routing: "glob", glob: "src/screens/*.screen.tsx" });
  assert.deepEqual(r.routes.map((x) => x.path), ["/coach"]);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (route-extract.ts missing).

- [ ] **Step 3: Implement `route-extract.ts`** — port backresto's `walk`/`toRoute` for `next-pages`; add `next-app` (walk appDir for `page.*`, route = dir rel to appDir, `[x]`→`:x`, root → `/`); add `glob` (a small zero-dep glob over the one `*` segment, or `fs` walk + suffix match; strip the matched-suffix + extension to derive the path, normalize `/index`). Shared `section`/`module`/locale logic. Keep `GeneratedFile` shape. Export `QaConfig` + `extractRoutes`. (No external glob dep — implement a minimal matcher for the `dir/*.suffix` form the config uses.)

- [ ] **Step 4: Run to verify it passes** — PASS (3 tests).

- [ ] **Step 5: Rewire `gen-qa-map.ts`** to read the consumer's `gatekit.json` `qa` config, call `extractRoutes(repoRoot, cfg)`, and write `qa-map.generated.json` (preserve the freshness-test export `generateMap()`/`extractRoutes` so the CI check works). Keep it runnable via `npm run qa:gen-map`.

- [ ] **Step 6: Commit** — `git commit -am "feat(qa): config-driven route extractor (next-pages|next-app|glob)"`

---

### Task 4: Opus overlay generator (`bible-gen.ts` + `gen-bible.ts`)

**Files:**
- Create: `packages/cli/registry/_lib/src/lib/bible-gen.ts`
- Test: `packages/cli/registry/_lib/src/lib/bible-gen.test.ts`
- Create: `packages/cli/registry/qa/scripts/gen-bible.ts` (thin CLI wiring `getClient()` → `bible-gen`)

**Interfaces:**
- Produces (pure, testable — the LLM call is injected):
  - `buildBiblePrompt(ctx: { routes: GeneratedRoute[]; locales: string[]; readme: string; docs: string; pkgName: string }): { system: string; user: string }` — assembles the standardized prompt asking for a `QaOverlay` JSON.
  - `parseOverlay(raw: string): QaOverlay` — parses the model's JSON (tolerant of code fences), throws on malformed shape.
  - `validateOverlay(overlay: QaOverlay, generated: GeneratedFile): string[]` — returns a list of problems: any `domains[].routes` / `outOfScope` / `routePreconditions` key not present in `generated.routes`; empty domains; returns `[]` when valid.
  - `generateBible(opts: { rootDir: string; cfg: QaConfig; generated: GeneratedFile; complete: (p: {system:string;user:string}) => Promise<string> }): Promise<{ overlay: QaOverlay; problems: string[] }>` — gathers context, builds prompt, calls the injected `complete`, parses + validates. `complete` is the seam the test stubs and `gen-bible.ts` fills with a real OpenRouter call.

- [ ] **Step 1: Write the failing test** (stubbed LLM; validation behavior)

```ts
// bible-gen.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBiblePrompt, parseOverlay, validateOverlay, generateBible } from "./bible-gen.js";

const generated = { generatedAt: null, locales: ["en"], routes: [
  { path: "/home", section: "home", module: null },
  { path: "/modules/cooling", section: "modules", module: "cooling" },
]};

test("buildBiblePrompt mentions the routes + asks for QaOverlay JSON", () => {
  const p = buildBiblePrompt({ routes: generated.routes, locales: ["en"], readme: "", docs: "", pkgName: "app" });
  assert.match(p.user, /\/modules\/cooling/);
  assert.match(p.system + p.user, /domains/i);
});

test("parseOverlay tolerates code fences", () => {
  const o = parseOverlay("```json\n{\"domains\":[],\"routePreconditions\":{},\"outOfScope\":[],\"enabledModules\":[]}\n```");
  assert.deepEqual(o.domains, []);
});

test("validateOverlay rejects a route not in the generated map", () => {
  const bad = { domains: [{ key: "x", label: "X", routes: ["/nope"], preconditions: [] }], routePreconditions: {}, outOfScope: [], enabledModules: [] };
  const problems = validateOverlay(bad as any, generated);
  assert.ok(problems.some((p) => p.includes("/nope")));
});

test("generateBible runs the injected completer + validates", async () => {
  const fakeOverlay = { domains: [{ key: "ops", label: "Ops", routes: ["/modules/cooling"], preconditions: ["start a cycle"] }], routePreconditions: {}, outOfScope: [], enabledModules: ["cooling"] };
  const { overlay, problems } = await generateBible({
    rootDir: ".", cfg: { routing: "next-pages" }, generated,
    complete: async () => JSON.stringify(fakeOverlay),
  });
  assert.equal(problems.length, 0);
  assert.equal(overlay.domains[0].key, "ops");
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (bible-gen.ts missing).

- [ ] **Step 3: Implement `bible-gen.ts`** — the four exports above. `buildBiblePrompt`: a system prompt describing the standard bible (domains group routes for `/qa focus` + fan-out; preconditions are data/account setup notes; out-of-scope = hardware/camera/payment/etc.; enabledModules) and instructing strict JSON matching `QaOverlay`; the user message lists the routes (path/section/module), locales, pkg name, and any README/docs excerpt (truncated). `parseOverlay`: strip ```` ```json ```` fences, `JSON.parse`, assert the 4 keys + array/record types (throw on mismatch). `validateOverlay`: build a Set of generated route paths; collect every overlay-referenced path not in it + empty-domain checks. `generateBible`: read README + `cfg.docsForBible` files (best-effort, truncate), `buildBiblePrompt`, `await complete(prompt)`, `parseOverlay`, `validateOverlay`, return both.

- [ ] **Step 4: Run to verify it passes** — PASS (4 tests).

- [ ] **Step 5: Implement `gen-bible.ts` (the CLI wiring — no unit test; tsc-guarded)** — reads `gatekit.json` `qa` cfg + `qa-map.generated.json`; builds `complete` from `getClient()` (OpenRouter), calling `client.chat.completions.create({ model: cfg.bibleModel ?? "anthropic/claude-opus-4", messages:[{role:"system",content:system},{role:"user",content:user}], response_format:{type:"json_object"} })` and returning the text; calls `generateBible`; if `problems.length` → print them and exit 1 (don't write a broken bible); else owned-aware write: if `qa-map.overlay.ts` absent or `--force` → write it (serialize the overlay as a TS module `export const OVERLAY: QaOverlay = {…}` with the "owned, Opus-drafted, refine me" banner); else write `qa-map.overlay.draft.ts` + tell the user to merge. Support `--model <slug>`, `--force`, `--routes-only` (skip; just run gen-qa-map). Runnable via `npm run qa:gen-bible`.

- [ ] **Step 6: Verify tsc + tests + commit** — assemble-typecheck `gen-bible.ts` (it imports `./lib/bible-gen.js`, `./lib/openrouter.js`, `./lib/route-extract.js`); `npm test` green. `git commit -am "feat(qa): Opus overlay generator (bible-gen + gen-bible.ts)"`

---

### Task 5: Config block + owned overlay template + npm scripts

**Files:**
- Modify: `packages/cli/registry/qa/qa-map.overlay.ts` (NEW owned template) + `registry.json` (add it as `owned`, add the two scripts as managed)
- Modify: the registry sentinel `package.json` (`qa:gen-map` + `qa:gen-bible` scripts)
- Modify: `packages/cli/src/commands/init.ts` or docs — document the `gatekit.json` `qa` block default (no code change required if the block is purely consumer-authored; just ship a documented default in the docs + a commented stub in the overlay banner).

**Interfaces:** none new — wiring.

- [ ] **Step 1: Owned overlay template** — `packages/cli/registry/qa/qa-map.overlay.ts`: a minimal valid `QaOverlay` (empty domains/outOfScope/enabledModules, `routePreconditions:{}`) with the OWNED-FILE banner instructing the user to run `npm run qa:gen-bible` to draft it. Registry entry `type: "owned"`, dest `{sentinel}/src/lib/qa-map.overlay.ts`.
- [ ] **Step 2: npm scripts** — in the registry sentinel `package.json` add `"qa:gen-map": "tsx scripts/gen-qa-map.ts"` and `"qa:gen-bible": "tsx scripts/gen-bible.ts"`.
- [ ] **Step 3: registry.json** — add both `scripts/*.ts` as managed files, the overlay as owned; bump registry version.
- [ ] **Step 4: Verify** — registry-validate test passes (all `src` exist, dests resolve). `npm test` in packages/cli green.
- [ ] **Step 5: Commit** — `git commit -am "feat(qa): owned overlay template + qa:gen-map/qa:gen-bible scripts + config"`

---

### Task 6: CI freshness check (deterministic, no LLM)

**Files:** Modify `packages/cli/registry/qa/qa.yml` (add a freshness step) OR ship a `qa-map-freshness.yml`.

- [ ] **Step 1:** Add a job/step to the qa feature's workflow set: on `pull_request`, `npm ci` in the sentinel, run `npm run qa:gen-map`, then `git diff --exit-status -- '*qa-map.generated.json'` — fail if a route changed without regenerating. NO OpenRouter call (deterministic, free). Document that the overlay (owned) is validated at runtime by `mergeQaMap`'s drift throw.
- [ ] **Step 2:** Validate YAML (`python3 -c "import yaml;…"`). Commit `ci(qa): deterministic route-map freshness check`.

---

### Task 7: Docs — QA bible page + schema link

**Files:** Create `~/repo-harness/docs/src/content/docs/gates/qa-bible.md`; link it in the Starlight sidebar.

- [ ] **Step 1:** Write the page: the standard format (generated + overlay + merged `QaMap`, with the schema link), the routing strategies + the `gatekit.json` `qa` config block, the `qa:gen-map` / `qa:gen-bible` workflow (Opus default, `OPENROUTER_API_KEY`), the divide-and-conquer `/qa all` fan-out, and how to refine the owned overlay. Add to `astro.config.mjs` sidebar.
- [ ] **Step 2:** `cd docs && npm run build` → 0 broken links. Commit `docs: QA bible page`.

---

### Task 8: Registry validation + whole-feature verify

- [ ] **Step 1:** `cd packages/cli && npm test` (registry-validate + e2e) all green; the `qa` item's files all resolve.
- [ ] **Step 2:** Assemble-typecheck the registry sentinel (lib + qa.ts + scripts) → tsc 0; run its `node:test` suite (carried qa-map/qa-shard + new route-extract/bible-gen/schema tests) → all pass.
- [ ] **Step 3:** Dry-run the generator end-to-end with a STUBBED completer over a tiny fixture repo (no live LLM): confirm `extractRoutes` → `generateBible(stub)` → a valid overlay writes `qa-map.overlay.ts`.
- [ ] **Step 4:** Push `feat/qa-bible`; open a PR on `PaulCailly/gatekit` describing SP1. Do NOT merge without review.

---

## Self-Review notes (addressed inline)

- **Spec coverage:** format+schema (Task 2), portable extractor (Task 3), Opus generator (Task 4), config+owned overlay (Task 5), CI freshness (Task 6), consolidation (Task 1), docs (Task 7), verify (Task 8). All §2–§9 map to a task.
- **Testability:** the LLM is injected via `complete` (Task 4) so unit tests never call a model; extractors + validation + schema are pure-tested; runtime divide-and-conquer carried with its existing tests (Task 1).
- **Owned-never-clobbered:** the generator writes `.draft` unless `--force` (Task 4 Step 5); the overlay is `owned` in the registry (Task 5).
- **Type consistency:** `QaConfig`, `GeneratedFile`, `QaOverlay`, `extractRoutes`, `buildBiblePrompt`/`parseOverlay`/`validateOverlay`/`generateBible` names are used identically across Tasks 3–5.
- **Carried-over:** backresto's `qa-map.test.ts`/`qa-shard.test.ts` come with the consolidation (Task 1) and keep passing.
