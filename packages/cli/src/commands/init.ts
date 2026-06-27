// packages/cli/src/commands/init.ts
import { detect } from "../detect.js";
import { readManifest, writeManifest, type Manifest } from "../manifest.js";
import { loadRegistry, registryRoot } from "../registry.js";

const SCHEMA = "https://paulcailly.github.io/gatekit/schema.json";

export default async function init(_args: string[]): Promise<number> {
  const cwd = process.cwd();
  if (readManifest(cwd)) {
    console.log("gatekit.json already exists — leaving it untouched.");
    return 0;
  }
  const { packageManager, paths } = detect(cwd);
  const reg = loadRegistry(registryRoot());
  const features: Manifest["features"] = {};
  for (const name of Object.keys(reg.items)) {
    if (name.startsWith("_")) continue; // _lib-style items are deps, not user features
    features[name] = { enabled: false, mode: "report" };
  }
  writeManifest(cwd, {
    $schema: SCHEMA,
    version: reg.version,
    packageManager,
    paths,
    features,
    installed: {},
  });
  console.log(`Wrote gatekit.json (registry ${reg.version}, ${packageManager}).`);
  console.log("Next: npx gatekit add <feature>");
  return 0;
}
