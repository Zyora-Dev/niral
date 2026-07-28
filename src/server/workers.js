/**
 * Niral server — language worker pool (the Node side of NBP).
 *
 * One persistent process per (language, server module). Requests are
 * newline-delimited JSON over stdio, correlated by id. Crashed workers are
 * dropped and respawn on the next call. Module-level state in the worker
 * persists across calls — exactly like JS <server> blocks.
 */

import { spawn } from "node:child_process";

/** How each language's worker process starts. `file` is the materialized
 *  server module (source file for interpreted languages, compiled binary
 *  for Go — polyglot.materialize() runs `go build`). */
const LANG_SPAWN = {
  python: (runner, file) => ({ cmd: "python3", args: [runner, file] }),
  ruby: (runner, file) => ({ cmd: "ruby", args: [runner, file] }),
  go: (_runner, file) => ({ cmd: file, args: [] }),
};
const NEEDS_RUNNER = new Set(["python", "ruby"]);
const CALL_TIMEOUT = 30_000;

/**
 * @param {object} opts { runners: { python: "/abs/path/runner.py" }, cwd, size }
 *   cwd  = the project root — relative paths in server code (e.g. sqlite files
 *          under data/) resolve against it and survive deploys.
 *   size = workers per (lang, module). Default 1 — module-level state stays
 *          consistent. Opt into N (or env NIRAL_WORKERS) for CPU-bound server
 *          code, accepting that in-memory module state diverges per worker
 *          (state in a database is unaffected).
 */
export function createWorkerPool({ runners = {}, cwd = process.cwd(), size } = {}) {
  const poolSize = Math.max(1, Number(size ?? process.env.NIRAL_WORKERS ?? 1));
  const workers = new Map(); // `${lang}\0${file}\0${i}` → worker
  const rr = new Map(); // `${lang}\0${file}` → round-robin counter

  function get(lang, file) {
    const groupKey = `${lang}\0${file}`;
    const i = (rr.get(groupKey) ?? 0) % poolSize;
    rr.set(groupKey, i + 1);
    const key = `${groupKey}\0${i}`;
    let w = workers.get(key);
    if (w) return w;

    const runner = runners[lang];
    const spec = LANG_SPAWN[lang];
    if (!spec) throw new Error(`no runner configured for <server lang="${lang}">`);
    if (NEEDS_RUNNER.has(lang) && !runner) throw new Error(`no runner configured for <server lang="${lang}">`);
    const { cmd, args } = spec(runner, file);

    const proc = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "inherit"] });
    w = { proc, nextId: 1, pending: new Map(), buf: "" };

    proc.stdout.on("data", (chunk) => {
      w.buf += chunk.toString("utf8");
      let nl;
      while ((nl = w.buf.indexOf("\n")) !== -1) {
        const line = w.buf.slice(0, nl);
        w.buf = w.buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        // out-of-band publish from a server function (any language)
        if (msg && msg.publish && typeof msg.publish.channel === "string") {
          globalThis.__niralPublish?.(msg.publish.channel, msg.publish.data);
          continue;
        }
        const p = w.pending.get(msg.id);
        if (p) {
          w.pending.delete(msg.id);
          p.resolve(msg);
        }
      }
    });

    const fail = (err) => {
      for (const p of w.pending.values()) p.reject(err);
      w.pending.clear();
      if (workers.get(key) === w) workers.delete(key);
    };
    proc.on("error", (e) =>
      fail(
        e.code === "ENOENT"
          ? new Error(`'${cmd}' not found — install it to use <server lang="${lang}">`)
          : e
      )
    );
    proc.on("exit", (code) => fail(new Error(`${lang} worker exited (code ${code})`)));

    workers.set(key, w);
    return w;
  }

  return {
    /** Call fn in the worker for (lang, file). Resolves the raw NBP response. */
    call(lang, file, fn, args, session) {
      const w = get(lang, file);
      const id = w.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          w.pending.delete(id);
          reject(new Error(`${lang} worker timed out on '${fn}'`));
        }, CALL_TIMEOUT);
        w.pending.set(id, {
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        try {
          w.proc.stdin.write(JSON.stringify({ id, fn, args, session }) + "\n");
        } catch (e) {
          clearTimeout(timer);
          w.pending.delete(id);
          reject(e);
        }
      });
    },

    /** Kill the worker(s) for a server module — fresh code loads on next call. */
    invalidate(file) {
      for (const [key, w] of workers) {
        if (key.includes(`\0${file}\0`)) {
          w.proc.kill();
          workers.delete(key);
        }
      }
    },

    stopAll() {
      for (const [, w] of workers) w.proc.kill();
      workers.clear();
    },
  };
}
