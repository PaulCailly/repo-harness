import { readManifest } from "../manifest.ts";
import { loadRegistry, registryRoot } from "../registry.ts";
import { classify } from "./update.ts";

export default async function list(_args: string[]): Promise<number> {
  const cwd = process.cwd();
  const manifest = readManifest(cwd);
  if (!manifest) { console.error("No gatekit.json — run `gatekit init` first."); return 1; }
  const root = registryRoot();
  const rows = classify(root, cwd, manifest, loadRegistry(root));
  const drift = rows.filter((r) => r.state === "update-available" || r.state === "locally-modified").length;
  console.log(`registry synced: ${manifest.version}   drifted files: ${drift}\n`);
  for (const [name, f] of Object.entries(manifest.features)) {
    console.log(`  ${name.padEnd(14)} ${f.enabled ? "on " : "off"}  ${f.mode ?? "-"}`);
  }
  return 0;
}
