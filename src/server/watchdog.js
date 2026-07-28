/**
 * Niral watchdog — an independent guardian process (v0.2).
 *
 * Runs as its OWN systemd unit, SEPARATE from the app. If an attacker kills or
 * hangs the app, the watchdog survives and acts; if they kill the watchdog,
 * systemd (Restart=always) brings it back. The two processes guard each other,
 * sharing no memory — only the files on disk.
 *
 * Every interval, independently of the app:
 *   · probes /@niral/health — the app can't report its own death, so a separate
 *     process must. Down repeatedly → alert (systemd restarts the app; the
 *     watchdog's job is to NOTICE and tell you, and to catch a crash-loop).
 *   · re-hashes the running release vs its integrity manifest — catches
 *     tampering even if the app's OWN in-process check was disabled or the app
 *     process itself was compromised.
 *   · verifies the Shield audit-log hash chain — catches log tampering.
 *   · with NIRAL_AUTO_ROLLBACK=1, rolls a tampered release back to the last
 *     good one and restarts the app unit.
 *
 * Zero dependencies. It reads the same integrity/shield/recover helpers the app
 * uses, but from its own process — so compromising the app can't blind it.
 */

import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { checkIntegrity } from "./integrity.js";
import { verifyAuditChain } from "./shield.js";
import { rollbackRelease } from "./recover.js";
import { makeLog } from "./observe.js";

export function createWatchdog({
  appUrl = "http://localhost:8199",
  dist,
  projectRoot,
  intervalMs = Number(process.env.NIRAL_WATCHDOG_MS) || 30_000,
  downAlertAt = 3,
  alert = null,
  restartCmd = process.env.NIRAL_RESTART_CMD || null,
  fetchImpl = globalThis.fetch,
  log = makeLog("watchdog"),
} = {}) {
  let downCount = 0;
  let lastIntegrityOk = true;
  let lastAuditOk = true;

  async function probeHealth() {
    try {
      const res = await fetchImpl(appUrl + "/@niral/health", { signal: AbortSignal.timeout?.(5000) });
      if (!res.ok) throw new Error("status " + res.status);
      if (downCount >= downAlertAt) log.info("app recovered", { after: downCount });
      downCount = 0;
      return true;
    } catch (e) {
      downCount++;
      log.warn("health probe failed", { downCount, error: String(e?.message ?? e) });
      if (downCount === downAlertAt) {
        alert?.({
          subject: "niral watchdog: app is DOWN",
          body: `Health probe to ${appUrl} failed ${downCount} times in a row.\nsystemd should be restarting it — if it stays down it's crash-looping; investigate.`,
        });
      }
      return false;
    }
  }

  function checkRelease() {
    if (!dist) return;
    const link = join(dist, "current");
    if (!existsSync(link)) return;
    let releaseDir;
    try { releaseDir = realpathSync(link); } catch { return; }
    try {
      const r = checkIntegrity(releaseDir);
      if (r.ok || r.unavailable) { lastIntegrityOk = true; return; }
      if (lastIntegrityOk) { // alert once per transition, not every tick
        log.error("RELEASE TAMPERED (independent check)", { tampered: r.tampered.slice(0, 10) });
        alert?.({
          subject: "niral watchdog: RELEASE TAMPERED",
          body:
            `The watchdog re-hashed the running release and it no longer matches its build manifest:\n` +
            r.tampered.slice(0, 20).map((t) => `  ${t.kind}: ${t.path}`).join("\n"),
        });
      }
      lastIntegrityOk = false;
      if (process.env.NIRAL_AUTO_ROLLBACK === "1") {
        try {
          const { from, to } = rollbackRelease(dist);
          log.error("rolled back tampered release", { from, to });
          alert?.({ subject: "niral watchdog: auto-rolled back", body: `Tampered release ${from} → rolled back to ${to}. Restarting the app.` });
          restartApp();
          lastIntegrityOk = true; // the rolled-back release is clean
        } catch (e) {
          log.error("auto-rollback failed", { error: String(e?.message ?? e) });
        }
      }
    } catch { /* never crash the guardian over a check */ }
  }

  function checkAudit() {
    if (!projectRoot) return;
    try {
      const v = verifyAuditChain(join(projectRoot, "data"));
      if (v.ok) { lastAuditOk = true; return; }
      if (lastAuditOk) {
        log.error("shield audit log BROKEN", { brokenAt: v.brokenAt, reason: v.reason });
        alert?.({ subject: "niral watchdog: audit log altered", body: `The Shield audit chain broke at entry ${v.brokenAt} (${v.reason}) — the security log was tampered with.` });
      }
      lastAuditOk = false;
    } catch { /* ignore */ }
  }

  function restartApp() {
    if (!restartCmd) {
      log.warn("no restart command set (NIRAL_RESTART_CMD) — restart the app manually");
      return;
    }
    try {
      execSync(restartCmd, { stdio: "ignore" });
      log.info("restart command issued", { cmd: restartCmd });
    } catch (e) {
      log.error("restart command failed", { error: String(e?.message ?? e) });
      alert?.({ subject: "niral watchdog: restart failed", body: `Could not run "${restartCmd}": ${e?.message ?? e}. Restart the app yourself.` });
    }
  }

  async function tick() {
    await probeHealth();
    checkRelease();
    checkAudit();
  }

  return {
    tick,
    /** Start the loop. Returns a stop() function. */
    start() {
      log.info("watchdog guarding", { appUrl, intervalMs });
      const iv = setInterval(() => { tick().catch(() => {}); }, intervalMs);
      iv.unref?.();
      tick().catch(() => {});
      return () => clearInterval(iv);
    },
  };
}
