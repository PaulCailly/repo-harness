# gatekit QA bible — adaptive, LLM-driven route detection

**Date:** 2026-06-28
**Status:** Design (approved)
**Repo:** gatekit (`PaulCailly/gatekit`, local `~/repo-harness`)
**Branch:** `feat/qa-adaptive-routing`

## 1. Problem & goal

The QA bible generator extracts a repo's routes deterministically by `routing`
strategy (`next-pages` | `next-app` | `glob`), then has Opus group those routes
into domains. `opus-infer` was the escape hatch for non-file-routed apps — but it
returns an **empty** route list (it only *groups* existing routes, it cannot
*find* them). Dogfooding on atlas (TanStack **code-defined** router in
`src/presentation/app/router.tsx`) exposed this: routes had to be hand-seeded.

**Goal:** make route extraction **framework-agnostic** via an Opus *stack-analysis*
pass that detects how routes are defined and drives extraction — preferring a
**reproducible deterministic** result, falling back to an LLM-derived list only
when the router is too irregular for a rule.

**Non-goals:** changing the divide-and-conquer runtime; a CI-side LLM call (CI
stays deterministic/free); a full AST parser (regex over router files suffices).

## 2. Model: `routing: "auto"` is a one-time bootstrap

`"auto"` signals "detection has not run yet." The LLM-using generator
(`qa:gen-bible`) runs stack-analysis once, **resolves** `"auto"` into a concrete
persisted config, and writes it back to `gatekit.json`. Every subsequent
`qa:gen-map` is then deterministic and free.

## 3. New deterministic strategy: `code-router`

For code-defined routers (TanStack, React Router) that are not file-routed.
Config shape (in `gatekit.json` `qa`):
```jsonc
{ "routing": "code-router",
  "routerFiles": ["src/presentation/app/router.tsx"],   // 1+ files
  "pathPattern": "path:\\s*['\"]([^'\"]+)['\"]",          // default; overridable
  "exclude": ["^/api", "^/auth", "/callback"] }            // optional path filters
```
Reads each router file, applies `pathPattern` (capture group 1 = route path),
drops paths matching any `exclude` regex, dedups, sorts. `section` = first path
segment (`/` → `"home"`); `module` = second segment under `modulePrefix` else
`null` (same rules as the other strategies). Deterministic → the CI freshness
gate works for `code-router`.

`QaConfig.routing` union gains `"code-router"` and `"auto"`. New optional fields:
`routerFiles?: string[]`, `pathPattern?: string`, `exclude?: string[]`.

## 4. Stack-analysis pass (`_lib/src/lib/stack-detect.ts`)

A new module, structured like `bible-gen.ts` (pure logic + an injected `complete`
seam so tests never call the network).

**Signal gathering** (`gatherStackSignals(repoRoot): StackSignals`):
- `package.json` `dependencies`+`devDependencies` (framework fingerprints:
  `next`, `@tanstack/react-router`, `react-router`/`react-router-dom`, `@remix-run/*`, …);
- a **shallow** file tree (top-level dirs + the contents of likely route
  locations: `app/`, `pages/`, `src/pages/`, `routes/`, `src/routes/`);
- the **text of candidate router files** found among:
  `src/**/router.{ts,tsx}`, `**/routes.{ts,tsx}`, `src/App.{tsx,jsx}`,
  `app/`, `pages/` (capped at the first **12** candidate files, **8 KB** each,
  to bound the prompt).

**Prompt + parse** (`buildDetectPrompt(signals)` / `parseDetection(raw)`): Opus
returns one JSON object (structured output / `response_format: json_object`):
```jsonc
{ "framework": "tanstack-router",
  "strategy": { "routing": "code-router", "routerFiles": ["..."],
                "pathPattern": "...", "exclude": ["..."] },   // OR null
  "routes": [ { "path": "/log", "section": "log", "module": null } ], // OR null
  "confidence": 0.0,
  "notes": "string" }
```
Exactly one of `strategy` / `routes` is non-null. `parseDetection` validates the
shape and (when `strategy`) that `routing` is a known strategy with sane params.

## 5. Resolve + persist (`resolveAuto`)

`resolveAuto(repoRoot, signals, detection, { runStrategy }) → ResolveResult`:
1. **strategy path:** run the detected deterministic strategy via the existing
   `extractRoutes(repoRoot, strategyConfig)`. If it yields ≥1 route → **accept**:
   return `{ routes, persist: strategyConfig }` (the concrete strategy to write
   into `gatekit.json`, replacing `"auto"`).
2. **fallback:** strategy yielded 0 routes, or `detection.routes` was returned
   directly → return `{ routes: detection.routes ?? [], persist: { routing: "opus-infer", ... } }`
   (so the no-op-preserve + freshness-skip path applies).
3. If both are empty → throw a clear error naming the candidate files inspected.

**Persistence** is performed by the script (§6), not the pure resolver: it rewrites
the `qa` block of `gatekit.json` to `persist` (merging, preserving unrelated keys
like `bibleModel`/`docsForBible`), and writes `routes` to `qa-map.generated.json`.

## 6. Invocation & integration

- **`qa:gen-bible`** (LLM flow, needs `OPENROUTER_API_KEY`): when `qa.routing ===
  "auto"`, run `gatherStackSignals` → `detect` (Opus) → `resolveAuto` → persist the
  resolved `qa` config + `generated.json` → log what was detected/persisted → then
  proceed to the existing route-grouping (domains) step. When routing is already
  concrete, behaves exactly as today.
- **`qa:gen-map`** (deterministic, free, CI freshness): if it sees an unresolved
  `routing: "auto"`, it does **not** call an LLM — it logs
  `"routing=auto not yet resolved — run qa:gen-bible first"` and no-ops (leaves the
  map untouched, like the opus-infer no-op). Once resolved to a concrete strategy,
  `gen-map` runs it deterministically.
- The `code-router` strategy is added to `extractRoutes`'s `switch` so both
  `gen-map` and `resolveAuto` share one extractor.

## 7. Error handling

- Detection LLM call fails / returns non-JSON / invalid shape → throw with the raw
  snippet; the script surfaces it and exits non-zero (nothing is written).
- Detected strategy resolves to 0 routes → automatic fallback to the LLM `routes`
  (logged); only errors if that is also empty.
- `gatekit.json` rewrite preserves unrelated keys and is validated before write;
  on any parse error the original file is left untouched.

## 8. Testing (node:test, LLM stubbed)

- **`code-router`** (`route-extract.test.ts`): fixture router file(s) → expected
  routes; `pathPattern` override; `exclude` filtering; multi-file dedup;
  `section`/`module` derivation; missing file → `[]`.
- **`stack-detect.test.ts`** (inject `complete`): `gatherStackSignals` picks up
  deps + router files from a fixture tree; `parseDetection` accepts a well-formed
  strategy and a well-formed routes list, and REJECTS malformed/both-null/both-set;
  `resolveAuto` — accepts a strategy that yields routes, falls back to `routes`
  when the strategy yields empty, throws when both empty; the `persist` config is
  the concrete strategy (strategy path) or `opus-infer` (fallback path).
- **persistence** (script-level or a small pure `mergeQaConfig` unit): `"auto"`
  rewritten to the concrete strategy, unrelated `qa` keys preserved.
- **Registry validation**: unchanged feature file list still resolves.

## 9. Documentation

qa-bible docs page gains: `routing: "auto"` (bootstrap), the `code-router`
strategy + its config, the detection→resolve→persist flow, and the note that
`auto` resolves itself to a concrete reviewable config on first `qa:gen-bible`.

## 10. Rollout

Ship in gatekit; bump registry version. Re-resolve atlas (`routing: "auto"` →
`code-router` on `router.tsx`), retiring the hand-seed + opus-infer-skip stopgap
and restoring a reproducible, freshness-checked map. monorepo (`next-app`) and
backresto (`next-pages`) are unaffected (already concrete).

## 11. Risks

- **Detection quality varies** → it only ever *proposes*; a deterministic strategy
  is accepted only if it actually yields routes, and the persisted config is
  human-reviewable. Fallback list is flagged LLM-derived (freshness-skipped).
- **Prompt size** for big repos → router-file gathering is capped (file count +
  per-file bytes); the tree is shallow.
- **Regex brittleness** in `code-router` → `pathPattern` + `exclude` are
  overridable in config; the default covers `path: "..."`-style literals.
