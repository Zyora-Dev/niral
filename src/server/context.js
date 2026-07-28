/**
 * Niral server — request context for <server> functions.
 *
 * Server functions run inside an AsyncLocalStorage scope created by the RPC
 * handler. Compiled server modules get `session` injected — no imports, no
 * middleware, no ceremony:
 *
 *   <server>
 *     export async function like() {
 *       session.set("likes", (session.get("likes") ?? 0) + 1)
 *       return session.get("likes")
 *     }
 *   </server>
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const als = new AsyncLocalStorage();

function store() {
  const s = als.getStore();
  if (!s) throw new Error("`session` is only available inside <server> functions handling a request");
  return s;
}

export const session = {
  get(key) {
    return store().data[key];
  },
  set(key, value) {
    const s = store();
    s.data[key] = value;
    s.dirty = true;
  },
  delete(key) {
    const s = store();
    delete s.data[key];
    s.dirty = true;
  },
  clear() {
    const s = store();
    s.data = {};
    s.dirty = true;
  },
  all() {
    return { ...store().data };
  },
};
