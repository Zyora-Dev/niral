/**
 * Niral dev — browser HMR client (served at /@niral/client.js).
 *
 * Connects to the dev server over WebSocket. On changes:
 *   update  → re-import the changed component module and hot-swap every
 *             live instance, carrying signal state across the swap.
 *   reload  → full page reload (html/css/plain js).
 *   error   → full-screen error overlay with the compiler's code frame.
 *   clear   → hide the overlay.
 */

const RUNTIME = "/@niral/runtime/index.js";

const hmr = {
  /** modulePath → [{ inst, target, props }] */
  instances: new Map(),
  applying: false,

  track(path, record) {
    if (this.applying) return;
    let list = this.instances.get(path);
    if (!list) this.instances.set(path, (list = []));
    list.push(record);
  },

  async apply(path) {
    const records = this.instances.get(path);
    let mod;
    try {
      mod = await import(path + "?t=" + Date.now());
    } catch (e) {
      showOverlay({ code: "NIRAL000", message: String(e.message ?? e), filename: path });
      return;
    }
    clearOverlay();
    if (!records || !records.length) {
      location.reload();
      return;
    }
    const runtime = await import(RUNTIME);
    this.applying = true;
    try {
      for (const r of records) {
        const state = r.inst?._signals?.map((s) => s.get());
        r.inst?.destroy?.();
        if (state && runtime._setRestore) runtime._setRestore(state);
        r.inst = mod.default(r.target, r.props);
      }
    } finally {
      this.applying = false;
    }
    console.log(`[niral] hot-swapped ${path}`);
  },

  error(payload) {
    showOverlay(payload);
  },
};

window.__NIRAL_HMR__ = hmr;

if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  import("/@niral/devtools.js").then(module => module.mountDevtools()).catch(() => {});
}

/* ── error overlay ── */

let overlay = null;
let overlayFocus = null;

function showOverlay(err) {
  clearOverlay();
  overlayFocus = document.activeElement;
  overlay = document.createElement("div");
  overlay.id = "niral-error-overlay";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", err.code === "RUNTIME" ? "Niral runtime error" : "Niral compile error");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#171719;overflow:auto;color-scheme:dark;";
  const root = overlay.attachShadow({ mode: "open" });
  const esc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const loc = err.line != null ? `:${err.line}${err.col != null ? `:${err.col}` : ""}` : "";
  const runtime = err.code === "RUNTIME";
  const icons = "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/";
  const title = runtime ? "Runtime error" : "Unable to compile";
  const details = [err.code, err.message, `${err.filename ?? ""}${loc}`, err.frame, err.hint].filter(Boolean).join("\n\n");
  root.innerHTML = `
    <style>
      :host { all: initial; } * { box-sizing: border-box; }
      .workspace { --accent: #f2b544; --line: #48484c; max-width: 1080px; padding: 0 32px 32px; margin: auto; color: #fafaf8; font: 15px/1.6 "Avenir Next", "Trebuchet MS", sans-serif; letter-spacing: 0; }
      header { min-height: 88px; display: flex; gap: 24px; align-items: center; border-bottom: 1px solid #48484c; }
      .brand { font-size: 22px; font-weight: 600; } .brand span { color: #f2b544; }
      .icon { display: block; flex-shrink: 0; object-fit: contain; filter: invert(78%) sepia(80%) saturate(450%) hue-rotate(342deg); }
      .environment, .code, .label, .location, pre, footer { font: 12px/1.7 "SFMono-Regular", Consolas, monospace; }
      .environment { border-left: 1px solid #48484c; padding-left: 24px; }
      .actions { display: flex; gap: 10px; margin-left: auto; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-size: 13px; min-height: 44px; border: 1px solid #656569; border-radius: 4px; padding: 8px 16px; background: #242427; color: #fafaf8; cursor: pointer; }
      button:hover { border-color: #f2b544; } button:focus-visible, pre:focus-visible { outline: 2px solid #f2b544; outline-offset: 4px; }
      .copy { background: var(--accent); color: #171719; border-color: var(--accent); } .copy .icon { filter: none; } .copy:hover { background: #ffca65; }
      .close { width: 44px; padding: 0; } .summary { padding: 44px 0 30px; }
      .code { display: inline-flex; align-items: center; gap: 12px; color: var(--accent); margin-bottom: 16px; }
      h1 { margin: 0 0 12px; font-size: 32px; line-height: 1.25; font-weight: 500; }
      .message { font-size: 19px; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
      .source { border: 1px solid #48484c; border-radius: 6px; overflow: hidden; }
      .source-head { background: #242427; border-bottom: 1px solid #48484c; padding: 16px 20px; display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; }
      .label { display: inline-flex; align-items: center; gap: 10px; color: var(--accent); } .location { min-width: 0; overflow-wrap: anywhere; }
      pre { margin: 0; padding: 24px; background: #101012; color: #fafaf8; font-size: 14px; line-height: 1.85; overflow: auto; tab-size: 2; max-height: 50vh; }
      .hint { border-left: 2px solid #f2b544; padding: 4px 0 4px 20px; margin-top: 28px; }
      .hint p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 36px; border-top: 1px solid #48484c; padding-top: 20px; }
      .feedback { color: #f2b544; min-height: 21px; }
      @media(max-width:600px) { .workspace { padding: 0 20px 24px; } header { min-height: 76px; gap: 12px; } .environment { display: none; } .summary { padding-top: 32px; } h1 { font-size: 27px; } .message { font-size: 17px; } pre { padding: 16px; } .source-head { padding: 14px 16px; } button { padding: 8px 12px; } }
    </style>
    <div class="workspace">
      <header><div class="brand">niral<span>.</span></div><span class="environment">DEVELOPMENT</span><div class="actions"><button type="button" class="copy"><img class="icon" src="${icons}copy.svg" alt="" width="18" height="18" referrerpolicy="no-referrer">Copy details</button><button type="button" class="close" aria-label="Dismiss error" title="Dismiss error (Escape)"><img class="icon" src="${icons}x.svg" alt="" width="20" height="20" referrerpolicy="no-referrer"></button></div></header>
      <section class="summary"><span class="code"><img class="icon" src="${icons}triangle-alert.svg" alt="" width="22" height="22" referrerpolicy="no-referrer">${esc(err.code || "ERROR")} / ${runtime ? "RUNTIME" : "COMPILER"}</span><h1>${title}</h1><p class="message">${esc(err.message)}</p></section>
      <section class="source" aria-label="${runtime ? "Stack trace" : "Source location"}"><div class="source-head"><span class="label"><img class="icon" src="${icons}${runtime ? "terminal" : "file-code-2"}.svg" alt="" width="18" height="18" referrerpolicy="no-referrer">${runtime ? "STACK TRACE" : "SOURCE"}</span><span class="location">${esc(err.filename || "Application")}${esc(loc)}</span></div>${err.frame ? `<pre tabindex="0">${esc(err.frame)}</pre>` : `<pre>No source excerpt available.</pre>`}</section>
      ${err.hint ? `<section class="hint"><span class="label"><img class="icon" src="${icons}lightbulb.svg" alt="" width="18" height="18" referrerpolicy="no-referrer">SUGGESTED FIX</span><p>${esc(err.hint)}</p></section>` : ""}
      <footer><span>Development only · Escape to dismiss</span><span class="feedback" role="status"></span></footer>
    </div>`;
  root.querySelector(".close").addEventListener("click", clearOverlay);
  root.querySelector(".copy").addEventListener("click", async () => {
    const feedback = root.querySelector(".feedback");
    try {
      await navigator.clipboard.writeText(details);
      feedback.textContent = "Details copied";
    } catch {
      feedback.textContent = "Clipboard unavailable. Select and copy the details.";
    }
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...root.querySelectorAll("button, [tabindex='0']")];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && root.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && root.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  document.body.appendChild(overlay);
  root.querySelector(".close").focus();
}

function clearOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    if (overlayFocus?.isConnected) overlayFocus.focus();
    overlayFocus = null;
  }
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearOverlay();
});

// runtime errors reported by the Niral runtime (effects, event handlers)
addEventListener("niral:error", (e) => {
  const d = e.detail ?? {};
  showOverlay({
    code: "RUNTIME",
    message: d.message ?? "runtime error",
    filename: d.where ?? "",
    frame: d.stack ?? null,
    hint: "Thrown at runtime — check the browser console for the full stack.",
  });
});

/* ── websocket connection ── */

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/@niral/hmr`);
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "update") hmr.apply(msg.path);
    else if (msg.type === "reload") location.reload();
    else if (msg.type === "error") hmr.error(msg.payload);
    else if (msg.type === "clear") clearOverlay();
  };
  ws.onclose = () => setTimeout(connect, 1000); // dev server restarting — retry
  ws.onopen = () => console.log("[niral] hmr connected");
}

connect();
