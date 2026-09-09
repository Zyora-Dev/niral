import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { check, loadTypescript } from "../src/check/check.js";
import { startLsp } from "../src/lsp/server.js";
import { addTypescript } from "../src/add/typescript.js";

export function registerInferenceTests(register) {
  const test = (name, run) => register(name, async () => {
    const previous = process.env.NIRAL_TSC;
    const cached = fileURLToPath(new URL("../.niral/lib/typescript/typescript.js", import.meta.url));
    try {
      if (!previous && existsSync(cached)) process.env.NIRAL_TSC = cached;
      try { loadTypescript(process.cwd()); } catch {
        console.log("    (skipped - install the TypeScript development tool to test inference)");
        return;
      }
      await run();
    } finally {
      if (previous === undefined) delete process.env.NIRAL_TSC;
      else process.env.NIRAL_TSC = previous;
    }
  });
  test("TypeScript installer repairs CommonJS scope in existing ESM caches", async () => {
    const root = mkdtempSync(join(tmpdir(), "niral-ts-cache-"));
    const previous = process.env.NIRAL_TSC;
    try {
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      const cache = join(root, ".niral", "lib", "typescript");
      mkdirSync(cache, { recursive: true });
      writeFileSync(join(cache, "typescript.js"), 'module.exports = { version: "cache-test" };');
      await addTypescript({ root });
      delete process.env.NIRAL_TSC;
      assert.equal(loadTypescript(root).version, "cache-test");
    } finally {
      if (previous === undefined) delete process.env.NIRAL_TSC;
      else process.env.NIRAL_TSC = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("LSP reports unsaved cross-component type errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "niral-lsp-types-"));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = startLsp({ input, output });
    let timer;
    try {
      mkdirSync(join(root, "routes"));
      mkdirSync(join(root, "components"));
      const childFile = join(root, "components", "Child.niral");
      const parentFile = join(root, "routes", "index.niral");
      const child = `<script lang="ts">let { value }: { value: number } = $props;</script>`;
      const parent = `<script lang="ts">import Child from '../components/Child.niral';</script>\n<Child value={42}/>`;
      writeFileSync(childFile, child);
      writeFileSync(parentFile, parent);
      const childUri = pathToFileURL(childFile).href;
      const parentUri = pathToFileURL(parentFile).href;
      let buffer = Buffer.alloc(0);
      const diagnostic = new Promise((accept, reject) => {
        timer = setTimeout(() => reject(new Error("LSP type diagnostics timed out")), 10000);
        output.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          for (;;) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            const length = Number(buffer.subarray(0, headerEnd).toString().match(/Content-Length: (\d+)/)[1]);
            const start = headerEnd + 4;
            if (buffer.length < start + length) return;
            const message = JSON.parse(buffer.subarray(start, start + length));
            buffer = buffer.subarray(start + length);
            if (message.params?.uri === parentUri && message.params.diagnostics.some((entry) => entry.code === "TS2322")) accept(message.params.diagnostics);
          }
        });
      });
      const send = (method, params, id) => {
        const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });
        input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      };
      send("initialize", { rootUri: pathToFileURL(root).href }, 1);
      send("textDocument/didOpen", { textDocument: { uri: parentUri, text: parent } });
      send("textDocument/didOpen", { textDocument: { uri: childUri, text: child } });
      send("textDocument/didChange", { textDocument: { uri: childUri }, contentChanges: [{ text: child.replace("value: number", "value: string") }] });
      const diagnostics = await diagnostic;
      assert.equal(diagnostics[0].range.start.line, 1);
      assert.match(diagnostics[0].message, /number.*string/);
      assert.deepEqual(check({ root }).errors, []);
    } finally {
      clearTimeout(timer);
      server.dispose();
      input.destroy();
      output.destroy();
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("checker infers defaults, route context, JS servers and scoped templates", () => {
    const root = mkdtempSync(join(tmpdir(), "niral-inference-cases-"));
    try {
      mkdirSync(join(root, "routes"));
      mkdirSync(join(root, "components"));
      writeFileSync(join(root, "components", "Counter.niral"), `<script lang="ts">
let { value = 0 } = $props;
</script><p>{value.toFixed()}</p>`);
      writeFileSync(join(root, "routes", "[slug].niral"), `<server lang="ts">
export async function load({ params, locals }) { return { slug: params.slug, list: [{ title: "ok" }], marker: locals.marker }; }
export async function identity<Value>(value: Value): Promise<Value> { return value; }
export function double(value: number) { return value * 2; }
</server>
<script lang="ts">
import Counter from "../components/Counter.niral";
let count = $state(1);
let { slug, list } = $props;
const result: Promise<number> = double(2);
const generic: Promise<string> = identity("ok");
const title: string = slug;
</script>
<Counter />
<Counter bind:value={count} />
{#for item, index of list key item.title}<Counter value={index} /><p>{item.title.toUpperCase()}</p>{/for}
{#await identity("ok")}pending{:then value}<p>{value.toUpperCase()}</p>{:catch error}<p>{error}</p>{/await}`);
      const jsFile = join(root, "routes", "js.niral");
      writeFileSync(jsFile, `<server>
export async function load() { return { count: 42 }; }
/** @param {number} value */
export function double(value) { return value * 2; }
</server>
<script lang="ts">
const wrong: string = $props.count;
double("bad");
</script>`);
      const result = check({ root });
      assert.deepEqual(result.errors.map((error) => [error.file, error.line, error.code]), [
        [jsFile, 7, "TS2322"], [jsFile, 8, "TS2345"],
      ], JSON.stringify(result.errors));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("checker validates component props, events and bidirectional bindings", () => {
    const root = mkdtempSync(join(tmpdir(), "niral-component-types-"));
    try {
      mkdirSync(join(root, "routes"));
      mkdirSync(join(root, "components"));
      writeFileSync(join(root, "components", "Editor.niral"), `<script lang="ts">
type Props = { value: string | number; label: string; onSave?: (value: string) => void };
let { value, label, onSave }: Props = $props;
</script><p>{label}</p>`);
      const file = join(root, "routes", "index.niral");
      writeFileSync(file, `<script lang="ts">
import Editor from '../components/Editor.niral';
let broad = $state<string | number>("hello");
let narrow = $state(0);
</script>
<Editor label="ok" bind:value={broad} on:save={(value) => value.toUpperCase()} />
<Editor label={42} value="ok" />
<Editor value="missing label" />
<Editor label="wrong binding" bind:value={narrow} />`);
      const result = check({ root });
      assert.deepEqual(result.errors.map((error) => [error.line, error.code]), [
        [7, "TS2322"], [8, "TS2345"], [9, "TS2322"],
      ], JSON.stringify(result.errors));
      assert.ok(result.errors.every((error) => error.file === file));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("checker infers loader props and RPC arguments and results", () => {
    const root = mkdtempSync(join(tmpdir(), "niral-inference-"));
    try {
      mkdirSync(join(root, "routes"));
      const file = join(root, "routes", "[slug].niral");
      const source = `<server lang="ts">
export async function load() { return { count: 1, title: "Post" }; }
export async function save(id: number, title?: string) { return { id, title }; }
</server>
<script lang="ts">
let { count, title, slug } = $props;
const good: number = count;
const route: string = slug;
save(1, title);
save("wrong");
const bad: string = count;
async function submit() { const result = await save(1); result.missing; }
const missing = $props.missing;
</script>`;
      writeFileSync(file, source);
      const result = check({ root });
      assert.deepEqual(result.errors.map((error) => [error.line, error.code]), [
        [10, "TS2345"], [11, "TS2322"], [12, "TS2339"], [13, "TS2339"],
      ], JSON.stringify(result.errors));
      assert.ok(result.errors.every((error) => error.file === file));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadTypescript(process.cwd());
  const tests = [];
  registerInferenceTests((name, run) => tests.push({ name, run }));
  for (const { name, run } of tests) {
    await run();
    console.log(`PASS ${name}`);
  }
}