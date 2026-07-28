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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NIRAL = join(here, "..", "..", "bin", "niral.js");

let pass = 0, fail = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  \u2713 ${name}`); }
  catch (e) { fail++; failures.push({ name, e }); console.error(`  \u2717 ${name}\n    ${e.message}`); }
}
function ok(v, m = "expected truthy") { if (!v) throw new Error(m); }
function eq(a, b, m = "not equal") { if (a !== b) throw new Error(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── boot a real scaffolded niral app in production mode ──
const app = mkdtempSync(join(tmpdir(), "niral-browser-"));
spawnSync("node", [NIRAL, "create", app], { stdio: "ignore" });
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
    const btn = page.locator("button.primary");
    ok((await btn.textContent()).includes("count is 0"), "starts at 0");
    await btn.click();
    await btn.click();
    ok((await btn.textContent()).includes("count is 2"), "DOM updated to 2 after two clicks");
    await page.close();
  });

  await test("server RPC round-trips from the browser", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.locator("main .panel:nth-child(2) button").click();
    await page.waitForFunction(() => document.querySelector(".reply")?.textContent?.includes("hello"), null, { timeout: 5000 });
    ok((await page.locator(".reply").textContent()).includes("hello niral"), "RPC reply rendered");
    await page.close();
  });

  await test("two-way binding + keyed list add works", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const before = await page.locator("main ul li").count();
    await page.fill("input", "a new item from the browser");
    await page.locator("form button").click();
    await page.waitForFunction((n) => document.querySelectorAll("main ul li").length === n + 1, before, { timeout: 5000 });
    ok((await page.content()).includes("a new item from the browser"), "new list item rendered");
    await page.close();
  });

  await test("client-side navigation to the static page works", async () => {
    const page = await browser.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Zero-JS page/i }).click();
    await page.waitForURL("**/about", { timeout: 5000 });
    ok((await page.content()).includes("Zero JavaScript"), "about page rendered after nav");
    await page.close();
  });
} finally {
  browser?.close();
  server.kill("SIGKILL");
  rmSync(app, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
