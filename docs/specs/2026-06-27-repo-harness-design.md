# repo-harness — Design Spec

**Date:** 2026-06-27
**Status:** Draft for review
**Author:** Paul Cailly (with Claude)

## 1. Overview

`repo-harness` is a **shadcn-style toolkit for repo quality & compliance gates**.
Today the gate tooling (code-health analyzer, privacy/compliance analyzer, and the
OpenRouter/Gemini PR bots `/review` `/debate` `/qa` `/compliance`) lives inline in
each repo (`atlas`, `featers/monorepo`) and is copy-pasted between them. That copy
drifts. `repo-harness` extracts that tooling **once** into a public registry and
ships a CLI that vendors it into consumer repos (you own the files, like shadcn
components) while keeping the shared *engine* code updatable.

Two halves of the value, mirroring shadcn:
- **Registry + CLI** — `npx repo-harness add compliance` copies a gate's files into
  your repo and records them in a `repo-harness.json` manifest.
- **Docs site** — a public Astro Starlight site (GitHub Pages) documenting each gate,
  the CLI, and how to author a repo's compliance policy.

### Goals
- Single source of truth for the quality + compliance gate tooling.
- Consumers **own** their policy/config files (per-repo data) but can **update** the
  shared engine via the CLI without clobbering owned edits.
- A `repo-harness.json` config JSON toggles features on/off and sets `report` vs
  `block` enforcement per feature.
- Public, no-token consumption (lives under `PaulCailly`, public).
- Proven by rolling out to `featers/monorepo` and the `featers/backresto` main app.

### Non-goals
- Not a hosted service. No runtime/server component. CLI + static docs only.
- Not a general lint/test runner — it wires *gates*, it doesn't replace eslint/jest.
- Not auto-merge / PR automation (that's the separate `release-manager` plugin).

## 2. Source material (what we extract)

From `atlas` (the upstream source of the tooling):

| Source | Kind | Becomes registry item |
|---|---|---|
| `scripts/health/{index,analyze,config}.mjs` | zero-dep Node engine | `quality` |
| `scripts/compliance/{index,analyze,config,controls}.mjs` | zero-dep Node engine | `compliance` |
| `.github/sentinel/src/quality-report.ts` | TS report (sticky PR comment) | `quality` |
| `.github/sentinel/src/compliance-report.ts` + `compliance-review.ts` | TS report + `/compliance` audit | `compliance` |
| `.github/sentinel/src/review.ts` | `/review` bot | `review` |
| `.github/sentinel/src/debate.ts` | `/debate` bot | `debate` |
| `.github/sentinel/src/qa.ts` | `/qa` bot | `qa` |
| `.github/sentinel/src/release-notes.ts` | release notes | `release-notes` |
| `.github/sentinel/src/lib/**` | shared lib (openrouter, gemini, gh, diff, markdown, browser, qa-*, reactions, recorder, metrics, types) | `_lib` (auto-dep) |
| `.github/workflows/{ci,compliance-gate,compliance,code-review,debate,qa,release}.yml` | workflow templates | per feature |

**Engine vs policy split (critical):** the analyzer *engines* (`index.mjs`,
`analyze.mjs`) are generic and identical across repos — these are **managed**
(updatable). The *policy* (`config.mjs`, `controls.mjs`) is per-repo data describing
that repo's data flows — these are **owned** (scaffolded once, never overwritten).
`featers/monorepo` already proved this: it ported the engine unchanged and wrote its
own `config.mjs`/`controls.mjs`.

## 3. Repository layout (`PaulCailly/repo-harness`, public)

```
repo-harness/
  packages/cli/              # npm package `repo-harness` (TS → JS, no framework)
    src/
      index.ts               # argv dispatch: init|add|update|diff|list|remove
      commands/*.ts
      registry.ts            # loads bundled registry.json + files
      manifest.ts            # read/write consumer repo-harness.json
      detect.ts              # package-manager + paths detection
    dist/                    # built JS (published)
    package.json
  registry/                  # SOURCE OF TRUTH for every gate ("component")
    quality/
    compliance/
    review/  debate/  qa/  release-notes/
    _lib/                    # shared sentinel lib
  registry.json              # manifest: items → files (managed|owned) + deps + workflow
  docs/                      # Astro Starlight site (GitHub Pages)
  .github/workflows/
    ci.yml                   # build + test the CLI, validate registry
    docs.yml                 # build + deploy Starlight to Pages
    release.yml              # tag → npm publish + GitHub release
```

The registry is **bundled inside the npm package** at build time, so `add`/`update`
read files from the installed package (pinned to its version) — no network/git fetch.
The package version IS the registry version.

## 4. Registry format (`registry.json`)

```jsonc
{
  "version": "1.0.0",
  "items": {
    "compliance": {
      "description": "Privacy & compliance gate (egress/secret/telemetry) + /compliance audit",
      "dependsOn": ["_lib"],
      "files": [
        { "src": "compliance/index.mjs",     "dest": "{scripts}/compliance/index.mjs",     "type": "managed" },
        { "src": "compliance/analyze.mjs",    "dest": "{scripts}/compliance/analyze.mjs",    "type": "managed" },
        { "src": "compliance/config.mjs",     "dest": "{scripts}/compliance/config.mjs",     "type": "owned" },
        { "src": "compliance/controls.mjs",   "dest": "{scripts}/compliance/controls.mjs",   "type": "owned" },
        { "src": "compliance/compliance-report.ts",  "dest": "{sentinel}/src/compliance-report.ts",  "type": "managed" },
        { "src": "compliance/compliance-review.ts",  "dest": "{sentinel}/src/compliance-review.ts",  "type": "managed" }
      ],
      "workflows": [
        { "src": "compliance/compliance-gate.yml", "dest": ".github/workflows/compliance-gate.yml", "type": "managed", "mode": "gate" },
        { "src": "compliance/compliance.yml",      "dest": ".github/workflows/compliance.yml",      "type": "managed" }
      ],
      "scripts": { "compliance": "node {scripts}/compliance/index.mjs" },
      "secrets": ["OPENROUTER_API_KEY"]
    }
    // quality, review, debate, qa, release-notes, _lib …
  }
}
```

- `{scripts}` / `{sentinel}` are path tokens resolved from the consumer's
  `repo-harness.json` `paths`.
- `type: managed` → engine/bot code, overwritten on `update`.
- `type: owned` → policy/config, scaffolded from a template once, never overwritten.
- `secrets` is informational — surfaced post-`add` ("set these repo secrets").

## 5. Consumer config (`repo-harness.json`)

Written by `init`, the analogue of shadcn's `components.json`.

```jsonc
{
  "$schema": "https://paulcailly.github.io/repo-harness/schema.json",
  "version": "1.0.0",                 // registry version last synced
  "packageManager": "yarn",           // detected: yarn|pnpm|npm
  "paths": { "scripts": "scripts", "sentinel": ".github/sentinel" },
  "features": {
    "quality":    { "enabled": true,  "mode": "report" },
    "compliance": { "enabled": true,  "mode": "report" },
    "review":     { "enabled": true },
    "debate":     { "enabled": false },
    "qa":         { "enabled": false }
  },
  "installed": {                       // per-file tracking for update/drift
    "{scripts}/compliance/index.mjs": { "sha": "abc123…", "type": "managed", "version": "1.0.0" },
    "{scripts}/compliance/config.mjs": { "sha": "def456…", "type": "owned",   "version": "1.0.0" }
  }
}
```

- `mode: report` → the gate workflow runs the engine with `--no-fail` (scored, sticky
  PR comment, never blocks). `mode: block` → drops `--no-fail` so a `violation` fails
  the check. Default `report` for every gate (flip per repo when the policy beds in).
- `installed[].sha` is the upstream file's sha **at install time** — the basis for
  drift detection in `update`/`diff`.

## 6. CLI commands

All commands operate on the cwd repo's `repo-harness.json`.

- **`init`** — detect package manager + sensible `paths`; write a default
  `repo-harness.json` with all features disabled. Idempotent.
- **`add <feature…>`** — resolve `dependsOn` (e.g. pulls `_lib`); for each file: copy
  `managed` verbatim; for `owned`, write the template **only if absent** (never
  clobber an existing policy). Drop workflows (mode-aware). Record each file in
  `installed`. Set `features[x].enabled=true`. Print follow-ups (secrets to set, the
  `compliance config.mjs` to fill in, sentinel `npm ci`).
- **`update [feature…]`** — for each `managed` file: if consumer sha == recorded sha
  (unedited), overwrite with the new upstream version and bump recorded sha/version;
  if consumer edited it (sha mismatch), **don't clobber** — report a conflict and
  emit the upstream version to `*.harness-new` for hand-merge. For `owned` files:
  never write; note when upstream template changed so the user can diff.
- **`diff [feature…]`** — dry-run `update`: show, per file, `up-to-date | update
  available | locally modified | owned-drift`. No writes.
- **`list`** — table of features: enabled, mode, synced version, drift summary.
- **`remove <feature>`** — delete the feature's `managed` files + workflows, leave
  `owned` policy in place (with a warning), set `enabled=false`.

Implementation: TypeScript compiled to JS, published to npm; runnable as
`npx repo-harness@latest`. Arg parsing via a tiny hand-rolled dispatcher or
`commander` (no Ink/TUI). Engines stay zero-dep `.mjs` — vendored, directly runnable
by Node; the CLI never needs to execute them.

## 7. Features catalogue

| Feature | Managed (updatable) | Owned (scaffolded) | Workflow(s) | Secrets |
|---|---|---|---|---|
| `quality` | health `index/analyze.mjs`, `quality-report.ts`, `_lib` | health `config.mjs` (thresholds) | `quality-gate.yml` (or fold into existing CI) | — |
| `compliance` | compliance `index/analyze.mjs`, `compliance-report.ts`, `compliance-review.ts`, `_lib` | `config.mjs`, `controls.mjs` | `compliance-gate.yml`, `compliance.yml` | `OPENROUTER_API_KEY` |
| `review` | `review.ts`, `_lib` | — | `code-review.yml` | `OPENROUTER_API_KEY` |
| `debate` | `debate.ts`, `_lib` | — | `debate.yml` | `OPENROUTER_API_KEY` |
| `qa` | `qa.ts`, `_lib` | `QA-MEMORY.md` (per-repo) | `qa.yml` | `GEMINI_API_KEY` (+ app creds) |
| `release-notes` | `release-notes.ts`, `_lib` | — | `release.yml` | — |
| `_lib` | all of `sentinel/src/lib/**` + `sentinel/package.json` + `tsconfig.json` | — | — | — |

`_lib` is never added directly; it's pulled in as a dependency of any bot feature and
its files are managed. The sentinel `package.json` is treated as managed but merged
(deps unioned) rather than overwritten when the consumer already has one.

## 8. Documentation site (Astro Starlight → GitHub Pages)

- `docs/` Astro Starlight project; `docs.yml` builds and deploys to GitHub Pages on
  push to `main`. Public URL `https://paulcailly.github.io/repo-harness/`.
- Content:
  - **Intro / why** — the copy-paste-drift problem, the shadcn model.
  - **CLI reference** — `init`, `add`, `update`, `diff`, `list`, `remove`.
  - **One page per gate** — what it checks, the report it posts, its config schema,
    `mode` semantics, required secrets, copy-paste install block (`npx repo-harness
    add <feature>`).
  - **Compliance policy authoring guide** — how to write `config.mjs` (egress
    allowlist, server-only secrets, telemetry seam, structural checks) and
    `controls.mjs` (GDPR/ISO control register) for a new repo, using atlas + monorepo
    as worked examples.
  - **`repo-harness.json` schema reference** (also served as `schema.json` for the
    `$schema` link).

## 9. Versioning & release

- Semver on the npm package == registry version. `release.yml`: on a `v*` tag, build
  the CLI, `npm publish`, create a GitHub release. The bundled registry ships in the
  tarball, so a given CLI version always installs a matching registry.
- Consumers pin nothing in code — `npx repo-harness@latest update` pulls the newest
  engines; `repo-harness.json.version` records what they're synced to.

## 10. Testing strategy

- **CLI unit tests** (node:test + tsx): `add` into a temp dir produces the right files
  with correct manifest; `add` never clobbers an existing owned file; `update`
  overwrites unedited managed files and refuses edited ones (`.harness-new` emitted);
  `diff` classifies up-to-date / update-available / locally-modified / owned-drift;
  `remove` deletes managed but keeps owned; package-manager detection.
- **Registry validation test** (runs in `ci.yml`): every `registry.json` file `src`
  exists; every `dest` token resolves; `dependsOn` graph is acyclic; the extracted
  engine files still pass their own ported `analyze.test.mjs`.
- **Golden end-to-end**: `add quality compliance review` into a fixture repo, assert
  the tree matches a snapshot.
- The extracted engines keep atlas's existing `analyze.test.mjs` suites verbatim.

## 11. Rollout (acceptance)

1. **Build repo-harness** — registry extraction + CLI + docs + tests green.
2. **`featers/monorepo`** — already has an in-tree compliance port. Run `init`, then
   reconcile: register its existing `config.mjs`/`controls.mjs` as `owned` files (no
   overwrite), register the engine as `managed`, and `add quality` (the missing
   health gate). Verify its existing `compliance-gate.yml`/`compliance.yml` match the
   harness templates (or adopt them). Keep `report` mode.
3. **`featers/backresto` main app** (yarn + Next + Amplify + jest/cypress) — `init`
   then `add quality compliance review`. Author the **real adapted compliance
   policy**: investigate actual data flows — AWS Amplify/AppSync (IAM auth,
   `eu-west-3`), Sentry, Resend, OpenRouter (sentinel), blulog consumer, Brother print
   (`capacitor-brotherprint`) — and write `config.mjs` (egress allowlist + server-only
   secrets + telemetry seam) and `controls.mjs` (GDPR register). All gates `report`
   mode first; flip to `block` once clean.
4. Both repos: set `OPENROUTER_API_KEY` (and `GEMINI_API_KEY` if `qa`) secrets;
   confirm sticky PR comments render on a test PR.

## 12. Risks / open questions

- **Sentinel package.json merge** — consumers may already have a `.github/sentinel`
  with their own deps. `update` must union deps, not overwrite. (Both target repos
  already have sentinel installed — treat first sync as a reconcile, not a fresh add.)
- **Main app stack mismatch** — atlas's `quality` gate assumes vitest coverage + knip
  + an ESM guard; the main app uses jest + cypress + yarn and no knip. The `quality`
  feature must ship only the *stack-agnostic* health analyzer + report by default;
  coverage-threshold wiring is opt-in and adapted per repo, not assumed.
- **Path tokens** — repos differ (`scripts/` vs `src/scripts/`); `init` detection plus
  editable `paths` in `repo-harness.json` cover this.
- **Public exposure** — the registry (engines, policy *schema*, control-register
  structure) is public; actual per-repo policies live in the (private) consumer repos,
  so no secrets or private data-flow details are published.
