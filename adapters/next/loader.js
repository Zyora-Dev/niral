// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * webpack loader: compile NiralScript (.nrs) files for Next.js (and any
 * webpack-based bundler). It mirrors the Vite plugin's transform step — each
 * `.nrs` source becomes the standalone ES module that `nrs compile` emits
 * (`createInstance` + top-level exports) — so the `@niral/react` bridge can
 * consume it. Turbopack reuses the same loader via `turbopack.rules`.
 *
 * `niralscript` is a dependency (the compiler); Next.js/webpack are peers, so
 * this loader ships no bundler and honours Niral's zero-extra-dep contract.
 *
 * @this {import("webpack").LoaderContext<{ strictTypes?: boolean }>}
 * @param {string} source
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

export default function niralscriptLoader(source) {
  const callback = this.async();
  const id = this.resourcePath;
  const options = (this.getOptions && this.getOptions()) || {};
  const compileOptions = { strictTypes: options.strictTypes ?? false, file: id };

  loadCompiler().then(
    (compileNiralScript) => {
      let output;
      try {
        output = compileNiralScript(source, id, compileOptions);
      } catch (error) {
        callback(toLoaderError(error, id));
        return;
      }
      // A .nrs module is reactive client logic; mark it so Next's App Router
      // treats the compiled module (and its importers' usage) as a Client
      // Component boundary when imported directly in a client file.
      const code = `"use client";\n${output.code}`;
      callback(null, code, output.map ?? undefined);
    },
    (error) => callback(error),
  );
}

/** Convert a NiralScript compile error into a webpack-friendly Error. */
function toLoaderError(error, id) {
  const where = error.filename ?? id;
  const line = error.line != null ? `:${error.line}` : "";
  const column = error.col != null ? `:${error.col}` : "";
  const code = error.code ? `[${error.code}] ` : "";
  const wrapped = new Error(`NiralScript ${code}${error.message} (${where}${line}${column})`);
  wrapped.loc = error.line != null ? { line: error.line, column: error.col ?? 0 } : undefined;
  return wrapped;
}
