/**
 * Niral server — render components to HTML.
 *
 * A compiled component is a plain function of (target, props). We install
 * the DOM shim as `globalThis.document`, mount synchronously, serialize the
 * result, and tear everything down. One codegen, two environments.
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileClient } from "../compiler/codegen.js";
import { componentCss } from "../compiler/style.js";
import { createDocument, serializeChildren } from "./dom-shim.js";
import * as ssrHelpers from "../runtime/ssr.js";

// string-mode SSR helpers are SERVER-ONLY: compiled __ssr functions reach them
// through this global instead of the runtime bundle — the browser never pays
// for them (in bytes or eval).
globalThis.__niralSSR = ssrHelpers;

const RUNTIME_FILE_URL = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "index.js")
).href;

/** Render a component function to an HTML string. */
export function renderComponent(componentFn, props = {}) {
  // string-mode SSR — the compiler emitted a direct concatenation renderer
  if (typeof componentFn.__ssr === "function") return componentFn.__ssr(props);
  const hadDoc = "document" in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = createDocument();
  try {
    const container = globalThis.document.createElement("div");
    const inst = componentFn(container, props);
    const html = serializeChildren(container);
    inst?.destroy?.(); // release effects — signals must not leak between renders
    return html;
  } finally {
    if (hadDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
}

/* ── .niral file → server-importable module (cached by mtime) ── */

const moduleCache = new Map(); // absPath → { mtimeMs, mod, ast, url, deps }

/**
 * Compile and import a .niral file for server-side rendering.
 * Relative .niral imports (child components) are resolved recursively and
 * inlined as data: URLs — data: modules cannot resolve relative specifiers.
 * Returns { mod, ast } — ast carries block attrs (e.g. script mode).
 */
export async function loadComponent(absPath, _stack = []) {
  const abs = resolve(absPath);
  if (_stack.includes(abs)) {
    throw new Error(`circular component import: ${[..._stack, abs].join(" → ")}`);
  }
  const mtimeMs = statSync(abs).mtimeMs;
  const hit = moduleCache.get(abs);
  if (
    hit &&
    hit.mtimeMs === mtimeMs &&
    hit.deps.every((d) => existsSync(d.abs) && statSync(d.abs).mtimeMs === d.mtimeMs)
  ) {
    return hit;
  }

  const source = readFileSync(abs, "utf8");
  let code, ast;
  if (abs.endsWith(".ts")) {
    // plain TS module — type-strip, no component pipeline
    const { stripTypes } = await import("../compiler/typescript.js");
    code = stripTypes(source);
    ast = null;
  } else {
    ({ code, ast } = compileClient(source, { filename: abs, runtime: RUNTIME_FILE_URL }));
  }

  const deps = [];
  for (const m of [...code.matchAll(/from\s+("(\.\.?\/[^"]+\.(?:niral|jsx|tsx|ts))")/g)]) {
    const childAbs = resolve(dirname(abs), m[2]);
    const childEntry = await loadComponent(childAbs, [..._stack, abs]);
    code = code.replace(m[1], JSON.stringify(childEntry.url));
    deps.push({ abs: childAbs, mtimeMs: childEntry.mtimeMs }, ...childEntry.deps);
  }

  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod = await import(url);
  const entry = { mtimeMs, mod, ast, url, deps };
  moduleCache.set(abs, entry);
  return entry;
}

/** Render a .niral file straight to HTML. */
export async function renderFile(absPath, props = {}) {
  const { mod, ast } = await loadComponent(absPath);
  return { html: renderComponent(mod.default, props), ast };
}

/**
 * Compose a page inside its layout chain (outermost first). Every layout
 * receives the route props and renders the next level through its <slot/>.
 * `runtime` must be the SAME runtime module instance the components import.
 */
export function composeComponent(runtime, layouts, Page) {
  if (!layouts.length) return Page;
  function Composed(target, props = {}) {
    return runtime.mount(target, () => {
      const chain = (i) =>
        i === layouts.length
          ? (Page.__build ?? Page)(props)
          : runtime.child(layouts[i], () => ({ ...props }), () => [chain(i + 1)]);
      return [chain(0)];
    });
  }
  // string-mode composition — layouts wrap the page via sChild (same anchors)
  if (typeof Page.__ssr === "function" && layouts.every((l) => typeof l.__ssr === "function")) {
    Composed.__ssr = (props = {}) => {
      const chain = (i) =>
        i === layouts.length
          ? Page.__ssr(props)
          : ssrHelpers.sChild(layouts[i], { ...props }, () => chain(i + 1));
      return chain(0);
    };
  }
  return Composed;
}

/** Render a route wrapped in its layouts. layoutAbsList = outermost first. */
export async function renderPage(absPath, props = {}, layoutAbsList = [], i18n = null) {
  const page = await loadComponent(absPath);
  const layouts = [];
  for (const labs of layoutAbsList) layouts.push(await loadComponent(labs));
  const runtime = await import(RUNTIME_FILE_URL);
  if (i18n) runtime._setI18n(i18n.messages, i18n.locale); // catalog for t() during SSR
  const fn = composeComponent(runtime, layouts.map((l) => l.mod.default), page.mod.default);
  return {
    html: renderComponent(fn, props),
    ast: page.ast,
    layoutAsts: layouts.map((l) => l.ast),
  };
}

/**
 * All CSS a component contributes: its own scoped styles PLUS those of every
 * component it (transitively) imports — deps first, own styles last.
 */
export async function collectCss(absPath) {
  const entry = await loadComponent(absPath);
  const parts = [];
  const seen = new Set();
  for (const d of entry.deps) {
    if (seen.has(d.abs)) continue;
    seen.add(d.abs);
    const dep = await loadComponent(d.abs);
    const css = componentCss(dep.ast);
    if (css) parts.push(css);
  }
  const own = componentCss(entry.ast);
  if (own) parts.push(own);
  return parts.join("\n") || null;
}
