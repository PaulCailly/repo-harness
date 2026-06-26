import { existsSync } from "node:fs";
import { join } from "node:path";

export interface Detected {
  packageManager: "yarn" | "pnpm" | "npm";
  paths: { scripts: string; sentinel: string };
}

export function detect(cwd: string): Detected {
  const has = (f: string) => existsSync(join(cwd, f));
  const packageManager = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
  return { packageManager, paths: { scripts: "scripts", sentinel: ".github/sentinel" } };
}
