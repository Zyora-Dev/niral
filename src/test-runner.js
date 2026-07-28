/**
 * niral test — run a PROJECT's tests (tests/*.test.js), zero setup.
 *
 * Test files use ambient helpers — no imports, no packages:
 *
 *   // tests/app.test.js
 *   test("home renders and the RPC works", async () => {
 *     const app = await startApp()
 *     const html = await (await fetch(app.url + "/")).text()
 *     ok(html.includes("<h1>"), "page rendered")
 *     app.close()
 *   })
 *
 * Ambient API:
 *   test(name, fn)             register a test
 *   ok(value, msg?)            assert truthy
 *   eq(actual, expected, msg?) assert deep-equal
 *   startApp()                 boot THIS project (real server, random port)
 *                              → { url, close() }
 *   renderRoute(file, props)   SSR one component → { html, contains() }
 */

import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function runProjectTests({ projectDir }) {
  const root = resolve(projectDir);
  const dir = join(root, "tests");
  if (!existsSync(dir)) {
    console.log("niral · no tests/ directory — create tests/app.test.js and use the ambient test()/ok()/eq()/startApp() helpers");
    return { pass: 0, fail: 0, none: true };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
  if (!files.length) {
    console.log("niral · tests/ has no *.test.js files");
    return { pass: 0, fail: 0, none: true };
  }

  const queue = [];
  const opened = []; // auto-close servers a test forgot to close

  globalThis.test = (name, fn) => queue.push({ name, fn });
  globalThis.ok = (v, msg = "expected truthy") => {
    if (!v) throw new Error(msg);
  };
  globalThis.eq = (a, b, msg = "not equal") => {
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja !== jb) throw new Error(`${msg}\n  actual:   ${ja}\n  expected: ${jb}`);
  };
  globalThis.startApp = async () => {
    const { createDevServer } = await import("./dev/server.js");
    const server = createDevServer({ root, port: 0, watch: false });
    const port = await new Promise((r) => server.listen(r));
    const app = { url: `http://localhost:${port}`, close: () => server.close() };
    opened.push(app);
    return app;
  };
  globalThis.renderRoute = async (file, props = {}) => {
    const { renderRoute } = await import("./testing.js");
    return renderRoute(join(root, file), props);
  };

  for (const f of files) await import(pathToFileURL(join(dir, f)).href);

  let pass = 0;
  let fail = 0;
  for (const { name, fn } of queue) {
    try {
      await fn();
      pass++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${name}\n    ${String(e?.message ?? e).split("\n").join("\n    ")}`);
    }
  }
  for (const app of opened) {
    try {
      app.close();
    } catch {
      /* already closed */
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  return { pass, fail };
}
