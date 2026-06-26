import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.ts";

test("--version returns 0", async () => {
  assert.equal(await run(["--version"]), 0);
});

test("unknown command prints usage and returns 0", async () => {
  assert.equal(await run(["wat"]), 0);
});
