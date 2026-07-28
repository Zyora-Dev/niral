/**
 * Niral server — auth core (passwords, 2FA, session identity).
 *
 * Built for both "it just works" and enterprise review:
 *   • scrypt password hashing (node:crypto, OWASP parameters), self-describing
 *     hash format so parameters can be raised without breaking old hashes
 *   • timing-safe verification everywhere — no comparison leaks
 *   • TOTP two-factor (RFC 6238), drift window ±1 step, timing-safe
 *   • login/logout helpers with SESSION ROTATION (fixation-proof: a fresh
 *     session id is minted on every privilege change)
 *
 * `<server auth>` route guards and the ambient `user()` are wired in the
 * RPC/load layer; passkeys live in webauthn.js.
 */

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

/* ── passwords (scrypt) ─────────────────────────────────────────
   Format: scrypt$N$r$p$salt(b64url)$hash(b64url) — parameters travel with
   the hash, so raising them later only affects NEW hashes. */

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64 }; // OWASP: N=2^15 interactive

export function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("passwords must be at least 8 characters");
  }
  if (password.length > 256) throw new Error("password too long"); // scrypt DoS guard
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    if (typeof password !== "string" || password.length > 256) return false;
    const salt = Buffer.from(saltB64, "base64url");
    const want = Buffer.from(hashB64, "base64url");
    const got = scryptSync(password, salt, want.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/* ── TOTP (RFC 6238) ── */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh TOTP secret (base32, for authenticator apps). */
export function totpSecret() {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI — opens directly in authenticator apps. */
export function totpUri(secret, account, issuer = "Niral") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function totpCode(secret, timeStep) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(timeStep));
  const mac = createHmac("sha1", key).update(msg).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code =
    (((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** Verify a 6-digit code (±1 step drift). Timing-safe. */
export function totpVerify(secret, code, { now = Date.now(), window = 1 } = {}) {
  const clean = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(now / 1000 / 30);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const want = Buffer.from(totpCode(secret, step + w));
    const got = Buffer.from(clean);
    // constant-time per candidate; no early exit on match
    if (want.length === got.length && timingSafeEqual(want, got)) ok = true;
  }
  return ok;
}

/* ── session identity ── */

/** Fresh session id — minted on every privilege change (fixation-proof). */
export function newSid() {
  return randomBytes(16).toString("base64url");
}

/** Log a user in: fresh session id (rotation — fixation-proof), identity set.
 *  Store ONLY what every request needs (id, name, roles) — not secrets. */
export function loginUser(store, user) {
  const { passwordHash, password_hash, totpSecret: _t, totp_secret, ...safe } = user ?? {};
  store.data = { ...store.data, user: safe, sid: newSid() };
  store.dirty = true;
}

export function logoutUser(store) {
  store.data = {};
  store.dirty = true;
}

/** Does the session satisfy `<server auth>` / `<server auth="role">`? */
export function satisfiesAuth(store, requirement) {
  const user = store?.data?.user;
  if (!user) return false;
  if (requirement === true || requirement === "" || requirement == null) return true;
  const roles = Array.isArray(user.roles) ? user.roles : user.role ? [user.role] : [];
  return roles.includes(requirement);
}
