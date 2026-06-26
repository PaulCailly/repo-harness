import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const USAGE = `repo-harness <command>

  init                 create repo-harness.json
  add <feature...>     vendor a gate into this repo
  update [feature...]  update managed engine files
  diff [feature...]    show what update would change
  list                 show installed features + drift
  remove <feature>     remove a feature's managed files
`;

const COMMANDS = new Set(["init", "add", "update", "diff", "list", "remove"]);

export async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "--version") {
    const pkg = JSON.parse(
      await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    console.log(pkg.version);
    return 0;
  }
  if (!cmd || !COMMANDS.has(cmd)) {
    console.log(USAGE);
    return 0;
  }
  const mod = await import(`./commands/${cmd}.ts`);
  return mod.default(rest);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((c) => process.exit(c));
}
