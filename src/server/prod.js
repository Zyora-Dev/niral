/**
 * Niral production server — serves dist/current.
 *
 * No compiler, no watcher, no HMR: precompiled modules only. Every request
 * resolves against the release that was `current` at boot; a new deploy
 * flips the symlink and takes effect on the next restart (or run two
 * instances behind a port swap for zero-downtime).
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { matchRoute } from "./router.js";
import { renderComponent, composeComponent } from "./render.js";
import { callServerFn, pooledCall, authFailure, streamRpc } from "./rpc.js";
import { satisfiesAuth } from "./auth.js";
import { newSecret, readSession, sessionCookie } from "./session.js";
import { assemblePage, assemblePageParts, hydrationScript, renderHead, preloadLinks } from "./page.js";
import { createWorkerPool } from "./workers.js";
import { createLimiter } from "./ratelimit.js";
import { LANG_EXT, materialize } from "./polyglot.js";
import { collectServerExports } from "../compiler/codegen.js";
import { parseFormBody, actionName, actionRedirect } from "./forms.js";
import { multipartBoundary, parseMultipart, encodeFilesForWorker, DEFAULT_MAX_UPLOAD } from "./uploads.js";
import { createJobRunner } from "./jobs.js";
import { attachLive } from "./live.js";
import { loadHooks, applyHooks, checkRequiredEnv } from "./hooks.js";
import { makeNonce, baseSecurityHeaders, htmlSecurityHeaders, MAX_RPC_ARGS } from "./security.js";
import { setSecureCookies } from "./session.js";
import { logRequest, logError, healthPayload } from "./observe.js";
import { loadCatalogs, negotiate } from "./i18n.js";
import { migrateAtBoot } from "./migrate.js";

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
  ".txt": "text/plain; charset=utf-8",
};

export function createProdServer({ dist = "dist", port = 8199, secret, cwd, secure } = {}) {
  const releaseDir = realpathSync(join(resolve(dist), "current"));
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  const sessionSecret = secret ?? process.env.NIRAL_SECRET ?? newSecret();
  const etag = `"${manifest.hash}"`;
  const rpcLimiter = createLimiter({ limit: 300, windowMs: 60_000 });
  // project root: server-side storage (data/) lives here, SURVIVING deploys
  const projectRoot = cwd ?? resolve(dist, "..");
  globalThis.__niralProjectRoot = pathToFileURL(projectRoot + "/").href; // projectImport() base
  if (secure ?? process.env.NIRAL_SECURE === "1") setSecureCookies(true);

  const componentCache = new Map(); // asset rel path → module (immutable per release)
  const serverCache = new Map();
  let releaseContext = null; // the release's own context.js — its ALS is what `session` binds to
  let releaseRuntime = null; // the release's runtime — layout composition must use the SAME instance

  async function assetModule(relJs) {
    let mod = componentCache.get(relJs);
    if (!mod) {
      mod = await import(pathToFileURL(join(releaseDir, "assets", relJs)).href);
      componentCache.set(relJs, mod);
    }
    return mod;
  }

  async function runtimeModule() {
    if (!releaseRuntime) {
      releaseRuntime = await import(pathToFileURL(join(releaseDir, "assets", "@niral", "runtime", "index.js")).href);
    }
    return releaseRuntime;
  }

  /** Render manifest.special.notFound / .error standalone (no hydration). */
  async function specialPage(kind, props) {
    const spec = manifest.special?.[kind];
    if (!spec) return null;
    try {
      const mod = await assetModule(spec.client.replace(`/assets/${manifest.hash}/`, "").replace("/assets/", ""));
      const html = renderComponent(mod.default, props);
      return assemblePage({
        shell: manifest.shell,
        style: spec.style,
        head: spec.head,
        html,
        hydrate: "",
      });
    } catch (e) {
      console.error(`niral · ${kind} page failed to render:`, e.message);
      return null;
    }
  }
  const pool = createWorkerPool({
    runners: {
      python: join(releaseDir, "server", "@niral", "runner-python.py"),
      ruby: join(releaseDir, "server", "@niral", "runner-ruby.rb"),
    },
    cwd: projectRoot,
  });

  /** { rel, serverLang } — works for routes AND layouts. */
  function workerServerFile(desc) {
    const f = join(releaseDir, "server", "routes", desc.rel.replace(/\.niral$/, `.server.${LANG_EXT[desc.serverLang] ?? desc.serverLang}`));
    if (desc.serverLang !== "go") return f;
    // Go is compiled — materialize the release's server block into a runnable package
    const code = readFileSync(f, "utf8");
    return materialize(f, { lang: "go", code, exports: collectServerExports(code, "go") }).file;
  }

  async function contextAls() {
    if (!releaseContext) {
      releaseContext = await import(pathToFileURL(join(releaseDir, "server", "@niral", "context.js")).href);
    }
    return releaseContext.als;
  }

  async function serverModFor(desc) {
    let mod = serverCache.get(desc.rel);
    if (!mod) {
      mod = await import(
        pathToFileURL(join(releaseDir, "server", "routes", desc.rel.replace(/\.niral$/, ".server.js"))).href
      );
      serverCache.set(desc.rel, mod);
    }
    return mod;
  }

  /** Run a route's or layout's load() (any language). Mutates `store`. */
  async function runLoadFor(desc, params, store, locals = null) {
    if (!desc.hasServer || !desc.hasLoad) return null;
    if (desc.serverLang && desc.serverLang !== "js") {
      const r = await pool.call(desc.serverLang, workerServerFile(desc), "load", [params], store.data);
      if (r.session) {
        store.data = r.session;
        store.dirty = true;
      }
      if (!r.ok && r.errorKind !== "unknown_fn") throw new Error(r.error);
      return r.ok ? r.result : null;
    }
    const smod = await serverModFor(desc);
    if (typeof smod.load !== "function") return null;
    return await (await contextAls()).run(store, () => smod.load({ params, locals }));
  }

  /** Call one exported <server> function (RPC + form actions share this). */
  async function runServerCall(desc, fn, args, cookieHeader) {
    if (desc.auth) {
      const store = readSession(cookieHeader, sessionSecret);
      const fail = authFailure(store, desc.auth);
      if (fail) return fail;
    }
    if (desc.serverLang && desc.serverLang !== "js") {
      if (fn.startsWith("_") || fn === "load") {
        return { status: 404, body: { ok: false, error: `unknown server function '${fn}'` } };
      }
      const store = readSession(cookieHeader, sessionSecret);
      return pooledCall(pool, desc.serverLang, workerServerFile(desc), fn, args, store, sessionSecret);
    }
    const mod = await serverModFor(desc);
    return callServerFn(mod, fn, args, cookieHeader, sessionSecret, await contextAls());
  }

  const server = createServer((req, res) => {
    res.__req = req; // lets response helpers negotiate compression
    logRequest(req, res); // structured access log (NIRAL_ACCESS_LOG=off to drop)
    handle(req, res).catch((e) => {
      logError(e, req);
      if (!res.headersSent) send(res, 500, "text/plain", "internal error");
    });
  });
  const liveHub = attachLive(server, { secret: sessionSecret, projectDir: projectRoot }); // /@niral/live — user-facing real-time channels

  // pending SQL migrations apply BEFORE the server takes traffic
  migrateAtBoot(projectRoot);

  // background jobs + cron (jobs.js at the project root; NIRAL_JOBS=off when a
  // dedicated `niral jobs` worker owns the queue)
  let jobRunner = null;
  if (process.env.NIRAL_JOBS !== "off") {
    createJobRunner({ projectDir: projectRoot })
      .then((r) => {
        jobRunner = r;
        if (r) console.log("niral · jobs.js loaded — queue + cron running");
      })
      .catch((e) => console.error("niral · jobs.js failed to start:", e.message));
  }

  async function handle(req, res) {
    const reqUrl = new URL(req.url, "http://x");
    const urlPath = decodeURIComponent(reqUrl.pathname);

    // load-balancer probe — release + uptime, no secrets
    if (urlPath === "/@niral/health") {
      return sendJson(res, 200, healthPayload({ release: manifest.hash }));
    }

    // hooks.js middleware — auth guards, redirects, locals (framework/asset paths exempt)
    if (!urlPath.startsWith("/@niral/") && !urlPath.startsWith("/assets/")) {
      const hooks = await loadHooks(projectRoot);
      if (hooks?.handle) {
        const store = readSession(req.headers.cookie, sessionSecret);
        const r = await applyHooks(hooks, req, res, urlPath, store, sessionSecret);
        if (r.handled) return;
        req.__niralLocals = r.locals;
      }
    }

    /* ── form actions: POST ?/name (works with AND without JS) ── */
    if (req.method === "POST" && actionName(reqUrl.search)) {
      const action = actionName(reqUrl.search);
      const match = matchRoute(manifest.routes, urlPath);
      if (!match || !match.route.hasServer) return send(res, 404, "text/plain", "not found");
      if (!rpcLimiter.check(req.socket.remoteAddress ?? "?")) {
        return sendJson(res, 429, { ok: false, error: "too many requests — slow down" });
      }
      const ctype = req.headers["content-type"] ?? "";
      let form;
      const boundary = multipartBoundary(ctype);
      if (boundary) {
        const maxUpload = Number(process.env.NIRAL_MAX_UPLOAD) || DEFAULT_MAX_UPLOAD;
        let raw;
        try {
          raw = await readBody(req, maxUpload, true);
          form = parseMultipart(raw, boundary);
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: `upload rejected: ${e.message}` });
        }
        if (match.route.serverLang && match.route.serverLang !== "js") form = encodeFilesForWorker(form);
      } else if (ctype.includes("application/x-www-form-urlencoded")) {
        form = parseFormBody(await readBody(req, 1024 * 1024));
      } else {
        return sendJson(res, 415, { ok: false, error: "form actions take urlencoded or multipart/form-data" });
      }
      const out = await runServerCall(match.route, action, [form], req.headers.cookie);
      if (out.status === 404 || out.status === 403) return sendJson(res, out.status, out.body);
      if (out.status === 401) {
        if (req.headers["x-niral-form"] === "1") return sendJson(res, 401, out.body);
        const login = process.env.NIRAL_LOGIN_PATH ?? "/auth/login";
        res.writeHead(303, { location: `${login}?next=${encodeURIComponent(urlPath)}` });
        return res.end();
      }
      const result = out.body.ok
        ? out.body.result
        : out.body.errors
          ? { error: out.body.error, errors: out.body.errors }
          : { error: out.body.error };
      const redirect = out.body.ok ? actionRedirect(out.body.result) : null;
      const cookieForRender = out.setCookie ? out.setCookie.split(";")[0] : req.headers.cookie;

      if (req.headers["x-niral-form"] === "1") {
        const headers = { "content-type": "application/json", "cache-control": "no-store" };
        if (out.setCookie) headers["set-cookie"] = out.setCookie;
        if (redirect) {
          res.writeHead(200, headers);
          return res.end(JSON.stringify({ ok: true, redirect }));
        }
        req.headers["x-niral-nav"] = "1"; // renderRoute's nav branch builds the payload
        req.headers.cookie = cookieForRender;
        return renderRoute(req, res, match.route, match.params, urlPath, {
          extraProps: { form: result },
          actionSetCookie: out.setCookie,
        });
      }

      if (redirect) {
        const headers = { location: redirect };
        if (out.setCookie) headers["set-cookie"] = out.setCookie;
        res.writeHead(303, headers);
        return res.end();
      }
      req.headers.cookie = cookieForRender;
      return renderRoute(req, res, match.route, match.params, urlPath, {
        extraProps: { form: result },
        actionSetCookie: out.setCookie,
      });
    }

    /* ── RPC ── */
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
      let desc = manifest.routes.find((r) => "/routes/" + r.rel === modPath && r.hasServer);
      if (!desc) {
        const hit = Object.entries(manifest.layouts ?? {}).find(
          ([lrel, l]) => "/routes/" + lrel === modPath && l.hasServer
        );
        if (hit) desc = { rel: hit[0], ...hit[1] };
      }
      if (!desc || typeof fn !== "string") return sendJson(res, 404, { ok: false, error: "unknown module" });
      if (Array.isArray(args) && args.length > MAX_RPC_ARGS) {
        return sendJson(res, 400, { ok: false, error: "too many arguments" });
      }
      const out = await runServerCall(desc, fn, args, req.headers.cookie);
      if (out.stream) return streamRpc(res, out); // async generator → NDJSON chunks
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      if (out.setCookie) headers["set-cookie"] = out.setCookie;
      res.writeHead(out.status, headers);
      return res.end(JSON.stringify(out.body));
    }

    /* ── release assets — versioned URLs cache FOREVER, plain URLs revalidate ── */
    if (urlPath.startsWith("/assets/")) {
      // /assets/<release-hash>/… — the content IS the version: immutable
      const versioned = urlPath.match(/^\/assets\/([0-9a-f]{12})\/(.+)$/);
      if (versioned && versioned[1] === manifest.hash) {
        const file = join(releaseDir, "assets", versioned[2]);
        if (!inside(join(releaseDir, "assets"), file) || !existsSync(file)) return send(res, 404, "text/plain", "not found");
        return writeBody(
          res,
          200,
          {
            "content-type": MIME[extname(file)] ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
            ...baseSecurityHeaders(),
          },
          readFileSync(file)
        );
      }
      if (versioned) {
        // a STALE release's asset (deploy happened mid-session) — point the
        // browser at the current equivalent instead of 404ing the app
        res.writeHead(302, { location: `/assets/${manifest.hash}/${versioned[2]}`, "cache-control": "no-store" });
        return res.end();
      }
      if (req.headers["if-none-match"] === etag) return res.writeHead(304, { etag }).end();
      const file = join(releaseDir, urlPath);
      if (!inside(join(releaseDir, "assets"), file) || !existsSync(file)) return send(res, 404, "text/plain", "not found");
      return writeBody(res, 200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", etag, ...baseSecurityHeaders() }, readFileSync(file));
    }

    /* ── copied static files ── */
    const staticFile = join(releaseDir, "static", urlPath);
    if (inside(join(releaseDir, "static"), staticFile) && existsSync(staticFile) && !urlPath.endsWith("/")) {
      try {
        const body = readFileSync(staticFile);
        return writeBody(res, 200, { "content-type": MIME[extname(staticFile)] ?? "application/octet-stream", "cache-control": "no-cache", etag, ...baseSecurityHeaders() }, body);
      } catch {
        /* directory — fall through to routing */
      }
    }

    /* ── routed pages (SSR) ── */
    const match = matchRoute(manifest.routes, urlPath);
    if (match) {
      const { route, params } = match;
      try {
        return await renderRoute(req, res, route, params, urlPath);
      } catch (e) {
        console.error(e);
        const errPage = await specialPage("error", { path: urlPath, message: String(e?.message ?? e) });
        if (errPage) return send(res, 500, MIME[".html"], errPage);
        return send(res, 500, "text/plain", "internal error");
      }
    }

    const nf = await specialPage("notFound", { path: urlPath });
    if (nf) return send(res, 404, MIME[".html"], nf);
    return send(res, 404, "text/plain", "not found");
  }

  async function renderRoute(req, res, route, params, urlPath, opts = {}) {
      const nonce = makeNonce(); // per-request CSP nonce for inline scripts

      const layoutRels = route.layoutChain ?? [];
      const styles = [
        ...layoutRels.map((lrel) => manifest.layouts?.[lrel]?.style).filter(Boolean),
        route.style,
      ]
        .filter(Boolean)
        .join("\n");
      const heads = [
        ...layoutRels.map((lrel) => manifest.layouts?.[lrel]?.head).filter(Boolean),
        route.head,
      ]
        .filter(Boolean)
        .join("\n");

      // <server auth> — the page itself is guarded (layouts too)
      const authNeeds = [route.auth, ...layoutRels.map((lrel) => manifest.layouts?.[lrel]?.auth)].filter(Boolean);
      if (authNeeds.length) {
        const store = readSession(req.headers.cookie, sessionSecret);
        for (const need of authNeeds) {
          if (!satisfiesAuth(store, need)) {
            const login = process.env.NIRAL_LOGIN_PATH ?? "/auth/login";
            if (req.headers["x-niral-nav"]) return sendJson(res, store.data.user ? 403 : 401, { ok: false });
            res.writeHead(303, { location: `${login}?next=${encodeURIComponent(urlPath)}` });
            return res.end();
          }
        }
      }

      // streaming SSR (`<script stream>`): flush shell + head BEFORE load()
      // runs. Headers go out with the first chunk — session writes inside
      // load() cannot set cookies on streamed pages.
      const streaming = route.stream && !req.headers["x-niral-nav"];
      let streamTail = null;
      if (streaming) {
        const parts = assemblePageParts({ shell: manifest.shell, style: styles || null, head: renderHead(heads, params) || null });
        streamTail = parts.tail;
        res.writeHead(200, {
          "content-type": MIME[".html"],
          "cache-control": "no-store",
          ...baseSecurityHeaders(),
          ...htmlSecurityHeaders(nonce),
        });
        res.write(parts.top);
      }

      try {

      // <server> load({ params }) — layouts outermost-first, page LAST (page wins)
      let props = params;
      let setCookie = null;
      const layoutDescs = layoutRels
        .map((lrel) => ({ rel: lrel, ...(manifest.layouts?.[lrel] ?? {}) }))
        .filter((d) => d.hasLoad);
      if ((route.hasServer && route.hasLoad) || layoutDescs.length) {
        const store = readSession(req.headers.cookie, sessionSecret);
        let merged = { ...params };
        if (store.data.user) merged.user = store.data.user; // identity on every page
        for (const d of layoutDescs) {
          const data = await runLoadFor(d, params, store, req.__niralLocals ?? null);
          if (data != null) merged = { ...merged, ...data };
        }
        const data = await runLoadFor(route, params, store, req.__niralLocals ?? null);
        if (data != null) merged = { ...merged, ...data };
        props = merged;
        if (store.dirty) setCookie = sessionCookie(store, sessionSecret);
      } else {
        const store = readSession(req.headers.cookie, sessionSecret);
        if (store.data.user) props = { ...params, user: store.data.user };
      }
      if (opts.extraProps) props = { ...props, ...opts.extraProps };

      // i18n: negotiate the locale, translate the SSR, ship the catalog to the client
      let i18nBoot = null;
      const i18nData = loadCatalogs(projectRoot);
      if (i18nData) {
        const locale = negotiate(req.headers.cookie, req.headers["accept-language"], i18nData);
        i18nBoot = { locale, messages: i18nData.catalogs[locale] };
        props = { locale, ...props };
      }

      // client-side navigation asks for JSON, not HTML
      if (req.headers["x-niral-nav"]) {
        const headers = { "content-type": "application/json", "cache-control": "no-store" };
        if (setCookie) headers["set-cookie"] = setCookie;
        res.writeHead(200, headers);
        return res.end(
          JSON.stringify({
            ok: true,
            mode: route.mode,
            component: route.client,
            layouts: layoutRels.map((lrel) => manifest.layouts[lrel].client),
            props,
            style: styles,
            head: renderHead(heads, props) || null,
          })
        );
      }

      const mod = await assetModule("routes/" + route.rel.replace(/\.(niral|jsx|tsx)$/, ".js"));
      const layoutMods = [];
      for (const lrel of layoutRels) {
        layoutMods.push((await assetModule("routes/" + lrel.replace(/\.(niral|jsx|tsx)$/, ".js"))).default);
      }
      const fnRuntime = await runtimeModule();
      if (i18nBoot) fnRuntime._setI18n(i18nBoot.messages, i18nBoot.locale); // catalog for t() during SSR
      const fn = composeComponent(fnRuntime, layoutMods, mod.default);
      const html = renderComponent(fn, props);
      const hydrate =
        route.mode === "client"
          ? hydrationScript(route.client, props, {
              runtimeBase: `/assets/${manifest.hash}/@niral/runtime`,
              layoutPaths: layoutRels.map((lrel) => manifest.layouts[lrel].client),
              nonce,
              i18n: i18nBoot,
            })
          : "";

      if (streaming) {
        return res.end(html + "</div>" + hydrate + streamTail);
      }

      const page = assemblePage({
        shell: manifest.shell,
        style: styles || null,
        head:
          (renderHead(heads, props) || "") +
          (route.mode === "client"
            ? "\n" +
              preloadLinks({
                runtimeBase: `/assets/${manifest.hash}/@niral/runtime`,
                component: route.client,
                layouts: layoutRels.map((lrel) => manifest.layouts[lrel].client),
                runtimeFiles: ["router.js", "index.js"], // bundled runtime
              })
            : "") || null,
        html,
        hydrate,
      });
      const headers = {
        "content-type": MIME[".html"],
        "cache-control":
          route.cache && !setCookie && !opts.actionSetCookie
            ? `public, max-age=${route.cache}, stale-while-revalidate=${route.cache * 5}`
            : "no-store",
        ...baseSecurityHeaders(),
        ...htmlSecurityHeaders(nonce),
      };
      const cookies = [opts.actionSetCookie, setCookie].filter(Boolean);
      if (cookies.length) headers["set-cookie"] = cookies;
      return writeBody(res, 200, headers, page);

      } catch (e) {
        if (!streaming) throw e; // normal path — the caller renders the error page
        console.error(e);
        return res.end(`<p>something went wrong.</p></div>${streamTail}`);
      }
  }

  return {
    server,
    manifest,
    listen(cb) {
      (async () => {
        // hooks.js `export const env = [...]` — refuse to boot without required config
        const { missing } = await checkRequiredEnv(projectRoot);
        if (missing.length) {
          console.error(
            `niral · refusing to start — missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}\n` +
              `  declared in hooks.js (export const env = [...]) — set them in deploy/app.env or export them before \`niral start\``
          );
          process.exit(1);
        }
        server.listen(port, () => {
          const p = server.address().port;
          console.log(`niral · serving release ${manifest.hash} at http://localhost:${p}`);
          cb?.(p);
        });
      })();
      return server;
    },
    close() {
      pool.stopAll();
      jobRunner?.stop();
      server.close();
      server.closeIdleConnections?.(); // drain keep-alives now
      // in-flight requests get a grace window, then the plug is pulled
      setTimeout(() => server.closeAllConnections?.(), 5000).unref();
    },
    /** Graceful shutdown — `niral start` calls this on SIGTERM/SIGINT (a deploy's
     *  `systemctl restart` sends SIGTERM). Stops accepting, lets in-flight
     *  requests finish, closes live sockets with a proper close frame, stops
     *  jobs + language workers. Resolves when fully drained (or at `grace`). */
    async shutdown({ grace = 10_000 } = {}) {
      const closed = new Promise((r) => server.close(r));
      liveHub.closeAll(); // WebSockets get 1001 "going away" — clients reconnect to the new process
      server.closeIdleConnections?.();
      // keep-alive sockets go idle the moment their response finishes — sweep
      // them so the drain completes promptly instead of waiting out `grace`
      const sweep = setInterval(() => server.closeIdleConnections?.(), 250);
      sweep.unref?.();
      const plug = setTimeout(() => server.closeAllConnections?.(), grace);
      plug.unref?.();
      await Promise.all([closed, jobRunner?.stop?.()]);
      clearInterval(sweep);
      clearTimeout(plug);
      pool.stopAll();
    },
  };
}

function send(res, status, type, body) {
  writeBody(res, status, { "content-type": type, "cache-control": "no-store", ...baseSecurityHeaders() }, body);
}

const COMPRESSIBLE = /text\/|javascript|json|svg/;

/** All prod bodies funnel through here — gzip when the client accepts it. */
function writeBody(res, status, headers, body) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
  const type = headers["content-type"] ?? "";
  if (COMPRESSIBLE.test(type)) {
    headers.vary = "accept-encoding";
    const accept = res.__req?.headers["accept-encoding"] ?? "";
    if (buf.length > 1024 && /\bgzip\b/.test(accept)) {
      buf = gzipSync(buf);
      headers["content-encoding"] = "gzip";
    }
  }
  res.writeHead(status, headers);
  res.end(buf);
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
