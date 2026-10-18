/**
 * create-niral — the one-command bootstrap.
 *
 * This is the ONLY thing that lives on npm. It downloads the real framework
 * (which has zero dependencies) from GitHub into ~/.niral/framework and
 * forwards commands to it. The framework itself never touches npm.
 */

import { existsSync, mkdirSync, mkdtempSync, renameSync, lstatSync, realpathSync, rmSync, writeFileSync, chmodSync, appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { get } from "node:https";

export const NIRAL_HOME = resolve(process.env.NIRAL_HOME || join(homedir(), ".niral"));
const FRAMEWORK = join(NIRAL_HOME, "framework");
const TARBALL = "https://codeload.github.com/Zyora-Dev/niral/tar.gz/refs/heads/main";
const REPO = "https://github.com/Zyora-Dev/niral.git";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`download failed: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) {
          request.destroy(new Error("framework download exceeds 64 MiB"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          writeFileSync(dest, Buffer.concat(chunks));
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      res.on("error", reject);
    }).on("error", reject);
    const deadline = setTimeout(() => request.destroy(new Error("framework download timed out")), 60000);
    request.on("close", () => clearTimeout(deadline));
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

async function installFromTarball(stage) {
  const tgz = join(stage, "niral.tgz");
  await download(TARBALL, tgz);
  const target = join(stage, "framework");
  mkdirSync(target);
  const extracted = spawnSync("tar", ["-xzf", tgz, "-C", target, "--strip-components=1"], { encoding: "utf8", timeout: 120000 });
  rmSync(tgz, { force: true });
  if (extracted.error || extracted.status !== 0) throw commandError("framework extraction", extracted);
}

/** Download the framework to ~/.niral/framework (git if available, tarball otherwise). */
export async function ensureFramework({ update = false } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Niral requires Node.js 22 or newer");
  if (existsSync(join(FRAMEWORK, "bin", "niral.js")) && !update) return FRAMEWORK;
  mkdirSync(NIRAL_HOME, { recursive: true });
  const lock = join(NIRAL_HOME, ".framework-install-lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`framework installation is locked: ${lock}. Check for another installer before removing a stale lock.`);
    throw error;
  }
  let stage;
  try {
    if (existsSync(join(FRAMEWORK, "bin", "niral.js")) && !update) return FRAMEWORK;
    const entry = lstatSync(FRAMEWORK, { throwIfNoEntry: false });
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error("framework path must be a real directory; installation left unchanged");
    console.log(update ? "niral: updating the installed framework..." : "niral: downloading the framework...");
    if (existsSync(join(FRAMEWORK, ".git"))) {
      if (!hasGit()) throw new Error("Git is required to update this checkout; installation left unchanged");
      const git = (args) => {
        const result = spawnSync("git", args, { cwd: FRAMEWORK, encoding: "utf8", timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        if (result.error || result.status !== 0) throw commandError("Git update (no archive fallback)", result);
        return result.stdout.trim();
      };
      if (git(["status", "--porcelain", "--untracked-files=all"])) throw new Error("framework checkout has local changes; preserve them before updating");
      if (git(["branch", "--show-current"]) !== "main") throw new Error("framework checkout is not on main; update it manually with Git");
      if (![REPO, REPO.replace(/\.git$/, "")].includes(git(["remote", "get-url", "origin"]))) throw new Error("framework origin differs from the official repository; update it manually with Git");
      const previous = git(["rev-parse", "HEAD"]);
      git(["pull", "--ff-only", "origin", "main"]);
      console.log(`niral: framework ${git(["rev-parse", "--short", "HEAD"])} (previous ${previous})`);
      return FRAMEWORK;
    }
    stage = mkdtempSync(join(NIRAL_HOME, ".framework-stage-"));
    const target = join(stage, "framework");
    let installed = false;
    if (hasGit()) {
      const cloned = spawnSync("git", ["clone", "-q", "--depth", "1", "--branch", "main", REPO, target], {
        encoding: "utf8", timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      installed = !cloned.error && cloned.status === 0;
      if (!installed) {
        rmSync(target, { recursive: true, force: true });
        console.warn("niral: Git download unavailable; trying the framework archive...");
      }
    }
    if (!installed) await installFromTarball(stage);
    const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    if (manifest.name !== "niral" || !existsSync(join(target, "src", "index.js"))) throw new Error("download is not a Niral framework");
    const checked = spawnSync(process.execPath, ["--check", join(target, "bin", "niral.js")], { encoding: "utf8", timeout: 10000 });
    if (checked.error || checked.status !== 0) throw commandError("downloaded CLI validation", checked);
    let backup;
    if (entry) {
      backup = join(mkdtempSync(join(NIRAL_HOME, "framework-backup-")), "framework");
      renameSync(FRAMEWORK, backup);
    }
    try {
      renameSync(target, FRAMEWORK);
    } catch (error) {
      if (backup) renameSync(backup, FRAMEWORK);
      throw error;
    }
    if (backup) console.log(`niral: previous framework preserved at ${backup}`);
    console.log(`niral: framework ${manifest.version} ready`);
    return FRAMEWORK;
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

export async function updateFramework({ sourceRoot } = {}) {
  if (sourceRoot && (!existsSync(FRAMEWORK) || realpathSync(sourceRoot) !== realpathSync(FRAMEWORK))) {
    throw new Error("niral update only updates the managed NIRAL_HOME/framework installation. Update source checkouts with Git; deploy servers separately.");
  }
  await ensureFramework({ update: true });
}

export async function runLauncher(args) {
  if (args[0] === "update") {
    if (args.length === 2 && ["--help", "-h"].includes(args[1])) {
      console.log("usage: niral update\nUpdates NIRAL_HOME/framework from main; does not update npm packages or deploy apps.");
      return 0;
    }
    if (args.length !== 1) throw new Error("usage: niral update");
    await updateFramework();
    return 0;
  }
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) {
    if (existsSync(join(FRAMEWORK, "bin", "niral.js"))) return runNiral(args);
    console.log("niral <command> [options]\nCommands: create, dev, build, start, check, test, add, doctor, di, update.\nThe first framework command downloads the framework.\nniral di --help: Developer Intelligence setup, status, ask, chat, new.\nniral update: explicitly refresh the installed framework.\nRun niral --help after installation for the full framework command list.");
    return 0;
  }
  if (["--version", "-v", "version"].includes(args[0])) {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    console.log(`${manifest.name} launcher ${manifest.version}`);
    if (existsSync(join(FRAMEWORK, "package.json"))) {
      const framework = JSON.parse(readFileSync(join(FRAMEWORK, "package.json"), "utf8"));
      console.log(`niral framework ${framework.version}`);
    }
    return 0;
  }
  await ensureFramework();
  return runNiral(args);
}

/** Put a `niral` launcher on the PATH so every later command is just `niral dev`. */
export function installLauncher() {
  const binDir = join(NIRAL_HOME, "bin");
  mkdirSync(binDir, { recursive: true });
  const frameworkCli = join(FRAMEWORK, "bin", "niral.js");
  const shim = join(binDir, process.platform === "win32" ? "niral.cmd" : "niral");
  if (process.platform === "win32") {
    writeFileSync(shim, `@echo off\r\nset "NIRAL_HOME=${NIRAL_HOME.replaceAll("%", "%%")}"\r\n"${process.execPath.replaceAll("%", "%%")}" "${frameworkCli.replaceAll("%", "%%")}" %*\r\n`);
  } else {
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    writeFileSync(shim, `#!/usr/bin/env sh\nexport NIRAL_HOME=${quote(NIRAL_HOME)}\nexec ${quote(process.execPath)} ${quote(frameworkCli)} "$@"\n`);
    chmodSync(shim, 0o755);
  }

  const profile =
    (process.env.SHELL ?? "").endsWith("/zsh") ? join(homedir(), ".zshrc")
    : (process.env.SHELL ?? "").endsWith("/bash") ? join(homedir(), ".bashrc")
    : null;
  if (profile) {
    const line = NIRAL_HOME === join(homedir(), ".niral")
      ? `export PATH="$HOME/.niral/bin:$PATH"`
      : `export PATH='${binDir.replaceAll("'", "'\\''")}':"$PATH"`;
    const current = existsSync(profile) ? readFileSync(profile, "utf8") : "";
    if (!current.split(/\r?\n/).includes(line)) {
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
