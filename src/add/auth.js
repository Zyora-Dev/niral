/**
 * `niral add auth` — scaffold complete authentication into a project.
 *
 * What you get (all user-owned code, powered by framework built-ins):
 *   lib/users.js              sqlite user store (node:sqlite — stdlib)
 *   routes/auth/login.niral   password login + passkey (Face ID) login + 2FA step
 *   routes/auth/register.niral  account creation (scrypt-hashed)
 *   routes/auth/account.niral   <server auth> guarded — passkey enrolment, 2FA setup, logout
 *
 * Security posture (enterprise-checklist friendly):
 *   scrypt (OWASP params) · timing-safe compares · session rotation on login
 *   passkeys (WebAuthn, counter-regression detection) · TOTP 2FA
 *   login rate limiting · guarded routes rejected before user code runs
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const USERS_LIB = `// lib/users.js — sqlite user store (node:sqlite, zero dependencies).
// Yours to extend: add columns, swap for Postgres, anything.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// data/ lives NEXT TO THIS FILE's project — never wherever the server process
// happened to start (JS server blocks run in-process).
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DATA_DIR + "auth.db");
db.exec(\`
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
\`);

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

/** OAuth sign-in: link by verified email, or create the account. */
export function findOrCreateOauthUser({ email, name }) {
  if (!email) throw new Error("This provider didn't share an email address.");
  return findUserByEmail(email) ?? createUser({ email, name: name ?? email });
}
`;

const LOGIN_ROUTE = `<server>
// Login: password (+ optional 2FA) and passkeys. Rate limited.
const attempts = new Map(); // ip-less simple limiter: email → { n, t }
function tooMany(key) {
  const now = Date.now();
  const a = attempts.get(key) ?? { n: 0, t: now };
  if (now - a.t > 15 * 60_000) { a.n = 0; a.t = now; }
  a.n++;
  attempts.set(key, a);
  return a.n > 10; // 10 tries / 15 min / account
}

export async function login(form) {
  const { findUserByEmail } = await projectImport("lib/users.js");
  const email = String(form.email ?? "");
  if (tooMany(email)) return { error: "Too many attempts — try again in 15 minutes." };
  const u = findUserByEmail(email);
  // timing-safe posture: verify against a dummy hash when the user is unknown
  const ok = u?.passwordHash
    ? auth.verifyPassword(String(form.password ?? ""), u.passwordHash)
    : (auth.verifyPassword("nope", "scrypt$32768$8$1$AAAA$AAAA"), false);
  if (!ok) return { error: "Wrong email or password." };
  if (u.totpSecret) {
    if (!form.code) return { needsCode: true, email };
    if (!auth.totpVerify(u.totpSecret, form.code)) return { error: "Wrong authenticator code.", needsCode: true, email };
  }
  auth.login(u);
  return { redirect: form.next && String(form.next).startsWith("/") ? form.next : "/" };
}

export async function load() {
  return { providers: auth.oauth.providers() }; // configured via NIRAL_OAUTH_* env
}

// ── passkey login (two RPC steps) ──
export async function passkeyStart(email, origin) {
  const { findUserByEmail, passkeysForUser } = await projectImport("lib/users.js");
  const challenge = auth.passkeys.challenge();
  session.set("wa_challenge", challenge);
  const u = email ? findUserByEmail(email) : null;
  return auth.passkeys.authenticationOptions({
    rpId: new URL(origin).hostname,
    challenge,
    allowCredentialIds: u ? passkeysForUser(u.id) : [],
  });
}

export async function passkeyFinish(payload) {
  const { findPasskey, findUserById, updatePasskeyCounter } = await projectImport("lib/users.js");
  const challenge = session.get("wa_challenge");
  session.delete("wa_challenge");
  if (!challenge) throw new Error("no passkey ceremony in progress");
  const cred = findPasskey(payload.credentialId);
  if (!cred) throw new Error("unknown passkey");
  const { counter } = auth.passkeys.verifyAuthentication({
    response: payload.response,
    challenge,
    origin: payload.origin,
    rpId: new URL(payload.origin).hostname,
    credential: cred,
  });
  updatePasskeyCounter(cred.credentialId, counter);
  auth.login(findUserById(cred.userId));
  return { ok: true };
}
</server>
<script>
  let { form, next, providers = [] } = $props
  let email = $state(form?.email ?? "")

  async function withPasskey() {
    const opts = await passkeyStart(email, location.origin)
    const cred = await navigator.credentials.get({ publicKey: {
      ...opts,
      challenge: b64u(opts.challenge),
      allowCredentials: opts.allowCredentials.map((c) => ({ ...c, id: b64u(c.id) })),
    }})
    await passkeyFinish({
      credentialId: b64s(cred.rawId),
      origin: location.origin,
      response: {
        clientDataJSON: b64s(cred.response.clientDataJSON),
        authenticatorData: b64s(cred.response.authenticatorData),
        signature: b64s(cred.response.signature),
      },
    })
    location.href = next && next.startsWith("/") ? next : "/"
  }
  const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  const b64s = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "")
</script>
<head><title>Sign in</title></head>

<h1>Sign in</h1>
{#if form?.error}<p class="error">{form.error}</p>{/if}

<form method="post" action="?/login">
  <input type="hidden" name="next" value={next ?? "/"} />
  <label>Email <input name="email" type="email" bind:value={email} required /></label>
  <label>Password <input name="password" type="password" required /></label>
  {#if form?.needsCode}
    <label>Authenticator code <input name="code" inputmode="numeric" autocomplete="one-time-code" /></label>
  {/if}
  <button>Sign in</button>
</form>

<button class="passkey" on:click={withPasskey}>Sign in with a passkey</button>
{#for p of providers}
  <p><a href={"/auth/oauth/" + p}>Continue with {p}</a></p>
{/for}
<p><a href="/auth/register">Create an account</a></p>

<style>
  .error { color: #c00 }
  label { display: block; margin: 0.5rem 0 }
  .passkey { margin-top: 1rem }
</style>
`;

const REGISTER_ROUTE = `<server>
export async function register(form) {
  const { createUser, findUserByEmail } = await projectImport("lib/users.js");
  const email = String(form.email ?? "").toLowerCase().trim();
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return { error: "That email doesn't look right." };
  if (!form.name?.trim()) return { error: "Name is required." };
  if (String(form.password ?? "").length < 8) return { error: "Passwords need at least 8 characters." };
  if (findUserByEmail(email)) return { error: "An account with that email already exists." };
  const u = createUser({ email, name: form.name.trim(), passwordHash: auth.hashPassword(String(form.password)) });
  auth.login(u);
  return { redirect: "/auth/account" };
}
</server>
<script>let { form } = $props</script>
<head><title>Create account</title></head>

<h1>Create account</h1>
{#if form?.error}<p class="error">{form.error}</p>{/if}
<form method="post" action="?/register">
  <label>Name <input name="name" required /></label>
  <label>Email <input name="email" type="email" required /></label>
  <label>Password <input name="password" type="password" minlength="8" required /></label>
  <button>Create account</button>
</form>
<p><a href="/auth/login">Already have an account?</a></p>

<style>
  .error { color: #c00 }
  label { display: block; margin: 0.5rem 0 }
</style>
`;

const ACCOUNT_ROUTE = `<server auth>
export async function load() {
  const { passkeysForUser, findUserById } = await projectImport("lib/users.js");
  const me = findUserById(user().id);
  return { passkeyCount: passkeysForUser(me.id).length, totpEnabled: !!me.totpSecret };
}

export async function logout() {
  auth.logout();
  return { redirect: "/" };
}

// ── passkey enrolment ──
export async function enrollStart(origin) {
  const { passkeysForUser } = await projectImport("lib/users.js");
  const challenge = auth.passkeys.challenge();
  session.set("wa_challenge", challenge);
  const me = user();
  return auth.passkeys.registrationOptions({
    rpId: new URL(origin).hostname,
    rpName: "My App",
    user: { id: me.id, name: me.email ?? me.name, displayName: me.name },
    challenge,
    excludeCredentialIds: passkeysForUser(me.id),
  });
}

export async function enrollFinish(payload) {
  const { addPasskey } = await projectImport("lib/users.js");
  const challenge = session.get("wa_challenge");
  session.delete("wa_challenge");
  if (!challenge) throw new Error("no enrolment in progress");
  const cred = auth.passkeys.verifyRegistration({
    response: payload.response,
    challenge,
    origin: payload.origin,
    rpId: new URL(payload.origin).hostname,
  });
  addPasskey(user().id, cred);
  return { ok: true };
}

// ── 2FA ──
export async function totpStart() {
  const secret = auth.totpSecret();
  session.set("totp_pending", secret);
  const me = user();
  return { secret, uri: auth.totpUri(secret, me.email ?? me.name, "My App") };
}

export async function totpConfirm(code) {
  const { setTotpSecret } = await projectImport("lib/users.js");
  const secret = session.get("totp_pending");
  if (!secret) throw new Error("no 2FA setup in progress");
  if (!auth.totpVerify(secret, code)) return { error: "Wrong code — scan the QR and try again." };
  setTotpSecret(user().id, secret);
  session.delete("totp_pending");
  return { ok: true };
}
</server>
<script>
  let { user, passkeyCount, totpEnabled } = $props
  let keys = $state(passkeyCount)
  let tfa = $state(totpEnabled)
  let totp = $state(null)
  let code = $state("")
  let msg = $state("")

  async function addKey() {
    const opts = await enrollStart(location.origin)
    const cred = await navigator.credentials.create({ publicKey: {
      ...opts,
      challenge: b64u(opts.challenge),
      user: { ...opts.user, id: b64u(opts.user.id) },
      excludeCredentials: opts.excludeCredentials.map((c) => ({ ...c, id: b64u(c.id) })),
    }})
    await enrollFinish({
      origin: location.origin,
      response: {
        clientDataJSON: b64s(cred.response.clientDataJSON),
        attestationObject: b64s(cred.response.attestationObject),
      },
    })
    keys = keys + 1
    msg = "Passkey added — next sign-in can use Face ID / Touch ID."
  }
  async function startTfa() { totp = await totpStart() }
  async function confirmTfa() {
    const r = await totpConfirm(code)
    if (r.error) { msg = r.error; return }
    tfa = true; totp = null; msg = "Two-factor enabled."
  }
  const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  const b64s = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "")
</script>
<head><title>Account</title></head>

<h1>Hi {user.name}</h1>
{#if msg}<p class="msg">{msg}</p>{/if}

<section>
  <h2>Passkeys ({keys})</h2>
  <button on:click={addKey}>Add a passkey (Face ID / Touch ID)</button>
</section>

<section>
  <h2>Two-factor authentication {#if tfa}✓ on{/if}</h2>
  {#if !tfa}
    {#if totp}
      <p>Scan in your authenticator app: <a href={totp.uri}>{totp.uri}</a></p>
      <p>Or enter the secret manually: <code>{totp.secret}</code></p>
      <input bind:value={code} inputmode="numeric" placeholder="123456" />
      <button on:click={confirmTfa}>Confirm</button>
    {:else}
      <button on:click={startTfa}>Enable 2FA</button>
    {/if}
  {/if}
</section>

<form method="post" action="?/logout"><button>Sign out</button></form>

<style>
  section { margin: 1.5rem 0 }
  .msg { color: #071 }
</style>
`;

const OAUTH_ROUTE = `<server>
// /auth/oauth/[provider] — GET = start (redirect out), ?/callback comes back.
// Configure providers with env vars: NIRAL_OAUTH_GOOGLE_ID / _SECRET, etc.
export async function load({ params }) {
  return { provider: params.provider };
}

export async function start(form) {
  const redirectUri = form.origin + "/auth/oauth/" + form.provider;
  const { url, state, verifier } = auth.oauth.start(form.provider, { redirectUri });
  session.set("oauth", { state, verifier, redirectUri, provider: form.provider });
  return { redirect: url };
}

export async function finish(payload) {
  const { findOrCreateOauthUser } = await projectImport("lib/users.js");
  const saved = session.get("oauth");
  session.delete("oauth");
  if (!saved || saved.provider !== payload.provider) throw new Error("no sign-in in progress");
  const profile = await auth.oauth.callback(payload.provider, { code: payload.code, state: payload.state }, {
    state: saved.state,
    verifier: saved.verifier,
    redirectUri: saved.redirectUri,
  });
  auth.login(findOrCreateOauthUser(profile));
  return { ok: true };
}
</server>
<script>
  let { provider } = $props
  let msg = $state("Completing sign-in…")

  // the provider redirected back with ?code&state — finish over RPC, then go home
  const q = new URLSearchParams(location.search)
  if (q.get("code")) {
    finish({ provider, code: q.get("code"), state: q.get("state") })
      .then(() => { location.href = "/" })
      .catch((e) => { msg = "Sign-in failed: " + e.message })
  } else {
    msg = "Redirecting…"
    // kick off the flow via the form action (it 303s to the provider)
    const f = document.createElement("form")
    f.method = "post"
    f.action = "/auth/oauth/" + encodeURIComponent(provider) + "?/start"
    const add = (n, v) => {
      const i = document.createElement("input")
      i.type = "hidden"; i.name = n; i.value = v
      f.appendChild(i)
    }
    add("provider", provider)
    add("origin", location.origin)
    document.body.appendChild(f)
    f.submit()
  }
</script>
<head><title>Signing in…</title></head>
<p>{msg}</p>
`;

export async function addAuth({ root = "." } = {}) {
  const dir = resolve(root);
  const files = {
    "lib/users.js": USERS_LIB,
    "routes/auth/login.niral": LOGIN_ROUTE,
    "routes/auth/register.niral": REGISTER_ROUTE,
    "routes/auth/account.niral": ACCOUNT_ROUTE,
    "routes/auth/oauth/[provider].niral": OAUTH_ROUTE,
  };
  const created = [];
  for (const [rel, content] of Object.entries(files)) {
    const out = join(dir, rel);
    if (existsSync(out)) {
      console.log(`niral · ${rel} already exists — leaving it alone`);
      continue;
    }
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, content);
    created.push(rel);
  }
  console.log(`niral · auth ready — /auth/register → /auth/login → /auth/account`);
  console.log(`niral · passkeys + scrypt passwords + TOTP 2FA + session rotation, zero dependencies`);
  console.log(`niral · guard any route with <server auth> — unauthenticated visitors go to /auth/login`);
  return { created };
}
