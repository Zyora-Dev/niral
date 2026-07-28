// Static server for the benchmark pages — identical serving for every framework.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // niral's export is built for root deployment — its /assets live under dist/niral
  if (path.startsWith("/assets/")) path = "/niral" + path;
  let file = join(dist, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}).listen(4600, () => console.log("bench server → http://localhost:4600/{niral,react,svelte}/"));
