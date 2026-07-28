/**
 * End-to-end production-server benchmark: niral vs Next.js vs SvelteKit.
 *
 * Everything a request actually goes through — the framework's OWN production
 * server, over real HTTP, dynamic SSR on every request (no prerender, no
 * cache), the SAME 1000-row page used by the hydration bench.
 *
 * Measured per framework:
 *   build time        production build, cold (build dirs wiped first)
 *   cold start        process spawn → first 200 response
 *   throughput        autocannon 10s × 100 connections (after 2s warmup)
 *   latency           p50 / p99 under that load
 *   page size         identity + gzip transfer size
 *   memory            RSS (process tree) right after the load test
 *
 *   npm install && node run.js
 */

import { spawn, execSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";

const here = dirname(fileURLToPath(import.meta.url));
const bin = (name) => join(here, "node_modules", ".bin", name);
const DURATION = Number(process.env.BENCH_DURATION ?? 10);
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 100);

const FRAMEWORKS = [
  {
    name: "niral",
    port: 4701,
    clean: () => rmSync(join(here, "apps", "niral", "dist"), { recursive: true, force: true }),
    build: () => run("node", [join(here, "..", "..", "bin", "niral.js"), "build", "apps/niral"]),
    start: () => spawnServer("node", [join(here, "..", "..", "bin", "niral.js"), "start", "apps/niral", "-p", "4701"]),
  },
  {
    name: "next",
    port: 4702,
    clean: () => rmSync(join(here, "apps", "next", ".next"), { recursive: true, force: true }),
    build: () => run(bin("next"), ["build", "apps/next"]),
    start: () => spawnServer(bin("next"), ["start", "apps/next", "-p", "4702"]),
  },
  {
    name: "sveltekit",
    port: 4703,
    clean: () => {
      rmSync(join(here, "apps", "sveltekit", "build"), { recursive: true, force: true });
      rmSync(join(here, "apps", "sveltekit", ".svelte-kit"), { recursive: true, force: true });
    },
    build: () => run(bin("vite"), ["build"], join(here, "apps", "sveltekit")),
    start: () => spawnServer("node", [join(here, "apps", "sveltekit", "build", "index.js")], { PORT: "4703" }),
  },
];

function run(cmd, args, cwd = here) {
  execSync([cmd, ...args].map((s) => `'${s}'`).join(" "), { cwd, stdio: "pipe", env: { ...process.env, NODE_ENV: "production" } });
}

function spawnServer(cmd, args, env = {}) {
  return spawn(cmd, args, {
    cwd: here,
    detached: true, // own process group — kill takes children with it
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production", ...env },
  });
}

async function waitFor200(url, timeoutMs = 60_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        await res.arrayBuffer();
        return performance.now() - t0;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`server at ${url} never answered`);
}

/** RSS of a process AND its descendants, in MB (Next may fork workers). */
function treeRssMb(pid) {
  try {
    const lines = execSync("ps -axo pid=,ppid=,rss=", { encoding: "utf8" }).trim().split("\n");
    const rows = lines.map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Map();
    for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) ?? []), p]);
    let total = 0;
    const stack = [pid];
    const rssOf = new Map(rows.map(([p, , rss]) => [p, rss]));
    while (stack.length) {
      const p = stack.pop();
      total += rssOf.get(p) ?? 0;
      stack.push(...(kids.get(p) ?? []));
    }
    return Math.round(total / 1024);
  } catch {
    return null;
  }
}

async function pageBytes(url) {
  const identity = await fetch(url, { headers: { "accept-encoding": "identity" } });
  const raw = (await identity.arrayBuffer()).byteLength;
  // measure the compressed wire size ourselves — fetch auto-decompresses bodies
  const { request } = await import("node:http");
  const gz = await new Promise((resolve) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, headers: { "accept-encoding": "gzip" } }, (res) => {
      let n = 0;
      res.on("data", (c) => (n += c.length));
      res.on("end", () => resolve(res.headers["content-encoding"] === "gzip" ? n : null));
    });
    req.on("error", () => resolve(null));
    req.end();
  });
  return { raw, gz };
}

async function stop(child) {
  if (child.exitCode != null) return;
  const gone = new Promise((r) => child.on("exit", r));
  try {
    process.kill(-child.pid, "SIGTERM"); // whole process group
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

const results = [];
for (const fw of FRAMEWORKS) {
  process.stdout.write(`\n── ${fw.name} ${"─".repeat(50 - fw.name.length)}\n`);
  let child = null;
  try {
    fw.clean();
    process.stdout.write("  building… ");
    const b0 = performance.now();
    fw.build();
    const buildMs = Math.round(performance.now() - b0);
    process.stdout.write(`${(buildMs / 1000).toFixed(1)}s\n`);

    const url = `http://localhost:${fw.port}/`;
    process.stdout.write("  cold start… ");
    child = fw.start();
    const coldMs = Math.round(await waitFor200(url));
    process.stdout.write(`${coldMs}ms\n`);

    // sanity: this is the SAME dynamic page everywhere
    const html = await (await fetch(url)).text();
    if (!html.includes("row item number 999")) throw new Error("page is missing its rows — not comparable");
    if (!html.includes("row item number 0")) throw new Error("page truncated");

    process.stdout.write("  warmup… ");
    await autocannon({ url, connections: 50, duration: 2 });
    process.stdout.write("done\n");

    process.stdout.write(`  load test ${DURATION}s × ${CONNECTIONS} connections… `);
    const r = await autocannon({ url, connections: CONNECTIONS, duration: DURATION, pipelining: 1 });
    process.stdout.write(`${Math.round(r.requests.average)} req/s\n`);

    const rss = treeRssMb(child.pid);
    const bytes = await pageBytes(url);

    results.push({
      name: fw.name,
      buildMs,
      coldMs,
      rps: Math.round(r.requests.average),
      p50: r.latency.p50,
      p99: r.latency.p99,
      errors: r.errors + r.non2xx,
      rss,
      raw: bytes.raw,
      gz: bytes.gz,
    });
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    results.push({ name: fw.name, failed: e.message });
  } finally {
    if (child) await stop(child);
  }
}

/* ── scoreboard ── */
const kb = (n) => (n == null ? "—" : `${(n / 1024).toFixed(1)} KB`);
console.log(`\n${"═".repeat(60)}\nEND-TO-END · dynamic SSR · ${CONNECTIONS} conns × ${DURATION}s · node ${process.versions.node}\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("framework", 11) + pad("req/s", 8) + pad("p50", 7) + pad("p99", 7) + pad("cold", 8) + pad("build", 8) + pad("rss", 8) + pad("page", 10) + "gzip"
);
for (const r of results) {
  if (r.failed) {
    console.log(pad(r.name, 11) + `FAILED — ${r.failed}`);
    continue;
  }
  console.log(
    pad(r.name, 11) +
      pad(r.rps, 8) +
      pad(`${r.p50}ms`, 7) +
      pad(`${r.p99}ms`, 7) +
      pad(`${r.coldMs}ms`, 8) +
      pad(`${(r.buildMs / 1000).toFixed(1)}s`, 8) +
      pad(r.rss ? `${r.rss}MB` : "—", 8) +
      pad(kb(r.raw), 10) +
      kb(r.gz)
  );
}
console.log(`\nerrors/non-2xx: ${results.map((r) => `${r.name}=${r.failed ? "n/a" : r.errors}`).join("  ")}`);
