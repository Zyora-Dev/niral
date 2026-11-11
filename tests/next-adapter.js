// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * @niral/next adapter tests.
 *
 * Next.js and webpack are peer dependencies (not installed here, per the zero-dep
 * rule), so these tests invoke the loader with a minimal webpack LoaderContext
 * stub and inspect `withNiral`'s config shape directly. They prove: the loader
 * compiles a .nrs source to an importable "use client" module exporting
 * createInstance, surfaces NiralScript diagnostics through the webpack callback,
 * and that withNiral registers the loader for both webpack and Turbopack while
 * preserving a user-supplied webpack hook.
 */

import assert from "node:assert/strict";
import niralscriptLoader from "../adapters/next/loader.js";
import { withNiral } from "../adapters/next/index.js";

/** Minimal webpack LoaderContext stub; resolves with { err, code, map }. */
function runLoader(source, { resourcePath = "/app/counter.nrs", options = {} } = {}) {
  return new Promise((resolve) => {
    const ctx = {
      resourcePath,
      getOptions: () => options,
      async() {
        return (err, code, map) => resolve({ err, code, map });
      },
    };
    niralscriptLoader.call(ctx, source);
  });
}

async function importModule(code) {
  // Strip the "use client" directive — it's a no-op outside a bundler, and a
  // bare string-literal statement is harmless, but we assert on it separately.
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

export function registerNextAdapterTests(test) {
  test("Next loader compiles a .nrs module to a use-client createInstance module", async () => {
    const source = [
      "state count: number = 2",
      "derive doubled: number = count * 2",
      "export function bump(): number { count += 1; return count }",
    ].join("\n");
    const { err, code, map } = await runLoader(source);

    assert.equal(err, null, "no error for valid source");
    assert.match(code, /^"use client";/, "emits the use client directive first");
    assert.ok(code.includes("createInstance"), "exports createInstance");
    assert.ok(map && map.version === 3, "returns a v3 source map");

    const module = await importModule(code);
    const values = module.createInstance().values;
    assert.equal(values.count, 2, "state initial value");
    assert.equal(values.doubled, 4, "derived value");
    assert.equal(values.bump(), 3, "exported function mutates state");
    assert.equal(values.doubled, 6, "derive recomputes after mutation");
  });

  test("Next loader surfaces NiralScript diagnostics through the webpack callback", async () => {
    const { err, code } = await runLoader("derive loop: number = loop + 1");
    assert.ok(err instanceof Error, "an Error is passed to the callback");
    assert.match(err.message, /NiralScript/, "message is a NiralScript diagnostic");
    assert.match(err.message, /cycle/i, "the cycle diagnostic is reported");
    assert.equal(code, undefined, "no code emitted on error");
  });

  test("withNiral registers the .nrs loader for webpack and Turbopack", () => {
    const config = withNiral({ reactStrictMode: true });

    // Turbopack rule (experimental.turbo.rules — Next 13/14; still read on 15).
    const rule = config.experimental.turbo.rules["*.nrs"];
    assert.ok(rule, "a Turbopack rule exists for *.nrs");
    assert.equal(rule.as, "*.js", "Turbopack treats the output as JS");
    assert.match(rule.loaders[0].loader, /loader\.js$/, "points at the next loader");

    // webpack rule.
    const webpackConfig = { module: { rules: [] } };
    const out = config.webpack(webpackConfig, {});
    const nrsRule = out.module.rules.find((r) => String(r.test) === String(/\.nrs$/));
    assert.ok(nrsRule, "a webpack rule exists for .nrs");
    assert.match(nrsRule.use[0].loader, /loader\.js$/, "points at the next loader");

    // Preserves unrelated config.
    assert.equal(config.reactStrictMode, true, "passes through existing Next config");
  });

  test("withNiral preserves a user-supplied webpack hook", () => {
    let called = false;
    const userConfig = {
      webpack(cfg) {
        called = true;
        cfg.__userTouched = true;
        return cfg;
      },
    };
    const config = withNiral(userConfig);
    const out = config.webpack({ module: { rules: [] } }, {});
    assert.ok(called, "the user webpack hook ran");
    assert.equal(out.__userTouched, true, "the user hook's mutation is preserved");
    assert.ok(out.module.rules.some((r) => String(r.test) === String(/\.nrs$/)), "the .nrs rule is still added");
  });
}
