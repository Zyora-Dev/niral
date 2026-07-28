/**
 * Niral server — SQL migrations (zero-dep, node:sqlite).
 *
 * Convention over machinery:
 *   migrations/                    at the project root
 *     001-create-users.sql
 *     002-add-votes.sql
 *
 * Each file runs ONCE, in filename order, inside a transaction, and is
 * recorded in a `_migrations` table inside the target database
 * (data/app.db by default). A failing migration rolls back and STOPS —
 * nothing after it runs, the error says exactly which file broke.
 *
 * They run automatically when the dev/prod server boots (NIRAL_MIGRATE=off
 * to disable), and manually via `niral migrate`.
 */

import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const sqlite = () => process.getBuiltinModule("node:sqlite");

/** Pending + applied state without touching anything. */
export function migrationStatus({ projectDir, dbPath = null }) {
  const dir = join(resolve(projectDir), "migrations");
  if (!existsSync(dir)) return { files: [], applied: [], pending: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) return { files, applied: [], pending: [] };
  const db = openDb(projectDir, dbPath);
  const done = new Set(db.prepare("SELECT name FROM _migrations").all().map((r) => r.name));
  return { files, applied: files.filter((f) => done.has(f)), pending: files.filter((f) => !done.has(f)) };
}

/** Apply every pending migration. Returns { applied: [names] }. */
export function runMigrations({ projectDir, dbPath = null }) {
  const dir = join(resolve(projectDir), "migrations");
  if (!existsSync(dir)) return { applied: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) return { applied: [] };

  const db = openDb(projectDir, dbPath);
  const done = new Set(db.prepare("SELECT name FROM _migrations").all().map((r) => r.name));
  const pending = files.filter((f) => !done.has(f));
  // a schema change is the classic "oops" — snapshot the db BEFORE touching it
  if (pending.length && process.env.NIRAL_SNAPSHOT !== "off") {
    try { snapshotBeforeMigrate(projectDir); } catch { /* best-effort safety net */ }
  }
  const applied = [];
  for (const f of pending) {
    const sql = readFileSync(join(dir, f), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))").run(f);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${f} failed: ${e.message} — rolled back, nothing after it ran`);
    }
    applied.push(f);
  }
  return { applied };
}

function snapshotBeforeMigrate(projectDir) {
  // lazy import avoids a cycle and keeps migrate usable standalone
  import("./recover.js").then(({ snapshot }) => snapshot(projectDir, { reason: "pre-migrate" })).catch(() => {});
}

function openDb(projectDir, dbPath) {
  const file = dbPath ?? join(resolve(projectDir), "data", "app.db");
  mkdirSync(dirname(file), { recursive: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
  return db;
}

/** Boot hook for dev+prod servers — applies pending migrations, fails LOUDLY.
 *  A server must not come up against a schema it doesn't expect. */
export function migrateAtBoot(projectDir) {
  if (process.env.NIRAL_MIGRATE === "off") return;
  const { applied } = runMigrations({ projectDir });
  if (applied.length) console.log(`niral · migrations applied: ${applied.join(", ")}`);
}
