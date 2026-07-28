/**
 * niral add typescript — download the REAL TypeScript compiler once (no npm).
 *
 * Fetches the official npm tarball, extracts lib/typescript.js + the lib.*.d.ts
 * standard libraries into .niral/lib/typescript/ (same layout as the package,
 * so the compiler finds its own default libs). `niral check` picks it up
 * automatically. Hand-rolled tar reader — the framework stays zero-dep.
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

export const DEFAULT_TS_VERSION = "5.7.3";

/** Minimal tar reader: yields { name, data } for regular files. */
export function* untar(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(), 8) || 0;
    const type = String.fromCharCode(header[156]);
    off += 512;
    if (type === "0" || type === "\0") {
      yield { name, data: buf.subarray(off, off + size) };
    }
    off += Math.ceil(size / 512) * 512;
  }
}

export async function addTypescript({ root, version = DEFAULT_TS_VERSION }) {
  const dir = resolve(root);
  const dest = join(dir, ".niral", "lib", "typescript");
  if (existsSync(join(dest, "typescript.js"))) {
    console.log("niral · typescript already installed — .niral/lib/typescript/");
    return dest;
  }
  // a project-local install wins — nothing to download
  if (existsSync(join(dir, "node_modules", "typescript", "lib", "typescript.js"))) {
    console.log("niral · project already has typescript in node_modules — `niral check` will use it");
    return null;
  }

  const url = `https://registry.npmjs.org/typescript/-/typescript-${version}.tgz`;
  console.log(`niral · downloading TypeScript ${version} (one-time) …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const tarball = gunzipSync(Buffer.from(await res.arrayBuffer()));

  mkdirSync(dest, { recursive: true });
  let wrote = 0;
  for (const { name, data } of untar(tarball)) {
    // compiler + its standard libraries — same dir so default-lib lookup works
    if (name === "package/lib/typescript.js" || /^package\/lib\/lib\..*\.d\.ts$/.test(name)) {
      writeFileSync(join(dest, name.slice("package/lib/".length)), data);
      wrote++;
    }
  }
  if (!wrote) throw new Error("tarball had no lib/typescript.js — unexpected layout");

  // .niral/ is derived state — keep it out of git (idempotent append)
  const gi = join(dir, ".gitignore");
  const marker = ".niral/";
  if (!existsSync(gi)) writeFileSync(gi, `${marker}\n`);
  else if (!readFileSync(gi, "utf8").includes(marker)) appendFileSync(gi, `${marker}\n`);

  console.log(`niral · TypeScript ready (${wrote} files) — run \`niral check\``);
  return dest;
}
