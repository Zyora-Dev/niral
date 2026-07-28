/**
 * create-niral — the one-command bootstrap.
 *
 * This is the ONLY thing that lives on npm. It downloads the real framework
 * (which has zero dependencies) from GitHub into ~/.niral/framework and
 * forwards commands to it. The framework itself never touches npm.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, appendFileSync, readFileSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
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
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Download the framework to ~/.niral/framework (git if available, tarball otherwise). */
export async function ensureFramework({ update = false } = {}) {
  if (existsSync(join(FRAMEWORK, "bin", "niral.js")) && !update) return FRAMEWORK;
  console.log("நிரல் · downloading the framework (one time, ~1 MB — it has zero dependencies)…");
  mkdirSync(NIRAL_HOME, { recursive: true });
  if (hasGit()) {
    if (existsSync(join(FRAMEWORK, ".git"))) {
      execSync("git pull -q", { cwd: FRAMEWORK, stdio: "ignore" });
    } else {
      rmSync(FRAMEWORK, { recursive: true, force: true });
      execSync(`git clone -q --depth 1 ${REPO} "${FRAMEWORK}"`, { stdio: "ignore" });
    }
  } else {
    const tgz = join(NIRAL_HOME, "niral.tgz");
    await download(TARBALL, tgz);
    rmSync(FRAMEWORK, { recursive: true, force: true });
    mkdirSync(FRAMEWORK, { recursive: true });
    execSync(`tar -xzf "${tgz}" -C "${FRAMEWORK}" --strip-components=1`, { stdio: "ignore" });
    rmSync(tgz);
  }
  if (!existsSync(join(FRAMEWORK, "bin", "niral.js"))) throw new Error("framework download failed — try again or clone github.com/Zyora-Dev/niral manually");
  return FRAMEWORK;
}

/** Put a `niral` launcher on the PATH so every later command is just `niral dev`. */
export function installLauncher() {
  const binDir = join(NIRAL_HOME, "bin");
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "niral");
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node "${join(FRAMEWORK, "bin", "niral.js")}" "$@"\n`);
  chmodSync(shim, 0o755);

  const profile =
    (process.env.SHELL ?? "").endsWith("/zsh") ? join(homedir(), ".zshrc")
    : (process.env.SHELL ?? "").endsWith("/bash") ? join(homedir(), ".bashrc")
    : null;
  if (profile) {
    const line = `export PATH="$HOME/.niral/bin:$PATH"`;
    const current = existsSync(profile) ? readFileSync(profile, "utf8") : "";
    if (!current.includes(".niral/bin")) {
      appendFileSync(profile, `\n# niral — நிரல்\n${line}\n`);
      return { shim, profile, added: true };
    }
    return { shim, profile, added: false };
  }
  return { shim, profile: null, added: false };
}

/** Forward a command to the framework CLI. */
export function runNiral(args) {
  const r = spawnSync("node", [join(FRAMEWORK, "bin", "niral.js"), ...args], { stdio: "inherit" });
  return r.status ?? 0;
}
