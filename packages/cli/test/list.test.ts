import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import list from "../src/commands/list.ts";
import { writeManifest } from "../src/manifest.ts";

const ROOT = fileURLToPath(new URL("./fixtures/registry", import.meta.url));

test("list returns 0 and runs against a manifest", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "rh-"));
  writeManifest(cwd, {
    $schema: "x", version: "9.9.9", packageManager: "npm",
    paths: { scripts: "scripts", sentinel: ".github/sentinel" },
    features: { demo: { enabled: true, mode: "report" } }, installed: {},
  });
  const prev = process.cwd(); process.chdir(cwd);
  try { process.env.REPO_HARNESS_ROOT = ROOT; assert.equal(await list([]), 0); }
  finally { process.chdir(prev); delete process.env.REPO_HARNESS_ROOT; }
});
