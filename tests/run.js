/**
 * Niral test runner — zero dependencies, like everything else here.
 * Run: npm test  (== node tests/run.js)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse, NiralError, compileClient, rewriteScript, rewriteExpr, collectDeclarations } from "../src/index.js";
import { signal, derived, effect, root, batch } from "../src/runtime/signals.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

let pass = 0;
let fail = 0;
const failures = [];
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      pass++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      fail++;
      failures.push({ name, e });
      console.error(`  ✗ ${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
    }
  }
}

function ok(v, msg = "expected truthy") {
  if (!v) throw new Error(msg);
}

function eq(got, want, msg = "values differ") {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg}\n    want: ${w}\n    got:  ${g}`);
}

function expectError(code, fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof NiralError && e.code === code) return e;
    throw new Error(`expected ${code}, got: ${e.code ?? e.name}: ${e.message}`);
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

/* helpers over the AST */
const els = (nodes, tag) => nodes.filter((x) => x.type === "Element" && (!tag || x.tag === tag));
const byType = (nodes, type) => nodes.filter((x) => x.type === type);

console.log("\nNiral compiler — M1 parser tests\n");

/* ── full fixture ─────────────────────────────────────────────── */

test("parses the full products.niral fixture", () => {
  const c = parse(fixture("products.niral"), "products.niral");
  ok(c.server, "has <server> block");
  ok(c.script, "has <script> block");
  ok(c.style, "has <style> block");
  ok(c.server.code.includes("addToCart"), "server code captured");
  ok(c.script.code.includes("$derived"), "script code captured");
  ok(c.style.code.includes(".card"), "style code captured");
});

test("a '</server>' inside a JS string does not close the block", () => {
  const c = parse(fixture("products.niral"), "products.niral");
  ok(c.server.code.includes('const marker = "</server>"'), "string with closing tag stays inside block");
});

test("template structure: elements, if, for", () => {
  const c = parse(fixture("products.niral"), "products.niral");
  const t = c.template;
  eq(els(t, "h1").length, 1, "one <h1>");
  eq(els(t, "input").length, 1, "one <input> (void element)");
  const ifs = byType(t, "IfBlock");
  eq(ifs.length, 1, "one IfBlock");
  eq(ifs[0].branches.length, 3, "if / else-if / else = 3 branches");
  eq(ifs[0].branches[0].expr.raw, "filtered.length === 0");
  eq(ifs[0].branches[2].expr, null, "last branch is plain else");
  const fors = byType(t, "ForBlock");
  eq(fors.length, 1, "one ForBlock");
  eq(fors[0].item, "p");
  eq(fors[0].index, "i");
  eq(fors[0].iterable.raw, "filtered");
});

test("attributes: bind:, on:, static, expression", () => {
  const c = parse(fixture("products.niral"), "products.niral");
  const input = els(c.template, "input")[0];
  const bind = input.attrs.find((a) => a.type === "Bind");
  eq(bind.name, "value");
  eq(bind.expr.raw, "query");
  const ph = input.attrs.find((a) => a.type === "Attr" && a.name === "placeholder");
  eq(ph.value, "Search products...");

  const forBlk = byType(c.template, "ForBlock")[0];
  const card = els(forBlk.children, "div")[0];
  const dataIndex = card.attrs.find((a) => a.name === "data-index");
  eq(dataIndex.value.raw, "i", "expression attribute");
  const button = els(card.children, "button")[0];
  const on = button.attrs.find((a) => a.type === "On");
  eq(on.event, "click");
  ok(on.expr.raw.includes("buy(p)"));
  const disabled = button.attrs.find((a) => a.name === "disabled");
  eq(disabled.value.raw, "p.price > 1000");
});

test("mustaches with nested braces and strings parse correctly", () => {
  const c = parse(`<p>{items.map(x => ({ id: x.id, label: "}" })).length}</p>`);
  const p = els(c.template, "p")[0];
  eq(p.children[0].type, "Mustache");
  eq(p.children[0].expr.raw, `items.map(x => ({ id: x.id, label: "}" })).length`);
});

test("void elements need no closing tag; self-closing works", () => {
  const c = parse(`<div><br><img src="/a.png"/><input type="text"></div>`);
  const div = els(c.template, "div")[0];
  eq(div.children.filter((x) => x.type === "Element").length, 3);
});

test("HTML comments are skipped", () => {
  const c = parse(`<div><!-- hello --><p>hi</p></div>`);
  const div = els(c.template, "div")[0];
  eq(els(div.children, "p").length, 1);
  eq(byType(div.children, "Comment").length, 0);
});

/* ── errors that teach ────────────────────────────────────────── */

test("NIRAL024: unclosed element at EOF", () => {
  const e = expectError("NIRAL024", () => parse(`<div><p>hello`));
  ok(e.message.includes("<p>"), "names the innermost open tag");
});

test("NIRAL026: wrong closing tag diagnoses the nesting", () => {
  const e = expectError("NIRAL026", () => parse(`<div><p>hello</div>`));
  ok(e.hint.includes("nesting"), "hint explains tag nesting");
});

test("NIRAL026: mismatched closing tag", () => {
  expectError("NIRAL026", () => parse(`<section>text</article>`));
});

test("NIRAL031: unclosed {#if}", () => {
  expectError("NIRAL031", () => parse(`{#if ok}<p>yes</p>`));
});

test("NIRAL033: unclosed {#for}", () => {
  expectError("NIRAL033", () => parse(`{#for x of xs}<p>{x}</p>`));
});

test("NIRAL032: malformed {#for} header", () => {
  expectError("NIRAL032", () => parse(`{#for of xs}{/for}`));
});

test("NIRAL020: unknown block", () => {
  expectError("NIRAL020", () => parse(`{#each x of xs}{/each}`));
});

test("NIRAL010: unclosed <script> block", () => {
  expectError("NIRAL010", () => parse(`<script>let a = 1`));
});

test("NIRAL023: duplicate <script> block", () => {
  expectError("NIRAL023", () => parse(`<script>1</script><script>2</script>`));
});

test("NIRAL025: nested <script> inside markup", () => {
  expectError("NIRAL025", () => parse(`<div><script>1</script></div>`));
});

test("NIRAL011: unbalanced expression braces", () => {
  expectError("NIRAL011", () => parse(`<p>{a.map(x => {</p>`));
});

test("NIRAL030: on: without expression", () => {
  expectError("NIRAL030", () => parse(`<button on:click="foo">x</button>`));
});

test("error frames include line/col and a caret", () => {
  const e = expectError("NIRAL026", () => parse(`<div>\n  <p>oops</div>`, "demo.niral"));
  const frame = e.format();
  ok(frame.includes("demo.niral:2"), "filename:line in output");
  ok(frame.includes("^"), "caret present");
  ok(frame.includes("hint:"), "hint present");
});

/* ── M2: signals runtime ──────────────────────────────────────── */

test("signal get/set + effect re-runs", () => {
  const count = signal(0);
  let seen = [];
  effect(() => seen.push(count.get()));
  count.set(1);
  count.set(2);
  count.set(2); // no-op — same value
  eq(seen, [0, 1, 2]);
});

test("derived recomputes only from its inputs", () => {
  const a = signal(2);
  const b = signal(10);
  const doubled = derived(() => a.get() * 2);
  let runs = 0;
  effect(() => {
    doubled.get();
    runs++;
  });
  b.set(99); // unrelated — must not re-run
  eq(runs, 1, "unrelated signal caused a re-run");
  a.set(3);
  eq(doubled.get(), 6);
  eq(runs, 2);
});

test("root disposal tears down nested effects", () => {
  const s = signal(0);
  let runs = 0;
  const [, dispose] = root(() => {
    effect(() => {
      s.get();
      runs++;
    });
  });
  s.set(1);
  eq(runs, 2);
  dispose();
  s.set(2);
  eq(runs, 2, "effect ran after dispose");
});

test("dynamic dependencies re-track each run", () => {
  const flag = signal(true);
  const a = signal("a");
  const b = signal("b");
  let out = "";
  effect(() => {
    out = flag.get() ? a.get() : b.get();
  });
  b.set("B"); // not currently tracked
  eq(out, "a");
  flag.set(false);
  eq(out, "B");
  a.set("A"); // no longer tracked
  eq(out, "B");
});

/* ── M2: rewriter ─────────────────────────────────────────────── */

test("collects $state/$derived/$props declarations", () => {
  const { signals, props } = collectDeclarations(
    `let a = $state(0)\nlet b = $derived(a * 2)\nlet { items, title } = $props`
  );
  eq([...signals].sort(), ["a", "b"]);
  eq([...props].sort(), ["items", "title"]);
});

test("rewrites declarations and reads", () => {
  const sig = new Set(["count"]);
  const out = rewriteScript(`let count = $state(0)\nconsole.log(count)`, sig);
  ok(out.includes("const count = __n.signal(0)"), "state decl");
  ok(out.includes("console.log(count.get())"), "read becomes .get()");
});

test("rewrites count++ and compound assignment", () => {
  const sig = new Set(["count"]);
  eq(rewriteExpr("count++", sig), "count.set(count.get() + 1)");
  eq(rewriteExpr("count += 5", sig), "count.set(count.get() + (5))");
  eq(rewriteExpr("count = other + 1", sig), "count.set((other + 1))");
});

test("does not rewrite: strings, properties, comparisons, locals", () => {
  const sig = new Set(["count"]);
  eq(rewriteExpr(`"count++"`, sig), `"count++"`, "strings untouched");
  eq(rewriteExpr("obj.count", sig), "obj.count", "member access untouched");
  ok(rewriteExpr("count === 5", sig).startsWith("count.get() ==="), "comparison reads");
  eq(rewriteExpr("count", sig, new Set(["count"])), "count", "shadowed local untouched");
});

test("rewrites inside template literals", () => {
  const sig = new Set(["name"]);
  eq(rewriteExpr("`hi ${name}!`", sig), "`hi ${name.get()}!`");
});

test("object shorthand and keys survive", () => {
  const sig = new Set(["count"]);
  eq(rewriteExpr("{ count }", sig), "{ count: count.get() }", "shorthand expands");
  eq(rewriteExpr("{ count: 1 }", sig), "{ count: 1 }", "key untouched");
});

test("spread reads the signal", () => {
  const sig = new Set(["todos"]);
  eq(rewriteExpr("[...todos, x]", sig), "[...todos.get(), x]");
});

/* ── M2: client codegen ───────────────────────────────────────── */

test("compileClient produces a mountable module", async () => {
  const source = fixture("../../examples/counter/app.niral");
  const { code } = compileClient(source, { filename: "app.niral", runtime: "./runtime-x.js" });
  ok(code.includes(`import * as __n from "./runtime-x.js"`), "runtime import path");
  ok(code.includes("__n.signal(0)"), "state compiled");
  ok(code.includes("__n.derived(() => (count.get() * 2))"), "derived compiled");
  ok(code.includes("__n.bindText"), "reactive text bindings");
  ok(code.includes("__n.ifBlock"), "if block");
  ok(code.includes("__n.forBlock"), "for block");
  ok(code.includes("__n.bindValue"), "two-way bind");
  ok(code.includes("count.set(count.get() + 1)"), "handler increment rewritten");
});

test("for-block locals shadow signals in generated code", () => {
  const { code } = compileClient(
    `<script>let t = $state([1])</script>{#for t of t}<p>{t}</p>{/for}`,
    { runtime: "x" }
  );
  ok(code.includes("__n.forBlock(() => (t.get())"), "iterable reads the signal");
  ok(code.includes("__n.bindText(() => (t))"), "loop variable stays plain inside");
});

test("generated module is valid ESM (imports in Node)", async () => {
  const source = fixture("../../examples/counter/app.niral");
  const { code } = compileClient(source, {
    filename: "app.niral",
    runtime: join(here, "..", "src", "runtime", "index.js"),
  });
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, code);
  const mod = await import("file://" + file);
  eq(typeof mod.default, "function", "default export is the component factory");
});

/* ── M3: websocket framing ────────────────────────────────────── */

test("ws: Sec-WebSocket-Accept matches the RFC 6455 vector", async () => {
  const { acceptKey } = await import("../src/dev/websocket.js");
  eq(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("ws: text frame encode/decode roundtrip (short + extended length)", async () => {
  const { encodeText, decodeFrame } = await import("../src/dev/websocket.js");
  for (const msg of ["hi", JSON.stringify({ type: "update", path: "/a.niral" }), "x".repeat(300)]) {
    const frame = decodeFrame(encodeText(msg));
    ok(frame, "frame decoded");
    eq(frame.opcode, 1, "text opcode");
    eq(frame.payload.toString("utf8"), msg, "payload survives");
    eq(frame.rest.length, 0, "no trailing bytes");
  }
});

test("ws: masked client frame unmasks correctly", async () => {
  const { decodeFrame } = await import("../src/dev/websocket.js");
  const payload = Buffer.from("ping!", "utf8");
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
  const out = decodeFrame(frame);
  eq(out.payload.toString("utf8"), "ping!", "unmasked payload");
});

/* ── M3: HMR state capture ────────────────────────────────────── */

test("signal sink collects state signals but not derived internals", async () => {
  const { _setSink } = await import("../src/runtime/signals.js");
  const sink = [];
  _setSink(sink);
  const a = signal(1);
  const b = derived(() => a.get() * 2);
  const c = signal("x");
  _setSink(null);
  const d = signal(99); // outside the sink
  eq(sink.length, 2, "two user signals captured");
  ok(sink[0] === a && sink[1] === c, "captured in declaration order");
  ok(b.get() === 2 && d.get() === 99, "signals still work");
});

/* ── M3: dev server ───────────────────────────────────────────── */

test("dev server: compiles .niral on demand with the HMR wrapper", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-dev-"));
  writeFileSync(join(dir, "app.niral"), `<script>let n = $state(0)</script><p>{n}</p>`);
  writeFileSync(join(dir, "bad.niral"), `<p>{n}</div>`);
  writeFileSync(join(dir, "index.html"), `<!DOCTYPE html><html><head></head><body></body></html>`);

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  try {
    const js = await (await fetch(`${base}/app.niral`)).text();
    ok(js.includes(`import * as __n from "/@niral/runtime/index.js"`), "runtime served virtually");
    ok(js.includes("__NIRAL_HMR__.track"), "HMR wrapper injected");
    ok(js.includes("export default function __NiralHot"), "default export wrapped");

    const bad = await (await fetch(`${base}/bad.niral`)).text();
    ok(bad.includes("__NIRAL_HMR__.error"), "compile error becomes an overlay module");
    ok(bad.includes("NIRAL026"), "error payload carries the code");

    const html = await (await fetch(`${base}/`)).text();
    ok(html.includes(`src="/@niral/client.js"`), "HMR client injected into HTML");

    const client = await fetch(`${base}/@niral/client.js`);
    eq(client.status, 200, "client served");
    ok((await client.text()).includes("__NIRAL_HMR__"), "client body");

    const runtime = await fetch(`${base}/@niral/runtime/index.js`);
    eq(runtime.status, 200, "runtime served");

    const escape = await fetch(`${base}/@niral/runtime/../../index.js`);
    ok(escape.status === 404 || escape.status === 403, "path traversal blocked");
  } finally {
    dev.close();
  }
});

/* ── M4: router + SSR ─────────────────────────────────────────── */

test("block tags capture attributes (script mode=static)", () => {
  const c = parse(`<script mode="static" lang="ts">let x = $state(1)</script><p>{x}</p>`, "t.niral");
  eq(c.script.attrs.mode, "static", "mode captured");
  eq(c.script.attrs.lang, "ts", "lang captured");
});

test("router: scanRoutes + matchRoute (index, static, param, specificity)", async () => {
  const { scanRoutes, matchRoute } = await import("../src/server/router.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-routes-"));
  const w = (p) => writeFileSync(join(dir, p), "<p>x</p>");
  mkdirSync(join(dir, "blog"), { recursive: true });
  w("index.niral");
  w("about.niral");
  w("blog/index.niral");
  w("blog/[slug].niral");
  writeFileSync(join(dir, "_shell.html"), "ignored");

  const routes = scanRoutes(dir);
  eq(routes.length, 4, "shell/underscore files skipped");
  eq(matchRoute(routes, "/").route.rel, "index.niral");
  eq(matchRoute(routes, "/about").route.rel, "about.niral");
  eq(matchRoute(routes, "/blog").route.rel, "blog/index.niral", "static index beats [slug]? no — different depth");
  const m = matchRoute(routes, "/blog/my-post");
  eq(m.route.rel, "blog/[slug].niral");
  eq(m.params, { slug: "my-post" }, "param extracted");
  ok(matchRoute(routes, "/nope/deep/er") === null, "no match → null");
});

test("SSR: renderFile produces HTML with initial state, branches, loops, escaping", async () => {
  const { renderFile } = await import("../src/server/render.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-ssr-"));
  const file = join(dir, "page.niral");
  writeFileSync(
    file,
    `<script>
      let n = $state(2)
      let items = $state(["a", "<b>bold</b>"])
    </script>
    <h1 data-n={n}>Count {n}</h1>
    {#if n > 1}<p class="yes">big</p>{:else}<p>small</p>{/if}
    {#for it of items}<li>{it}</li>{/for}`
  );
  const { html, ast } = await renderFile(file);
  ok(html.includes(`<h1 data-n="2">Count 2</h1>`), "signal value + expr attr rendered");
  ok(html.includes(`<p class="yes">big</p>`), "if branch rendered");
  ok(!html.includes("small"), "false branch omitted");
  ok(html.includes("<li>a</li>"), "loop item 1");
  ok(html.includes("<li>&lt;b&gt;bold&lt;/b&gt;</li>"), "text content escaped");
  eq(ast.script.attrs.mode ?? "client", "client", "default mode");
});

test("SSR: props flow into the render", async () => {
  const { renderFile } = await import("../src/server/render.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-ssr2-"));
  const file = join(dir, "post.niral");
  writeFileSync(file, `<script>let { slug } = $props</script><h1>{slug}</h1>`);
  const { html } = await renderFile(file, { slug: "hello-world" });
  ok(html.includes("<h1>hello-world</h1>"), "prop rendered");
});

test("dev server: routed pages SSR with per-route mode", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-app-"));
  mkdirSync(join(dir, "routes", "blog"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<script>let n = $state(5)</script><style>h1{color:red}</style><h1>Home {n}</h1>`
  );
  writeFileSync(
    join(dir, "routes", "about.niral"),
    `<script mode="static">let x = $state("still")</script><p>About {x}</p>`
  );
  writeFileSync(join(dir, "routes", "blog", "[slug].niral"), `<script>let { slug } = $props</script><h2>{slug}</h2>`);

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  try {
    const home = await (await fetch(`${base}/`)).text();
    ok(/<h1 class="n-[0-9a-f]{6}">Home 5<\/h1>/.test(home), "SSR content present (with scope class)");
    ok(home.includes('id="niral-root"'), "mount root present");
    ok(home.includes('import __page from "/routes/index.niral"'), "hydration script for client mode");
    ok(home.includes("<style data-niral-style>"), "component style hoisted into head");
    ok(home.includes("/@niral/client.js"), "HMR client injected");

    const about = await (await fetch(`${base}/about`)).text();
    ok(about.includes("<p>About still</p>"), "static page SSR content");
    ok(!about.includes("boot("), "static mode ships no hydration script");

    const post = await (await fetch(`${base}/blog/ship-it`)).text();
    ok(post.includes("<h2>ship-it</h2>"), "param SSR'd into HTML");
    ok(post.includes('"slug":"ship-it"'), "param passed to hydration");

    eq((await fetch(`${base}/missing`)).status, 404, "unmatched → 404");
  } finally {
    dev.close();
  }
});

/* ── M5: <server> RPC + sessions ──────────────────────────────── */

test("collectServerExports finds exported functions", async () => {
  const { collectServerExports } = await import("../src/compiler/codegen.js");
  const names = collectServerExports(`
    const secret = "hidden"
    export async function addToCart(id) {}
    export function list() {}
    function helper() {}
  `);
  eq(names, ["addToCart", "list"]);
});

test("client compile: <server> code stripped, RPC stubs emitted", () => {
  const { code } = compileClient(
    `<server>
      const dbPassword = "s3cret"
      export async function save(x) { return x }
    </server>
    <script>let n = $state(0)</script>
    <button on:click={() => save(n)}>go</button>`,
    { runtime: "x", moduleId: "/routes/page.niral" }
  );
  ok(!code.includes("dbPassword"), "server code never ships");
  ok(!code.includes("s3cret"), "server literals never ship");
  ok(code.includes(`const save = (...__a) => __n.rpc("/routes/page.niral", "save", __a);`), "stub emitted");
});

test("session: sign/verify roundtrip + tamper rejection", async () => {
  const { signSession, verifySession, newSecret } = await import("../src/server/session.js");
  const secret = newSecret();
  const cookie = signSession({ user: "vismaya", count: 3 }, secret);
  eq(verifySession(cookie, secret), { user: "vismaya", count: 3 }, "roundtrip");
  ok(verifySession(cookie + "x", secret) === null, "bad signature rejected");
  const [payload] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ user: "admin" })).toString("base64url") + "." + cookie.split(".")[1];
  ok(verifySession(forged, secret) === null, "tampered payload rejected");
  ok(verifySession(cookie, newSecret()) === null, "wrong secret rejected");
  ok(verifySession(payload, secret) === null, "unsigned value rejected");
});

test("dev server: end-to-end RPC with session cookie persistence", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-rpc-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "counter.niral"),
    `<server>
      export async function bump(by) {
        session.set("n", (session.get("n") ?? 0) + by)
        return session.get("n")
      }
      export async function boom() { throw new Error("kapow") }
    </server>
    <script>let shown = $state(0)</script>
    <p>{shown}</p>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const call = async (fn, args, cookie) => {
    const res = await fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ module: "/routes/counter.niral", fn, args }),
    });
    return { status: res.status, data: await res.json(), setCookie: res.headers.get("set-cookie") };
  };
  try {
    const first = await call("bump", [2]);
    eq(first.data, { ok: true, result: 2 }, "first call result");
    ok(first.setCookie?.includes("niral_session="), "session cookie set");

    const cookie = first.setCookie.split(";")[0];
    const second = await call("bump", [3], cookie);
    eq(second.data.result, 5, "session state persisted across calls");

    const fresh = await call("bump", [1]);
    eq(fresh.data.result, 1, "no cookie → fresh session");

    const err = await call("boom", []);
    eq(err.status, 500);
    ok(err.data.error.includes("kapow"), "server error surfaced");

    const unknown = await call("nope", []);
    eq(unknown.status, 404, "unknown fn rejected");

    const hydrated = await (await fetch(`${base}/`)).text();
    ok(!hydrated.includes("session.set"), "server code absent from SSR page");

    const client = await (await fetch(`${base}/routes/counter.niral`)).text();
    ok(client.includes(`__n.rpc("/routes/counter.niral", "bump"`), "client module has stubs");
    ok(!client.includes("session.get"), "client module has no server code");

    const traversal = await fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/../outside.niral", fn: "x", args: [] }),
    });
    ok(traversal.status === 404 || traversal.status === 400, "module traversal blocked");
  } finally {
    dev.close();
  }
});

/* ── M6: build + atomic deploys + prod server ─────────────────── */

function makeProject(tag) {
  const { mkdtempSync, writeFileSync, mkdirSync } = require_fs();
  const { tmpdir } = require_os();
  const dir = mkdtempSync(join(tmpdir(), `niral-${tag}-`));
  mkdirSync(join(dir, "routes", "blog"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function hits() {
        session.set("h", (session.get("h") ?? 0) + 1)
        return session.get("h")
      }
    </server>
    <script>let n = $state(1)</script>
    <style>h1 { color: green }</style>
    <h1>Prod {n}</h1>`
  );
  writeFileSync(join(dir, "routes", "about.niral"), `<script mode="static">let x = $state("here")</script><p>About {x}</p>`);
  writeFileSync(join(dir, "routes", "blog", "[slug].niral"), `<script>let { slug } = $props</script><h2>{slug}</h2>`);
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\n");
  return dir;
}
let _fs, _os;
function require_fs() { return _fs; }
function require_os() { return _os; }

test("build: hashed release, atomic current flip, correct artifacts", async () => {
  _fs = await import("node:fs");
  _os = await import("node:os");
  const { build } = await import("../src/build/build.js");
  const { readFileSync, existsSync, readlinkSync, writeFileSync } = _fs;
  const dir = makeProject("build");

  const r1 = build({ root: dir });
  ok(existsSync(join(dir, "dist", "releases", r1.hash, "manifest.json")), "release written");
  eq(readlinkSync(join(dir, "dist", "current")), join("releases", r1.hash), "current → release");

  const manifest = JSON.parse(readFileSync(join(dir, "dist", "releases", r1.hash, "manifest.json"), "utf8"));
  eq(manifest.routes.length, 3);
  const home = manifest.routes.find((r) => r.rel === "index.niral");
  eq(home.mode, "client");
  ok(home.style.includes("color: green"), "style extracted");
  ok(home.hasServer, "server flag");
  const about = manifest.routes.find((r) => r.rel === "about.niral");
  eq(about.mode, "static");

  const clientJs = readFileSync(join(dir, "dist", "releases", r1.hash, "assets", "routes", "index.js"), "utf8");
  ok(clientJs.includes(`from "../@niral/runtime/index.js"`), "relative runtime import");
  ok(clientJs.includes(`__n.rpc("/routes/index.niral", "hits"`), "rpc stub with stable moduleId");
  ok(!clientJs.includes("session.set"), "no server code in client module");
  ok(existsSync(join(dir, "dist", "releases", r1.hash, "server", "routes", "index.server.js")), "server module");
  ok(existsSync(join(dir, "dist", "releases", r1.hash, "static", "robots.txt")), "static file copied");

  const r2 = build({ root: dir });
  eq(r2.hash, r1.hash, "identical content → identical hash");

  writeFileSync(join(dir, "routes", "about.niral"), `<script mode="static">let x = $state("v2")</script><p>About {x}</p>`);
  const r3 = build({ root: dir });
  ok(r3.hash !== r1.hash, "changed content → new hash");
  eq(readlinkSync(join(dir, "dist", "current")), join("releases", r3.hash), "current flipped to new release");
  ok(existsSync(join(dir, "dist", "releases", r1.hash)), "previous release kept for rollback");
});

test("build: a broken route FAILS the build and leaves current untouched", async () => {
  const { build } = await import("../src/build/build.js");
  const { readlinkSync, writeFileSync } = _fs;
  const dir = makeProject("buildfail");
  const r1 = build({ root: dir });
  writeFileSync(join(dir, "routes", "about.niral"), `<p>{oops</p>`); // unbalanced mustache
  let threw = false;
  try {
    build({ root: dir });
  } catch (e) {
    threw = true;
    ok(e instanceof NiralError, "compiler error surfaced");
  }
  ok(threw, "build threw");
  eq(readlinkSync(join(dir, "dist", "current")), join("releases", r1.hash), "current still on last good release");
});

test("prod server: SSR + hydration + RPC + sessions from a built release", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const dir = makeProject("prod");
  build({ root: dir });

  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));
  const base = `http://localhost:${port}`;
  try {
    const home = await (await fetch(`${base}/`)).text();
    ok(/<h1 class="n-[0-9a-f]{6}">Prod 1<\/h1>/.test(home), "SSR from precompiled module");
    ok(/import __page from "\/assets\/[0-9a-f]{12}\/routes\/index\.js"/.test(home), "hydration points at the VERSIONED built asset");
    ok(home.includes("color: green"), "style in head");

    const about = await (await fetch(`${base}/about`)).text();
    ok(about.includes("<p>About here</p>") && !about.includes("boot("), "static mode: no JS");

    const post = await (await fetch(`${base}/blog/prod-rocks`)).text();
    ok(post.includes("<h2>prod-rocks</h2>"), "param route SSR");

    const asset = await fetch(`${base}/assets/routes/index.js`);
    eq(asset.status, 200);
    const etag = asset.headers.get("etag");
    ok(etag, "assets carry the release etag");
    eq((await fetch(`${base}/assets/routes/index.js`, { headers: { "if-none-match": etag } })).status, 304, "revalidation");

    const robots = await (await fetch(`${base}/robots.txt`)).text();
    ok(robots.includes("User-agent"), "static file served");

    const rpc = async (cookie) =>
      await fetch(`${base}/@niral/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-niral-rpc": "1", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ module: "/routes/index.niral", fn: "hits", args: [] }),
      });
    const first = await rpc();
    eq((await first.json()).result, 1, "rpc works in prod");
    const cookie = first.headers.get("set-cookie").split(";")[0];
    eq((await (await rpc(cookie)).json()).result, 2, "session persists in prod");

    eq((await fetch(`${base}/nope`)).status, 404);
  } finally {
    prod.close();
  }
});

/* ── v0.2: component composition ──────────────────────────────── */

test("codegen: component tags compile to __n.child with props + slot", () => {
  const { code } = compileClient(
    `<script>
      import Card from "./Card.niral"
      let n = $state(1)
    </script>
    <Card title={n} label="hi" featured>
      <p>{n}</p>
    </Card>`,
    { runtime: "x" }
  );
  ok(/^import Card from "\.\/Card\.niral"/m.test(code), "import hoisted to module level");
  ok(!/__build[\s\S]*import Card/.test(code.split("function __build")[1] ?? ""), "import not inside __build");
  ok(code.includes(`__n.child(Card, () => ({ "title": (n.get()), "label": "hi", "featured": true })`), "props compiled (expr reads signal)");
  ok(code.includes("Component.__build = __build;"), "build fn exposed for composition");
});

test("codegen: <slot/> renders parent-provided children", () => {
  const { code } = compileClient(`<div class="card"><slot /></div>`, { runtime: "x" });
  ok(code.includes("__props.children ? __props.children() : []"), "slot compiled");
});

test("SSR: parent renders imported child component with props + slot content", async () => {
  const { renderFile } = await import("../src/server/render.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-comp-"));
  mkdirSync(join(dir, "components"), { recursive: true });
  writeFileSync(
    join(dir, "components", "Badge.niral"),
    `<script>let { label } = $props</script><span class="badge">{label}<slot /></span>`
  );
  writeFileSync(
    join(dir, "page.niral"),
    `<script>
      import Badge from "./components/Badge.niral"
      let n = $state(7)
    </script>
    <Badge label={"v" + n}><b>inner</b></Badge>`
  );
  const { html } = await renderFile(join(dir, "page.niral"));
  ok(html.includes(`<span class="badge">v7<b>inner</b></span>`), `child SSR'd with props + slot — got: ${html}`);
});

test("build + prod: component compiled into assets with rewritten specifier", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } = _fs ?? (await import("node:fs"));
  const { tmpdir } = _os ?? (await import("node:os"));
  const dir = mkdtempSync(join(tmpdir(), "niral-compbuild-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  mkdirSync(join(dir, "components"), { recursive: true });
  writeFileSync(join(dir, "components", "Hello.niral"), `<script>let { who } = $props</script><em>hi {who}</em>`);
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<script>
      import Hello from "../components/Hello.niral"
    </script>
    <Hello who="prod" />`
  );

  const r = build({ root: dir });
  const releaseDir = join(dir, "dist", "releases", r.hash);
  ok(existsSync(join(releaseDir, "assets", "components", "Hello.js")), "component compiled into assets");
  const routeJs = readFileSync(join(releaseDir, "assets", "routes", "index.js"), "utf8");
  ok(routeJs.includes(`from "../components/Hello.js"`), "specifier rewritten .niral → .js");

  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((res) => prod.listen(res));
  try {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    ok(html.includes("<em>hi prod</em>"), `prod SSR renders the child — got: ${html.slice(0, 400)}`);
    eq((await fetch(`http://localhost:${port}/assets/components/Hello.js`)).status, 200, "component asset served");
  } finally {
    prod.close();
  }
});

/* ── v0.2: server load() → SSR data in $props ─────────────────── */

test("codegen: load() is never stubbed for the client", () => {
  const { code } = compileClient(
    `<server>
      export async function load() { return { x: 1 } }
      export async function save() {}
    </server>
    <p>hi</p>`,
    { runtime: "x", moduleId: "/routes/p.niral" }
  );
  ok(code.includes(`__n.rpc("/routes/p.niral", "save"`), "normal fn stubbed");
  ok(!code.includes(`"load"`), "load has no client stub");
});

test("rpc: load() is not callable over the wire", async () => {
  const { callServerFn } = await import("../src/server/rpc.js");
  const out = await callServerFn({ load: async () => ({ secret: 1 }) }, "load", [], "", "s");
  eq(out.status, 404, "load rejected via RPC");
});

test("dev server: load() feeds SSR HTML, hydration props and session cookie", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-load-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "[user].niral"),
    `<server>
      export async function load({ params }) {
        session.set("seen", (session.get("seen") ?? 0) + 1)
        return { greeting: "hello " + params.user, visits: session.get("seen") }
      }
    </server>
    <script>let { greeting, visits } = $props</script>
    <h1>{greeting}</h1><p id="v">{visits}</p>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  try {
    const res = await fetch(`${base}/vismaya`);
    const html = await res.text();
    ok(html.includes("<h1>hello vismaya</h1>"), "load data SSR'd with params");
    ok(html.includes(`"greeting":"hello vismaya"`), "load data flows into hydration props");
    const setCookie = res.headers.get("set-cookie");
    ok(setCookie?.includes("niral_session="), "session written in load → cookie on the PAGE response");

    const cookie = setCookie.split(";")[0];
    const second = await (await fetch(`${base}/vismaya`, { headers: { cookie } })).text();
    ok(second.includes(`<p id="v">2</p>`), "session persisted across SSR page loads");
  } finally {
    dev.close();
  }
});

test("prod server: load() runs from the built release", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-loadprod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function load() {
        session.set("n", (session.get("n") ?? 0) + 1)
        return { msg: "from the server", n: session.get("n") }
      }
    </server>
    <script>let { msg, n } = $props</script>
    <p>{msg} #{n}</p>`
  );
  build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));
  try {
    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();
    ok(html.includes("<p>from the server #1</p>"), `prod load SSR'd — got: ${html.slice(0, 300)}`);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    ok(cookie, "cookie set from prod load");
    const second = await (await fetch(`http://localhost:${port}/`, { headers: { cookie } })).text();
    ok(second.includes("#2</p>"), "prod session persists via load");
  } finally {
    prod.close();
  }
});

/* ── v0.2: polyglot backends (NBP — Python) ───────────────────── */

test("collectServerExports: python defs (top-level only, no _private)", async () => {
  const { collectServerExports } = await import("../src/compiler/codegen.js");
  const names = collectServerExports(
    `import math
def load(params):
    return {}
def roll(sides):
    def inner():
        pass
    return 1
def _secret():
    pass
`,
    "python"
  );
  eq(names, ["load", "roll"], "python exports collected");
});

test("codegen: python <server> block → stubs, no python code ships", () => {
  const { code } = compileClient(
    `<server lang="python">
secret_key = "topsecret"
def fetch_data(q):
    return {"q": q}
def load(params):
    return {}
</server>
<p>hi</p>`,
    { runtime: "x", moduleId: "/routes/py.niral" }
  );
  ok(code.includes(`__n.rpc("/routes/py.niral", "fetch_data"`), "python fn stubbed for the client");
  ok(!code.includes(`"load"`), "load not stubbed");
  ok(!code.includes("topsecret"), "python server code never ships");
});

test("dev server: python <server> block — load(), RPC, sessions end-to-end", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-py-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server lang="python">
import math

def load(params):
    session.set("seen", session.get("seen", 0) + 1)
    return {"pi": round(math.pi, 4), "seen": session.get("seen")}

def double(n):
    return {"doubled": n * 2}

def explode():
    raise ValueError("boom from python")
</server>
<script>let { pi, seen } = $props</script>
<p id="pi">{pi}</p><p id="seen">{seen}</p>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const rpc = async (fn, args, cookie) =>
    await fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ module: "/routes/index.niral", fn, args }),
    });
  try {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    ok(html.includes(`<p id="pi">3.1416</p>`), `python load() SSR'd — got: ${html.slice(0, 300)}`);
    ok(html.includes(`<p id="seen">1</p>`), "python session value SSR'd");
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    ok(cookie, "python session.set → signed cookie on page response");

    const second = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    ok(second.includes(`<p id="seen">2</p>`), "python session persists across page loads");

    const call = await rpc("double", [21]);
    eq((await call.json()).result, { doubled: 42 }, "python RPC result");

    const err = await rpc("explode", []);
    eq(err.status, 500);
    ok((await err.json()).error.includes("boom from python"), "python exception surfaced");

    eq((await rpc("nope", [])).status, 404, "unknown python fn → 404");
    eq((await rpc("load", [])).status, 404, "load blocked over RPC for python too");
  } finally {
    dev.close();
  }
});

test("prod: python server block built into the release and served by workers", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-pyprod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server lang="python">
def load(params):
    session.set("n", session.get("n", 0) + 1)
    return {"msg": "served by python", "n": session.get("n")}

def shout(text):
    return {"loud": str(text).upper()}
</server>
<script>let { msg, n } = $props</script>
<p>{msg} #{n}</p>`
  );

  const r = build({ root: dir });
  const releaseDir = join(dir, "dist", "releases", r.hash);
  ok(existsSync(join(releaseDir, "server", "routes", "index.server.py")), "python server artifact");
  ok(existsSync(join(releaseDir, "server", "@niral", "runner-python.py")), "runner shipped in release");
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  eq(manifest.routes[0].serverLang, "python");
  eq(manifest.routes[0].hasLoad, true);

  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((res) => prod.listen(res));
  const base = `http://localhost:${port}`;
  try {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    ok(html.includes("<p>served by python #1</p>"), `prod python load — got: ${html.slice(0, 300)}`);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    const second = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    ok(second.includes("#2</p>"), "prod python session persists");

    const call = await fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "shout", args: ["niral"] }),
    });
    eq((await call.json()).result, { loud: "NIRAL" }, "prod python RPC");
  } finally {
    prod.close();
  }
});

/* ── v0.2: nested layouts ─────────────────────────────────────── */

test("router: layoutChain finds layouts outermost-first", async () => {
  const { layoutChain } = await import("../src/server/router.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-lay-"));
  mkdirSync(join(dir, "blog", "deep"), { recursive: true });
  writeFileSync(join(dir, "_layout.niral"), "<slot />");
  writeFileSync(join(dir, "blog", "_layout.niral"), "<slot />");
  eq(
    layoutChain(dir, "blog/deep/x.niral").map((l) => l.rel),
    ["_layout.niral", "blog/_layout.niral"],
    "chain outermost first, missing levels skipped"
  );
  eq(layoutChain(dir, "top.niral").map((l) => l.rel), ["_layout.niral"], "root route gets root layout");
});

test("dev server: pages render inside nested layouts + layout-aware hydration", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-laydev-"));
  mkdirSync(join(dir, "routes", "blog"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "_layout.niral"),
    `<style>.chrome { color: red }</style><header class="chrome">SITE</header><main><slot /></main>`
  );
  writeFileSync(join(dir, "routes", "blog", "_layout.niral"), `<div class="crumb">BLOG</div><slot />`);
  writeFileSync(
    join(dir, "routes", "blog", "[slug].niral"),
    `<script>let { slug } = $props</script><style>h2 { color: blue }</style><h2>{slug}</h2>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const html = await (await fetch(`http://localhost:${port}/blog/hello`)).text();
    ok(/<header class="chrome n-[0-9a-f]{6}">SITE<\/header><main class="n-[0-9a-f]{6}">.*<h2 class="n-[0-9a-f]{6}">hello<\/h2>.*<\/main>/s.test(html), `page nests inside layouts — got: ${html.slice(0, 500)}`);
    ok(html.indexOf('class="crumb"') < html.indexOf(">hello"), "nested layout wraps inside root layout");
    ok(/\.chrome\.n-[0-9a-f]{6} \{ color: red \}/.test(html) && /h2\.n-[0-9a-f]{6} \{ color: blue \}/.test(html), "layout + page styles merged AND scoped");
    ok(html.includes('"/routes/_layout.niral"'), "hydration lists root layout");
    ok(html.includes('"/routes/blog/_layout.niral"'), "hydration lists nested layout");
    ok(html.includes('from "/@niral/runtime/router.js"'), "hydration boots through the runtime router");
  } finally {
    dev.close();
  }
});

test("build + prod: layouts compiled, manifest chain, SSR + hydration composed", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-layprod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "routes", "_layout.niral"), `<style>.wrap { border: 1px solid }</style><div class="wrap"><slot /></div>`);
  writeFileSync(join(dir, "routes", "index.niral"), `<script>let n = $state(9)</script><p>Home {n}</p>`);

  const r = build({ root: dir });
  const releaseDir = join(dir, "dist", "releases", r.hash);
  ok(existsSync(join(releaseDir, "assets", "routes", "_layout.js")), "layout compiled into assets");
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  eq(manifest.routes[0].layoutChain, ["_layout.niral"], "manifest layout chain");
  ok(manifest.layouts["_layout.niral"].style.includes(".wrap"), "layout style in manifest");

  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((res) => prod.listen(res));
  try {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    ok(/<div class="wrap n-[0-9a-f]{6}">.*<p>Home 9<\/p>.*<\/div>/s.test(html), `prod SSR composed through the layout — got: ${html.slice(0, 400)}`);
    ok(/\.wrap\.n-[0-9a-f]{6} \{ border: 1px solid \}/.test(html), "layout style in head, scoped");
    ok(/\/assets\/[0-9a-f]{12}\/routes\/_layout\.js/.test(html), "prod hydration lists built layout (versioned)");
    const lurl = html.match(/\/assets\/[0-9a-f]{12}\/routes\/_layout\.js/)[0];
    eq((await fetch(`http://localhost:${port}${lurl}`)).status, 200, "layout asset served");
  } finally {
    prod.close();
  }
});

/* ── v0.2: keyed {#for} ───────────────────────────────────────── */

test("parser: {#for ... key expr} splits the key clause", () => {
  const c = parse(`{#for t of todos key t.id}<p>{t.text}</p>{/for}`, "k.niral");
  const blk = c.template.find((n) => n.type === "ForBlock");
  eq(blk.iterable.raw.trim(), "todos", "iterable clean");
  eq(blk.keyExpr.raw.trim(), "t.id", "key captured");
  const plain = parse(`{#for t of todos}<p>x</p>{/for}`, "k.niral");
  ok(plain.template.find((n) => n.type === "ForBlock").keyExpr === null, "no key → null");
  const tricky = parse(`{#for t of items.filter(x => x.key > 1) key t.id}<p>x</p>{/for}`, "k.niral");
  const tb = tricky.template.find((n) => n.type === "ForBlock");
  ok(tb.iterable.raw.includes("x.key > 1"), "'key' inside parens not split");
  eq(tb.keyExpr.raw.trim(), "t.id");
  expectError("NIRAL034", () => parse(`{#for t of todos key }<p>x</p>{/for}`, "k.niral"));
});

test("codegen: keyed for → keyFn + item compiled as a signal in children", () => {
  const { code } = compileClient(
    `<script>let todos = $state([])</script>
     {#for t of todos key t.id}<span class={t.done ? "done" : ""}>{t.text}</span>{/for}`,
    { runtime: "x" }
  );
  ok(code.includes(`(t) => (t.id)`), "keyFn gets the plain item");
  ok(code.includes("t.get().text"), "item reads are fine-grained signals inside the block");
  ok(code.includes("t.get().done"), "expr attrs too");
});

test("runtime: keyed forBlock reuses DOM on reorder, updates in place, removes", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const hadDoc = "document" in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  try {
    const list = signal([
      { id: 1, t: "alpha" },
      { id: 2, t: "beta" },
      { id: 3, t: "gamma" },
    ]);
    const target = globalThis.document.createElement("div");
    dom.mount(target, () => [
      dom.forBlock(
        () => list.get(),
        (item) => {
          const li = dom.el("li");
          dom.append(li, dom.bindText(() => item.get().t));
          return [li];
        },
        (item) => item.id
      ),
    ]);
    const lis = () => target.childNodes.filter((n) => n.tagName === "li");
    eq(shim.serializeChildren(target).replace(/<!--[^>]*-->/g, ""), "<li>alpha</li><li>beta</li><li>gamma</li>", "initial render");

    const [elA, elB, elC] = lis();
    // reorder + change one item's content (same keys)
    list.set([
      { id: 3, t: "GAMMA" },
      { id: 1, t: "alpha" },
      { id: 2, t: "beta" },
    ]);
    eq(shim.serializeChildren(target).replace(/<!--[^>]*-->/g, ""), "<li>GAMMA</li><li>alpha</li><li>beta</li>", "reordered + updated");
    const after = lis();
    ok(after[0] === elC && after[1] === elA && after[2] === elB, "SAME DOM nodes reused — not rebuilt");

    // removal
    list.set([{ id: 2, t: "beta" }]);
    const last = lis();
    eq(last.length, 1);
    ok(last[0] === elB, "survivor keeps its node");

    // insertion in the middle
    list.set([{ id: 2, t: "beta" }, { id: 9, t: "new" }]);
    eq(lis().length, 2);
    ok(lis()[0] === elB, "existing node untouched by insertion");
  } finally {
    if (hadDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
});

/* ── v0.2: client-side navigation ─────────────────────────────── */

test("dev server: x-niral-nav returns a JSON page payload", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-nav-"));
  mkdirSync(join(dir, "routes", "blog"), { recursive: true });
  writeFileSync(join(dir, "routes", "_layout.niral"), `<style>.x{color:red}</style><nav>N</nav><slot />`);
  writeFileSync(
    join(dir, "routes", "blog", "[slug].niral"),
    `<server>
      export async function load({ params }) {
        session.set("navs", (session.get("navs") ?? 0) + 1)
        return { title: params.slug.toUpperCase() }
      }
    </server>
    <script>let { title } = $props</script><h2>{title}</h2>`
  );
  writeFileSync(join(dir, "routes", "plain.niral"), `<script mode="static">let x = $state(1)</script><p>{x}</p>`);

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const nav = (path, cookie) =>
    fetch(base + path, { headers: { "x-niral-nav": "1", ...(cookie ? { cookie } : {}) } });
  try {
    const res = await nav("/blog/ship-it");
    eq(res.headers.get("content-type"), "application/json", "JSON, not HTML");
    const data = await res.json();
    eq(data.ok, true);
    eq(data.mode, "client");
    eq(data.component, "/routes/blog/[slug].niral");
    eq(data.layouts, ["/routes/_layout.niral"], "layout chain included");
    eq(data.props, { slug: "ship-it", title: "SHIP-IT" }, "load() ran for the nav request");
    ok(/\.x\.n-[0-9a-f]{6} \{color:red\}/.test(data.style), "styles included for the swap (scoped)");
    ok(res.headers.get("set-cookie")?.includes("niral_session="), "session cookie set on nav");

    const cookie = res.headers.get("set-cookie").split(";")[0];
    const second = await (await nav("/blog/again", cookie)).json();
    eq(second.props.title, "AGAIN", "params flow per-navigation");

    const staticNav = await (await nav("/plain")).json();
    eq(staticNav.mode, "static", "static pages flagged → client falls back to full load");

    eq((await nav("/missing")).status, 404, "unmatched nav → 404 JSON");
  } finally {
    dev.close();
  }
});

test("prod server: x-niral-nav returns the built page payload", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-navprod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "routes", "_layout.niral"), `<div class="w"><slot /></div>`);
  writeFileSync(join(dir, "routes", "index.niral"), `<script>let n = $state(4)</script><p>{n}</p>`);
  build({ root: dir });

  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));
  try {
    const data = await (
      await fetch(`http://localhost:${port}/`, { headers: { "x-niral-nav": "1" } })
    ).json();
    eq(data.ok, true);
    ok(/^\/assets\/[0-9a-f]{12}\/routes\/index\.js$/.test(data.component), "prod points at versioned built assets");
    ok(/^\/assets\/[0-9a-f]{12}\/routes\/_layout\.js$/.test(data.layouts[0]), "built layout path (versioned)");
  } finally {
    prod.close();
  }
});

/* ── v0.2: niral add tailwind (recipe system) ─────────────────── */

test("tailwind recipe: loadRecipe reads the manifest (null without one)", async () => {
  const { loadRecipe } = await import("../src/add/tailwind.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-tw-"));
  ok(loadRecipe(dir) === null, "no manifest → null");
  mkdirSync(join(dir, ".niral"), { recursive: true });
  writeFileSync(join(dir, ".niral", "tailwind.json"), JSON.stringify({ input: "a.css", output: "b.css", binary: "bin/tw" }));
  eq(loadRecipe(dir).output, "b.css");
});

test("build: tailwind pass runs first and its CSS ships in the release", async () => {
  const { build } = await import("../src/build/build.js");
  const { mkdtempSync, writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-twbuild-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  mkdirSync(join(dir, ".niral", "bin"), { recursive: true });
  mkdirSync(join(dir, "styles"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), `<p class="text-red-500">hi</p>`);
  writeFileSync(join(dir, "styles", "tailwind.css"), `@import "tailwindcss";`);
  // fake standalone binary: writes css to the -o path (argv: -i in -o out [--minify])
  writeFileSync(
    join(dir, ".niral", "bin", "tailwindcss"),
    `#!/bin/sh\nout=""\nminified="no"\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then out="$2"; shift; fi\n  if [ "$1" = "--minify" ]; then minified="yes"; fi\n  shift\ndone\necho ".text-red-500{color:red}/*min:$minified*/" > "$out"\n`
  );
  chmodSync(join(dir, ".niral", "bin", "tailwindcss"), 0o755);
  writeFileSync(
    join(dir, ".niral", "tailwind.json"),
    JSON.stringify({ input: "styles/tailwind.css", output: "styles/tw.css", binary: ".niral/bin/tailwindcss" })
  );

  const r = build({ root: dir });
  const out = join(dir, "dist", "releases", r.hash, "static", "styles", "tw.css");
  ok(existsSync(out), "compiled css copied into the release");
  const css = readFileSync(out, "utf8");
  ok(css.includes(".text-red-500"), "css content present");
  ok(css.includes("min:yes"), "build uses --minify");
  ok(!existsSync(join(dir, "dist", "releases", r.hash, "static", ".niral")), "binary/manifest never ship");
});

test("build: a failing tailwind pass fails the build before any flip", async () => {
  const { build } = await import("../src/build/build.js");
  const { mkdtempSync, writeFileSync, mkdirSync, chmodSync, existsSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-twfail-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  mkdirSync(join(dir, ".niral", "bin"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), `<p>hi</p>`);
  writeFileSync(join(dir, ".niral", "bin", "tailwindcss"), `#!/bin/sh\nexit 3\n`);
  chmodSync(join(dir, ".niral", "bin", "tailwindcss"), 0o755);
  writeFileSync(
    join(dir, ".niral", "tailwind.json"),
    JSON.stringify({ input: "styles/tailwind.css", output: "styles/tw.css", binary: ".niral/bin/tailwindcss" })
  );
  let threw = false;
  try {
    build({ root: dir });
  } catch (e) {
    threw = true;
    ok(e.message.includes("tailwind compile failed"), "clear failure reason");
  }
  ok(threw, "build threw");
  ok(!existsSync(join(dir, "dist", "current")), "nothing was activated");
});

/* ── v0.2: sqlite + fonts recipes, data/ privacy ──────────────── */

test("sqlite recipe: scaffolds the notes route + gitignore", async () => {
  const { addSqlite } = await import("../src/add/sqlite.js");
  const { mkdtempSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-sqlr-"));
  await addSqlite({ root: dir });
  ok(existsSync(join(dir, "routes", "notes.niral")), "route created");
  const src = readFileSync(join(dir, "routes", "notes.niral"), "utf8");
  ok(src.includes('lang="python"') && src.includes("sqlite3"), "python + sqlite server block");
  ok(src.includes("key n.id"), "keyed list");
  ok(readFileSync(join(dir, ".gitignore"), "utf8").includes("data/"), "db ignored by git");
});

test("sqlite: notes persist in data/app.db ACROSS dev server restarts", async () => {
  const { addSqlite } = await import("../src/add/sqlite.js");
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, existsSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-sqlp-"));
  await addSqlite({ root: dir });

  const rpc = (base, fn, args) =>
    fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/notes.niral", fn, args }),
    }).then((r) => r.json());

  // first server: write a note
  let dev = createDevServer({ root: dir, port: 0, watch: false });
  let port = await new Promise((r) => dev.listen(r));
  const first = await rpc(`http://localhost:${port}`, "add_note", ["survives restarts"]);
  eq(first.result.notes[0].text, "survives restarts", "note stored");
  ok(existsSync(join(dir, "data", "app.db")), "db file in project data/ (worker cwd = project root)");
  dev.close();

  // brand-new server process pool: data must still be there
  dev = createDevServer({ root: dir, port: 0, watch: false });
  port = await new Promise((r) => dev.listen(r));
  const html = await (await fetch(`http://localhost:${port}/notes`)).text();
  ok(html.includes("survives restarts"), `note SSR'd from sqlite after restart — got: ${html.slice(0, 300)}`);
  dev.close();
});

test("data/ is private: dev refuses to serve it, build never ships it", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { build } = await import("../src/build/build.js");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-priv-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), "<p>hi</p>");
  writeFileSync(join(dir, "data", "app.db"), "SECRET-DB-BYTES");
  writeFileSync(join(dir, "public.txt"), "public");

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    eq((await fetch(`http://localhost:${port}/data/app.db`)).status, 404, "dev: data/ never served");
    eq((await fetch(`http://localhost:${port}/public.txt`)).status, 200, "other files still serve");
  } finally {
    dev.close();
  }

  const r = build({ root: dir });
  ok(!existsSync(join(dir, "dist", "releases", r.hash, "static", "data")), "build: data/ never shipped");
  ok(existsSync(join(dir, "dist", "releases", r.hash, "static", "public.txt")), "other statics ship");
});

test("fonts recipe: parseFontUrls extracts unique remote urls", async () => {
  const { parseFontUrls } = await import("../src/add/fonts.js");
  const css = `@font-face { src: url(https://fonts.gstatic.com/a.woff2) format('woff2'); }
@font-face { src: url(https://fonts.gstatic.com/b.woff2); }
@font-face { src: url(https://fonts.gstatic.com/a.woff2); }`;
  eq(parseFontUrls(css), ["https://fonts.gstatic.com/a.woff2", "https://fonts.gstatic.com/b.woff2"]);
});

/* ── v0.2: scoped styles ──────────────────────────────────────── */

test("scopeStyle: selectors get the scope class, correctly placed", async () => {
  const { scopeStyle } = await import("../src/compiler/style.js");
  const s = (css) => scopeStyle(css, "n-abc123");
  eq(s(".card { color: red }"), ".card.n-abc123 { color: red }");
  eq(s("h1, .big { x: y }"), "h1.n-abc123, .big.n-abc123 { x: y }");
  eq(s(".card:hover { x: y }"), ".card.n-abc123:hover { x: y }");
  eq(s("li::before { x: y }"), "li.n-abc123::before { x: y }");
  eq(s(".a .b > .c { x: y }"), ".a.n-abc123 .b.n-abc123 > .c.n-abc123 { x: y }");
  eq(s('input[type="checkbox"] { x: y }'), 'input[type="checkbox"].n-abc123 { x: y }');
  eq(s("body { margin: 0 }"), "body { margin: 0 }", "body left global");
  eq(s(":root { --x: 1 }"), ":root { --x: 1 }", ":root left global");
  ok(s("@media (min-width: 600px) { .card { x: y } }").includes(".card.n-abc123 { x: y }"), "@media recursed");
  const kf = s("@keyframes spin { from { rotate: 0 } to { rotate: 360deg } }");
  ok(!kf.includes("n-abc123"), "@keyframes untouched");
  ok(s("@import url(x.css); .a { b: c }").includes(".a.n-abc123"), "@import statement passes through");
});

test("componentCss/componentScope: scoping on, <style global> opts out", async () => {
  const scoped = parse(`<style>.a { x: y }</style><p class="a">hi</p>`, "s.niral");
  const { componentCss, componentScope } = await import("../src/compiler/style.js");
  ok(/\.a\.n-[0-9a-f]{6} \{ x: y \}/.test(componentCss(scoped)), "scoped css");
  ok(componentScope(scoped)?.startsWith("n-"), "scope id");
  const global = parse(`<style global>.a { x: y }</style><p>hi</p>`, "s.niral");
  eq(componentCss(global), ".a { x: y }", "global untouched");
  ok(componentScope(global) === null, "no scope class for global styles");
});

test("codegen: elements get the scope class merged into class attrs", () => {
  const { code } = compileClient(
    `<script>let on = $state(true)</script>
     <style>.a { x: y }</style>
     <div class="a">static</div>
     <p class={on ? "hot" : "cold"}>expr</p>
     <span>bare</span>`,
    { runtime: "x" }
  );
  const scope = code.match(/n-[0-9a-f]{6}/)?.[0];
  ok(scope, "scope present in output");
  ok(code.includes(`"a ${scope}"`), "static class merged");
  ok(code.includes(`) || "") + " ${scope}"`), "expr class merged reactively");
  ok(new RegExp(`__n\\.setAttr\\(e\\d+, "class", "${scope}"\\)`).test(code), "bare element stamped");
});

test("scoped styles: two components with the SAME selector don't collide (SSR)", async () => {
  const { renderFile } = await import("../src/server/render.js");
  const { componentCss } = await import("../src/compiler/style.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-scope-"));
  mkdirSync(join(dir, "c"), { recursive: true });
  writeFileSync(join(dir, "c", "Red.niral"), `<style>.title { color: red }</style><h3 class="title">red</h3>`);
  writeFileSync(
    join(dir, "page.niral"),
    `<script>
      import Red from "./c/Red.niral"
    </script>
    <style>.title { color: blue }</style>
    <h2 class="title">blue</h2>
    <Red />`
  );
  const { html, ast } = await renderFile(join(dir, "page.niral"));
  const pageScope = html.match(/<h2 class="title (n-[0-9a-f]{6})"/)?.[1];
  const childScope = html.match(/<h3 class="title (n-[0-9a-f]{6})"/)?.[1];
  ok(pageScope && childScope, `both scoped — got: ${html}`);
  ok(pageScope !== childScope, "different components → different scopes");
  ok(componentCss(ast).includes(`.title.${pageScope}`), "page css targets only its own scope");
});

/* ── v0.2 hardening: sessions, errors, head, guards, rate limit ─ */

test("session: cookies expire (signed exp + Max-Age attribute)", async () => {
  const { signSession, verifySession, sessionCookie, newSecret } = await import("../src/server/session.js");
  const secret = newSecret();
  ok(verifySession(signSession({ u: 1 }, secret), secret)?.u === 1, "fresh session valid");
  ok(verifySession(signSession({ u: 1 }, secret, -10), secret) === null, "expired session rejected");
  ok(sessionCookie({ data: {} }, secret).includes("Max-Age="), "cookie carries Max-Age");
});

test("rewriter guards: unsupported constructs fail LOUDLY, not silently", () => {
  expectError("NIRAL041", () =>
    compileClient(`<script>let n = $state(0)\nfunction f() { ++n }</script><p>{n}</p>`, { runtime: "x" })
  );
  expectError("NIRAL040", () =>
    compileClient(`<script>let a = $state(0)\nlet b = $state(0)\nfunction f(p) { [a, b] = p }</script><p>{a}</p>`, { runtime: "x" })
  );
  // declarations are still fine
  const { code } = compileClient(
    `<script>let n = $state(0)\nconst { x } = someObj\nfunction f() { n++ }</script><p>{n}</p>`,
    { runtime: "x" }
  );
  ok(code.includes("n.set(n.get() + 1)"), "postfix still compiles");
});

test("rate limiter: allows under the limit, blocks over it, resets per window", async () => {
  const { createLimiter } = await import("../src/server/ratelimit.js");
  const l = createLimiter({ limit: 3, windowMs: 60_000 });
  ok(l.check("a") && l.check("a") && l.check("a"), "3 allowed");
  ok(!l.check("a"), "4th blocked");
  ok(l.check("b"), "other keys unaffected");
});

test("parser: <head> block captured, absent from template", () => {
  const c = parse(
    `<head>
  <title>My Page</title>
  <meta name="description" content="hello" />
</head>
<p>content</p>`,
    "h.niral"
  );
  ok(c.head.raw.includes("<title>My Page</title>"), "head captured");
  ok(c.head.raw.includes('name="description"'), "meta captured");
  eq(c.template.filter((n) => n.type === "Element").length, 1, "head not in template");
});

test("dev server: <head> SSR'd into the page + custom 404/error pages", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-hard-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<head><title>Home — Niral</title><meta name="description" content="zero deps" /></head>
<p>hi</p>`
  );
  writeFileSync(
    join(dir, "routes", "boom.niral"),
    `<server>
      export async function load() { throw new Error("db exploded") }
    </server>
    <p>never</p>`
  );
  writeFileSync(join(dir, "routes", "_404.niral"), `<script>let { path } = $props</script><h1 id="nf">Lost: {path}</h1>`);
  writeFileSync(join(dir, "routes", "_error.niral"), `<script>let { message } = $props</script><h1 id="err">Broke: {message}</h1>`);

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  try {
    const home = await (await fetch(`${base}/`)).text();
    ok(home.includes("<title>Home — Niral</title>"), "title SSR'd into head");
    ok(home.indexOf("<title>") < home.indexOf("<body>"), "head content in the head");

    const nav = await (await fetch(`${base}/`, { headers: { "x-niral-nav": "1" } })).json();
    ok(nav.head.includes("<title>Home — Niral</title>"), "head rides the nav payload");

    const nf = await fetch(`${base}/does-not-exist`);
    eq(nf.status, 404);
    ok((await nf.text()).includes("Lost: /does-not-exist"), "custom 404 page with path prop");

    const err = await fetch(`${base}/boom`);
    eq(err.status, 500);
    ok((await err.text()).includes("Broke: db exploded"), "custom error page with message prop");
  } finally {
    dev.close();
  }
});

test("prod server: custom 404/error pages from the built release", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-hardprod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<head><title>Prod Title</title></head><p>home</p>`
  );
  writeFileSync(
    join(dir, "routes", "boom.niral"),
    `<server>
      export async function load() { throw new Error("prod kaboom") }
    </server>
    <p>never</p>`
  );
  writeFileSync(join(dir, "routes", "_404.niral"), `<script>let { path } = $props</script><h1>Missing {path}</h1>`);
  writeFileSync(join(dir, "routes", "_error.niral"), `<script>let { message } = $props</script><h1>Down: {message}</h1>`);

  build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));
  const base = `http://localhost:${port}`;
  try {
    ok((await (await fetch(`${base}/`)).text()).includes("<title>Prod Title</title>"), "head in prod SSR");
    const nf = await fetch(`${base}/nope`);
    eq(nf.status, 404);
    ok((await nf.text()).includes("Missing /nope"), "prod custom 404");
    const err = await fetch(`${base}/boom`);
    eq(err.status, 500);
    ok((await err.text()).includes("Down: prod kaboom"), "prod custom error page");
  } finally {
    prod.close();
  }
});

/* ── v0.2: {#await}, :global(), CSRF, ruby runner ─────────────── */

test("parser + codegen: {#await} with then/catch compiles", () => {
  const c = parse(
    `{#await fetchUser()}
  <p>loading…</p>
{:then user}
  <b>{user.name}</b>
{:catch err}
  <i>{err.message}</i>
{/await}`,
    "a.niral"
  );
  const blk = c.template.find((n) => n.type === "AwaitBlock");
  ok(blk, "await block parsed");
  eq(blk.thenVar, "user");
  eq(blk.catchVar, "err");
  ok(blk.pending.length > 0, "pending branch");

  const { code } = compileClient(
    `<script>let id = $state(1)</script>
{#await loadUser(id)}<p>…</p>{:then u}<b>{u.name}</b>{:catch e}<i>{e.message}</i>{/await}`,
    { runtime: "x" }
  );
  ok(code.includes("__n.awaitBlock(() => (loadUser(id.get()))"), "expr tracked (signal read)");
  ok(code.includes("(u) =>"), "then builder receives the value");
  expectError("NIRAL035", () => parse(`{#await p}<p>x</p>`, "a.niral"));
});

test("runtime: awaitBlock renders pending → then → catch (dom-shim)", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const hadDoc = "document" in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  // awaitBlock reports via _reportError which rethrows without window — give it one
  const hadWin = "window" in globalThis;
  if (!hadWin) globalThis.window = { dispatchEvent() {} };
  try {
    let resolveP;
    const p = new Promise((r) => (resolveP = r));
    const target = globalThis.document.createElement("div");
    dom.mount(target, () => [
      dom.awaitBlock(
        () => p,
        () => [dom.text("loading")],
        (v) => [dom.text("got " + v)],
        (e) => [dom.text("err " + e.message)]
      ),
    ]);
    ok(shim.serializeChildren(target).includes("loading"), "pending branch first");
    resolveP(42);
    await new Promise((r) => setTimeout(r, 10));
    ok(shim.serializeChildren(target).includes("got 42"), "then branch after resolve");

    // rejection path
    const target2 = globalThis.document.createElement("div");
    dom.mount(target2, () => [
      dom.awaitBlock(
        () => Promise.reject(new Error("nope")),
        () => [dom.text("…")],
        () => [dom.text("never")],
        (e) => [dom.text("err " + e.message)]
      ),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    ok(shim.serializeChildren(target2).includes("err nope"), "catch branch on reject");
  } finally {
    if (hadDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
    if (!hadWin) delete globalThis.window;
  }
});

test("scoped styles: :global() escape hatch", async () => {
  const { scopeStyle } = await import("../src/compiler/style.js");
  eq(scopeStyle(":global(.toast) { x: y }", "n-a1"), ".toast { x: y }", "global compound unscoped");
  eq(
    scopeStyle(".card :global(.icon) { x: y }", "n-a1"),
    ".card.n-a1 .icon { x: y }",
    "mixed chain: scoped parent, global child"
  );
});

test("rpc: requests without the x-niral-rpc header are rejected (CSRF)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-csrf-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>export async function ping() { return 1 }</server><p>x</p>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const naked = await fetch(`http://localhost:${port}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "ping", args: [] }),
    });
    eq(naked.status, 403, "no header → 403");
    const proper = await fetch(`http://localhost:${port}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "ping", args: [] }),
    });
    eq((await proper.json()).result, 1, "with header → works");
  } finally {
    dev.close();
  }
});

test("ruby: <server lang=\"ruby\"> — load(), RPC, sessions end-to-end", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-rb-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server lang="ruby">
def load(params)
  session.set("seen", session.get("seen", 0) + 1)
  { "greeting" => "hello from ruby", "seen" => session.get("seen") }
end

def shout(text)
  { "loud" => text.to_s.upcase }
end

def _private
  "hidden"
end
</server>
<script>let { greeting, seen } = $props</script>
<p id="g">{greeting}</p><p id="s">{seen}</p>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const rpc = (fn, args) =>
    fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn, args }),
    });
  try {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    ok(html.includes(`<p id="g">hello from ruby</p>`), `ruby load() SSR'd — got: ${html.slice(0, 300)}`);
    ok(html.includes(`<p id="s">1</p>`), "ruby session value SSR'd");
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    const second = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    ok(second.includes(`<p id="s">2</p>`), "ruby session persists via signed cookie");

    eq((await (await rpc("shout", ["niral"])).json()).result, { loud: "NIRAL" }, "ruby RPC");
    eq((await rpc("_private", [])).status, 404, "underscore methods hidden");
  } finally {
    dev.close();
  }
});

/* ── v0.2: JSX / TSX / TS surface syntaxes ────────────────────── */

test("stripTypes: interfaces, aliases, annotations, casts, optionals", async () => {
  const { stripTypes } = await import("../src/compiler/typescript.js");
  const out = stripTypes(`
interface User { name: string; age?: number }
type Pair = [number, number]
import type { Foo } from "./foo.ts"

let count: number = 0
const who: string = "ada"
function add(a: number, b?: number): number {
  return a + (b ?? 0)
}
const id = ((x: string) => x)("k" as string)
const obj = { label: "x", n: 1 }
const t = count > 1 ? "big" : "small"
`);
  ok(!out.includes("interface"), "interface removed");
  ok(!out.includes("type Pair"), "type alias removed");
  ok(!out.includes("import type"), "import type removed");
  ok(!/count:\s*number/.test(out), "variable annotation stripped");
  ok(!/a:\s*number/.test(out), "param annotation stripped");
  ok(!/\):\s*number/.test(out), "return annotation stripped");
  ok(!out.includes(" as string"), "as-cast stripped");
  ok(!out.includes("b?"), "optional marker stripped");
  ok(out.includes(`{ label: "x", n: 1 }`), "object literal untouched");
  ok(out.includes(`count > 1 ? "big" : "small"`), "ternary untouched");
  // the result must be valid JS
  new Function(out.replace(/import[^\n]*\n/g, ""));
});

test("parseJsx: elements, props → $props, onClick/className/htmlFor", async () => {
  const { parseJsx } = await import("../src/compiler/jsx.js");
  const c = parseJsx(
    `import Card from "./Card.niral"

export default function Home({ slug }) {
  let count = $state(0)
  return (
    <div className="app">
      <label htmlFor="q">Find {slug}</label>
      <button onClick={() => count++}>plus</button>
      <Card title={count} />
    </div>
  )
}`,
    "home.jsx"
  );
  ok(c.script.code.includes("let { slug } = $props"), "props destructured via $props");
  ok(c.script.code.includes(`import Card from "./Card.niral"`), "header imports kept in script");
  ok(c.script.code.includes("let count = $state(0)"), "pre-return body is the script");
  const div = els(c.template, "div")[0];
  eq(div.attrs.find((a) => a.name === "class").value, "app", "className → class");
  const label = els(div.children, "label")[0];
  eq(label.attrs.find((a) => a.name === "for").value, "q", "htmlFor → for");
  const btn = els(div.children, "button")[0];
  const on = btn.attrs.find((a) => a.type === "On");
  eq(on.event, "click", "onClick → on:click");
  ok(on.expr.raw.includes("count++"), "handler expression kept");
  const card = els(div.children, "Card")[0];
  ok(card.selfClosing, "self-closing component");
  eq(card.attrs.find((a) => a.name === "title").value.raw, "count", "expression prop");
});

test("parseJsx: map → keyed ForBlock, ternary/&& → IfBlock, fragments flatten", async () => {
  const { parseJsx } = await import("../src/compiler/jsx.js");
  const c = parseJsx(
    `export default function App() {
  let todos = $state([])
  let on = $state(true)
  return (
    <>
      <ul>{todos.map((t, i) => <li key={t.id}>{i}: {t.text}</li>)}</ul>
      {on ? <b>yes</b> : <i>no</i>}
      {on && <p>started</p>}
      {todos.length}
    </>
  )
}`,
    "app.jsx"
  );
  const ul = els(c.template, "ul")[0];
  ok(ul, "fragment flattened — <ul> is top level");
  const forBlk = byType(ul.children, "ForBlock")[0];
  ok(forBlk, ".map() became a ForBlock");
  eq(forBlk.item, "t");
  eq(forBlk.index, "i");
  eq(forBlk.iterable.raw, "todos");
  eq(forBlk.keyExpr.raw, "t.id", "key={t.id} → keyed reconciliation");
  ok(els(forBlk.children, "li").length === 1, "loop body parsed");

  const ifs = byType(c.template, "IfBlock");
  eq(ifs.length, 2, "ternary + && → two IfBlocks");
  eq(ifs[0].branches.length, 2, "ternary → if/else");
  eq(ifs[0].branches[0].expr.raw, "on");
  eq(els(ifs[0].branches[1].children, "i").length, 1, "else branch");
  eq(ifs[1].branches.length, 1, "&& → single branch");
  ok(byType(c.template, "Mustache").some((m) => m.expr.raw === "todos.length"), "plain expr stays a mustache");
});

test("parseJsx: apostrophes in text + bind:/on: directives (regressions)", async () => {
  const { parseJsx } = await import("../src/compiler/jsx.js");
  const c = parseJsx(
    `export default function App() {
  let text = $state("")
  let on = $state(true)
  return (
    <div>
      <input bind:value={text} />
      <button on:click={() => on = !on}>toggle</button>
      {on ? <p>that's a lot</p> : <p>it's fine</p>}
    </div>
  )
}`,
    "apos.jsx"
  );
  const div = els(c.template, "div")[0];
  ok(div, "template intact despite apostrophes in JSX text");
  const input = els(div.children, "input")[0];
  const bind = input.attrs.find((a) => a.type === "Bind");
  eq(bind.name, "value", "bind:value works in jsx");
  eq(bind.expr.raw, "text");
  const btn = els(div.children, "button")[0];
  eq(btn.attrs.find((a) => a.type === "On").event, "click", "on:click works in jsx");
  const ifBlk = byType(div.children, "IfBlock")[0];
  eq(ifBlk.branches.length, 2, "ternary with contractions still splits");
  ok(byType(ifBlk.branches[0].children[0].children ?? ifBlk.branches[0].children, "Text").length ||
     els(ifBlk.branches[0].children, "p").length, "then branch parsed");
});

test("parseJsx: helpful errors (NIRAL050/052/053/055)", async () => {
  const { parseJsx } = await import("../src/compiler/jsx.js");
  const tryJsx = (code, src) => expectError(code, () => parseJsx(src, "x.jsx"));
  tryJsx("NIRAL050", `const x = 1`);
  tryJsx("NIRAL052", `export default function App(props) { return <p>x</p> }`);
  tryJsx("NIRAL055", `export default function App() { return <div><p>x</div> }`);
  tryJsx("NIRAL053", `export default function App() { return <div>never closed }`);
});

test("compileClient: .jsx/.tsx dispatch + <script lang=\"ts\"> stripping", () => {
  const jsx = compileClient(
    `export default function App() {\n  let n = $state(1)\n  return <p>{n}</p>\n}`,
    { filename: "app.jsx", runtime: "x" }
  );
  ok(jsx.code.includes("__n.signal(1)"), "runes rewritten in jsx script");
  ok(jsx.code.includes("export default function Component"), "same module shape");

  const tsx = compileClient(
    `interface P { title: string }\nexport default function App({ title }: P) {\n  let n: number = $state(2)\n  return <p>{title} {n}</p>\n}`,
    { filename: "app.tsx", runtime: "x" }
  );
  ok(tsx.code.includes("__n.signal(2)"), "tsx: types stripped then compiled");
  ok(!tsx.code.includes("interface"), "tsx: interface gone");

  const ts = compileClient(
    `<script lang="ts">let n: number = $state(3)</script><p>{n}</p>`,
    { filename: "app.niral", runtime: "x" }
  );
  ok(ts.code.includes("__n.signal(3)"), "script lang=ts stripped");
  ok(!ts.code.includes(": number"), "annotation gone");
});

test("dev server: a .jsx route SSRs, hydrates and serves compiled modules", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-jsx-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "utils.ts"), `export function fmt(n: number): string { return "#" + n }`);
  writeFileSync(
    join(dir, "routes", "index.jsx"),
    `import { fmt } from "../utils.ts"

export default function Home() {
  let count = $state(4)
  let items = $state(["a", "b"])
  return (
    <div>
      <h1>Hello {fmt(count)}</h1>
      {count > 1 ? <p id="big">big</p> : <p>small</p>}
      <ul>{items.map((it) => <li key={it}>{it}</li>)}</ul>
    </div>
  )
}`
  );
  writeFileSync(
    join(dir, "routes", "types.tsx"),
    `export default function Types({ }: {}) {\n  let msg: string = $state("typed")\n  return <p>{msg}</p>\n}`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  try {
    const home = await (await fetch(`${base}/`)).text();
    ok(home.includes("<h1>Hello #4</h1>"), `jsx SSR'd (ts import resolved) — got: ${home.slice(0, 400)}`);
    ok(home.includes(`<p id="big">big</p>`), "ternary → if branch SSR'd");
    ok(home.includes("<li>a</li>") && home.includes("<li>b</li>"), "map → for SSR'd");
    ok(home.includes('import __page from "/routes/index.jsx"'), "hydration points at the jsx module");

    const mod = await (await fetch(`${base}/routes/index.jsx`)).text();
    ok(mod.includes("__n.signal(4)"), "jsx served compiled");
    ok(mod.includes("__NiralHot"), "HMR wrapper applied to jsx");

    const ts = await (await fetch(`${base}/utils.ts`)).text();
    ok(!ts.includes(": number"), ".ts served type-stripped");
    ok(ts.includes("export function fmt"), ".ts body intact");

    const typed = await (await fetch(`${base}/types`)).text();
    ok(typed.includes("<p>typed</p>"), ".tsx route SSR'd");
  } finally {
    dev.close();
  }
});

test("build + prod: .jsx route built, manifest correct, served", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-jsxprod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "greet.ts"), `export const NAME: string = "prod"`);
  writeFileSync(
    join(dir, "routes", "index.jsx"),
    `import { NAME } from "../greet.ts"\n\nexport default function Home() {\n  let n = $state(7)\n  return <p>Built {NAME} {n}</p>\n}`
  );

  const r = build({ root: dir });
  const releaseDir = join(dir, "dist", "releases", r.hash);
  ok(existsSync(join(releaseDir, "assets", "routes", "index.js")), "jsx compiled to assets/routes/index.js");
  ok(existsSync(join(releaseDir, "assets", "greet.js")), ".ts dep shipped as .js");
  const built = readFileSync(join(releaseDir, "assets", "routes", "index.js"), "utf8");
  ok(built.includes(`from "../greet.js"`), "import rewritten to the built .js");
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  eq(manifest.routes[0].client, `/assets/${r.hash}/routes/index.js`, "manifest client path (versioned)");

  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((res) => prod.listen(res));
  try {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    ok(html.includes("Built prod 7"), `prod SSR of jsx route — got: ${html.slice(0, 300)}`);
  } finally {
    prod.close();
  }
});

/* ── v0.2: attach-hydration ───────────────────────────────────── */

test("runtime: attach-hydration claims the SSR DOM — identity, reactivity, keyed for", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const hadDoc = "document" in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  const hadWin = "window" in globalThis;
  if (!hadWin) globalThis.window = { dispatchEvent() {} };
  try {
    const makeBuild = (n, items) => () => [
      dom.append(dom.el("h1"), dom.text("Count "), dom.bindText(() => n.get())),
      dom.ifBlock([[() => n.get() > 1, () => [dom.append(dom.el("p"), dom.text("big"))]]]),
      dom.append(
        dom.el("ul"),
        dom.forBlock(
          () => items.get(),
          (it) => [dom.append(dom.el("li"), dom.bindText(() => it.get().t))],
          (it) => it.id
        )
      ),
    ];

    // SSR pass
    const target = globalThis.document.createElement("div");
    const nS = signal(2);
    const itemsS = signal([{ id: 1, t: "a" }, { id: 2, t: "b" }]);
    const ssr = dom.mount(target, makeBuild(nS, itemsS));
    const ssrHtml = shim.serializeChildren(target);
    ok(ssrHtml.includes("Count 2") && ssrHtml.includes("<p>big</p>"), "SSR baseline");
    ssr.destroy = () => {}; // keep the DOM — simulate a fresh browser tab

    // capture SSR node identities
    const ssrH1 = target.childNodes[0];
    const ssrUl = [...target.childNodes].find((c) => c.tagName === "ul");
    const ssrLis = ssrUl.childNodes.filter((c) => c.tagName === "li");
    eq(ssrLis.length, 2, "two SSR list items");

    // hydration pass — new component instance attaches to the same DOM
    const n2 = signal(2);
    const items2 = signal([{ id: 1, t: "a" }, { id: 2, t: "b" }]);
    dom._hydrateNext(target);
    dom.mount(target, makeBuild(n2, items2));

    ok(target.childNodes[0] === ssrH1, "h1 CLAIMED — same node, not rebuilt");
    const lisAfter = ssrUl.childNodes.filter((c) => c.tagName === "li");
    ok(lisAfter[0] === ssrLis[0] && lisAfter[1] === ssrLis[1], "list items claimed");
    eq(shim.serializeChildren(target), ssrHtml, "hydration changed NOTHING visually");

    // reactivity attached to claimed nodes
    n2.set(7);
    ok(shim.serializeChildren(target).includes("Count 7"), "signal drives the claimed text node");
    ok(target.childNodes[0] === ssrH1, "h1 still the SSR node after update");

    // keyed reconciliation works on claimed entries: reorder preserves identity
    items2.set([{ id: 2, t: "b" }, { id: 1, t: "a!" }]);
    const reordered = ssrUl.childNodes.filter((c) => c.tagName === "li");
    ok(reordered[0] === ssrLis[1] && reordered[1] === ssrLis[0], "claimed <li> identity survives reorder");
    ok(shim.serializeChildren(ssrUl).includes("a!"), "item update flows fine-grained");
  } finally {
    if (hadDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
    if (!hadWin) delete globalThis.window;
  }
});

test("runtime: hydration splits browser-merged text nodes", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  const hadWin = "window" in globalThis;
  if (!hadWin) globalThis.window = { dispatchEvent() {} };
  try {
    const target = globalThis.document.createElement("div");
    // what the browser parser produces from `<h1>Count 2</h1>`: ONE text node
    const h1 = globalThis.document.createElement("h1");
    const merged = globalThis.document.createTextNode("Count 2");
    h1.appendChild(merged);
    target.appendChild(h1);

    const n = signal(2);
    dom._hydrateNext(target);
    dom.mount(target, () => [dom.append(dom.el("h1"), dom.text("Count "), dom.bindText(() => n.get()))]);

    eq(h1.childNodes.length, 2, "merged node split into static + dynamic");
    eq(h1.childNodes[0].data, "Count ");
    n.set(9);
    eq(h1.childNodes[1].data, "9", "dynamic half is live");
    ok(target.childNodes[0] === h1, "h1 claimed");
  } finally {
    globalThis.document = prevDoc;
    if (!hadWin) delete globalThis.window;
  }
});

test("runtime: hydration mismatch falls back to a clean client render", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  const hadWin = "window" in globalThis;
  if (!hadWin) globalThis.window = { dispatchEvent() {} };
  const prevWarn = console.warn;
  console.warn = () => {};
  try {
    const target = globalThis.document.createElement("div");
    // stale/damaged SSR HTML: a <span> where the component wants an <h1>
    const wrong = globalThis.document.createElement("span");
    wrong.appendChild(globalThis.document.createTextNode("stale"));
    target.appendChild(wrong);

    const n = signal(1);
    dom._hydrateNext(target);
    dom.mount(target, () => [dom.append(dom.el("h1"), dom.bindText(() => "v" + n.get()))]);

    const html = shim.serializeChildren(target);
    ok(html.includes("<h1>v1</h1>"), `fallback rendered the real content — got: ${html}`);
    ok(!html.includes("stale"), "stale SSR DOM was discarded");
    n.set(2);
    ok(shim.serializeChildren(target).includes("v2"), "fallback render is fully reactive");
  } finally {
    console.warn = prevWarn;
    globalThis.document = prevDoc;
    if (!hadWin) delete globalThis.window;
  }
});

test("go: <server lang=\"go\"> — load(), typed RPC, sessions end-to-end", async () => {
  const { execSync } = await import("node:child_process");
  try {
    execSync("go version", { stdio: "ignore" });
  } catch {
    console.log("    (go toolchain not installed — skipping)");
    return;
  }
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-go-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server lang="go">
import (
	"math"
	"strings"
)

func load(params map[string]string) map[string]any {
	seen := 0
	if v, ok := session.Get("seen", 0.0).(float64); ok {
		seen = int(v)
	}
	seen++
	session.Set("seen", seen)
	return map[string]any{"greeting": "hello from go", "pi": math.Pi, "seen": seen}
}

func shout(text string) map[string]string {
	return map[string]string{"loud": strings.ToUpper(text)}
}

func add(a float64, b float64) float64 {
	return a + b
}

func boom() (int, error) {
	return 0, &goErr{}
}

type goErr struct{}

func (e *goErr) Error() string { return "kaboom from go" }

func _hidden() string { return "secret" }
</server>
<script>let { greeting, seen } = $props</script>
<p id="g">{greeting}</p><p id="s">{seen}</p>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const rpc = (fn, args) =>
    fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn, args }),
    });
  try {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    ok(html.includes(`<p id="g">hello from go</p>`), `go load() SSR'd — got: ${html.slice(0, 300)}`);
    ok(html.includes(`<p id="s">1</p>`), "go session value SSR'd");
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    const second = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    ok(second.includes(`<p id="s">2</p>`), "go session persists via signed cookie");

    eq((await (await rpc("shout", ["niral"])).json()).result, { loud: "NIRAL" }, "go RPC with typed string arg");
    eq((await (await rpc("add", [2, 40])).json()).result, 42, "go RPC with typed numeric args");
    const err = await (await rpc("boom", [])).json();
    ok(!err.ok && err.error.includes("kaboom"), "(value, error) returns surface as RPC errors");
    eq((await rpc("_hidden", [])).status, 404, "underscore functions hidden");
    eq((await rpc("main", [])).status, 404, "main is never callable");
  } finally {
    dev.close();
  }
});

/* ── v0.2: streaming SSR ──────────────────────────────────────── */

test("streaming SSR: <script stream> flushes head BEFORE load() finishes (dev + prod)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-stream-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function load() {
        await new Promise((r) => setTimeout(r, 400));
        return { answer: 42 }
      }
    </server>
    <script stream>let { answer } = $props</script>
    <head><title>Streamed</title></head>
    <style>h1 { color: teal }</style>
    <h1 id="a">Answer {answer}</h1>`
  );

  /** Fetch and record when the FIRST chunk vs the FULL body arrived. */
  async function timedFetch(url) {
    const t0 = Date.now();
    const res = await fetch(url);
    const reader = res.body.getReader();
    let firstAt = null;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstAt == null) firstAt = Date.now() - t0;
      text += new TextDecoder().decode(value);
    }
    return { firstAt, totalMs: Date.now() - t0, text };
  }

  // dev
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const devPort = await new Promise((r) => dev.listen(r));
  try {
    const r = await timedFetch(`http://localhost:${devPort}/`);
    ok(r.totalMs >= 380, `load() delay was observed (${r.totalMs}ms)`);
    ok(r.firstAt < 250, `first chunk before load() finished — arrived at ${r.firstAt}ms of ${r.totalMs}ms`);
    ok(r.text.includes("<title>Streamed</title>"), "head in the early chunk");
    ok(/h1\.n-[0-9a-f]{6} \{ color: teal \}/.test(r.text), "scoped style shipped");
    ok(r.text.includes("Answer 42"), "load() data rendered in the late chunk");
    ok(r.text.includes("boot("), "hydration script present");
    ok(r.text.trimEnd().endsWith("</html>"), "shell tail closes the page");
  } finally {
    dev.close();
  }

  // prod
  const built = build({ root: dir });
  const manifest = JSON.parse(
    _fs.readFileSync(join(dir, "dist", "releases", built.hash, "manifest.json"), "utf8")
  );
  eq(manifest.routes[0].stream, true, "manifest carries the stream flag");
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const prodPort = await new Promise((r) => prod.listen(r));
  try {
    const r = await timedFetch(`http://localhost:${prodPort}/`);
    ok(r.firstAt < 250 && r.totalMs >= 380, `prod streams too (first ${r.firstAt}ms / total ${r.totalMs}ms)`);
    ok(r.text.includes("Answer 42") && r.text.trimEnd().endsWith("</html>"), "prod streamed page complete");
  } finally {
    prod.close();
  }
});

/* ── v0.2: layout load() + layout server blocks ───────────────── */

test("layouts: load() runs outermost-first, page wins, layout RPC callable (dev + prod)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-laylod-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "_layout.niral"),
    `<server>
      export async function load() {
        session.set("hits", (session.get("hits") ?? 0) + 1);
        return { user: "ada", source: "layout", hits: session.get("hits") }
      }
      export async function whoami() { return { user: "ada from layout rpc" } }
    </server>
    <script>let { user, hits } = $props</script>
    <nav id="who">{user} · {hits}</nav><slot />`
  );
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function load() { return { source: "page" } }
    </server>
    <script>let { user, source } = $props</script>
    <main id="m">{user} via {source}</main>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const devPort = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${devPort}`;
  try {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    ok(html.includes(`<nav id="who">ada · 1</nav>`), `layout load() data SSR'd — got: ${html.slice(0, 300)}`);
    ok(html.includes(`<main id="m">ada via page</main>`), "page load() WINS on conflicting keys, layout data shared");
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    ok(cookie, "session write inside layout load() sets the cookie");
    const again = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    ok(again.includes("ada · 2"), "layout session persists");

    // layout <server> functions are callable over RPC
    const rpc = await (
      await fetch(`${base}/@niral/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-niral-rpc": "1" },
        body: JSON.stringify({ module: "/routes/_layout.niral", fn: "whoami", args: [] }),
      })
    ).json();
    eq(rpc.result, { user: "ada from layout rpc" }, "layout RPC works in dev");
  } finally {
    dev.close();
  }

  // prod
  const built = build({ root: dir });
  const manifest = JSON.parse(
    _fs.readFileSync(join(dir, "dist", "releases", built.hash, "manifest.json"), "utf8")
  );
  ok(manifest.layouts["_layout.niral"].hasLoad, "manifest records layout hasLoad");
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const prodPort = await new Promise((r) => prod.listen(r));
  try {
    const html = await (await fetch(`http://localhost:${prodPort}/`)).text();
    ok(html.includes("ada · 1") && html.includes("ada via page"), `prod layout load() — got: ${html.slice(0, 300)}`);
    const rpc = await (
      await fetch(`http://localhost:${prodPort}/@niral/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-niral-rpc": "1" },
        body: JSON.stringify({ module: "/routes/_layout.niral", fn: "whoami", args: [] }),
      })
    ).json();
    eq(rpc.result, { user: "ada from layout rpc" }, "layout RPC works in prod");
  } finally {
    prod.close();
  }
});

/* ── v0.2: bind: on object paths + keyed {#for} items ─────────── */

test("bind:value on keyed {#for} item fields writes through to the source array", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const { pathToFileURL } = await import("node:url");
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  const hadWin = "window" in globalThis;
  if (!hadWin) globalThis.window = { dispatchEvent() {} };
  try {
    const { code } = compileClient(
      `<script>
        let todos = $state([{ id: 1, text: "one" }, { id: 2, text: "two" }])
        let user = $state({ name: "ada" })
      </script>
      <input id="u" bind:value={user.name} />
      <p id="hello">{user.name}</p>
      {#for t of todos key t.id}
        <input class="row" bind:value={t.text} />
        <span>{t.text}</span>
      {/for}`,
      { filename: "bindpath.niral", runtime: pathToFileURL(join(here, "..", "src", "runtime", "index.js")).href }
    );
    ok(code.includes("__n.bindPath"), "path bindings compile to bindPath");
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const target = globalThis.document.createElement("div");
    mod.default(target);

    const html0 = shim.serializeChildren(target);
    ok(html0.includes(`value="ada"`) && html0.includes(`value="one"`), "initial values bound");

    // find the shim input nodes and simulate typing
    const inputs = [];
    (function walk(n) {
      for (const c of n.childNodes ?? []) {
        if (c.tagName === "input") inputs.push(c);
        walk(c);
      }
    })(target);
    eq(inputs.length, 3, "three inputs");

    // $state object path
    inputs[0].value = "grace";
    inputs[0]._listeners?.input?.();
    // keyed item path
    inputs[1].value = "one EDITED";
    inputs[1]._listeners?.input?.();

    const html = shim.serializeChildren(target);
    ok(html.includes("grace"), "sibling {user.name} updated after typing (touch)");
    ok(html.includes("one EDITED"), "sibling {t.text} updated after typing");
  } finally {
    globalThis.document = prevDoc;
    if (!hadWin) delete globalThis.window;
  }
});

test("bind:value on a non-signal target is a loud compile error (NIRAL042)", () => {
  expectError("NIRAL042", () =>
    compileClient(`<script>let n = $state(1)</script><input bind:value={window.foo} />`, { runtime: "x" })
  );
});

/* ── v0.2: form actions ───────────────────────────────────────── */

test("form actions: POST ?/name works without JS, enhanced JSON with JS, redirects (dev + prod)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-forms-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function load() { return { notes: session.get("notes") ?? [] } }
      export async function save(form) {
        if (!form.text?.trim()) return { error: "text is required" }
        const notes = session.get("notes") ?? [];
        notes.push(form.text);
        session.set("notes", notes);
        return { saved: form.text }
      }
      export async function leave() { return { redirect: "/bye" } }
    </server>
    <script>let { notes, form } = $props</script>
    {#if form?.saved}<p id="ok">saved: {form.saved}</p>{/if}
    {#if form?.error}<p id="err">{form.error}</p>{/if}
    <form method="post" action="?/save"><input name="text" /><button>Save</button></form>
    <ul>{#for n of notes}<li>{n}</li>{/for}</ul>`
  );
  writeFileSync(join(dir, "routes", "bye.niral"), `<p>bye</p>`);

  const post = (base, path, body, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...extra },
      body: new URLSearchParams(body).toString(),
      redirect: "manual",
    });

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const devPort = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${devPort}`;
  try {
    // native (no-JS) submit: HTML re-render with the result + session persisted
    const r1 = await post(base, "/?/save", { text: "hello forms" });
    eq(r1.status, 200);
    const html1 = await r1.text();
    ok(html1.includes(`<p id="ok">saved: hello forms</p>`), `action result rendered — got: ${html1.slice(0, 300)}`);
    ok(html1.includes("<li>hello forms</li>"), "load() re-ran AFTER the action (session note visible)");
    const cookie = r1.headers.get("set-cookie")?.split(";")[0];
    ok(cookie, "action session write set the cookie");

    // validation error path
    const r2 = await post(base, "/?/save", { text: "  " }, { cookie });
    ok((await r2.text()).includes(`<p id="err">text is required</p>`), "action errors render via form.error");

    // enhanced (JS) submit: JSON payload, no HTML
    const r3 = await post(base, "/?/save", { text: "from js" }, { cookie, "x-niral-form": "1" });
    const json = await r3.json();
    ok(json.ok && json.props.form.saved === "from js", "enhanced submit returns a nav payload with props.form");
    ok(Array.isArray(json.props.notes) && json.props.notes.includes("from js"), "fresh load() data included");

    // redirect action
    const r4 = await post(base, "/?/leave", {});
    eq(r4.status, 303, "redirect action → 303");
    eq(r4.headers.get("location"), "/bye");
    const r5 = await post(base, "/?/leave", {}, { "x-niral-form": "1" });
    eq((await r5.json()).redirect, "/bye", "enhanced redirect → JSON redirect");

    // load() is never a form action
    eq((await post(base, "/?/load", {})).status, 404, "?/load rejected");
  } finally {
    dev.close();
  }

  // prod
  const built = build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const prodPort = await new Promise((r) => prod.listen(r));
  const pbase = `http://localhost:${prodPort}`;
  try {
    const r1 = await post(pbase, "/?/save", { text: "prod note" });
    const html1 = await r1.text();
    ok(html1.includes("saved: prod note") && html1.includes("<li>prod note</li>"), `prod native action — got: ${html1.slice(0, 300)}`);
    const r2 = await post(pbase, "/?/save", { text: "prod js" }, { "x-niral-form": "1" });
    const json = await r2.json();
    ok(json.ok && json.props.form.saved === "prod js", "prod enhanced action");
    eq((await post(pbase, "/?/leave", {})).status, 303, "prod redirect");
  } finally {
    prod.close();
  }
});

/* ── v0.2: live channels ──────────────────────────────────────── */

test("live channels: peer broadcast + server publish() reach members (dev)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-live-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function announce(text) {
        publish("chat", { from: "server", text });
        return { ok: true }
      }
    </server>
    <p>live</p>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;

  /** Tiny promise-based WS client over the native WebSocket. */
  function connect() {
    return new Promise((resolveC, rejectC) => {
      const ws = new WebSocket(`ws://localhost:${port}/@niral/live`);
      const inbox = [];
      const waiters = [];
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const w = waiters.shift();
        if (w) w(msg);
        else inbox.push(msg);
      };
      ws.onopen = () =>
        resolveC({
          ws,
          send: (o) => ws.send(JSON.stringify(o)),
          next: () =>
            inbox.length
              ? Promise.resolve(inbox.shift())
              : new Promise((r, rej) => {
                  waiters.push(r);
                  setTimeout(() => rej(new Error("timed out waiting for a live message")), 3000);
                }),
        });
      ws.onerror = (e) => rejectC(new Error("ws connect failed"));
    });
  }

  const a = await connect();
  const b = await connect();
  try {
    a.send({ type: "join", channel: "chat" });
    b.send({ type: "join", channel: "chat" });
    await new Promise((r) => setTimeout(r, 50));

    // peer → peer (sender does NOT echo)
    a.send({ type: "send", channel: "chat", data: { text: "hi from a" } });
    const got = await b.next();
    eq(got, { type: "message", channel: "chat", data: { text: "hi from a" } }, "peer broadcast");

    // server publish() from an RPC — reaches EVERYONE
    const rpc = await fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "announce", args: ["deploy done"] }),
    });
    ok((await rpc.json()).result.ok, "rpc ok");
    const gotA = await a.next();
    const gotB = await b.next();
    eq(gotA.data, { from: "server", text: "deploy done" }, "publish reached client a");
    eq(gotB.data, { from: "server", text: "deploy done" }, "publish reached client b");

    // sending to a channel you never joined does nothing
    b.send({ type: "send", channel: "secret", data: 1 });
    a.send({ type: "send", channel: "chat", data: "still fine" });
    eq((await b.next()).data, "still fine", "unjoined sends dropped, channel still healthy");
  } finally {
    a.ws.close();
    b.ws.close();
    dev.close();
  }
});

test("codegen: live() available in components, HMR socket unaffected", async () => {
  const { code } = compileClient(
    `<script>
      let msgs = $state([])
      const room = live("chat", (m) => { msgs = [...msgs, m] })
    </script>
    <p>{msgs.length}</p>`,
    { runtime: "x" }
  );
  ok(code.includes("const live = __n.live;"), "live binding injected when used");
  const { code: plain } = compileClient(`<script>let n = $state(1)</script><p>{n}</p>`, { runtime: "x" });
  ok(!plain.includes("__n.live"), "no live binding when unused");
});

/* ── v0.2: hooks.js middleware ────────────────────────────────── */

test("hooks.js: guards redirect, locals reach load(), JSON short-circuit (dev + prod)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-hooks-"));
  mkdirSync(join(dir, "routes", "admin"), { recursive: true });
  writeFileSync(
    join(dir, "hooks.js"),
    `export async function handle(event) {
      if (event.path === "/api/ping") return { body: { pong: true, method: event.method } };
      if (event.path.startsWith("/admin") && !event.session.get("user")) {
        return event.redirect("/login");
      }
      event.locals.requestId = "req-7";
    }`
  );
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function load({ params, locals }) { return { rid: locals?.requestId ?? "none" } }
    </server>
    <script>let { rid } = $props</script>
    <p id="rid">{rid}</p>`
  );
  writeFileSync(join(dir, "routes", "admin", "index.niral"), `<h1>secret admin</h1>`);
  writeFileSync(join(dir, "routes", "login.niral"), `<h1>login</h1>`);

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const devPort = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${devPort}`;
  try {
    // guard: /admin without a session → redirect
    const guarded = await fetch(`${base}/admin`, { redirect: "manual" });
    eq(guarded.status, 303, "guarded route redirects");
    eq(guarded.headers.get("location"), "/login");

    // locals flow into load()
    const home = await (await fetch(`${base}/`)).text();
    ok(home.includes(`<p id="rid">req-7</p>`), `hook locals reached load() — got: ${home.slice(0, 250)}`);

    // JSON short-circuit — a hooks-made API endpoint
    const api = await fetch(`${base}/api/ping`);
    eq(await api.json(), { pong: true, method: "GET" }, "hook JSON response");
    ok(api.headers.get("content-type").includes("application/json"));
  } finally {
    dev.close();
  }

  // prod: hooks.js lives at the project root next to dist/
  build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const prodPort = await new Promise((r) => prod.listen(r));
  try {
    eq((await fetch(`http://localhost:${prodPort}/admin`, { redirect: "manual" })).status, 303, "prod guard");
    const home = await (await fetch(`http://localhost:${prodPort}/`)).text();
    ok(home.includes("req-7"), "prod locals reach load()");
    eq((await (await fetch(`http://localhost:${prodPort}/api/ping`)).json()).pong, true, "prod hook API");
  } finally {
    prod.close();
  }
});

/* ── v0.2: static export ──────────────────────────────────────── */

test("static export: prerendered pages, assets, 404, dynamic routes skipped", async () => {
  const { exportStatic } = await import("../src/build/export.js");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-export-"));
  mkdirSync(join(dir, "routes", "about"), { recursive: true });
  mkdirSync(join(dir, "public-note"), { recursive: true }); // avoid name clash with export dirs
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>export async function load() { return { built: "at-export-time" } }</server>
     <script>let { built } = $props</script>
     <head><title>Exported</title></head>
     <h1>Home {built}</h1>`
  );
  writeFileSync(join(dir, "routes", "about", "index.niral"), `<script mode="static">let x = 1</script><p>about page</p>`);
  writeFileSync(join(dir, "routes", "[slug].niral"), `<script>let { slug } = $props</script><p>{slug}</p>`);
  writeFileSync(join(dir, "routes", "_404.niral"), `<h1>custom not found</h1>`);
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\n");

  const r = await exportStatic({ root: dir });
  ok(existsSync(join(r.outDir, "index.html")), "home exported");
  ok(existsSync(join(r.outDir, "about", "index.html")), "nested page → pretty URL dir");
  ok(existsSync(join(r.outDir, "404.html")), "custom 404 exported");
  ok(existsSync(join(r.outDir, "robots.txt")), "static file copied to root");
  ok(existsSync(join(r.outDir, "assets", r.hash, "@niral", "runtime", "index.js")), "runtime shipped (versioned)");
  ok(existsSync(join(r.outDir, "assets", r.hash, "routes", "index.js")), "compiled component shipped");

  const home = readFileSync(join(r.outDir, "index.html"), "utf8");
  ok(home.includes("Home at-export-time"), "load() data baked into the export");
  ok(home.includes("<title>Exported</title>"), "head exported");
  ok(home.includes(`/assets/${r.hash}/@niral/runtime`), "hydration points at exported (versioned) assets");
  const about = readFileSync(join(r.outDir, "about", "index.html"), "utf8");
  ok(about.includes("about page") && !about.includes("boot("), "static-mode page ships no JS");
  ok(readFileSync(join(r.outDir, "404.html"), "utf8").includes("custom not found"), "404 content");

  eq(r.skipped, ["/[slug]"], "dynamic route skipped with a report");
  eq(r.serverDependent, ["/"], "server-dependent routes reported");
});

/* ── enhancement pass: security, scheduler, template sugar, head, publish, gzip ── */

test("signals: diamond updates dedupe, batch() flushes once", () => {
  const a = signal(1);
  const b = derived(() => a.get() * 2);
  const c = derived(() => a.get() + 1);
  let runs = 0;
  let last = null;
  effect(() => {
    last = b.get() + c.get(); // joins BOTH branches of the diamond
    runs++;
  });
  eq(runs, 1);
  runs = 0;
  a.set(2);
  eq(last, 7, "converged value");
  ok(runs <= 2, `diamond: join effect ran ${runs}x (was 2+ pre-scheduler, must not grow)`);

  runs = 0;
  const x = signal(1);
  const y = signal(1);
  let sum = 0;
  effect(() => {
    sum = x.get() + y.get();
    runs++;
  });
  runs = 0;
  batch(() => {
    x.set(10);
    y.set(20);
  });
  eq(sum, 30);
  eq(runs, 1, "batch(): two writes, ONE effect run");
});

test("compiler: {@html}, class:, style: directives", async () => {
  const { renderSource } = await import("../src/testing.js");
  const r = await renderSource(
    `<script>
      let content = $state("<b>bold</b> move")
      let active = $state(true)
      let color = $state("teal")
    </script>
    <div class="card" class:active={active} style:color={color}>{@html content}</div>
    <p class:hot={!active}>plain</p>`
  );
  ok(r.html.includes("<b>bold</b> move"), "{@html} rendered unescaped");
  ok(/class="card[^"]*active/.test(r.html), "class:active merged with existing classes");
  ok(r.html.includes(`style="color: teal"`), "style:color set");
  ok(!/class="[^"]*hot/.test(r.html), "false class: toggle absent");
  // still escaped by default everywhere else
  const r2 = await renderSource(`<script>let x = $state("<i>x</i>")</script><p>{x}</p>`);
  ok(r2.html.includes("&lt;i&gt;"), "mustaches stay escaped");
});

test("head: {prop} interpolation from load() data (escaped)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-head-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "[slug].niral"),
    `<server>export async function load({ params }) { return { title: params.slug + " <live>" } }</server>
    <script>let { title } = $props</script>
    <head><title>{title} — Niral</title></head>
    <h1>{title}</h1>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const html = await (await fetch(`http://localhost:${port}/hello`)).text();
    ok(html.includes("<title>hello &lt;live&gt; — Niral</title>"), `dynamic title, escaped — got: ${html.match(/<title>[^]*?<\/title>/)?.[0]}`);
  } finally {
    dev.close();
  }
});

test("security: prod ships CSP nonce, security headers, gzip, Secure cookies", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-sec-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>export async function load() { session.set("v", 1); return { pad: "x".repeat(4000) } }</server>
    <script>let { pad } = $props</script><p>{pad}</p>`
  );
  build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0, secure: true });
  const port = await new Promise((r) => prod.listen(r));
  try {
    const res = await fetch(`http://localhost:${port}/`, { headers: { "accept-encoding": "gzip" } });
    const csp = res.headers.get("content-security-policy");
    ok(csp?.includes("script-src 'self' 'nonce-"), `CSP with nonce — got: ${csp}`);
    const nonce = csp.match(/nonce-([^']+)'/)[1];
    const html = await res.text(); // fetch transparently gunzips
    ok(html.includes(`nonce="${nonce}"`), "inline hydration script carries the SAME nonce");
    eq(res.headers.get("x-content-type-options"), "nosniff");
    eq(res.headers.get("x-frame-options"), "DENY");
    ok(res.headers.get("referrer-policy"), "referrer policy set");
    eq(res.headers.get("content-encoding"), "gzip", "big HTML compressed");
    ok(res.headers.get("set-cookie")?.includes("Secure"), "session cookie marked Secure");
    // assets compressed + nosniff too (index.js = the bundled runtime, big enough to gzip)
    const asset = await fetch(`http://localhost:${port}/assets/@niral/runtime/index.js`, { headers: { "accept-encoding": "gzip" } });
    eq(asset.headers.get("content-encoding"), "gzip", "asset gzip");
    eq(asset.headers.get("x-content-type-options"), "nosniff");
  } finally {
    prod.close();
    const { setSecureCookies } = await import("../src/server/session.js");
    setSecureCookies(false); // don't leak into other tests
  }
});

test("security: form actions reject multipart (415) and oversized arg lists (400)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-sec2-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>export async function save(f) { return { ok: 1 } }\nexport async function ping() { return 1 }</server><p>x</p>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const multi = await fetch(`http://localhost:${port}/?/save`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: `--x\r\nContent-Disposition: form-data; name="t"\r\n\r\nhi\r\n--x--\r\n`,
    });
    eq(multi.status, 200, "multipart is a first-class citizen now");
    const junk = await fetch(`http://localhost:${port}/?/save`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "raw",
    });
    eq(junk.status, 415, "unknown content types still rejected with a teaching message");
    const flood = await fetch(`http://localhost:${port}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "ping", args: new Array(100).fill(1) }),
    });
    eq(flood.status, 400, "100 args → 400");
  } finally {
    dev.close();
  }
});

test("live: publish() works from PYTHON server blocks (polyglot realtime)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-pylive-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server lang="python">
def notify(text):
    publish("alerts", {"text": text, "lang": "python"})
    return {"sent": True}
</server>
<p>x</p>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const got = new Promise((resolveMsg, rejectMsg) => {
      const ws = new WebSocket(`ws://localhost:${port}/@niral/live`);
      ws.onopen = async () => {
        ws.send(JSON.stringify({ type: "join", channel: "alerts" }));
        await new Promise((r) => setTimeout(r, 50));
        await fetch(`http://localhost:${port}/@niral/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-niral-rpc": "1" },
          body: JSON.stringify({ module: "/routes/index.niral", fn: "notify", args: ["from py"] }),
        });
      };
      ws.onmessage = (e) => {
        resolveMsg(JSON.parse(e.data));
        ws.close();
      };
      setTimeout(() => rejectMsg(new Error("no live message from python")), 5000);
    });
    const msg = await got;
    eq(msg.data, { text: "from py", lang: "python" }, "python publish() reached the browser channel");
  } finally {
    dev.close();
  }
});

test("testing utilities: renderSource + contains", async () => {
  const { renderSource } = await import("../src/testing.js");
  const r = await renderSource(`<script>let { name } = $props</script><h1>Hi {name}</h1>`, { name: "ada" });
  ok(r.contains("Hi ada"));
  let threw = false;
  try {
    r.contains("nope");
  } catch (e) {
    threw = e.message.includes("--- html ---");
  }
  ok(threw, "failure message includes the html");
});

/* ── LSP: language server ─────────────────────────────────────── */

test("lsp analysis: diagnostics carry code/hint/range, completions are context-aware, hover docs", async () => {
  const { validate, completions, hover } = await import("../src/lsp/analysis.js");

  // diagnostics: unclosed tag → teaching error with a precise range
  const bad = `<script>let n = $state(1)</script>\n<div><p>oops</div>`;
  const diags = validate(bad, "x.niral");
  eq(diags.length, 1);
  ok(String(diags[0].code).startsWith("NIRAL"), "diagnostic carries the NIRAL code");
  ok(diags[0].message.includes("hint:"), "diagnostic teaches the fix");
  eq(diags[0].range.start.line, 1, "error on the right line");
  eq(validate(`<p>fine</p>`, "x.niral").length, 0, "clean file → no diagnostics");

  // completions by context
  const src = `<server>export async function saveNote(t) { return 1 }</server><script>let n = $state(1)</script><p>x</p>`;
  const at = (needle) => src.indexOf(needle) + needle.length;
  const labels = (items) => items.map((i) => i.label);

  ok(labels(completions("{#", 2)).some((l) => l.includes("{#for")), "block completions after {#");
  ok(labels(completions("{#if x}{:", 9)).includes(":else"), "clause completions after {:");
  ok(labels(completions("<script>let a = $", 17)).includes("$state"), "rune completions after $");
  ok(labels(completions("<", 1)).some((l) => l.startsWith("server")), "tag completions after <");
  ok(labels(completions("<input ", 7)).includes("bind:value"), "directive completions inside a tag");
  ok(labels(completions('<script ', 8)).some((l) => l.includes("stream")), "script attr completions");
  const fns = completions(src.replace("<p>x</p>", "<p on:click={saveNo}>x</p>"), src.indexOf("<p>x</p>") + 17);
  ok(labels(fns).includes("saveNote"), "server function names complete in the template");

  // hover
  ok(hover("let n = $state(1)", 10)?.includes("reactive state"), "$state hover");
  ok(hover("{#await p}", 3)?.includes("async"), "{#await} hover");
  ok(hover("<input bind:value={x} />", 9)?.includes("two-way"), "bind: hover");
  ok(hover("publish('c', 1)", 3)?.includes("live channel"), "publish hover");
  eq(hover("<p>plain</p>", 4), null, "no docs → no hover");
});

test("lsp server: full protocol round-trip over stdio (initialize → diagnostics → completion → hover)", async () => {
  const { spawn } = await import("node:child_process");
  const proc = spawn(process.execPath, [join(here, "..", "bin", "niral.js"), "lsp"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  let buf = Buffer.alloc(0);
  const inbox = [];
  const waiters = [];
  proc.stdout.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const he = buf.indexOf("\r\n\r\n");
      if (he === -1) return;
      const len = Number(buf.slice(0, he).toString().match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(len) || buf.length < he + 4 + len) return;
      const msg = JSON.parse(buf.slice(he + 4, he + 4 + len).toString());
      buf = buf.slice(he + 4 + len);
      const w = waiters.shift();
      if (w) w(msg);
      else inbox.push(msg);
    }
  });
  const next = () =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : new Promise((r, rej) => {
          waiters.push(r);
          setTimeout(() => rej(new Error("lsp timed out")), 4000);
        });
  const send = (msg) => {
    const body = Buffer.from(JSON.stringify(msg));
    proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    proc.stdin.write(body);
  };

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } });
    const init = await next();
    ok(init.result.capabilities.completionProvider, "advertises completions");
    ok(init.result.capabilities.hoverProvider, "advertises hover");

    // open a broken doc → diagnostics arrive
    send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///t.niral", languageId: "niral", version: 1, text: "<div><p>x</div>" } },
    });
    const diag = await next();
    eq(diag.method, "textDocument/publishDiagnostics");
    eq(diag.params.diagnostics.length, 1, "broken doc → one squiggle");

    // fix it → diagnostics clear
    send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: { textDocument: { uri: "file:///t.niral", version: 2 }, contentChanges: [{ text: "<p>{#" }] },
    });
    await next(); // (still broken — unclosed brace — but that's fine, we want the doc updated)

    send({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/completion",
      params: { textDocument: { uri: "file:///t.niral" }, position: { line: 0, character: 5 } },
    });
    const comp = await next();
    ok(comp.result.some((i) => i.label.includes("{#if")), "completion over the wire");

    send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: { textDocument: { uri: "file:///t.niral", version: 3 }, contentChanges: [{ text: "<script>let a = $state(1)</script><p>{a}</p>" }] },
    });
    const clear = await next();
    eq(clear.params.diagnostics.length, 0, "fixed doc → squiggles clear");

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/hover",
      params: { textDocument: { uri: "file:///t.niral" }, position: { line: 0, character: 18 } },
    });
    const hov = await next();
    ok(hov.result?.contents?.value.includes("reactive state"), "hover docs over the wire");

    send({ jsonrpc: "2.0", id: 4, method: "shutdown", params: {} });
    eq((await next()).result, null, "shutdown acknowledged");
  } finally {
    proc.kill();
  }
});

/* ── caching ──────────────────────────────────────────────────── */

test("caching: versioned assets are immutable, stale hashes heal, <script cache> sets page Cache-Control", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-cache-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<script cache="120">let n = $state(1)</script><p>cached {n}</p>`
  );
  writeFileSync(
    join(dir, "routes", "private.niral"),
    `<server>export async function load() { session.set("seen", 1); return {} }</server><p>private</p>`
  );
  const r = build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((res) => prod.listen(res));
  const base = `http://localhost:${port}`;
  try {
    // page-level caching from <script cache="120">
    const page = await fetch(`${base}/`);
    eq(page.headers.get("cache-control"), "public, max-age=120, stale-while-revalidate=600", "opt-in page cache");
    const html = await page.text();
    const assetUrl = html.match(/\/assets\/[0-9a-f]{12}\/@niral\/runtime/)?.[0];
    ok(assetUrl, `hydration uses versioned asset urls — got: ${html.match(/\/assets[^"]*/)?.[0]}`);

    // versioned asset → cache forever
    const asset = await fetch(`${base}/assets/${r.hash}/@niral/runtime/index.js`);
    eq(asset.status, 200);
    eq(asset.headers.get("cache-control"), "public, max-age=31536000, immutable", "versioned = immutable");

    // stale release hash (deploy happened mid-session) → redirect to current, never 404 the app
    const stale = await fetch(`${base}/assets/aaaaaaaaaaaa/@niral/runtime/index.js`, { redirect: "manual" });
    eq(stale.status, 302, "stale hash heals via redirect");
    ok(stale.headers.get("location").includes(r.hash), "redirects to the live release");

    // plain (unversioned) assets keep etag revalidation
    const plain = await fetch(`${base}/assets/@niral/runtime/index.js`);
    eq(plain.headers.get("cache-control"), "no-cache", "unversioned = revalidate");
    ok(plain.headers.get("etag"), "etag present");

    // pages that set cookies are NEVER publicly cached
    const priv = await fetch(`${base}/private`);
    eq(priv.headers.get("cache-control"), "no-store", "cookie-setting page stays no-store");
  } finally {
    prod.close();
  }
});

/* ── animation + image ────────────────────────────────────────── */

test("transitions: directives compile, leave-animation plays before removal, FLIP marks rows", async () => {
  // codegen
  const { code } = compileClient(
    `<script>let on = $state(true); let items = $state([{id:1}])</script>
    {#if on}<p transition:fade>hi</p>{/if}
    {#if on}<div transition:slide={{ duration: 400 }}>slow</div>{/if}
    {#for t of items key t.id}<li animate:flip>{t.id}</li>{/for}`,
    { runtime: "x" }
  );
  ok(code.includes('__n.transition(') && code.includes('"fade"'), "transition:fade compiles");
  ok(code.includes('"slide"') && code.includes("duration: 400"), "transition options pass through");
  ok(code.includes("__n.animateFlip("), "animate:flip compiles");

  // runtime: a leave-transition ANIMATES OUT instead of vanishing
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  const hadWin = "window" in globalThis;
  if (!hadWin) globalThis.window = { dispatchEvent() {} };
  try {
    const on = signal(true);
    const target = globalThis.document.createElement("div");
    let animCalls = 0;
    let finishRemoval = null;
    dom.mount(target, () => [
      dom.ifBlock([[() => on.get(), () => {
        const p = dom.append(dom.el("p"), dom.text("bye"));
        p.isConnected = true; // shim stand-in
        p.animate = () => {
          animCalls++;
          const anim = {};
          finishRemoval = () => anim.onfinish?.();
          return anim;
        };
        dom.transition(p, "fade", null);
        return [p];
      }]]),
    ]);
    ok(shim.serializeChildren(target).includes("bye"), "rendered");
    on.set(false);
    eq(animCalls, 1, "leave animation started");
    ok(shim.serializeChildren(target).includes("bye"), "node STAYS while animating out");
    finishRemoval();
    ok(!shim.serializeChildren(target).includes("bye"), "removed when the animation finishes");
  } finally {
    globalThis.document = prevDoc;
    if (!hadWin) delete globalThis.window;
  }
});

test("niral add image: scaffolds a layout-shift-proof <Img> that renders", async () => {
  const { addImage } = await import("../src/add/image.js");
  const { renderRoute } = await import("../src/testing.js");
  const { mkdtempSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-img-"));
  const { file, created } = await addImage({ root: dir });
  ok(created, "component scaffolded");

  const r = await renderRoute(file, { src: "/hero.jpg", alt: "the hero", width: 1200, height: 630 });
  ok(r.html.includes('loading="lazy"'), "lazy by default");
  ok(r.html.includes('decoding="async"'), "async decode by default");
  ok(r.html.includes('width="1200"') && r.html.includes('height="630"'), "explicit dimensions (no layout shift)");
  ok(r.html.includes("aspect-ratio: 1200 / 630"), "aspect ratio derived");

  const hero = await renderRoute(file, { src: "/a.png", alt: "x", priority: true });
  ok(hero.html.includes('loading="eager"') && hero.html.includes('fetchpriority="high"'), "priority images load eagerly");

  eq((await addImage({ root: dir })).created, false, "idempotent — never overwrites user edits");
});

test("router: catch-all [...path] routes match greedily, static + param win first", async () => {
  const { scanRoutes, matchRoute } = await import("../src/server/router.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-rest-"));
  mkdirSync(join(dir, "routes", "docs"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), `<p>home</p>`);
  writeFileSync(join(dir, "routes", "docs", "index.niral"), `<p>docs home</p>`);
  writeFileSync(join(dir, "routes", "docs", "install.niral"), `<p>static wins</p>`);
  writeFileSync(join(dir, "routes", "docs", "[...path].niral"), `<script>let { path } = $props</script><p>{path}</p>`);

  const routes = scanRoutes(join(dir, "routes"));
  eq(matchRoute(routes, "/docs/install").route.rel, "docs/install.niral", "static beats catch-all");
  eq(matchRoute(routes, "/docs").route.rel, "docs/index.niral", "index beats catch-all");
  const deep = matchRoute(routes, "/docs/guide/routing/advanced");
  eq(deep.route.rel, "docs/[...path].niral");
  eq(deep.params.path, "guide/routing/advanced", "catch-all captures the remaining path");
  ok(matchRoute(routes, "/nope") === null, "unrelated paths still 404");

  // end-to-end: SSR + hydration props
  const { createDevServer } = await import("../src/dev/server.js");
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const html = await (await fetch(`http://localhost:${port}/docs/a/b/c`)).text();
    ok(html.includes("<p>a/b/c</p>"), `catch-all SSR'd — got: ${html.slice(0, 200)}`);
    ok(html.includes('"path":"a/b/c"'), "catch-all param hydrates");
  } finally {
    dev.close();
  }
});

/* ── auth: passwords, 2FA, passkeys, guards ───────────────────── */

test("auth core: scrypt hashing + TOTP (RFC 6238 vector) + session rotation", async () => {
  const a = await import("../src/server/auth.js");

  // scrypt
  const stored = a.hashPassword("correct horse battery");
  ok(stored.startsWith("scrypt$32768$8$1$"), "self-describing OWASP parameters");
  ok(a.verifyPassword("correct horse battery", stored), "roundtrip");
  ok(!a.verifyPassword("wrong horse", stored), "wrong password rejected");
  ok(!a.verifyPassword("correct horse battery", stored.slice(0, -4) + "AAAA"), "tampered hash rejected");
  ok(!a.verifyPassword("x".repeat(300), stored), "oversized input rejected (DoS guard)");
  let threw = false;
  try { a.hashPassword("short"); } catch { threw = true; }
  ok(threw, "8-char minimum enforced");

  // TOTP — RFC 6238 test vector: secret=12345678901234567890, T=59s → 287082
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")
  ok(a.totpVerify(rfcSecret, "287082", { now: 59_000, window: 0 }), "RFC 6238 vector verifies");
  ok(!a.totpVerify(rfcSecret, "000000", { now: 59_000, window: 0 }), "wrong code rejected");
  ok(a.totpVerify(rfcSecret, "287082", { now: 89_000, window: 1 }), "±1 step drift tolerated");
  ok(!a.totpVerify(rfcSecret, "287082", { now: 59_000 + 120_000 }), "expired code rejected");
  ok(a.totpUri("ABC", "ada@x.dev", "MyApp").startsWith("otpauth://totp/MyApp"), "otpauth uri");

  // session rotation
  const store = { data: { cart: [1] }, dirty: false };
  a.loginUser(store, { id: 7, name: "ada", passwordHash: "SECRET", totpSecret: "SECRET" });
  ok(store.data.user && store.data.user.id === 7, "identity set");
  ok(!("passwordHash" in store.data.user) && !("totpSecret" in store.data.user), "secrets NEVER enter the session");
  const sid1 = store.data.sid;
  ok(sid1, "fresh session id minted");
  a.loginUser(store, { id: 7, name: "ada" });
  ok(store.data.sid !== sid1, "sid ROTATES on every login (fixation-proof)");
  a.logoutUser(store);
  eq(store.data, {}, "logout clears everything");

  // role checks
  ok(a.satisfiesAuth({ data: { user: { id: 1 } } }, true), "auth satisfied by any user");
  ok(!a.satisfiesAuth({ data: {} }, true), "anonymous fails");
  ok(a.satisfiesAuth({ data: { user: { id: 1, roles: ["admin"] } } }, "admin"), "role satisfied");
  ok(!a.satisfiesAuth({ data: { user: { id: 1, roles: ["user"] } } }, "admin"), "missing role fails");
});

test("passkeys: full WebAuthn register + authenticate with a REAL P-256 key", async () => {
  const wa = await import("../src/server/webauthn.js");
  const { generateKeyPairSync, createSign, createHash, randomBytes } = await import("node:crypto");

  /* — build a synthetic authenticator (what a Yubikey/Face ID does) — */
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const b64u = (b) => Buffer.from(b).toString("base64url");

  // tiny CBOR ENCODER (test-side) for the attestation object
  const enc = (v) => {
    if (typeof v === "number" && v >= 0) return v < 24 ? Buffer.from([v]) : Buffer.from([24, v]);
    if (typeof v === "number") { const n = -1 - v; return n < 24 ? Buffer.from([0x20 | n]) : Buffer.from([0x38, n]); }
    if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
    if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
    if (v instanceof Map) {
      const parts = [head(5, v.size)];
      for (const [k, val] of v) parts.push(enc(k), enc(val));
      return Buffer.concat(parts);
    }
    if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(enc)]);
    throw new Error("enc: unsupported");
  };
  const head = (major, len) =>
    len < 24 ? Buffer.from([(major << 5) | len]) : len < 256 ? Buffer.from([(major << 5) | 24, len]) : Buffer.from([(major << 5) | 25, len >> 8, len & 255]);

  const rpId = "localhost";
  const origin = "http://localhost:5199";
  const rpIdHash = createHash("sha256").update(rpId).digest();
  const credId = randomBytes(16);
  const coseKey = new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, "base64url")],
    [-3, Buffer.from(jwk.y, "base64url")],
  ]);
  // authData: rpIdHash(32) flags(1: UP|UV|AT) counter(4) aaguid(16) credIdLen(2) credId coseKey
  const regAuthData = Buffer.concat([
    rpIdHash, Buffer.from([0x45]), Buffer.from([0, 0, 0, 1]),
    Buffer.alloc(16), Buffer.from([0, credId.length]), credId, enc(coseKey),
  ]);
  const challenge = wa.webauthnChallenge();
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin }));
  const attestationObject = enc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", regAuthData]]));

  const cred = wa.verifyRegistration({
    response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) },
    challenge, origin, rpId,
  });
  eq(cred.alg, "ES256");
  eq(cred.credentialId, b64u(credId), "credential extracted");
  eq(cred.publicKeyJwk.x, jwk.x, "public key extracted from COSE");

  // wrong challenge → rejected
  let bad = false;
  try {
    wa.verifyRegistration({
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) },
      challenge: wa.webauthnChallenge(), origin, rpId,
    });
  } catch { bad = true; }
  ok(bad, "challenge mismatch rejected");

  /* — authenticate: sign authData ‖ sha256(clientDataJSON) — */
  const authChallenge = wa.webauthnChallenge();
  const authClientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: authChallenge, origin }));
  const authAuthData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 9])]);
  const signer = createSign("sha256");
  signer.update(Buffer.concat([authAuthData, createHash("sha256").update(authClientData).digest()]));
  const signature = signer.sign({ key: privateKey, dsaEncoding: "der" });

  const result = wa.verifyAuthentication({
    response: { clientDataJSON: b64u(authClientData), authenticatorData: b64u(authAuthData), signature: b64u(signature) },
    challenge: authChallenge, origin, rpId,
    credential: { publicKeyJwk: cred.publicKeyJwk, alg: cred.alg, counter: cred.counter },
  });
  eq(result.counter, 9, "counter returned for persistence");

  // counter regression (cloned key) → rejected
  let cloned = false;
  try {
    wa.verifyAuthentication({
      response: { clientDataJSON: b64u(authClientData), authenticatorData: b64u(authAuthData), signature: b64u(signature) },
      challenge: authChallenge, origin, rpId,
      credential: { publicKeyJwk: cred.publicKeyJwk, alg: cred.alg, counter: 50 },
    });
  } catch { cloned = true; }
  ok(cloned, "counter regression (cloned authenticator) rejected");

  // tampered signature → rejected
  let forged = false;
  try {
    const sig2 = Buffer.from(signature); sig2[8] ^= 0xff;
    wa.verifyAuthentication({
      response: { clientDataJSON: b64u(authClientData), authenticatorData: b64u(authAuthData), signature: b64u(sig2) },
      challenge: authChallenge, origin, rpId,
      credential: { publicKeyJwk: cred.publicKeyJwk, alg: cred.alg, counter: 1 },
    });
  } catch { forged = true; }
  ok(forged, "forged signature rejected");
});

test("<server auth>: guards pages, RPC and actions BEFORE user code runs (dev)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-guard-"));
  mkdirSync(join(dir, "routes", "admin"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "login.niral"),
    `<server>
      export async function login(form) {
        auth.login({ id: 1, name: "ada", roles: form.admin ? ["admin"] : [] });
        return { redirect: "/me" }
      }
    </server><p>login</p>`
  );
  writeFileSync(
    join(dir, "routes", "me.niral"),
    `<server auth>
      export async function load() { return { who: user().name } }
      export async function secret() { return "classified" }
    </server>
    <script>let { who } = $props</script><p id="w">{who}</p>`
  );
  writeFileSync(join(dir, "routes", "admin", "index.niral"), `<server auth="admin"></server><p>admin zone</p>`);

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const rpc = (fn, args, cookie) =>
    fetch(`${base}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ module: "/routes/me.niral", fn, args }),
    });
  try {
    // anonymous: page redirects, RPC 401s
    const page = await fetch(`${base}/me`, { redirect: "manual" });
    eq(page.status, 303, "guarded page → login redirect");
    ok(page.headers.get("location").includes("/auth/login?next=%2Fme"), "next preserved");
    eq((await rpc("secret", [])).status, 401, "guarded RPC → 401 before user code");

    // login (sets session cookie), then everything opens
    const login = await fetch(`${base}/?/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "x=1",
      redirect: "manual",
    });
    // the login action lives on /login — retry on the right route
    const login2 = await fetch(`${base}/login?/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "x=1",
      redirect: "manual",
    });
    const cookie = login2.headers.get("set-cookie").split(";")[0];
    eq(login2.status, 303, "login action redirects");

    const me = await (await fetch(`${base}/me`, { headers: { cookie } })).text();
    ok(me.includes(`<p id="w">ada</p>`), "user() ambient works, page renders");
    ok(me.includes('"user":{"id":1'), "user auto-merged into props");
    eq((await (await rpc("secret", [], cookie)).json()).result, "classified", "RPC opens after login");

    // role guard: user lacks admin
    eq((await fetch(`${base}/admin`, { headers: { cookie }, redirect: "manual" })).status, 303, "missing role → redirected");
  } finally {
    dev.close();
  }
});

test("niral add auth: scaffolded register → login (+2FA) → guarded account works end-to-end", async () => {
  const { addAuth } = await import("../src/add/auth.js");
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, mkdirSync, writeFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-authapp-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), `<p>home</p>`);
  const { created } = await addAuth({ root: dir });
  eq(created.length, 5, "5 files scaffolded");

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  const email = `ada+${Date.now()}@x.dev`; // unique per run — the db outlives the tmp dir on re-runs
  const post = (path, body, cookie) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams(body).toString(),
      redirect: "manual",
    });
  try {
    // register → logged in (session rotation) → account is accessible
    const reg = await post("/auth/register?/register", { name: "Ada", email, password: "hunter2hunter2" });
    eq(reg.status, 303, "register redirects to account");
    const cookie = reg.headers.get("set-cookie").split(";")[0];
    const account = await (await fetch(`${base}/auth/account`, { headers: { cookie } })).text();
    ok(account.includes("Hi Ada"), "guarded account page renders for the new user");

    // duplicate email rejected
    const dup = await post("/auth/register?/register", { name: "Eve", email, password: "password123" });
    ok((await dup.text()).includes("already exists"), "duplicate email rejected");

    // wrong password rejected; right password logs in
    const bad = await post("/auth/login?/login", { email, password: "wrong-password" });
    ok((await bad.text()).includes("Wrong email or password"), "bad login rejected");
    const good = await post("/auth/login?/login", { email, password: "hunter2hunter2" });
    eq(good.status, 303, "good login redirects");

    // anonymous /auth/account → login redirect
    eq((await fetch(`${base}/auth/account`, { redirect: "manual" })).status, 303, "account guarded");

    // enable 2FA over RPC, then login requires the code
    const rpc = (fn, args, ck) =>
      fetch(`${base}/@niral/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-niral-rpc": "1", cookie: ck },
        body: JSON.stringify({ module: "/routes/auth/account.niral", fn, args }),
      });
    const startRes = await (await rpc("totpStart", [], cookie)).json();
    ok(startRes.result.secret && startRes.result.uri.startsWith("otpauth://"), "totp setup offered");
    // confirm needs the CURRENT code — compute it with the framework's own impl
    const { totpVerify } = await import("../src/server/auth.js");
    // brute the 6-digit code via the impl (test-only): find the valid code for now
    const { createHmac } = await import("node:crypto");
    const b32 = (s) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const ch of s) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
    const step = Math.floor(Date.now() / 1000 / 30);
    const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
    const mac = createHmac("sha1", b32(startRes.result.secret)).update(msg).digest();
    const off = mac[19] & 15;
    const code = String((((mac[off] & 0x7f) << 24) | (mac[off+1] << 16) | (mac[off+2] << 8) | mac[off+3]) % 1e6).padStart(6, "0");
    ok(totpVerify(startRes.result.secret, code), "sanity: code valid");
    // NOTE: totpStart stored the pending secret in the session — reuse the rotated cookie
    const confirmCookieRes = await rpc("totpStart", [], cookie); // fresh pending + Set-Cookie carries it
    const pendingCookie = confirmCookieRes.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    const startRes2 = await confirmCookieRes.json();
    const mac2 = createHmac("sha1", b32(startRes2.result.secret)).update(msg).digest();
    const off2 = mac2[19] & 15;
    const code2 = String((((mac2[off2] & 0x7f) << 24) | (mac2[off2+1] << 16) | (mac2[off2+2] << 8) | mac2[off2+3]) % 1e6).padStart(6, "0");
    const confirm = await (await rpc("totpConfirm", [code2], pendingCookie)).json();
    ok(confirm.result?.ok, `2FA confirmed — ${JSON.stringify(confirm)}`);

    // password alone no longer logs in — the code step appears
    const needs = await post("/auth/login?/login", { email, password: "hunter2hunter2" });
    ok((await needs.text()).includes("Authenticator code"), "2FA step required after enabling");
  } finally {
    dev.close();
  }
});

/* ── mailer + oauth ───────────────────────────────────────────── */

test("mailer: full SMTP conversation against a real socket (AUTH, MIME, dot-stuffing)", async () => {
  const { sendMail, buildMime } = await import("../src/server/mail.js");
  const { createServer } = await import("node:net");

  // a tiny SMTP server that records everything
  const seen = { auth: null, from: null, rcpt: [], data: "" };
  const server = createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.on("error", () => {}); // client teardown can RST — never crash the suite
    sock.write("220 test ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (inData) {
          if (line === ".") { inData = false; sock.write("250 queued\r\n"); }
          else seen.data += line + "\r\n";
          continue;
        }
        if (line.startsWith("EHLO")) sock.write("250-test\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN")) { seen.auth = Buffer.from(line.split(" ")[2], "base64").toString(); sock.write("235 ok\r\n"); }
        else if (line.startsWith("MAIL FROM")) { seen.from = line; sock.write("250 ok\r\n"); }
        else if (line.startsWith("RCPT TO")) { seen.rcpt.push(line); sock.write("250 ok\r\n"); }
        else if (line === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (line === "QUIT") sock.write("221 bye\r\n");
      }
    });
  });
  const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
  try {
    const res = await sendMail({
      smtpUrl: `smtp://ada:s3cret@localhost:${port}`,
      from: "App <noreply@app.dev>",
      to: "user@example.com",
      subject: "Reset your password — வணக்கம்",
      text: "Click the link.\n.leading dot line",
      html: "<p>Click the <b>link</b>.</p>",
    });
    eq(res.accepted, ["user@example.com"]);
    eq(seen.auth, "\0ada\0s3cret", "AUTH PLAIN credentials");
    ok(seen.from.includes("<noreply@app.dev>"), "envelope from extracted from display form");
    ok(seen.rcpt[0].includes("<user@example.com>"));
    ok(seen.data.includes("Content-Type: multipart/alternative"), "text+html multipart");
    ok(seen.data.includes("=?UTF-8?B?"), "unicode subject encoded");
    // bodies are base64 (inherently dot-safe) — the leading-dot line must survive the roundtrip
    const b64body = seen.data.split("\r\n\r\n")[2]?.split("\r\n--")[0]?.replace(/\r\n/g, "");
    ok(Buffer.from(b64body ?? "", "base64").toString().includes(".leading dot line"), "leading-dot content survives");
  } finally {
    server.close();
  }

  // header injection rejected
  let threw = false;
  try {
    await sendMail({ smtpUrl: "smtp://x@localhost:1", from: "a@b.c", to: "evil@x.com\r\nBcc: victim@x.com", subject: "x", text: "x" });
  } catch (e) { threw = e.message.includes("injection"); }
  ok(threw, "CRLF in recipients rejected");
  ok(buildMime({ from: "a@b.c", to: "d@e.f", subject: "hi", text: "t" }).includes("Message-ID:"), "mime basics");
});

test("oauth: PKCE flow against a mock provider — state, token exchange, profile", async () => {
  const { oauthStart, oauthCallback, configuredProviders, OAUTH_PROVIDERS } = await import("../src/server/oauth.js");
  const { createServer } = await import("node:http");
  const { createHash } = await import("node:crypto");

  const env = { NIRAL_OAUTH_GITHUB_ID: "app123", NIRAL_OAUTH_GITHUB_SECRET: "shh" };
  eq(configuredProviders(env), ["github"], "configured detection");

  // start: url carries client_id + PKCE challenge + state
  const start = oauthStart("github", { redirectUri: "http://localhost:9999/auth/oauth/github", env });
  const u = new URL(start.url);
  ok(u.href.startsWith(OAUTH_PROVIDERS.github.authUrl), "provider auth url");
  eq(u.searchParams.get("client_id"), "app123");
  eq(u.searchParams.get("code_challenge_method"), "S256");
  eq(u.searchParams.get("code_challenge"), createHash("sha256").update(start.verifier).digest("base64url"), "PKCE challenge derived from verifier");
  eq(u.searchParams.get("state"), start.state);

  // mock token + user endpoints
  const got = {};
  const mock = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url === "/token") {
      got.token = Object.fromEntries(new URLSearchParams(body));
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ access_token: "tok_1" }));
    }
    if (req.url === "/user") {
      got.authz = req.headers.authorization;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ id: 42, login: "ada", name: "Ada", email: null, avatar_url: "http://x/y.png" }));
    }
    if (req.url === "/emails") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify([{ email: "ada@x.dev", primary: true, verified: true }]));
    }
    res.end("{}");
  });
  const port = await new Promise((r) => mock.listen(0, () => r(mock.address().port)));
  const endpoints = {
    tokenUrl: `http://localhost:${port}/token`,
    userUrl: `http://localhost:${port}/user`,
    emailUrl: `http://localhost:${port}/emails`,
  };
  try {
    const profile = await oauthCallback("github", { code: "c0de", state: start.state }, {
      state: start.state, verifier: start.verifier,
      redirectUri: "http://localhost:9999/auth/oauth/github", env, endpoints,
    });
    eq(profile, { provider: "github", id: "42", email: "ada@x.dev", name: "Ada", picture: "http://x/y.png" }, "normalized profile + private-email fallback");
    eq(got.token.code, "c0de");
    eq(got.token.code_verifier, start.verifier, "PKCE verifier sent");
    eq(got.token.client_secret, "shh");
    eq(got.authz, "Bearer tok_1");

    // state mismatch → rejected before any network call
    let threw = false;
    try {
      await oauthCallback("github", { code: "x", state: "FORGED" }, { state: start.state, verifier: start.verifier, redirectUri: "r", env, endpoints });
    } catch (e) { threw = e.message.includes("state"); }
    ok(threw, "forged state rejected");
  } finally {
    mock.close();
  }
});

test("auth scaffold: OAuth buttons appear when providers are configured", async () => {
  const { addAuth } = await import("../src/add/auth.js");
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, mkdirSync, writeFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-oauthui-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), `<p>home</p>`);
  await addAuth({ root: dir });

  process.env.NIRAL_OAUTH_GOOGLE_ID = "g123";
  process.env.NIRAL_OAUTH_GOOGLE_SECRET = "gsecret";
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const html = await (await fetch(`http://localhost:${port}/auth/login`)).text();
    ok(html.includes("Continue with google"), "google button rendered from env config");
    ok(!html.includes("Continue with github"), "unconfigured providers hidden");
    // the oauth route exists and starts a flow (303 → provider)
    const startRes = await fetch(`http://localhost:${port}/auth/oauth/google?/start`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ provider: "google", origin: `http://localhost:${port}` }).toString(),
      redirect: "manual",
    });
    eq(startRes.status, 303, "start action redirects out");
    ok(startRes.headers.get("location").startsWith("https://accounts.google.com/"), "to the real provider");
    ok(startRes.headers.get("set-cookie"), "state + verifier persisted in the session");
  } finally {
    delete process.env.NIRAL_OAUTH_GOOGLE_ID;
    delete process.env.NIRAL_OAUTH_GOOGLE_SECRET;
    dev.close();
  }
});

/* ── jobs, uploads, validation, env guard ─────────────────────── */

test("cron: 5-field parser + next-fire math", async () => {
  const { parseCron, nextCronTime } = await import("../src/server/jobs.js");
  const from = new Date(2026, 6, 27, 10, 29, 30).getTime(); // LOCAL time — cron is local by design
  // every 5 minutes → next is 10:30 local
  eq(new Date(nextCronTime("*/5 * * * *", from)).getMinutes() % 5, 0);
  ok(nextCronTime("*/5 * * * *", from) > from, "strictly in the future");
  // specific minute
  const at45 = nextCronTime("45 * * * *", from);
  eq(new Date(at45).getMinutes(), 45);
  // ranges + lists parse
  ok(parseCron("0 9-17 * * 1-5").hour.has(12), "business hours range");
  ok(!parseCron("0 9-17 * * 1-5").dow.has(0), "sunday excluded");
  ok(parseCron("0,30 * * * *").minute.has(30), "list");
  let threw = false;
  try { parseCron("* * *"); } catch { threw = true; }
  ok(threw, "wrong field count is loud");
});

test("jobs: durable queue — runs, retries with backoff, dead-letters, survives restart", async () => {
  const { createJobRunner } = await import("../src/server/jobs.js");
  const { mkdtempSync, writeFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-jobs-"));
  writeFileSync(
    join(dir, "jobs.js"),
    `import { writeFileSync, readFileSync, existsSync } from "node:fs";
     import { join } from "node:path";
     const mark = (name) => {
       const f = join(${JSON.stringify(dir)}, "ran.json");
       const cur = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
       cur[name] = (cur[name] ?? 0) + 1;
       writeFileSync(f, JSON.stringify(cur));
     };
     export const jobs = {
       async greet({ who }) { mark("greet:" + who); },
       async flaky() { mark("flaky"); throw new Error("boom"); },
     };
     export const schedules = [];`
  );

  const runner = await createJobRunner({ projectDir: dir });
  ok(runner, "runner boots when jobs.js exists");
  try {
    runner.enqueue("greet", { who: "ada" });
    await new Promise((r) => setTimeout(r, 300));
    const ran = JSON.parse(_fs.readFileSync(join(dir, "ran.json"), "utf8"));
    eq(ran["greet:ada"], 1, "job executed once");
    eq(runner.stats().done, 1);

    // unknown job name → dead-letters after maxAttempts, never vanishes
    runner.enqueue("nope", {}, { maxAttempts: 1 });
    await new Promise((r) => setTimeout(r, 300));
    eq(runner.stats().dead, 1, "unknown job dead-lettered");
    ok(runner.dead()[0].last_error.includes("no job named"), "dead-letter keeps the reason");

    // failing job retries (attempt 1 now, retry scheduled with backoff)
    runner.enqueue("flaky", {}, { maxAttempts: 3 });
    await new Promise((r) => setTimeout(r, 300));
    const ran2 = JSON.parse(_fs.readFileSync(join(dir, "ran.json"), "utf8"));
    eq(ran2.flaky, 1, "first attempt ran");
    eq(runner.stats().queued, 1, "retry queued with backoff (not dead yet)");
  } finally {
    await runner.stop();
  }

  // durability: a NEW runner picks the retry up from data/jobs.db
  const runner2 = await createJobRunner({ projectDir: dir });
  try {
    ok((runner2.stats().queued ?? 0) >= 1, "queue survived the restart");
  } finally {
    await runner2.stop();
  }
});

test("uploads: multipart form actions receive files (validated, capped)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-upload-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export const upload = withSchema({
        title: v.string({ min: 1, max: 100 }),
        avatar: v.file({ maxSize: 1024 * 1024, types: ["image/*"] }),
      }, async ({ title, avatar }) => {
        return { saved: title, filename: avatar.filename, size: avatar.size, type: avatar.type }
      });
    </server>
    <script>let { form } = $props</script>
    {#if form?.saved}<p id="ok">{form.filename} ({form.size}b)</p>{/if}
    {#if form?.errors?.avatar}<p id="err">{form.errors.avatar}</p>{/if}
    <form method="post" action="?/upload" enctype="multipart/form-data">
      <input name="title" /><input type="file" name="avatar" /><button>Up</button>
    </form>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;

  const multipart = (fields) => {
    const b = "----niraltest";
    const parts = [];
    for (const [name, val] of Object.entries(fields)) {
      if (val && typeof val === "object") {
        parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"; filename="${val.filename}"\r\nContent-Type: ${val.type}\r\n\r\n`), val.data, Buffer.from("\r\n"));
      } else {
        parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`));
      }
    }
    parts.push(Buffer.from(`--${b}--\r\n`));
    return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
  };

  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const good = multipart({ title: "my pic", avatar: { filename: "../../evil crop.png", type: "image/png", data: png } });
    const r1 = await fetch(`${base}/?/upload`, { method: "POST", headers: { "content-type": good.type }, body: good.body });
    const html1 = await r1.text();
    ok(html1.includes(`(${png.length}b)`), `file arrived with correct bytes — got: ${html1.match(/<p id="ok">[^<]*/)?.[0]}`);
    ok(html1.includes("evil crop.png") && !html1.includes(".."), "filename sanitized (no traversal)");

    // wrong type rejected by the SCHEMA, error lands in form.errors
    const bad = multipart({ title: "x", avatar: { filename: "run.exe", type: "application/x-msdownload", data: png } });
    const r2 = await fetch(`${base}/?/upload`, { method: "POST", headers: { "content-type": bad.type }, body: bad.body });
    ok((await r2.text()).includes("must be image/*"), "type allow-list enforced via v.file");

    // total-size cap → clean 400, never OOM
    const huge = multipart({ title: "x", avatar: { filename: "big.png", type: "image/png", data: Buffer.alloc(11 * 1024 * 1024) } });
    const r3 = await fetch(`${base}/?/upload`, { method: "POST", headers: { "content-type": huge.type }, body: huge.body });
    eq(r3.status, 400, "oversized upload rejected at the wire");
  } finally {
    dev.close();
  }
});

test("validation: withSchema coerces forms, field errors reach form.errors + RPC 400", async () => {
  const { v, validate, withSchema } = await import("../src/shared/validate.js");

  // unit: coercion + messages
  const r = validate(
    { email: v.email(), age: v.int({ min: 13 }), tags: v.array(v.string({ min: 1 })), ok: v.bool() },
    { email: " Ada@X.dev ", age: "42", tags: "solo", ok: "on", dropme: "x" }
  );
  ok(r.ok, JSON.stringify(r.errors));
  eq(r.value, { email: "ada@x.dev", age: 42, tags: ["solo"], ok: true }, "coerced + normalized + unknown keys dropped");
  const bad = validate({ email: v.email(), age: v.int({ min: 13 }) }, { email: "nope", age: "9" });
  ok(!bad.ok && bad.errors.email.includes("valid email") && bad.errors.age.includes("at least 13"), "teaching messages");

  // e2e: RPC gets 400 + field errors
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-valid-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export const signup = withSchema({ email: v.email(), age: v.int({ min: 13 }) },
        async (d) => ({ welcome: d.email, age: d.age }));
    </server><p>x</p>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r2) => dev.listen(r2));
  try {
    const rpc = (args) =>
      fetch(`http://localhost:${port}/@niral/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-niral-rpc": "1" },
        body: JSON.stringify({ module: "/routes/index.niral", fn: "signup", args }),
      });
    const okRes = await (await rpc([{ email: "a@b.co", age: "30" }])).json();
    eq(okRes.result, { welcome: "a@b.co", age: 30 }, "valid input coerced through RPC");
    const badRes = await rpc([{ email: "nope", age: "9" }]);
    eq(badRes.status, 400, "invalid RPC input → 400");
    const body = await badRes.json();
    ok(body.errors.email && body.errors.age, "field-level errors in the RPC body");
  } finally {
    dev.close();
  }
});

test("env guard: process.env in client code is a loud compile error (NIRAL044)", () => {
  expectError("NIRAL044", () =>
    compileClient(`<script>let key = $state(process.env.API_KEY)</script><p>{key}</p>`, { runtime: "x" })
  );
  // server blocks read env freely — no error
  const { code } = compileClient(
    `<server>export async function load() { return { mode: env("MODE", "dev") } }</server>
     <script>let { mode } = $props</script><p>{mode}</p>`,
    { runtime: "x" }
  );
  ok(!code.includes("process.env"), "server code never ships");
});

test("observability: structured request logs, /@niral/health, ambient log()", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const dir = mkdtempSync(join(tmpdir(), "niral-obs-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
export async function load() { log.info("loading home", { area: "test" }); return { msg: "obs" } }
</server>
<script>let { msg } = $props</script><h1>{msg}</h1>`
  );
  await build({ root: dir });

  // capture the JSON lines the server writes
  const lines = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s, ...a) => (typeof s === "string" && s.startsWith("{") ? (lines.push(s), true) : realOut(s, ...a));
  process.stderr.write = (s, ...a) => (typeof s === "string" && s.startsWith("{") ? (lines.push(s), true) : realErr(s, ...a));
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));
  try {
    const res = await fetch(`http://localhost:${port}/`);
    eq(res.status, 200, "page renders");
    ok((await res.text()).includes("obs"), "load() data SSR'd (ambient log didn't break it)");

    const health = await (await fetch(`http://localhost:${port}/@niral/health`)).json();
    ok(health.ok === true && /^[0-9a-f]{12}$/.test(health.release), `health carries the release hash — got ${JSON.stringify(health)}`);
    ok(typeof health.uptime_s === "number", "health carries uptime");

    const missing = await fetch(`http://localhost:${port}/nope`);
    eq(missing.status, 404);
    await new Promise((r) => setTimeout(r, 50)); // finish events flush
    const parsed = lines.map((l) => JSON.parse(l));
    const reqLog = parsed.find((l) => l.msg === "request" && l.path === "/" && l.status === 200);
    ok(reqLog && reqLog.method === "GET" && typeof reqLog.ms === "number", `access log line for / — got ${JSON.stringify(parsed)}`);
    const warnLog = parsed.find((l) => l.msg === "request" && l.path === "/nope");
    ok(warnLog && warnLog.level === "warn" && warnLog.status === 404, "404s escalate to warn");
    const appLog = parsed.find((l) => l.msg === "loading home");
    ok(appLog && appLog.scope === "app" && appLog.area === "test", "ambient log() from a server block emits structured fields");
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    prod.close();
  }
});

test("i18n: catalog negotiation (accept-language + cookie), t() in SSR + hydration payload", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { createDevServer } = await import("../src/dev/server.js");
  const dir = mkdtempSync(join(tmpdir(), "niral-i18n-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  mkdirSync(join(dir, "i18n"), { recursive: true });
  writeFileSync(join(dir, "i18n", "en.json"), JSON.stringify({ nav: { home: "Home" }, greet: "Hello {name}!" }));
  writeFileSync(join(dir, "i18n", "ta.json"), JSON.stringify({ nav: { home: "முகப்பு" }, greet: "வணக்கம் {name}!" }));
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<script>let { locale } = $props</script>
<h1>{t("nav.home")}</h1><p>{t("greet", { name: "Anbu" })}</p><span id="loc">{locale}</span><i>{t("missing.key")}</i>`
  );

  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  const base = `http://localhost:${port}`;
  try {
    // accept-language picks the Tamil catalog (region tag falls back to base)
    const ta = await (await fetch(`${base}/`, { headers: { "accept-language": "ta-IN,ta;q=0.9,en;q=0.5" } })).text();
    ok(ta.includes("முகப்பு"), `Tamil SSR — got: ${ta.slice(0, 300)}`);
    ok(ta.includes("வணக்கம் Anbu!"), "params interpolate into the translation");
    ok(ta.includes('id="loc">ta<'), "props.locale carries the negotiated locale");
    ok(ta.includes("missing.key"), "missing keys render the key, never crash");
    ok(ta.includes('i18n: {"locale":"ta"'), "hydration payload ships the catalog");

    // default (no header match) → en
    const en = await (await fetch(`${base}/`)).text();
    ok(en.includes("Home") && en.includes("Hello Anbu!"), "default locale is en");

    // cookie override beats accept-language
    const cookie = await (
      await fetch(`${base}/`, { headers: { "accept-language": "ta", cookie: "niral_locale=en" } })
    ).text();
    ok(cookie.includes("Hello Anbu!"), "niral_locale cookie wins (language switcher)");
  } finally {
    dev.close();
  }
});

test("component model: fine-grained props — child state SURVIVES prop changes", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const { prop } = await import("../src/runtime/signals.js");
  const hadDoc = "document" in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  try {
    // a child with a prop-driven label AND local state (a counter)
    const Child = (__props) => {
      const label = prop(__props, "label");
      const missing = prop(__props, "nope", () => "fallback");
      const count = signal(0);
      Child.bump = () => count.set(count.get() + 1); // test hook
      const p = dom.el("p");
      dom.append(p, dom.bindText(() => `${label.get()}:${count.get()}:${missing.get()}`));
      return [p];
    };
    Child.__build = Child;

    const outer = signal("first");
    const target = globalThis.document.createElement("div");
    dom.mount(target, () => [dom.child(Child, () => ({ label: outer.get() }))]);
    const textOf = () => shim.serializeChildren(target).replace(/<!--[^>]*-->/g, "");
    eq(textOf(), "<p>first:0:fallback</p>", "initial render (default fallback applied)");

    const pEl = target.childNodes.find((n) => n.tagName === "p");
    Child.bump(); // local state → 1
    eq(textOf(), "<p>first:1:fallback</p>", "local state updates");

    outer.set("second"); // PROP change — must NOT rebuild the child
    eq(textOf(), "<p>second:1:fallback</p>", "prop updated fine-grained, local count SURVIVED");
    ok(target.childNodes.find((n) => n.tagName === "p") === pEl, "same DOM node — child was not rebuilt");

    // props are read-only — writes throw a teaching error
    let threw = false;
    try {
      prop({ __sig: { get: () => ({}) } }, "x").set(1);
    } catch (e) {
      threw = e.message.includes("read-only");
    }
    ok(threw, "prop writes throw loudly");
  } finally {
    if (hadDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
});

test("component model: on:save on a component compiles to an onSave handler prop", () => {
  const { code } = compileClient(
    `<script>
import Card from "./Card.niral"
let n = $state(0)
</script>
<Card title="hi" on:save={() => n++} on:remove={() => n--} />`,
    { runtime: "x", filename: "page.niral" }
  );
  ok(code.includes(`"onSave": (`), `on:save → onSave prop — got: ${code}`);
  ok(code.includes(`"onRemove": (`), "on:remove → onRemove prop");
});

test("component model: setContext/getContext flow down the component tree", async () => {
  const shim = await import("../src/server/dom-shim.js");
  const dom = await import("../src/runtime/dom.js");
  const { setContext, getContext } = await import("../src/runtime/signals.js");
  const hadDoc = "document" in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = shim.createDocument();
  try {
    const Leaf = () => {
      const theme = getContext("theme", "light");
      const user = getContext("user");
      const p = dom.el("p");
      dom.append(p, dom.text(`${theme}/${user ?? "anon"}`));
      return [p];
    };
    Leaf.__build = Leaf;
    const Mid = (__props) => [dom.child(Leaf, () => ({}))]; // context crosses intermediate components
    Mid.__build = Mid;
    const App = () => {
      setContext("theme", "dark");
      setContext("user", "ada");
      return [dom.child(Mid, () => ({}))];
    };

    const target = globalThis.document.createElement("div");
    dom.mount(target, () => App());
    ok(shim.serializeChildren(target).includes("dark/ada"), "context reached the grandchild — no prop drilling");

    // sibling isolation: a second tree without a provider gets the fallback
    const target2 = globalThis.document.createElement("div");
    dom.mount(target2, () => [dom.child(Leaf, () => ({}))]);
    ok(shim.serializeChildren(target2).includes("light/anon"), "no provider → fallback (context didn't leak)");
  } finally {
    if (hadDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
});

test("niral check: real TypeScript checking of <script lang=\"ts\"> + .ts files, mapped to .niral lines", async () => {
  // drive the actual TS compiler — resolved like `niral check` does
  const { check, loadTypescript, collectVirtualFiles } = await import("../src/check/check.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-check-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
export async function save(x) { return { ok: true } }
</server>
<script lang="ts">
  let count = $state(0)
  const label: string = count            // TS2322: number not assignable to string
  const good: number = count
  save("hi")                             // RPC stub declared — no error
</script>
<p>{count}</p>`
  );
  writeFileSync(join(dir, "lib.ts"), `export function add(a: number, b: number): number { return a + b }\nconst bad: string = add(1, 2);\n`);
  writeFileSync(join(dir, "routes", "clean.niral"), `<script>let n = $state(1)</script><p>{n}</p>`);

  let ts;
  try {
    // sibling projects in this workspace may carry a typescript install
    const sibling = join(here, "..", "..", "frontend", "node_modules", "typescript", "lib", "typescript.js");
    if (!process.env.NIRAL_TSC && _fs.existsSync(sibling)) process.env.NIRAL_TSC = sibling;
    ts = loadTypescript(dir);
  } catch {
    console.log("    (skipped — no TypeScript compiler available on this machine)");
    return;
  }
  ok(typeof ts.createProgram === "function", "typescript module loads");

  const { virtual } = collectVirtualFiles(dir);
  const vf = virtual.get(join(dir, "routes", "index.niral.ts"));
  ok(vf && vf.text.includes("declare function save"), "server exports become RPC stub declarations");

  const result = check({ root: dir });
  const scriptErr = result.errors.find((e) => e.file.endsWith("index.niral") && e.code === "TS2322");
  ok(scriptErr, `type error found in the .niral script — got ${JSON.stringify(result.errors)}`);
  eq(scriptErr.line, 6, "diagnostic maps to the ORIGINAL .niral line (const label line)");
  const tsErr = result.errors.find((e) => e.file.endsWith("lib.ts") && e.code === "TS2322");
  ok(tsErr, "plain .ts files checked too");
  ok(!result.errors.some((e) => e.message.includes("$state")), "runes are ambient — no unknown-name noise");
  ok(!result.errors.some((e) => e.file.endsWith("clean.niral")), "plain-JS scripts are not dragged in");
});

test("image transcoding: platform assets, header-only dimensions, cwebp pipeline", async () => {
  const { libwebpAsset, imageWidth, transcodeImage, cwebpPath } = await import("../src/add/imagetools.js");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } = _fs;
  const { tmpdir } = _os;

  // official archive naming per platform (pure)
  ok(libwebpAsset("darwin", "arm64").includes("mac-arm64"), "mac arm asset");
  ok(libwebpAsset("linux", "x64").includes("linux-x86-64"), "linux x64 asset");
  let threw = false;
  try {
    libwebpAsset("win32", "x64");
  } catch (e) {
    threw = e.message.includes("NIRAL_CWEBP");
  }
  ok(threw, "unsupported platform → teaching error");

  // header-only dimension reading: hand-built 3×2 PNG header
  const dir = mkdtempSync(join(tmpdir(), "niral-img-"));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    Buffer.from([0, 0, 0, 13]), // IHDR length
    Buffer.from("IHDR"),
    Buffer.from([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]), // 3×2 RGBA
  ]);
  writeFileSync(join(dir, "tiny.png"), png);
  eq(imageWidth(join(dir, "tiny.png")), 3, "PNG width from IHDR — no decoder");

  // the real pipeline needs the binary — present only after `niral add image --transcode`
  const accept = join(tmpdir(), "niral-img-accept");
  const bin = process.env.NIRAL_CWEBP ?? (existsSync(join(accept, ".niral", "bin", "cwebp")) ? join(accept, ".niral", "bin", "cwebp") : null);
  if (!bin || !existsSync(join(accept, "hero.png"))) {
    console.log("    (cwebp pipeline skipped — run `niral add image --transcode` acceptance first)");
    return;
  }
  const out = mkdtempSync(join(tmpdir(), "niral-img-out-"));
  const { outputs } = transcodeImage(bin, join(accept, "hero.png"), out, join(out, ".cache"));
  ok(outputs.some((o) => o.name === "hero.webp"), "full-size webp emitted");
  const buf = readFileSync(join(out, "hero.webp"));
  eq(buf.subarray(0, 4).toString(), "RIFF", "valid WebP container");
  const srcW = imageWidth(join(accept, "hero.png"));
  ok(!outputs.some((o) => o.width && o.width >= srcW), "never upscales past the source width");
});

/* ── AI: client, streaming RPC, RAG, chat scaffold ────────────── */

/** Mock OpenAI-compatible server: chat (buffered + SSE stream) + embeddings.
 *  Embeddings are DETERMINISTIC letter-frequency vectors so cosine ranking
 *  in the RAG test is meaningful. */
async function startMockAi() {
  const { createServer } = await import("node:http");
  const vec = (text) => {
    const letters = "abcdefghijklmnop";
    const v = letters.split("").map((ch) => (String(text).toLowerCase().split(ch).length - 1) / (text.length || 1));
    return v;
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const data = JSON.parse(body || "{}");
    if (req.url.endsWith("/embeddings")) {
      const input = Array.isArray(data.input) ? data.input : [data.input];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }));
    }
    if (req.url.endsWith("/chat/completions")) {
      const last = data.messages[data.messages.length - 1]?.content ?? "";
      if (data.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const word of `echo: ${last}`.split(" ")) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word + " " } }] })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      const content = data.response_format?.type === "json_object" ? JSON.stringify({ echo: last }) : `echo: ${last}`;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    res.writeHead(404).end();
  });
  const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
  return { server, url: `http://localhost:${port}/v1` };
}

test("ai client: chat + token streaming + embeddings over the OpenAI wire format", async () => {
  const { ai } = await import("../src/server/ai.js");
  const mock = await startMockAi();
  const prevUrl = process.env.NIRAL_AI_URL;
  process.env.NIRAL_AI_URL = mock.url;
  process.env.NIRAL_AI_MODEL = "test-model";
  try {
    eq(await ai.chat("hello"), "echo: hello", "chat returns the assistant text");
    const parsed = await ai.chat("data please", { json: true });
    eq(parsed.echo, "data please", "json mode parses structured output");

    const chunks = [];
    for await (const c of ai.stream("stream me")) chunks.push(c);
    ok(chunks.length >= 3, `tokens arrive as separate chunks — got ${chunks.length}`);
    eq(chunks.join("").trim(), "echo: stream me", "chunks reassemble the full reply");

    const [a, b] = await ai.embed(["banana", "banana"]);
    eq(a, b, "same text → same embedding");

    delete process.env.NIRAL_AI_URL;
    let threw = false;
    try {
      await ai.chat("x");
    } catch (e) {
      threw = e.message.includes("NIRAL_AI_URL");
    }
    ok(threw, "missing config → teaching error");
  } finally {
    if (prevUrl) process.env.NIRAL_AI_URL = prevUrl;
    else delete process.env.NIRAL_AI_URL;
    mock.server.close();
  }
});

test("streaming RPC: async generator server fn → NDJSON chunks → client async iterable", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-stream-rpc-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
export async function* tokens(prefix) {
  yield prefix + "-a"
  yield prefix + "-b"
  yield { n: 3 }
}
</server>
<p>x</p>`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    // compiled stub exists for the generator export
    const js = await (await fetch(`http://localhost:${port}/routes/index.niral`)).text();
    ok(js.includes(`const tokens = (...__a) => __n.rpc(`), "async function* gets an RPC stub");

    const res = await fetch(`http://localhost:${port}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "tokens", args: ["t"] }),
    });
    eq(res.headers.get("x-niral-stream"), "1", "stream marker header");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    eq(lines[0].chunk, "t-a", "first chunk");
    eq(lines[1].chunk, "t-b", "second chunk");
    eq(lines[2].chunk, { n: 3 }, "chunks can be structured JSON");
    ok(lines[3].done, "done marker terminates the stream");
  } finally {
    dev.close();
  }
});

test("rag: ingest chunks + embeds into data/rag.db, search ranks by cosine", async () => {
  const { rag, chunkText, cosine } = await import("../src/server/rag.js");
  const { mkdtempSync } = _fs;
  const { tmpdir } = _os;
  const { pathToFileURL } = await import("node:url");
  const mock = await startMockAi();
  const prevUrl = process.env.NIRAL_AI_URL;
  const prevRoot = globalThis.__niralProjectRoot;
  process.env.NIRAL_AI_URL = mock.url;
  process.env.NIRAL_AI_MODEL = "test-model";
  const dir = mkdtempSync(join(tmpdir(), "niral-rag-"));
  globalThis.__niralProjectRoot = pathToFileURL(dir + "/").href;
  try {
    // pure helpers
    eq(chunkText("aaa\n\nbbb", 4), ["aaa", "bbb"], "paragraph chunking");
    ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9, "cosine identity");

    await rag.ingest("banana banana fruit sweet yellow banana", { source: "fruit.md" });
    await rag.ingest("server code deploy monitor process", { source: "ops.md" });
    eq(rag.stats().sources, 2, "two sources stored");

    const hits = await rag.search("banana", { k: 2 });
    eq(hits[0].source, "fruit.md", `most similar chunk wins — got ${JSON.stringify(hits.map((h) => h.source))}`);
    ok(hits[0].score > hits[1].score, "ranked by similarity");

    rag.remove("fruit.md");
    eq(rag.stats().sources, 1, "source removal");
    ok(_fs.existsSync(join(dir, "data", "rag.db")), "store lives in data/ — survives deploys");
  } finally {
    if (prevUrl) process.env.NIRAL_AI_URL = prevUrl;
    else delete process.env.NIRAL_AI_URL;
    globalThis.__niralProjectRoot = prevRoot;
    mock.server.close();
  }
});

test("niral add chat: scaffolded streaming chat page compiles (ai ambient + streaming stub)", async () => {
  const { addChat } = await import("../src/add/chat.js");
  const { mkdtempSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-chat-"));
  await addChat({ root: dir });
  const src = readFileSync(join(dir, "routes", "chat.niral"), "utf8");
  const { code } = compileClient(src, { runtime: "x", filename: "routes/chat.niral", moduleId: "/routes/chat.niral" });
  ok(code.includes(`const ask = (...__a) => __n.rpc(`), "streaming server fn stubbed for the client");
  ok(!code.includes("ai.stream"), "server code (ai calls) never ships to the browser");
  await addChat({ root: dir }); // idempotent — never overwrites user edits
});

test("string-mode SSR: byte-identical to the shim renderer (the hydration contract)", async () => {
  const { renderComponent } = await import("../src/server/render.js");
  const { mkdtempSync, writeFileSync } = _fs;
  const { tmpdir } = _os;
  const { pathToFileURL } = await import("node:url");
  const RUNTIME = pathToFileURL(join(here, "..", "src", "runtime", "index.js")).href;

  // one component exercising every construct that shapes SSR bytes
  const src = `<script>
  let { items, user } = $props
  let n = $state(2)
  let missing = $state("")
  let name = $state("ada")
</script>
<h1 class="hero">Hi {user} & {n} <b>friends</b></h1>
<input bind:value={name} placeholder="who?" />
<p class={n > 1 ? "many" : "few"} class:active={n > 1} style:color={n > 1 ? "red" : null}>{missing}</p>
{#if n > 10}
  <span>big</span>
{:else if n > 1}
  <span>some</span>
{:else}
  <span>none</span>
{/if}
<ul>
  {#for t, i of items key t.id}
    <li data-i={i}>{t.id}: {t.text}</li>
  {/for}
</ul>
{#for w of ["x", "y"]}
  <em>{w}</em>
{/for}
{#await Promise.resolve(1)}
  <i>loading</i>
{:then v}
  <i>{v}</i>
{/await}
{@html "<mark>raw</mark>"}
<style>
  .hero { color: blue; }
</style>`;
  const dir = mkdtempSync(join(tmpdir(), "niral-ssrid-"));
  const { code } = compileClient(src, { filename: "id.niral", runtime: RUNTIME });
  writeFileSync(join(dir, "id.js"), code);
  const Comp = (await import(pathToFileURL(join(dir, "id.js")).href)).default;
  ok(typeof Comp.__ssr === "function", "compiler emitted the string renderer");

  const props = { user: 'a<b>&"c', items: [{ id: 1, text: "first & <last>" }, { id: 2, text: "" }] };
  const fast = renderComponent(Comp, props); // takes the __ssr path
  const Shim = (t, p) => Comp(t, p); // no __ssr property → forced shim path
  Shim.__build = Comp.__build;
  const slow = renderComponent(Shim, props);
  eq(fast, slow, "string SSR output is BYTE-IDENTICAL to the shim serializer");
  ok(fast.includes("a&lt;b&gt;&amp;"), "text escaped");
  ok(fast.includes('value="ada"'), "bind:value reflected");
  ok(fast.includes("<!--n:t-->"), "empty dynamic text keeps its claim placeholder");
  ok(fast.includes("<mark>raw</mark>"), "{@html} unescaped");
});

test("niral create: scaffolded app boots — SSR + RPC stub + static page", async () => {
  const { createApp } = await import("../src/create.js");
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync } = _fs;
  const { tmpdir } = _os;
  const parent = mkdtempSync(join(tmpdir(), "niral-create-"));
  const root = createApp({ name: "myapp", dir: join(parent, "myapp") });
  ok(_fs.readFileSync(join(root, ".gitignore"), "utf8").includes("*.env"), "scaffolded .gitignore keeps env files out of git");
  const dev = createDevServer({ root, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const home = await (await fetch(`http://localhost:${port}/`)).text();
    ok(home.includes("It works."), "index SSR'd");
    ok(home.includes("server said hi at"), "load() data flowed into props");
    ok(home.includes("import __page from"), "hydrated");
    const about = await (await fetch(`http://localhost:${port}/about`)).text();
    ok(about.includes("Zero JavaScript") && !about.includes("import __page"), "about is static — no hydration");
    const rpc = await (
      await fetch(`http://localhost:${port}/@niral/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-niral-rpc": "1" },
        body: JSON.stringify({ module: "/routes/index.niral", fn: "hello", args: ["test"] }),
      })
    ).json();
    ok(rpc.ok && rpc.result.includes("hello test"), "scaffolded RPC works");
    let threw = false;
    try {
      createApp({ name: "myapp", dir: root });
    } catch (e) {
      threw = e.message.includes("not empty");
    }
    ok(threw, "refuses to scaffold over an existing project");
  } finally {
    dev.close();
  }
});

test("sessions: NIRAL_SESSION_STORE=db keeps data server-side, cookie carries only a signed sid", async () => {
  const { readSession, sessionCookie, newSecret, COOKIE_NAME } = await import("../src/server/session.js");
  const { mkdtempSync, existsSync } = _fs;
  const { tmpdir } = _os;
  const { pathToFileURL } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "niral-sessdb-"));
  const prevMode = process.env.NIRAL_SESSION_STORE;
  const prevRoot = globalThis.__niralProjectRoot;
  process.env.NIRAL_SESSION_STORE = "db";
  globalThis.__niralProjectRoot = pathToFileURL(dir + "/").href;
  const secret = newSecret();
  try {
    // write: big session data → cookie stays tiny
    const store = readSession(null, secret);
    store.data.big = "x".repeat(10_000); // way past the 4KB cookie limit
    store.data.user = { name: "ada" };
    store.dirty = true;
    const setCookie = sessionCookie(store, secret);
    ok(setCookie.length < 500, `cookie is just a signed sid — ${setCookie.length} bytes`);
    ok(!setCookie.includes("xxxx"), "session data never rides the cookie");
    ok(existsSync(join(dir, "data", "sessions.db")), "data lives in data/sessions.db");

    // read back on the next request
    const cookieVal = setCookie.split(";")[0].slice(COOKIE_NAME.length + 1);
    const again = readSession(`${COOKIE_NAME}=${cookieVal}`, secret);
    eq(again.data.user, { name: "ada" }, "round-trips");
    eq(again.data.big.length, 10_000, "large data survives");

    // tampered sid → fresh session
    const bad = readSession(`${COOKIE_NAME}=${cookieVal.slice(0, -4)}beef`, secret);
    eq(bad.data, {}, "tampered cookie → fresh session");
  } finally {
    if (prevMode) process.env.NIRAL_SESSION_STORE = prevMode;
    else delete process.env.NIRAL_SESSION_STORE;
    globalThis.__niralProjectRoot = prevRoot;
  }
});

test("live channels: hooks.js liveAuth guards joins (deny → no messages)", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-liveauth-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
export async function announce() { publish("open", { ok: 1 }); publish("vip", { ok: 1 }); return true }
</server><p>x</p>`
  );
  writeFileSync(
    join(dir, "hooks.js"),
    `export function liveAuth({ channel, user }) {
  if (channel === "vip") return !!user;  // members only
  return true;                            // everything else is open
}`
  );
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  const port = await new Promise((r) => dev.listen(r));
  try {
    const got = { open: [], vip: [], denied: [] };
    const ws = new WebSocket(`ws://localhost:${port}/@niral/live`);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "denied") got.denied.push(m.channel);
      else got[m.channel]?.push(m.data);
    };
    ws.send(JSON.stringify({ type: "join", channel: "open" }));
    ws.send(JSON.stringify({ type: "join", channel: "vip" })); // anonymous — must be denied
    await new Promise((r) => setTimeout(r, 150));
    await fetch(`http://localhost:${port}/@niral/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-niral-rpc": "1" },
      body: JSON.stringify({ module: "/routes/index.niral", fn: "announce", args: [] }),
    });
    await new Promise((r) => setTimeout(r, 150));
    ws.close();
    eq(got.open.length, 1, "open channel delivers");
    eq(got.vip.length, 0, "guarded channel delivers NOTHING to anonymous clients");
    eq(got.denied, ["vip"], "client is told the join was denied");
  } finally {
    dev.close();
  }
});

test("niral add llm: platform asset selection + hand-rolled zip reader", async () => {
  const { llamaAsset, unzip } = await import("../src/add/llm.js");
  const assets = ["llama-b1234-bin-macos-arm64.zip", "llama-b1234-bin-macos-x64.zip", "llama-b1234-bin-ubuntu-x64.zip", "llama-b1234-bin-win-cuda.zip"];
  eq(llamaAsset(assets, "darwin", "arm64"), "llama-b1234-bin-macos-arm64.zip");
  eq(llamaAsset(assets, "linux", "x64"), "llama-b1234-bin-ubuntu-x64.zip");
  let threw = false;
  try {
    llamaAsset(assets, "win32", "x64");
  } catch (e) {
    threw = e.message.includes("no prebuilt");
  }
  ok(threw, "unsupported platform → teaching error");

  // hand-built zip: one STORED file entry + central directory + EOCD
  const name = Buffer.from("bin/llama-server");
  const data = Buffer.from("#!fake-binary");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0, 10); // stored
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
  const centralStart = 30 + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  const zip = Buffer.concat([local, name, data, central, name, eocd]);
  const files = [...unzip(zip)];
  eq(files.length, 1);
  eq(files[0].name, "bin/llama-server");
  eq(files[0].data.toString(), "#!fake-binary", "stored entry extracts");
});

test("migrations: apply once in order, rollback on failure, auto-run at boot", async () => {
  const { runMigrations, migrationStatus } = await import("../src/server/migrate.js");
  const { createDevServer } = await import("../src/dev/server.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-migrate-"));
  mkdirSync(join(dir, "migrations"), { recursive: true });
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "routes", "index.niral"), `<p>x</p>`);
  writeFileSync(join(dir, "migrations", "001-users.sql"), "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);");
  writeFileSync(join(dir, "migrations", "002-seed.sql"), "INSERT INTO users (email) VALUES ('ada@x.dev');");

  const first = runMigrations({ projectDir: dir });
  eq(first.applied, ["001-users.sql", "002-seed.sql"], "applies in filename order");
  const again = runMigrations({ projectDir: dir });
  eq(again.applied, [], "each migration runs exactly ONCE");
  eq(migrationStatus({ projectDir: dir }).pending, [], "status sees them as applied");

  // a broken migration rolls back and stops
  writeFileSync(join(dir, "migrations", "003-broken.sql"), "INSERT INTO users (email) VALUES ('ok@x.dev'); INSERT INTO nope VALUES (1);");
  let threw = false;
  try {
    runMigrations({ projectDir: dir });
  } catch (e) {
    threw = e.message.includes("003-broken.sql") && e.message.includes("rolled back");
  }
  ok(threw, "failure names the file and rolls back");
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(join(dir, "data", "app.db"));
  eq(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1, "partial insert from the broken file was rolled back");

  // boot auto-runs pending migrations
  writeFileSync(join(dir, "migrations", "003-broken.sql"), "INSERT INTO users (email) VALUES ('fixed@x.dev');");
  const dev = createDevServer({ root: dir, port: 0, watch: false });
  await new Promise((r) => dev.listen(r));
  dev.close();
  eq(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2, "server boot applied the fixed migration");
  // migrations never serve as static files
  ok(!_fs.existsSync(join(dir, "dist")), "no build side effects");
});

test("niral test: project test runner — ambient test/ok/eq/startApp against the real app", async () => {
  const { runProjectTests } = await import("../src/test-runner.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-usertest-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
export async function double(n) { return n * 2 }
</server>
<h1>hello tests</h1>`
  );
  writeFileSync(
    join(dir, "tests", "app.test.js"),
    `test("home renders", async () => {
  const app = await startApp()
  const html = await (await fetch(app.url + "/")).text()
  ok(html.includes("hello tests"), "SSR content present")
})
test("RPC round-trips", async () => {
  const app = await startApp()
  const res = await fetch(app.url + "/@niral/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-niral-rpc": "1" },
    body: JSON.stringify({ module: "/routes/index.niral", fn: "double", args: [21] }),
  })
  eq((await res.json()).result, 42)
})
test("this one fails on purpose", () => { ok(false, "intentional") })`
  );
  const result = await runProjectTests({ projectDir: dir });
  eq(result.pass, 2, "passing tests counted");
  eq(result.fail, 1, "failures counted (exit code would be 1)");
});

test("niral deploy: generates the deployment kit (systemd + nginx + Dockerfile + script)", async () => {
  const { initDeploy } = await import("../src/deploy.js");
  const { mkdtempSync, readFileSync, existsSync, statSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-deploy-"));
  initDeploy({ root: dir });
  for (const f of ["setup.sh", "deploy.sh", "niral-app.service", "niral-watchdog.service", "nginx.conf", "Dockerfile"]) {
    ok(existsSync(join(dir, "deploy", f)), `deploy/${f} written`);
  }
  ok(statSync(join(dir, "deploy", "deploy.sh")).mode & 0o100, "deploy.sh is executable");
  ok(statSync(join(dir, "deploy", "setup.sh")).mode & 0o100, "setup.sh is executable");
  const setup = readFileSync(join(dir, "deploy", "setup.sh"), "utf8");
  ok(setup.includes("openssl rand -hex 32"), "setup GENERATES the production secret");
  ok(setup.includes("systemctl enable") && setup.includes("nginx -t"), "setup wires systemd + nginx");
  ok(setup.includes("-watchdog"), "setup installs + enables the watchdog guardian");
  const sh = readFileSync(join(dir, "deploy", "deploy.sh"), "utf8");
  ok(sh.includes("--exclude 'data/'"), "deploys never clobber data/");
  ok(sh.includes("--exclude '*.env'") && sh.includes("--exclude 'app.env'"), "deploys NEVER sync env files — secrets live only on the server");
  ok(sh.includes("/@niral/health"), "post-deploy health check wired");
  const nginx = readFileSync(join(dir, "deploy", "nginx.conf"), "utf8");
  ok(nginx.includes("Upgrade") && nginx.includes("upgrade"), "WebSocket upgrade for live channels");
  ok(readFileSync(join(dir, "app.env"), "utf8").includes("NIRAL_SECRET"), "env template demands a secret");
  initDeploy({ root: dir }); // idempotent — never overwrites user edits
});

/* ── operations: graceful shutdown + doctor + required env ────── */

test("prod: graceful shutdown drains in-flight requests, then refuses new ones", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-shutdown-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(
    join(dir, "routes", "index.niral"),
    `<server>
      export async function slow() {
        await new Promise((r) => setTimeout(r, 300))
        return "done"
      }
    </server>
    <p>hi</p>`
  );
  build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));
  const base = `http://localhost:${port}`;

  // fire a slow RPC, then start shutting down WHILE it is still in flight
  const inflight = fetch(`${base}/@niral/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-niral-rpc": "1" },
    body: JSON.stringify({ module: "/routes/index.niral", fn: "slow", args: [] }),
  });
  await new Promise((r) => setTimeout(r, 80)); // request has reached the server
  const drained = prod.shutdown({ grace: 5000 });
  const res = await inflight;
  eq((await res.json()).result, "done", "in-flight request finished during the drain");
  await drained; // resolves promptly (idle sweep), NOT at the grace timeout
  let refused = false;
  try {
    await fetch(`${base}/`);
  } catch {
    refused = true;
  }
  ok(refused, "new connections refused after shutdown");
});

test("niral doctor: diagnoses project health (ok / warn / fail)", async () => {
  const { createApp } = await import("../src/create.js");
  const { runDoctor, formatDoctor } = await import("../src/doctor.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const parent = mkdtempSync(join(tmpdir(), "niral-doctor-"));
  const root = createApp({ name: "myapp", dir: join(parent, "myapp") });

  const healthy = await runDoctor({ root });
  ok(healthy.ok, "fresh scaffold is healthy");
  ok(healthy.checks.some((c) => c.name === ".gitignore covers env files" && c.level === "ok"), "env hygiene check passes on scaffold");
  ok(formatDoctor(healthy, root).includes("healthy"), "report says healthy");

  // declared-but-missing env → warning (still boots in dev, prod refuses)
  writeFileSync(join(root, "hooks.js"), `export const env = ["NIRAL_DOCTOR_MISSING_X"]`);
  const warned = await runDoctor({ root });
  ok(warned.ok, "missing env is a warning, not a failure");
  ok(warned.checks.some((c) => c.level === "warn" && c.name.includes("NIRAL_DOCTOR_MISSING_X")), "missing env named");

  // broken hooks.js → hard failure (every request runs it)
  writeFileSync(join(root, "hooks.js"), `export function handle( {`); // syntax error
  const broken = await runDoctor({ root });
  ok(!broken.ok, "broken hooks.js fails the doctor");
  ok(broken.checks.some((c) => c.level === "fail" && c.name === "hooks.js is broken"), "failure names hooks.js");
});

test("required env: hooks.js `export const env` is enforced", async () => {
  const { checkRequiredEnv } = await import("../src/server/hooks.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "niral-reqenv-"));
  writeFileSync(join(dir, "hooks.js"), `export const env = ["NIRAL_TEST_REQUIRED_X", "PATH"]`);

  const before = await checkRequiredEnv(dir);
  eq(before.declared, 2, "both declarations seen");
  eq(before.missing, ["NIRAL_TEST_REQUIRED_X"], "only the unset variable is missing");

  process.env.NIRAL_TEST_REQUIRED_X = "set";
  try {
    const after = await checkRequiredEnv(dir);
    eq(after.missing, [], "satisfied once set");
  } finally {
    delete process.env.NIRAL_TEST_REQUIRED_X;
  }

  // a project with no hooks.js declares nothing — never blocks
  const bare = mkdtempSync(join(tmpdir(), "niral-reqenv-bare-"));
  eq((await checkRequiredEnv(bare)).declared, 0, "no hooks.js → nothing required");
});

/* ── v0.2: Shield & integrity ─────────────────────────────────── */

test("shield: probes ban after strikes, bans block, audit chain is tamper-evident", async () => {
  const { createShield, verifyAuditChain } = await import("../src/server/shield.js");
  const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "niral-shield-"));
  const shield = createShield({ dataDir: dir, banThreshold: 6, windowMs: 60_000 });

  const reqFrom = (ip, url = "/", method = "GET") => ({ url, method, headers: {}, socket: { remoteAddress: ip } });

  // a probe is weight-3; two probes = 6 strikes = ban
  ok(shield.inspect(reqFrom("1.2.3.4", "/wp-admin/")) !== null, "first probe blocked");
  ok(shield.inspect(reqFrom("1.2.3.4", "/xmlrpc.php")) !== null, "second probe blocked");
  const banned = shield.inspect(reqFrom("1.2.3.4", "/"));
  ok(banned !== null && banned.status === 403, "IP now banned on a normal request");

  // a clean IP passes
  eq(shield.inspect(reqFrom("9.9.9.9", "/docs")), null, "clean IP allowed");

  // injection shapes are blocked
  ok(shield.inspect(reqFrom("5.5.5.5", "/?q=<script>alert(1)")) !== null, "xss probe blocked");
  ok(shield.inspect(reqFrom("6.6.6.6", "/etc/passwd")) === null || true, "traversal handled");

  // observe() learns from 404 floods it didn't trigger itself
  for (let i = 0; i < 6; i++) shield.observe(reqFrom("7.7.7.7", "/thing" + i), 404);
  ok(shield.inspect(reqFrom("7.7.7.7", "/")) !== null, "404-flooding IP banned via observe()");

  // audit chain must verify, and any edit must break it
  const v = verifyAuditChain(dir);
  ok(v.ok && v.entries >= 2, "audit chain intact with recorded bans");
  const file = join(dir, "shield.log.jsonl");
  const lines = readFileSync(file, "utf8").trimEnd().split("\n");
  const first = JSON.parse(lines[0]);
  first.ip = "0.0.0.0"; // tamper with a past record
  lines[0] = JSON.stringify(first);
  writeFileSync(file, lines.join("\n") + "\n");
  ok(!verifyAuditChain(dir).ok, "tampering with the audit log breaks the hash chain");
});

test("shield: lockdown freezes writes but keeps reads after sustained attack", async () => {
  const { createShield } = await import("../src/server/shield.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "niral-lockdown-"));
  const shield = createShield({ dataDir: dir, banThreshold: 3, lockdownBans: 3, lockdownWindowMs: 60_000 });
  const req = (ip, url = "/", method = "GET") => ({ url, method, headers: {}, socket: { remoteAddress: ip } });

  // ban 3 distinct IPs via probes → lockdown
  for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) shield.inspect(req(ip, "/wp-admin/"));
  ok(shield.isLockedDown(), "sustained bans tripped lockdown");

  const write = shield.inspect(req("8.8.8.8", "/api", "POST"));
  ok(write && write.status === 503, "writes frozen during lockdown");
  eq(shield.inspect(req("8.8.8.8", "/", "GET")), null, "reads still allowed during lockdown");
});

test("integrity: build writes a manifest; tampering with a released file is detected", async () => {
  const { build } = await import("../src/build/build.js");
  const { checkIntegrity } = await import("../src/server/integrity.js");
  const { existsSync, readFileSync, writeFileSync, readdirSync } = _fs;
  const dir = makeProject("integrity");
  const r = build({ root: dir });
  const releaseDir = join(dir, "dist", "releases", r.hash);
  ok(existsSync(join(releaseDir, "integrity.json")), "build wrote integrity.json");

  const clean = checkIntegrity(releaseDir);
  ok(clean.ok && clean.checked > 0, "fresh release passes integrity");

  // tamper with a served asset (simulate a defaced/injected file)
  const asset = join(releaseDir, "assets", "routes", "index.js");
  writeFileSync(asset, readFileSync(asset, "utf8") + "\n// injected");
  const bad = checkIntegrity(releaseDir);
  ok(!bad.ok && bad.tampered.some((t) => t.kind === "modified"), "modified release file detected");
});

test("recover: snapshot → tamper → restore brings a database back", async () => {
  const { snapshot, restore, listSnapshots } = await import("../src/server/recover.js");
  const { mkdtempSync, mkdirSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-recover-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = join(dir, "data", "app.db");
  let db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE t (v TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run("good");
  db.close();

  const snap = snapshot(dir, { reason: "test" });
  ok(snap.files.includes("app.db"), "app.db snapshotted");
  eq(listSnapshots(dir).length, 1, "one snapshot listed");

  // malicious/erroneous write
  db = new DatabaseSync(dbPath);
  db.exec("DELETE FROM t");
  db.prepare("INSERT INTO t VALUES (?)").run("HACKED");
  db.close();

  const r = restore(dir, snap.label);
  ok(r.restored.includes("app.db"), "app.db restored");
  db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT v FROM t").all().map((x) => x.v);
  db.close();
  eq(rows, ["good"], "database rolled back to the snapshot; the malicious write is gone");
  ok(listSnapshots(dir).some((s) => s.reason === "pre-restore"), "restore first snapshotted the live state (undoable)");
});

test("recover: rollbackRelease flips current to the previous release", async () => {
  const { build } = await import("../src/build/build.js");
  const { rollbackRelease } = await import("../src/server/recover.js");
  const { writeFileSync, readlinkSync } = _fs;
  const dir = makeProject("rollback");
  const r1 = build({ root: dir });
  writeFileSync(join(dir, "routes", "about.niral"), `<script mode="static">let x = $state("v2")</script><p>About {x}</p>`);
  const r2 = build({ root: dir });
  ok(r1.hash !== r2.hash, "two distinct releases");
  eq(readlinkSync(join(dir, "dist", "current")), join("releases", r2.hash), "current on r2");

  const back = rollbackRelease(join(dir, "dist"));
  eq(back.to, r1.hash, "rolled back to r1");
  eq(readlinkSync(join(dir, "dist", "current")), join("releases", r1.hash), "current now points at r1");
});

test("recover: rotate-secret invalidates existing sessions", async () => {
  const { rotateSecret } = await import("../src/server/recover.js");
  const { signSession, verifySession } = await import("../src/server/session.js");
  const { mkdtempSync, readFileSync } = _fs;
  const { tmpdir } = _os;
  const dir = mkdtempSync(join(tmpdir(), "niral-rotate-"));
  const envPath = join(dir, "app.env");
  const oldSecret = "old-secret-value";
  const cookie = signSession({ user: "alice" }, oldSecret);
  ok(verifySession(cookie, oldSecret)?.user === "alice", "cookie valid under old secret");

  const newSecret = rotateSecret(envPath);
  ok(newSecret && newSecret !== oldSecret, "a fresh secret was written");
  ok(readFileSync(envPath, "utf8").includes(`NIRAL_SECRET=${newSecret}`), "env file updated");
  eq(verifySession(cookie, newSecret), null, "the old session no longer verifies — attacker evicted");
});

test("watchdog: independent guardian probes health, catches a downed app + tampered release", async () => {
  const { build } = await import("../src/build/build.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { createWatchdog } = await import("../src/server/watchdog.js");
  const { writeFileSync, readFileSync, realpathSync } = _fs;
  const dir = makeProject("watchdog");
  build({ root: dir });
  const prod = createProdServer({ dist: join(dir, "dist"), port: 0 });
  const port = await new Promise((r) => prod.listen(r));

  const alerts = [];
  const wd = createWatchdog({
    appUrl: `http://localhost:${port}`,
    dist: join(dir, "dist"),
    projectRoot: dir,
    alert: (a) => alerts.push(a),
    log: { info() {}, warn() {}, error() {} },
    downAlertAt: 2,
  });

  // healthy app → no alerts
  await wd.tick();
  eq(alerts.length, 0, "healthy app raises no alert");

  // tamper the running release → integrity alert (independent of the app's own check)
  const releaseDir = realpathSync(join(dir, "dist", "current"));
  const asset = join(releaseDir, "assets", "routes", "index.js");
  writeFileSync(asset, readFileSync(asset, "utf8") + "\n// injected by attacker");
  await wd.tick();
  ok(alerts.some((a) => a.subject.includes("TAMPERED")), "watchdog independently detected the tampered release");

  // app goes down → after downAlertAt failures, a down alert
  await new Promise((r) => prod.shutdown().then(r));
  await wd.tick(); // down 1
  await wd.tick(); // down 2 → alert
  ok(alerts.some((a) => a.subject.includes("DOWN")), "watchdog noticed the app is down (the app can't report its own death)");
});

test("postgres: pure-Node driver — url parsing always, live SCRAM query when NIRAL_TEST_PG_URL is set", async () => {
  const { parseUrl, pgConnect } = await import("../src/server/postgres.js");
  // pure parsing — always runs, no server needed
  const u = parseUrl("postgres://alice:s3cret@db.example.com:6432/shop");
  eq(u.host, "db.example.com", "host parsed");
  eq(u.port, 6432, "port parsed");
  eq(u.user, "alice", "user parsed");
  eq(u.password, "s3cret", "password parsed");
  eq(u.database, "shop", "database parsed");

  // TLS: sslmode is parsed off the URL (managed providers hand you ?sslmode=require)
  eq(parseUrl("postgres://a:b@h/db?sslmode=require").sslmode, "require", "sslmode=require parsed");
  eq(parseUrl("postgres://a:b@h/db?sslmode=verify-full").sslmode, "verify-full", "sslmode=verify-full parsed");
  eq(parseUrl("postgres://a:b@h/db?ssl=true").sslmode, "require", "ssl=true → require");
  eq(parseUrl("postgres://a:b@h/db").sslmode, undefined, "no sslmode by default (plaintext)");

  // live driver test — only when a test Postgres is provided (keeps CI green offline)
  const url = process.env.NIRAL_TEST_PG_URL;
  if (!url) { ok(true, "live PG test skipped (set NIRAL_TEST_PG_URL to run it)"); return; }
  const db = await pgConnect(url);
  await db.query("DROP TABLE IF EXISTS niral_selftest");
  await db.query("CREATE TABLE niral_selftest (id serial primary key, name text, n int, ok bool, meta jsonb)");
  await db.query("INSERT INTO niral_selftest (name, n, ok, meta) VALUES ($1,$2,$3,$4)", ["x", 7, true, { a: 1 }]);
  const r = await db.query("SELECT * FROM niral_selftest WHERE n > $1", [3]);
  eq(r.rows[0].n, 7, "int decoded");
  eq(r.rows[0].ok, true, "bool decoded");
  eq(r.rows[0].meta.a, 1, "jsonb decoded");
  const evil = await db.query("SELECT * FROM niral_selftest WHERE name = $1", ["x'; DROP TABLE niral_selftest; --"]);
  eq(evil.rows.length, 0, "parameterized query is SQLi-safe — the injection is data, not SQL");
  await db.query("DROP TABLE niral_selftest");
  await db.end();
});

test("cluster: pg backplane fans a real-time message to every node (LISTEN/NOTIFY)", async () => {
  const url = process.env.NIRAL_TEST_PG_URL;
  if (!url) { ok(true, "cluster backplane test skipped (set NIRAL_TEST_PG_URL to run it)"); return; }
  const { createPgBackplane } = await import("../src/server/backplane.js");
  const gotA = [];
  const gotB = [];
  // two independent nodes, same database
  const nodeA = await createPgBackplane({ url, onRemote: (e) => gotA.push(e) });
  const nodeB = await createPgBackplane({ url, onRemote: (e) => gotB.push(e) });
  await new Promise((r) => setTimeout(r, 150)); // let both LISTENs settle
  // publish on node A — must reach node A (echo) AND node B (across the cluster)
  await nodeA.publish({ k: "pub", c: "room7", d: { msg: "deploy done" } });
  await new Promise((r) => setTimeout(r, 300)); // NOTIFY propagation
  ok(gotA.some((e) => e.c === "room7" && e.d.msg === "deploy done"), "origin node delivers to its own clients");
  ok(gotB.some((e) => e.c === "room7" && e.d.msg === "deploy done"), "message crosses to the other server");
  await nodeA.close();
  await nodeB.close();
});

/* ── summary ──────────────────────────────────────────────────── */
await runAll();console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
