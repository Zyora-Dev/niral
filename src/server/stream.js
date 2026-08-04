/**
 * Niral server — out-of-order streaming SSR for {#await} blocks.
 *
 * On a `<script stream>` page the server flushes the shell + head immediately,
 * renders the component to HTML with every unresolved {#await} left as a
 * PENDING placeholder, then streams each {:then}/{:catch} branch in its own
 * chunk the instant its promise settles — fastest-first, out of order. A tiny
 * inline script (`__nb`) swaps each resolved chunk into place; no framework
 * JavaScript is required for the content to appear.
 *
 * Boundaries are collected per request through AsyncLocalStorage, so many
 * streamed responses can be in flight at once without sharing boundary ids.
 * The compiled string renderer reaches this module through the global that
 * `sAwait` reads (`globalThis.__niralStream`) — never through an import, so
 * nothing here is ever bundled into the client.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { sBoundaryChunk } from "../runtime/ssr.js";

const als = new AsyncLocalStorage();

// installed for the compiled SSR renderer (runtime/ssr.js sAwait). A live
// store means "we are inside a streamed render" — sAwait registers boundaries.
globalThis.__niralStream = { active: () => als.getStore() ?? null };

/** The one-time inline runtime that reveals streamed boundaries. Classic
 *  (non-module) script so it executes synchronously as the browser parses
 *  each chunk — resolved content appears without waiting for hydration. */
export function boundaryRuntime(nonce = null) {
  const n = nonce ? ` nonce="${nonce}"` : "";
  // Walk the comment nodes to find the <!--nb:id--> … <!--/nb:id--> pair,
  // replace everything between them with the <template> content, drop the
  // template, and record the id so hydration can tell it was server-resolved.
  return (
    `<script${n}>window.__nb=function(i){` +
    `var t=document.querySelector('template[data-nb="'+i+'"]');if(!t)return;` +
    `var w=document.createTreeWalker(document.body,128),s=null,e=null,x;` +
    `while(x=w.nextNode()){if(x.data==='nb:'+i){s=x}else if(x.data==='/nb:'+i){e=x;break}}` +
    `if(!s||!e){t.remove();return}` +
    `var p=s.parentNode,r=s.nextSibling;` +
    `while(r&&r!==e){var nx=r.nextSibling;p.removeChild(r);r=nx}` +
    `p.insertBefore(t.content,e);t.remove();` +
    `(window.__NIRAL_B__=window.__NIRAL_B__||{})[i]=1};</script>`
  );
}

/** Render a boundary's settled branch to HTML. Runs INSIDE the streaming
 *  store, so nested {#await} blocks inside a {:then} register new boundaries. */
function renderBranch(b, settled) {
  try {
    if (settled.ok) return b.thenFn ? b.thenFn(settled.value) : "";
    if (b.catchFn) return b.catchFn(settled.error);
    // no {:catch} — surface it in dev logs, emit an empty (claimable) region
    console.error("[niral] unhandled {#await} rejection:", settled.error);
    return "";
  } catch (err) {
    console.error("[niral] {#await} branch render failed:", err);
    return "";
  }
}

/**
 * Drain a streaming store's boundaries out of order, writing a chunk per
 * settled promise. `write(str)` pushes bytes to the client; `nonce` (prod
 * CSP) is applied to every emitted <script>. Resolves when the last boundary
 * — including any discovered while rendering earlier branches — has flushed.
 */
export async function drainBoundaries(store, write, nonce = null) {
  const inflight = new Map(); // id → Promise<{ b, ok, value|error }>
  const arm = (b) =>
    inflight.set(
      b.id,
      Promise.resolve(b.value).then(
        (value) => ({ b, ok: true, value }),
        (error) => ({ b, ok: false, error })
      )
    );
  // take everything queued so far (initial shell render + nested branches)
  const take = () => {
    const batch = store.boundaries;
    store.boundaries = [];
    for (const b of batch) arm(b);
  };

  take();
  while (inflight.size) {
    const settled = await Promise.race(inflight.values());
    inflight.delete(settled.b.id);
    const html = renderBranch(settled.b, settled); // may enqueue nested boundaries
    take();
    write(sBoundaryChunk(settled.b.id, html, nonce));
  }
}

/**
 * Stream a page body from a component render function.
 *
 * `renderShell()` must synchronously return the component HTML (the compiled
 * `__ssr`), which leaves PENDING placeholders for unresolved awaits and fills
 * the store's boundary queue. We write that shell, then drain boundaries.
 *
 *   write(shellHtml + "</div>")
 *   write(boundaryRuntime)           ← only when there are boundaries
 *   write(chunk) per settled await   ← out of order
 *
 * The caller writes the head/top before this and the hydration + tail after.
 * Returns the number of boundaries streamed.
 */
export async function streamBody(renderShell, write, { nonce = null } = {}) {
  const store = { boundaries: [], seq: 0 };
  return als.run(store, async () => {
    const html = renderShell();
    write(html + "</div>");
    if (store.boundaries.length) {
      write(boundaryRuntime(nonce));
      await drainBoundaries(store, write, nonce);
    }
    return store.seq;
  });
}
