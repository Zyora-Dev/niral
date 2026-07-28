/**
 * Niral runtime — DOM layer.
 *
 * The tiny set of primitives generated code calls. Each `bind*` helper
 * wires an effect straight onto a concrete DOM node — surgical updates,
 * nothing re-renders.
 */

import { signal, derived, effect, root, untrack, _setSink, _reportError } from "./signals.js";

/* ── attach-hydration ──────────────────────────────────────────
   The first mount after SSR CLAIMS the server-rendered DOM instead of
   rebuilding it: builders run in the exact order the server ran them, so a
   cursor walking the existing tree hands each `el()`/`text()`/anchor call
   its pre-rendered node — effects and listeners attach to live DOM, nothing
   flashes. Any mismatch flips a flag and the mount falls back to a clean
   client render (correctness never depends on hydration succeeding). */

let H = null; // active cursor: { frames: [{ parent, next, stop }] }
let hydrateTarget = null; // set by _hydrateNext — the next mount of this target hydrates
let hydrateFailed = false;

/** @internal router — the next mount() onto `target` attaches to its SSR DOM. */
export function _hydrateNext(target) {
  hydrateTarget = target;
}

const hActive = () => H != null;
const hTop = () => H.frames[H.frames.length - 1];

function hNext() {
  const f = hTop();
  return f.next === f.stop ? null : f.next;
}

function hFail(why) {
  if (typeof console !== "undefined") console.warn(`[niral] hydration mismatch (${why}) — re-rendering`);
  H = null; // rest of the build creates fresh nodes; mount() rebuilds cleanly after
  hydrateFailed = true;
}

/** Void/empty elements never get an `append()` call — their frames are
 *  closed lazily: pop exhausted element frames before any claim. Region
 *  frames (stop-less by design) are never settled away — their end anchor
 *  is claimed explicitly. */
function hSettle() {
  while (H.frames.length > 1) {
    const t = hTop();
    if (t.stop === null && t.next === null && !t.region) H.frames.pop();
    else break;
  }
}

/** Pop frames down to (and including) `frame` — exhausted element frames above it settle away. */
function hPopTo(frame) {
  while (H.frames.length) {
    const t = H.frames.pop();
    if (t === frame) return;
  }
}

function claimEl(tag) {
  hSettle();
  const c = hNext();
  // localName is already lowercase for HTML — no per-claim toLowerCase
  if (!c || c.nodeType !== 1 || (c.localName ?? c.tagName.toLowerCase()) !== tag) {
    hFail(`expected <${tag}>`);
    return document.createElement(tag);
  }
  hTop().next = c.nextSibling;
  H.frames.push({ parent: c, next: c.firstChild ?? null, stop: null });
  return c;
}

function claimText(s) {
  hSettle();
  const f = hTop();
  const c = f.next === f.stop ? null : f.next;
  // empty-text placeholder emitted by the SSR serializer (<!--n:t-->)
  if (c && c.nodeType === 8 && c.data === "n:t") {
    const t = document.createTextNode(s);
    f.parent.insertBefore(t, c);
    f.next = c.nextSibling;
    c.remove();
    return t;
  }
  if (!c || c.nodeType !== 3) {
    hFail(`text "${s.slice(0, 24)}"`);
    return document.createTextNode(s);
  }
  if (c.data !== s) {
    // adjacent SSR text nodes parse as ONE browser node — split our piece off
    if (c.data.startsWith(s) && c.splitText) c.splitText(s.length);
    else {
      hFail(`text "${s.slice(0, 24)}"`);
      return document.createTextNode(s);
    }
  }
  f.next = c.nextSibling;
  return c;
}

function claimComment(data) {
  hSettle();
  const c = hNext();
  if (!c || c.nodeType !== 8 || c.data !== data) {
    hFail(`expected <!--${data}-->`);
    return document.createComment(data);
  }
  hTop().next = c.nextSibling;
  return c;
}

/** The matching niral:end for a region whose content was just claimed — the
 *  cursor walked every child in order, so it must be sitting ON the end
 *  anchor now (no pre-scan: claiming IS the search). Returns null + hFail
 *  on mismatch. */
function claimRegionEnd(frame) {
  hSettle();
  const e = claimComment("niral:end");
  if (!hActive()) return null;
  hPopTo(frame);
  hTop().next = e.nextSibling; // outer cursor skips past the region
  return e;
}

/* ── creation ── */

export function el(tag) {
  if (hActive()) return claimEl(tag);
  return document.createElement(tag);
}

export function text(data) {
  if (hActive()) return claimText(String(data));
  return document.createTextNode(data);
}

export function append(parent, ...children) {
  // builder closed this element — settle exhausted frames, pop its own
  while (hActive() && H.frames.length > 1) {
    const t = hTop();
    if (t.parent === parent) {
      H.frames.pop();
      break;
    }
    if (t.stop === null && t.next === null) H.frames.pop();
    else break;
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c.parentNode !== parent) parent.appendChild(c);
  }
  return parent;
}

/* ── attributes & events ── */

export function setAttr(node, name, value) {
  if (value === false || value == null) node.removeAttribute(name);
  else if (value === true) node.setAttribute(name, "");
  else node.setAttribute(name, String(value));
}

export function bindAttr(node, name, fn) {
  effect(() => setAttr(node, name, fn()));
}

/** class:active={cond} — toggle one class, leaving the rest (incl. scope classes) alone. */
export function bindClass(node, name, fn) {
  effect(() => {
    const on = !!fn();
    if (node.classList) node.classList.toggle(name, on);
    else {
      // dom-shim path (SSR): merge into the class attribute
      const cur = (node.attributes.get("class") ?? "").split(/\s+/).filter(Boolean);
      const has = cur.includes(name);
      if (on && !has) node.setAttribute("class", [...cur, name].join(" "));
      else if (!on && has) node.setAttribute("class", cur.filter((c) => c !== name).join(" "));
    }
  });
}

/** style:color={expr} — one reactive style property. */
export function bindStyle(node, prop, fn) {
  effect(() => {
    const v = fn();
    if (node.style?.setProperty) {
      if (v == null || v === "") node.style.removeProperty(prop);
      else node.style.setProperty(prop, String(v));
    } else {
      // dom-shim path (SSR): merge into the style attribute
      const cur = (node.attributes.get("style") ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !s.startsWith(prop + ":"));
      if (v != null && v !== "") cur.push(`${prop}: ${v}`);
      if (cur.length) node.setAttribute("style", cur.join("; "));
      else node.removeAttribute("style");
    }
  });
}

/** Claim EVERYTHING up to this region's matching end anchor — for opaque
 *  content ({@html}) whose builder can't claim node-by-node. Depth-aware:
 *  nested regions inside the raw HTML stay intact. */
function claimOpaque() {
  const f = hTop();
  const out = [];
  let depth = 0;
  while (f.next) {
    const n = f.next;
    if (n.nodeType === 8 && n.data === "niral:start") depth++;
    else if (n.nodeType === 8 && n.data === "niral:end") {
      if (depth === 0) break;
      depth--;
    }
    out.push(n);
    f.next = n.nextSibling;
  }
  return out;
}

/** {@html expr} — raw, UNESCAPED html. Trusted content ONLY (docs shout this). */
export function rawHtml(fn) {
  return region(() => {
    const html = String(fn() ?? "");
    if (typeof window === "undefined") {
      // SSR — the shim carries it as an unescaped raw node
      return [document.createRawNode ? document.createRawNode(html) : document.createTextNode(html)];
    }
    // hydration: the SSR markup IS the html — claim it wholesale, no re-parse
    if (hActive()) return claimOpaque();
    const t = document.createElement("template");
    t.innerHTML = html;
    return [...t.content.childNodes];
  });
}

export function on(node, event, handler) {
  node.addEventListener(event, (e) => {
    try {
      const out = handler(e);
      if (out && typeof out.catch === "function") {
        out.catch((err) => _reportError(err, `on:${event}`));
      }
      return out;
    } catch (err) {
      _reportError(err, `on:${event}`);
    }
  });
}

/** Two-way binding for inputs: bind:value={sig} */
export function bindValue(node, sig) {
  const isCheckbox = node.type === "checkbox";
  effect(() => {
    const v = sig.get();
    if (isCheckbox) node.checked = !!v;
    else if (node.value !== String(v ?? "")) node.value = v ?? "";
  });
  node.addEventListener("input", () => {
    sig.set(isCheckbox ? node.checked : node.value);
  });
}

/** Two-way binding to a PATH on a signal: bind:value={todo.text}.
 *  `getFn` reads (signal-tracked), `setFn` writes through to the underlying
 *  object and touches the signal so sibling bindings update. */
export function bindPath(node, getFn, setFn) {
  const isCheckbox = node.type === "checkbox";
  effect(() => {
    const v = getFn();
    if (isCheckbox) node.checked = !!v;
    else if (node.value !== String(v ?? "")) node.value = v ?? "";
  });
  node.addEventListener("input", () => {
    setFn(isCheckbox ? node.checked : node.value);
  });
}

/* ── reactive text ── */

export function bindText(fn) {
  let t = null;
  effect(() => {
    const v = fn();
    const s = v == null ? "" : String(v);
    if (!t) t = hActive() ? claimText(s) : document.createTextNode(s);
    else t.data = s;
  });
  return t; // the effect ran synchronously — t is set
}

/* ── transitions ──────────────────────────────────────────────────
   transition:fade · transition:slide · transition:scale — enter plays when a
   region inserts the element, leave plays before removal (removal waits).
   animate:flip — keyed {#for} rows glide to their new position on reorder.
   Powered by the Web Animations API; SSR and hydration are no-ops (the
   first paint never flashes). */

const TRANSITIONS = {
  fade: () => [{ opacity: 0 }, { opacity: 1 }],
  slide: () => [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }],
  scale: () => [{ opacity: 0, transform: "scale(0.95)" }, { opacity: 1, transform: "scale(1)" }],
};

export function transition(node, name, optsFn) {
  const opts = optsFn?.() ?? {};
  node.__niralTransition = { name, duration: opts.duration ?? 200, easing: opts.easing ?? "ease" };
  if (typeof window === "undefined" || !node.animate) return;
  if (node.isConnected) return; // hydration claimed it — already visible, no flash
  const frames = (TRANSITIONS[name] ?? TRANSITIONS.fade)();
  // play once it's actually in the document
  requestAnimationFrame(() => {
    if (node.isConnected) node.animate(frames, { duration: node.__niralTransition.duration, easing: node.__niralTransition.easing });
  });
}

/** animate:flip — mark a keyed-for row for FLIP movement on reorder. */
export function animateFlip(node) {
  node.__niralFlip = true;
}

/** Remove a region's node — leave-transitions play out first. */
function removeNode(n) {
  const t = n.__niralTransition;
  if (t && typeof window !== "undefined" && n.animate && n.isConnected) {
    const frames = (TRANSITIONS[t.name] ?? TRANSITIONS.fade)().slice().reverse();
    const anim = n.animate(frames, { duration: t.duration, easing: t.easing });
    anim.onfinish = () => n.remove();
    anim.oncancel = () => n.remove();
    return;
  }
  n.remove();
}

/* ── regions: {#if} / {#for} ───────────────────────────────
   A region is a pair of comment anchors. When its driving expression
   changes, the previous contents (DOM + effects) are torn down and the
   region is rebuilt — everything OUTSIDE the region is untouched. */

function region(build) {
  let start = null;
  let end = null;
  let hydrating = false;
  if (hActive()) {
    const s = claimComment("niral:start");
    if (hActive()) {
      start = s;
      hydrating = true; // content claimed in place; end anchor claimed after build
    }
  }
  if (!hydrating) {
    start = start ?? document.createComment("niral:start");
    end = document.createComment("niral:end");
  }
  let disposePrev = null;
  let pending = null; // first-run nodes, returned inline before anchors are mounted
  let first = true;

  effect(() => {
    // first run while hydrating: claim the SSR content between the anchors
    if (first && hydrating && hActive()) {
      first = false;
      const frame = { parent: start.parentNode, next: start.nextSibling, stop: null, region: true };
      H.frames.push(frame);
      const [, dispose] = root(build);
      if (hActive()) end = claimRegionEnd(frame);
      if (!end) end = document.createComment("niral:end"); // mismatch — mount re-renders cleanly
      disposePrev = dispose;
      return;
    }
    first = false;
    // tear down previous contents (leave-transitions play out)
    if (disposePrev) disposePrev();
    if (start.parentNode) {
      let n = start.nextSibling;
      while (n && n !== end) {
        const next = n.nextSibling;
        removeNode(n);
        n = next;
      }
    }
    const wasHydrating = hActive();
    if (wasHydrating) H = null; // re-runs during a failed hydration build fresh
    const [nodes, dispose] = root(build);
    if (wasHydrating) hFail("region re-ran during hydration");
    disposePrev = dispose;
    const flat = [nodes].flat(Infinity).filter((n) => n != null);
    if (end.parentNode) {
      for (const n of flat) end.parentNode.insertBefore(n, end);
    } else {
      // first run happens before mount — hand the nodes back inline
      pending = flat;
    }
  });

  return [start, ...(pending ?? []), end];
}

/**
 * {#if}/{:else if}/{:else}
 * branches: Array<[condFn|null, buildFn]> — first truthy branch renders.
 */
export function ifBlock(branches) {
  // memoized branch selection: conditions are tracked by a derived INDEX,
  // the region rebuilds ONLY when the chosen branch changes — content
  // (and its input state) survives unrelated updates to condition signals.
  const idx = derived(() => {
    for (let i = 0; i < branches.length; i++) {
      const [cond] = branches[i];
      if (cond == null || cond()) return i;
    }
    return -1;
  });
  return region(() => {
    const i = idx.get();
    return i === -1 ? [] : branches[i][1]();
  });
}

/**
 * {#for item, i of listFn()}
 *   without key: the region rebuilds when the iterable changes (simple, correct)
 *   with `key expr`: KEYED RECONCILIATION — entries are matched by key and
 *   reused: DOM nodes, effects and input state survive reorders; the entry's
 *   item/index are signals, so content updates are fine-grained.
 */
export function forBlock(listFn, buildItem, keyFn) {
  if (!keyFn) {
    return region(() => {
      const out = [];
      const list = listFn() ?? [];
      let i = 0;
      for (const item of list) out.push(buildItem(item, i++));
      return out;
    });
  }

  let start = null;
  let end = null;
  let hydrating = false;
  if (hActive()) {
    const s = claimComment("niral:start");
    if (hActive()) {
      start = s;
      hydrating = true;
    }
  }
  if (!hydrating) {
    start = start ?? document.createComment("niral:start");
    end = document.createComment("niral:end");
  }
  let entries = [];
  let pending = null;
  let firstRun = true;

  effect(() => {
    const list = [...(listFn() ?? [])];

    // first run while hydrating: claim each SSR entry run in order
    if (firstRun && hydrating && hActive()) {
      firstRun = false;
      const frame = { parent: start.parentNode, next: start.nextSibling, stop: null, region: true };
      H.frames.push(frame);
      const claimed = [];
      for (let i = 0; i < list.length && hActive(); i++) {
        const itemSig = signal(list[i]);
        const idxSig = signal(i);
        const estart = claimComment("niral:start");
        if (!hActive()) break;
        const [, dispose] = root(() => buildItem(itemSig, idxSig));
        const eend = hActive() ? claimComment("niral:end") : document.createComment("niral:end");
        claimed.push({ key: keyFn(list[i], i), itemSig, idxSig, dispose, estart, eend, fresh: null });
      }
      // the cursor must now sit ON the region's end anchor — extra SSR
      // entries would leave another niral:start here and fail the claim
      if (hActive()) end = claimRegionEnd(frame);
      if (!end) end = document.createComment("niral:end");
      entries = claimed;
      return;
    }
    firstRun = false;
    if (hActive()) hFail("keyed-for re-ran during hydration");

    const parent = end.parentNode;
    const prevByKey = new Map();
    for (const e of entries) if (!prevByKey.has(e.key)) prevByKey.set(e.key, e);
    const used = new Set();
    const next = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const key = keyFn(item, i);
      let e = used.has(key) ? null : prevByKey.get(key);
      if (e) {
        used.add(key);
        e.itemSig.set(item); // same key, fresh data — updates flow fine-grained
        e.idxSig.set(i);
      } else {
        const itemSig = signal(item);
        const idxSig = signal(i);
        const [nodes, dispose] = root(() => buildItem(itemSig, idxSig));
        e = {
          key,
          itemSig,
          idxSig,
          dispose,
          estart: document.createComment("niral:start"),
          eend: document.createComment("niral:end"),
          fresh: [nodes].flat(Infinity).filter((n) => n != null),
        };
      }
      next.push(e);
    }

    // entries whose keys vanished: tear down effects + DOM
    const keep = new Set(next);
    for (const e of entries) {
      if (!keep.has(e)) {
        e.dispose();
        if (e.estart.parentNode) drainBetween(e.estart);
        e.estart.remove();
        e.eend.remove();
      }
    }

    if (!parent) {
      // first run happens before mount — emit runs inline between the anchors
      pending = [];
      for (const e of next) {
        pending.push(e.estart, ...e.fresh, e.eend);
        e.fresh = null;
      }
    } else {
      // FLIP: measure marked rows BEFORE anything moves
      const flipped = [];
      if (typeof window !== "undefined") {
        for (const e of next) {
          if (e.fresh) continue;
          for (const n of runOf(e.estart, e.eend)) {
            if (n.nodeType === 1 && n.__niralFlip && n.getBoundingClientRect) {
              flipped.push({ n, rect: n.getBoundingClientRect() });
            }
          }
        }
      }
      // walk backwards, moving/inserting each entry's run before its successor
      let ref = end;
      for (let i = next.length - 1; i >= 0; i--) {
        const e = next[i];
        if (e.fresh) {
          parent.insertBefore(e.estart, ref);
          for (const n of e.fresh) parent.insertBefore(n, ref);
          parent.insertBefore(e.eend, ref);
          e.fresh = null;
        } else if (e.eend.nextSibling !== ref) {
          for (const n of runOf(e.estart, e.eend)) parent.insertBefore(n, ref);
        }
        ref = e.estart;
      }
      // FLIP: rows that moved glide from where they were to where they are
      for (const { n, rect } of flipped) {
        const now = n.getBoundingClientRect();
        const dx = rect.left - now.left;
        const dy = rect.top - now.top;
        if ((dx || dy) && n.animate) {
          n.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: 250, easing: "ease" }
          );
        }
      }
    }
    entries = next;
  });

  return [start, ...(pending ?? []), end];
}

/** Remove all siblings between a niral:start anchor and its matching end. */
function drainBetween(startAnchor) {
  let depth = 0;
  while (startAnchor.nextSibling) {
    const s = startAnchor.nextSibling;
    if (s.nodeType === 8 && s.data === "niral:start") depth++;
    if (s.nodeType === 8 && s.data === "niral:end") {
      if (depth === 0) break;
      depth--;
    }
    s.remove();
  }
}

/** The contiguous sibling run from an entry's start anchor to its end anchor. */
function runOf(estart, eend) {
  const run = [estart];
  let n = estart;
  while (n !== eend) {
    n = n.nextSibling;
    run.push(n);
  }
  return run;
}

/**
 * <Card .../> — instantiate a child component inline.
 * The child builds ONCE: its props arrive as a live signal (`__props.__sig`)
 * and each `let { x } = $props` binding is a derived view into it — prop
 * changes flow FINE-GRAINED into the child's DOM. Local $state, effects,
 * input state and context all SURVIVE prop updates (no rebuild).
 */
export function child(Comp, propsFn, slot) {
  const build = Comp.__build ?? Comp;
  const pSig = derived(propsFn);
  return region(() => {
    // untracked snapshot: the region must NOT re-run on prop changes —
    // the per-prop deriveds own the updates
    const props = { ...untrack(() => pSig.get()), __sig: pSig };
    if (slot) props.children = slot;
    return build(props);
  });
}

/**
 * {#await promise} pending {:then v} … {:catch e} … {/await}
 * SSR renders the pending branch (promises don't resolve during a sync
 * render); the client swaps to then/catch when the promise settles.
 * If the expression re-evaluates (a tracked signal changed), the whole
 * block restarts with the new promise.
 */
export function awaitBlock(exprFn, pendingB, thenB, catchB) {
  return region(() => {
    const p = exprFn();
    if (!p || typeof p.then !== "function") {
      return thenB ? thenB(p) : []; // plain value — straight to {:then}
    }
    // SSR: a sync render can't wait — emit the pending branch inside a nested
    // region so the anchors match the client's inner region during hydration
    if (typeof window === "undefined") {
      return region(() => (pendingB ? pendingB() : []));
    }
    const st = signal({ s: "pending" });
    Promise.resolve(p).then(
      (v) => st.set({ s: "then", v }),
      (e) => st.set({ s: "catch", e })
    );
    return region(() => {
      const cur = st.get();
      if (cur.s === "pending") return pendingB ? pendingB() : [];
      if (cur.s === "then") return thenB ? thenB(cur.v) : [];
      if (catchB) return catchB(cur.e);
      _reportError(cur.e, "{#await}");
      return [];
    });
  });
}

/* ── mount ── */

let restoreState = null;

/** @internal HMR — queue signal values to restore into the next mount. */
export function _setRestore(values) {
  restoreState = values;
}

export function mount(target, build) {
  const wantHydrate = hydrateTarget != null && hydrateTarget === target;
  if (wantHydrate) hydrateTarget = null;

  const attempt = (hydrate) => {
    if (hydrate) {
      hydrateFailed = false;
      H = { frames: [{ parent: target, next: target.firstChild ?? null, stop: null }] };
    }
    const signals = [];
    _setSink(signals);
    let nodes, dispose;
    try {
      [nodes, dispose] = root(build);
    } finally {
      _setSink(null);
      if (hydrate) H = null;
    }
    return { nodes, dispose, signals, failed: hydrate && hydrateFailed };
  };

  let r = attempt(wantHydrate);
  if (r.failed) {
    // mismatch somewhere — throw away the SSR DOM and render clean
    r.dispose();
    target.replaceChildren();
    r = attempt(false);
  }
  const { dispose, signals } = r;
  const flat = [r.nodes].flat(Infinity).filter((n) => n != null);
  append(target, flat);

  // HMR: carry signal state across a hot swap (same signal count = same shape)
  if (restoreState) {
    const values = restoreState;
    restoreState = null;
    if (values.length === signals.length) {
      for (let i = 0; i < values.length; i++) signals[i].set(values[i]);
    }
  }

  return {
    _signals: signals,
    destroy() {
      dispose();
      for (const n of flat) {
        // a top-level region's live content sits between its anchors — drain it
        if (n.nodeType === 8 && n.data === "niral:start") drainBetween(n);
        n.remove?.();
      }
    },
  };
}
