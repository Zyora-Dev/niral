/**
 * niral doctor — diagnose the common "why won't it start / deploy" problems.
 *
 * Read-only apart from one probe file in data/ (written + deleted). Levels:
 *   ok    all good
 *   warn  works, but you'll regret it later (fix before production)
 *   fail  broken now — exit code 1
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadHooks, checkRequiredEnv } from "./server/hooks.js";
import { migrationStatus } from "./server/migrate.js";

export async function runDoctor({ root }) {
  const checks = [];
  const add = (level, name, detail = "") => checks.push({ level, name, detail });

  // Node version — node:sqlite + modern http APIs need 22+
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) add("ok", `node ${process.versions.node}`);
  else add("fail", `node ${process.versions.node}`, "niral needs Node 22+ (node:sqlite, http drain APIs) — upgrade node");

  // project structure
  if (existsSync(join(root, "routes"))) add("ok", "routes/ found");
  else {
    add("fail", "routes/ missing", "not a niral project? `niral create <name>` scaffolds one, or cd into your app");
    return finish(checks); // everything below assumes a project
  }

  // hooks.js loads cleanly (a syntax error here breaks EVERY request)
  if (existsSync(join(root, "hooks.js"))) {
    try {
      await loadHooks(root);
      add("ok", "hooks.js loads");
    } catch (e) {
      add("fail", "hooks.js is broken", `${e.message} — every request runs it, fix before starting`);
    }
  }

  // jobs.js loads cleanly (a broken one silently kills queue + cron)
  if (existsSync(join(root, "jobs.js"))) {
    try {
      await import("node:url").then(({ pathToFileURL }) => import(pathToFileURL(join(root, "jobs.js")).href));
      add("ok", "jobs.js loads");
    } catch (e) {
      add("fail", "jobs.js is broken", `${e.message} — queue + cron will not run`);
    }
  }

  // declared env vars (hooks.js `export const env = [...]`)
  const { missing, declared } = await checkRequiredEnv(root);
  if (declared > 0) {
    if (missing.length === 0) add("ok", `env: all ${declared} declared variable(s) set`);
    else add("warn", `env: missing ${missing.join(", ")}`, "declared in hooks.js — production refuses to boot without them");
  }

  // secrets hygiene — .gitignore must keep env files out of git
  const gi = join(root, ".gitignore");
  if (existsSync(gi) && /(^|\n)\s*\*?\.env/.test(readFileSync(gi, "utf8"))) add("ok", ".gitignore covers env files");
  else add("warn", ".gitignore does not cover .env", "add `.env` + `*.env` so secrets never enter git");

  // session secret — without it every restart logs everyone out
  if (process.env.NIRAL_SECRET) add("ok", "NIRAL_SECRET set");
  else add("warn", "NIRAL_SECRET not set", "sessions sign with a random secret — every restart logs everyone out; required in production");

  // data/ must be writable (sessions, jobs, sqlite live here)
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    const probe = join(root, "data", ".niral-doctor");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    add("ok", "data/ writable");
  } catch (e) {
    add("fail", "data/ not writable", `${e.message} — sessions, jobs and sqlite need it`);
  }

  // pending migrations — prod applies them at boot, but surprises are bad
  if (existsSync(join(root, "migrations"))) {
    try {
      const st = migrationStatus({ projectDir: root });
      const pending = st.files.length - st.applied.length;
      if (pending === 0) add("ok", `migrations: ${st.applied.length}/${st.files.length} applied`);
      else add("warn", `migrations: ${pending} pending`, "`niral migrate` applies them now (they also auto-run at boot)");
    } catch (e) {
      add("fail", "migrations broken", e.message);
    }
  }

  // production release present?
  const current = join(root, "dist", "current");
  if (existsSync(current)) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, "manifest.json"), "utf8"));
      add("ok", `production release ${manifest.hash}`);
    } catch {
      add("fail", "dist/current has no readable manifest", "re-run `niral build`");
    }
  } else if (readdirSync(root).includes("dist")) {
    add("warn", "dist/ exists but no current release", "run `niral build`");
  }

  return finish(checks);
}

function finish(checks) {
  return { checks, ok: !checks.some((c) => c.level === "fail") };
}

const GLYPH = { ok: "✓", warn: "!", fail: "✗" };

export function formatDoctor({ checks, ok }, root) {
  const lines = [`niral doctor · ${root}`, ""];
  for (const c of checks) {
    lines.push(`  ${GLYPH[c.level]} ${c.name}${c.detail ? `\n      ${c.detail}` : ""}`);
  }
  const warns = checks.filter((c) => c.level === "warn").length;
  const fails = checks.filter((c) => c.level === "fail").length;
  lines.push("", ok ? `healthy${warns ? ` — ${warns} warning(s) to fix before production` : ""}` : `${fails} problem(s) found`);
  return lines.join("\n");
}
