const endpoint = "/@niral/devtools";
const icons = "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/";
const icon = name => `<img src="${icons}${name}.svg" width="18" height="18" alt="" referrerpolicy="no-referrer">`;

async function snapshot() {
  const response = await fetch(endpoint, { headers: { "x-niral-devtools": "1" }, mode: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Inspector unavailable");
  return (await response.json()).traces;
}

export async function mountDevtools() {
  if (document.getElementById("niral-devtools")) return;
  let traces;
  try { traces = await snapshot(); } catch { return; }
  const host = document.createElement("div");
  host.id = "niral-devtools";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; } * { box-sizing: border-box; } [hidden] { display: none !important; }
      button, input, select { font: inherit; color: inherit; } button { cursor: pointer; }
      button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #f2b544; outline-offset: 2px; }
      img { display: block; flex-shrink: 0; filter: invert(78%) sepia(80%) saturate(450%) hue-rotate(342deg); }
      .launcher, .panel { position: fixed; z-index: 2147483645; color: #fafaf8; font: 13px/1.5 "Avenir Next", "Trebuchet MS", sans-serif; letter-spacing: 0; color-scheme: dark; }
      .launcher { bottom: 16px; right: 16px; height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: #171719; border: 1px solid #656569; border-radius: 6px; box-shadow: 0 3px 14px #0004; }
      .brand { font-size: 18px; font-weight: 600; white-space: nowrap; } .brand span { color: #f2b544; }
      .panel { right: 16px; bottom: 70px; width: min(1040px, calc(100vw - 32px)); height: min(540px, calc(100dvh - 94px)); display: flex; flex-direction: column; background: #171719; border: 1px solid #656569; border-radius: 6px; box-shadow: 0 10px 40px #0006; overflow: hidden; }
      header { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-bottom: 1px solid #48484c; flex-shrink: 0; }
      h2 { font-size: 14px; font-weight: 500; margin: 0; } .connection { margin-left: auto; color: #f2b544; font-size: 12px; }
      .tool { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid #656569; border-radius: 4px; padding: 0; flex-shrink: 0; }
      .tool:hover, .launcher:hover { border-color: #f2b544; } .tool:disabled { cursor: default; opacity: .55; }
      .toolbar { display: flex; gap: 8px; padding: 12px 16px; background: #242427; border-bottom: 1px solid #48484c; flex-shrink: 0; }
      input, select { min-width: 0; height: 36px; padding: 0 10px; background: #101012; border: 1px solid #656569; border-radius: 4px; } input { flex: 1; width: 100%; } input::placeholder { color: #c4c4c7; }
      select { width: 110px; } .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); }
      .requests { min-width: 0; overflow: auto; border-right: 1px solid #48484c; }
      .row { width: 100%; min-height: 64px; display: grid; grid-template-columns: minmax(0, 1fr) 46px 70px; gap: 10px; align-items: center; text-align: left; padding: 12px 16px; color: #fafaf8; background: transparent; border: 0; border-bottom: 1px solid #38383c; border-radius: 0; }
      .row:hover { background: #242427; } .row[aria-pressed="true"] { background: #302b20; box-shadow: inset 3px 0 #f2b544; }
      .name { min-width: 0; } .name strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
      .name small { display: block; font-size: 11px; color: #e1e1e3; margin-top: 3px; } .duration, .status { font: 12px/1.5 "SFMono-Regular", Consolas, monospace; text-align: right; }
      .status { color: #89deb6; } .failed .status { color: #ffb19f; } .detail { overflow: auto; min-width: 0; padding: 16px 20px; background: #101012; }
      h3 { margin: 0 0 16px; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; } dl { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 12px; margin: 0 0 24px; }
      dt { color: #e1e1e3; } dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; } .mono { font: 12px/1.6 "SFMono-Regular", Consolas, monospace; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid #38383c; overflow-wrap: anywhere; font-weight: 400; } th { color: #f2b544; } th:last-child, td:last-child { width: 88px; text-align: right; }
      .empty { padding: 24px 16px; color: #e1e1e3; margin: 0; } footer { padding: 8px 16px; border-top: 1px solid #48484c; font-size: 12px; background: #242427; }
      @media(max-width:650px) { .panel { right: 8px; width: calc(100vw - 16px); } header { gap: 10px; padding: 10px 12px; } header .brand { display: none; } .toolbar { padding: 10px; flex-wrap: wrap; } input { flex-basis: calc(100% - 122px); } .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(100px, 1fr) minmax(100px, 1fr); } .requests { border-right: 0; border-bottom: 1px solid #48484c; } .row { padding: 10px 12px; } .detail { padding: 14px 12px; } }
    </style>
    <button class="launcher" type="button" aria-label="Open Niral Devtools" title="Open Niral Devtools" aria-expanded="false" aria-controls="panel">${icon("activity")}<span class="brand">niral<span>.</span></span></button>
    <section class="panel" id="panel" role="region" aria-label="Niral Devtools" hidden>
      <header><span class="brand">niral<span>.</span></span><h2>Devtools</h2><span class="connection" role="status">Connected</span><button type="button" class="tool close" aria-label="Close Devtools" title="Close Devtools">${icon("x")}</button></header>
      <div class="toolbar"><input type="search" aria-label="Filter traces" placeholder="Filter traces"><select aria-label="Trace type"><option value="all">All requests</option><option value="route">Routes</option><option value="rpc">RPC</option><option value="failed">Failures</option></select><button type="button" class="tool pause" aria-label="Pause updates" title="Pause updates" aria-pressed="false">${icon("pause")}</button><button type="button" class="tool refresh" aria-label="Refresh traces" title="Refresh traces">${icon("rotate-cw")}</button><button type="button" class="tool clear" aria-label="Clear visible traces" title="Clear visible traces">${icon("trash-2")}</button></div>
      <div class="body"><div class="requests" aria-label="Requests"></div><section class="detail" aria-label="Request details"></section></div>
      <footer class="count">0 requests</footer>
    </section>`;
  document.body.appendChild(host);
  const panel = root.querySelector(".panel");
  const launcher = root.querySelector(".launcher");
  const connection = root.querySelector(".connection");
  const requests = root.querySelector(".requests");
  const detail = root.querySelector(".detail");
  const search = root.querySelector("input");
  const type = root.querySelector("select");
  const pause = root.querySelector(".pause");
  let opened = false;
  let paused = false;
  let pending = false;
  let timer;
  let selected = null;
  let clearedThrough = 0;
  let signature = "";
  const failed = trace => trace.failure || trace.status >= 400;
  const text = (tag, value, className = "") => {
    const element = document.createElement(tag);
    element.textContent = value;
    element.className = className;
    return element;
  };

  function render() {
    const query = search.value.toLowerCase();
    const visible = traces.filter(trace => trace.id > clearedThrough && (type.value === "all" || (type.value === "failed" ? failed(trace) : trace.kind === type.value)) && `${trace.route} ${trace.module || ""} ${trace.fn || ""}`.toLowerCase().includes(query)).slice().reverse();
    if (!visible.some(trace => trace.id === selected)) selected = visible[0]?.id ?? null;
    const nextSignature = JSON.stringify([visible, selected]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const focused = root.activeElement?.dataset?.trace;
    requests.replaceChildren();
    for (const trace of visible) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "row" + (failed(trace) ? " failed" : "");
      row.dataset.trace = trace.id;
      row.setAttribute("aria-pressed", String(trace.id === selected));
      const name = text("span", "", "name");
      const label = trace.kind === "rpc" ? `${trace.fn || "RPC"}()` : trace.route;
      name.append(text("strong", label), text("small", `${trace.method} / ${trace.kind.toUpperCase()} / ${new Date(trace.time).toLocaleTimeString()}`));
      row.title = label;
      row.append(name, text("span", trace.failure ? "ERR" : trace.status, "status"), text("span", `${trace.duration.toFixed(1)} ms`, "duration"));
      row.addEventListener("click", () => { selected = trace.id; render(); });
      requests.append(row);
    }
    if (!visible.length) requests.append(text("p", traces.some(trace => trace.id > clearedThrough) ? "No matching requests." : "No requests yet.", "empty"));
    root.querySelector(".count").textContent = `${visible.length} request${visible.length === 1 ? "" : "s"}`;
    root.querySelector(".clear").disabled = !traces.some(trace => trace.id > clearedThrough);
    detail.replaceChildren();
    const trace = visible.find(entry => entry.id === selected);
    if (trace) {
      detail.append(text("h3", trace.module || trace.route));
      const fields = document.createElement("dl");
      for (const [label, value] of [["Request", `#${trace.id}`], ["Route", trace.route], ["Status", trace.status], ["Total", `${trace.duration.toFixed(2)} ms`], ["Function", trace.fn], ["Dispatch", trace.rpcDuration == null ? null : `${trace.rpcDuration.toFixed(2)} ms`], ["Failure", trace.failure], ["Layouts", trace.layouts.join("\n")]]) {
        if (value == null || value === "") continue;
        fields.append(text("dt", label), text("dd", value, "mono"));
      }
      detail.append(fields);
      if (trace.loads.length) {
        const table = document.createElement("table");
        table.setAttribute("aria-label", "Loader timings");
        const heading = document.createElement("tr");
        heading.append(text("th", "Loader"), text("th", "Time"));
        const head = document.createElement("thead");
        head.append(heading);
        const body = document.createElement("tbody");
        for (const load of trace.loads) {
          const row = document.createElement("tr");
          row.append(text("td", load.module, "mono"), text("td", `${load.duration.toFixed(2)} ms${load.failed ? " / ERR" : ""}`, "mono"));
          body.append(row);
        }
        table.append(head, body);
        detail.append(table);
      }
    } else detail.append(text("p", "No request selected.", "empty"));
    if (focused) requests.querySelector(`[data-trace="${focused}"]`)?.focus({ preventScroll: true });
  }

  async function refresh() {
    clearTimeout(timer);
    if (pending || !opened || document.hidden) return;
    pending = true;
    try {
      traces = await snapshot();
      if (traces.length && Math.max(...traces.map(trace => trace.id)) < clearedThrough) clearedThrough = 0;
      connection.textContent = paused ? "Paused" : "Connected";
      render();
    } catch { connection.textContent = "Disconnected"; }
    finally {
      pending = false;
      if (opened && !paused && !document.hidden) timer = setTimeout(refresh, 1500);
    }
  }

  function toggle(show) {
    opened = show;
    panel.hidden = !show;
    launcher.setAttribute("aria-expanded", String(show));
    clearTimeout(timer);
    if (show) { render(); search.focus(); refresh(); }
    else launcher.focus();
  }
  launcher.addEventListener("click", () => toggle(!opened));
  root.querySelector(".close").addEventListener("click", () => toggle(false));
  root.querySelector(".refresh").addEventListener("click", refresh);
  root.querySelector(".clear").addEventListener("click", () => { clearedThrough = Math.max(clearedThrough, ...traces.map(trace => trace.id)); render(); search.focus(); });
  pause.addEventListener("click", () => {
    paused = !paused;
    pause.setAttribute("aria-pressed", String(paused));
    pause.setAttribute("aria-label", paused ? "Resume updates" : "Pause updates");
    pause.title = paused ? "Resume updates" : "Pause updates";
    pause.innerHTML = icon(paused ? "play" : "pause");
    connection.textContent = paused ? "Paused" : "Connected";
    clearTimeout(timer);
    if (!paused) refresh();
  });
  search.addEventListener("input", render);
  type.addEventListener("change", render);
  host.addEventListener("keydown", event => {
    if (event.key === "Escape" && opened) { event.stopPropagation(); toggle(false); }
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden && opened && !paused) refresh();
  });
}