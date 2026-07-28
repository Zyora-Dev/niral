/**
 * Niral build — runtime bundler (zero-dep).
 *
 * The client runtime is 6 ES modules. Served raw, hydration pays an HTTP/1.1
 * request per module — 7 parallel fetches contend for the browser's 6
 * connections and stagger badly. We control every file in this graph, so a
 * general bundler is unnecessary: each module is wrapped in a scope (top-level
 * names like `queue` collide across files), imports become destructures of the
 * previous scopes, and the public surface is re-exported once at the end.
 *
 * Output (release/assets/@niral/runtime/):
 *   index.js   the whole runtime in ONE file (signals+dom+rpc+live+index+router)
 *   router.js  tiny shim → index.js (the hydration script's import target)
 *   *.js       shims for the remaining module names (direct-import safety)
 *
 * Handles exactly the syntax our runtime uses:
 *   import { a, b } from "./x.js";      import * as ns from "./x.js";
 *   export function|async function|class|const|let NAME
 *   export { a, b } from "./x.js";      (multi-line ok)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// dependency order — router last (it namespaces index). ssr.js is SERVER-ONLY
// (installed as globalThis.__niralSSR by render.js) and never bundled.
const ORDER = ["signals.js", "dom.js", "rpc.js", "live.js", "i18n.js", "index.js", "router.js"];

const modVar = (f) => "$niral_" + f.replace(/\.js$/, "").replace(/[^\w$]/g, "_");

/** Conservative line-based minify: drop comment lines, block comments,
 *  indentation and blank lines. Never touches anything mid-line (strings,
 *  regexes and trailing comments are left alone) — and the runtime keeps
 *  every template literal on one line, so line surgery is safe. */
function strip(src) {
  const out = [];
  let inBlock = false;
  for (let line of src.split("\n")) {
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      inBlock = false;
      line = line.slice(end + 2);
      if (!line.trim()) continue;
    }
    const t = line.trim();
    if (t === "" || t.startsWith("//")) continue;
    if (t.startsWith("/*")) {
      const end = t.indexOf("*/", 2);
      if (end === -1) { inBlock = true; continue; }
      const rest = t.slice(end + 2).trim();
      if (!rest) continue;
      out.push(rest);
      continue;
    }
    out.push(t);
  }
  return out.join("\n");
}

function transform(file, src) {
  const pre = []; // destructures replacing imports
  const names = []; // this module's exported names

  // export { a, b } from "./x.js";  (re-export list, may span lines)
  src = src.replace(/^export\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)";?/gm, (_m, list, dep) => {
    const bindings = list.split(",").map((s) => s.trim()).filter(Boolean);
    const destructure = bindings.map((b) => {
      const [orig, alias] = b.split(/\s+as\s+/);
      names.push(alias ?? orig);
      return alias ? `${orig}: ${alias}` : orig;
    });
    pre.push(`const { ${destructure.join(", ")} } = ${modVar(dep)};`);
    return "";
  });

  // import { a, b } from "./x.js";
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)";?/gm, (_m, list, dep) => {
    pre.push(`const {${list}} = ${modVar(dep)};`);
    return "";
  });

  // import * as ns from "./x.js";
  src = src.replace(/^import\s*\*\s*as\s*([\w$]+)\s*from\s*"\.\/([\w.-]+)";?/gm, (_m, ns, dep) => {
    pre.push(`const ${ns} = ${modVar(dep)};`);
    return "";
  });

  // export function|class|const|let NAME → plain declaration, name collected
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([\w$]+)/gm, (_m, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });

  // export { a, b };  (local list)
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_m, list) => {
    for (const b of list.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [orig, alias] = b.split(/\s+as\s+/);
      names.push(alias ?? orig);
      if (alias) pre.push(`const ${alias} = ${orig};`);
    }
    return "";
  });

  if (/^\s*(import|export)\s/m.test(src)) {
    throw new Error(`bundle-runtime: unhandled import/export syntax left in ${file}`);
  }

  return {
    names,
    chunk: `const ${modVar(file)} = (() => {\n${pre.join("\n")}\n${src}\nreturn { ${names.join(", ")} };\n})();`,
  };
}

/** Bundle src/runtime/* into a single ESM string. */
export function bundleRuntime(runtimeDir) {
  const chunks = [];
  const exportsOf = {};
  for (const file of ORDER) {
    const { names, chunk } = transform(file, strip(readFileSync(join(runtimeDir, file), "utf8")));
    exportsOf[file] = names;
    chunks.push(chunk);
  }
  const tail = [
    `export const { ${exportsOf["index.js"].join(", ")} } = ${modVar("index.js")};`,
    `export const { ${exportsOf["router.js"].join(", ")} } = ${modVar("router.js")};`,
  ];
  return `/** Niral runtime — bundled for production (one request, no waterfall). */\n${chunks.join("\n\n")}\n\n${tail.join("\n")}\n`;
}

/** Write the bundled runtime + shims into a release's runtime dir. */
export function writeBundledRuntime(runtimeDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "index.js"), bundleRuntime(runtimeDir));
  for (const file of ORDER) {
    if (file === "index.js") continue;
    writeFileSync(join(destDir, file), `export * from "./index.js";\n`);
  }
}
