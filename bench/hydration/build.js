/**
 * Build the head-to-head: identical 1000-row pages for Niral, React, Svelte.
 * Output: dist/<framework>/index.html + assets. Serve with serve.js, measure
 * with the playwright driver (parse-start → framework-reported hydrated).
 *
 *   node build.js && node serve.js
 */

import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { compile as svelteCompile } from "svelte/compiler";
import { rows, shell } from "./shared.js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
const items = rows(1000);
const dataScript = `<script>window.__DATA__ = ${JSON.stringify(items)}</script>`;

/* ── React ─────────────────────────────────────────────────────── */
{
  // client bundle (minified, production react)
  await esbuild({
    entryPoints: [join(here, "react", "client.js")],
    bundle: true,
    minify: true,
    format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
    outfile: join(dist, "react", "app.js"),
  });
  // server render for the initial HTML
  const { renderToString } = await import("react-dom/server");
  const { createElement: h } = await import("react");
  const { App } = await import("./react/App.js");
  const html = renderToString(h(App, { items }));
  writeFileSync(
    join(dist, "react", "index.html"),
    shell("", `<div id="root">${html}</div>\n${dataScript}\n<script type="module" src="./app.js"></script>`)
  );
}

/* ── Svelte 5 ──────────────────────────────────────────────────── */
{
  const source = readFileSync(join(here, "svelte", "App.svelte"), "utf8");
  mkdirSync(join(dist, "svelte", ".build"), { recursive: true });

  // compile both targets
  const client = svelteCompile(source, { generate: "client", filename: "App.svelte" });
  const server = svelteCompile(source, { generate: "server", filename: "App.svelte" });
  writeFileSync(join(dist, "svelte", ".build", "App.client.js"), client.js.code);
  writeFileSync(join(dist, "svelte", ".build", "App.server.js"), server.js.code);
  writeFileSync(
    join(dist, "svelte", ".build", "entry.client.js"),
    `import { hydrate } from "svelte";
     import App from "./App.client.js";
     hydrate(App, { target: document.getElementById("root"), props: { items: window.__DATA__ } });`
  );
  writeFileSync(
    join(dist, "svelte", ".build", "entry.server.js"),
    `import { render } from "svelte/server";
     import App from "./App.server.js";
     export const out = (items) => render(App, { props: { items } });`
  );

  await esbuild({
    entryPoints: [join(dist, "svelte", ".build", "entry.client.js")],
    bundle: true,
    minify: true,
    format: "esm",
    conditions: ["browser"],
    outfile: join(dist, "svelte", "app.js"),
  });
  await esbuild({
    entryPoints: [join(dist, "svelte", ".build", "entry.server.js")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: join(dist, "svelte", ".build", "server.bundle.mjs"),
  });
  const { out } = await import(join(dist, "svelte", ".build", "server.bundle.mjs"));
  const rendered = out(items);
  writeFileSync(
    join(dist, "svelte", "index.html"),
    shell(
      rendered.head ?? "",
      `<div id="root">${rendered.body}</div>\n${dataScript}\n<script type="module" src="./app.js"></script>`
    )
  );
  rmSync(join(dist, "svelte", ".build"), { recursive: true, force: true });
}

/* ── Niral ─────────────────────────────────────────────────────── */
{
  // a real niral project, exported to static files (same pipeline users get)
  const proj = join(dist, ".niral-src");
  mkdirSync(join(proj, "routes"), { recursive: true });
  writeFileSync(
    join(proj, "routes", "index.niral"),
    `<server>
export async function load() {
  return { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: "row item number " + i, done: i % 3 === 0 })) }
}
</server>
<script>
  let { items } = $props
  let list = $state(items)
  let clicks = $state(0)
  if (typeof window !== "undefined") {
    queueMicrotask(() => { window.__hydrated = performance.now() })
  }
</script>
<h1 on:click={() => clicks++}>Rows {list.length} · clicks {clicks}</h1>
<ul>
  {#for t of list key t.id}
    <li class={t.done ? "done" : ""}>{t.id}: {t.text}</li>
  {/for}
</ul>`
  );
  writeFileSync(
    join(proj, "routes", "_shell.html"),
    shell("<!--niral:head-->", "<!--niral:outlet-->")
  );
  const { exportStatic } = await import("../../src/build/export.js");
  await exportStatic({ root: proj, out: join(dist, "niral") });
  rmSync(proj, { recursive: true, force: true });

  // phase-profiling marker: parse→bootStart (HTML+preloads) vs bootStart→hydrated
  const htmlPath = join(dist, "niral", "index.html");
  writeFileSync(
    htmlPath,
    readFileSync(htmlPath, "utf8").replace(
      '<script type="module"',
      '<script>window.__bootStart=performance.now()</script>\n<script type="module"'
    )
  );
}

/* ── report bundle sizes ── */
const sizeOf = (dir) => {
  let total = 0;
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (f.name.endsWith(".js")) total += statSync(join(d, f.name)).size;
    }
  };
  walk(dir);
  return total;
};
for (const fw of ["niral", "react", "svelte"]) {
  console.log(`${fw}: ${(sizeOf(join(dist, fw)) / 1024).toFixed(1)} KB of JS`);
}
console.log("built → bench/hydration/dist");
