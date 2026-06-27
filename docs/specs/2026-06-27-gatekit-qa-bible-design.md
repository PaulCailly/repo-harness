# gatekit QA bible — standard format + Opus generator + qa consolidation

**Date:** 2026-06-27
**Status:** Design (decisions pre-approved)
**Repo:** gatekit (`PaulCailly/gatekit`, local `~/repo-harness`)
**Scope:** Sub-project 1 of 3 (foundational). SP2 = reconcile the rest of the managed
layer; SP3 = redeploy identically to atlas/monorepo/backresto. Both follow this.

## 1. Problem & goal

backresto's exploratory-QA system — a generated route-map + a hand-authored semantic
**overlay** (domains, preconditions, out-of-scope, enabled modules) feeding a
divide-and-conquer `/qa all` fan-out — is the winning approach, but it is *coupled to
backresto*: its route scanner is Next-pages-specific and its overlay was hand-written
from backresto's feature catalog. Goal: **standardize the winning approach as a
portable, documented gatekit capability** — a standard bible format, a pluggable route
extractor, and an **OpenRouter-Opus-powered overlay generator** — so any repo can
produce its own bible (respecting its specifics) and run the same divide-and-conquer
QA. Plus consolidate backresto's qa engine into the gatekit registry as the canonical
managed `qa`.

**Non-goals (SP1):** the SP3 rollout itself; changing the divide-and-conquer runtime
(carried as-is); a CI-side LLM generator (CI stays deterministic/free).

## 2. The standard bible format (documented)

Two source artifacts merge into one runtime `QaMap` (backresto's proven split, now
formalized + schema'd):

1. **`qa-map.generated.json`** — produced by the deterministic route extractor;
   refreshable; freshness-gated in CI. Shape:
   ```jsonc
   { "generatedAt": null,
     "locales": ["en", "fr", …],            // [] when the app isn't localized
     "routes": [{ "path": "/modules/cooling", "section": "modules", "module": "cooling" | null }] }
   ```
2. **Overlay** (`qa-map.overlay.ts`, OWNED) — the semantic layer Opus drafts and a human
   refines:
   ```ts
   export const OVERLAY: QaOverlay = {
     domains: [{ key, label, routes: string[], preconditions: string[] }],
     routePreconditions: { [path: string]: string[] },
     outOfScope: string[],
     enabledModules: string[],
   };
   ```
3. **Merge → `QaMap`** (existing `qa-map.ts`): every overlay `routes`/`outOfScope`/
   `routePreconditions` key MUST be a real route in `generated.json` (merge throws on
   drift — catches a stale overlay).

A JSON Schema for `qa-map.generated.json` ships at `docs/public/qa-map.schema.json`
(served on the docs site); the overlay's `QaOverlay` TS type IS its contract. Both are
documented on a new docs page (§6).

## 3. Portable route extractor (deterministic — the "generated" half)

A config-driven extractor (managed sentinel script `scripts/gen-qa-map.ts`,
generalized from backresto's) that emits `qa-map.generated.json`. Routing style + dirs
come from the consumer's gatekit QA config (§5). Shipped strategies:

- **`next-pages`** — scan `<pagesDir>/[locale]/**` (backresto's existing logic).
- **`next-app`** — scan `<appDir>/**/page.{tsx,jsx}` → route paths.
- **`glob`** — a configurable glob (e.g. `src/**/*.screen.tsx`) + a path-derivation
  rule, for non-file-routed apps (atlas-style). 
- **`opus-infer`** — fallback: when no deterministic strategy fits, the Opus step (§4)
  also proposes the route list from source; flagged in output as LLM-derived so a human
  verifies. Used only when `routing: "opus-infer"` is set.

`section` = first path segment; `module` = second segment under a configured
module-prefix (e.g. `/modules/<module>`), else `null`. Locales from a configured
`localesDir` or `[]`.

## 4. Opus overlay generator (the semantic half — the new capability)

A managed sentinel script `scripts/gen-bible.ts` that drafts the overlay via OpenRouter
**Opus** (default), reusing the sentinel's existing `lib/openrouter.ts` +
`OPENROUTER_API_KEY`. Flow:

1. **Gather context:** the just-extracted `qa-map.generated.json` routes; the repo's
   README; any human-pointed bible/feature docs (config `docsForBible: [...]`); the
   route paths + sections; optionally `package.json` name/description.
2. **Prompt Opus** (default model `anthropic/claude-opus-4.x` via OpenRouter, overridable
   by config `bibleModel`) with a **documented, standardized prompt** that asks it to
   group the routes into coherent **domains** (for `/qa focus <domain>` and per-domain
   fan-out), write per-domain + per-route **preconditions** (data/account setup so the
   agent doesn't read empty/gated state as broken), mark **out-of-scope** routes
   (hardware/camera/payment/etc.), and list **enabled modules** — emitting a single JSON
   object matching `QaOverlay`. The model is forced to return JSON (structured output);
   the script validates it against the `QaOverlay` shape AND against the generated
   routes (every referenced path must exist) before writing.
3. **Write (owned-aware):** if no overlay exists → write `qa-map.overlay.ts` (with a
   banner: "Opus-drafted; review & refine — this is your owned bible"). If one already
   exists → write `qa-map.overlay.draft.ts` instead and tell the human to merge (never
   clobber a refined owned overlay). `--force` overwrites.

**Determinism/safety:** the LLM output is validated + route-checked before write; a
malformed/hallucinated overlay is rejected with a clear error, never written.

## 5. Config (owned, in `gatekit.json`)

A `qa` block the consumer owns:
```jsonc
"qa": {
  "routing": "next-pages",                 // next-pages | next-app | glob | opus-infer
  "pagesDir": "src/pages", "appDir": "app", "glob": null,
  "localesDir": "public/locales",          // or null
  "modulePrefix": "/modules",              // for module derivation, or null
  "bibleModel": "anthropic/claude-opus-4.x",  // OpenRouter slug; Opus default
  "docsForBible": ["docs/bible/02-feature-catalog.md"]  // optional human context
}
```

## 6. CLI / invocation + CI freshness

- **`npm run qa:gen-map`** (managed, exists) — deterministic route refresh → `generated.json`. Free, no LLM.
- **`npm run qa:gen-bible`** (new, managed) — runs the Opus overlay generator. Human runs on demand, reviews, commits. Flags: `--force`, `--model <slug>`, `--routes-only` (skip LLM).
- **CI freshness check** (existing pattern, generalized): a deterministic CI step re-runs
  the route extractor and fails if `generated.json` is stale (a route added without
  regenerating) — **no LLM in CI**. The overlay is NOT auto-checked (it's owned), but the
  merge's route-validation (which runs in the qa job) catches an overlay referencing a
  dropped route.

## 7. qa engine consolidation (into the gatekit registry)

Upstream backresto's qa system as the canonical managed `qa` feature, replacing the
older atlas-derived qa in the registry:
- Managed: `qa.ts` (divide-and-conquer fan-out), `lib/qa-core.ts`, `lib/qa-map.ts`,
  `lib/qa-memory.ts`, `lib/qa-shard.ts`, the enhanced shared `lib/*` (browser/recorder/
  openrouter/etc.), `scripts/gen-qa-map.ts` + `scripts/gen-bible.ts`, and the fan-out
  `qa.yml` (gate→shard matrix→aggregate).
- Owned (scaffolded/generated, per-repo): `qa-map.overlay.ts`, `qa-map.generated.json`,
  `QA-MEMORY.md`, the `gatekit.json` `qa` config block.
- The `qa` feature's `secrets` already include `GEMINI_API_KEY`/`OPENROUTER_API_KEY`/
  `BLOB_*`; add nothing new (the bible generator reuses `OPENROUTER_API_KEY`).

## 8. Documentation

A new docs page "QA bible" on the gatekit site: the standard format (generated +
overlay + merged schema), the routing strategies + config, the `qa:gen-map` /
`qa:gen-bible` workflow, the Opus prompt contract, and how to refine the owned overlay.
Plus the JSON Schema at `docs/public/qa-map.schema.json`.

## 9. Testing

- **Route extractor** (unit, node:test): each strategy (`next-pages`, `next-app`,
  `glob`) over a fixture tree → expected `generated.json`; `section`/`module` derivation;
  empty/locale handling.
- **Overlay generator** (unit): prompt assembly from a fixture context; output
  validation accepts a well-formed `QaOverlay` and REJECTS one referencing a nonexistent
  route or with a malformed shape (the LLM call itself is stubbed — test the
  assemble/validate/write logic, not the model).
- **Merge** (existing tests carried): overlay-vs-generated drift throws.
- **Divide-and-conquer** (existing backresto tests carried verbatim): `mergeShards`,
  `buildAggregateReport`, etc.
- **Registry validation**: the consolidated `qa` feature's files exist + dest tokens
  resolve.

## 10. Rollout (SP3, summarized — its own spec)

For each of atlas / monorepo / backresto: `gatekit update` (sync the canonical managed
qa + lib + workflows), add the `qa` config block, run `qa:gen-map` (deterministic
routes for that repo's routing style) + `qa:gen-bible` (Opus drafts the overlay),
human-refine the overlay, commit to the existing `chore/adopt-gatekit` branch (updates
the 3 PRs). backresto keeps its already-refined overlay; atlas + monorepo get
Opus-drafted ones to refine.

## 11. Risks

- **Opus overlay quality varies** → it's a *draft* a human refines (owned), never
  trusted blind; route-validated before write.
- **Route extraction for non-file-routed apps** (atlas) → the `glob` strategy +
  `opus-infer` fallback cover it, but atlas may need a tuned glob; flagged per-repo in SP3.
- **LLM cost** → generator is on-demand/local only; CI stays deterministic.
- **Engine swap** (atlas-derived qa → backresto's) is a bigger managed-file change than a
  normal update → SP3 treats it as a reconcile, and consumers' qa was either absent
  (atlas/monorepo unaffected) or backresto's own (identical).
