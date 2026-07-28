/**
 * SSR throughput — renders/second for the SAME 1000-row page.
 *   node ssr-bench.js
 * Warms each framework, then times 200 full server renders. Apples-to-apples:
 * identical data, identical markup shape, single Node process.
 */

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { compile as svelteCompile } from "svelte/compiler";
import { readFileSync } from "node:fs";
import { rows } from "./shared.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".ssr-bench");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const items = rows(1000);

const WARMUP = 20;
const RUNS = 200;

function time(name, fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) fn();
  const ms = performance.now() - t0;
  const per = ms / RUNS;
  console.log(`${name.padEnd(8)} ${per.toFixed(2).padStart(6)} ms/render   ${(1000 / per).toFixed(0).padStart(5)} renders/sec`);
  return per;
}

/* ── react ── */
const { renderToString } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { App } = await import("./react/App.js");
renderToString(h(App, { items })).includes("row item number 999") || err("react");

/* ── svelte ── */
{
  const source = readFileSync(join(here, "svelte", "App.svelte"), "utf8");
  const server = svelteCompile(source, { generate: "server", filename: "App.svelte" });
  writeFileSync(join(tmp, "App.server.js"), server.js.code);
  writeFileSync(
    join(tmp, "entry.server.js"),
    `import { render } from "svelte/server";
     import App from "./App.server.js";
     export const out = (items) => render(App, { props: { items } });`
  );
  await esbuild({
    entryPoints: [join(tmp, "entry.server.js")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: join(tmp, "svelte.bundle.mjs"),
  });
}
const svelteRender = (await import(pathToFileURL(join(tmp, "svelte.bundle.mjs")).href)).out;
svelteRender(items).body.includes("row item number 999") || err("svelte");

/* ── niral ── */
const { compileClient } = await import("../../src/compiler/codegen.js");
const { renderComponent } = await import("../../src/server/render.js");
const RUNTIME = pathToFileURL(join(here, "..", "..", "src", "runtime", "index.js")).href;
const src = `<script>
  let { items } = $props
  let clicks = $state(0)
</script>
<h1 on:click={() => clicks++}>Rows {items.length} · clicks {clicks}</h1>
<ul>
  {#for t of items key t.id}
    <li class={t.done ? "done" : ""}>{t.id}: {t.text}</li>
  {/for}
</ul>`;
const { code } = compileClient(src, { filename: "bench.niral", runtime: RUNTIME });
writeFileSync(join(tmp, "niral.component.js"), code);
const Niral = (await import(pathToFileURL(join(tmp, "niral.component.js")).href)).default;
renderComponent(Niral, { items }).includes("row item number 999") || err("niral");

function err(fw) {
  console.error(`${fw}: render sanity check failed`);
  process.exit(1);
}

console.log(`\nSSR throughput — 1000-row page × ${RUNS} renders (after ${WARMUP} warmup)\n`);
// every closure CONSUMES the html (length into a sink) — nothing lazy, nothing elided
let sink = 0;
const react = time("react", () => (sink += renderToString(h(App, { items })).length));
const svelte = time("svelte", () => (sink += svelteRender(items).body.length));
const niral = time("niral", () => (sink += renderComponent(Niral, { items }).length));
if (sink < 0) console.log(sink); // keep the sink alive
console.log(`\nvs react:  niral ${(react / niral).toFixed(2)}×   svelte ${(react / svelte).toFixed(2)}×`);
rmSync(tmp, { recursive: true, force: true });
