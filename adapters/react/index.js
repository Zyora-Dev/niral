// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * NiralScript → React adapter.
 *
 * Lets a React (or Next.js) app consume a compiled NiralScript module — the
 * `{ createInstance }` emitted by `nrs compile` — as idiomatic React.
 *
 *   import * as counter from "./counter.nrs";   // via the bundler loader
 *   import { useNrs } from "@niral/react";
 *
 *   function Counter({ initial }) {
 *     const c = useNrs(counter, { initial });   // live reactive values + RPCs
 *     return <button onClick={c.increment}>{c.count} / {c.doubled}</button>;
 *   }
 *
 * `useNrs` creates ONE NiralScript instance per mounted component, subscribes
 * React to its reactive revision via useSyncExternalStore, and pushes changed
 * props into the module's `input` signals through `updateInputs`. Reads of
 * reactive bindings stay live; exported functions are returned as stable RPCs.
 */

import { useRef, useMemo, useSyncExternalStore, useEffect } from "react";
import { createReactRuntime } from "./runtime.js";

/** A compiled NiralScript module exposes `createInstance`; accept the module or the function. */
function resolveFactory(module) {
  const factory = typeof module === "function" ? module : module?.createInstance;
  if (typeof factory !== "function") {
    throw new TypeError("useNrs expects a compiled NiralScript module exporting createInstance");
  }
  return factory;
}

/**
 * Mount a compiled NiralScript module inside a React component.
 *
 * @param {object|Function} module  The compiled module (or its createInstance).
 * @param {object} [props]          Values for the module's `input` declarations.
 * @param {object} [globals]        Host globals the module declared (optional).
 * @returns {object}  A proxy over the module's `values`: live reactive reads,
 *                    stable callable exports. Re-renders when reactive state moves.
 */
export function useNrs(module, props = {}, globals = {}) {
  const factory = resolveFactory(module);

  // One runtime + instance for this component's lifetime. createInstance may be
  // async (top-level await); that form is not supported by this sync hook path.
  const stateRef = useRef(null);
  if (stateRef.current === null) {
    const runtime = createReactRuntime();
    const instance = factory(props, globals, runtime);
    if (typeof instance?.then === "function") {
      throw new TypeError("useNrs does not support NiralScript modules with top-level await");
    }
    stateRef.current = { runtime, instance };
  }
  const { runtime, instance } = stateRef.current;

  // Subscribe React to the module's reactive revision.
  const version = useSyncExternalStore(
    runtime.subscribe,
    runtime.getVersion,
    runtime.getVersion, // server snapshot — SSR reads the initial revision
  );

  // Flow changed props into the module's input signals, after render commits.
  useEffect(() => {
    instance.updateInputs(props);
    // Intentionally keyed on prop identity below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, propDeps(props));

  // Expose a live view: reactive getters read through on each access (version
  // forces a fresh object each render so consumers see current values), while
  // function exports are returned as-is (stable identities on the instance).
  return useMemo(() => {
    const view = {};
    const { values } = instance;
    for (const key of Object.keys(values)) {
      const descriptor = Object.getOwnPropertyDescriptor(values, key);
      if (descriptor.get) {
        Object.defineProperty(view, key, { enumerable: true, get: () => values[key] });
      } else {
        view[key] = descriptor.value;
      }
    }
    return view;
    // version makes the memo recompute per reactive change; instance is stable.
  }, [instance, version]);
}

/** Stable, ordered dependency list from a props object for the input-sync effect. */
function propDeps(props) {
  const keys = Object.keys(props).sort();
  return keys.flatMap((key) => [key, props[key]]);
}

/**
 * Wrap a compiled NiralScript module into a self-contained React component.
 * The `render` callback receives the live view from `useNrs` plus raw props.
 *
 *   export default bindNrs(counter, (c) => (
 *     <button onClick={c.increment}>{c.count}</button>
 *   ));
 */
export function bindNrs(module, render, globals = {}) {
  function NrsComponent(props) {
    const view = useNrs(module, props, globals);
    return render(view, props);
  }
  NrsComponent.displayName = "Nrs(" + (module?.name ?? "module") + ")";
  return NrsComponent;
}

export { createReactRuntime } from "./runtime.js";
