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
}): { dest: string; action: "wrote" | "skipped-owned" | "overwrote" | "conflict" | "adopted" } {
  const { root, cwd, spec, paths, version, manifest } = opts;
  const rel = resolveDest(spec.dest, paths);
  const abs = join(cwd, rel);
  const upstream = readItemFile(root, spec.src);
  let action: "wrote" | "skipped-owned" | "overwrote" | "conflict" | "adopted" = "wrote";
  if (spec.type === "owned" && existsSync(abs)) {
    action = "skipped-owned";
  } else if (
    spec.type === "managed" &&
    existsSync(abs) &&
    !manifest.installed[rel]
  ) {
    // Dest exists but was NOT installed by gatekit.
    // If the on-disk content is byte-identical to upstream, adopt it (track as managed).
    // Otherwise write upstream to a side-car so the consumer can diff manually.
    const onDisk = readFileSync(abs, "utf8");
    if (onDisk === upstream) {
      // Adopt: record in manifest, do not write, do not create .harness-new
      manifest.installed[rel] = { sha: sha(onDisk), type: spec.type, version };
      action = "adopted";
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs + ".harness-new", upstream);
      action = "conflict";
    }
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs)) action = "overwrote";
    writeFileSync(abs, upstream);
  }
  if (action !== "conflict" && action !== "adopted") {
    const onDisk = readFileSync(abs, "utf8");
    manifest.installed[rel] = { sha: sha(onDisk), type: spec.type, version };
  }
  return { dest: rel, action };
}
