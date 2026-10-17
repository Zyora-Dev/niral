import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startFormTestApp } from "../form-actions.js";

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["dev", "prod"]) for (const layout of [true, false]) {
    const app = await startFormTestApp(mode, { layout });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(app.base);
      const input = page.locator('#editor input[name="title"]');
      await input.fill("x");
      await page.waitForFunction(() => document.querySelector("#bound-title").textContent === "x");
      await page.locator('input[type="file"]').setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("browser file bytes") });
      await input.focus();
      await page.evaluate(() => { globalThis.originalInput = document.querySelector('#editor input[name="title"]'); });
      let release;
      let requested;
      const seen = new Promise((accept) => { requested = accept; });
      const gate = new Promise((accept) => { release = accept; });
      let calls = 0;
      await page.route((url) => url.search === "?/save", async (route) => {
        calls++;
        requested();
        await gate;
        await route.continue();
      });
      await page.evaluate(() => {
        const form = document.querySelector("#editor");
        form.requestSubmit(form.querySelector("button"));
        form.requestSubmit(form.querySelector("button"));
      });
      await seen;
      assert.equal(await page.locator("#status").textContent(), "pending");
      assert.equal(await page.locator("#editor button").isDisabled(), true);
      assert.equal(await page.locator("#other-status").textContent(), "idle");
      release();
      await page.waitForFunction(() => document.querySelector("#status").textContent === "error");
      assert.equal(calls, 1);
      assert.match(await page.locator("#field-error").textContent(), /3 characters/);
      assert.equal(await input.inputValue(), "x");
      assert.equal(await page.evaluate(() => document.activeElement === globalThis.originalInput && document.querySelector('#editor input[name="title"]') === globalThis.originalInput), true);
      assert.equal(await page.locator('input[type="file"]').evaluate((element) => element.files[0].name), "note.txt");
      await input.fill("Browser title");
      await page.locator("#editor button").click();
      await page.waitForFunction(() => document.querySelector("#status").textContent === "success");
      assert.equal(await page.locator("#result").textContent(), "Browser title");
      assert.equal(await page.locator("#size").textContent(), "18");
      assert.equal(await page.locator("#intent").textContent(), "save");
      assert.equal(await page.locator("#count").textContent(), "1");
      assert.equal(calls, 2);
      await page.locator("#other button").click();
      await page.waitForFunction(() => document.querySelector("#other-status").textContent === "success");
      await page.waitForFunction(() => document.querySelector("#loads").textContent === "2");
      if (layout) assert.equal(await page.locator("#layout-loads").textContent(), "2");
      assert.equal(await page.locator("#entries li").count(), 2);
      await page.evaluate(() => { globalThis.originalEntry = document.querySelector("#entries li"); });
      assert.equal(await page.locator("#status").textContent(), "success");
      if (layout) await page.locator("#layout-toggle").click();
      await input.focus();
      let refreshRelease;
      let refreshRequested;
      const refreshSeen = new Promise((accept) => { refreshRequested = accept; });
      const refreshGate = new Promise((accept) => { refreshRelease = accept; });
      let refreshCalls = 0;
      const isRefresh = (url) => url.pathname === "/" && !url.search;
      await page.route(isRefresh, async (route) => {
        refreshCalls++;
        assert.equal(route.request().headers()["x-niral-nav"], "1");
        refreshRequested();
        await refreshGate;
        await route.continue();
      });
      await page.evaluate(() => {
        document.body.style.minHeight = "2000px";
        scrollTo(0, 100);
        document.querySelector("#refresh").click();
        document.querySelector("#refresh").click();
      });
      await refreshSeen;
      assert.equal(await page.locator("#refresh-status").textContent(), "pending");
      refreshRelease();
      await page.waitForFunction(() => document.querySelector("#refresh-status").textContent === "success");
      assert.equal(refreshCalls, 1);
      assert.equal(await page.locator("#loads").textContent(), "3");
      if (layout) {
        assert.equal(await page.locator("#layout-loads").textContent(), "3");
        assert.equal(await page.locator("#layout-state").textContent(), "true");
      }
      assert.equal(await page.evaluate(() => document.querySelector("#entries li") === globalThis.originalEntry), true);
      assert.equal(await input.inputValue(), "Browser title");
      assert.equal(await page.evaluate(() => document.activeElement === globalThis.originalInput && document.querySelector('#editor input[name="title"]') === globalThis.originalInput && scrollY === 100), true);
      assert.equal(await page.locator('input[type="file"]').evaluate((element) => element.files[0].name), "note.txt");
      await page.unroute(isRefresh);
      await page.route(isRefresh, (route) => route.fulfill({ status: 500, json: { ok: false, error: "private detail" } }));
      await page.locator("#refresh").click();
      await page.waitForFunction(() => document.querySelector("#refresh-status").textContent === "error");
      assert.match(await page.locator("#refresh-error").textContent(), /could not be refreshed/);
      assert.equal(await page.locator("#loads").textContent(), "3");
      await page.locator("#other button").click();
      await page.waitForFunction(() => document.querySelector("#other-refresh-error").textContent !== "");
      assert.equal(await page.locator("#other-status").textContent(), "success");
      await page.unroute(isRefresh);
      await page.locator("#refresh").click();
      await page.waitForFunction(() => document.querySelector("#refresh-status").textContent === "success");
      assert.equal(await page.locator("#entries li").count(), 3);
      await page.locator("#reset").click();
      assert.equal(await page.locator("#status").textContent(), "idle");
      assert.equal(await input.inputValue(), "Browser title");
      await page.unrouteAll({ behavior: "wait" });
      let releaseLate;
      let lateRequested;
      const lateSeen = new Promise((accept) => { lateRequested = accept; });
      const lateGate = new Promise((accept) => { releaseLate = accept; });
      await page.route((url) => url.search === "?/save", async (route) => {
        lateRequested();
        await lateGate;
        await route.fulfill({ json: { ok: true, result: { saved: "stale" } } });
      });
      await page.locator("#editor button").click();
      await lateSeen;
      await page.locator("#reset").click();
      releaseLate();
      await page.unrouteAll({ behavior: "wait" });
      assert.equal(await page.locator("#status").textContent(), "idle");
      assert.equal(await page.locator("#result").textContent(), "");
      let releaseStaleRefresh;
      let staleRefreshRequested;
      const staleRefreshSeen = new Promise((accept) => { staleRefreshRequested = accept; });
      const staleRefreshGate = new Promise((accept) => { releaseStaleRefresh = accept; });
      await page.route(isRefresh, async (route) => {
        const response = await route.fetch();
        staleRefreshRequested();
        await staleRefreshGate;
        await route.fulfill({ response });
      });
      await page.locator("#refresh").click();
      await staleRefreshSeen;
      await page.locator("#leave button").click();
      await page.waitForURL(app.base + "/done");
      releaseStaleRefresh();
      await page.unrouteAll({ behavior: "wait" });
      assert.equal(await page.locator("#done").textContent(), "Saved");
      assert.equal(await page.locator("#entries").count(), 0);
      assert.deepEqual(errors, []);
      const native = await browser.newContext({ javaScriptEnabled: false });
      try {
        const nativePage = await native.newPage();
        await nativePage.goto(app.base);
        await nativePage.locator('#editor input[name="title"]').fill("Native browser");
        await Promise.all([nativePage.waitForNavigation(), nativePage.locator("#editor button").click()]);
        assert.equal(await nativePage.locator("#result").textContent(), "Native browser");
      } finally { await native.close(); }
      console.log(`PASS ${mode} browser forms (layout=${layout}): refresh, keyed lists, focus/files/scroll, errors, retry, navigation races, forms and no-JS`);
    } finally { await context.close(); app.close(); }
  }
} finally { await browser.close(); }