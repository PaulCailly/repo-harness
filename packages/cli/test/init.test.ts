// packages/cli/test/init.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import init from "../src/commands/init.ts";
import { readManifest } from "../src/manifest.ts";

async function inDir(fn: () => Promise<void>) {
  const d = await mkdtemp(join(tmpdir(), "rh-"));
  const prev = process.cwd();
  process.chdir(d);
  try { await fn(); } finally { process.chdir(prev); }
  return d;
}

test("init writes a manifest with features disabled", async () => {
  await inDir(async () => {
    await writeFile("yarn.lock", "");
    assert.equal(await init([]), 0);
    const m = readManifest(process.cwd())!;
    assert.equal(m.packageManager, "yarn");
    assert.equal(typeof m.features, "object");
  });
});

test("init is idempotent — returns 0 without overwriting", async () => {
  await inDir(async () => {
    await writeFile("yarn.lock", "");
    assert.equal(await init([]), 0);
    const first = readManifest(process.cwd())!;
    // Run again — should print notice and return 0
    assert.equal(await init([]), 0);
    const second = readManifest(process.cwd())!;
    assert.deepEqual(first, second);
  });
});
