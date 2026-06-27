# gatekit

Versioned quality & compliance gates for your repos — shadcn-style: own your policy, sync the engine.

[![CI](https://github.com/PaulCailly/gatekit/actions/workflows/ci.yml/badge.svg)](https://github.com/PaulCailly/gatekit/actions/workflows/ci.yml) ![coverage](./.github/badges/coverage.svg) ![code health](./.github/badges/quality.svg) [![docs](https://img.shields.io/badge/docs-gatekit-blue)](https://paulcailly.github.io/gatekit/)

gatekit vendors versioned quality (code-health) and compliance (privacy/egress/secret) gates plus PR bots (`/review`, `/debate`, `/qa`) directly into your repo — no hidden package boundary. Every gate splits into a **managed engine** (workflows and scripts, kept in sync via `gatekit update`) and an **owned policy** (`compliance/config.mjs` and `controls.mjs`, scaffolded once and never clobbered). Default gate mode is `report` (non-blocking), so you can adopt incrementally.

## Quickstart

```bash
# Initialise the manifest
npx gatekit init

# Add quality and compliance gates
npx gatekit add quality compliance

# Re-sync managed engines any time (owned policy is untouched)
npx gatekit update
```

## What you get

- **Quality gate** — cyclomatic complexity, LOC, nesting, params, duplication; sticky PR report
- **Compliance gate** — un-allowlisted egress, server secrets in client, hardcoded credentials, telemetry seam; `/compliance` LLM audit
- **PR bots** — `/review`, `/debate`, `/qa` (with persistent QA memory), `release-notes`
- **Managed / owned split** — engine code is updatable; your policy (`config.mjs`, `controls.mjs`) is yours forever
- **`report` / `block` modes** — annotate-only by default; opt into blocking per gate

## Commands

- `init` — create `gatekit.json` manifest, detect package manager
- `add <feature…>` — vendor gates into `.github/` and `scripts/`; scaffold owned policy stubs
- `update [feature…]` — pull latest managed engines; skip locally-edited files (places `.harness-new` instead)
- `diff [feature…]` — unified diff between installed and registry versions; exit 1 if out of date
- `list` — show installed features, modes, and file counts
- `remove <feature>` — delete managed files; leave owned policy in place

Full docs: https://paulcailly.github.io/gatekit/

> gatekit dogfoods its own quality gate — the code health badge above is gatekit measuring itself.
