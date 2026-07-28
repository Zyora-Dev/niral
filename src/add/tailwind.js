/**
 * niral add tailwind — the first `niral add` recipe.
 *
 * Uses Tailwind's STANDALONE binary (no npm, no node_modules): downloaded
 * once into .niral/bin/, scaffolded with an input stylesheet and a shell
 * link, then wired automatically into `niral dev` (--watch) and
 * `niral build` (--minify, fails the build before the release flips).
 *
 * The framework itself stays zero-dependency — the binary belongs to the
 * user's project, exactly like CSS they might write by hand.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { DEFAULT_SHELL } from "../server/page.js";

const RELEASE_BASE = "https://github.com/tailwindlabs/tailwindcss/releases/latest/download";

function assetName() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `tailwindcss-macos-${arch}`;
  if (process.platform === "win32") return "tailwindcss-windows-x64.exe";
  return `tailwindcss-linux-${arch}`;
}

function binName() {
  return process.platform === "win32" ? "tailwindcss.exe" : "tailwindcss";
}

/** The recipe manifest, or null if tailwind isn't set up in this project. */
export function loadRecipe(root) {
  const file = join(resolve(root), ".niral", "tailwind.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** One-shot compile (used by `niral build` with minify). Throws on failure. */
export function runTailwindOnce(root, recipe, { minify = false } = {}) {
  const dir = resolve(root);
  const bin = join(dir, recipe.binary);
  if (!existsSync(bin)) {
    throw new Error(`tailwind binary missing (${recipe.binary}) — run: niral add tailwind`);
  }
  const args = ["-i", recipe.input, "-o", recipe.output, ...(minify ? ["--minify"] : [])];
  const out = spawnSync(bin, args, { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  if (out.status !== 0) throw new Error(`tailwind compile failed (exit ${out.status})`);
}

/** Long-running --watch process (used by `niral dev`). */
export function spawnTailwindWatch(root, recipe) {
  const dir = resolve(root);
  const bin = join(dir, recipe.binary);
  if (!existsSync(bin)) {
    throw new Error(`tailwind binary missing (${recipe.binary}) — run: niral add tailwind`);
  }
  // --watch=always: plain --watch exits when stdin closes, which it does
  // immediately for a detached child. "always" keeps the watcher alive.
  return spawn(bin, ["-i", recipe.input, "-o", recipe.output, "--watch=always"], {
    cwd: dir,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

/** Set up tailwind in a project: download binary, scaffold, first compile. */
export async function addTailwind({ root = "." } = {}) {
  const dir = resolve(root);
  const recipe = {
    input: "styles/tailwind.css",
    output: "styles/tw.css",
    binary: join(".niral", "bin", binName()),
  };

  // 1. standalone binary (one-time, ~35MB)
  const binAbs = join(dir, recipe.binary);
  if (!existsSync(binAbs)) {
    const url = `${RELEASE_BASE}/${assetName()}`;
    console.log(`niral · downloading tailwind standalone (${assetName()}) — one time…`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`tailwind download failed: HTTP ${res.status} for ${url}`);
    mkdirSync(dirname(binAbs), { recursive: true });
    writeFileSync(binAbs, Buffer.from(await res.arrayBuffer()));
    chmodSync(binAbs, 0o755);
  }

  // 2. input stylesheet
  const inputAbs = join(dir, recipe.input);
  if (!existsSync(inputAbs)) {
    mkdirSync(dirname(inputAbs), { recursive: true });
    writeFileSync(inputAbs, `@import "tailwindcss";\n\n/* your custom css below */\n`);
  }

  // 3. link the output in the shell
  const shellAbs = join(dir, "routes", "_shell.html");
  const linkTag = `<link rel="stylesheet" href="/${recipe.output}" />`;
  if (!existsSync(shellAbs)) {
    mkdirSync(dirname(shellAbs), { recursive: true });
    writeFileSync(shellAbs, DEFAULT_SHELL.replace("<!--niral:head-->", `${linkTag}\n<!--niral:head-->`));
  } else {
    const shell = readFileSync(shellAbs, "utf8");
    if (!shell.includes(recipe.output)) {
      writeFileSync(
        shellAbs,
        shell.includes("<!--niral:head-->")
          ? shell.replace("<!--niral:head-->", `${linkTag}\n<!--niral:head-->`)
          : shell.replace("</head>", `${linkTag}\n</head>`)
      );
    }
  }

  // 4. manifest — this is how dev/build discover the recipe
  writeFileSync(join(dir, ".niral", "tailwind.json"), JSON.stringify(recipe, null, 2) + "\n");

  // 5. first compile so styles exist immediately
  runTailwindOnce(dir, recipe);
  return recipe;
}
