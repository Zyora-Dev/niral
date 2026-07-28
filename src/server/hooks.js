/**
 * Niral server — hooks (middleware).
 *
 * A project-root `hooks.js` runs before EVERY request (dev + prod):
 *
 *   // hooks.js
 *   export async function handle(event) {
 *     if (event.path.startsWith("/admin") && !event.session.get("user")) {
 *       return event.redirect("/login");
 *     }
 *     event.locals.startedAt = Date.now();   // → load({ params, locals })
 *     // return nothing to continue to the route
 *   }
 *
 * Return values:
 *   undefined/null              continue to normal routing
 *   event.redirect(to, status?) redirect (303 default)
 *   { status?, body, headers? } short-circuit — string body → HTML,
 *                               object body → JSON
 * Session writes are persisted on short-circuit responses; for pass-through
 * requests use load()/actions for session writes.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sessionCookie } from "./session.js";

const cache = new Map();

/** Import <projectDir>/hooks.js (mtime-cached — edits picked up in dev). */
export async function loadHooks(projectDir) {
  const file = join(projectDir, "hooks.js");
  if (!existsSync(file)) return null;
  const mtimeMs = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.mod;
  const mod = await import(pathToFileURL(file).href + "?v=" + mtimeMs);
  cache.set(file, { mtimeMs, mod });
  return mod;
}

/**
 * hooks.js may declare the environment variables the app cannot run without:
 *
 *   export const env = ["STRIPE_KEY", "SMTP_PASS"]
 *
 * Production refuses to boot when any are missing (fail at deploy, not at 3am
 * mid-request); dev warns loudly. `niral doctor` reports them too.
 */
export async function checkRequiredEnv(projectDir) {
  let hooks = null;
  try {
    hooks = await loadHooks(projectDir);
  } catch {
    return { missing: [], declared: 0 }; // a broken hooks.js surfaces its own error elsewhere
  }
  const names = Array.isArray(hooks?.env) ? hooks.env.filter((n) => typeof n === "string") : [];
  const missing = names.filter((n) => !process.env[n]);
  return { missing, declared: names.length };
}

export function makeEvent(req, path, store) {
  return {
    path,
    method: req.method,
    headers: req.headers,
    query: new URL(req.url, "http://x").searchParams,
    locals: {},
    session: {
      get: (key, def) => (key in store.data ? store.data[key] : def),
      set(key, value) {
        store.data[key] = value;
        store.dirty = true;
      },
      delete(key) {
        delete store.data[key];
        store.dirty = true;
      },
      all: () => ({ ...store.data }),
    },
    redirect: (to, status = 303) => ({ __niralRedirect: to, status }),
  };
}

/** Run handle() and write any short-circuit response. Returns true when the
 *  request was fully handled; false → continue to normal routing. */
export async function applyHooks(hooks, req, res, path, store, secret) {
  if (!hooks?.handle) return { handled: false, locals: null };
  const event = makeEvent(req, path, store);
  const out = await hooks.handle(event);
  if (out == null) return { handled: false, locals: event.locals };

  const cookie = store.dirty ? sessionCookie(store, secret) : null;
  if (out.__niralRedirect) {
    const headers = { location: out.__niralRedirect };
    if (cookie) headers["set-cookie"] = cookie;
    res.writeHead(out.status ?? 303, headers);
    res.end();
    return { handled: true, locals: event.locals };
  }
  const isJson = out.body !== null && typeof out.body === "object";
  const headers = {
    "content-type": isJson ? "application/json" : "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...(out.headers ?? {}),
  };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(out.status ?? 200, headers);
  res.end(isJson ? JSON.stringify(out.body) : String(out.body ?? ""));
  return { handled: true, locals: event.locals };
}
