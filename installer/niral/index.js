/**
 * create-niral — the one-command bootstrap.
 *
 * This is the ONLY thing that lives on npm. It downloads the real framework
 * (which has zero dependencies) from GitHub into ~/.niral/framework and
 * forwards commands to it. The framework itself never touches npm.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { get } from "node:https";

export const NIRAL_HOME = process.env.NIRAL_HOME || join(homedir(), ".niral");
const FRAMEWORK = join(NIRAL_HOME, "framework");
const TARBALL = "https://codeload.github.com/Zyora-Dev/niral/tar.gz/refs/heads/main";
const REPO = "https://github.com/Zyora-Dev/niral.git";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`download failed: HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function hasGit() {
  const result = spawnSync("git", ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function commandError(label, result) {
  const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status ?? "unknown"}`;
  return new Error(`${label} failed: ${detail}`);
}

async function installFromTarball() {
  const tgz = join(NIRAL_HOME, "niral.tgz");
  await download(TARBALL, tgz);
  rmSync(FRAMEWORK, { recursive: true, force: true });
  mkdirSync(FRAMEWORK, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", tgz, "-C", FRAMEWORK, "--strip-components=1"], { encoding: "utf8" });
  rmSync(tgz, { force: true });
  if (extracted.error || extracted.status !== 0) throw commandError("framework extraction", extracted);
}

/** Download the framework to ~/.niral/framework (git if available, tarball otherwise). */
export async function ensureFramework({ update = false } = {}) {
  if (existsSync(join(FRAMEWORK, "bin", "niral.js")) && !update) return FRAMEWORK;
  console.log("niral · downloading the framework (one time, ~1 MB — it has zero dependencies)…");
  mkdirSync(NIRAL_HOME, { recursive: true });
  let installed = false;
  if (hasGit()) {
    const gitResult = existsSync(join(FRAMEWORK, ".git"))
      ? spawnSync("git", ["pull", "--ff-only", "-q"], { cwd: FRAMEWORK, encoding: "utf8" })
      : (() => {
          rmSync(FRAMEWORK, { recursive: true, force: true });
          return spawnSync("git", ["clone", "-q", "--depth", "1", REPO, FRAMEWORK], { encoding: "utf8" });
        })();
    if (!gitResult.error && gitResult.status === 0) {
      installed = true;
    } else {
      const reason = gitResult.error?.message || gitResult.stderr?.trim() || `exit ${gitResult.status ?? "unknown"}`;
      console.warn(`niral · Git download unavailable (${reason}); trying the release tarball…`);
    }
  }
  if (!installed) await installFromTarball();
  if (!existsSync(join(FRAMEWORK, "bin", "niral.js"))) throw new Error("framework download failed — try again or clone github.com/Zyora-Dev/niral manually");
  return FRAMEWORK;
}

/** Put a `niral` launcher on the PATH so every later command is just `niral dev`. */
export function installLauncher() {
  const binDir = join(NIRAL_HOME, "bin");
  mkdirSync(binDir, { recursive: true });
  const frameworkCli = join(FRAMEWORK, "bin", "niral.js");
  const shim = join(binDir, process.platform === "win32" ? "niral.cmd" : "niral");
  if (process.platform === "win32") {
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${frameworkCli}" %*\r\n`);
  } else {
    writeFileSync(shim, `#!/usr/bin/env sh\nexec "${process.execPath}" "${frameworkCli}" "$@"\n`);
    chmodSync(shim, 0o755);
  }

  const profile =
    (process.env.SHELL ?? "").endsWith("/zsh") ? join(homedir(), ".zshrc")
    : (process.env.SHELL ?? "").endsWith("/bash") ? join(homedir(), ".bashrc")
    : null;
  if (profile) {
    const line = `export PATH="$HOME/.niral/bin:$PATH"`;
    const current = existsSync(profile) ? readFileSync(profile, "utf8") : "";
    if (!current.includes(".niral/bin")) {
      appendFileSync(profile, `\n# niral\n${line}\n`);
      return { shim, profile, added: true };
    }
    return { shim, profile, added: false };
  }
  return { shim, profile: null, added: false };
}

/** Forward a command to the framework CLI. */
export function runNiral(args) {
  const r = spawnSync(process.execPath, [join(FRAMEWORK, "bin", "niral.js"), ...args], { stdio: "inherit" });
  if (r.error) throw new Error(`could not start the Niral CLI: ${r.error.message}`);
  if (r.signal) throw new Error(`Niral CLI terminated by ${r.signal}`);
  if (r.status === null) throw new Error("Niral CLI exited without a status");
  return r.status;
}
