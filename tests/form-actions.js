import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formAction, configureForms } from "../src/runtime/forms.js";
import { pageRefresh, configureRefresh } from "../src/runtime/refresh.js";
import { root, effect } from "../src/runtime/signals.js";
import { compileClient } from "../src/index.js";
import { sendFormResult } from "../src/server/forms.js";
import { bundleRuntime } from "../src/build/bundle-runtime.js";
import { build } from "../src/build/build.js";
import { createDevServer } from "../src/dev/server.js";
import { createProdServer } from "../src/server/prod.js";

export async function startFormTestApp(mode, { layout = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "niral-forms-"));
  const previousRoot = globalThis.__niralProjectRoot;
  let app;
  try {
    mkdirSync(join(directory, "routes"));
    const source = readFileSync(new URL("./fixtures/forms.niral", import.meta.url), "utf8");
    writeFileSync(join(directory, "routes", "index.niral"), source.replace("<server>", "<server>\n  const fixtureId = " + JSON.stringify(directory) + ";"));
    writeFileSync(join(directory, "routes", "done.niral"), '<script>const navigation = pageNavigation();</script><h1 id="done">Saved</h1><slot><span id="page-fallback">Page fallback</span></slot><output id="navigation-pending">{navigation.pending}</output><output id="navigation-from">{navigation.from ?? ""}</output><output id="navigation-to">{navigation.to ?? ""}</output><a id="section-link" href="/done#details">Details</a><div style="height: 1200px"></div><h2 id="details">Details</h2><div style="height: 1000px"></div>');
    if (layout) writeFileSync(join(directory, "routes", "_layout.niral"), '<script>let { loads } = $props; let expanded = $state(false);</script><button id="layout-toggle" on:click={() => expanded = !expanded}>Toggle</button><p id="layout-state">{expanded}</p><p id="layout-loads">{loads}</p><slot/>');
    mkdirSync(join(directory, "routes", "section"));
    writeFileSync(join(directory, "routes", "section", "_layout.niral"), `<script>
let opened = $state(false);
setContext("nav-owner", "section");
onMount(() => {
  globalThis.sectionMounts = (globalThis.sectionMounts ?? 0) + 1;
  return () => { globalThis.sectionDisposals = (globalThis.sectionDisposals ?? 0) + 1; };
});
</script>
<button id="section-toggle" on:click={() => opened = !opened}>Toggle section</button>
<output id="section-state">{opened}</output><slot/>`);
    writeFileSync(join(directory, "routes", "section", "[id].niral"), `<server>
export function load({ params }) { return { loads: params.id, id: params.id }; }
</server>
<script>
let { id } = $props;
let draft = $state("");
let initialId = $state(id);
const owner = getContext("nav-owner");
onMount(() => {
  globalThis.routeMounts = (globalThis.routeMounts ?? 0) + 1;
  return () => { globalThis.routeDisposals = (globalThis.routeDisposals ?? 0) + 1; };
});
</script>
<main><h1 id="section-page">{id}</h1><output id="section-owner">{owner}</output>
<output id="initial-id">{initialId}</output>
<input id="page-draft" bind:value={draft}/><div style="height: 1200px"></div>
<h2 id="section-anchor">Anchor</h2><div style="height: 1000px"></div></main>`);
    if (mode === "prod") build({ root: directory });
    app = mode === "dev" ? createDevServer({ root: directory, port: 0, watch: false }) : createProdServer({ dist: join(directory, "dist"), port: 0, cwd: directory });
    const port = await new Promise((accept) => app.listen(accept));
    return { base: `http://localhost:${port}`, close() { app.close(); globalThis.__niralProjectRoot = previousRoot; rmSync(directory, { recursive: true, force: true }); } };
  } catch (error) {
    app?.close();
    globalThis.__niralProjectRoot = previousRoot;
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function registerFormTests(test) {
  test("page refresh tracks status, errors, duplicates and disposal", async () => {
    let resolveRefresh;
    let calls = 0;
    let aborted;
    configureRefresh((abortSignal) => {
      calls++;
      aborted = abortSignal;
      return new Promise((accept) => { resolveRefresh = accept; });
    });
    const [refreshing, dispose] = root(() => pageRefresh());
    try {
      const first = refreshing.refresh();
      assert.equal(refreshing.pending, true);
      assert.equal(await refreshing.refresh(), false);
      assert.equal(calls, 1);
      resolveRefresh(true);
      assert.equal(await first, true);
      assert.equal(refreshing.status, "success");
      configureRefresh(async () => { throw new Error("private detail"); });
      assert.equal(await refreshing.refresh(), false);
      assert.equal(refreshing.status, "error");
      assert.match(refreshing.error, /could not be refreshed/);
      configureRefresh(async () => false);
      assert.equal(await refreshing.refresh(), false);
      assert.equal(refreshing.status, "idle");
      configureRefresh((abortSignal) => {
        aborted = abortSignal;
        return new Promise((accept) => { resolveRefresh = accept; });
      });
      const last = refreshing.refresh();
      refreshing.reset();
      assert.equal(aborted.aborted, true);
      assert.equal(refreshing.status, "idle");
      resolveRefresh(true);
      assert.equal(await last, false);
      const disposed = refreshing.refresh();
      dispose();
      assert.equal(aborted.aborted, true);
      resolveRefresh(true);
      assert.equal(await disposed, false);
    } finally { dispose(); configureRefresh(async () => false); }
  });
  for (const mode of ["dev", "prod"]) test(`${mode} form results: validation, cookies, files, redirects and native fallback`, async () => {
    const app = await startFormTestApp(mode);
    const headers = { "x-niral-form": "1", "x-niral-result": "1" };
    const post = (action, body, extra = headers) => fetch(app.base + "/?/" + action, { method: "POST", headers: extra, body, redirect: "manual" });
    try {
      const page = await fetch(app.base);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /id="status">idle/);
      const invalid = await post("save", new URLSearchParams({ title: "a" }));
      assert.equal(invalid.status, 400);
      assert.match((await invalid.json()).errors.title, /3 characters/);
      const file = new FormData();
      file.append("title", "Saved title");
      file.append("upload", new Blob(["exact file bytes"], { type: "text/plain" }), "note.txt");
      file.append("intent", "save");
      const saved = await post("save", file);
      assert.equal(saved.status, 200);
      assert.ok(saved.headers.get("set-cookie"));
      assert.equal(saved.headers.get("cache-control"), "no-store");
      const payload = await saved.json();
      assert.equal(payload.result.bytes, "exact file bytes");
      assert.equal(payload.result.size, 16);
      assert.equal(payload.result.loads, 1);
      assert.equal(payload.props, undefined);
      const repeated = await post("echo", new URLSearchParams([["tag", "one"], ["tag", "two"]]));
      assert.deepEqual((await repeated.json()).result.fields.tag, ["one", "two"]);
      const leaving = await post("leave", new URLSearchParams());
      assert.equal((await leaving.json()).redirect, "/done");
      const failed = await post("fail", new URLSearchParams());
      assert.equal(failed.status, 500);
      const failure = await failed.json();
      assert.equal(failure.ok, false);
      if (mode === "prod") assert.ok(!JSON.stringify(failure).includes("private failure detail"));
      assert.equal((await post("load", new URLSearchParams())).status, 404);
      assert.equal((await post("save", new URLSearchParams({ title: "forbidden" }), { ...headers, origin: "https://other.test" })).status, 403);
      const native = await post("save", new URLSearchParams({ title: "Native title" }), {});
      assert.equal(native.status, 200);
      assert.match(await native.text(), /id="result">Native title/);
      const nativeError = await post("save", new URLSearchParams({ title: "x" }), {});
      assert.match(await nativeError.text(), /id="field-error">title needs at least 3 characters/);
      const nativeRedirect = await post("leave", new URLSearchParams(), {});
      assert.equal(nativeRedirect.status, 303);
    } finally { app.close(); }
  });
  test("form actions compile and bundle with a private result-only response", async () => {
    const compiled = compileClient('<script>const saving = formAction("save")</script><form method="post" action="?/save" on:submit={saving.submit}><button disabled={saving.pending}>Save</button></form>');
    assert.match(compiled.code, /const formAction = __n.formAction/);
    const bundled = bundleRuntime(fileURLToPath(new URL("../src/runtime", import.meta.url)));
    const runtime = await import("data:text/javascript;base64," + Buffer.from(bundled).toString("base64"));
    assert.equal(typeof runtime.formAction, "function");
    assert.equal(typeof runtime.pageRefresh, "function");
    assert.equal(typeof runtime.pageNavigation, "function");
    assert.equal(runtime.pageNavigation().pending, false);
    assert.equal(runtime.pageNavigation().to, null);
    assert.match(compileClient('<script>const navigation = pageNavigation()</script><p>{navigation.pending}</p>').code, /const pageNavigation = __n.pageNavigation/);
    assert.match(compileClient('<script>const data = pageRefresh()</script><button on:click={data.refresh}>{data.status}</button>').code, /const pageRefresh = __n.pageRefresh/);
    let status;
    let body;
    let headers;
    const response = { writeHead(code, values) { status = code; headers = values; }, end(value) { body = JSON.parse(value); } };
    const request = { headers: { "x-niral-form": "1", "x-niral-result": "1" } };
    assert.equal(sendFormResult(request, response, { status: 200, body: { ok: true, result: { id: 3 } }, setCookie: "session=value" }), true);
    assert.equal(status, 200);
    assert.equal(headers["set-cookie"], "session=value");
    assert.equal(body.result.id, 3);
    assert.equal(body.props, undefined);
    sendFormResult(request, response, { status: 200, body: { ok: true, result: { errors: { title: "Required" } } } });
    assert.equal(status, 400);
    assert.equal(body.errors.title, "Required");
    assert.equal(sendFormResult({ headers: {} }, response, {}), false);
  });
  test("reactive form actions preserve fields, track state and prevent duplicate requests", async () => {
    const previous = { fetch: globalThis.fetch, FormData: globalThis.FormData, location: globalThis.location };
    const NativeFormData = globalThis.FormData;
    const fields = new NativeFormData();
    fields.append("title", "draft");
    fields.append("upload", new Blob(["file bytes"]), "sample.txt");
    const form = { getAttribute: (name) => ({ action: "?/save", method: "post" })[name] ?? null };
    const event = () => ({ currentTarget: form, preventDefault() { this.defaultPrevented = true; } });
    let resolveResponse;
    let calls = 0;
    let changes = 0;
    let dispose;
    try {
      globalThis.location = new URL("https://example.test/editor");
      globalThis.FormData = class { constructor() { return fields; } };
      configureForms({ changed: () => changes++, redirect: () => {} });
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, "/editor?/save");
        assert.equal(options.body, fields);
        assert.equal(options.headers["content-type"], undefined);
        assert.equal(options.headers["x-niral-result"], "1");
        return new Promise((accept) => { resolveResponse = accept; });
      };
      const statuses = [];
      const [action, cleanup] = root(() => {
        const action = formAction("save");
        effect(() => statuses.push(action.status));
        return action;
      });
      dispose = cleanup;
      const first = action.submit(event());
      assert.equal(action.pending, true);
      await action.submit(event());
      assert.equal(calls, 1);
      resolveResponse(Response.json({ ok: false, errors: { title: "Required" }, error: "validation failed" }, { status: 400 }));
      await first;
      assert.equal(action.errors.title, "Required");
      assert.equal(action.statusCode, 400);
      assert.equal(fields.get("title"), "draft");
      assert.deepEqual(statuses, ["idle", "pending", "error"]);
      const second = action.submit(event());
      resolveResponse(Response.json({ ok: true, result: { id: 7 } }));
      await second;
      assert.equal(action.status, "success");
      assert.equal(action.result.id, 7);
      assert.equal(changes, 2);
      globalThis.fetch = async () => { calls++; throw new Error("network"); };
      await action.submit(event());
      assert.equal(calls, 3);
      assert.equal(action.status, "error");
      assert.match(action.error, /before retrying/);
      action.reset();
      assert.equal(action.status, "idle");
    } finally {
      dispose?.();
      Object.assign(globalThis, previous);
      configureForms({ changed: () => {}, redirect: () => {} });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tests = [];
  registerFormTests((name, run) => tests.push({ name, run }));
  for (const { name, run } of tests) {
    await run();
    console.log("PASS " + name);
  }
}