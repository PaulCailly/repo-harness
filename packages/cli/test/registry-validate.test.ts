import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, resolveDeps } from "../src/registry.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // packages/cli

test("every registry file src exists on disk", () => {
  const reg = loadRegistry(ROOT);
  for (const [name, item] of Object.entries(reg.items)) {
    for (const f of [...item.files, ...(item.workflows ?? [])]) {
      assert.ok(existsSync(join(ROOT, "registry", f.src)), `${name}: missing ${f.src}`);
      assert.match(f.dest, /^(\{scripts\}|\{sentinel\}|\.github)\//, `${name}: bad dest ${f.dest}`);
      assert.ok(["managed", "owned"].includes(f.type), `${name}: bad type`);
    }
  }
});

test("dependency graph resolves for every feature", () => {
  const reg = loadRegistry(ROOT);
  for (const name of Object.keys(reg.items)) {
    assert.doesNotThrow(() => resolveDeps(reg, [name]));
  }
});

test("expected features are present", () => {
  const reg = loadRegistry(ROOT);
  for (const f of ["quality", "compliance", "review", "debate", "qa", "release-notes", "_lib"])
    assert.ok(f in reg.items, `missing ${f}`);
});
