/**
 * Niral dev — development server (node:http only).
 *
 *   • serves the project directory
 *   • compiles .niral modules on demand (with an HMR wrapper)
 *   • serves the runtime at /@niral/runtime/* and the HMR client at /@niral/client.js
 *   • injects the HMR client into every HTML page
 *   • watches the tree: .niral edits hot-swap live components (compile errors
 *     become an in-browser overlay), everything else reloads the page
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { extname, join, resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileClient } from "../compiler/codegen.js";
import { NiralError, codeFrame } from "../compiler/errors.js";
import { attachWebSocket } from "./websocket.js";
import { scanRoutes, matchRoute, layoutChain } from "../server/router.js";
import { renderPage, renderFile, loadComponent, collectCss, preparePage, renderComponent } from "../server/render.js";
import { hydrationScript, assemblePageParts, renderHead, preloadLinks } from "../server/page.js";
import { streamBody } from "../server/stream.js";
import { parseFormBody, actionName, actionRedirect } from "../server/forms.js";
import { multipartBoundary, parseMultipart, encodeFilesForWorker, DEFAULT_MAX_UPLOAD } from "../server/uploads.js";
import { createJobRunner } from "../server/jobs.js";
import { attachLive } from "../server/live.js";
import { loadHooks, applyHooks, checkRequiredEnv } from "../server/hooks.js";
import { loadCatalogs, negotiate } from "../server/i18n.js";
import { migrateAtBoot } from "../server/migrate.js";
import { executeRpc, runServerLoad, AuthRequiredError, streamRpc } from "../server/rpc.js";
import { serverInfo } from "../server/polyglot.js";
import { newSecret, readSession, sessionCookie } from "../server/session.js";
import { createWorkerPool } from "../server/workers.js";
import { createLimiter } from "../server/ratelimit.js";
import { loadRecipe, spawnTailwindWatch } from "../add/tailwind.js";
import { componentCss } from "../compiler/style.js";

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_PATH = "/@niral/runtime/index.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** NiralError → overlay payload. */
export function errorPayload(e) {
  return {
    code: e.code,
    message: e.message,
    hint: e.hint,
    filename: e.filename,
    line: e.line ?? null,
    col: e.col ?? null,
    frame: e.source != null ? codeFrame(e.source, e.start, e.end) : null,
  };
}

/** Compile a .niral file for the dev server, wrapping the export for HMR. */
export function compileForDev(source, urlPath) {
  const { code } = compileClient(source, {
    filename: urlPath,
    runtime: RUNTIME_PATH,
  });
  // Wrap the default export so every live instance registers with the HMR client.
  const marker = "export default function Component(__target, __props = {}) {";
  if (!code.includes(marker)) return code; // future codegen shape — serve as-is
  return (
    code.replace(marker, "function Component(__target, __props = {}) {") +
    `
export default function __NiralHot(__target, __props = {}) {
  const inst = Component(__target, __props);
  if (typeof window !== "undefined" && window.__NIRAL_HMR__) {
    window.__NIRAL_HMR__.track(${JSON.stringify(urlPath)}, { inst, target: __target, props: __props });
  }
  return inst;
}
__NiralHot.__build = Component.__build;
__NiralHot.__ssr = Component.__ssr;
`
  );
}

/** A JS module that reports a compile error to the overlay instead of executing. */
function errorModule(payload) {
  return `// niral: compile error
const payload = ${JSON.stringify(payload)};
if (typeof window !== "undefined" && window.__NIRAL_HMR__) window.__NIRAL_HMR__.error(payload);
else console.error(payload.code + ": " + payload.message);
export default function Component() { return { destroy() {} }; }
`;
}

/** JSON safe to embed inside an inline <script>. */
function jsonInScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createDevServer({ root = ".", port = 5199, watch: watchFiles = true, secret } = {}) {
  const dir = resolve(root);
  globalThis.__niralProjectRoot = pathToFileURL(dir + "/").href; // projectImport() base
  const routesDir = join(dir, "routes");
  const sessionSecret = secret ?? process.env.NIRAL_SECRET ?? newSecret();
  const rpcLimiter = createLimiter({ limit: 300, windowMs: 60_000 });
  const pool = createWorkerPool({
    runners: {
      python: join(FRAMEWORK_DIR, "langs", "python", "runner.py"),
      ruby: join(FRAMEWORK_DIR, "langs", "ruby", "runner.rb"),
    },
    cwd: dir,
  });

  // recipes: tailwind --watch runs alongside the dev server
  let twProc = null;
  const twRecipe = loadRecipe(dir);
  if (twRecipe) {
    try {
      twProc = spawnTailwindWatch(dir, twRecipe);
      console.log(`niral · tailwind watching ${twRecipe.input} → ${twRecipe.output}`);
    } catch (e) {
      console.warn(`niral · tailwind disabled: ${e.message}`);
    }
  }

  const HMR_TAG = `<script type="module" src="/@niral/client.js"></script>`;
  const DEFAULT_SHELL = `<!DOCTYPE html>
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

  /** Streaming SSR (`<script stream>`): flush shell + head BEFORE load() runs.
   *  Returns true when the response was streamed. NOTE: headers go out with
   *  the first chunk — session writes inside load() can NOT set cookies on
   *  streamed pages (RPC calls still can). */
  async function ssrStream(res, pathname, cookieHeader, locals = null, accept = null) {
    const match = matchRoute(scanRoutes(routesDir), pathname);
    if (!match) return false;
    const { route, params } = match;
    let entry;
    try {
      entry = await loadComponent(route.file);
    } catch {
      return false; // compile errors take the normal (overlay) path
    }
    if (!entry.ast?.script?.attrs?.stream) return false;
    // guarded pages must be able to REDIRECT — headers flush early here, so
    // let the normal (bufferable) path handle them
    const layoutsPre = layoutChain(routesDir, route.rel);
    for (const f of [route.file, ...layoutsPre.map((l) => l.abs)]) {
      if (serverInfo(f)?.auth) return false;
    }

    const layouts = layoutChain(routesDir, route.rel);
    const layoutEntries = [];
    for (const l of layouts) layoutEntries.push(await loadComponent(l.abs));
    const styleParts = [];
    for (const l of layouts) {
      const css = await collectCss(l.abs);
      if (css) styleParts.push(css);
    }
    const pageCss = await collectCss(route.file);
    if (pageCss) styleParts.push(pageCss);
    const heads = [...layoutEntries, entry].map((x) => x.ast?.head?.raw).filter(Boolean).join("\n");

    const shellFile = join(routesDir, "_shell.html");
    const shell = existsSync(shellFile) ? readFileSync(shellFile, "utf8") : DEFAULT_SHELL;
    let { top, tail } = assemblePageParts({ shell, style: styleParts.join("\n") || null, head: renderHead(heads, params) || null });
    top = top.includes("</head>") ? top.replace("</head>", `${HMR_TAG}\n</head>`) : HMR_TAG + "\n" + top;

    res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
    res.write(top); // ← the browser gets head/styles NOW, while load() runs

    try {
      const store = readSession(cookieHeader, sessionSecret);
      let props = await loadAllProps(route, layouts, params, store, locals);
      const i18nBoot = i18nFor(cookieHeader, accept);
      if (i18nBoot) props = { locale: i18nBoot.locale, ...props };
      const { fn, ast } = await preparePage(route.file, layouts.map((l) => l.abs), i18nBoot);
      const hydrate =
        (ast.script?.attrs?.mode ?? "client") === "client"
          ? hydrationScript("/routes/" + route.rel, props, {
              runtimeBase: "/@niral/runtime",
              layoutPaths: layouts.map((l) => "/routes/" + l.rel),
              i18n: i18nBoot,
            })
          : "";
      // render the shell + stream each {#await} branch as its promise settles
      await streamBody(() => renderComponent(fn, props), (s) => res.write(s));
      res.end(hydrate + tail);
    } catch (e) {
      console.error(e);
      // already flushed — surface the failure via the dev overlay
      res.end(
        `<p style="color:#f66">stream failed: ${String(e?.message ?? e)}</p></div>` +
          `<script type="module">import "/@niral/client.js"; window.__NIRAL_HMR__.error(${jsonInScript({
            code: "STREAM",
            message: String(e?.message ?? e),
          })});</script>` +
          tail
      );
    }
    return true;
  }

  /** Run every load() on the way to a page — layouts outermost-first, the
   *  page LAST (page data wins on key conflicts). Mutates `store`. */
  async function loadAllProps(route, layouts, params, store, locals = null) {
    let merged = { ...params };
    if (store.data.user) merged.user = store.data.user; // identity on every page
    for (const l of layouts) {
      const d = await runServerLoad(l.abs, params, store, { pool, locals });
      if (d != null) merged = { ...merged, ...d };
    }
    const d = await runServerLoad(route.file, params, store, { pool, locals });
    if (d != null) merged = { ...merged, ...d };
    return merged;
  }

  const LOGIN_PATH = process.env.NIRAL_LOGIN_PATH ?? "/auth/login";

  /** i18n: negotiated locale + its catalog for one request (null without i18n/). */
  function i18nFor(cookieHeader, accept) {
    const data = loadCatalogs(dir);
    if (!data) return null;
    const locale = negotiate(cookieHeader, accept, data);
    return { locale, messages: data.catalogs[locale] };
  }

  function serverInfoFor(file) {
    try {
      return serverInfo(file);
    } catch {
      return null;
    }
  }

  // pending SQL migrations apply BEFORE anything reads the database
  migrateAtBoot(dir);

  // hooks.js `export const env = [...]` — dev warns, production refuses to boot
  checkRequiredEnv(dir).then(({ missing }) => {
    if (missing.length) {
      console.warn(`niral · WARNING — missing declared env: ${missing.join(", ")} (production will refuse to start without them)`);
    }
  });

  // background jobs + cron (jobs.js at the project root; NIRAL_JOBS=off to disable)
  let jobRunner = null;
  if (process.env.NIRAL_JOBS !== "off") {
    createJobRunner({ projectDir: dir })
      .then((r) => {
        jobRunner = r;
        if (r) console.log("niral · jobs.js loaded — queue + cron running");
      })
      .catch((e) => console.error("niral · jobs.js failed to start:", e.message));
  }

  /** SSR a routed page — returns { page, setCookie } or null if no route matches.
   *  `extraProps` (e.g. a form action's result) merge in AFTER load() data. */
  async function ssrPage(pathname, cookieHeader, extraProps = null, locals = null, accept = null) {
    const match = matchRoute(scanRoutes(routesDir), pathname);
    if (!match) return null;
    const { route, params } = match;

    let html, ast, layoutAsts;
    let props = params;
    let setCookie = null;
    const i18nBoot = i18nFor(cookieHeader, accept);
    const layouts = layoutChain(routesDir, route.rel);
    try {
      // <server> load({ params }) — layouts + page, merged into $props (any language)
      const store = readSession(cookieHeader, sessionSecret);
      props = await loadAllProps(route, layouts, params, store, locals);
      if (extraProps) props = { ...props, ...extraProps };
      if (i18nBoot) props = { locale: i18nBoot.locale, ...props };
      if (store.dirty) setCookie = sessionCookie(store, sessionSecret);
      ({ html, ast, layoutAsts } = await renderPage(route.file, props, layouts.map((l) => l.abs), i18nBoot));
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        // <server auth> — send the visitor to log in, remembering where they were
        return { redirect: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}` };
      }
      if (!(e instanceof NiralError)) {
        // runtime failure (load() threw, render crashed) → custom error page
        console.error(e);
        const errPage = await specialPage("_error.niral", { path: pathname, message: String(e?.message ?? e) });
        if (errPage) return { page: errPage, setCookie: null, status: 500 };
        throw e;
      }
      // compile error — serve a page that boots the HMR client and shows the overlay
      return {
        page: DEFAULT_SHELL.replace("<!--niral:head-->", "").replace(
          "<!--niral:outlet-->",
          `<script type="module">
import "/@niral/client.js";
window.__NIRAL_HMR__.error(${jsonInScript(errorPayload(e))});
</script>`
        ),
        setCookie: null,
      };
    }

    const mode = ast.script?.attrs?.mode ?? "client";
    const styleParts = [];
    for (const l of layouts) {
      const css = await collectCss(l.abs);
      if (css) styleParts.push(css);
    }
    const pageCss = await collectCss(route.file);
    if (pageCss) styleParts.push(pageCss);
    const styles = styleParts.join("\n");
    const heads = renderHead(
      [...layoutAsts, ast].map((a) => a.head?.raw).filter(Boolean).join("\n"),
      props
    );
    const preloads =
      mode === "client"
        ? preloadLinks({
            runtimeBase: "/@niral/runtime",
            component: "/routes/" + route.rel,
            layouts: layouts.map((l) => "/routes/" + l.rel),
          })
        : "";
    const head =
      (heads ? heads + "\n" : "") +
      (preloads ? preloads + "\n" : "") +
      (styles ? `<style data-niral-style>\n${styles}\n</style>` : "");
    const hydrate =
      mode === "client"
        ? hydrationScript("/routes/" + route.rel, props, {
            runtimeBase: "/@niral/runtime",
            layoutPaths: layouts.map((l) => "/routes/" + l.rel),
            i18n: i18nBoot,
          })
        : "";

    const shellFile = join(routesDir, "_shell.html");
    const shell = existsSync(shellFile) ? readFileSync(shellFile, "utf8") : DEFAULT_SHELL;
    let page = shell
      .replace("<!--niral:head-->", head)
      .replace("<!--niral:outlet-->", `<div id="niral-root">${html}</div>${hydrate}`);
    page = page.includes("</head>") ? page.replace("</head>", `${HMR_TAG}\n</head>`) : HMR_TAG + "\n" + page;
    return { page, setCookie };
  }

  /** Render routes/_404.niral or routes/_error.niral standalone (no hydration). */
  async function specialPage(name, props) {
    const file = join(routesDir, name);
    if (!existsSync(file)) return null;
    try {
      const { html, ast } = await renderFile(file, props);
      const css = await collectCss(file);
      const head =
        (ast.head?.raw ? ast.head.raw + "\n" : "") +
        (css ? `<style data-niral-style>\n${css}\n</style>` : "");
      const shellFile = join(routesDir, "_shell.html");
      const shell = existsSync(shellFile) ? readFileSync(shellFile, "utf8") : DEFAULT_SHELL;
      let page = shell
        .replace("<!--niral:head-->", head)
        .replace("<!--niral:outlet-->", `<div id="niral-root">${html}</div>`);
      page = page.includes("</head>") ? page.replace("</head>", `${HMR_TAG}\n</head>`) : HMR_TAG + "\n" + page;
      return page;
    } catch (e) {
      console.error(`niral · ${name} itself failed to render:`, e.message);
      return null;
    }
  }

  /** JSON payload for client-side navigation (x-niral-nav). */
  async function navPayload(pathname, cookieHeader, locals = null, accept = null) {
    const match = matchRoute(scanRoutes(routesDir), pathname);
    if (!match) return null;
    const { route, params } = match;
    const layouts = layoutChain(routesDir, route.rel);
    try {
      const store = readSession(cookieHeader, sessionSecret);
      let props = await loadAllProps(route, layouts, params, store, locals);
      const i18nBoot = i18nFor(cookieHeader, accept);
      if (i18nBoot) props = { locale: i18nBoot.locale, ...props };
      const setCookie = store.dirty ? sessionCookie(store, sessionSecret) : null;
      const page = await loadComponent(route.file);
      const styleParts = [];
      for (const l of layouts) {
        const css = await collectCss(l.abs);
        if (css) styleParts.push(css);
      }
      const pageCss = await collectCss(route.file);
      if (pageCss) styleParts.push(pageCss);
      const layoutHeads = [];
      for (const l of layouts) {
        const lc = await loadComponent(l.abs);
        if (lc.ast.head?.raw) layoutHeads.push(lc.ast.head.raw);
      }
      if (page.ast.head?.raw) layoutHeads.push(page.ast.head.raw);
      return {
        json: {
          ok: true,
          head: renderHead(layoutHeads.join("\n"), props) || null,
          mode: page.ast.script?.attrs?.mode ?? "client",
          component: "/routes/" + route.rel,
          layouts: layouts.map((l) => "/routes/" + l.rel),
          props,
          style: styleParts.join("\n"),
        },
        setCookie,
      };
    } catch {
      return { json: { ok: false }, setCookie: null };
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, "text/plain", `dev server error: ${e.message}`);
    });
  });

  async function handle(req, res) {
    const reqUrl = new URL(req.url, "http://x");
    const urlPath = decodeURIComponent(reqUrl.pathname);

    // hooks.js middleware — auth guards, redirects, locals (framework paths exempt)
    if (!urlPath.startsWith("/@niral/")) {
      const hooks = await loadHooks(dir);
      if (hooks?.handle) {
        const store = readSession(req.headers.cookie, sessionSecret);
        const r = await applyHooks(hooks, req, res, urlPath, store, sessionSecret);
        if (r.handled) return;
        req.__niralLocals = r.locals;
      }
    }

    // form actions: POST ?/name — works with AND without JS
    if (req.method === "POST" && actionName(reqUrl.search)) {
      const action = actionName(reqUrl.search);
      const match = matchRoute(scanRoutes(routesDir), urlPath);
      if (!match) return send(res, 404, "text/plain", "not found");
      if (!rpcLimiter.check(req.socket.remoteAddress ?? "?")) {
        return sendJson(res, 429, { ok: false, error: "too many requests — slow down" });
      }
      const ctype = req.headers["content-type"] ?? "";
      let form;
      const boundary = multipartBoundary(ctype);
      if (boundary) {
        // file uploads — hard total cap, parsed on plain buffers
        const maxUpload = Number(process.env.NIRAL_MAX_UPLOAD) || DEFAULT_MAX_UPLOAD;
        let raw;
        try {
          raw = await readBody(req, maxUpload, true);
          form = parseMultipart(raw, boundary);
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: `upload rejected: ${e.message}` });
        }
        const info = serverInfoFor(match.route.file);
        if (info?.lang && info.lang !== "js") form = encodeFilesForWorker(form);
      } else if (ctype.includes("application/x-www-form-urlencoded")) {
        form = parseFormBody(await readBody(req, 1024 * 1024));
      } else {
        return sendJson(res, 415, { ok: false, error: "form actions take urlencoded or multipart/form-data" });
      }
      const out = await executeRpc(match.route.file, action, [form], req.headers.cookie, sessionSecret, pool);
      if (out.status === 404 || out.status === 403) return sendJson(res, out.status, out.body);
      if (out.status === 401) {
        if (req.headers["x-niral-form"] === "1") return sendJson(res, 401, out.body);
        res.writeHead(303, { location: `${LOGIN_PATH}?next=${encodeURIComponent(urlPath)}` });
        return res.end();
      }
      const result = out.body.ok
        ? out.body.result
        : out.body.errors
          ? { error: out.body.error, errors: out.body.errors } // field-level validation errors
          : { error: out.body.error };
      const redirect = out.body.ok ? actionRedirect(out.body.result) : null;
      // session writes inside the action must be visible to the re-render
      const cookieForRender = out.setCookie ? out.setCookie.split(";")[0] : req.headers.cookie;

      if (req.headers["x-niral-form"] === "1") {
        // JS-enhanced submit — answer with a nav payload + the action result
        const headers = { "content-type": "application/json", "cache-control": "no-store" };
        if (out.setCookie) headers["set-cookie"] = out.setCookie;
        if (redirect) {
          res.writeHead(200, headers);
          return res.end(JSON.stringify({ ok: true, redirect }));
        }
        const nav = await navPayload(urlPath, cookieForRender, req.__niralLocals, req.headers["accept-language"]);
        const json = nav?.json?.ok ? { ...nav.json, props: { ...nav.json.props, form: result } } : { ok: false };
        res.writeHead(200, headers);
        return res.end(JSON.stringify(json));
      }

      // native (no-JS) submit
      if (redirect) {
        const headers = { location: redirect };
        if (out.setCookie) headers["set-cookie"] = out.setCookie;
        res.writeHead(303, headers);
        return res.end();
      }
      const page = await ssrPage(urlPath, cookieForRender, { form: result }, req.__niralLocals, req.headers["accept-language"]);
      const headers = { "content-type": MIME[".html"], "cache-control": "no-store" };
      const cookies = [out.setCookie, page?.setCookie].filter(Boolean);
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(page?.status ?? 200, headers);
      return res.end(page?.page ?? "not found");
    }

    // <server> function calls
    if (req.method === "POST" && urlPath === "/@niral/rpc") {
      if (req.headers["x-niral-rpc"] !== "1") {
        return sendJson(res, 403, { ok: false, error: "missing x-niral-rpc header" });
      }
      if (!rpcLimiter.check(req.socket.remoteAddress ?? "?")) {
        return sendJson(res, 429, { ok: false, error: "too many requests — slow down" });
      }
      let msg;
      try {
        msg = JSON.parse(await readBody(req, 1024 * 1024));
      } catch {
        return sendJson(res, 400, { ok: false, error: "bad request body" });
      }
      const { module: modPath, fn, args } = msg ?? {};
      if (typeof modPath !== "string" || !modPath.endsWith(".niral") || typeof fn !== "string") {
        return sendJson(res, 400, { ok: false, error: "bad rpc envelope" });
      }
      const abs = join(dir, modPath);
      if (!inside(dir, abs) || !existsSync(abs)) {
        return sendJson(res, 404, { ok: false, error: "unknown module" });
      }
      if (Array.isArray(args) && args.length > 32) {
        return sendJson(res, 400, { ok: false, error: "too many arguments" });
      }
      const out = await executeRpc(abs, fn, args, req.headers.cookie, sessionSecret, pool);
      if (out.stream) return streamRpc(res, out); // async generator → NDJSON chunks
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      if (out.setCookie) headers["set-cookie"] = out.setCookie;
      res.writeHead(out.status, headers);
      return res.end(JSON.stringify(out.body));
    }

    // framework-served virtual paths
    if (urlPath === "/@niral/client.js") {
      return send(res, 200, "text/javascript; charset=utf-8", readFileSync(join(FRAMEWORK_DIR, "dev", "client.js")));
    }
    if (urlPath.startsWith("/@niral/runtime/")) {
      const file = join(FRAMEWORK_DIR, "runtime", urlPath.slice("/@niral/runtime/".length));
      if (!inside(join(FRAMEWORK_DIR, "runtime"), file) || !existsSync(file)) return send(res, 404, "text/plain", "not found");
      return send(res, 200, "text/javascript; charset=utf-8", readFileSync(file));
    }

    let file = join(dir, urlPath);
    if (!inside(dir, file)) return send(res, 403, "text/plain", "forbidden");
    // private by convention: server-side storage, migrations, tests, deploy kit,
    // hooks.js/jobs.js and env files never serve — nor do dotfiles
    const segs = urlPath.split("/").filter(Boolean);
    const PRIVATE_DIRS = new Set(["data", "migrations", "tests", "deploy"]);
    if (
      PRIVATE_DIRS.has(segs[0]) ||
      segs.some((s) => s.startsWith(".")) ||
      /^(hooks|jobs)\.js$|\.env$/.test(segs[segs.length - 1] ?? "")
    ) {
      return send(res, 404, "text/plain", "not found");
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      // client-side navigation asks for JSON, not HTML
      if (req.headers["x-niral-nav"]) {
        const nav = await navPayload(urlPath, req.headers.cookie, req.__niralLocals, req.headers["accept-language"]);
        if (!nav) return sendJson(res, 404, { ok: false });
        const headers = { "content-type": "application/json", "cache-control": "no-store" };
        if (nav.setCookie) headers["set-cookie"] = nav.setCookie;
        res.writeHead(200, headers);
        return res.end(JSON.stringify(nav.json));
      }
      // no static file — try the file router (SSR)
      if (await ssrStream(res, urlPath, req.headers.cookie, req.__niralLocals, req.headers["accept-language"])) return; // <script stream> routes flush early
      const out = await ssrPage(urlPath, req.headers.cookie, null, req.__niralLocals, req.headers["accept-language"]);
      if (out?.redirect) {
        res.writeHead(303, { location: out.redirect });
        return res.end();
      }
      if (out != null) {
        const headers = { "content-type": MIME[".html"], "cache-control": "no-store" };
        if (out.setCookie) headers["set-cookie"] = out.setCookie;
        res.writeHead(out.status ?? 200, headers);
        return res.end(out.page);
      }
      // nothing matched — custom 404 page if the project has one
      const nf = await specialPage("_404.niral", { path: urlPath });
      if (nf) return send404Page(res, nf);
      return send(res, 404, "text/plain", "not found");
    }

    const ext = extname(file);

    if (ext === ".niral" || ext === ".jsx" || ext === ".tsx") {
      const source = readFileSync(file, "utf8");
      try {
        return send(res, 200, "text/javascript; charset=utf-8", compileForDev(source, urlPath));
      } catch (e) {
        if (e instanceof NiralError) return send(res, 200, "text/javascript; charset=utf-8", errorModule(errorPayload(e)));
        throw e;
      }
    }

    if (ext === ".ts") {
      const { stripTypes } = await import("../compiler/typescript.js");
      return send(res, 200, "text/javascript; charset=utf-8", stripTypes(readFileSync(file, "utf8")));
    }

    if (ext === ".html") {
      let html = readFileSync(file, "utf8");
      html = html.includes("</head>") ? html.replace("</head>", `${HMR_TAG}\n</head>`) : HMR_TAG + "\n" + html;
      return send(res, 200, MIME[".html"], html);
    }

    return send(res, 200, MIME[ext] ?? "application/octet-stream", readFileSync(file));
  }

  const ws = attachWebSocket(server);
  attachLive(server, { secret: sessionSecret, projectDir: dir }); // /@niral/live — user-facing real-time channels

  /* ── file watching ── */
  const pending = new Set();
  let timer = null;
  let watcher = null;
  if (watchFiles) {
    try {
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.split(sep).join("/");
        if (rel.includes("node_modules/") || rel.includes(".git/") || rel.startsWith(".")) return;
        pending.add(rel);
        clearTimeout(timer);
        timer = setTimeout(flush, 60);
      });
      watcher.on("error", (e) => {
        console.warn(`niral · file watching stopped (${e.code ?? e.message}) — reload manually`);
        watcher.close();
        watcher = null;
      });
    } catch {
      console.warn("niral · file watching unavailable — edit-and-reload manually");
    }
  }

  function flush() {
    const changed = [...pending];
    pending.clear();
    let reload = false;
    for (const rel of changed) {
      const abs = join(dir, rel);
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
      if (/\.(niral|jsx|tsx)$/.test(rel)) {
        try {
          const { ast } = compileClient(readFileSync(abs, "utf8"), { filename: rel, runtime: RUNTIME_PATH });
          if (ast.style) {
            // the page's hoisted <style> can't hot-swap — styled components reload
            reload = true;
          } else {
            ws.broadcast({ type: "update", path: "/" + rel });
            console.log(`niral · updated /${rel}`);
          }
        } catch (e) {
          if (e instanceof NiralError) {
            ws.broadcast({ type: "error", payload: errorPayload(e) });
            console.error("\n" + e.format() + "\n");
          } else {
            throw e;
          }
        }
      } else {
        reload = true;
      }
    }
    if (reload) {
      ws.broadcast({ type: "reload" });
      console.log("niral · reloading page");
    }
  }

  return {
    server,
    ws,
    listen(cb) {
      server.listen(port, () => {
        const p = server.address().port;
        console.log(`niral · dev server at http://localhost:${p} (hmr on)`);
        cb?.(p);
      });
      return server;
    },
    close() {
      watcher?.close();
      pool.stopAll();
      twProc?.kill();
      jobRunner?.stop();
      server.close();
    },
  };
}

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function send404Page(res, html) {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

function sendJson(res, status, obj) {
  send(res, status, "application/json", JSON.stringify(obj));
}

function readBody(req, limit, raw = false) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return; // drained, not buffered — the 400 can still be delivered
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new Error("body too large"));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!over) resolveBody(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function inside(base, target) {
  return resolve(target).startsWith(resolve(base) + sep) || resolve(target) === resolve(base);
}
