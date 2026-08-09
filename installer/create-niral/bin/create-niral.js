#!/usr/bin/env node
// npx create-niral my-app [--template blog|dashboard] — the beginner's one command.
import { ensureFramework, installLauncher, runNiral } from "../index.js";

const usage = "usage: npx create-niral <app-name|.> [--template minimal|blog|dashboard]";

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    return 0;
  }
  const name = argv[0];
  if (!name || (name.startsWith("-") && name !== ".")) throw new Error(usage);

  await ensureFramework();
  const code = runNiral(["create", name, ...argv.slice(1)]);
  if (code !== 0) return code;

  const { profile, added } = installLauncher();
  console.log("");
  if (added) console.log(`✓ \`niral\` command installed — PATH updated in ${profile} (open a new terminal)`);
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
