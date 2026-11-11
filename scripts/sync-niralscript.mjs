#!/usr/bin/env node
// Mirror the standalone NiralScript compiler (niralscript/ + root NIRALSCRIPT.md)
// from this framework monorepo to the standalone Zyora-Dev/niralscript repo.
//
// The niralscript/ folder is the source of record and lives inside this repo.
// It has no git remote of its own, so changes never reach the standalone repo
// unless mirrored. Run this after any NiralScript change to keep them in sync.
//
// Usage:
//   node scripts/sync-niralscript.mjs [--dry-run] [--remote <git-url>]
//
// Zero dependencies — Node stdlib only.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REMOTE = "git@github-zyorabyte:Zyora-Dev/niralscript.git";

// Files mirrored into the standalone repo root.
const DIR_FILES = [
  "LICENSE",
  "README.md",
  "analysis.js",
  "check.js",
  "cli.js",
  "compile.js",
  "contracts.js",
  "errors.js",
  "expressions.js",
  "modules.js",
  "package.json",
  "parser.js",
  "scanner.js",
  "types.js",
];
// Lives at the monorepo root but belongs at the standalone repo root.
const ROOT_DOC = "NIRALSCRIPT.md";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const remoteIdx = args.indexOf("--remote");
const remote = remoteIdx !== -1 ? args[remoteIdx + 1] : DEFAULT_REMOTE;

function run(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fail(message) {
  console.error(`sync-niralscript: ${message}`);
  process.exit(1);
}

// Verify every source file exists before touching the clone.
for (const f of DIR_FILES) {
  if (!existsSync(join(REPO_ROOT, "niralscript", f))) fail(`missing niralscript/${f}`);
}
if (!existsSync(join(REPO_ROOT, ROOT_DOC))) fail(`missing ${ROOT_DOC}`);

const work = mkdtempSync(join(tmpdir(), "nrs-sync-"));
const clone = join(work, "niralscript");

try {
  console.log(`Cloning ${remote} ...`);
  run("git", ["clone", "--depth", "1", remote, clone], work);

  for (const f of DIR_FILES) {
    cpSync(join(REPO_ROOT, "niralscript", f), join(clone, f));
  }
  cpSync(join(REPO_ROOT, ROOT_DOC), join(clone, ROOT_DOC));

  const status = run("git", ["status", "--porcelain"], clone).trim();
  if (!status) {
    console.log("Standalone repo already up to date. Nothing to sync.");
    process.exit(0);
  }

  console.log("Changes to mirror:");
  console.log(status.split("\n").map((l) => `  ${l}`).join("\n"));

  if (dryRun) {
    console.log("\n--dry-run: not committing or pushing.");
    process.exit(0);
  }

  const srcHead = run("git", ["rev-parse", "--short", "HEAD"], REPO_ROOT).trim();
  const message =
    `Sync NiralScript compiler from framework source of record\n\n` +
    `Mirrors niralscript/ and NIRALSCRIPT.md from Zyora-Dev/niral@${srcHead}.`;

  run("git", ["add", "-A"], clone);
  run("git", ["commit", "-m", message], clone);
  console.log(`Pushing to ${remote} ...`);
  run("git", ["push", "origin", "HEAD:main"], clone);
  console.log("NiralScript standalone repo synced.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
