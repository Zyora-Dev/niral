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

  // Storage: SQLite by default (one file, single box). Set NIRAL_JOBS_STORE=pg
  // (+ NIRAL_DATABASE_URL) for a SHARED Postgres queue — any node enqueues, any
  // worker claims a job atomically (SELECT … FOR UPDATE SKIP LOCKED), and cron
  // fires once across the cluster via an advisory-lock leader. Same jobs.js,
  // same API — SQLite stays the default so single-box apps change nothing.
  const usePg = process.env.NIRAL_JOBS_STORE === "pg" && !!process.env.NIRAL_DATABASE_URL;
  const store = usePg
    ? await makePgStore({ url: process.env.NIRAL_DATABASE_URL, log })
    : await makeSqliteStore({ projectDir, dbPath });

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

  async function enqueue(name, data = {}, { delay = 0, maxAttempts = 3 } = {}) {
    if (typeof name !== "string" || !name) throw new Error("enqueue: job name required");
    await store.enqueue(name, JSON.stringify(data ?? {}), Date.now() + delay, maxAttempts);
    wake();
  }

  async function wake() {
    if (stopped || working) return;
    clearTimeout(timer);
    const next = await store.nextRunAt();
    if (stopped || next == null) return; // sleep until enqueue() wakes us
    timer = setTimeout(tick, Math.max(0, next - Date.now()));
    timer.unref?.();
  }

  async function tick() {
    if (stopped || working) return;
    working = true;
    current = (async () => {
      for (;;) {
        const row = await store.claimDue(Date.now()); // atomic: marks running, ++attempts
        if (!row) break;
        try {
          const m = await handlers();
          const fn = m.jobs?.[row.name];
          if (typeof fn !== "function") throw new Error(`no job named '${row.name}' in jobs.js`);
          await fn(JSON.parse(row.data));
          await store.complete(row.id);
        } catch (e) {
          if (row.attempts >= row.max_attempts) {
            await store.markDead(row.id, String(e?.message ?? e));
            log.error(`niral · job '${row.name}' #${row.id} DEAD after ${row.attempts} attempts: ${e?.message ?? e}`);
          } else {
            await store.requeue(row.id, Date.now() + BACKOFF(row.attempts), String(e?.message ?? e));
          }
        }
        if (stopped) break;
      }
    })();
    await current;
    working = false;
    await wake();
  }

  /* cron schedules — with the Postgres store, only ONE node (the advisory-lock
     leader) arms them, so a schedule fires once across the whole cluster. */
  const cronTimers = [];
  let cronArmed = false;
  async function armCron() {
    if (cronArmed || stopped) return;
    const m = await handlers();
    const scheds = m.schedules ?? [];
    if (!scheds.length) return;
    if (usePg && !(await store.tryCronLeader())) {
      // another node owns cron — retry later in case it dies and frees the lock
      const t = setTimeout(() => armCron().catch(() => {}), 15_000);
      t.unref?.();
      cronTimers.push(t);
      return;
    }
    cronArmed = true;
    if (usePg) log.log?.("niral · cron leader elected on this node");
    for (const s of scheds) {
      const arm = () => {
        const at = nextCronTime(s.cron);
        const t = setTimeout(async () => {
          try {
            await enqueue(s.job, s.data ?? {}, { maxAttempts: s.maxAttempts ?? 1 });
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
  await store.requeueStale(); // reclaim jobs abandoned by a crashed worker
  await armCron();
  await wake(); // pick up anything left over from before the restart

  // Shared Postgres queue: an enqueue on ANOTHER node doesn't fire our local
  // wake(), so each node polls the table for due work. Local enqueues still
  // wake instantly. Tune/disable with NIRAL_JOBS_POLL_MS.
  let pollTimer = null;
  if (usePg) {
    pollTimer = setInterval(() => { if (!stopped && !working) tick().catch(() => {}); }, Number(process.env.NIRAL_JOBS_POLL_MS) || 2000);
    pollTimer.unref?.();
  }

  const runner = {
    enqueue,
    /** Test/ops helpers (sync value for SQLite, a promise for Postgres). */
    stats() { return store.stats(); },
    dead() { return store.dead(); },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(pollTimer);
      for (const t of cronTimers) clearTimeout(t);
      await current; // let the in-flight job finish
      await store.close();
    },
  };
  globalThis.__niralEnqueue = enqueue; // ambient enqueue() in server blocks
  return runner;
}

/* ── SQLite store (default) — one file, single box, synchronous ── */

async function makeSqliteStore({ projectDir, dbPath }) {
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
  // a previous single-box process may have died mid-job — those must run again
  db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();
  return {
    requeueStale() { db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run(); },
    enqueue(name, data, runAt, maxAttempts) {
      db.prepare("INSERT INTO jobs (name, data, run_at, max_attempts, created_at) VALUES (?, ?, ?, ?, ?)").run(name, data, runAt, maxAttempts, Date.now());
    },
    nextRunAt() { const t = db.prepare("SELECT MIN(run_at) AS t FROM jobs WHERE status = 'queued'").get()?.t; return t == null ? null : Number(t); },
    claimDue(now) {
      const row = db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 1").get(now);
      if (!row) return null;
      db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?").run(row.id);
      return { id: row.id, name: row.name, data: row.data, attempts: row.attempts + 1, max_attempts: row.max_attempts };
    },
    complete(id) { db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(id); },
    markDead(id, err) { db.prepare("UPDATE jobs SET status = 'dead', last_error = ? WHERE id = ?").run(err, id); },
    requeue(id, runAt, err) { db.prepare("UPDATE jobs SET status = 'queued', run_at = ?, last_error = ? WHERE id = ?").run(runAt, err, id); },
    tryCronLeader() { return true; }, // single writer → always the leader
    stats() { const rows = db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all(); return Object.fromEntries(rows.map((r) => [r.status, r.n])); },
    dead() { return db.prepare("SELECT id, name, data, attempts, last_error FROM jobs WHERE status = 'dead'").all(); },
    close() { db.close(); },
  };
}

/* ── Postgres store — SHARED queue for a cluster (zero-dep pg driver) ──
   Any node enqueues; any worker claims one job atomically via FOR UPDATE SKIP
   LOCKED (never the same job twice); crashed-worker jobs are reclaimed after a
   stale window; cron runs on one node via a session advisory lock. */

async function makePgStore({ url, log }) {
  const { pgPool, pgConnect } = await import("./postgres.js");
  const pool = pgPool(url, { max: 4 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS niral_jobs (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      run_at BIGINT NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'queued',
      last_error TEXT,
      locked_at BIGINT,
      created_at BIGINT NOT NULL
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS niral_jobs_due ON niral_jobs (status, run_at)");
  const STALE_MS = 10 * 60 * 1000; // reclaim jobs a dead worker was running past this
  const CRON_KEY = 728301; // arbitrary advisory-lock key for the cron leader
  let leaderConn = null;
  return {
    async requeueStale() {
      await pool.query("UPDATE niral_jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND (locked_at IS NULL OR locked_at < $1)", [Date.now() - STALE_MS]);
    },
    async enqueue(name, data, runAt, maxAttempts) {
      await pool.query("INSERT INTO niral_jobs (name, data, run_at, attempts, max_attempts, status, created_at) VALUES ($1, $2, $3, 0, $4, 'queued', $5)", [name, data, runAt, maxAttempts, Date.now()]);
    },
    async nextRunAt() {
      const r = await pool.query("SELECT MIN(run_at) AS t FROM niral_jobs WHERE status = 'queued'");
      const t = r.rows[0]?.t;
      return t == null ? null : Number(t);
    },
    async claimDue(now) {
      const r = await pool.query(
        `UPDATE niral_jobs SET status = 'running', attempts = attempts + 1, locked_at = $2
         WHERE id = (SELECT id FROM niral_jobs WHERE status = 'queued' AND run_at <= $1 ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id, name, data, attempts, max_attempts`,
        [now, Date.now()]
      );
      const row = r.rows[0];
      if (!row) return null;
      return { id: row.id, name: row.name, data: row.data, attempts: Number(row.attempts), max_attempts: Number(row.max_attempts) };
    },
    async complete(id) { await pool.query("UPDATE niral_jobs SET status = 'done' WHERE id = $1", [id]); },
    async markDead(id, err) { await pool.query("UPDATE niral_jobs SET status = 'dead', last_error = $1 WHERE id = $2", [err, id]); },
    async requeue(id, runAt, err) { await pool.query("UPDATE niral_jobs SET status = 'queued', run_at = $1, last_error = $2, locked_at = NULL WHERE id = $3", [runAt, err, id]); },
    async tryCronLeader() {
      try {
        if (!leaderConn || leaderConn.closed) leaderConn = await pgConnect(url);
        const r = await leaderConn.query("SELECT pg_try_advisory_lock($1::bigint) AS ok", [CRON_KEY]);
        return r.rows[0]?.ok === true;
      } catch (e) { log.warn?.("niral · cron leader election failed: " + e.message); return false; }
    },
    async stats() {
      const r = await pool.query("SELECT status, COUNT(*)::int AS n FROM niral_jobs GROUP BY status");
      return Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)]));
    },
    async dead() { const r = await pool.query("SELECT id, name, data, attempts, last_error FROM niral_jobs WHERE status = 'dead'"); return r.rows; },
    async close() { try { await pool.end(); } catch {} try { await leaderConn?.end(); } catch {} },
  };
}
