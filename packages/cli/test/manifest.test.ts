import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest, writeManifest, sha, resolveDest } from "../src/manifest.ts";

test("sha is stable", () => {
  assert.equal(sha("a"), sha("a"));
  assert.notEqual(sha("a"), sha("b"));
});

test("resolveDest substitutes tokens", () => {
  const p = { scripts: "src/scripts", sentinel: ".github/sentinel" };
  assert.equal(resolveDest("{scripts}/health/index.mjs", p), "src/scripts/health/index.mjs");
  assert.equal(resolveDest("{sentinel}/src/review.ts", p), ".github/sentinel/src/review.ts");
});

test("round-trips a manifest", async () => {
  const d = await mkdtemp(join(tmpdir(), "rh-"));
  const m = {
    $schema: "x", version: "1.0.0", packageManager: "yarn",
    paths: { scripts: "scripts", sentinel: ".github/sentinel" },
    features: { quality: { enabled: true, mode: "report" as const } },
    installed: {},
  };
  writeManifest(d, m);
  assert.deepEqual(readManifest(d), m);
});

test("readManifest returns null when absent", async () => {
  const d = await mkdtemp(join(tmpdir(), "rh-"));
  assert.equal(readManifest(d), null);
});
