/**
 * Streaming SSR benchmark — time-to-first-byte with a slow data source.
 *
 * The end-to-end bench (../e2e) measures steady-state throughput on a fixed
 * page. This one measures the thing STREAMING is for: how fast the browser
 * sees SOMETHING when part of the page depends on slow data.
 *
 * Each framework serves two routes that both need a value which takes
 * BENCH_DELAY ms to produce:
 *
 *   /blocking   — awaits the slow value before sending anything (baseline)
 *   /streaming  — flushes the shell immediately, streams the value on settle
 *                   · niral      <script stream> + {#await}
 *                   · next       <Suspense> + async server component
 *                   · sveltekit  promise returned from load() + {#await}
 *
 * Measured per route (median of N timed requests, over raw node:http so we see
 * the real chunk timeline):
 *
 *   TTFB      time to the first response byte
 *   shell     time until "SHELL READY" has arrived (above-the-fold content)
 *   data      time until the slow value ("STREAMED-OK") has arrived
 *   total     time to the last byte
 *
 * The win is TTFB/shell: streaming should show them near zero while the
 * blocking baseline can't beat the delay. `total` stays ~delay for both.
 *
 *   node run.js            (builds all three from ../e2e/apps, then measures)
 *   BENCH_DELAY=500 node run.js
 */

import { spawn, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const e2e = join(here, "..", "e2e");
const root = join(here, "..", "..");
const bin = (name) => join(e2e, "node_modules", ".bin", name);

const DELAY = Number(process.env.BENCH_DELAY ?? 300);
const ITER = Number(process.env.BENCH_ITER ?? 25);
const WARMUP = 5;

const FRAMEWORKS = [
  {
    name: "niral",
    port: 4711,
    clean: () => rmSync(join(e2e, "apps", "niral", "dist"), { recursive: true, force: true }),
    build: () => run("node", [join(root, "bin", "niral.js"), "build", join(e2e, "apps", "niral")]),
    start: () => spawnServer("node", [join(root, "bin", "niral.js"), "start", join(e2e, "apps", "niral"), "-p", "4711"]),
  },
  {
    name: "next",
    port: 4712,
    clean: () => rmSync(join(e2e, "apps", "next", ".next"), { recursive: true, force: true }),
    build: () => run(bin("next"), ["build", join(e2e, "apps", "next")]),
    start: () => spawnServer(bin("next"), ["start", join(e2e, "apps", "next"), "-p", "4712"]),
  },
  {
    name: "sveltekit",
    port: 4713,
    clean: () => {
      rmSync(join(e2e, "apps", "sveltekit", "build"), { recursive: true, force: true });
      rmSync(join(e2e, "apps", "sveltekit", ".svelte-kit"), { recursive: true, force: true });
    },
    build: () => run(bin("vite"), ["build"], join(e2e, "apps", "sveltekit")),
    start: () => spawnServer("node", [join(e2e, "apps", "sveltekit", "build", "index.js")], { PORT: "4713" }),
  },
];

function run(cmd, args, cwd = e2e) {
  execSync([cmd, ...args].map((s) => `'${s}'`).join(" "), {
    cwd,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "production", BENCH_DELAY: String(DELAY) },
  });
}

function spawnServer(cmd, args, env = {}) {
  return spawn(cmd, args, {
    cwd: e2e,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production", BENCH_DELAY: String(DELAY), ...env },
  });
}

async function waitUp(url, timeoutMs = 60_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        await res.arrayBuffer();
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`server at ${url} never came up`);
}

/** One timed request over raw http — records when each landmark arrives. */
function timeRequest(port, path) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let ttfb = null, shell = null, data = null, buf = "";
    const req = http.request({ host: "localhost", port, path, headers: { "accept-encoding": "identity" } }, (res) => {
      res.on("data", (c) => {
        const now = performance.now() - t0;
        if (ttfb == null) ttfb = now;
        buf += c.toString("utf8");
        if (shell == null && buf.includes("SHELL READY")) shell = now;
        if (data == null && buf.includes("STREAMED-OK")) data = now;
      });
      res.on("end", () => resolve({ ttfb, shell, data, total: performance.now() - t0, status: res.statusCode, ok: buf.includes("STREAMED-OK") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

async function measure(port, path) {
  const runs = [];
  for (let i = 0; i < ITER; i++) {
    const r = await timeRequest(port, path);
    if (i >= WARMUP) runs.push(r);
  }
  const anyMissing = runs.some((r) => !r.ok || r.status !== 200);
  return {
    ttfb: median(runs.map((r) => r.ttfb)),
    shell: median(runs.map((r) => r.shell)),
    data: median(runs.map((r) => r.data)),
    total: median(runs.map((r) => r.total)),
    ok: !anyMissing,
  };
}

async function stop(child) {
  if (!child || child.exitCode != null) return;
  const gone = new Promise((r) => child.on("exit", r));
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]);
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}

const results = [];
for (const fw of FRAMEWORKS) {
  process.stdout.write(`\n── ${fw.name} ${"─".repeat(46 - fw.name.length)}\n`);
  let child = null;
  try {
    fw.clean();
    process.stdout.write("  building… ");
    fw.build();
    process.stdout.write("done\n");
    child = fw.start();
    await waitUp(`http://localhost:${fw.port}/`);

    process.stdout.write(`  /blocking … `);
    const blocking = await measure(fw.port, "/blocking");
    process.stdout.write(`ttfb ${Math.round(blocking.ttfb)}ms\n`);

    process.stdout.write(`  /streaming… `);
    const streaming = await measure(fw.port, "/streaming");
    process.stdout.write(`ttfb ${Math.round(streaming.ttfb)}ms\n`);

    results.push({ name: fw.name, blocking, streaming });
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    results.push({ name: fw.name, failed: e.message });
  } finally {
    await stop(child);
  }
}

/* ── scoreboard ── */
const ms = (n) => (n == null ? "—" : `${Math.round(n)}ms`);
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${"═".repeat(64)}`);
console.log(`STREAMING SSR · slow value = ${DELAY}ms · median of ${ITER - WARMUP} reqs · node ${process.versions.node}\n`);
console.log(pad("framework", 12) + pad("route", 11) + pad("TTFB", 9) + pad("shell", 9) + pad("data", 9) + "total");
for (const r of results) {
  if (r.failed) { console.log(pad(r.name, 12) + `FAILED — ${r.failed}`); continue; }
  for (const [route, m] of [["blocking", r.blocking], ["streaming", r.streaming]]) {
    console.log(
      pad(r.name, 12) + pad(route, 11) + pad(ms(m.ttfb), 9) + pad(ms(m.shell), 9) + pad(ms(m.data), 9) + ms(m.total) + (m.ok ? "" : "  ⚠ incomplete")
    );
  }
}
console.log(`\nStreaming wins on TTFB/shell (shell before the ${DELAY}ms data); total stays ~${DELAY}ms for both.\n`);
