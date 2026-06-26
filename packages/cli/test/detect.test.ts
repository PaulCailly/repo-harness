import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect } from "../src/detect.ts";

async function tmp() { return mkdtemp(join(tmpdir(), "rh-")); }

test("detects yarn from yarn.lock", async () => {
  const d = await tmp();
  await writeFile(join(d, "yarn.lock"), "");
  assert.equal(detect(d).packageManager, "yarn");
});

test("detects pnpm from pnpm-lock.yaml", async () => {
  const d = await tmp();
  await writeFile(join(d, "pnpm-lock.yaml"), "");
  assert.equal(detect(d).packageManager, "pnpm");
});

test("defaults to npm and standard paths", async () => {
  const d = await tmp();
  const r = detect(d);
  assert.equal(r.packageManager, "npm");
  assert.deepEqual(r.paths, { scripts: "scripts", sentinel: ".github/sentinel" });
});
