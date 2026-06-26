// packages/cli/test/e2e.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import init from "../src/commands/init.ts";
import add from "../src/commands/add.ts";
import { readManifest } from "../src/manifest.ts";

test("init + add quality compliance produces the expected tree", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "rh-e2e-"));
  const prev = process.cwd(); process.chdir(cwd);
  try {
    await writeFile("yarn.lock", "");
    assert.equal(await init([]), 0);
    assert.equal(await add(["quality", "compliance"]), 0);
    for (const f of [
      "scripts/health/index.mjs", "scripts/health/config.mjs",
      "scripts/compliance/index.mjs", "scripts/compliance/config.mjs",
      ".github/sentinel/src/quality-report.ts",
      ".github/workflows/quality-gate.yml", ".github/workflows/compliance-gate.yml",
      ".github/sentinel/src/lib/openrouter.ts", // pulled via _lib
    ]) assert.ok(existsSync(join(cwd, f)), `missing ${f}`);
    const m = readManifest(cwd)!;
    assert.equal(m.features.compliance.enabled, true);
    assert.equal(m.installed["scripts/compliance/config.mjs"].type, "owned");
  } finally { process.chdir(prev); }
});
