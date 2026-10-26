/**
 * Niral real-browser smoke tests.
 *
 * The main suite (npm test) runs in a DOM shim — fast, but a shim can't catch
 * browser-only bugs (e.g. {@html} hydration, where a real browser parses raw
 * HTML into many nodes but the shim keeps it as one). This suite boots a real
 * niral app and drives it in headless Chromium, asserting the things only a
 * real browser can prove:
 *
 *   · the page server-renders, then hydrates with ZERO console warnings
 *   · reactivity updates the ACTUAL DOM (click the counter → text changes)
 *   · a server RPC round-trips from the browser
 *   · client-side navigation works and the back button restores state
 *
 * Dev-only. Run:  npm install && npm test   (in this folder)
 * The framework itself never depends on Playwright.
 */

import { chromium } from "playwright";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../../src/dev/server.js";
import { parseComponent } from "../../src/compiler/codegen.js";
import { errorPage } from "../../src/server/page.js";

const here = dirname(fileURLToPath(import.meta.url));
const NIRAL = join(here, "..", "..", "bin", "niral.js");

let pass = 0, fail = 0;
const failures = [];
async function test(name, fn) {
  if (process.env.NIRAL_BROWSER_FILTER && !name.includes(process.env.NIRAL_BROWSER_FILTER)) return;
  try { await fn(); pass++; console.log(`  \u2713 ${name}`); }
  catch (e) { fail++; failures.push({ name, e }); console.error(`  \u2717 ${name}\n    ${e.message}`); }
}
function ok(v, m = "expected truthy") { if (!v) throw new Error(m); }
function eq(a, b, m = "not equal") { if (a !== b) throw new Error(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── boot a real scaffolded niral app in production mode ──
const app = mkdtempSync(join(tmpdir(), "niral-browser-"));
spawnSync("node", [NIRAL, "create", app], { stdio: "ignore" });
writeFileSync(join(app, "routes", "niralscript.niral"), readFileSync(join(here, "..", "fixtures", "niralscript.niral"), "utf8"));
const nrsFixture = readFileSync(join(here, "..", "fixtures", "niralscript.niral"), "utf8");
const nrsSource = parseComponent(nrsFixture).script.code;
writeFileSync(join(app, "routes", "counter.nrs"), nrsSource);
writeFileSync(join(app, "routes", "niralscript-external.niral"), nrsFixture.replace('<script lang="niralscript">', '<script lang="niralscript" src="./counter.nrs">').replace(nrsSource, ""));
const moduleSource = 'import { initial, twice } from "../math.nrs"\n' + nrsSource.replace("state count = 0", "state count = initial").replace("derive doubled = count * 2", "derive doubled = twice(count)");
writeFileSync(join(app, "base.nrs"), "export const initial = 0\nexport const factor = 2");
writeFileSync(join(app, "math.nrs"), 'import { initial as start, factor } from "./base.nrs"\nexport const initial = start\nexport function twice(value) { return value * factor }');
writeFileSync(join(app, "routes", "module.nrs"), moduleSource);
writeFileSync(join(app, "routes", "niralscript-modules.niral"), nrsFixture.replace('<script lang="niralscript">', '<script lang="niralscript" src="./module.nrs">').replace(nrsSource, "") + '<output id="imported">{twice(initial)}</output>');
writeFileSync(join(app, "source.NRS"), "RAW_NRS_MUST_STAY_PRIVATE");
spawnSync("node", [NIRAL, "build", app], { stdio: "ignore" });
const PORT = 4788;
const server = spawn("node", [NIRAL, "start", app, "-p", String(PORT)], {
  stdio: "ignore",
  env: { ...process.env, NIRAL_LOG: "off", NIRAL_SHIELD: "off" }, // shield off so rapid test nav isn't banned
});

async function waitUp(url, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("app never came up");
}

const base = `http://localhost:${PORT}`;
let browser;
try {
  await waitUp(base + "/@niral/health");
  browser = await chromium.launch();

  await test("NiralScript: dev and production SSR, hydration, state, bindings, keyed lists and RPC", async () => {
    const dev = createDevServer({ root: app, port: 0, watch: false });
    try {
      const port = await new Promise(ready => dev.listen(ready));
      for (const origin of [base, `http://localhost:${port}`]) {
        for (const path of ["/routes/counter.nrs", "/source.NRS", "/math.nrs", "/base.nrs"]) eq((await fetch(origin + path)).status, 404, "raw NiralScript is private");
        for (const route of ["niralscript", "niralscript-external", "niralscript-modules"]) {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
          if (message.type() === "warning" || message.type() === "error") errors.push(message.text());
        });
        try {
          const response = await page.goto(origin + "/" + route, { waitUntil: "networkidle" });
          eq(response.status(), 200, "NiralScript route loads");
          ok((await response.text()).includes('<output id="doubled">0</output>'), "derived value server rendered");
          eq(await page.locator("#count").textContent(), "0");
          if (route === "niralscript-modules") eq(await page.locator("#imported").textContent(), "0", "imported aliases remain visible to templates");
          for (let click = 0; click < 3; click++) await page.getByRole("button", { name: "Increase", exact: true }).click();
          eq(await page.locator("#count").textContent(), "3");
          eq(await page.locator("#doubled").textContent(), "6");
          await page.getByRole("button", { name: "Reset", exact: true }).click();
          eq(await page.locator("#doubled").textContent(), "0");
          ok(await page.getByRole("button", { name: "Add item", exact: true }).isDisabled());
          await page.getByLabel("Draft").fill("First item");
          await page.getByRole("button", { name: "Add item", exact: true }).click();
          eq(await page.locator("li").first().textContent(), "First item");
          eq(await page.getByLabel("Draft").inputValue(), "");
          await page.locator("li").first().evaluate(element => { element.dataset.retained = "yes"; });
          await page.getByLabel("Draft").fill("Second item");
          await page.getByRole("button", { name: "Add item", exact: true }).click();
          eq(await page.locator("li").count(), 2);
          eq(await page.locator("#total").textContent(), "2");
          eq(await page.locator("li").first().getAttribute("data-retained"), "yes", "keyed node retained");
          await page.getByRole("button", { name: "Ping server", exact: true }).click();
          await page.waitForFunction(() => document.querySelector("#reply").textContent === "pong");
          eq(errors.length, 0, "no hydration warnings or browser errors: " + errors.join(" | "));
        } finally {
          await page.close();
        }
        }
      }
    } finally {
      dev.close();
    }
  });

  await test("NiralScript: external and transitive source edits reload the browser and refresh SSR", async () => {
    for (const [route, file, original, changed] of [
      ["niralscript-external", "routes/counter.nrs", nrsSource, nrsSource.replace("state count = 0", "state count = 7")],
      ["niralscript-modules", "base.nrs", "export const initial = 0\nexport const factor = 2", "export const initial = 7\nexport const factor = 2"],
    ]) {
      const dev = createDevServer({ root: app, port: 0 });
      const page = await browser.newPage();
      try {
        const port = await new Promise(ready => dev.listen(ready));
        const origin = `http://localhost:${port}`;
        await page.goto(origin + "/" + route, { waitUntil: "networkidle" });
        eq(await page.locator("#count").textContent(), "0");
        const reloaded = page.waitForEvent("load");
        writeFileSync(join(app, file), changed);
        await reloaded;
        eq(await page.locator("#count").textContent(), "7");
        await page.getByRole("button", { name: "Increase", exact: true }).click();
        eq(await page.locator("#doubled").textContent(), "16");
        ok((await (await fetch(origin + "/" + route)).text()).includes('<output id="count">7</output>'), "SSR source cache refreshed");
      } finally {
        await page.close();
        dev.close();
        writeFileSync(join(app, file), original);
      }
    }
  });

  await test("page server-renders and hydrates with NO console warnings", async () => {
    const page = await browser.newPage();
    const warnings = [];
    page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") warnings.push(m.text()); });
    page.on("pageerror", (e) => warnings.push("pageerror: " + e.message));
    const res = await page.goto(base + "/", { waitUntil: "networkidle" });
    eq(res.status(), 200, "home 200");
    ok((await page.content()).includes("It works."), "SSR content present");
    await page.waitForTimeout(300); // let hydration settle
    const hydrationIssues = warnings.filter((w) => /hydrat|mismatch|claim/i.test(w));
    eq(hydrationIssues.length, 0, "no hydration warnings: " + hydrationIssues.join(" | "));
    await page.close();
  });

  await test("reactivity updates the real DOM (counter)", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const btn = page.getByRole("button", { name: "Increase count" });
    const count = page.locator("output.count");
    eq(await count.textContent(), "0", "starts at 0");
    await btn.click();
    await btn.click();
    eq(await count.textContent(), "2", "DOM updated after two clicks");
    await page.getByRole("button", { name: "Decrease count" }).click();
    eq(await count.textContent(), "1", "decrement works");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    eq(await count.textContent(), "0", "reset works");
    await page.close();
  });

  await test("server RPC round-trips from the browser", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.locator(".server-button").click();
    await page.waitForFunction(() => document.querySelector(".terminal p")?.textContent?.includes("hello"), null, { timeout: 5000 });
    ok((await page.locator(".terminal p").textContent()).includes("hello niral"), "RPC reply rendered");
    await page.close();
  });

  await test("two-way binding + keyed list add works", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const before = await page.locator("main ul li").count();
    ok(await page.getByRole("button", { name: "Add item" }).isDisabled(), "empty additions disabled");
    await page.fill("input", "a new item from the browser");
    await page.locator("form button").click();
    await page.waitForFunction((n) => document.querySelectorAll("main ul li").length === n + 1, before, { timeout: 5000 });
    ok((await page.content()).includes("a new item from the browser"), "new list item rendered");
    await page.close();
  });

  await test("client-side navigation to the static page works", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /The static page/i }).click();
    await page.waitForURL("**/about", { timeout: 5000 });
    ok((await page.content()).includes("Zero JavaScript"), "about page rendered after nav");
    await page.close();
  });
  await test("starter and static page fit mobile and desktop with local branding", async () => {
    const page = await browser.newPage();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/", "/about"]) {
        await page.goto(base + route, { waitUntil: "networkidle" });
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow: ${route} at ${width}`);
        ok(await page.locator('img[src="/niral-logo.svg"]').evaluate(image => image.complete && image.naturalWidth > 0), "local logo rendered");
        if (width === 390 || width === 1440) await page.screenshot({ path: join(tmpdir(), `niral-${route === "/" ? "starter" : "static"}-${width}.png`), fullPage: true });
      }
    }
    await page.close();
  });
  await test("default error screens: saffron theme, icons, privacy and responsive layout", async () => {
    const page = await browser.newPage();
    try {
      for (const status of [404, 500]) {
        for (const dev of [false, true]) {
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.setContent(errorPage({ status, dev, path: "/" + "nested/".repeat(40), error: new Error("<script>private diagnostic</script>") }));
            await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
            ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `error ${status} fits ${width}`);
            eq(await page.locator(".eyebrow").evaluate(element => getComputedStyle(element).color), "rgb(242, 181, 68)", "saffron status");
            eq(await page.getByRole("link", { name: "Back to home" }).getAttribute("href"), "/");
            eq(await page.locator("script").count(), 0, "diagnostic cannot inject scripts");
            eq(await page.locator(".source").count(), dev ? 1 : 0, "production stack stays private");
            if (!dev) ok(!(await page.locator("body").textContent()).includes("private diagnostic"), "production message stays private");
            if (dev && (width === 390 || width === 1440)) await page.screenshot({ path: join(tmpdir(), `niral-error-${status}-${width}.png`), fullPage: true });
          }
        }
      }
    } finally {
      await page.close();
    }
  });
  await test("Devtools: local traces, controls, responsive layout and production exclusion", async () => {
    const dev = createDevServer({ root: app, port: 0, watch: false });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      eq(await page.locator("#niral-devtools").count(), 0, "no inspector in production");
      eq((await page.request.get(base + "/")).headers()["x-niral-trace"], undefined, "no production trace IDs");
      for (const path of ["/@niral/devtools", "/@niral/devtools.js", "/@niral/devtools-errors.js"]) {
        eq((await page.request.get(base + path, { headers: { "x-niral-devtools": "1" } })).status(), 404, "production endpoint absent");
      }
      const port = await new Promise(ready => dev.listen(ready));
      await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
      await page.locator(".server-button").click();
      await page.waitForFunction(() => document.querySelector(".terminal p")?.textContent?.includes("hello"));
      const launcher = page.getByRole("button", { name: "Open Niral Devtools" });
      await launcher.click();
      const panel = page.getByRole("region", { name: "Niral Devtools" });
      await page.waitForFunction(() => document.querySelector("#niral-devtools").shadowRoot.querySelectorAll(".row").length >= 2);
      await panel.getByRole("button", { name: "Pause updates" }).click();
      await panel.getByLabel("Trace type").selectOption("route");
      await panel.locator(".row").first().click();
      ok((await panel.getByLabel("Request details").textContent()).includes("routes/index.niral"), "selected route module visible");
      ok(await panel.getByRole("table", { name: "Loader timings" }).isVisible(), "loader timing visible");
      await panel.getByLabel("Filter traces").fill("not-a-route");
      eq(await panel.locator(".row").count(), 0, "search filters");
      await panel.getByLabel("Filter traces").fill("");
      await panel.getByLabel("Trace type").selectOption("rpc");
      eq(await panel.locator(".row").count(), 1, "RPC filter");
      ok((await panel.getByLabel("Request details").textContent()).includes("Function"), "RPC details visible");
      let polls = 0;
      page.on("request", request => { if (request.url().endsWith("/@niral/devtools")) polls++; });
      await page.waitForTimeout(1800);
      eq(polls, 0, "paused inspector does not poll");
      await page.evaluate(() => fetch("/devtools-missing?private-query=secret"));
      await panel.getByLabel("Trace type").selectOption("failed");
      const refreshed = page.waitForResponse(response => response.url().endsWith("/@niral/devtools"));
      await panel.getByRole("button", { name: "Refresh traces" }).click();
      await refreshed;
      await page.waitForFunction(() => document.querySelector("#niral-devtools").shadowRoot.querySelector(".row")?.textContent.includes("404"));
      ok(!(await panel.textContent()).includes("private-query"), "raw URLs omitted");
      await panel.getByLabel("Trace type").selectOption("all");
      await page.waitForFunction(() => [...document.querySelector("#niral-devtools").shadowRoot.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0));
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const bounds = await panel.boundingBox();
        ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900, `panel fits ${width}`);
        ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), `panel content fits ${width}`);
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page fits ${width}`);
        if (width === 390 || width === 1440) await page.screenshot({ path: join(tmpdir(), `niral-devtools-${width}.png`), fullPage: false });
      }
      await panel.getByRole("button", { name: "Clear visible traces" }).click();
      eq(await panel.locator(".row").count(), 0, "clear removes visible history");
      await page.keyboard.press("Escape");
      ok(await panel.isHidden(), "Escape closes inspector");
      ok(await launcher.evaluate(button => button.getRootNode().activeElement === button), "focus restored to launcher");
      const before = polls;
      await page.waitForTimeout(1800);
      eq(polls, before, "closed inspector does not poll");
      await launcher.click();
      await panel.getByRole("button", { name: "Resume updates" }).click();
      await panel.getByRole("button", { name: "Close Devtools" }).click();
      eq(errors.length, 0, "no browser errors: " + errors.join(" | "));
    } finally {
      await page.close();
      dev.close();
    }
  });
  await test("Devtools: browser errors, action correlation, source links and redaction", async () => {
    const source = `<server>
export async function fail(delay) { await new Promise(resolve => setTimeout(resolve, delay)); throw new Error("private-server-secret"); }
export async function* stream() { yield "private-chunk"; throw new Error("private-stream-secret"); }
</server>
<script>
function caught() {
  void fail(0).catch(() => {});
}
function concurrent() {
  void fail(40).catch(() => {});
  void fail(5).catch(() => {});
}
async function streamed() {
  try { for await (const chunk of await stream()) {} } catch {}
}
function browserFailure() {
  queueMicrotask(() => { throw new TypeError("private-browser-secret"); });
}
function rejected() {
  Promise.reject(new RangeError("private-rejection-secret"));
}
function runtimeFailure() {
  throw new Error("private-runtime-secret");
}
</script>
<h1>Error tracing</h1>
<button on:click={caught}>Caught RPC</button>
<button on:click={concurrent}>Concurrent RPCs</button>
<button on:click={streamed}>Stream RPC</button>
<button on:click={browserFailure}>Browser error</button>
<button on:click={rejected}>Rejected promise</button>
<button on:click={runtimeFailure}>Runtime error</button>`;
    writeFileSync(join(app, "routes", "trace-errors.niral"), source);
    const dev = createDevServer({ root: app, port: 0, watch: false });
    const page = await browser.newPage();
    const unexpected = [];
    page.on("pageerror", error => { if (!/^private-(browser|rejection)-secret$/.test(error.message)) unexpected.push(error.message); });
    try {
      const port = await new Promise(ready => dev.listen(ready));
      await page.goto(`http://localhost:${port}/trace-errors?password=private-query`, { waitUntil: "networkidle" });
      for (let index = 0; index < 2; index++) {
        await page.getByRole("button", { name: "Caught RPC", exact: true }).click();
        await page.waitForFunction(count => window.__NIRAL_HMR__.errors.snapshot().some(error => error.kind === "rpc" && error.count === count), index + 1);
      }
      const captured = await page.evaluate(() => window.__NIRAL_HMR__.errors.snapshot());
      eq(captured.length, 1, "repeated caught RPCs grouped");
      eq(captured[0].source.line, source.split("\n").findIndex(line => line.includes("void fail(0)")) + 1, "original client callsite line");
      ok(captured[0].occurrences.every(entry => entry.action?.type === "click" && entry.requestId), "click actions and server IDs captured");
      ok(captured[0].occurrences[0].action.id !== captured[0].occurrences[1].action.id, "actions distinguished");
      await page.getByRole("button", { name: "Open Niral Devtools" }).click();
      const panel = page.getByRole("region", { name: "Niral Devtools" });
      await panel.getByRole("tab", { name: "Errors", exact: true }).click();
      await panel.getByRole("button", { name: "Pause updates" }).click();
      await page.waitForFunction(() => document.querySelector("#niral-devtools").shadowRoot.querySelector(".detail a"));
      const link = panel.getByRole("link");
      ok((await link.getAttribute("href")).endsWith(`/routes/trace-errors.niral:${captured[0].source.line}`), "source link opens exact original line");
      const requestLink = panel.getByRole("button", { name: /Inspect request/ }).first();
      const linkedRequest = await requestLink.textContent();
      await panel.getByRole("tab", { name: "Requests", exact: true }).click();
      await panel.getByRole("button", { name: "Clear visible traces" }).click();
      await panel.getByRole("tab", { name: "Errors", exact: true }).click();
      await requestLink.click();
      eq(await panel.getByRole("tab", { name: "Requests", exact: true }).getAttribute("aria-selected"), "true", "request link selects Requests view");
      ok((await panel.getByLabel("Request details").textContent()).includes("fail"), "linked server failure details");
      ok((await panel.getByLabel("Request details").textContent()).includes(linkedRequest), "explicit error link restores the exact cleared request");
      await panel.getByRole("button", { name: "Close Devtools" }).click();
      await page.getByRole("button", { name: "Concurrent RPCs" }).click();
      await page.waitForFunction(() => window.__NIRAL_HMR__.errors.snapshot().filter(error => error.kind === "rpc").reduce((count, error) => count + error.count, 0) === 4);
      await page.getByRole("button", { name: "Stream RPC" }).click();
      await page.waitForFunction(() => window.__NIRAL_HMR__.errors.snapshot().some(error => error.kind === "rpc-stream"));
      await page.getByRole("button", { name: "Browser error", exact: true }).click();
      await page.getByRole("button", { name: "Browser error", exact: true }).click();
      await page.getByRole("button", { name: "Rejected promise" }).click();
      await page.getByRole("button", { name: "Runtime error", exact: true }).click();
      await page.getByRole("alertdialog").waitFor();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.__NIRAL_HMR__.errors.snapshot().some(error => error.kind === "rejection"));
      await page.route("**/@niral/rpc", route => route.abort("failed"));
      await page.getByRole("button", { name: "Caught RPC", exact: true }).click();
      await page.waitForFunction(() => window.__NIRAL_HMR__.errors.snapshot().some(error => error.kind === "rpc" && error.occurrences.some(entry => !entry.requestId)));
      await page.unroute("**/@niral/rpc");
      const groups = await page.evaluate(() => window.__NIRAL_HMR__.errors.snapshot());
      ok(groups.some(error => error.kind === "error" && error.count === 2), "global browser errors grouped");
      ok(groups.some(error => error.kind === "runtime"), "contained runtime error captured");
      ok(!/private|secret|password/.test(JSON.stringify(groups)), "no error messages, payloads or queries retained");
      const traces = await (await page.request.get(`http://localhost:${port}/@niral/devtools`, { headers: { "x-niral-devtools": "1" } })).json();
      const occurrences = groups.flatMap(error => error.occurrences).filter(entry => entry.requestId);
      eq(occurrences.length, 5, "all HTTP RPC failures retained once");
      eq(new Set(occurrences.map(entry => entry.requestId)).size, 5, "per-call request identity");
      ok(occurrences.every(entry => traces.traces.some(trace => trace.requestId === entry.requestId && trace.failure)), "every RPC joins the actual failed server trace");
      await page.getByRole("button", { name: "Open Niral Devtools" }).click();
      await panel.getByRole("button", { name: "Refresh traces" }).click();
      await panel.getByRole("tab", { name: "Errors", exact: true }).click();
      await panel.getByLabel("Filter errors").fill("TypeError");
      await panel.locator(".row").filter({ hasText: "2x" }).click();
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), `error view fits ${width}`);
        ok(await panel.locator(".toolbar").evaluate(element => element.querySelector("input").getBoundingClientRect().top === element.querySelector(".clear").getBoundingClientRect().top), `error toolbar stays on one row at ${width}`);
        if (width === 390 || width === 1440) await page.screenshot({ path: join(tmpdir(), `niral-devtools-errors-${width}.png`) });
      }
      ok(!/private|secret|password/.test(await panel.textContent()), "rendered inspector is redacted");
      await panel.getByRole("tab", { name: "Errors", exact: true }).focus();
      await page.keyboard.press("ArrowLeft");
      eq(await panel.getByRole("tab", { name: "Requests", exact: true }).getAttribute("aria-selected"), "true", "keyboard tabs");
      await page.keyboard.press("ArrowRight");
      await panel.getByRole("button", { name: "Clear visible traces" }).click();
      eq(await panel.locator(".row").count(), 0, "error clear");
      eq(await page.evaluate(() => window.__NIRAL_HMR__.errors.snapshot().length), 0, "error buffer cleared");
      await page.keyboard.press("Escape");
      ok(await panel.isHidden(), "Escape closes cleared error panel");
      eq(unexpected.length, 0, unexpected.join(" | "));
    } finally {
      await page.close();
      dev.close();
      dev.server.closeAllConnections();
      rmSync(join(app, "routes", "trace-errors.niral"));
    }
  });
  await test("dev diagnostics: escaped text, clipboard, focus, dismissal and responsive layout", async () => {
    const dev = createDevServer({ root: app, port: 0, watch: false });
    const page = await browser.newPage();
    try {
      const port = await new Promise(ready => dev.listen(ready));
      await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      const payload = { code: "E_TEST", message: "Unexpected <script>window.injected = true</script>", filename: "/routes/" + "nested/".repeat(25) + "index.niral", line: 12, frame: "12 | <button>" + " text".repeat(80), hint: "Close the <button> element." };
      const trigger = page.getByRole("button", { name: "Increase count" });
      await trigger.focus();
      await page.evaluate(error => window.__NIRAL_HMR__.error(error), payload);
      const dialog = page.getByRole("alertdialog");
      eq(await dialog.getAttribute("aria-label"), "Niral compile error");
      await page.waitForFunction(() => [...document.querySelector("#niral-error-overlay").shadowRoot.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0));
      eq(await dialog.locator(".code").evaluate(element => getComputedStyle(element).color), "rgb(242, 181, 68)", "saffron compile status");
      eq(await dialog.locator(".message").textContent(), payload.message);
      ok(!(await page.evaluate(() => window.injected)), "diagnostics do not execute");
      ok(!(await dialog.locator(".location").textContent()).includes("undefined"), "missing column omitted");
      await dialog.locator("pre").click();
      eq(await dialog.count(), 1, "source click does not dismiss");
      await dialog.getByRole("button", { name: "Copy details" }).click();
      await page.waitForFunction(() => document.querySelector("#niral-error-overlay").shadowRoot.querySelector(".feedback").textContent === "Details copied");
      ok((await page.evaluate(() => navigator.clipboard.readText())).includes(payload.message), "clipboard contains exact diagnostic");
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        ok(await dialog.evaluate(host => host.scrollWidth <= innerWidth), `overlay fits ${width}`);
        const bounds = await dialog.boundingBox();
        ok(bounds.x === 0 && bounds.y === 0 && bounds.width === width && bounds.height === 900, "overlay covers the viewport");
        if (width !== 320) await page.screenshot({ path: join(tmpdir(), `niral-overlay-${width}.png`), fullPage: false });
      }
      await dialog.getByRole("button", { name: "Dismiss error" }).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      ok(await dialog.locator(".copy").evaluate(button => button.getRootNode().activeElement === button), "Tab wraps to first control");
      await page.keyboard.press("Shift+Tab");
      ok(await dialog.locator("pre").evaluate(frame => frame.getRootNode().activeElement === frame), "Shift+Tab wraps to source");
      await page.keyboard.press("Escape");
      eq(await dialog.count(), 0, "Escape dismisses");
      ok(await trigger.evaluate(button => document.activeElement === button), "focus restored");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("niral:error", { detail: { message: "Runtime failure", stack: "Error: Runtime failure" } })));
      eq(await dialog.getAttribute("aria-label"), "Niral runtime error");
      eq(await dialog.locator("h1").textContent(), "Runtime error");
      await page.waitForFunction(() => [...document.querySelector("#niral-error-overlay").shadowRoot.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0));
      eq(await dialog.locator(".code").evaluate(element => getComputedStyle(element).color), "rgb(242, 181, 68)", "saffron runtime status");
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        ok(await dialog.evaluate(host => host.scrollWidth <= innerWidth), `runtime overlay fits ${width}`);
        if (width !== 320) await page.screenshot({ path: join(tmpdir(), `niral-runtime-${width}.png`), fullPage: false });
      }
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } }));
      await dialog.getByRole("button", { name: "Copy details" }).click();
      await page.waitForFunction(() => document.querySelector("#niral-error-overlay").shadowRoot.querySelector(".feedback").textContent.includes("Clipboard unavailable"));
      await dialog.getByRole("button", { name: "Dismiss error" }).click();
      eq(await dialog.count(), 0, "explicit dismissal");
    } finally {
      await page.close();
      dev.close();
    }
  });
} finally {
  browser?.close();
  server.kill("SIGKILL");
  rmSync(app, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
