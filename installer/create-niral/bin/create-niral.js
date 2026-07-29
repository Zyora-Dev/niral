#!/usr/bin/env node
// npx create-niral my-app [--template blog|dashboard] — the beginner's one command.
import { ensureFramework, installLauncher, runNiral } from "../index.js";

const name = process.argv[2];
if (!name || name.startsWith("-")) {
  console.error("usage: npx create-niral <app-name> [--template minimal|blog|dashboard]");
  process.exit(1);
}

await ensureFramework();
const code = runNiral(["create", name, ...process.argv.slice(3)]); // forward --template etc.
if (code !== 0) process.exit(code);

const { profile, added } = installLauncher();
console.log("");
if (added) console.log(`✓ \`niral\` command installed — PATH updated in ${profile} (open a new terminal)`);
console.log(`Next:
  cd ${name}
  niral dev          # or: npx niral dev
`);
