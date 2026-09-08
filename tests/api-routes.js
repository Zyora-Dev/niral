import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "../src/build/build.js";
import { createDevServer } from "../src/dev/server.js";
import { createProdServer } from "../src/server/prod.js";
import { scanEndpoints, scanRoutes, matchRoute } from "../src/server/router.js";
import { addApi } from "../src/add/api.js";

const fixture = () => mkdtempSync(join(tmpdir(), "niral-endpoints-"));
function put(root, file, source) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), source);
}

export function registerApiTests(test) {
  test("endpoint scanner separates pages, resolves params and rejects collisions", () => {
    const root = fixture();
    try {
      put(root, "routes/api/[id].server.js", "export function GET() {}");
      assert.equal(scanRoutes(join(root, "routes")).length, 0);
      assert.equal(matchRoute(scanEndpoints(join(root, "routes")), "/api/a%252Fb").params.id, "a%2Fb");
      put(root, "routes/api/items/[id].server.js", "export function GET() {}");
      put(root, "routes/api/[group]/new.server.js", "export function GET() {}");
      assert.equal(matchRoute(scanEndpoints(join(root, "routes")), "/api/items/new").route.rel, "api/items/[id].server.js");
      put(root, "routes/api/[name].niral", "<p>collision</p>");
      assert.throws(() => scanEndpoints(join(root, "routes")), /collision/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("API scaffold is runnable, refuses overwrites and builds without pages", () => {
    const root = fixture();
    try {
      addApi({ root });
      assert.throws(() => addApi({ root }), /already exists/);
      const result = build({ root });
      assert.equal(result.routes, 1);
      const manifest = JSON.parse(readFileSync(join(result.release, "manifest.json")));
      assert.equal(manifest.routes.length, 0);
      assert.equal(manifest.endpoints.length, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("endpoint build hashes private imports and rejects invalid or client imports", () => {
    const root = fixture();
    try {
      put(root, "routes/api.server.js", 'import { value } from "../lib/helper.js"; export function GET() { return Response.json(value); }');
      put(root, "lib/helper.js", 'export { value } from "./nested.server.js";');
      put(root, "lib/nested.server.js", 'export const value = "private";');
      const first = build({ root });
      assert.equal(existsSync(join(first.release, "static/lib/helper.js")), false);
      assert.equal(existsSync(join(first.release, "static/lib/nested.server.js")), false);
      assert.ok(existsSync(join(first.release, "server/endpoints/lib/helper.js")));
      put(root, "lib/nested.server.js", 'export const value = "changed";');
      const second = build({ root });
      assert.notEqual(first.hash, second.hash);
      put(root, "lib/nested.server.js", "export const value = ;");
      assert.throws(() => build({ root }), /Invalid endpoint module/);
      assert.equal(JSON.parse(readFileSync(join(root, "dist/current/manifest.json"))).hash, second.hash);
      put(root, "lib/nested.server.js", 'export const value = "changed";');
      put(root, "routes/index.niral", '<script>\nimport { value } from "../lib/helper.js";\n</script><p>{value}</p>');
      assert.throws(() => build({ root }), /private endpoint code/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  for (const mode of ["dev", "prod"]) test(`${mode} endpoints: authenticated CRUD, webhook, methods, streaming and privacy`, async () => {
    const root = fixture();
    const previousRoot = globalThis.__niralProjectRoot;
    const previousShield = process.env.NIRAL_SHIELD;
    process.env.NIRAL_SHIELD = "off";
    let app;
    try {
      put(root, "package.json", '{"type":"module"}');
      put(root, "hooks.js", `export function handle(event) {
        event.locals.marker = "middleware";
        event.session.set("middleware", true);
        if (event.headers.authorization === "Bearer integration-test") event.session.set("user", { id: "test-user" });
      }`);
      put(root, "lib/store.js", 'export const records = new Map(); export const marker = "private-server-marker";');
      put(root, "routes/api/items/[id].server.js", `import { records } from "../../../lib/store.js";
        export function GET({ params, session, locals, url, user }) {
          if (!user()) return Response.json({ error: "unauthorized" }, { status: 401 });
          const value = records.get(user().id + ":" + params.id);
          return Response.json({ id: params.id, value, marker: locals.marker, query: url.searchParams.get("q"), middleware: session.get("middleware") });
        }
        export async function PUT({ params, request, user }) {
          if (!user()) return Response.json({ error: "unauthorized" }, { status: 401 });
          records.set(user().id + ":" + params.id, await request.json());
          return new Response(null, { status: 201, headers: { "set-cookie": "custom=ok; Path=/" } });
        }
        export const PATCH = PUT;
        export function DELETE({ params, user }) {
          if (!user()) return new Response(null, { status: 401 });
          records.delete(user().id + ":" + params.id);
          return new Response(null, { status: 204 });
        }`);
      put(root, "routes/api/webhook.server.js", `import { createHmac, timingSafeEqual } from "node:crypto";
        export async function POST({ request }) {
          const raw = Buffer.from(await request.arrayBuffer());
          const expected = createHmac("sha256", "fixture-only-secret").update(raw).digest();
          const signature = request.headers.get("x-signature") ?? "";
          if (!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, "hex"))) return new Response(null, { status: 401 });
          return Response.json({ bytes: raw.length });
        }`);
      put(root, "routes/api/stream.server.js", `export function GET() { return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("first\\nsecond")); controller.close(); } })); }`);
      put(root, "routes/api/error.server.js", 'export function GET() { throw new Error("internal-secret-marker"); }');
      put(root, "routes/api/explicit.server.js", 'export function HEAD() { return new Response(null, { status: 202 }); } export function OPTIONS() { return new Response(null, { status: 200, headers: { "x-custom": "yes" } }); }');
      put(root, "routes/index.niral", "<h1>Page still works</h1>");
      if (mode === "prod") build({ root });
      app = mode === "dev" ? createDevServer({ root, port: 0, watch: false, secret: "test-secret" }) : createProdServer({ dist: join(root, "dist"), cwd: root, port: 0, secret: "test-secret" });
      const port = await new Promise((resolve) => app.listen(resolve));
      const base = `http://localhost:${port}`;
      const route = base + "/api/items/one";
      assert.equal((await fetch(route)).status, 401);
      assert.equal((await fetch(base + "/api/items/%ZZ")).status, 400);
      const created = await fetch(route, { method: "PUT", headers: { authorization: "Bearer integration-test" }, body: '{"text":"hello"}' });
      assert.equal(created.status, 201);
      const cookies = created.headers.getSetCookie();
      assert.equal(cookies.length, 2);
      const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
      const headers = { cookie };
      assert.deepEqual(await (await fetch(route + "?q=search", { headers })).json(), { id: "one", value: { text: "hello" }, marker: "middleware", query: "search", middleware: true });
      assert.equal((await fetch(route, { method: "PATCH", headers, body: '{"text":"edited"}' })).status, 201);
      assert.deepEqual((await (await fetch(route, { headers })).json()).value, { text: "edited" });
      assert.equal((await fetch(route, { method: "HEAD", headers })).status, 200);
      assert.equal(await (await fetch(route, { method: "HEAD", headers })).text(), "");
      const disallowed = await fetch(route, { method: "POST" });
      assert.equal(disallowed.status, 405);
      assert.equal(disallowed.headers.get("allow"), "GET, HEAD, PUT, PATCH, DELETE, OPTIONS");
      assert.equal((await fetch(route, { method: "OPTIONS" })).status, 204);
      assert.equal((await fetch(base + "/api/explicit", { method: "HEAD" })).status, 202);
      assert.equal((await fetch(base + "/api/explicit", { method: "OPTIONS" })).headers.get("x-custom"), "yes");
      assert.equal((await fetch(route, { method: "PUT", headers, body: "{" })).status, 400);
      assert.equal((await fetch(route, { method: "PUT", headers, body: "x".repeat(1048577) })).status, 413);
      assert.equal((await fetch(route, { method: "PUT", headers: { ...headers, origin: "https://other.example" }, body: "{}" })).status, 403);
      assert.equal((await fetch(route, { method: "DELETE", headers })).status, 204);
      assert.equal((await (await fetch(route, { headers })).json()).value, undefined);
      const payload = Buffer.from('{ "event": "created" }\n');
      const signature = createHmac("sha256", "fixture-only-secret").update(payload).digest("hex");
      assert.equal((await fetch(base + "/api/webhook", { method: "POST", body: payload })).status, 401);
      assert.deepEqual(await (await fetch(base + "/api/webhook", { method: "POST", headers: { "x-signature": signature }, body: payload })).json(), { bytes: payload.length });
      assert.equal(await (await fetch(base + "/api/stream")).text(), "first\nsecond");
      const error = await fetch(base + "/api/error");
      assert.equal(error.status, 500);
      if (mode === "prod") assert.equal((await error.text()).includes("internal-secret-marker"), false);
      for (const path of ["/lib/store.js", "/routes/api/webhook.server.js", "/dist/current/server/endpoints/lib/store.js", "/.niral/endpoints/test"]) assert.equal((await fetch(base + path)).status, 404, path);
      assert.ok((await (await fetch(base)).text()).includes("Page still works"));
      if (mode === "dev") {
        put(root, "lib/store.js", 'export const records = new Map([["test-user:one", "reloaded"]]);');
        assert.equal((await (await fetch(route, { headers })).json()).value, "reloaded");
      }
    } finally {
      if (app) await app.close();
      globalThis.__niralProjectRoot = previousRoot;
      if (previousShield === undefined) delete process.env.NIRAL_SHIELD;
      else process.env.NIRAL_SHIELD = previousShield;
      rmSync(root, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tests = [];
  registerApiTests((name, run) => tests.push({ name, run }));
  for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
}