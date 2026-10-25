/**
 * Niral server — shared page assembly (dev server, build, prod server).
 */

export const DEFAULT_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!--niral:head-->
</head>
<body>
<!--niral:outlet-->
</body>
</html>`;

/** JSON safe to embed inside an inline <script>. */
export function jsonInScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const escHead = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function errorPage({ status = 500, path = "", error = null, dev = false } = {}) {
  const icons = "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/";
  const missing = status === 404;
  const title = missing ? "Page not found" : "Something went wrong";
  const message = missing
    ? "There is no page at this address."
    : dev && error ? String(error.message ?? error) : "The server couldn't complete your request. Please try again later.";
  const stack = dev && error?.stack ? String(error.stack).replace(
    /data:(?:text|application)\/javascript[^,\s]*,[^\s)]+/g,
    (module) => `[generated server module]${/:\d+:\d+$/.exec(module)?.[0] ?? ""}`
  ) : "";
  const location = missing || dev ? String(path) : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title} | Niral</title>
<style>
  * { box-sizing: border-box; } body { margin: 0; background: #171719; color: #fafaf8; font: 16px/1.65 "Avenir Next", "Trebuchet MS", sans-serif; letter-spacing: 0; }
  .shell { --accent: #f2b544; --line: #48484c; max-width: 1080px; margin: auto; padding: 0 32px 32px; }
  header { min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid #48484c; }
  .brand { font-size: 22px; font-weight: 600; } .brand span { color: var(--accent); }
  .icon { display: block; flex-shrink: 0; object-fit: contain; filter: invert(78%) sepia(80%) saturate(450%) hue-rotate(342deg); }
  .environment, .eyebrow, .location, .source-title, footer { font: 12px/1.7 "SFMono-Regular", Consolas, monospace; }
  .environment { display: flex; align-items: center; gap: 8px; } .environment::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  main { padding: 48px 0; } .eyebrow { display: flex; align-items: center; gap: 12px; color: var(--accent); margin: 0 0 24px; }
  h1 { font-size: 40px; font-weight: 500; line-height: 1.15; margin: 0 0 20px; }
  .message { max-width: 720px; margin: 0 0 24px; font-size: 18px; overflow-wrap: anywhere; white-space: pre-wrap; }
  .location { display: flex; align-items: flex-start; gap: 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 16px 0; margin: 32px 0; } .location span { min-width: 0; overflow-wrap: anywhere; }
  .source { border: 1px solid #48484c; border-radius: 6px; overflow: hidden; margin: 32px 0; }
  .source-title { display: flex; align-items: center; gap: 10px; padding: 14px 20px; margin: 0; border-bottom: 1px solid var(--line); color: var(--accent); background: #242427; }
  pre { background: #101012; font: 13px/1.85 "SFMono-Regular", Consolas, monospace; margin: 0; padding: 20px; overflow: auto; max-height: 48vh; }
  nav { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 32px; } a { color: #fafaf8; text-decoration: none; }
  nav a { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 10px 18px; border: 1px solid #656569; border-radius: 4px; background: #242427; font-size: 14px; }
  nav a:first-child { background: var(--accent); color: #171719; border-color: var(--accent); } nav a:first-child .icon { filter: none; } nav a:hover { border-color: var(--accent); } nav a:first-child:hover { background: #ffca65; }
  a:focus-visible, pre:focus-visible { outline: 2px solid #f2b544; outline-offset: 5px; }
  footer { border-top: 1px solid #48484c; padding-top: 24px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
  @media(max-width:600px) { .shell { padding: 0 20px 24px; } header { min-height: 76px; } main { padding: 40px 0; } h1 { font-size: 36px; } .message { font-size: 17px; } pre { padding: 16px; } }
</style></head><body><div class="shell">
<header><a class="brand" href="/" aria-label="Home">niral<span>.</span></a><span class="environment">${dev ? "DEVELOPMENT" : "REQUEST FAILED"}</span></header>
<main><p class="eyebrow"><img class="icon" src="${icons}${missing ? "file-question" : "triangle-alert"}.svg" alt="" width="22" height="22" referrerpolicy="no-referrer">${missing ? "404 / NOT FOUND" : "500 / SERVER ERROR"}</p><h1>${title}</h1><p class="message">${escHead(message)}</p>
${location ? `<p class="location"><img class="icon" src="${icons}file-code-2.svg" alt="" width="18" height="18" referrerpolicy="no-referrer"><span>${escHead(location)}</span></p>` : ""}
${stack ? `<section class="source" aria-label="Stack trace"><h2 class="source-title"><img class="icon" src="${icons}terminal.svg" alt="" width="18" height="18" referrerpolicy="no-referrer">STACK TRACE</h2><pre tabindex="0">${escHead(stack)}</pre></section>` : ""}
<nav aria-label="Recovery"><a href="/"><img class="icon" src="${icons}arrow-left.svg" alt="" width="18" height="18" referrerpolicy="no-referrer">Back to home</a>${dev ? `<a href="https://niral.site/docs/routing"><img class="icon" src="${icons}book-open.svg" alt="" width="18" height="18" referrerpolicy="no-referrer">Routing documentation</a>` : ""}</nav></main>
<footer><span>Niral JS</span><span>${dev ? "Development only" : "HTTP " + (missing ? "404" : "500")}</span></footer>
</div></body></html>`;
}

/** <head> blocks may interpolate PROPS: `<title>{title}</title>`.
 *  Values are HTML-escaped; unknown names are left as-is. */
export function renderHead(raw, props) {
  if (!raw || !props) return raw;
  return raw.replace(/\{([A-Za-z_$][\w$]*)\}/g, (m, name) =>
    name in props ? escHead(String(props[name] ?? "")) : m
  );
}

/** The client-side boot for a hydrated route — goes through the runtime router.
 *  The page + layouts are STATIC imports: the browser resolves the whole
 *  module graph from the inline script (one parallel fetch alongside the
 *  modulepreloads), instead of paying a runtime `import()` round trip. */
export function hydrationScript(importPath, props, { runtimeBase = "/@niral/runtime", layoutPaths = [], nonce = null, i18n = null } = {}) {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const layoutImports = layoutPaths.map((p, i) => `import __l${i} from ${jsonInScript(p)};`).join("\n");
  const layoutRefs = layoutPaths.map((_, i) => `__l${i}`).join(", ");
  const i18nField = i18n ? `, i18n: ${jsonInScript(i18n)}` : "";
  return `\n<script type="module"${nonceAttr}>
import { boot } from ${jsonInScript(runtimeBase + "/router.js")};
import __page from ${jsonInScript(importPath)};${layoutImports ? "\n" + layoutImports : ""}
boot({ component: __page, layouts: [${layoutRefs}], props: ${jsonInScript(props)}${i18nField} });
</script>`;
}

const RUNTIME_FILES = ["router.js", "index.js", "signals.js", "dom.js", "rpc.js", "live.js", "i18n.js"];

/** <link rel="modulepreload"> for the WHOLE module graph — the browser
 *  fetches every module in parallel at HTML-parse time instead of walking
 *  the import waterfall one level per round-trip. Production runtimes are
 *  bundled into index.js (+ a router.js shim), so pass `runtimeFiles` to
 *  preload just those two — raw dev serving preloads all six. */
export function preloadLinks({ runtimeBase = "/@niral/runtime", component, layouts = [], runtimeFiles = RUNTIME_FILES } = {}) {
  const urls = [...runtimeFiles.map((f) => `${runtimeBase}/${f}`), ...layouts, component].filter(Boolean);
  return urls.map((u) => `<link rel="modulepreload" href="${u.replace(/"/g, "")}">`).join("\n");
}

/** Assemble a full page from a shell + rendered route. */
export function assemblePage({ shell, style, head, html, hydrate }) {
  const headHtml =
    (head ? head + "\n" : "") +
    (style ? `<style data-niral-style>\n${style.trim()}\n</style>` : "");
  return shell
    .replace("<!--niral:head-->", headHtml)
    .replace("<!--niral:outlet-->", `<div id="niral-root">${html}</div>${hydrate ?? ""}`);
}

/**
 * Streaming SSR (`<script stream>`): split the page at the outlet so the
 * shell + <head> (styles, fonts, meta) FLUSH before load() runs — the
 * browser starts fetching CSS/JS while the server is still loading data.
 *   top:  everything up to and including `<div id="niral-root">`
 *   tail: everything after the outlet
 * The caller writes: top → (await data, render) → html + "</div>" + hydrate + tail.
 */
export function assemblePageParts({ shell, style, head }) {
  const headHtml =
    (head ? head + "\n" : "") +
    (style ? `<style data-niral-style>\n${style.trim()}\n</style>` : "");
  const full = shell.replace("<!--niral:head-->", headHtml);
  const marker = "<!--niral:outlet-->";
  const at = full.indexOf(marker);
  return {
    top: full.slice(0, at) + `<div id="niral-root">`,
    tail: full.slice(at + marker.length),
  };
}
