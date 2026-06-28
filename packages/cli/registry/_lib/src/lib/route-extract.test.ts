import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRoutes } from "./route-extract.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "rx-"));
}

test("next-pages: locale-prefixed pages → routes, module derived", () => {
  const d = tmp();
  mkdirSync(join(d, "src/pages/[locale]/modules/cooling"), { recursive: true });
  writeFileSync(join(d, "src/pages/[locale]/modules/cooling/index.tsx"), "x");
  writeFileSync(join(d, "src/pages/[locale]/home.tsx"), "x");
  const r = extractRoutes(d, { routing: "next-pages", pagesDir: "src/pages", modulePrefix: "/modules" });
  const paths = r.routes.map((x) => x.path).sort();
  assert.deepEqual(paths, ["/home", "/modules/cooling"]);
  assert.equal(r.routes.find((x) => x.path === "/modules/cooling")!.module, "cooling");
});

test("next-app: page.tsx dirs → routes", () => {
  const d = tmp();
  mkdirSync(join(d, "app/blog/[slug]"), { recursive: true });
  writeFileSync(join(d, "app/blog/[slug]/page.tsx"), "x");
  writeFileSync(join(d, "app/page.tsx"), "x");
  const r = extractRoutes(d, { routing: "next-app", appDir: "app" });
  assert.deepEqual(r.routes.map((x) => x.path).sort(), ["/", "/blog/:slug"]);
});

test("next-app: route groups are stripped from URL", () => {
  const d = tmp();
  mkdirSync(join(d, "app/(marketing)/blog"), { recursive: true });
  mkdirSync(join(d, "app/(shop)"), { recursive: true });
  writeFileSync(join(d, "app/(marketing)/blog/page.tsx"), "x");
  writeFileSync(join(d, "app/(shop)/page.tsx"), "x");
  const r = extractRoutes(d, { routing: "next-app", appDir: "app" });
  assert.deepEqual(r.routes.map((x) => x.path).sort(), ["/", "/blog"]);
});

test("glob: matched files → routes via strip rule", () => {
  const d = tmp();
  mkdirSync(join(d, "src/screens"), { recursive: true });
  writeFileSync(join(d, "src/screens/coach.screen.tsx"), "x");
  const r = extractRoutes(d, { routing: "glob", glob: "src/screens/*.screen.tsx" });
  assert.deepEqual(r.routes.map((x) => x.path), ["/coach"]);
});

test("code-router: extracts path: literals, derives section, dedups + sorts", () => {
  const d = tmp();
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(
    join(d, "src/router.tsx"),
    `createRoute({ path: "/log" }); createRoute({ path: '/log/live' });
     createRoute({ path: "/" }); createRoute({ path: "/log" });`,
  );
  const r = extractRoutes(d, { routing: "code-router", routerFiles: ["src/router.tsx"] });
  assert.deepEqual(r.routes.map((x) => x.path), ["/", "/log", "/log/live"]);
  assert.equal(r.routes.find((x) => x.path === "/")!.section, "root");
  assert.equal(r.routes.find((x) => x.path === "/log/live")!.section, "log");
});

test("code-router: exclude filters drop non-app paths", () => {
  const d = tmp();
  writeFileSync(join(d, "router.tsx"), `path: "/coach"; path: "/api/coach"; path: "/auth/v1/token";`);
  const r = extractRoutes(d, {
    routing: "code-router",
    routerFiles: ["router.tsx"],
    exclude: ["^/api", "^/auth"],
  });
  assert.deepEqual(r.routes.map((x) => x.path), ["/coach"]);
});

test("code-router: missing router file yields no routes (no throw)", () => {
  const d = tmp();
  const r = extractRoutes(d, { routing: "code-router", routerFiles: ["nope.tsx"] });
  assert.deepEqual(r.routes, []);
});

test("auto routing returns an empty skeleton from extractRoutes (resolved upstream)", () => {
  const d = tmp();
  const r = extractRoutes(d, { routing: "auto" });
  assert.deepEqual(r.routes, []);
});
