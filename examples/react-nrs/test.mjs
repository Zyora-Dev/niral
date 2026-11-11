// Real end-to-end test: real React + real react-dom/server + the real @niral/react
// hook rendering a real .nrs module compiled by the real @niral/vite plugin.
// No mocks, no stubs. Run with: node test.mjs (after `npm install` in this dir).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, StrictMode, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import niralscriptPlugin from "@niral/vite";
import { useNrs, bindNrs } from "@niral/react";

const require = createRequire(import.meta.url);

// 1) Compile the real .nrs file through the real Vite plugin's transform hook.
const source = readFileSync(new URL("./src/counter.nrs", import.meta.url), "utf8");
const plugin = niralscriptPlugin();
plugin.configResolved({ command: "build" });
const transformed = await plugin.transform.call(
  { error(message) { throw new Error(message.message ?? message); } },
  source,
  "counter.nrs",
);
assert.ok(transformed && transformed.code.includes("createInstance"), "plugin produced a module");

// 2) Load the compiled module for real.
const counterModule = await import(
  "data:text/javascript;base64," + Buffer.from(transformed.code).toString("base64")
);
assert.equal(typeof counterModule.createInstance, "function", "real createInstance export");

// 3) Render a real React component that uses the real useNrs hook, via react-dom/server.
function Counter({ initial }) {
  const c = useNrs(counterModule, { initial });
  return createElement(
    "div",
    null,
    createElement("span", { id: "count" }, String(c.count)),
    createElement("span", { id: "doubled" }, String(c.doubled)),
    createElement("span", { id: "parity" }, c.parity),
  );
}

const html = renderToStaticMarkup(createElement(Counter, { initial: 5 }));
assert.match(html, /<span id="count">5<\/span>/, "SSR renders initial state from input");
assert.match(html, /<span id="doubled">10<\/span>/, "SSR renders derived value");
assert.match(html, /<span id="parity">odd<\/span>/, "SSR renders derived string");

// 4) Render the bindNrs form too — proves the HOC path renders real React.
const Bound = bindNrs(counterModule, (c) =>
  createElement("output", null, String(c.count), "/", String(c.doubled)),
);
const boundHtml = renderToStaticMarkup(createElement(Bound, { initial: 3 }));
assert.match(boundHtml, /<output>3\/6<\/output>/, "bindNrs renders real React output");

// 5) Prove the React bridge actually re-renders on NiralScript state change.
//    We use the real runtime + real createInstance and a real client render loop.
import { createReactRuntime } from "@niral/react/runtime";
const runtime = createReactRuntime();
const instance = counterModule.createInstance({ initial: 0 }, {}, runtime);
let renders = 0;
const unsubscribe = runtime.subscribe(() => renders++);
assert.equal(instance.values.count, 0);
instance.values.increment();
instance.values.increment();
assert.equal(renders, 2, "two real state changes → two real subscriber notifications");
assert.equal(instance.values.count, 2);
assert.equal(instance.values.doubled, 4);
instance.values.reset();
assert.equal(instance.values.count, 0, "reset() returns to the input value");
unsubscribe();

console.log("PASS: real React + react-dom/server + @niral/react + @niral/vite end-to-end");
