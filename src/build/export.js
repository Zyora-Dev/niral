/**
 * Niral build — static export (`niral export`).
 *
 * Prerenders every parameterless route through the REAL production renderer
 * and writes a plain-file site — deployable to any static host (nginx,
 * GitHub Pages, S3, …). Client-mode pages still hydrate and are fully
 * interactive; `load()` runs once AT EXPORT TIME, so its data is baked in.
 *
 *   dist/export/
 *     index.html  about/index.html  …   pretty URLs
 *     404.html                          from routes/_404.niral
 *     assets/**                         runtime + compiled components
 *     <static files>                    copied to the root
 *
 * Skipped: routes with dynamic segments (no param values to render) — listed
 * in the returned `skipped`. RPC / form actions / live channels need a
 * server; exported pages keep working but those calls will fail — routes
 * with <server> blocks are listed in `serverDependent`.
 */

import { writeFileSync, mkdirSync, rmSync, cpSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { build } from "./build.js";
import { createProdServer } from "../server/prod.js";

export async function exportStatic({ root = ".", out } = {}) {
  const dir = resolve(root);
  const built = build({ root: dir });
  const dist = join(dir, "dist");
  const outDir = resolve(out ?? join(dist, "export"));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const releaseDir = realpathSync(join(dist, "current"));
  // static files first, pages after (a page beats a stray static index.html)
  if (existsSync(join(releaseDir, "static"))) cpSync(join(releaseDir, "static"), outDir, { recursive: true });
  // pages reference versioned asset URLs (/assets/<hash>/…) — mirror that layout
  cpSync(join(releaseDir, "assets"), join(outDir, "assets", built.hash), { recursive: true });

  const prod = createProdServer({ dist, port: 0 });
  const port = await new Promise((res) => prod.listen(res));
  const written = [];
  const skipped = [];
  const serverDependent = [];
  try {
    for (const route of prod.manifest.routes) {
      if (/[\[:]/.test(route.pattern)) {
        skipped.push(route.pattern); // dynamic — no param values to prerender
        continue;
      }
      if (route.hasServer) serverDependent.push(route.pattern);
      const res = await fetch(`http://localhost:${port}${route.pattern}`);
      if (!res.ok) throw new Error(`export: ${route.pattern} rendered ${res.status}`);
      const file =
        route.pattern === "/"
          ? join(outDir, "index.html")
          : join(outDir, route.pattern.slice(1), "index.html");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await res.text());
      written.push(route.pattern);
    }
    if (prod.manifest.special?.notFound) {
      // multi-segment probe — single-segment [param] routes can't swallow it
      const res = await fetch(`http://localhost:${port}/__niral/export/404/probe`);
      writeFileSync(join(outDir, "404.html"), await res.text());
    }
  } finally {
    prod.close();
  }
  return { hash: built.hash, outDir, written, skipped, serverDependent };
}
