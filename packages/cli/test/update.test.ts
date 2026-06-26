// packages/cli/test/update.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../src/commands/update.ts";
import { loadRegistry } from "../src/registry.ts";
import { sha } from "../src/manifest.ts";

const ROOT = fileURLToPath(new URL("./fixtures/registry", import.meta.url));
const PATHS = { scripts: "scripts", sentinel: ".github/sentinel" };

test("classify flags a locally-modified managed file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "rh-"));
  await mkdir(join(cwd, "scripts/demo"), { recursive: true });
  await writeFile(join(cwd, "scripts/demo/engine.mjs"), "EDITED BY USER");
  const reg = loadRegistry(ROOT);
  const manifest: any = {
    paths: PATHS,
    installed: { "scripts/demo/engine.mjs": { sha: sha("export const engine = \"v0\";"), type: "managed", version: "0" } },
  };
  const rows = classify(ROOT, cwd, manifest, reg);
  const row = rows.find((r) => r.dest === "scripts/demo/engine.mjs")!;
  assert.equal(row.state, "locally-modified");
});
