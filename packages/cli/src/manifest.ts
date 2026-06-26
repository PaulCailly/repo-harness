import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Manifest {
  $schema: string;
  version: string;
  packageManager: string;
  paths: { scripts: string; sentinel: string };
  features: Record<string, { enabled: boolean; mode?: "report" | "block" }>;
  installed: Record<string, { sha: string; type: "managed" | "owned"; version: string }>;
}

const FILE = "repo-harness.json";

export function readManifest(cwd: string): Manifest | null {
  const p = join(cwd, FILE);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Manifest) : null;
}

export function writeManifest(cwd: string, m: Manifest): void {
  writeFileSync(join(cwd, FILE), JSON.stringify(m, null, 2) + "\n");
}

export function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function resolveDest(dest: string, paths: Manifest["paths"]): string {
  return dest.replace("{scripts}", paths.scripts).replace("{sentinel}", paths.sentinel);
}
