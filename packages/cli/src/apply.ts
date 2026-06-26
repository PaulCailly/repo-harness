import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readItemFile, type FileSpec } from "./registry.ts";
import { sha, resolveDest, type Manifest } from "./manifest.ts";

export function applyFile(opts: {
  root: string;
  cwd: string;
  spec: FileSpec;
  paths: Manifest["paths"];
  version: string;
  manifest: Manifest;
}): { dest: string; action: "wrote" | "skipped-owned" | "overwrote" } {
  const { root, cwd, spec, paths, version, manifest } = opts;
  const rel = resolveDest(spec.dest, paths);
  const abs = join(cwd, rel);
  const upstream = readItemFile(root, spec.src);
  let action: "wrote" | "skipped-owned" | "overwrote" = "wrote";
  if (spec.type === "owned" && existsSync(abs)) {
    action = "skipped-owned";
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs)) action = "overwrote";
    writeFileSync(abs, upstream);
  }
  const onDisk = readFileSync(abs, "utf8");
  manifest.installed[rel] = { sha: sha(onDisk), type: spec.type, version };
  return { dest: rel, action };
}
