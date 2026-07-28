/**
 * Niral runtime — signals (the reactive core).
 *
 * Fine-grained reactivity: a signal knows exactly which effects read it,
 * and setting it re-runs only those effects. No virtual DOM, no diffing.
 *
 *   signal(v)      → { get(), set(v), update(fn) }
 *   derived(fn)    → { get() }            recomputes when its inputs change
 *   effect(fn)     → dispose()            re-runs when anything it read changes
 *   root(fn)       → [result, dispose]    ownership scope for cleanup
 */

let activeEffect = null;
let activeScope = null;
let signalSink = null; // HMR: collects user signals created during a mount

/**
 * Runtime errors in the browser are contained: reported, not fatal to the
 * whole reactive graph. On the server (SSR) they rethrow — a render must
 * fail loudly.
 */
export function _reportError(err, where) {
  if (typeof window === "undefined") throw err;
  console.error(`[niral] error in ${where}:`, err);
  try {
    window.dispatchEvent(
      new CustomEvent("niral:error", {
        detail: { message: String(err?.message ?? err), where, stack: err?.stack ?? null },
      })
    );
  } catch {
    /* CustomEvent unavailable — console is enough */
  }
}

/** @internal HMR — collect signals created while `sink` is active. */
export function _setSink(sink) {
  signalSink = sink;
}

/* ── scheduling ─────────────────────────────────────────────────
   Updates are SYNCHRONOUS (state is settled when set() returns) but flushed
   through a queue: within one flush each effect runs at most once per
   scheduling — diamond dependencies (a → b,c → d) no longer run the join
   effect twice. `batch(fn)` extends one flush across many writes. */

let queue = null; // Set<effect> currently being flushed / collected

function scheduleEffects(subs) {
  if (queue) {
    for (const e of subs) queue.add(e); // joins the running flush (dedup)
    return;
  }
  queue = new Set(subs);
  try {
    flushQueue(queue);
  } finally {
    queue = null;
  }
}

function flushQueue(q) {
  let guard = 0;
  for (const e of q) {
    q.delete(e); // an effect may be RE-scheduled by a later effect — and re-run
    e.run();
    if (++guard > 10_000) {
      _reportError(new Error("update loop: an effect keeps scheduling itself"), "the scheduler");
      return;
    }
  }
}

/** Group many writes into ONE flush: effects see the final state only. */
export function batch(fn) {
  if (queue) {
    fn(); // already inside a flush — writes join it
    return;
  }
  queue = new Set();
  const q = queue;
  try {
    fn();
    flushQueue(q);
  } finally {
    queue = null;
  }
}

export function signal(value) {
  const subs = new Set();
  const s = {
    get() {
      if (activeEffect) {
        subs.add(activeEffect);
        activeEffect.deps.push(subs);
      }
      return value;
    },
    set(next) {
      if (next === value) return;
      value = next;
      scheduleEffects(subs);
    },
    update(fn) {
      this.set(fn(value));
    },
    /** Re-run subscribers WITHOUT changing the value — for in-place mutation
     *  of objects held in signals (e.g. bind: on a keyed {#for} item). */
    touch() {
      scheduleEffects(subs);
    },
  };
  if (signalSink) signalSink.push(s);
  return s;
}

export function derived(fn) {
  // derived state recomputes — its internal signal must not be captured/restored
  const prevSink = signalSink;
  signalSink = null;
  const out = signal(undefined);
  signalSink = prevSink;
  effect(() => out.set(fn()));
  return { get: () => out.get() };
}

export function effect(fn) {
  const e = {
    deps: [],
    disposed: false,
    run() {
      if (e.disposed) return;
      unlink(e);
      const prevEffect = activeEffect;
      const prevScope = activeScope;
      activeEffect = e;
      activeScope = e.scope; // children created during run belong to this effect's scope
      try {
        fn();
      } catch (err) {
        _reportError(err, "an effect");
      } finally {
        activeEffect = prevEffect;
        activeScope = prevScope;
      }
    },
    dispose() {
      if (e.disposed) return;
      e.disposed = true;
      unlink(e);
      disposeScope(e.scope);
    },
    scope: makeScope(),
  };
  if (activeScope) activeScope.children.push(e);
  e.run();
  return e;
}

/** Run `fn` inside a fresh ownership scope; disposing tears down every
 *  effect (and nested scope) created during the run. The scope also attaches
 *  to the CURRENT scope, so disposing an ancestor cascades — async work
 *  scheduled by unmounted regions can never fire into dead DOM. */
export function root(fn) {
  const scope = makeScope();
  if (activeScope) activeScope.children.push(scope);
  const prev = activeScope;
  activeScope = scope;
  let result;
  try {
    result = fn();
  } finally {
    activeScope = prev;
  }
  return [result, () => disposeScope(scope)];
}

function makeScope() {
  return { children: [], parent: activeScope, ctx: null };
}

function disposeScope(scope) {
  for (const child of scope.children) {
    if (typeof child.dispose === "function") child.dispose();
    else disposeScope(child);
  }
  scope.children.length = 0;
}

function unlink(e) {
  for (const subs of e.deps) subs.delete(e);
  e.deps.length = 0;
}

/** Run `fn` without subscribing the current effect to anything it reads. */
export function untrack(fn) {
  const prev = activeEffect;
  activeEffect = null;
  try {
    return fn();
  } finally {
    activeEffect = prev;
  }
}

/* ── reactive props ────────────────────────────────────────
   `let { items } = $props` compiles to prop() bindings: when the parent
   passes a live props signal (component instances), each prop is a derived
   view into it — updates flow FINE-GRAINED into the child (DOM, effects and
   local $state all survive). Root pages get a static snapshot. */

const propWrite = () => {
  throw new Error("props are read-only — declare local $state, or pass a handler prop and let the parent own the value");
};

export function prop(props, key, fallback) {
  if (props && props.__sig) {
    const src = props.__sig;
    const d = derived(() => {
      const v = src.get()[key];
      return v === undefined && fallback ? fallback() : v;
    });
    return { get: d.get, set: propWrite, update: propWrite, touch: propWrite };
  }
  let v = props ? props[key] : undefined;
  if (v === undefined && fallback) v = fallback();
  const val = v;
  return { get: () => val, set: propWrite, update: propWrite, touch: propWrite };
}

/* ── context ──────────────────────────────────────────────────
   setContext(key, value) during component setup → any DESCENDANT component
   reads it with getContext(key) — no prop drilling. Resolution walks the
   ownership-scope chain, so it respects the component tree (and regions,
   keyed rows, slots … anything built inside the provider). */

export function setContext(key, value) {
  if (!activeScope) throw new Error("setContext() must run during component setup (top level of <script>)");
  (activeScope.ctx ??= new Map()).set(key, value);
}

export function getContext(key, fallback) {
  for (let s = activeScope; s; s = s.parent) {
    if (s.ctx?.has(key)) return s.ctx.get(key);
  }
  return fallback;
}
