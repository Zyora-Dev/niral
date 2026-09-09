import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startFormTestApp } from "../form-actions.js";

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["dev", "prod"]) {
    const app = await startFormTestApp(mode);
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
      assert.equal(await page.locator("#status").textContent(), "success");
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
      await page.locator("#leave button").click();
      await page.waitForURL(app.base + "/done");
      assert.equal(await page.locator("#done").textContent(), "Saved");
      assert.deepEqual(errors, []);
      const native = await browser.newContext({ javaScriptEnabled: false });
      try {
        const nativePage = await native.newPage();
        await nativePage.goto(app.base);
        await nativePage.locator('#editor input[name="title"]').fill("Native browser");
        await Promise.all([nativePage.waitForNavigation(), nativePage.locator("#editor button").click()]);
        assert.equal(await nativePage.locator("#result").textContent(), "Native browser");
      } finally { await native.close(); }
      console.log(`PASS ${mode} browser forms: hydration, focus/files, pending, duplicates, isolation, reset, redirects and no-JS`);
    } finally { await context.close(); app.close(); }
  }
} finally { await browser.close(); }