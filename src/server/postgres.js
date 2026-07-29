/**
 * Niral Postgres — a pure-Node PostgreSQL client (v0.3, opt-in).
 *
 * No `pg`, no npm — Niral speaks the Postgres wire protocol directly over a
 * TCP socket, so even Postgres support keeps the zero-dependency promise.
 * SQLite stays the default (lightweight, one file); reach for Postgres only
 * when an app needs it (heavy concurrency, multiple servers, big data).
 *
 * Supports: protocol v3, SCRAM-SHA-256 auth (the modern default) + md5 +
 * cleartext, simple + parameterized ($1,$2 — SQLi-safe) queries, a connection
 * pool, common type decoding, and TLS (sslmode=require / verify-full) so you
 * can connect to managed Postgres — Neon, Supabase, AWS RDS, GCP Cloud SQL,
 * Railway, etc. — without installing anything.
 *
 *   const db = pgPool(process.env.DATABASE_URL)
 *   const { rows } = await db.query("select * from users where id = $1", [id])
 */

import { createConnection } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { pbkdf2Sync, createHmac, createHash, randomBytes } from "node:crypto";

/* ── wire helpers ──────────────────────────────────────────────── */

class Writer {
  constructor() { this.chunks = []; }
  _push(b) { this.chunks.push(b); return this; }
  int32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return this._push(b); }
  int16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); return this._push(b); }
  byte(n) { return this._push(Buffer.from([n])); }
  str(s) { return this._push(Buffer.from(s + "\0", "utf8")); }
  raw(buf) { return this._push(buf); }
  /** Frame with a 1-byte type tag (null = startup, no tag). */
  frame(tag) {
    const body = Buffer.concat(this.chunks);
    const len = Buffer.alloc(4);
    len.writeInt32BE(body.length + 4);
    return tag == null ? Buffer.concat([len, body]) : Buffer.concat([Buffer.from(tag), len, body]);
  }
}

/** Split a socket stream into complete backend messages {type, body}. */
function makeParser(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 5) {
      const len = buf.readInt32BE(1); // length includes itself, excludes the type byte
      if (buf.length < len + 1) break;
      const type = String.fromCharCode(buf[0]);
      const body = buf.subarray(5, len + 1);
      buf = buf.subarray(len + 1);
      onMessage(type, body);
    }
  };
}

/* ── SCRAM-SHA-256 ─────────────────────────────────────────────── */

function xor(a, b) { const out = Buffer.alloc(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]; return out; }

function scramClientFirst(nonce) { return `n,,n=*,r=${nonce}`; }

function scramClientFinal(password, clientNonce, serverFirst) {
  const attrs = Object.fromEntries(serverFirst.split(",").map((p) => [p[0], p.slice(2)]));
  const serverNonce = attrs.r, salt = Buffer.from(attrs.s, "base64"), iter = parseInt(attrs.i, 10);
  if (!serverNonce.startsWith(clientNonce)) throw new Error("pg: SCRAM server nonce mismatch");
  const saltedPassword = pbkdf2Sync(password, salt, iter, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const clientFinalNoProof = `c=biws,r=${serverNonce}`;
  const authMessage = `n=*,r=${clientNonce},${serverFirst},${clientFinalNoProof}`;
  const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
  const clientProof = xor(clientKey, clientSignature);
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
  const serverSignature = createHmac("sha256", serverKey).update(authMessage).digest().toString("base64");
  return { final: `${clientFinalNoProof},p=${clientProof.toString("base64")}`, serverSignature };
}

/* ── type decoding (common OIDs) ───────────────────────────────── */

const DECODERS = {
  16: (v) => v === "t", // bool
  20: (v) => BigInt(v), // int8
  21: (v) => parseInt(v, 10), // int2
  23: (v) => parseInt(v, 10), // int4
  26: (v) => parseInt(v, 10), // oid
  700: (v) => parseFloat(v), 701: (v) => parseFloat(v), // float4/8
  1700: (v) => parseFloat(v), // numeric
  114: (v) => JSON.parse(v), 3802: (v) => JSON.parse(v), // json/jsonb
  1082: (v) => v, // date (leave as string)
  1114: (v) => new Date(v.replace(" ", "T") + "Z"), // timestamp
  1184: (v) => new Date(v), // timestamptz
  1000: (v) => v, // arrays: leave raw (rare in app code)
};
function decode(oid, text) { return text === null ? null : (DECODERS[oid] ?? ((v) => v))(text); }

/* ── a single connection ───────────────────────────────────────── */

export function pgConnect(config) {
  const cfg = typeof config === "string" ? parseUrl(config) : config;
  return new Promise((resolve, reject) => {
    let sock = null;
    const state = { rows: [], fields: [], resolvers: [], clientNonce: null, serverSig: null, ready: false, closed: false };
    const pending = []; // queued {sql, params, resolve, reject}
    let current = null;
    let onNotify = null; // LISTEN/NOTIFY callback (channel, payload)

    const send = (buf) => sock.write(buf);

    function fail(err) {
      state.closed = true;
      if (current) { current.reject(err); current = null; }
      while (pending.length) pending.shift().reject(err);
      if (!state.ready) reject(err);
    }

    const parser = makeParser((type, body) => {
      switch (type) {
        case "R": { // Authentication
          const code = body.readInt32BE(0);
          if (code === 0) return; // AuthenticationOk
          if (code === 3) return send(new Writer().str(cfg.password).frame("p")); // cleartext
          if (code === 5) { // md5
            const salt = body.subarray(4, 8);
            const inner = createHash("md5").update(cfg.password + cfg.user).digest("hex");
            const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
            return send(new Writer().str("md5" + outer).frame("p"));
          }
          if (code === 10) { // SASL — pick SCRAM-SHA-256
            state.clientNonce = randomBytes(18).toString("base64");
            const first = scramClientFirst(state.clientNonce);
            const w = new Writer().str("SCRAM-SHA-256").int32(Buffer.byteLength(first)).raw(Buffer.from(first));
            return send(w.frame("p"));
          }
          if (code === 11) { // SASLContinue
            const serverFirst = body.subarray(4).toString("utf8");
            const { final, serverSignature } = scramClientFinal(cfg.password, state.clientNonce, serverFirst);
            state.serverSig = serverSignature;
            return send(new Writer().raw(Buffer.from(final)).frame("p"));
          }
          if (code === 12) return; // SASLFinal — (could verify server signature)
          return fail(new Error("pg: unsupported auth code " + code));
        }
        case "E": { // ErrorResponse
          const err = parseError(body);
          return fail(new Error(`pg: ${err.severity ?? "ERROR"}: ${err.message}${err.detail ? " — " + err.detail : ""}`));
        }
        case "T": { // RowDescription
          state.fields = [];
          const n = body.readInt16BE(0);
          let off = 2;
          for (let i = 0; i < n; i++) {
            const end = body.indexOf(0, off);
            const name = body.subarray(off, end).toString("utf8");
            off = end + 1;
            const oid = body.readInt32BE(off + 6);
            off += 18;
            state.fields.push({ name, oid });
          }
          return;
        }
        case "D": { // DataRow
          const n = body.readInt16BE(0);
          let off = 2;
          const row = {};
          for (let i = 0; i < n; i++) {
            const len = body.readInt32BE(off); off += 4;
            const f = state.fields[i];
            if (len === -1) { row[f.name] = null; }
            else { row[f.name] = decode(f.oid, body.subarray(off, off + len).toString("utf8")); off += len; }
          }
          state.rows.push(row);
          return;
        }
        case "C": return; // CommandComplete
        case "A": { // NotificationResponse (LISTEN/NOTIFY) — can arrive any time
          let off = 4; // skip int32 notifying-backend pid
          let end = body.indexOf(0, off);
          const channel = body.subarray(off, end).toString("utf8");
          off = end + 1; end = body.indexOf(0, off);
          const payload = body.subarray(off, end).toString("utf8");
          if (onNotify) { try { onNotify(channel, payload); } catch {} }
          return;
        }
        case "Z": { // ReadyForQuery
          if (!state.ready) { state.ready = true; resolve(api); }
          else if (current) {
            current.resolve({ rows: state.rows, fields: state.fields.map((f) => f.name) });
            current = null;
          }
          state.rows = [];
          drain();
          return;
        }
        default: return; // S(paramStatus), K(backendKey), N(notice), 1/2/n/G/H/… ignored
      }
    });

    function boot(readySock) {
      sock = readySock;
      sock.on("data", parser);
      sock.on("error", fail);
      sock.on("close", () => { state.closed = true; if (current) fail(new Error("pg: connection closed")); });
      // startup
      const startup = new Writer().int32(196608).str("user").str(cfg.user).str("database").str(cfg.database).str("application_name").str("niral").byte(0);
      send(startup.frame(null));
    }

    // Establish the socket, upgrading to TLS first when requested. Managed
    // Postgres (Neon / Supabase / AWS RDS / Cloud SQL) hands you a URL with
    // sslmode=require — no local install, just connect.
    const ssl = normalizeSsl(cfg);
    const plain = createConnection({ host: cfg.host, port: cfg.port });
    plain.once("error", reject);
    plain.once("connect", () => {
      if (!ssl) { plain.removeListener("error", reject); return boot(plain); }
      const req = Buffer.alloc(8); req.writeInt32BE(8, 0); req.writeInt32BE(80877103, 4);
      plain.write(req); // SSLRequest
      plain.once("data", (buf) => {
        if (String.fromCharCode(buf[0]) === "S") {
          plain.removeListener("error", reject);
          const secure = tlsConnect({ socket: plain, servername: cfg.host, rejectUnauthorized: ssl.rejectUnauthorized, ca: ssl.ca });
          secure.once("error", reject);
          secure.once("secureConnect", () => { secure.removeListener("error", reject); boot(secure); });
        } else if (ssl.required) {
          reject(new Error("pg: server refused TLS (SSLRequest → 'N') but sslmode requires it"));
        } else {
          plain.removeListener("error", reject); boot(plain); // prefer/allow → plaintext fallback
        }
      });
    });

    function drain() {
      if (current || !pending.length || !state.ready) return;
      current = pending.shift();
      runQuery(current);
    }

    function runQuery(q) {
      state.rows = [];
      if (!q.params || q.params.length === 0) {
        // simple query protocol
        send(new Writer().str(q.sql).frame("Q"));
      } else {
        // extended protocol — parameterized, SQLi-safe
        const parse = new Writer().str("").str(q.sql).int16(0).frame("P");
        const bind = new Writer().str("").str("");
        bind.int16(0); // no param format codes → all text
        bind.int16(q.params.length);
        for (const p of q.params) {
          if (p === null || p === undefined) { bind.int32(-1); }
          else { const s = Buffer.from(typeof p === "object" ? JSON.stringify(p) : String(p)); bind.int32(s.length).raw(s); }
        }
        bind.int16(0); // result format codes → all text
        const b = bind.frame("B");
        const describe = new Writer().byte(0x50).str("").frame("D"); // 'P' portal
        const execute = new Writer().str("").int32(0).frame("E");
        const sync = new Writer().frame("S");
        send(Buffer.concat([parse, b, describe, execute, sync]));
      }
    }

    const api = {
      query(sql, params) { return new Promise((res, rej) => { pending.push({ sql, params, resolve: res, reject: rej }); drain(); }); },
      /** Register a LISTEN/NOTIFY handler, then `query("LISTEN channel")`. */
      onNotification(cb) { onNotify = cb; return api; },
      end() { return new Promise((res) => { try { send(new Writer().frame("X")); } catch {} sock.end(res); }); },
      get closed() { return state.closed; },
    };
  });
}

/* ── connection pool ───────────────────────────────────────────── */

export function pgPool(config, { max = 10 } = {}) {
  const cfg = typeof config === "string" ? parseUrl(config) : config;
  const idle = [];
  const all = new Set();
  const waiters = [];
  let opening = 0;

  async function acquire() {
    const c = idle.pop();
    if (c && !c.closed) return c;
    if (all.size + opening < max) {
      opening++;
      try { const conn = await pgConnect(cfg); all.add(conn); return conn; }
      finally { opening--; }
    }
    return new Promise((res) => waiters.push(res));
  }
  function release(c) {
    if (c.closed) { all.delete(c); return; }
    const w = waiters.shift();
    if (w) w(c); else idle.push(c);
  }

  return {
    async query(sql, params) {
      const c = await acquire();
      try { return await c.query(sql, params); }
      finally { release(c); }
    },
    async end() { for (const c of all) await c.end(); all.clear(); idle.length = 0; },
  };
}

/* ── helpers ───────────────────────────────────────────────────── */

export function parseUrl(url) {
  const u = new URL(url);
  const cfg = {
    host: u.hostname || "localhost",
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username) || "postgres",
    password: decodeURIComponent(u.password) || "",
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
  // TLS: ?sslmode=require|verify-full|verify-ca|prefer|disable (or ?ssl=true).
  // Managed providers (Neon / Supabase / RDS) give you sslmode=require.
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) cfg.sslmode = sslmode;
  const ssl = u.searchParams.get("ssl");
  if (!cfg.sslmode && (ssl === "true" || ssl === "1" || ssl === "require")) cfg.sslmode = "require";
  return cfg;
}

/** Decide TLS behaviour from cfg.sslmode / cfg.ssl. Returns null for plaintext. */
function normalizeSsl(cfg) {
  const mode = cfg.sslmode;
  const ssl = cfg.ssl;
  if (ssl === false || mode === "disable") return null;
  if (ssl == null && mode == null) return null; // default: plaintext (localhost / private net)
  const optional = mode === "prefer" || mode === "allow";
  const strict = mode === "verify-ca" || mode === "verify-full" ||
                 (ssl && typeof ssl === "object" && ssl.rejectUnauthorized === true);
  return {
    required: !optional,
    rejectUnauthorized: strict, // require = encrypt only (libpq default); verify-full = verify the cert
    ca: ssl && typeof ssl === "object" ? ssl.ca : undefined,
  };
}

function parseError(body) {
  const out = {};
  let off = 0;
  while (off < body.length && body[off] !== 0) {
    const field = String.fromCharCode(body[off]); off++;
    const end = body.indexOf(0, off);
    const val = body.subarray(off, end).toString("utf8");
    off = end + 1;
    if (field === "S") out.severity = val;
    else if (field === "M") out.message = val;
    else if (field === "D") out.detail = val;
    else if (field === "C") out.code = val;
  }
  return out;
}
