/**
 * Niral server — RPC for <server> functions.
 *
 * The compiler strips <server> code from the client bundle and replaces each
 * exported function with a typed-args fetch stub. This module is the other
 * half: it loads the <server> block as a real ES module (with `session`
 * injected) and executes calls inside the request's session scope.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parse } from "../compiler/parser.js";
import { als } from "./context.js";
import { readSession, sessionCookie } from "./session.js";
import { serverInfo, materialize } from "./polyglot.js";
import { satisfiesAuth } from "./auth.js";

/** Thrown when `<server auth>` is unsatisfied during SSR — handlers redirect to login. */
export class AuthRequiredError extends Error {
  constructor(requirement) {
    super("authentication required");
    this.requirement = requirement;
    this.__niralAuth = true;
  }
}

/** 401 (no user) vs 403 (user lacks the role) — or null when satisfied. */
export function authFailure(store, requirement) {
  if (!requirement) return null;
  if (satisfiesAuth(store, requirement)) return null;
  return store?.data?.user
    ? { status: 403, body: { ok: false, error: "forbidden — missing role" } }
    : { status: 401, body: { ok: false, error: "authentication required" } };
}

const CONTEXT_URL = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "context.js")
).href;
const AUTH_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "auth.js")).href;
const WEBAUTHN_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "webauthn.js")).href;
const MAIL_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "mail.js")).href;
const OAUTH_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "oauth.js")).href;
const VALIDATE_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "..", "shared", "validate.js")).href;
const OBSERVE_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "observe.js")).href;
const AI_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "ai.js")).href;
const RAG_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "rag.js")).href;

/** The ambient `auth` every JS <server> block gets — login/logout ride the
 *  session facade, crypto helpers are pure. Same shape in dev and releases. */
export function authPrelude(authUrl, webauthnUrl, mailUrl = MAIL_URL, oauthUrl = OAUTH_URL, validateUrl = VALIDATE_URL, observeUrl = OBSERVE_URL, aiUrl = AI_URL, ragUrl = RAG_URL) {
  return (
    `import * as __auth from ${JSON.stringify(authUrl)};\n` +
    `import * as __wa from ${JSON.stringify(webauthnUrl)};\n` +
    `import * as __mail from ${JSON.stringify(mailUrl)};\n` +
    `import * as __oauth from ${JSON.stringify(oauthUrl)};\n` +
    `import { v, validate, withSchema } from ${JSON.stringify(validateUrl)};\n` +
    `import { log } from ${JSON.stringify(observeUrl)};\n` +
    `import { ai } from ${JSON.stringify(aiUrl)};\n` +
    `import { rag } from ${JSON.stringify(ragUrl)};\n` +
    `const projectImport = (p) => import(new URL(p, globalThis.__niralProjectRoot).href);\n` +
    `const mail = __mail.sendMail;\n` +
    `const enqueue = (...a) => { if (!globalThis.__niralEnqueue) throw new Error("enqueue: create a jobs.js at the project root first"); return globalThis.__niralEnqueue(...a); };\n` +
    `const env = (k, d) => process.env[k] ?? d;\n` +
    `const auth = {\n` +
    `  hashPassword: __auth.hashPassword, verifyPassword: __auth.verifyPassword,\n` +
    `  totpSecret: __auth.totpSecret, totpUri: __auth.totpUri, totpVerify: __auth.totpVerify,\n` +
    `  login: (u) => { const { passwordHash, password_hash, totpSecret, totp_secret, ...safe } = u ?? {}; session.set("user", safe); session.set("sid", __auth.newSid()); },\n` +
    `  logout: () => session.clear(),\n` +
    `  user: () => session.get("user") ?? null,\n` +
    `  passkeys: {\n` +
    `    challenge: __wa.webauthnChallenge,\n` +
    `    registrationOptions: __wa.registrationOptions, authenticationOptions: __wa.authenticationOptions,\n` +
    `    verifyRegistration: __wa.verifyRegistration, verifyAuthentication: __wa.verifyAuthentication,\n` +
    `  },\n` +
    `  oauth: {\n` +
    `    providers: __oauth.configuredProviders,\n` +
    `    start: __oauth.oauthStart,\n` +
    `    callback: __oauth.oauthCallback,\n` +
    `  },\n` +
    `};\n`
  );
}

/** Write a streaming RPC result as NDJSON — shared by dev + prod handlers.
 *  Chunks flush as they're produced; errors mid-stream become an error line
 *  (headers are long gone — the client stub rethrows it). */
export async function streamRpc(res, out) {
  const headers = { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-niral-stream": "1" };
  if (out.setCookie) headers["set-cookie"] = out.setCookie;
  res.writeHead(200, headers);
  try {
    for await (const chunk of out.stream) res.write(JSON.stringify({ chunk }) + "\n");
    res.write(JSON.stringify({ done: true }) + "\n");
  } catch (e) {
    res.write(JSON.stringify({ error: String(e?.message ?? e) }) + "\n");
  }
  res.end();
}

const serverModuleCache = new Map(); // absPath → { mtimeMs, mod }

/** Compile + import the <server> block of a .niral file (mtime-cached). */
export async function loadServerModule(absPath) {
  const abs = resolve(absPath);
  const mtimeMs = statSync(abs).mtimeMs;
  const hit = serverModuleCache.get(abs);
  if (hit && hit.mtimeMs === mtimeMs) return hit.mod;

  const source = readFileSync(abs, "utf8");
  const ast = parse(source, abs);
  if (!ast.server) return null;
  if ((ast.server.attrs?.lang ?? "js") !== "js") return null; // worker languages go through the pool

  const code =
    `import { session } from ${JSON.stringify(CONTEXT_URL)};\n` +
    `const publish = (__ch, __data) => globalThis.__niralPublish?.(__ch, __data);\n` +
    `const user = () => session.get("user") ?? null;\n` +
    authPrelude(AUTH_URL, WEBAUTHN_URL) +
    ast.server.code;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  serverModuleCache.set(abs, { mtimeMs, mod });
  return mod;
}

/**
 * Execute one RPC call within a session scope — any server language.
 * Returns { status, body, setCookie|null }.
 */
export async function executeRpc(absPath, fn, args, cookieHeader, secret, pool) {
  const info = serverInfo(resolve(absPath));
  if (!info) return { status: 404, body: { ok: false, error: "no <server> block in this module" } };

  // <server auth> — rejected BEFORE any user code runs
  if (info.auth) {
    const store = readSession(cookieHeader, secret);
    const fail = authFailure(store, info.auth);
    if (fail) return fail;
  }

  if (info.lang === "js") {
    const mod = await loadServerModule(absPath);
    if (!mod) return { status: 404, body: { ok: false, error: "no <server> block in this module" } };
    return callServerFn(mod, fn, args, cookieHeader, secret);
  }

  // worker language
  if (typeof fn !== "string" || fn.startsWith("_") || fn === "load") {
    return { status: 404, body: { ok: false, error: `unknown server function '${fn}'` } };
  }
  const { file, changed } = materialize(resolve(absPath), info);
  if (changed) pool?.invalidate(file);
  const store = readSession(cookieHeader, secret);
  return pooledCall(pool, info.lang, file, fn, args, store, secret);
}

/** Shared worker-call → HTTP result mapping (used by dev + prod). */
export async function pooledCall(pool, lang, file, fn, args, store, secret) {
  if (!pool) return { status: 500, body: { ok: false, error: "no worker pool configured" } };
  let res;
  try {
    res = await pool.call(lang, file, fn, Array.isArray(args) ? args : [], store.data);
  } catch (e) {
    return { status: 500, body: { ok: false, error: String(e?.message ?? e) } };
  }
  if (res.session) {
    store.data = res.session;
    store.dirty = true;
  }
  const setCookie = store.dirty ? sessionCookie(store, secret) : null;
  if (!res.ok) {
    return {
      status: res.errorKind === "unknown_fn" ? 404 : 500,
      body: { ok: false, error: res.error },
      setCookie,
    };
  }
  return { status: 200, body: { ok: true, result: res.result ?? null }, setCookie };
}

/**
 * Run a route's <server> load() during SSR — any language.
 * Mutates `store` (session). Returns the loaded data or null.
 *   js:      load({ params })   — ambient session via AsyncLocalStorage
 *   python:  def load(params)   — ambient session via the runner
 */
export async function runServerLoad(absPath, params, store, { pool, alsOverride = als, locals = null } = {}) {
  const info = serverInfo(resolve(absPath));
  if (!info) return null;
  // <server auth> guards the PAGE, load() or not
  if (info.auth && !satisfiesAuth(store, info.auth)) throw new AuthRequiredError(info.auth);
  if (!info.exports.includes("load")) return null;

  if (info.lang === "js") {
    const mod = await loadServerModule(absPath);
    if (!mod || typeof mod.load !== "function") return null;
    return await alsOverride.run(store, () => mod.load({ params, locals }));
  }

  const { file, changed } = materialize(resolve(absPath), info);
  if (changed) pool?.invalidate(file);
  if (!pool) throw new Error("no worker pool configured");
  const res = await pool.call(info.lang, file, "load", [params], store.data);
  if (res.session) {
    store.data = res.session;
    store.dirty = true;
  }
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

/** Call a server function on an already-loaded module (shared by dev + prod).
 *  `alsOverride`: the AsyncLocalStorage the module's `session` is bound to —
 *  built releases carry their own copy of context.js, so prod must pass it. */
export async function callServerFn(mod, fn, args, cookieHeader, secret, alsOverride = als) {
  const target = mod[fn];
  if (typeof target !== "function" || fn.startsWith("_") || fn === "load") {
    return { status: 404, body: { ok: false, error: `unknown server function '${fn}'` } };
  }

  const store = readSession(cookieHeader, secret);
  try {
    const result = await alsOverride.run(store, () => target(...(Array.isArray(args) ? args : [])));
    // ASYNC GENERATOR → streaming RPC: chunks flow to the client as they're
    // produced (AI tokens, progress …). Each pull re-enters the session scope.
    if (result != null && typeof result[Symbol.asyncIterator] === "function" && typeof result.next === "function") {
      const it = result;
      const wrapped = {
        [Symbol.asyncIterator]() {
          return {
            next: () => alsOverride.run(store, () => it.next()),
            return: (v) => alsOverride.run(store, () => it.return?.(v) ?? { done: true }),
          };
        },
      };
      return {
        status: 200,
        stream: wrapped,
        setCookie: store.dirty ? sessionCookie(store, secret) : null, // pre-stream writes only
      };
    }
    return {
      status: 200,
      body: { ok: true, result: result === undefined ? null : result },
      setCookie: store.dirty ? sessionCookie(store, secret) : null,
    };
  } catch (e) {
    if (e?.__niralValidation) {
      return {
        status: 400,
        body: { ok: false, error: "validation failed", errors: e.errors },
        setCookie: store.dirty ? sessionCookie(store, secret) : null,
      };
    }
    return {
      status: 500,
      body: { ok: false, error: String(e?.message ?? e) },
      setCookie: store.dirty ? sessionCookie(store, secret) : null,
    };
  }
}
