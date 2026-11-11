// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * NiralScript → React adapter tests.
 *
 * React itself is NOT a dependency of this repo (zero-dep rule), so these tests
 * exercise the exact contract the `useNrs` hook relies on: the adapter runtime
 * injected into a REAL compiled NiralScript module, driving a simulated
 * useSyncExternalStore subscribe/getSnapshot loop. If this bridge is correct,
 * the hook (a thin React wrapper over it) is correct.
 */

import assert from "node:assert/strict";
import { compileNiralScript as compileStandalone } from "../niralscript/compile.js";
import { createReactRuntime } from "../adapters/react/runtime.js";

async function instantiate(source, props = {}) {
  const output = compileStandalone(source, "counter.nrs", { strictTypes: true });
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const runtime = createReactRuntime();
  const instance = module.createInstance(props, {}, runtime);
  return { runtime, instance };
}

export function registerReactAdapterTests(test) {
  test("React adapter runtime exposes a subscribe/version store over NiralScript state", async () => {
    const source = [
      "state count: number = 0",
      "derive doubled: number = count * 2",
      "export function increment(): number { count += 1; return count }",
    ].join("\n");
    const { runtime, instance } = await instantiate(source);
    const { values } = instance;

    // Simulate what useSyncExternalStore does: snapshot + re-read on notify.
    let renders = 0;
    const startVersion = runtime.getVersion();
    const unsubscribe = runtime.subscribe(() => {
      renders++;
    });

    assert.equal(values.count, 0, "initial reactive read");
    assert.equal(values.doubled, 0, "initial derived read");

    instance.values.increment();
    assert.equal(renders, 1, "a state change notifies exactly one React render");
    assert.equal(values.count, 1, "reactive read reflects new state");
    assert.equal(values.doubled, 2, "derived recomputes after the revision bump");
    assert.ok(runtime.getVersion() > startVersion, "store version advanced on change");

    const before = renders;
    instance.values.increment();
    instance.values.increment();
    assert.equal(renders, before + 2, "each distinct change produces one notification");
    assert.equal(values.count, 3);
    assert.equal(values.doubled, 6);

    unsubscribe();
    instance.values.increment();
    assert.equal(renders, before + 2, "no notifications after unsubscribe");
    assert.equal(values.count, 4, "state still advances; only the listener detached");
  });

  test("React adapter dedupes no-op state writes like the stock runtime", async () => {
    const source = [
      "state value: number = 5",
      "export function setSame(): void { value = 5 }",
      "export function setNew(): void { value = 6 }",
    ].join("\n");
    const { runtime, instance } = await instantiate(source);
    let renders = 0;
    runtime.subscribe(() => renders++);

    instance.values.setSame();
    assert.equal(renders, 0, "Object.is-equal write does not notify");
    instance.values.setNew();
    assert.equal(renders, 1, "a real change notifies");
  });

  test("React adapter flows props into NiralScript input signals via updateInputs", async () => {
    const source = [
      "input initial: number",
      "state offset: number = 0",
      "derive total: number = initial + offset",
      "export function bump(): void { offset += 1 }",
    ].join("\n");
    const { runtime, instance } = await instantiate(source, { initial: 10 });
    let renders = 0;
    runtime.subscribe(() => renders++);
    const { values } = instance;

    assert.equal(values.total, 10, "input seeds the derived total");

    // A React prop change: parent re-renders, effect calls updateInputs.
    instance.updateInputs({ initial: 100 });
    assert.equal(renders, 1, "updating an input notifies subscribers");
    assert.equal(values.total, 100, "derived recomputes from the new input");

    instance.values.bump();
    assert.equal(values.total, 101, "input and local state combine reactively");
  });

  test("React adapter inherits NiralScript's compile-time cycle rejection", async () => {
    const source = [
      "derive self: number = self + 1",
    ].join("\n");
    await assert.rejects(() => instantiate(source), /cycle/i);
  });
}
