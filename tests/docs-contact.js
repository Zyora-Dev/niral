import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { submitContact, sendContact } from "../apps/docs/lib/contact.js";
import { createDevServer } from "../src/dev/server.js";
import { compileClient } from "../src/index.js";
import { renderComponent } from "../src/server/render.js";

const fields = { name: "Contact Test", email: "test@example.invalid", topic: "Feedback", message: "A controlled contact test message.", website: "" };

test("textarea text stays escaped without empty hydration markers in both renderers", async () => {
  const source = '<script>let { value = "" } = $props</script><textarea>{value}</textarea><textarea class:active={true}>{value}{value}</textarea><p>{value}</p>';
  const { code } = compileClient(source, { runtime: new URL("../src/runtime/index.js", import.meta.url).href });
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  for (const value of ["", "<script>alert(1)</script> & text"]) {
    const html = renderComponent(Component, { value });
    assert.equal(html, renderComponent((target, props) => Component(target, props), { value }));
    if (!value) {
      assert.match(html, /<textarea><\/textarea>/);
      assert.match(html, /<p><!--n:t--><\/p>/);
    } else assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; text/);
  }
});

test("contact validates fields, persists messages and handles storage failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "niral-contact-"));
  const filename = join(directory, "contact.db");
  try {
    for (const invalid of [null, {}, { ...fields, email: [fields.email] }, { ...fields, topic: "Unknown" }, { ...fields, name: "x".repeat(101) }, { ...fields, message: "short" }, { ...fields, email: "bad\r\n@example.invalid" }, { ...fields, website: "bot.invalid" }]) {
      assert.ok(submitContact(invalid, filename).error);
    }
    assert.equal(existsSync(filename), false);
    const saved = submitContact(fields, filename);
    assert.equal(saved.success, true);
    assert.match(submitContact({ ...fields, email: fields.email.toUpperCase() }, filename).error, /Please wait/);
    const database = new DatabaseSync(filename);
    try {
      assert.equal(database.prepare("SELECT message FROM contact_messages WHERE id = ?").get(saved.reference).message, fields.message);
      database.prepare("UPDATE contact_messages SET created_at = ?").run(Date.now() - 120000);
      for (let attempt = 1; attempt < 5; attempt++) {
        assert.equal(submitContact(fields, filename).success, true);
        database.prepare("UPDATE contact_messages SET created_at = ?").run(Date.now() - 120000);
      }
      assert.match(submitContact(fields, filename).error, /Please wait/);
      assert.equal(database.prepare("SELECT COUNT(*) AS total FROM contact_messages").get().total, 5);
    } finally { database.close(); }
    const failed = submitContact(fields, directory);
    assert.match(failed.error, /could not be saved/);
    assert.equal(failed.values.message, fields.message);
    assert.equal(failed.success, undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Cloudflare sends contact notifications and preserves saved messages on delivery failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "niral-contact-email-"));
  const filename = join(directory, "contact.db");
  const env = { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_EMAIL_API_TOKEN: "test-only-token", CLOUDFLARE_EMAIL_FROM: "contact@niral.site" };
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/email/sending/send");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.from, { address: "contact@niral.site", name: "Niral.js" });
    assert.equal(body.to, "developer@niral.site");
    assert.equal(body.reply_to, fields.email);
    assert.equal(body.subject, "Niral contact: Feedback");
    assert.ok(body.text.includes(fields.message));
    assert.ok(body.text.includes(fields.name));
    return Response.json({ success: true, result: { delivered: [body.to], queued: [], permanent_bounces: [] } });
  };
  try {
    assert.ok((await sendContact({}, filename, { env, request })).errors);
    assert.equal(calls, 0);
    assert.equal(existsSync(filename), false);
    assert.equal((await sendContact(fields, filename, { env, request })).success, true);
    assert.equal(calls, 1);
    assert.match((await sendContact(fields, filename, { env, request })).error, /Please wait/);
    assert.equal(calls, 1);
    const queued = await sendContact({ ...fields, email: "queued@example.invalid" }, filename, { env, request: async () => Response.json({ success: true, result: { queued: ["developer@niral.site"] } }) });
    assert.equal(queued.success, true);
    const failures = [
      async () => Response.json({ success: false, errors: [{ message: env.CLOUDFLARE_EMAIL_API_TOKEN }] }, { status: 401 }),
      async () => Response.json({ success: false, result: null }),
      async () => Response.json({ success: true, result: { permanent_bounces: ["developer@niral.site"] } }),
      async () => Response.json({ success: true, result: {} }),
      async () => Response.json(null),
      async () => new Response("not JSON"),
      async () => { throw new Error("network failed"); },
      async () => { throw new DOMException("timed out", "TimeoutError"); }
    ];
    for (const [index, failedRequest] of failures.entries()) {
      const failed = await sendContact({ ...fields, email: `failure${index}@example.invalid` }, filename, { env, request: failedRequest });
      assert.match(failed.error, /saved, but the email notification could not be sent/);
      assert.equal(failed.success, undefined);
      assert.ok(!JSON.stringify(failed).includes(env.CLOUDFLARE_EMAIL_API_TOKEN));
      const database = new DatabaseSync(filename);
      try { assert.equal(database.prepare("SELECT message FROM contact_messages WHERE id = ?").get(failed.reference).message, fields.message); }
      finally { database.close(); }
    }
    const missing = await sendContact({ ...fields, email: "missing@example.invalid" }, filename, { env: {}, request: async () => { assert.fail("Unconfigured email must not call Cloudflare"); } });
    assert.match(missing.error, /email notification could not be sent/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

export async function startContactTestApp() {
  const directory = mkdtempSync(join(tmpdir(), "niral-contact-app-"));
  const previousRoot = globalThis.__niralProjectRoot;
  const previousFetch = globalThis.fetch;
  const environment = { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_EMAIL_API_TOKEN: "test-only-token", CLOUDFLARE_EMAIL_FROM: "developer@niral.site" };
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const emailRequests = [];
  Object.assign(process.env, environment);
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.cloudflare.com/")) {
      const body = JSON.parse(options.body);
      emailRequests.push(body);
      return Response.json({ success: true, result: { delivered: [body.to], queued: [], permanent_bounces: [] } });
    }
    return previousFetch(url, options);
  };
  const restore = () => {
    globalThis.__niralProjectRoot = previousRoot;
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  };
  let app;
  try {
    mkdirSync(join(directory, "routes"));
    mkdirSync(join(directory, "lib"));
    mkdirSync(join(directory, "components"));
    for (const component of ["SiteHeader", "SiteFooter", "Seo"]) copyFileSync(new URL(`../apps/docs/components/${component}.niral`, import.meta.url), join(directory, "components", `${component}.niral`));
    copyFileSync(new URL("../apps/docs/routes/contact.niral", import.meta.url), join(directory, "routes", "contact.niral"));
    copyFileSync(new URL("../apps/docs/lib/contact.js", import.meta.url), join(directory, "lib", "contact.js"));
    app = createDevServer({ root: directory, port: 0, watch: false });
    const port = await new Promise(accept => app.listen(accept));
    return { base: `http://localhost:${port}`, directory, emailRequests, close() { app.close(); restore(); } };
  } catch (error) {
    app?.close();
    restore();
    throw error;
  }
}

test("contact actions support enhanced and native submissions without exposing storage", async () => {
  const app = await startContactTestApp();
  try {
    const initial = await (await fetch(app.base + "/contact")).text();
    assert.match(initial, /<textarea[^>]*><\/textarea>/);
    assert.ok(!initial.includes("test-only-token"));
    const rejected = await fetch(app.base + "/contact?/send", { method: "POST", body: new URLSearchParams({ ...fields, name: "", message: "<script>test</script> & details" }) });
    const rejectedHtml = await rejected.text();
    assert.match(rejectedHtml, /Please check the highlighted fields/);
    assert.match(rejectedHtml, /&lt;script&gt;test&lt;\/script&gt; &amp; details<\/textarea>/);
    assert.equal(existsSync(join(app.directory, "data", "contact.db")), false);
    const crossOrigin = await fetch(app.base + "/contact?/send", { method: "POST", headers: { origin: "https://different.invalid" }, body: new URLSearchParams(fields) });
    assert.equal(crossOrigin.status, 403);
    const enhanced = await fetch(app.base + "/contact?/send", { method: "POST", headers: { "x-niral-form": "1", "x-niral-result": "1" }, body: new URLSearchParams(fields) });
    assert.equal((await enhanced.json()).result.success, true);
    const native = await fetch(app.base + "/contact?/send", { method: "POST", body: new URLSearchParams({ ...fields, email: "native@example.invalid" }) });
    assert.match(await native.text(), /Message received\./);
    assert.equal(app.emailRequests.length, 2);
    const database = new DatabaseSync(join(app.directory, "data", "contact.db"));
    try { assert.equal(database.prepare("SELECT COUNT(*) AS total FROM contact_messages").get().total, 2); }
    finally { database.close(); }
    assert.equal((await fetch(app.base + "/data/contact.db")).status, 404);
  } finally { app.close(); }
});

test("contact browser form retains errors and confirms real writes with and without JavaScript", { skip: !process.env.NIRAL_CONTACT_BROWSER }, async () => {
  const { chromium } = await import("./browser/node_modules/playwright/index.mjs");
  const app = await startContactTestApp();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.text().includes("hydration mismatch")) errors.push(message.text());
      });
      await page.goto(app.base + "/contact", { waitUntil: "networkidle" });
      assert.equal(await page.locator("textarea").inputValue(), "");
      await page.getByLabel("Your name", { exact: true }).fill(fields.name);
      await page.getByLabel("Email address", { exact: true }).fill(javaScriptEnabled ? "js@example.invalid" : "nojs@example.invalid");
      await page.getByLabel("Topic", { exact: true }).selectOption(fields.topic);
      await page.getByLabel("Your message", { exact: true }).fill("short");
      await page.locator("form").evaluate(form => { form.noValidate = true; });
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByRole("alert").filter({ hasText: "Please check" }).waitFor();
      assert.equal(await page.locator("textarea").inputValue(), "short");
      assert.equal(await page.getByLabel("Topic", { exact: true }).inputValue(), fields.topic);
      assert.equal(await page.getByLabel("Your name", { exact: true }).inputValue(), fields.name);
      await page.getByLabel("Your message", { exact: true }).fill(fields.message);
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByRole("heading", { name: "Message received." }).waitFor();
      await page.getByRole("link", { name: "Send another message" }).click();
      await page.getByRole("heading", { name: "Send a message" }).waitFor();
      assert.equal(await page.locator("textarea").inputValue(), "");
      assert.deepEqual(errors, []);
      await context.close();
    }
    const database = new DatabaseSync(join(app.directory, "data", "contact.db"));
    try { assert.equal(database.prepare("SELECT COUNT(*) AS total FROM contact_messages").get().total, 2); }
    finally { database.close(); }
  } finally { await browser.close(); app.close(); }
});