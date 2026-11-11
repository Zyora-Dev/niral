// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * @niral/vite plugin tests.
 *
 * Vite is a peer dependency (not installed here, per the zero-dep rule), so these
 * tests invoke the plugin's `transform` hook directly with a minimal Vite-shaped
 * `this`. They prove: a .nrs import compiles to an importable module exporting
 * createInstance, HMR glue is injected in serve, top-level-await modules skip the
 * footer, and NiralScript diagnostics surface through Vite's error channel.
 */

import assert from "node:assert/strict";
import niralscript from "../adapters/vite/index.js";

/** Minimal Vite plugin-context stub exposing the error channel. */
function viteContext() {
  const errors = [];
  return {
    errors,
    this: {
      error(message) {
        errors.push(typeof message === "string" ? message : message.message);
        throw new Error(message.message ?? message);
      },
    },
  };
}

async function importModule(code) {
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

export function registerVitePluginTests(test) {
  test("Vite plugin ignores non-.nrs files", async () => {
    const plugin = niralscript();
    plugin.configResolved({ command: "serve" });
    const out = await plugin.transform.call(viteContext().this, "export const x = 1", "/app/foo.js");
    assert.equal(out, null, "non-.nrs ids pass through untouched");
  });

  test("Vite plugin compiles a .nrs module to importable createInstance", async () => {
    const plugin = niralscript();
    plugin.configResolved({ command: "build" }); // build → no HMR footer by default
    const source = [
      "state count: number = 2",
      "derive doubled: number = count * 2",
      "export function bump(): number { count += 1; return count }",
    ].join("\n");
    const result = await plugin.transform.call(viteContext().this, source, "/app/counter.nrs");

    assert.ok(result && typeof result.code === "string", "returns compiled code");
    assert.ok(result.map && result.map.version === 3, "returns a v3 source map");
    assert.ok(!result.code.includes("import.meta.hot"), "no HMR footer in build mode");

    const module = await importModule(result.code);
    const values = module.createInstance().values;
    assert.equal(values.count, 2, "state initial value");
    assert.equal(values.doubled, 4, "derived value");
    assert.equal(values.bump(), 3, "exported function mutates state");
    assert.equal(values.doubled, 6, "derive recomputes after mutation");
  });

  test("Vite plugin injects a self-accepting HMR footer in serve", async () => {
    const plugin = niralscript();
    plugin.configResolved({ command: "serve" });
    const result = await plugin.transform.call(viteContext().this, "state n: number = 0", "/app/s.nrs");
    assert.ok(result.code.includes("import.meta.hot.accept()"), "HMR footer present in serve");

    // The footer is guarded by import.meta.hot, so the module still imports clean.
    const module = await importModule(result.code);
    assert.equal(module.createInstance().values.n, 0, "module imports and runs despite footer");
  });

  test("Vite plugin omits the HMR footer for top-level-await modules", async () => {
    const plugin = niralscript();
    plugin.configResolved({ command: "serve" });
    const source = "state total = await 7\nderive doubled = total * 2";
    const result = await plugin.transform.call(viteContext().this, source, "/app/await.nrs");
    assert.ok(result.code.includes("async function createInstance"), "top-level await compiled");
    assert.ok(!result.code.includes("import.meta.hot"), "no footer when top-level await is present");
  });

  test("Vite plugin surfaces NiralScript diagnostics through this.error", async () => {
    const plugin = niralscript({ strictTypes: true });
    plugin.configResolved({ command: "serve" });
    const ctx = viteContext();
    await assert.rejects(
      () => plugin.transform.call(ctx.this, "derive loop: number = loop + 1", "/app/bad.nrs"),
      /NiralScript/,
    );
    assert.ok(ctx.errors.length === 1, "exactly one diagnostic raised");
    assert.match(ctx.errors[0], /cycle/i, "the cycle diagnostic is reported");
  });
}
