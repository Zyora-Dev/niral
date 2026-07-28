/**
 * Niral Shield — in-process intrusion detection + response (v0.2).
 *
 * Every request passes through the shield BEFORE routing. It watches for the
 * shapes of an attack — vulnerability scanners probing for other software,
 * brute-force auth, request floods — and responds in-process, with no external
 * service and no second machine:
 *
 *   · bans an IP that probes for things a niral app never has (/wp-admin,
 *     .php, .env, /.git) or that hammers 401/404s
 *   · trips LOCKDOWN when an attack is sustained: writes freeze (POST/PUT/
 *     PATCH/DELETE → 503), the site stays up read-only, the surface closes
 *   · records every event to a HASH-CHAINED audit log (data/shield.log.jsonl)
 *     so the record itself is tamper-evident
 *   · alerts the owner (via the built-in mailer) on the first ban and on
 *     lockdown — throttled so an attack can't become a mail flood
 *
 * Honest scope: this protects the APP and narrows the attacker's options on
 * the box. It cannot stop a volumetric DDoS (that needs network-edge capacity)
 * or someone who already has root. "Hardened by default, self-healing under
 * attack" — never "unhackable".
 *
 * Everything is opt-in-safe: with no config it still bans obvious scanners and
 * logs; mail and lockdown thresholds are tunable. NIRAL_SHIELD=off disables it.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Paths a niral app NEVER serves — a request for one is a scanner, full stop. */
const PROBE = [
  /\/wp-(admin|login|content|includes)/i,
  /\.php($|\?)/i,
  /\/\.env($|\.|\?)/i,
  /\/\.git(\/|$)/i,
  /\/\.(aws|ssh|npmrc|htaccess|DS_Store)($|\/)/i,
  /\/(phpmyadmin|adminer|xmlrpc|vendor\/phpunit)/i,
  /\/(config|backup|dump)\.(bak|old|sql|zip|tar|gz)($|\?)/i,
  /\/cgi-bin\//i,
];

/** Suspicious payload shapes in the path/query — cheap heuristics, not a WAF. */
const INJECTION = [
  /(\.\.\/|\.\.%2f)/i, // path traversal
  /<script[\s>]/i, // reflected xss probe
  /(union\s+select|information_schema|sleep\(\d)/i, // sqli probe
  /(\$\{jndi:|\/etc\/passwd)/i, // log4shell / lfi
];

const now = () => Date.now();

export function createShield(opts = {}) {
  const enabled = process.env.NIRAL_SHIELD !== "off";
  const cfg = {
    banThreshold: num(process.env.NIRAL_SHIELD_STRIKES, opts.banThreshold ?? 6), // strikes → ban
    banMs: num(process.env.NIRAL_SHIELD_BAN_MS, opts.banMs ?? 15 * 60_000), // 15 min
    windowMs: opts.windowMs ?? 60_000, // strike-decay window
    lockdownBans: num(process.env.NIRAL_SHIELD_LOCKDOWN, opts.lockdownBans ?? 8), // distinct bans in lockdownWindowMs → lockdown
    lockdownWindowMs: opts.lockdownWindowMs ?? 5 * 60_000,
    lockdownMs: num(process.env.NIRAL_SHIELD_LOCKDOWN_MS, opts.lockdownMs ?? 10 * 60_000),
    trustProxy: process.env.NIRAL_TRUST_PROXY === "1" || opts.trustProxy === true,
    dataDir: opts.dataDir ?? join(opts.projectRoot ?? process.cwd(), "data"),
    alert: opts.alert ?? null, // async ({event, detail}) => void
    log: opts.log ?? { warn() {}, error() {}, info() {} },
  };

  const strikes = new Map(); // ip → { count, first }
  const bans = new Map(); // ip → unbanAt
  const recentBans = []; // timestamps, for lockdown detection
  let lockdownUntil = 0;
  let lastChainHash = loadChainTip(cfg.dataDir);
  const alertsSent = new Map(); // key → lastSentAt (mail throttle)

  function ip(req) {
    if (cfg.trustProxy) {
      const xff = req.headers["x-forwarded-for"];
      if (xff) return String(xff).split(",")[0].trim();
    }
    return req.socket?.remoteAddress ?? "?";
  }

  /** Append a hash-chained audit record — each line commits to the previous. */
  function audit(event, detail) {
    if (!enabled) return;
    const rec = { t: new Date().toISOString(), event, ...detail };
    const chain = chainHash(lastChainHash, rec);
    lastChainHash = chain;
    try {
      mkdirSync(cfg.dataDir, { recursive: true });
      appendFileSync(join(cfg.dataDir, "shield.log.jsonl"), JSON.stringify({ ...rec, chain }) + "\n");
    } catch {
      /* logging must never break the request path */
    }
  }

  /** Throttled owner alert — an attack must not become a mail flood. */
  function alert(key, subject, body) {
    if (!cfg.alert) return;
    const last = alertsSent.get(key) ?? 0;
    if (now() - last < 10 * 60_000) return; // at most one of each kind / 10 min
    alertsSent.set(key, now());
    Promise.resolve(cfg.alert({ subject, body })).catch(() => {});
  }

  function strike(addr, reason, req, weight = 1) {
    const s = strikes.get(addr) ?? { count: 0, first: now() };
    if (now() - s.first > cfg.windowMs) {
      s.count = 0;
      s.first = now();
    }
    s.count += weight;
    strikes.set(addr, s);
    cfg.log.warn("shield strike", { ip: addr, reason, count: s.count, path: req.url });
    if (s.count >= cfg.banThreshold) ban(addr, reason);
  }

  function ban(addr, reason) {
    if (bans.has(addr)) return;
    bans.set(addr, now() + cfg.banMs);
    strikes.delete(addr);
    recentBans.push(now());
    audit("ban", { ip: addr, reason, ms: cfg.banMs });
    cfg.log.error("shield ban", { ip: addr, reason });
    alert("ban:" + addr, `niral shield: banned ${addr}`, `Reason: ${reason}\nBanned for ${Math.round(cfg.banMs / 60000)} min.`);
    // sustained bans → lockdown
    const cutoff = now() - cfg.lockdownWindowMs;
    while (recentBans.length && recentBans[0] < cutoff) recentBans.shift();
    if (recentBans.length >= cfg.lockdownBans) enterLockdown();
  }

  function enterLockdown() {
    if (lockdownUntil > now()) return; // already locked
    lockdownUntil = now() + cfg.lockdownMs;
    audit("lockdown", { until: new Date(lockdownUntil).toISOString(), bans: recentBans.length });
    cfg.log.error("shield LOCKDOWN — writes frozen", { minutes: Math.round(cfg.lockdownMs / 60000) });
    alert(
      "lockdown",
      "niral shield: LOCKDOWN engaged",
      `A sustained attack tripped lockdown (${recentBans.length} bans in ${Math.round(cfg.lockdownWindowMs / 60000)} min).\n` +
        `Writes are frozen for ${Math.round(cfg.lockdownMs / 60000)} min; the site stays up read-only.\n` +
        `Review data/shield.log.jsonl. Rotate NIRAL_SECRET to evict all sessions.`
    );
  }

  const isLockedDown = () => lockdownUntil > now();

  /**
   * Inspect a request BEFORE routing.
   * Returns null to continue, or { status, body, headers } to short-circuit.
   * The prod/dev handler applies the short-circuit and stops.
   */
  function inspect(req) {
    if (!enabled) return null;
    const addr = ip(req);

    // 1. active ban
    const until = bans.get(addr);
    if (until) {
      if (until > now()) return blocked(addr, "banned");
      bans.delete(addr);
    }

    const path = req.url ?? "/";

    // 2. scanner probes — instant hard strike (weight 3: three probes = ban)
    if (PROBE.some((re) => re.test(path))) {
      strike(addr, "probe", req, 3);
      audit("probe", { ip: addr, path });
      return blocked(addr, "probe", 404); // give a scanner a boring 404, not a hint
    }

    // 3. injection shapes in the URL
    if (INJECTION.some((re) => re.test(path))) {
      strike(addr, "injection", req, 3);
      audit("injection", { ip: addr, path });
      return blocked(addr, "injection", 400);
    }

    // 4. lockdown: freeze writes, allow reads
    if (isLockedDown() && WRITE_METHODS.has(req.method)) {
      return {
        status: 503,
        headers: { "retry-after": String(Math.ceil((lockdownUntil - now()) / 1000)) },
        body: { ok: false, error: "service temporarily read-only (security lockdown)" },
      };
    }

    return null;
  }

  /** Called by the request handler AFTER the response status is known, so the
   *  shield can learn from 401/403/404 patterns it didn't itself trigger. */
  function observe(req, status) {
    if (!enabled) return;
    if (status === 401 || status === 403) strike(ip(req), "auth-fail", req, 1);
    else if (status === 404) strike(ip(req), "not-found", req, 1); // scanners generate lots of 404s
  }

  function blocked(addr, reason, status = 403) {
    return { status, __shieldBlocked: true, body: status === 404 ? "not found" : { ok: false, error: "blocked" } };
  }

  return {
    enabled,
    inspect,
    observe,
    isLockedDown,
    /** snapshot for /@niral/health and `niral shield status` */
    status() {
      return {
        enabled,
        lockdown: isLockedDown(),
        lockdownUntil: isLockedDown() ? new Date(lockdownUntil).toISOString() : null,
        activeBans: [...bans.entries()].filter(([, u]) => u > now()).length,
        watching: strikes.size,
      };
    },
  };
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The canonical hash of one record chained onto the previous tip. The record
 *  is serialized WITHOUT its `chain` field, so write and verify always agree. */
function chainHash(prev, rec) {
  const { chain, ...body } = rec;
  return createHash("sha256").update(prev + JSON.stringify(body)).digest("hex").slice(0, 16);
}

function num(env, dflt) {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** Read the last chain hash so restarts keep the audit chain continuous. */
function loadChainTip(dataDir) {
  const file = join(dataDir, "shield.log.jsonl");
  if (!existsSync(file)) return "niral-shield-genesis";
  try {
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    return last.chain ?? "niral-shield-genesis";
  } catch {
    return "niral-shield-genesis";
  }
}

/** Verify the audit chain is unbroken — used by `niral shield verify`. */
export function verifyAuditChain(dataDir) {
  const file = join(dataDir, "shield.log.jsonl");
  if (!existsSync(file)) return { ok: true, entries: 0, brokenAt: null };
  const lines = readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean);
  let prev = "niral-shield-genesis";
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "unparseable line" };
    }
    const expect = chainHash(prev, rec);
    if (expect !== rec.chain) return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "hash mismatch" };
    prev = rec.chain;
  }
  return { ok: true, entries: lines.length, brokenAt: null };
}
