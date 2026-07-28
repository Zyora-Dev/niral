/**
 * Niral server — background jobs + cron (the gap every JS framework punts
 * to paid services).
 *
 *   // jobs.js (project root)
 *   export const jobs = {
 *     async sendWelcome({ email }) { await mail({ to: email, ... }) },
 *     async cleanup() { ... },
 *   };
 *   export const schedules = [
 *     { cron: "0-59/5 * * * *", job: "cleanup" },   // every 5 minutes
 *   ];
 *
 *   // any <server> block:
 *   enqueue("sendWelcome", { email }, { delay: 60_000 })
 *
 * DURABLE: the queue lives in data/jobs.db (node:sqlite) — jobs survive
 * restarts and deploys (data/ sits outside releases by design). Failures
 * retry with exponential backoff; exhausted jobs land in a dead-letter
 * state for inspection, never silently vanish.
 *
 * PERFORMANCE: zero request-path cost — one timer that sleeps until the
 * next due job. Run workers in-process (default) or as a separate process
 * (`niral jobs`) for CPU-heavy work; NIRAL_JOBS=off disables in-server
 * processing when a dedicated worker owns the queue.
 */

import { existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* ── cron (5-field: minute hour day-of-month month day-of-week) ── */

function parseField(field, min, max) {
  const out = new Set();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron: bad step '${part}'`);
    let lo = min;
    let hi = max;
    if (rangePart !== "*" && rangePart !== "") {
      const [a, b] = rangePart.split("-").map(Number);
      if (!Number.isInteger(a)) throw new Error(`cron: bad field '${part}'`);
      lo = a;
      hi = b !== undefined ? b : stepPart ? max : a;
      if (b !== undefined && !Number.isInteger(b)) throw new Error(`cron: bad range '${part}'`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron: expected 5 fields, got '${expr}'`);
  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dom: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dow: parseField(fields[4], 0, 6), // 0 = Sunday
  };
}

/** The next time (ms epoch) a cron expression fires, strictly after `from`. */
export function nextCronTime(expr, from = Date.now()) {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let guard = 0; guard < 366 * 24 * 60; guard++) {
    if (
      c.minute.has(d.getMinutes()) &&
      c.hour.has(d.getHours()) &&
      c.dom.has(d.getDate()) &&
      c.month.has(d.getMonth() + 1) &&
      c.dow.has(d.getDay())
    ) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  throw new Error(`cron: '${expr}' never fires`);
}

/* ── the runner ── */

const BACKOFF = (attempt) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000); // 30s → 1h cap

export async function createJobRunner({ projectDir, dbPath, log = console } = {}) {
  const jobsFile = join(projectDir, "jobs.js");
  if (!existsSync(jobsFile)) return null; // no jobs.js — nothing to run

  const { DatabaseSync } = await import("node:sqlite");
  const file = dbPath ?? join(projectDir, "data", "jobs.db");
  mkdirSync(join(projectDir, "data"), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      run_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | dead
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, run_at);
  `);
  // a previous process may have died mid-job — those must run again
  db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();

  let mod = null;
  let modMtime = 0;
  async function handlers() {
    const mtimeMs = statSync(jobsFile).mtimeMs;
    if (!mod || mtimeMs !== modMtime) {
      mod = await import(pathToFileURL(jobsFile).href + "?v=" + mtimeMs);
      modMtime = mtimeMs;
    }
    return mod;
  }

  let timer = null;
  let working = false;
  let stopped = false;
  let current = Promise.resolve();

  function enqueue(name, data = {}, { delay = 0, maxAttempts = 3 } = {}) {
    if (typeof name !== "string" || !name) throw new Error("enqueue: job name required");
    db.prepare("INSERT INTO jobs (name, data, run_at, max_attempts, created_at) VALUES (?, ?, ?, ?, ?)").run(
      name, JSON.stringify(data ?? {}), Date.now() + delay, maxAttempts, Date.now()
    );
    wake();
  }

  function wake() {
    if (stopped || working) return;
    clearTimeout(timer);
    const next = db.prepare("SELECT MIN(run_at) AS t FROM jobs WHERE status = 'queued'").get()?.t;
    if (next == null) return; // sleep until enqueue() wakes us
    timer = setTimeout(tick, Math.max(0, Number(next) - Date.now()));
    timer.unref?.();
  }

  async function tick() {
    if (stopped || working) return;
    working = true;
    current = (async () => {
      for (;;) {
        const row = db
          .prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 1")
          .get(Date.now());
        if (!row) break;
        db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?").run(row.id);
        try {
          const m = await handlers();
          const fn = m.jobs?.[row.name];
          if (typeof fn !== "function") throw new Error(`no job named '${row.name}' in jobs.js`);
          await fn(JSON.parse(row.data));
          db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(row.id);
        } catch (e) {
          const attempts = row.attempts + 1;
          if (attempts >= row.max_attempts) {
            db.prepare("UPDATE jobs SET status = 'dead', last_error = ? WHERE id = ?").run(String(e?.message ?? e), row.id);
            log.error(`niral · job '${row.name}' #${row.id} DEAD after ${attempts} attempts: ${e?.message ?? e}`);
          } else {
            db.prepare("UPDATE jobs SET status = 'queued', run_at = ?, last_error = ? WHERE id = ?").run(
              Date.now() + BACKOFF(attempts), String(e?.message ?? e), row.id
            );
          }
        }
        if (stopped) break;
      }
    })();
    await current;
    working = false;
    wake();
  }

  /* cron schedules */
  const cronTimers = [];
  async function armCron() {
    const m = await handlers();
    for (const s of m.schedules ?? []) {
      const arm = () => {
        const at = nextCronTime(s.cron);
        const t = setTimeout(async () => {
          try {
            enqueue(s.job, s.data ?? {}, { maxAttempts: s.maxAttempts ?? 1 });
          } finally {
            arm(); // always re-arm
          }
        }, at - Date.now());
        t.unref?.();
        cronTimers.push(t);
      };
      nextCronTime(s.cron); // validate loudly at boot
      arm();
    }
  }
  await armCron();
  wake(); // pick up anything left over from before the restart

  const runner = {
    enqueue,
    /** Test/ops helpers */
    stats() {
      const rows = db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },
    dead() {
      return db.prepare("SELECT id, name, data, attempts, last_error FROM jobs WHERE status = 'dead'").all();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      for (const t of cronTimers) clearTimeout(t);
      await current; // let the in-flight job finish
      db.close();
    },
  };
  globalThis.__niralEnqueue = enqueue; // ambient enqueue() in server blocks
  return runner;
}
