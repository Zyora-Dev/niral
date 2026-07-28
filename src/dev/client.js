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

/* ── error overlay ── */

let overlay = null;

function showOverlay(err) {
  clearOverlay();
  overlay = document.createElement("div");
  overlay.id = "niral-error-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(8,10,12,.96);" +
    "color:#e8eaed;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;" +
    "padding:48px;overflow:auto;box-sizing:border-box;";
  const esc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const loc = err.line != null ? `:${err.line}:${err.col}` : "";
  overlay.innerHTML =
    `<div style="max-width:860px;margin:0 auto">` +
    `<div style="color:#f87171;font-weight:700;font-size:15px;margin-bottom:4px">${esc(err.code)} — compile error</div>` +
    `<div style="font-size:14px;margin-bottom:16px">${esc(err.message)}</div>` +
    `<div style="color:#94a3b8;margin-bottom:16px">${esc(err.filename)}${esc(loc)}</div>` +
    (err.frame
      ? `<pre style="background:#0f1419;border:1px solid #1e293b;border-radius:8px;padding:16px;overflow:auto;margin:0 0 16px">${esc(err.frame)}</pre>`
      : "") +
    (err.hint
      ? `<div style="color:#34d399">hint: ${esc(err.hint)}</div>`
      : "") +
    `<div style="color:#64748b;margin-top:24px">Fix the file and save — this overlay clears itself. (Esc to dismiss)</div>` +
    `</div>`;
  overlay.addEventListener("click", clearOverlay);
  document.body.appendChild(overlay);
}

function clearOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
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
