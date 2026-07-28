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
