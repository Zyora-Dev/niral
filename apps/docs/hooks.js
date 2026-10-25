import { PAGES } from "./lib/content.js";

export const env = [];

const notFound = {
  status: 404,
  headers: { "x-robots-tag": "noindex, follow" },
  body: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page Not Found | Niral Docs</title><meta name="robots" content="noindex, follow">
<link rel="stylesheet" href="/styles/fonts.css"><link rel="icon" href="/niral-logo.svg" type="image/svg+xml">
<style>body{margin:0;background:#090909;color:#fafafa;font:16px/1.7 Geist,sans-serif}main{max-width:640px;margin:80px auto;padding:24px}a{color:#f2b544}h1{font-size:32px}</style>
</head><body><main><a href="/">Niral</a><h1>Documentation page not found</h1>
<p>This guide does not exist. Browse the documentation to find the topic you need.</p>
<a href="/docs/getting-started">Open the Niral documentation</a></main></body></html>`,
};

export function handle(event) {
  if (event.method !== "GET" && event.method !== "HEAD") return;
  if (event.path === "/docs" || event.path === "/docs/") return event.redirect("/docs/getting-started", 308);
  if (!event.path.startsWith("/docs/")) return;
  let slug;
  try { slug = decodeURIComponent(event.path.slice(6)).replace(/\/+$/, ""); }
  catch { return notFound; }
  if (!Object.hasOwn(PAGES, slug)) return notFound;
  const canonicalPath = "/docs/" + slug;
  if (event.path !== canonicalPath) return event.redirect(canonicalPath, 308);
}