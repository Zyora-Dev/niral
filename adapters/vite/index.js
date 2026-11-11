// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * Vite plugin: import NiralScript (.nrs) files directly.
 *
 *   // vite.config.js
 *   import niralscript from "@niral/vite";
 *   export default { plugins: [niralscript()] };
 *
 *   // then anywhere:
 *   import * as counter from "./counter.nrs";
 *   import { useNrs } from "@niral/react";
 *
 * The plugin compiles each `.nrs` source to the standalone ES module that
 * `nrs compile` emits — exporting `createInstance` plus any top-level exports —
 * and hands Vite the code and source map. The React bridge (`@niral/react`)
 * consumes that module; this plugin only handles the import/transform/HMR step.
 *
 * `niralscript` is a dependency (the compiler); Vite is a peer dependency, so the
 * plugin adds no bundler of its own and honours Niral's zero-extra-dep contract.
 */

const NRS = /\.nrs$/;

/**
 * Resolve the NiralScript compiler. When installed from npm the `niralscript`
 * package provides `niralscript/compile`; inside the Niral monorepo (no
 * node_modules) we fall back to the sibling source. Either way: zero new deps.
 */
let compilePromise;
function loadCompiler() {
  if (!compilePromise) {
    compilePromise = import("niralscript/compile")
      .catch(() => import(new URL("../../niralscript/compile.js", import.meta.url).href))
      .then((module) => module.compileNiralScript);
  }
  return compilePromise;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.strictTypes]  Enable NiralScript strict type checking.
 * @param {boolean} [options.hmr]          Inject HMR glue (default: true in serve).
 * @returns {import("vite").Plugin}
 */
export default function niralscript(options = {}) {
  const compileOptions = { strictTypes: options.strictTypes ?? false };
  let isServe = false;

  return {
    name: "niral:niralscript",
    enforce: "pre",

    configResolved(config) {
      isServe = config.command === "serve";
    },

    async transform(source, id) {
      if (!NRS.test(id)) return null;
      const compileNiralScript = await loadCompiler();
      let output;
      try {
        output = compileNiralScript(source, id, { ...compileOptions, file: id });
      } catch (error) {
        // Surface NiralScript diagnostics as Vite errors with the original location.
        this.error(formatError(error, id));
        return null;
      }

      const wantHmr = options.hmr ?? isServe;
      const code = wantHmr && !output.topLevelAwait ? output.code + hmrFooter() : output.code;

      return { code, map: output.map };
    },

    handleHotUpdate(ctx) {
      // Let Vite propagate .nrs edits; the footer self-accepts so importers
      // re-run with the new createInstance. Returning undefined keeps defaults.
      if (!NRS.test(ctx.file)) return;
      return ctx.modules;
    },
  };
}

/** Self-accepting HMR footer: a .nrs module is pure logic, safe to hot-swap. */
function hmrFooter() {
  return "\nif (import.meta.hot) { import.meta.hot.accept(); }\n";
}

/** Render a NiralScript compile error into a Vite-friendly message. */
function formatError(error, id) {
  const where = error.filename ?? id;
  const line = error.line != null ? `:${error.line}` : "";
  const column = error.col != null ? `:${error.col}` : "";
  const code = error.code ? `[${error.code}] ` : "";
  return `NiralScript ${code}${error.message} (${where}${line}${column})`;
}
