// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * NiralScript → React adapter runtime.
 *
 * NiralScript's compiler emits `createInstance(inputs, globals, runtime)` where
 * `runtime` supplies `signal(v)→{get,set}` and `derived(fn)→{get}` over a shared
 * revision counter. The stock runtime has no way to NOTIFY when that revision
 * changes, which is exactly what React's useSyncExternalStore needs.
 *
 * This runtime is a drop-in replacement with the SAME get/set/derive semantics
 * (Object.is dedupe, lazy revision-stamped derives, cycle guard) PLUS a per-store
 * `subscribe(listener)` and `getVersion()`. Injecting it leaves the compiled
 * module and the language untouched — it is purely an adapter concern.
 */

/** Build one subscription-aware runtime bound to a single NiralScript instance. */
export function createReactRuntime() {
  let revision = 0;
  const listeners = new Set();

  function bump() {
    revision++;
    for (const listener of listeners) listener();
  }

  const runtime = {
    signal(value) {
      return {
        get: () => value,
        set(next) {
          if (!Object.is(value, next)) {
            value = next;
            bump();
          }
        },
      };
    },
    derived(compute) {
      let stamp = -1;
      let value;
      let running = false;
      return {
        get() {
          if (running) throw new Error("Reactive dependency cycle");
          if (stamp !== revision) {
            running = true;
            try {
              value = compute();
              stamp = revision;
            } finally {
              running = false;
            }
          }
          return value;
        },
      };
    },
  };

  // React store surface — not seen by the compiled module, used by the hook.
  runtime.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  runtime.getVersion = () => revision;

  return runtime;
}
