import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGES, GROUPS } from "../apps/docs/lib/content.js";
import { handle } from "../apps/docs/hooks.js";
import { createDevServer } from "../src/dev/server.js";
import { compileClient } from "../src/compiler/codegen.js";
import { compileNiralScript } from "../niralscript/compile.js";

const source = new URL("../apps/docs/", import.meta.url);
const decode = value => value.replace(/&(amp|quot|#39|lt|gt);/g, (entity, name) => ({ amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" })[name]);

test("every guide has a unique authored title and complete search description", () => {
  assert.deepEqual(new Set(GROUPS.flatMap(group => group.slugs)), new Set(Object.keys(PAGES)));
  for (const field of ["seoTitle", "description"]) assert.equal(new Set(Object.values(PAGES).map(page => page[field])).size, Object.keys(PAGES).length);
  for (const page of Object.values(PAGES)) {
    assert.ok(page.seoTitle.length >= 20 && page.seoTitle.length <= 65);
    assert.ok(page.description.length >= 100 && page.description.length <= 160);
    assert.doesNotMatch(page.description, /`|\.{3}|…|------|\{description\}/);
    assert.match(page.description, /[.!?]$/);
  }
});

test("docs middleware rejects missing and inherited slugs and canonicalizes guide URLs", () => {
  const event = path => ({ path, method: "GET", redirect: (location, status) => ({ location, status }) });
  for (const path of ["/docs/missing", "/docs/__proto__", "/docs/constructor", "/docs/routing/extra", "/docs/%invalid"]) {
    const response = handle(event(path));
    assert.equal(response.status, 404);
    assert.equal(response.headers["x-robots-tag"], "noindex, follow");
    assert.ok(!response.body.includes("application/ld+json"));
  }
  assert.deepEqual(handle(event("/docs")), { location: "/docs/getting-started", status: 308 });
  assert.deepEqual(handle(event("/docs/routing/")), { location: "/docs/routing", status: 308 });
  for (const path of ["/", "/contact", "/di", "/docs/routing", "/styles/fonts.css"]) assert.equal(handle(event(path)), undefined);
  assert.equal(handle({ ...event("/contact"), method: "POST" }), undefined);
});

test("all sitemap pages expose complete SEO in initial HTML", async () => {
  const directory = mkdtempSync(join(tmpdir(), "niral-seo-"));
  const previousRoot = globalThis.__niralProjectRoot;
  const previousFetch = globalThis.fetch;
  let app;
  let browser;
  globalThis.fetch = (url, options) => String(url).startsWith("https://api.github.com/") ? Promise.resolve(new Response("Offline test", { status: 503 })) : previousFetch(url, options);
  try {
    for (const file of ["routes", "components", "lib", "styles", "hooks.js", "robots.txt", "sitemap.xml", "n.png", "niral-logo.svg"]) cpSync(new URL(file, source), join(directory, file), { recursive: true });
    app = createDevServer({ root: directory, port: 0, watch: false });
    const port = await new Promise(accept => app.listen(accept));
    const base = `http://localhost:${port}`;
    const sitemap = await (await fetch(base + "/sitemap.xml")).text();
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.deepEqual(new Set(urls), new Set(["/", "/di", "/contact", "/about", "/niralscript", "/changelog", ...Object.keys(PAGES).map(slug => "/docs/" + slug)].map(path => "https://niral.site" + path)));
    assert.equal(urls.length, new Set(urls).size);
    assert.match(await (await fetch(base + "/robots.txt")).text(), /Sitemap: https:\/\/niral.site\/sitemap.xml/);
    const titles = new Set();
    const descriptions = new Set();
    for (const url of urls) {
      const path = new URL(url).pathname;
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
      const title = head.match(/<title>([^<]+)<\/title>/)?.[1];
      const description = head.match(/<meta name="description" content="([^"]+)"/ )?.[1];
      assert.equal((head.match(/<title>/g) ?? []).length, 1, path);
      assert.equal((head.match(/name="description"/g) ?? []).length, 1, path);
      assert.equal((head.match(/rel="canonical"/g) ?? []).length, 1, path);
      assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, path);
      assert.ok(title && description && !/[{}]/.test(title + description), path);
      assert.ok(!titles.has(title) && !descriptions.has(description), path);
      titles.add(title);
      descriptions.add(description);
      assert.ok(head.includes(`rel="canonical" href="${url}"`), path);
      assert.ok(head.includes(`property="og:url" content="${url}"`), path);
      for (const channel of ["property=\"og", "name=\"twitter"]) {
        assert.ok(head.includes(`${channel}:title" content="${title}"`), path);
        assert.ok(head.includes(`${channel}:description" content="${description}"`), path);
      }
      assert.match(head, /name="robots" content="index, follow, max-image-preview:large"/);
      const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      assert.equal(scripts.length, 1, path);
      const schema = JSON.parse(scripts[0][1]);
      const webpage = schema["@graph"].find(item => item["@id"] === url + "#webpage");
      assert.equal(webpage.name, decode(title), path);
      assert.equal(webpage.description, decode(description), path);
      if (path === "/about") {
        assert.equal(webpage["@type"], "AboutPage");
        assert.match(html, /flagship web framework developed at/);
        assert.match(html, /zHost is ZyoraLabs/);
      }
      if (path === "/niralscript") {
        assert.match(html, /An independent frontend language/);
        assert.match(html, /Experimental language/);
        assert.match(html, /state count: number = 0/);
        assert.match(html, /derive doubled: number = count \* 2/);
        assert.match(html, /do not establish a stable language release/);
        assert.match(html, /Statically named/);
        assert.match(html, /Microseconds per complete function call/);
        assert.match(html, /actions\/runs\/40311729249/);
        assert.match(html, /Hosted results predate the typed-array follow-up/);
        assert.match(html, /aria-current="page"[^>]*>NiralScript/);
      }
      if (path.startsWith("/docs/")) {
        const guide = PAGES[path.slice(6)];
        assert.equal(decode(title), guide.seoTitle);
        assert.equal(decode(description), guide.description);
        assert.ok(schema["@graph"].some(item => item["@type"] === "TechArticle"));
        assert.ok(schema["@graph"].some(item => item["@type"] === "BreadcrumbList"));
      }
    }
    for (const path of ["/docs/does-not-exist", "/docs/__proto__"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
    }
    const redirect = await fetch(base + "/docs/routing/", { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/docs/routing");
    const imageResponse = await fetch(base + "/n.png");
    assert.equal(imageResponse.status, 200);
    const image = Buffer.from(await imageResponse.arrayBuffer());
    assert.equal(image.readUInt32BE(16), image.readUInt32BE(20));
    assert.ok(image.readUInt32BE(16) >= 144);
    if (process.env.NIRAL_SEO_BROWSER) {
      const { chromium } = await import("./browser/node_modules/playwright/index.mjs");
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base + "/docs/routing");
      await page.locator('a[href="/docs/styling"]').first().click();
      await page.waitForURL(base + "/docs/styling");
      await page.waitForFunction(expected => document.title === expected, PAGES.styling.seoTitle);
      assert.equal(await page.locator('head meta[name="description"]').getAttribute("content"), PAGES.styling.description);
      assert.equal(await page.locator('head link[rel="canonical"]').count(), 1);
      assert.equal(await page.locator('head link[rel="canonical"]').getAttribute("href"), "https://niral.site/docs/styling");
      assert.equal(await page.locator('script[type="application/ld+json"]').count(), 1);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: `/tmp/niral-seo-docs-${width}.png`, fullPage: false, animations: "disabled" });
      }
      await page.goto(base + "/niralscript");
      const embeddedExample = await page.getByLabel("NiralScript counter example", { exact: true }).innerText();
      assert.doesNotThrow(() => compileClient(embeddedExample));
      const mutationExample = await page.getByLabel("Typed array mutation example", { exact: true }).innerText();
      assert.throws(() => compileNiralScript(mutationExample), { code: "NRS080" });
      assert.doesNotThrow(() => compileNiralScript(mutationExample.replace('items.push("bad")', "items.push(5)")));
      const standaloneExample = await page.getByLabel("Standalone NiralScript source", { exact: true }).innerText();
      const generated = compileNiralScript(standaloneExample);
      const { createInstance } = await import("data:text/javascript;base64," + Buffer.from(generated.code).toString("base64"));
      assert.equal(createInstance({ initial: 2 }).values.increment(), 6);
      for (const width of [390, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator("h1").innerText(), "NiralScript.");
        await page.screenshot({ path: `/tmp/niral-language-${width}.png`, fullPage: true, animations: "disabled" });
      }
      await page.setViewportSize({ width: 390, height: 900 });
      await page.getByLabel("Navigation menu", { exact: true }).click();
      assert.equal(await page.locator('.mobile-menu a[href="/niralscript"]').isVisible(), true);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser?.close();
    app?.close();
    globalThis.fetch = previousFetch;
    globalThis.__niralProjectRoot = previousRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});