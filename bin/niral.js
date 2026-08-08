#!/usr/bin/env node
/**
 * niral — CLI (v0.1: compile + serve + dev + build + start).
 *
 *   niral compile <file.niral> [-o out.js] [--runtime <import-path>]
 *   niral serve   [dir] [-p port]           tiny static server for built output
 *   niral dev     [dir] [-p port]           dev server: compile-on-demand + HMR + error overlay
 *   niral build   [dir] [-o distdir]        content-hashed release + atomic `current` flip
 *   niral start   [dir] [-p port]           production server for dist/current
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, dirname, basename } from "node:path";
import { compileClient, NiralError } from "../src/index.js";

const [, , cmd, ...args] = process.argv;

/** Flags that take a value — their value must never be mistaken for a positional arg. */
const VALUE_FLAGS = new Set(["-o", "-p", "--port", "--runtime", "--family", "--version", "--model", "--db", "--to", "--env", "--url", "--restart-cmd", "--template"]);

/** Positional args (flag values excluded). `niral dev -p 5199` has none. */
function positionals() {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      if (VALUE_FLAGS.has(args[i])) i++; // skip the flag's value too
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

if (cmd === "compile") {
  const file = positionals()[0];
  if (!file) die("usage: niral compile <file.niral> [-o out.js] [--runtime path]");
  const out = flag("-o") ?? file.replace(/\.niral$/, ".js");
  const runtime = flag("--runtime") ?? "niral/runtime";
  try {
    const source = readFileSync(file, "utf8");
    const { code } = compileClient(source, { filename: basename(file), runtime });
    writeFileSync(out, code);
    console.log(`niral · compiled ${file} → ${out}`);
  } catch (e) {
    if (e instanceof NiralError) {
      console.error("\n" + e.format() + "\n");
      process.exit(1);
    }
    throw e;
  }
} else if (cmd === "serve") {
  const dir = resolve(positionals()[0] ?? ".");
  const port = Number(flag("-p") ?? 4173);
  const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".niral": "text/plain",
  };
  createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(dir, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`niral · serving ${dir} at http://localhost:${port}`));
} else if (cmd === "dev") {
  const dir = resolve(positionals()[0] ?? ".");
  const port = Number(flag("-p") ?? flag("--port") ?? 5199);
  const { createDevServer } = await import("../src/dev/server.js");
  createDevServer({ root: dir, port }).listen();
} else if (cmd === "build") {
  const dir = resolve(positionals()[0] ?? ".");
  const out = flag("-o");
  const { build } = await import("../src/build/build.js");
  try {
    const r = build({ root: dir, out });
    console.log(`niral · built release ${r.hash} (${r.routes} routes) — dist/current flipped`);
  } catch (e) {
    const { NiralError: NE } = await import("../src/index.js");
    if (e instanceof NE) {
      console.error("\n" + e.format() + "\n\nniral · build FAILED — previous release still active");
      process.exit(1);
    }
    console.error(`niral · build FAILED — previous release still active\n  ${e.message}`);
    process.exit(1);
  }
} else if (cmd === "start") {
  const dir = resolve(positionals()[0] ?? ".");
  const port = Number(flag("-p") ?? 8199);
  const { createProdServer } = await import("../src/server/prod.js");
  const dist = existsSync(join(dir, "current")) ? dir : join(dir, "dist");
  const app = createProdServer({ dist, port, cwd: dir });
  app.listen();
  // graceful shutdown — a deploy's `systemctl restart` sends SIGTERM: drain
  // in-flight requests, close live sockets cleanly, THEN exit (no dropped work)
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`niral · ${sig} — draining (in-flight requests finish, live sockets close cleanly)`);
    await app.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
} else if (cmd === "export") {
  const dir = resolve(positionals()[0] ?? ".");
  const out = flag("-o");
  const { exportStatic } = await import("../src/build/export.js");
  try {
    const r = await exportStatic({ root: dir, out });
    console.log(`niral · exported ${r.written.length} page(s) → ${r.outDir}`);
    if (r.skipped.length) console.log(`niral · skipped dynamic routes: ${r.skipped.join(", ")}`);
    if (r.serverDependent.length) {
      console.log(`niral · note: ${r.serverDependent.join(", ")} use <server> — load() data is baked in; RPC/forms need a server`);
    }
  } catch (e) {
    console.error(`niral · export FAILED — ${e.message}`);
    process.exit(1);
  }
} else if (cmd === "jobs") {
  const dir = resolve(positionals()[0] ?? ".");
  const { createJobRunner } = await import("../src/server/jobs.js");
  const runner = await createJobRunner({ projectDir: dir });
  if (!runner) die(`niral · no jobs.js found in ${dir}`);
  console.log(`niral · job worker running (queue + cron) — data/jobs.db — ctrl-c to stop`);
  process.on("SIGINT", async () => {
    await runner.stop();
    process.exit(0);
  });
  setInterval(() => {}, 1 << 30); // stay alive
} else if (cmd === "create") {
  const name = positionals()[0];
  if (!name) die("usage: niral create <app-name> [--template minimal|blog|dashboard]");
  const { createApp } = await import("../src/create.js");
  try {
    createApp({ name, template: flag("--template") ?? "minimal" });
  } catch (e) {
    die(`niral · create failed — ${e.message}`);
  }
} else if (cmd === "migrate") {
  const dir = resolve(positionals()[0] ?? ".");
  const { runMigrations, migrationStatus } = await import("../src/server/migrate.js");
  try {
    const { applied } = runMigrations({ projectDir: dir, dbPath: flag("--db") ?? null });
    const st = migrationStatus({ projectDir: dir, dbPath: flag("--db") ?? null });
    if (applied.length) console.log(`niral · applied: ${applied.join(", ")}`);
    console.log(`niral · migrations: ${st.applied.length}/${st.files.length} applied${st.files.length === 0 ? " — add .sql files to migrations/" : ""}`);
  } catch (e) {
    die(`niral · ${e.message}`);
  }
} else if (cmd === "doctor") {
  const dir = resolve(positionals()[0] ?? ".");
  const { runDoctor, formatDoctor } = await import("../src/doctor.js");
  const result = await runDoctor({ root: dir, security: args.includes("--security") });
  console.log(formatDoctor(result, dir));
  if (!result.ok) process.exit(1);
} else if (cmd === "shield") {
  const SUBS = new Set(["status", "log", "verify", "integrity"]);
  const pos = positionals();
  const sub = SUBS.has(pos[0]) ? pos[0] : "status";
  const dir = resolve((SUBS.has(pos[0]) ? pos[1] : pos[0]) ?? ".");
  const { join } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");
  const dataDir = join(dir, "data");
  if (sub === "verify") {
    const { verifyAuditChain } = await import("../src/server/shield.js");
    const r = verifyAuditChain(dataDir);
    if (r.ok) console.log(`niral shield · audit chain intact — ${r.entries} event(s), tamper-evident`);
    else die(`niral shield · AUDIT CHAIN BROKEN at entry ${r.brokenAt} (${r.reason}) — the log was altered`);
  } else if (sub === "integrity") {
    const { checkIntegrity } = await import("../src/server/integrity.js");
    const rel = existsSync(join(dir, "current")) ? join(dir, "current") : join(dir, "dist", "current");
    if (!existsSync(rel)) die("niral shield · no release found — run `niral build` first");
    const r = checkIntegrity(rel);
    if (r.unavailable) die("niral shield · this release has no integrity manifest (built before v0.2) — rebuild");
    if (r.ok) console.log(`niral shield · integrity OK — ${r.checked} files match the build manifest`);
    else {
      console.error(`niral shield · TAMPERED — ${r.tampered.length} file(s) differ from the build:`);
      for (const t of r.tampered.slice(0, 30)) console.error(`  ${t.kind.padEnd(9)} ${t.path}`);
      process.exit(1);
    }
  } else if (sub === "log" || sub === "status") {
    const file = join(dataDir, "shield.log.jsonl");
    if (!existsSync(file)) { console.log("niral shield · no events recorded yet — the guard is watching"); }
    else {
      const lines = readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean);
      console.log(`niral shield · ${lines.length} event(s) (data/shield.log.jsonl):`);
      for (const l of lines.slice(-20)) {
        try { const e = JSON.parse(l); console.log(`  ${e.t}  ${String(e.event).padEnd(10)} ${e.ip ?? ""} ${e.path ?? ""}`); } catch {}
      }
    }
  } else {
    die(`niral shield <status|log|verify|integrity> [dir]
  status/log   recent shield events (bans, probes, lockdowns)
  verify       check the audit log's hash chain is unbroken
  integrity    re-hash the built release and compare to its manifest`);
  }
} else if (cmd === "snapshot") {
  // local:  snapshot [dir] | snapshot list [dir]
  // remote: snapshot --remote [dir] | snapshot list --remote [dir]
  //         snapshot push <label|latest> [dir]
  const pos = positionals();
  const sub = pos[0] === "list" || pos[0] === "push" ? pos[0] : "create";
  const remote = args.includes("--remote") || sub === "push";
  const dir = resolve((sub === "list" ? pos[1] : sub === "push" ? pos[2] : pos[0]) ?? ".");
  const { snapshot, listSnapshots } = await import("../src/server/recover.js");
  if (sub === "list" && remote) {
    const { listRemoteSnapshots } = await import("../src/server/remote-snapshot.js");
    const snaps = await listRemoteSnapshots();
    if (!snaps.length) console.log("niral · no remote snapshots yet");
    else for (const s of snaps) console.log(`  ${s.label}`);
  } else if (sub === "list") {
    const snaps = listSnapshots(dir);
    if (!snaps.length) console.log("niral · no snapshots yet");
    else for (const s of snaps) console.log(`  ${s.label.padEnd(42)} ${String(s.reason).padEnd(12)} ${s.files.join(", ")}`);
  } else if (sub === "push") {
    const requested = pos[1] ?? "latest";
    const local = listSnapshots(dir);
    const label = requested === "latest" ? local[0]?.label : requested;
    if (!label) die("niral · no local snapshot available to push");
    const { pushRemoteSnapshot } = await import("../src/server/remote-snapshot.js");
    const r = await pushRemoteSnapshot(dir, label);
    console.log(`niral · remote snapshot ${r.label} — encrypted ${r.bytes} bytes → ${r.key}`);
  } else if (remote) {
    const { snapshotRemote } = await import("../src/server/remote-snapshot.js");
    const r = await snapshotRemote(dir, { reason: "manual-remote" });
    console.log(`niral · snapshot ${r.local.label} — local + encrypted remote (${r.remote.bytes} bytes)`);
  } else {
    const r = snapshot(dir, { reason: "manual" });
    console.log(`niral · snapshot ${r.label} — ${r.files.length ? r.files.join(", ") : "no databases found"}`);
  }
} else if (cmd === "restore") {
  // `restore <label|latest> [dir]`
  const pos = positionals();
  const label = flag("--to") ?? pos[0] ?? "latest";
  const dir = resolve((flag("--to") ? pos[0] : pos[1]) ?? ".");
  try {
    let r;
    if (args.includes("--remote")) {
      const { listRemoteSnapshots, restoreRemoteSnapshot } = await import("../src/server/remote-snapshot.js");
      let remoteLabel = label;
      if (label === "latest") remoteLabel = (await listRemoteSnapshots())[0]?.label;
      if (!remoteLabel) throw new Error("no remote snapshots available");
      const result = await restoreRemoteSnapshot(dir, remoteLabel);
      r = result.restored;
      console.log(`niral · downloaded + decrypted remote snapshot ${remoteLabel}`);
    } else {
      const { restore } = await import("../src/server/recover.js");
      r = restore(dir, label);
    }
    console.log(`niral · restored ${r.restored.join(", ") || "nothing"} from ${r.from} (previous state saved as a pre-restore snapshot)`);
    console.log("        Restart the server to pick up the restored data.");
  } catch (e) {
    die(`niral · ${e.message}`);
  }
} else if (cmd === "rollback") {
  const dir = resolve(positionals()[0] ?? ".");
  const { rollbackRelease } = await import("../src/server/recover.js");
  const dist = existsSync(join(dir, "current")) ? dir : join(dir, "dist");
  try {
    const r = rollbackRelease(dist, { toHash: flag("--to") ?? null });
    console.log(`niral · rolled back ${r.from ?? "?"} → ${r.to} — restart the server (systemctl restart) to serve it`);
  } catch (e) {
    die(`niral · ${e.message}`);
  }
} else if (cmd === "rotate-secret") {
  const dir = resolve(positionals()[0] ?? ".");
  const envPath = flag("--env") ?? join(dir, "app.env");
  const { rotateSecret } = await import("../src/server/recover.js");
  rotateSecret(envPath);
  console.log(`niral · NIRAL_SECRET rotated in ${envPath} — every session is now invalid.`);
  console.log("        Restart the server (systemctl restart) to load it and evict all sessions.");
} else if (cmd === "watchdog") {
  const dir = resolve(positionals()[0] ?? ".");
  const port = Number(flag("-p") ?? 8199);
  const url = flag("--url") ?? `http://localhost:${port}`;
  const dist = existsSync(join(dir, "current")) ? dir : join(dir, "dist");
  const { createWatchdog } = await import("../src/server/watchdog.js");
  const { sendMail } = await import("../src/server/mail.js");
  const alertTo = process.env.NIRAL_ALERT_TO, smtpUrl = process.env.NIRAL_SMTP_URL;
  const alert = alertTo && smtpUrl
    ? async ({ subject, body }) => { try { await sendMail({ to: alertTo, from: process.env.NIRAL_MAIL_FROM ?? alertTo, subject, text: body, smtpUrl }); } catch {} }
    : null;
  const restartCmd = flag("--restart-cmd") ?? process.env.NIRAL_RESTART_CMD ?? null;
  const wd = createWatchdog({ appUrl: url, dist, projectRoot: dir, alert, restartCmd });
  console.log(`niral · watchdog guarding ${url} — ctrl-c to stop`);
  const stop = wd.start();
  process.on("SIGINT", () => { stop(); process.exit(0); });
  process.on("SIGTERM", () => { stop(); process.exit(0); });
  setInterval(() => {}, 1 << 30); // stay alive
} else if (cmd === "test") {
  const dir = resolve(positionals()[0] ?? ".");
  const { runProjectTests } = await import("../src/test-runner.js");
  const result = await runProjectTests({ projectDir: dir });
  process.exit(result.fail > 0 ? 1 : 0);
} else if (cmd === "deploy") {
  const dir = resolve(positionals()[0] ?? ".");
  const { initDeploy } = await import("../src/deploy.js");
  initDeploy({ root: dir });
} else if (cmd === "check") {
  const dir = resolve(positionals()[0] ?? ".");
  const { check, formatCheck } = await import("../src/check/check.js");
  try {
    const result = check({ root: dir });
    console.log(formatCheck(result, dir));
    if (result.errors.length) process.exit(1);
  } catch (e) {
    die(`niral · check failed — ${e.message}`);
  }
} else if (cmd === "lsp") {
  const { startLsp } = await import("../src/lsp/server.js");
  startLsp(); // stdio — driven by the editor
} else if (cmd === "add") {
  const [what, target] = positionals();
  const root = resolve(target ?? ".");
  try {
    if (what === "tailwind") {
      const { addTailwind } = await import("../src/add/tailwind.js");
      const recipe = await addTailwind({ root });
      console.log(`niral · tailwind ready — use classes in your .niral files; styles compile to /${recipe.output}`);
      console.log("niral · `niral dev` now watches styles automatically; `niral build` minifies them");
    } else if (what === "sqlite") {
      const { addSqlite } = await import("../src/add/sqlite.js");
      await addSqlite({ root });
    } else if (what === "fonts") {
      const { addFonts } = await import("../src/add/fonts.js");
      await addFonts({ root, family: flag("--family") ?? "Inter" });
    } else if (what === "image") {
      const { addImage } = await import("../src/add/image.js");
      await addImage({ root });
      if (args.includes("--transcode")) {
        const { addImageTranscode } = await import("../src/add/imagetools.js");
        await addImageTranscode({ root });
      }
    } else if (what === "auth") {
      const { addAuth } = await import("../src/add/auth.js");
      await addAuth({ root });
    } else if (what === "typescript") {
      const { addTypescript } = await import("../src/add/typescript.js");
      await addTypescript({ root, version: flag("--version") ?? undefined });
    } else if (what === "chat") {
      const { addChat } = await import("../src/add/chat.js");
      await addChat({ root });
    } else if (what === "llm") {
      const { addLlm } = await import("../src/add/llm.js");
      await addLlm({ root, modelUrl: flag("--model") ?? null });
    } else {
      die(`niral add — available recipes:
  tailwind          standalone Tailwind CSS (binary, no npm)
  sqlite            database-backed notes route (stdlib, nothing to install)
  fonts [--family]  self-hosted Google Fonts (default: Inter)
  image             best-practice <Img> component (lazy, no layout shift)
                    --transcode: + official cwebp — builds emit responsive .webp
  auth              passkeys + passwords + 2FA + guarded routes (zero deps)
  typescript        the real TS compiler for \`niral check\` (one-time download)
  chat              streaming AI chat page (ai.stream + streaming RPC)
  llm [--model url] LOCAL llama.cpp server — fully offline ai.* (official build)
  usage: niral add <recipe> [dir]`);
    }
  } catch (e) {
    die(`niral · add ${what} failed — ${e.message}`);
  }
} else {
  die(`niral v0.1 — commands:
  create <name>                    new project — zero to running in one command
                                   [--template minimal|blog|dashboard]
  compile <file.niral> [-o out.js] [--runtime path]
  serve [dir] [-p port]
  dev [dir] [-p port]
  build [dir] [-o distdir]
  start [dir] [-p port]
  export [dir] [-o outdir]
  check [dir]                      REAL TypeScript checking (.ts + <script lang="ts">)
  doctor [dir]                     diagnose the common "why won't it start" problems
  shield <status|log|verify|integrity> [dir]   in-process security guard
  watchdog [dir] [-p port]         independent guardian: health + integrity + audit
  snapshot [list] [dir]            local SQLite snapshots
  snapshot --remote [dir]          create + encrypt + push an off-box snapshot
  snapshot list --remote [dir]     list encrypted remote snapshots
  snapshot push <label|latest>     encrypt + push an existing local snapshot
  restore <label|latest> [dir]     restore a local snapshot
  restore <label|latest> --remote  download, decrypt and safely restore
  rollback [dir] [--to <hash>]     flip dist/current to the previous release
  rotate-secret [dir] [--env f]    new NIRAL_SECRET — evicts every session
  test [dir]                       run the project's tests/ (ambient test/ok/eq/startApp)
  migrate [dir] [--db path]        apply pending migrations/ (also auto-runs at boot)
  deploy [dir]                     generate deploy/ (systemd + nginx + Dockerfile + script)
  add <tailwind|sqlite|fonts|image|auth|typescript|chat|llm> [dir]
  jobs [dir]                       standalone job/cron worker
  lsp                              language server (stdio) — editor integration`);
}

function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}
