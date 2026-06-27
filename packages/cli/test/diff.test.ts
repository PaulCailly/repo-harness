import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import diff from "../src/commands/diff.ts";
import { writeManifest, sha } from "../src/manifest.ts";

const ROOT = fileURLToPath(new URL("./fixtures/registry", import.meta.url));

test("diff returns 2 when an engine update is available", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "rh-"));
  await mkdir(join(cwd, "scripts/demo"), { recursive: true });
  // On-disk file equals recorded sha (unedited) but recorded sha is stale vs upstream.
  await writeFile(join(cwd, "scripts/demo/engine.mjs"), "OLD");
  writeManifest(cwd, {
    $schema: "x", version: "0", packageManager: "npm",
    paths: { scripts: "scripts", sentinel: ".github/sentinel" },
    features: {}, installed: { "scripts/demo/engine.mjs": { sha: sha("OLD"), type: "managed", version: "0" } },
  });
  const prev = process.cwd(); process.chdir(cwd);
  try {
    process.env.GATEKIT_ROOT = ROOT; // diff honors override for tests
    assert.equal(await diff([]), 2);
  } finally { process.chdir(prev); delete process.env.GATEKIT_ROOT; }
});
