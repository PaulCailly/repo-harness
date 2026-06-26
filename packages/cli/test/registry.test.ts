import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadRegistry, readItemFile, resolveDeps } from "../src/registry.ts";

const ROOT = fileURLToPath(new URL("./fixtures/registry", import.meta.url));

test("loads registry.json", () => {
  assert.equal(loadRegistry(ROOT).version, "9.9.9");
});

test("reads an item file", () => {
  assert.match(readItemFile(ROOT, "demo/engine.mjs"), /engine = "v1"/);
});

test("resolveDeps puts deps before dependents", () => {
  const reg = loadRegistry(ROOT);
  assert.deepEqual(resolveDeps(reg, ["needsdemo"]), ["demo", "needsdemo"]);
});

test("resolveDeps throws on unknown", () => {
  const reg = loadRegistry(ROOT);
  assert.throws(() => resolveDeps(reg, ["nope"]), /unknown feature/i);
});
