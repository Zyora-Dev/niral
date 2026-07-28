/**
 * Niral build — content-hashed releases with atomic activation.
 *
 *   dist/
 *     releases/<hash>/        one immutable directory per build
 *       manifest.json         routes, modes, styles, shell
 *       assets/@niral/runtime/*   the client runtime (also used for SSR)
 *       assets/routes/**.js       compiled components (browser + Node)
 *       server/@niral/context.js  session context
 *       server/routes/**.server.js  <server> blocks
 *       static/**             copied public files
 *     current -> releases/<hash>   flipped ATOMICALLY after a successful build
 *
 * A failed build throws before the flip — production keeps serving the last
 * good release. Rollback = point `current` at any previous release.
 */

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync,
  cpSync, symlinkSync, renameSync, rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileClient, collectServerExports, parseComponent } from "../compiler/codegen.js";
import { stripTypes } from "../compiler/typescript.js";
import { authPrelude } from "../server/rpc.js";
import { scanRoutes, layoutChain } from "../server/router.js";
import { DEFAULT_SHELL } from "../server/page.js";
import { writeBundledRuntime } from "./bundle-runtime.js";
import { LANG_EXT } from "../server/polyglot.js";
import { loadRecipe, runTailwindOnce } from "../add/tailwind.js";
import { transcodeStatic } from "../add/imagetools.js";
import { componentCss } from "../compiler/style.js";
import { writeIntegrity } from "../server/integrity.js";

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// data/ = server-side private storage (sqlite files etc.) — NEVER shipped or served
const SKIP_STATIC = new Set(["routes", "dist", "node_modules", "data", "migrations", "tests", "deploy"]);
// server-only project files — never shipped as public static assets
const PRIVATE_FILES = /^(hooks|jobs)\.js$|\.env$/;

export function build({ root = ".", out } = {}) {
  const dir = resolve(root);
  const distDir = resolve(out ?? join(dir, "dist"));
  const routes = scanRoutes(join(dir, "routes"));
  if (!routes.length) throw new Error(`no routes found in ${join(dir, "routes")}`);

  // recipes first: a failing tailwind pass fails the build BEFORE anything flips
  const twRecipe = loadRecipe(dir);
  if (twRecipe) runTailwindOnce(dir, twRecipe, { minify: true });

  const shellFile = join(dir, "routes", "_shell.html");
  const shell = existsSync(shellFile) ? readFileSync(shellFile, "utf8") : DEFAULT_SHELL;

  /* ── compile routes + layouts + every component they import (throws before flip) ── */
  const routeLayouts = new Map(); // route rel → [layout rels]
  const layoutRels = new Set();
  for (const r of routes) {
    const chain = layoutChain(join(dir, "routes"), r.rel);
    routeLayouts.set(r.rel, chain.map((l) => l.rel));
    for (const l of chain) layoutRels.add(l.rel);
  }

  const modules = new Map(); // srcRel → { source, code, ast, deps: [childSrcRel] }
  const SPECIALS = ["_404.niral", "_error.niral"].filter((f) => existsSync(join(dir, "routes", f)));
  const queue = [
    ...routes.map((r) => "routes/" + r.rel),
    ...[...layoutRels].map((l) => "routes/" + l),
    ...SPECIALS.map((f) => "routes/" + f),
  ];
  while (queue.length) {
    const srcRel = queue.shift();
    if (modules.has(srcRel)) continue;
    const abs = join(dir, srcRel);
    if (!abs.startsWith(dir + sep) || !existsSync(abs)) {
      throw new Error(`component import escapes the project or is missing: ${srcRel}`);
    }
    const source = readFileSync(abs, "utf8");
    let ast = null;
    let code;
    if (srcRel.endsWith(".ts")) {
      // plain TS module dependency — strip types, ship as JS
      code = stripTypes(source);
    } else {
      ast = parseComponent(source, srcRel);
      const depth = srcRel.split("/").length - 1;
      ({ code } = compileClient(source, {
        filename: srcRel,
        runtime: "../".repeat(depth) + "@niral/runtime/index.js",
        moduleId: "/" + srcRel,
      }));
    }
    // child components/modules: enqueue + point the import at the compiled .js neighbour
    const deps = [];
    code = code.replace(/from\s+"(\.\.?\/[^"]+)\.(niral|jsx|tsx|ts)"/g, (_m, spec, extM) => {
      const childRel = relative(dir, resolve(dirname(abs), `${spec}.${extM}`)).split(sep).join("/");
      queue.push(childRel);
      deps.push(childRel);
      return `from "${spec}.js"`;
    });
    modules.set(srcRel, { source, code, ast, deps });
  }

  /** Transitive css for a module: deps first, own last. */
  function moduleCss(srcRel, seen = new Set()) {
    if (seen.has(srcRel)) return [];
    seen.add(srcRel);
    const m = modules.get(srcRel);
    if (!m) return [];
    const parts = m.deps.flatMap((d) => moduleCss(d, seen));
    const own = componentCss(m.ast);
    if (own) parts.push(own);
    return parts;
  }

  /* ── content hash over every input ── */
  const hasher = createHash("sha256");
  for (const rel of [...modules.keys()].sort()) hasher.update(rel).update("\0").update(modules.get(rel).source);
  for (const f of staticFiles(dir)) hasher.update(f).update("\0").update(readFileSync(join(dir, f)));
  hasher.update(shell);
  const hash = hasher.digest("hex").slice(0, 12);

  const release = join(distDir, "releases", hash);
  if (existsSync(release)) rmSync(release, { recursive: true }); // rebuild same content = same result

  /* ── write compiled modules + server blocks ── */
  const manifestRoutes = [];
  const usedLangs = new Set();
  for (const [srcRel, { code, ast }] of modules) {
    const clientOut = join(release, "assets", srcRel.replace(/\.(niral|jsx|tsx|ts)$/, ".js"));
    mkdirSync(dirname(clientOut), { recursive: true });
    writeFileSync(clientOut, code);

    if (ast?.server) {
      const lang = ast.server.attrs?.lang ?? "js";
      const depth = srcRel.split("/").length - 1;
      let serverCode, ext;
      if (lang === "js") {
        const ctxRel = "../".repeat(depth) + "@niral/context.js";
        const nRel = (f) => "../".repeat(depth) + "@niral/" + f;
        serverCode =
          `import { session } from ${JSON.stringify(ctxRel)};\n` +
          `const publish = (__ch, __data) => globalThis.__niralPublish?.(__ch, __data);\n` +
          `const user = () => session.get("user") ?? null;\n` +
          authPrelude(nRel("auth.js"), nRel("webauthn.js"), nRel("mail.js"), nRel("oauth.js"), nRel("validate.js"), nRel("observe.js"), nRel("ai.js"), nRel("rag.js")) +
          ast.server.code;
        ext = "server.js";
      } else {
        usedLangs.add(lang);
        serverCode = ast.server.code; // ambient session comes from the language runner
        ext = `server.${LANG_EXT[lang] ?? lang}`;
      }
      const serverOut = join(release, "server", srcRel.replace(/\.niral$/, `.${ext}`));
      mkdirSync(dirname(serverOut), { recursive: true });
      writeFileSync(serverOut, serverCode);
    }
  }
  for (const r of routes) {
    const { ast } = modules.get("routes/" + r.rel);
    const lang = ast?.server ? ast.server.attrs?.lang ?? "js" : null;
    manifestRoutes.push({
      pattern: r.pattern,
      segments: r.segments,
      rel: r.rel,
      mode: ast?.script?.attrs?.mode ?? "client",
      stream: !!ast?.script?.attrs?.stream,
      cache: Number(ast?.script?.attrs?.cache) || null,
      auth: ast?.server?.attrs?.auth ?? null,
      client: `/assets/${hash}/routes/` + r.rel.replace(/\.(niral|jsx|tsx)$/, ".js"),
      style: moduleCss("routes/" + r.rel).join("\n") || null,
      head: ast?.head?.raw ?? null,
      hasServer: !!ast?.server,
      serverLang: lang,
      hasLoad: ast?.server ? collectServerExports(ast.server.code, lang).includes("load") : false,
      layoutChain: routeLayouts.get(r.rel) ?? [],
    });
  }
  const manifestLayouts = {};
  for (const lrel of layoutRels) {
    const { ast } = modules.get("routes/" + lrel);
    const llang = ast?.server ? ast.server.attrs?.lang ?? "js" : null;
    manifestLayouts[lrel] = {
      client: `/assets/${hash}/routes/` + lrel.replace(/\.niral$/, ".js"),
      style: moduleCss("routes/" + lrel).join("\n") || null,
      head: ast?.head?.raw ?? null,
      hasServer: !!ast?.server,
      serverLang: llang,
      hasLoad: ast?.server ? collectServerExports(ast.server.code, llang).includes("load") : false,
      auth: ast?.server?.attrs?.auth ?? null,
    };
  }
  const manifestSpecial = {};
  for (const f of SPECIALS) {
    const key = f === "_404.niral" ? "notFound" : "error";
    manifestSpecial[key] = {
      client: `/assets/${hash}/routes/` + f.replace(/\.niral$/, ".js"),
      style: moduleCss("routes/" + f).join("\n") || null,
      head: modules.get("routes/" + f).ast.head?.raw ?? null,
    };
  }

  /* ── runtime + context + runners + static files ── */
  // the runtime ships BUNDLED: one request instead of a 6-module fetch storm
  writeBundledRuntime(join(FRAMEWORK_DIR, "runtime"), join(release, "assets", "@niral", "runtime"));
  mkdirSync(join(release, "server", "@niral"), { recursive: true });
  cpSync(join(FRAMEWORK_DIR, "server", "context.js"), join(release, "server", "@niral", "context.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "auth.js"), join(release, "server", "@niral", "auth.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "webauthn.js"), join(release, "server", "@niral", "webauthn.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "mail.js"), join(release, "server", "@niral", "mail.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "oauth.js"), join(release, "server", "@niral", "oauth.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "observe.js"), join(release, "server", "@niral", "observe.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "ai.js"), join(release, "server", "@niral", "ai.js"));
  cpSync(join(FRAMEWORK_DIR, "server", "rag.js"), join(release, "server", "@niral", "rag.js"));
  cpSync(join(FRAMEWORK_DIR, "shared", "validate.js"), join(release, "server", "@niral", "validate.js"));
  for (const lang of usedLangs) {
    cpSync(join(FRAMEWORK_DIR, "langs", lang, `runner.${LANG_EXT[lang] ?? lang}`), join(release, "server", "@niral", `runner-${lang}.${LANG_EXT[lang] ?? lang}`));
  }
  const staticList = staticFiles(dir);
  for (const f of staticList) {
    const dest = join(release, "static", f);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(dir, f), dest);
  }
  // images → responsive .webp variants (no-op without `niral add image --transcode`)
  transcodeStatic(dir, join(release, "static"), staticList);

  writeFileSync(
    join(release, "manifest.json"),
    JSON.stringify(
      { hash, createdAt: new Date().toISOString(), shell, routes: manifestRoutes, layouts: manifestLayouts, special: manifestSpecial },
      null,
      2
    )
  );

  /* ── tamper-detection manifest: sha256 of every file in the release ── */
  writeIntegrity(release);

  /* ── atomic flip: dist/current → releases/<hash> ── */
  const tmpLink = join(distDir, `.current.${process.pid}.${Date.now()}`);
  symlinkSync(join("releases", hash), tmpLink);
  renameSync(tmpLink, join(distDir, "current"));

  /* ── keep the last 5 releases for instant rollback ── */
  const releasesDir = join(distDir, "releases");
  const all = readdirSync(releasesDir)
    .map((name) => ({ name, mtime: statSync(join(releasesDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of all.slice(5)) {
    if (old.name !== hash) rmSync(join(releasesDir, old.name), { recursive: true });
  }

  return { hash, release, routes: manifestRoutes.length };
}

/** Project files copied verbatim (everything except routes/dist/node_modules/hidden). */
function staticFiles(dir) {
  const out = [];
  walk(dir, "");
  function walk(abs, prefix) {
    for (const name of readdirSync(abs)) {
      if (name.startsWith(".") || SKIP_STATIC.has(name)) continue;
      if (PRIVATE_FILES.test(name)) continue; // hooks.js / jobs.js / *.env — server-only
      const child = join(abs, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(child).isDirectory()) walk(child, rel);
      else out.push(rel);
    }
  }
  return out.sort();
}
