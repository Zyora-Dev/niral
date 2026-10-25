import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevServer, compileForDev } from "../src/dev/server.js";
import { compileClient } from "../src/compiler/codegen.js";
import { createDevtools, localDevtoolsRequest } from "../src/dev/devtools.js";
import { createErrorTracker } from "../src/dev/devtools-errors.js";
import { rpc } from "../src/runtime/rpc.js";

test("error buffers stay bounded, repeated throws count, and inactive events are not attributed", async () => {
  const tracker = createErrorTracker();
  tracker.register("/routes/index.niral", { lines: Object.fromEntries(Array.from({ length: 105 }, (_, index) => [index + 1, index + 1])) });
  for (let index = 1; index <= 105; index++) {
    tracker.capture({ name: "Error", stack: `Error: secret\n    at nir al\n    at fail (niral:/routes/index.niral:${index}:1)` });
  }
  assert.equal(tracker.snapshot().length, 100);
  assert.equal(tracker.snapshot().at(-1).id, 6);
  tracker.clear();
  const reused = new Error("private-reused-error");
  for (let index = 0; index < 25; index++) tracker.capture(reused);
  assert.equal(tracker.snapshot()[0].count, 25);
  assert.equal(tracker.snapshot()[0].occurrences.length, 20);
  tracker.capture(reused, { kind: "rejection" });
  assert.equal(tracker.snapshot()[0].count, 25, "propagating an already recorded error does not duplicate it");
  assert.doesNotThrow(() => tracker.capture({ get name() { throw new Error("secret"); } }));
  tracker.clear();
  const event = { eventPhase: 1 };
  tracker.action("click", event);
  const active = tracker.rpc();
  event.eventPhase = 0;
  const inactive = tracker.rpc();
  active.fail(new Error("secret"));
  inactive.fail(new Error("secret"));
  assert.equal(tracker.snapshot()[0].occurrences[0].action, null);
  assert.equal(tracker.snapshot()[1].occurrences[0].action.type, "click");
  const cloned = tracker.snapshot();
  cloned[0].occurrences.push({ secret: true });
  assert.doesNotMatch(JSON.stringify(tracker.snapshot()), /secret/);
});

test("dev source locations map only unambiguous client lines and do not ship server code", () => {
  const source = '<server>export function fail() { throw new Error("server-secret"); }</server>\n<script>\nfunction click() {\n  return fail();\n}\nlet count = $state(0);\n</script>\n<button on:click={click}>{count}</button>';
  const code = compileForDev(source, "/routes/index.niral");
  const metadata = JSON.parse(code.match(/\.register\("\/routes\/index\.niral", (\{[^\n]+\})\);/)[1]);
  const generated = code.split("\n").findIndex(line => line.trim() === "return fail();") + 1;
  assert.equal(metadata.lines[generated], 4);
  assert.ok(!Object.values(metadata.lines).includes(6), "transformed lines are not guessed");
  assert.doesNotMatch(code, /server-secret/);
  assert.doesNotMatch(compileClient(source).code, /errors\?\.register|vscode:\/\/file/);
  const duplicated = compileForDev('<script>\nfunction first() {\n  throw new Error("repeat");\n}\nfunction second() {\n  throw new Error("repeat");\n}\n</script><h1>Test</h1>', "/routes/index.niral");
  const repeatedMetadata = JSON.parse(duplicated.match(/\.register\("\/routes\/index\.niral", (\{[^\n]+\})\);/)[1]);
  assert.ok(!Object.values(repeatedMetadata.lines).includes(3) && !Object.values(repeatedMetadata.lines).includes(6));
});

test("browser error groups redact values and RPC observers preserve concurrent and streamed failures", async () => {
  const tracker = createErrorTracker();
  tracker.register("/routes/index.niral", { lines: { 9: 4 }, editor: "vscode://file/app/routes/index.niral" });
  const error = new TypeError("password=private-secret");
  error.stack = "TypeError: private-secret\n    at fail (niral:/routes/index.niral:9:12)";
  tracker.capture(error);
  tracker.capture(error, { kind: "rejection" });
  tracker.capture(Object.assign(new TypeError("different private value"), { stack: error.stack }));
  assert.equal(tracker.snapshot()[0].count, 2);
  assert.equal(tracker.snapshot()[0].source.line, 4);
  assert.doesNotMatch(JSON.stringify(tracker.snapshot()), /private|password/);
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { __NIRAL_HMR__: { errors: tracker } };
  try {
    const pending = [];
    globalThis.fetch = () => new Promise(resolveResponse => pending.push(resolveResponse));
    tracker.action("click");
    const first = rpc("/routes/index.niral", "fail", ["secret"]);
    const second = rpc("/routes/index.niral", "fail", ["secret"]);
    const settled = Promise.allSettled([first, second]);
    pending[1](new Response(JSON.stringify({ ok: false, error: "private-error", errors: { password: "secret" } }), { headers: { "x-niral-trace": "00000000-0000-0000-0000-000000000002" } }));
    pending[0](new Response(JSON.stringify({ ok: false, error: "private-error" }), { headers: { "x-niral-trace": "00000000-0000-0000-0000-000000000001" } }));
    const results = await settled;
    assert.equal(results[1].reason.errors.password, "secret");
    tracker.capture(results[0].reason, { kind: "rejection" });
    const group = tracker.snapshot().find(entry => entry.kind === "rpc");
    assert.equal(group.count, 2);
    assert.deepEqual(group.occurrences.map(entry => entry.requestId), ["00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000001"]);
    assert.equal(group.occurrences[0].action.type, "click");
    globalThis.fetch = async () => new Response('{"chunk":"secret"}\n{"error":"private-stream"}\n', { headers: { "x-niral-stream": "1", "x-niral-trace": "00000000-0000-0000-0000-000000000003" } });
    const stream = await rpc("/routes/index.niral", "stream", []);
    assert.deepEqual(await stream.next(), { value: "secret", done: false });
    await assert.rejects(stream.next(), /private-stream/);
    assert.equal(tracker.snapshot()[0].kind, "rpc-stream");
    assert.equal(tracker.snapshot()[0].occurrences[0].requestId, "00000000-0000-0000-0000-000000000003");
    globalThis.fetch = async () => { throw new TypeError("private-network-error"); };
    await assert.rejects(rpc("/routes/index.niral", "fail", []));
    assert.equal(tracker.snapshot()[0].occurrences[0].requestId, null);
    assert.doesNotMatch(JSON.stringify(tracker.snapshot()), /private|password|secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

function request(headers = {}) {
  return { url: "/users/private-token?password=secret", method: "GET", headers: { host: "localhost:5199", ...headers }, socket: { remoteAddress: "127.0.0.1", localPort: 5199 } };
}

function response() {
  return Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true, headers: {}, setHeader(name, value) { this.headers[name] = value; } });
}

test("devtools rejects remote, forwarded, cross-origin and rebinding requests", () => {
  assert.equal(localDevtoolsRequest(request()), true);
  for (const headers of [{ host: "attacker.test:5199" }, { host: "localhost:9999" }, { origin: "https://attacker.test" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "x-forwarded-for": "127.0.0.1" }, { forwarded: "for=127.0.0.1" }, { host: "user@localhost:5199" }]) {
    assert.equal(localDevtoolsRequest(request(headers)), false);
  }
  const remote = request();
  remote.socket.remoteAddress = "192.168.1.2";
  assert.equal(localDevtoolsRequest(remote), false);
  const res = response();
  createDevtools("/app").run(remote, res, () => {});
  assert.equal(res.headers["x-niral-trace"], undefined);
});

test("devtools isolates concurrent loads and omits private request/error values", async () => {
  const tools = createDevtools("/app");
  await Promise.all(["first", "second"].map(async name => {
    const res = response();
    await tools.run(request({ cookie: "session-secret", authorization: "Bearer secret" }), res, async () => {
      tools.route({ pattern: "/users/[id]", file: `/app/routes/${name}.niral` }, [{ abs: "/app/routes/_layout.niral" }]);
      await tools.load(`/app/routes/${name}.niral`, async () => { await Promise.resolve(); return { password: "secret" }; });
      res.emit("finish");
      res.emit("close");
      assert.ok(tools.snapshot().some(trace => trace.requestId === res.headers["x-niral-trace"]));
    });
  }));
  const traces = tools.snapshot();
  assert.equal(traces.length, 2);
  assert.notEqual(traces[0].id, traces[1].id);
  assert.notEqual(traces[0].requestId, traces[1].requestId);
  for (const trace of traces) {
    assert.equal(trace.module, trace.loads[0].module);
    assert.deepEqual(trace.layouts, ["routes/_layout.niral"]);
    assert.ok(trace.duration >= 0 && trace.loads[0].duration >= 0);
  }
  assert.doesNotMatch(JSON.stringify(traces), /private-token|password|secret|authorization|cookie/);
  traces[0].layouts.push("modified");
  assert.equal(tools.snapshot()[0].layouts.length, 1);
});

test("devtools bounds history, reports failures without messages, and ignores internal requests", async () => {
  const tools = createDevtools("/app");
  for (let index = 0; index < 105; index++) {
    const res = response();
    await tools.run(request(), res, async () => {
      await assert.rejects(tools.load("/app/routes/index.niral", async () => { throw new Error("private-secret"); }));
      res.statusCode = 500;
      res.emit("finish");
    });
  }
  const traces = tools.snapshot();
  assert.equal(traces.length, 100);
  assert.equal(traces[0].id, 6);
  assert.equal(traces[0].failure, "loader");
  assert.equal(traces[0].loads[0].failed, true);
  assert.doesNotMatch(JSON.stringify(traces), /private-secret/);
  const req = request();
  req.url = "/@niral/devtools";
  const res = response();
  tools.run(req, res, () => res.emit("finish"));
  assert.equal(tools.snapshot().at(-1).id, 105);
});

test("dev server traces routes, navigation, RPC and stream failures with a protected endpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "niral-devtools-"));
  mkdirSync(join(root, "routes", "users"), { recursive: true });
  writeFileSync(join(root, "routes", "_layout.niral"), '<server>export function load() { return { layout: "secret-layout" }; }</server><slot/>');
  writeFileSync(join(root, "routes", "broken.niral"), '<server>export function load() { throw new Error("private-loader-error"); }</server><h1>Broken</h1>');
  writeFileSync(join(root, "routes", "guarded.niral"), '<server auth>export function load() { return {}; }</server><h1>Guarded</h1>');
  writeFileSync(join(root, "routes", "users", "[id].niral"), `<server>
export function load({ params }) { return { value: params.id }; }
export function echo(value) { return value; }
export function fail() { throw new Error("private-error"); }
export async function* stream() { yield "private-chunk"; throw new Error("private-stream-error"); }
</server><script>let { value } = $props</script><h1>{value}</h1>`);
  const dev = createDevServer({ root, port: 0, watch: false });
  try {
    const port = await new Promise(ready => dev.listen(ready));
    const base = `http://localhost:${port}`;
    const headers = { "x-niral-devtools": "1" };
    assert.equal((await fetch(base + "/users/private-id?password=private-query")).status, 200);
    assert.equal((await fetch(base + "/users/second-private-id", { headers: { "x-niral-nav": "1" } })).status, 200);
    const requestIds = [];
    for (const fn of ["echo", "fail", "stream", "privateUnknownFunction"]) {
      const result = await fetch(base + "/@niral/rpc", { method: "POST", headers: { "x-niral-rpc": "1", "content-type": "application/json" }, body: JSON.stringify({ module: "/routes/users/[id].niral", fn, args: ["private-argument"] }) });
      requestIds.push(result.headers.get("x-niral-trace"));
      await result.text();
      assert.equal(result.status, fn === "fail" ? 500 : fn === "privateUnknownFunction" ? 404 : 200);
    }
    const result = await fetch(base + "/@niral/devtools", { headers });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const { traces } = await result.json();
    assert.equal(traces.length, 6);
    assert.deepEqual(traces.slice(2).map(trace => trace.requestId), requestIds);
    assert.ok(requestIds.every(id => /^[0-9a-f-]{36}$/.test(id)));
    assert.equal(traces[0].route, "/users/[id]");
    assert.deepEqual(traces[0].loads.map(span => span.module), ["routes/_layout.niral", "routes/users/[id].niral"]);
    assert.equal(traces[1].kind, "route");
    assert.equal(traces[2].fn, "echo");
    assert.equal(traces[3].failure, "rpc");
    assert.equal(traces[4].failure, "rpc-stream");
    assert.equal(traces[5].fn, "(unavailable)");
    assert.doesNotMatch(JSON.stringify(traces), /private|secret|password/);
    assert.equal((await fetch(base + "/broken")).status, 500);
    assert.equal((await fetch(base + "/guarded", { redirect: "manual" })).status, 303);
    const updated = (await (await fetch(base + "/@niral/devtools", { headers })).json()).traces;
    assert.equal(updated.at(-2).failure, "loader", "outer handlers preserve the root failure");
    assert.equal(updated.at(-2).loads.at(-1).failed, true);
    assert.equal(updated.at(-1).failure, null, "auth redirects are not loader failures");
    assert.equal(updated.at(-1).loads.at(-1).failed, false);
    assert.doesNotMatch(JSON.stringify(updated), /private|secret|password/);
    for (const invalid of [{}, { ...headers, origin: "https://attacker.test" }, { ...headers, host: `attacker.test:${port}` }, { ...headers, "x-forwarded-for": "127.0.0.1" }, { ...headers, "sec-fetch-site": "cross-site" }]) {
      const status = await new Promise((resolveStatus, reject) => {
        const req = httpRequest(base + "/@niral/devtools", { headers: invalid }, res => {
          res.resume();
          resolveStatus(res.statusCode);
        });
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 403, JSON.stringify(invalid));
    }
    assert.equal((await fetch(base + "/@niral/devtools", { method: "POST", headers })).status, 405);
  } finally {
    dev.close();
    dev.server.closeAllConnections();
    rmSync(root, { recursive: true, force: true });
  }
});