import { readManifest } from "../manifest.ts";
import { loadRegistry, registryRoot } from "../registry.ts";
import { classify } from "./update.ts";

export default async function diff(_args: string[]): Promise<number> {
  const cwd = process.cwd();
  const manifest = readManifest(cwd);
  if (!manifest) { console.error("No repo-harness.json — run `repo-harness init` first."); return 1; }
  const root = registryRoot();
  const rows = classify(root, cwd, manifest, loadRegistry(root));
  let drift = 0;
  for (const r of rows) {
    console.log(`  ${r.state.padEnd(18)} ${r.dest}`);
    if (r.state === "update-available" || r.state === "locally-modified") drift++;
  }
  return drift ? 2 : 0;
}
