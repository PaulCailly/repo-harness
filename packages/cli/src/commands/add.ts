import { readManifest, writeManifest } from "../manifest.ts";
import { loadRegistry, registryRoot, resolveDeps } from "../registry.ts";
import { applyFile } from "../apply.ts";

export default async function add(args: string[]): Promise<number> {
  const cwd = process.cwd();
  const manifest = readManifest(cwd);
  if (!manifest) {
    console.error("No repo-harness.json — run `repo-harness init` first.");
    return 1;
  }
  if (args.length === 0) {
    console.error("Usage: repo-harness add <feature...>");
    return 1;
  }

  const root = registryRoot();
  const reg = loadRegistry(root);
  let order: string[];
  try {
    order = resolveDeps(reg, args);
  } catch (e) {
    console.error(String((e as Error).message));
    return 1;
  }

  const secrets = new Set<string>();
  for (const name of order) {
    const item = reg.items[name];
    for (const spec of [...item.files, ...(item.workflows ?? [])]) {
      const r = applyFile({ root, cwd, spec, paths: manifest.paths, version: reg.version, manifest });
      // "adopted" = pre-existing file is byte-identical to upstream; now tracked as managed
      console.log(`  ${r.action.padEnd(14)} ${r.dest}`);
    }
    for (const s of item.secrets ?? []) secrets.add(s);
    if (!name.startsWith("_")) {
      manifest.features[name] = {
        ...(manifest.features[name] ?? {}),
        enabled: true,
        mode: manifest.features[name]?.mode ?? "report",
      };
    }
  }
  manifest.version = reg.version;
  writeManifest(cwd, manifest);

  console.log(`\nAdded: ${args.join(", ")}`);
  if (secrets.size) console.log(`Set these repo secrets: ${[...secrets].join(", ")}`);
  console.log("Owned policy files (config.mjs/controls.mjs) are stubs — fill them in.");
  return 0;
}
