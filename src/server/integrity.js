/**
 * Niral integrity — release tamper detection (v0.2).
 *
 * A niral release is content-hashed: dist/releases/<hash>/. At build time we
 * also write a manifest of every file's sha256. At runtime the server can
 * re-hash the files it is actually serving and compare — if a file changed
 * on disk after the build (a defaced page, an injected script, a swapped
 * server module), the hashes diverge and we KNOW the release was tampered.
 *
 * This is nearly free for niral because the whole deploy model is already
 * hash-addressed; no other framework gets tamper detection for free.
 *
 * Honest scope: detects tampering of the RELEASE FILES. It cannot detect an
 * attacker with root who also rewrites this checker — off-box verification is
 * the only defense there (roadmap: signed manifests + remote attest).
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Hash every file under a release (excluding volatile dirs). Returns
 *  { files: { relPath: sha256 }, count }. Used at build AND at check time. */
export function hashRelease(releaseDir, { skip = ["data", "logs"] } = {}) {
  const files = {};
  walk(releaseDir, releaseDir, files, skip);
  return { files, count: Object.keys(files).length };
}

function walk(dir, root, out, skip) {
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, root, out, skip);
    else if (st.isFile()) {
      const rel = relative(root, abs).split("\\").join("/");
      if (rel === "integrity.json") continue; // never hash the manifest itself
      out[rel] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  }
}

/** Write the integrity manifest into a freshly built release. */
export function writeIntegrity(releaseDir) {
  const { files, count } = hashRelease(releaseDir);
  writeFileSync(
    join(releaseDir, "integrity.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), count, files }, null, 0)
  );
  return count;
}

/**
 * Re-hash the running release and compare against its integrity manifest.
 * Returns { ok, tampered:[{path, kind}], missing:[], added:[], checked }.
 * kind: "modified" | "missing" | "added".
 */
export function checkIntegrity(releaseDir) {
  const manifestPath = join(releaseDir, "integrity.json");
  if (!existsSync(manifestPath)) return { ok: true, unavailable: true, tampered: [], checked: 0 };
  const expected = JSON.parse(readFileSync(manifestPath, "utf8")).files;
  const { files: actual } = hashRelease(releaseDir);
  const tampered = [];
  for (const [rel, hash] of Object.entries(expected)) {
    if (!(rel in actual)) tampered.push({ path: rel, kind: "missing" });
    else if (actual[rel] !== hash) tampered.push({ path: rel, kind: "modified" });
  }
  for (const rel of Object.keys(actual)) {
    if (!(rel in expected)) tampered.push({ path: rel, kind: "added" });
  }
  return { ok: tampered.length === 0, tampered, checked: Object.keys(expected).length };
}
