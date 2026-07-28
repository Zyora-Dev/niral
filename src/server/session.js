/**
 * Niral server — signed-cookie sessions.
 *
 * The whole session lives in one HttpOnly cookie: base64url(JSON) plus an
 * HMAC-SHA256 signature. Tampered cookies are silently discarded (fresh
 * session). No server-side session store to run or lose.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

let secureCookies = false;

/** Ship session cookies with the `Secure` attribute (behind HTTPS/proxy).
 *  Prod enables this via NIRAL_SECURE=1 or createProdServer({ secure: true }). */
export function setSecureCookies(v) {
  secureCookies = !!v;
}
export const COOKIE_NAME = "niral_session";
export const DEFAULT_MAX_AGE = 7 * 24 * 3600; // seconds

export function newSecret() {
  return randomBytes(32).toString("hex");
}

function hmac(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** { data } → cookie value `payload.signature` — payload embeds a signed expiry */
export function signSession(data, secret, maxAgeSec = DEFAULT_MAX_AGE) {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = Buffer.from(JSON.stringify({ d: data, e: exp })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

/** cookie value → data | null (bad/absent/tampered/EXPIRED → null) */
export function verifySession(value, secret) {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const want = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!obj || typeof obj !== "object" || obj.d === undefined) return null;
    if (typeof obj.e !== "number" || Date.now() / 1000 > obj.e) return null; // expired
    return obj.d;
  } catch {
    return null;
  }
}

/* ── optional server-side store ──────────────────────────────────
   NIRAL_SESSION_STORE=db keeps session DATA in data/sessions.db (node:sqlite,
   survives deploys like jobs.db) — the cookie carries only a signed session
   id. Use it when sessions outgrow the ~4KB cookie limit. Same read/write
   API either way — nothing else in the framework changes. */

let sessDb = null;
let sessDbFile = null;

function sessionDb() {
  const { fileURLToPath } = require_node("node:url");
  const { mkdirSync } = require_node("node:fs");
  const { dirname } = require_node("node:path");
  const root = globalThis.__niralProjectRoot;
  const file = fileURLToPath(root ? new URL("data/sessions.db", root) : new URL(`file://${process.cwd()}/data/sessions.db`));
  if (sessDb && sessDbFile === file) return sessDb;
  const { DatabaseSync } = require_node("node:sqlite");
  mkdirSync(dirname(file), { recursive: true });
  sessDb = new DatabaseSync(file);
  sessDbFile = file;
  sessDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // opportunistic GC — sessions idle past the max age are dead anyway
  sessDb.prepare("DELETE FROM sessions WHERE updated_at < ?").run(Date.now() - DEFAULT_MAX_AGE * 1000);
  return sessDb;
}

function require_node(name) {
  return process.getBuiltinModule(name);
}

const dbMode = () => process.env.NIRAL_SESSION_STORE === "db";

/** Parse a Cookie header → session store { data, dirty }. */
export function readSession(cookieHeader, secret) {
  const cookies = Object.fromEntries(
    (cookieHeader ?? "").split(";").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const payload = verifySession(cookies[COOKIE_NAME], secret);
  if (dbMode()) {
    // cookie holds a signed { __sid } — data lives server-side
    const sid = payload?.__sid;
    if (!sid) return { data: {}, dirty: false };
    const row = sessionDb().prepare("SELECT data FROM sessions WHERE sid = ?").get(sid);
    let data = {};
    try {
      data = row ? JSON.parse(row.data) : {};
    } catch {
      /* corrupt row → fresh session */
    }
    return { data, dirty: false, __sid: sid };
  }
  return { data: payload ?? {}, dirty: false };
}

/** Set-Cookie header value for a dirty session. */
export function sessionCookie(store, secret, maxAgeSec = DEFAULT_MAX_AGE) {
  let payload = store.data;
  if (dbMode()) {
    store.__sid ??= randomBytes(16).toString("hex");
    sessionDb()
      .prepare("INSERT INTO sessions (sid, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(store.__sid, JSON.stringify(store.data), Date.now());
    payload = { __sid: store.__sid };
  }
  return (
    `${COOKIE_NAME}=${signSession(payload, secret, maxAgeSec)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax` +
    (secureCookies ? "; Secure" : "")
  );
}
