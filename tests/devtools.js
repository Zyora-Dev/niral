import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevServer } from "../src/dev/server.js";
import { createDevtools, localDevtoolsRequest } from "../src/dev/devtools.js";

function request(headers = {}) {
  return { url: "/users/private-token?password=secret", method: "GET", headers: { host: "localhost:5199", ...headers }, socket: { remoteAddress: "127.0.0.1", localPort: 5199 } };
}

function response() {
  return Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
}

test("devtools rejects remote, forwarded, cross-origin and rebinding requests", () => {
  assert.equal(localDevtoolsRequest(request()), true);
  for (const headers of [{ host: "attacker.test:5199" }, { host: "localhost:9999" }, { origin: "https://attacker.test" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "x-forwarded-for": "127.0.0.1" }, { forwarded: "for=127.0.0.1" }, { host: "user@localhost:5199" }]) {
    assert.equal(localDevtoolsRequest(request(headers)), false);
  }
  const remote = request();
  remote.socket.remoteAddress = "192.168.1.2";
  assert.equal(localDevtoolsRequest(remote), false);
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
    });
  }));
  const traces = tools.snapshot();
  assert.equal(traces.length, 2);
  assert.notEqual(traces[0].id, traces[1].id);
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
    for (const fn of ["echo", "fail", "stream", "privateUnknownFunction"]) {
      const result = await fetch(base + "/@niral/rpc", { method: "POST", headers: { "x-niral-rpc": "1", "content-type": "application/json" }, body: JSON.stringify({ module: "/routes/users/[id].niral", fn, args: ["private-argument"] }) });
      await result.text();
      assert.equal(result.status, fn === "fail" ? 500 : fn === "privateUnknownFunction" ? 404 : 200);
    }
    const result = await fetch(base + "/@niral/devtools", { headers });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const { traces } = await result.json();
    assert.equal(traces.length, 6);
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