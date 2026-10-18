#!/usr/bin/env node
// npx create-niral my-app [--template blog|dashboard] — the beginner's one command.
import { ensureFramework, installLauncher, runNiral, runLauncher } from "../index.js";

const usage = "usage: npx create-niral <app-name|.> [--template minimal|blog|dashboard]";

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    return 0;
  }
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) return runLauncher(["--version"]);
  const name = argv[0];
  if (!name || (name.startsWith("-") && name !== ".")) throw new Error(usage);
  if (argv.length !== 1 && !(argv.length === 3 && argv[1] === "--template" && ["minimal", "blog", "dashboard"].includes(argv[2]))) throw new Error(usage);

  await ensureFramework();
  const code = runNiral(["create", name, ...argv.slice(1)]);
  if (code !== 0) return code;

  const { profile, added } = installLauncher();
  console.log("");
  if (added) console.log(`✓ \`niral\` command installed — PATH updated in ${profile} (open a new terminal)`);
  if (!profile) console.log("Use npx niral <command>, or add NIRAL_HOME/bin to your PATH.");
  const cd = name === "." ? "" : `  cd ${name}\n`;
  console.log(`Next:\n${cd}  niral dev          # or: npx niral dev\n`);
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`create-niral: ${error?.message || error}`);
  process.exitCode = 1;
});
