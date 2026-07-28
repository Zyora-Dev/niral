// lib/users.js — sqlite user store (node:sqlite, zero dependencies).
// Yours to extend: add columns, swap for Postgres, anything.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
const db = new DatabaseSync("data/auth.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT,
    totp_secret TEXT,
    roles TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key_jwk TEXT NOT NULL,
    alg TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const rowToUser = (r) =>
  r && { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, totpSecret: r.totp_secret, roles: JSON.parse(r.roles) };

export function createUser({ email, name, passwordHash = null, roles = [] }) {
  const st = db.prepare("INSERT INTO users (email, name, password_hash, roles) VALUES (?, ?, ?, ?)");
  const info = st.run(email.toLowerCase().trim(), name, passwordHash, JSON.stringify(roles));
  return findUserById(Number(info.lastInsertRowid));
}
export function findUserByEmail(email) {
  return rowToUser(db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase().trim()));
}
export function findUserById(id) {
  return rowToUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}
export function setTotpSecret(userId, secret) {
  db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, userId);
}

export function addPasskey(userId, { credentialId, publicKeyJwk, alg, counter }) {
  db.prepare("INSERT INTO passkeys (credential_id, user_id, public_key_jwk, alg, counter) VALUES (?, ?, ?, ?, ?)")
    .run(credentialId, userId, JSON.stringify(publicKeyJwk), alg, counter);
}
export function findPasskey(credentialId) {
  const r = db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(credentialId);
  return r && { credentialId: r.credential_id, userId: r.user_id, publicKeyJwk: JSON.parse(r.public_key_jwk), alg: r.alg, counter: r.counter };
}
export function updatePasskeyCounter(credentialId, counter) {
  db.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ?").run(counter, credentialId);
}
export function passkeysForUser(userId) {
  return db.prepare("SELECT credential_id FROM passkeys WHERE user_id = ?").all(userId).map((r) => r.credential_id);
}
