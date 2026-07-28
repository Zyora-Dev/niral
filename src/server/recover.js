/**
 * Niral recover — backups, restore, rollback, session eviction (v0.2).
 *
 * The "revive" half of Shield & Recover. Everything here works on the box the
 * app runs on, with no external service:
 *
 *   · snapshot()      copy every data/*.db to data/snapshots/<ts>/ (safe online
 *                     copy via sqlite VACUUM INTO — no torn writes)
 *   · restore()       roll a database back to a chosen snapshot
 *   · listSnapshots() what's available, newest first
 *   · rollbackRelease() flip dist/current to the previous good release
 *   · rotateSecret()  write a fresh NIRAL_SECRET so every session dies at once
 *
 * Snapshots are automatic at the moments data is most at risk: on a timer,
 * before every migration, and before every deploy. Old ones are pruned.
 *
 * Honest scope: on-box backups protect against bad deploys, corruption and
 * malicious writes. They do NOT survive the box being lost or root-wiped —
 * for that, push snapshots off-box (roadmap: `niral snapshot --remote`).
 */

import { existsSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync, readlinkSync, symlinkSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { randomBytes } from "node:crypto";

const sqlite = () => process.getBuiltinModule("node:sqlite");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** All SQLite databases under data/ (app.db, jobs.db, sessions.db, rag.db, …). */
export function listDatabases(projectRoot) {
  const dataDir = join(resolve(projectRoot), "data");
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => join(dataDir, f));
}

/**
 * Snapshot every data/*.db into data/snapshots/<label>/.
 * Uses `VACUUM INTO` — a consistent copy even while the app is writing, no
 * locking the live database. Returns { label, dir, files }.
 */
export function snapshot(projectRoot, { label, keep = 24, reason = "manual" } = {}) {
  const root = resolve(projectRoot);
  const dbs = listDatabases(root);
  const lbl = label ?? `${stamp()}-${reason}`;
  const dir = join(root, "data", "snapshots", lbl);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const db of dbs) {
    const dest = join(dir, basename(db));
    try {
      const { DatabaseSync } = sqlite();
      const h = new DatabaseSync(db, { readOnly: true });
      // VACUUM INTO needs a path literal; escape single quotes
      h.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      h.close();
      files.push(basename(db));
    } catch {
      // fall back to a plain file copy if VACUUM INTO isn't available
      try {
        copyFileSync(db, dest);
        files.push(basename(db));
      } catch { /* skip a db we can't read */ }
    }
  }
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ label: lbl, at: new Date().toISOString(), reason, files }, null, 0));
  pruneSnapshots(root, keep);
  return { label: lbl, dir, files };
}

/** Newest-first list of snapshots with their metadata. */
export function listSnapshots(projectRoot) {
  const dir = join(resolve(projectRoot), "data", "snapshots");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .map((d) => {
      let meta = {};
      try { meta = JSON.parse(readFileSync(join(dir, d, "snapshot.json"), "utf8")); } catch {}
      return { label: d, dir: join(dir, d), at: meta.at ?? null, reason: meta.reason ?? "?", files: meta.files ?? [] };
    })
    .sort((a, b) => (a.label < b.label ? 1 : -1));
}

/** Keep only the newest `keep` snapshots. */
export function pruneSnapshots(projectRoot, keep = 24) {
  const snaps = listSnapshots(projectRoot);
  for (const s of snaps.slice(keep)) rmSync(s.dir, { recursive: true, force: true });
}

/**
 * Restore databases from a snapshot. The current db is backed up first
 * (reason "pre-restore") so a restore is itself undoable. `only` limits to
 * specific db filenames. Returns { restored, from }.
 */
export function restore(projectRoot, label, { only = null } = {}) {
  const root = resolve(projectRoot);
  const snaps = listSnapshots(root);
  const snap = label === "latest" ? snaps[0] : snaps.find((s) => s.label === label);
  if (!snap) throw new Error(`snapshot '${label}' not found — see \`niral snapshot list\``);
  // safety net: snapshot the live state before overwriting it
  snapshot(root, { reason: "pre-restore" });
  const restored = [];
  for (const f of snap.files) {
    if (only && !only.includes(f)) continue;
    const src = join(snap.dir, f);
    const dest = join(root, "data", f);
    if (!existsSync(src)) continue;
    copyFileSync(src, dest);
    // drop any -wal/-shm so the restored file is authoritative
    for (const ext of ["-wal", "-shm"]) rmSync(dest + ext, { force: true });
    restored.push(f);
  }
  return { restored, from: snap.label };
}

/**
 * Roll dist/current back to the previous release (or a named hash).
 * Atomic symlink flip — the same mechanism a deploy uses. Returns
 * { from, to }. Caller restarts the server to serve the rolled-back release.
 */
export function rollbackRelease(distDir, { toHash = null } = {}) {
  const dist = resolve(distDir);
  const releasesDir = join(dist, "releases");
  if (!existsSync(releasesDir)) throw new Error("no releases/ found — nothing to roll back to");
  const current = existsSync(join(dist, "current")) ? basename(readlinkSync(join(dist, "current"))) : null;
  const all = readdirSync(releasesDir)
    .filter((n) => statSync(join(releasesDir, n)).isDirectory())
    .map((n) => ({ n, mtime: statSync(join(releasesDir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  let target = toHash;
  if (!target) {
    const prev = all.find((r) => r.n !== current);
    if (!prev) throw new Error("no previous release to roll back to");
    target = prev.n;
  }
  if (!existsSync(join(releasesDir, target))) throw new Error(`release ${target} not found`);
  const tmp = join(dist, `.current.${process.pid}.${Date.now()}`);
  symlinkSync(join("releases", target), tmp);
  renameSync(tmp, join(dist, "current")); // atomic
  return { from: current, to: target };
}

/**
 * Rotate NIRAL_SECRET in an env file — every existing session becomes invalid
 * immediately (signatures no longer verify), evicting any attacker who stole a
 * cookie. Returns the new secret. The caller restarts the server to load it.
 */
export function rotateSecret(envPath) {
  const secret = randomBytes(32).toString("hex");
  let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (/^NIRAL_SECRET=/m.test(text)) text = text.replace(/^NIRAL_SECRET=.*$/m, `NIRAL_SECRET=${secret}`);
  else text += (text.endsWith("\n") || text === "" ? "" : "\n") + `NIRAL_SECRET=${secret}\n`;
  writeFileSync(envPath, text);
  return secret;
}
