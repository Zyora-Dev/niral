/**
 * Niral server — file-based router.
 *
 *   routes/index.niral        →  /
 *   routes/about.niral        →  /about
 *   routes/blog/index.niral   →  /blog
 *   routes/blog/[slug].niral  →  /blog/:slug     (param → props)
 *   routes/docs/[...path].niral → /docs/a/b/c    (catch-all: path = "a/b/c")
 *
 * Static segments always win over params; catch-alls match LAST. No config files.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Source extensions that compile to components. */
export const SRC_EXT_RE = /\.(niral|jsx|tsx)$/;

/** Scan a routes directory → sorted route table. */
export function scanRoutes(routesDir) {
  return scanFiles(routesDir, SRC_EXT_RE);
}

export function scanEndpoints(routesDir) {
  const endpoints = scanFiles(routesDir, /\.server\.js$/);
  for (const route of endpoints) {
    if (["@niral", "assets"].includes(route.segments[0]?.static)) throw new Error(`Reserved endpoint path: ${route.rel}`);
    const names = new Set();
    for (const [index, segment] of route.segments.entries()) {
      const name = segment.param ?? segment.rest;
      if (segment.rest && index !== route.segments.length - 1) throw new Error(`Endpoint catch-all must be last: ${route.rel}`);
      if (name && names.has(name)) throw new Error(`Duplicate endpoint parameter: ${route.rel}`);
      if (name) names.add(name);
    }
  }
  endpoints.sort((left, right) => {
    for (let index = 0; index < Math.min(left.segments.length, right.segments.length); index++) {
      const rank = (segment) => segment.static !== undefined ? 0 : segment.param ? 1 : 2;
      const difference = rank(left.segments[index]) - rank(right.segments[index]);
      if (difference) return difference;
    }
    return right.segments.length - left.segments.length;
  });
  const patterns = new Map();
  for (const route of [...scanRoutes(routesDir), ...endpoints]) {
    const pattern = route.segments.map((segment) => segment.static ?? (segment.rest ? "*" : ":")).join("/");
    if (patterns.has(pattern)) throw new Error(`Route collision: ${patterns.get(pattern)} and ${route.rel}`);
    patterns.set(pattern, route.rel);
  }
  return endpoints;
}

function scanFiles(routesDir, extension) {
  const routes = [];
  if (!existsSync(routesDir)) return routes;

  walk(routesDir, []);

  function walk(dir, prefix) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith("_") || name.startsWith(".")) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs, [...prefix, name]);
      } else if (extension.test(name)) {
        const base = name.replace(extension, "");
        const segs = base === "index" ? [...prefix] : [...prefix, base];
        routes.push({
          file: abs,
          rel: [...prefix, name].join("/"),
          pattern: "/" + segs.join("/"),
          segments: segs.map((s) => {
            const rest = /^\[\.\.\.([\w-]+)\]$/.exec(s);
            if (rest) return { rest: rest[1] };
            const m = /^\[([\w-]+)\]$/.exec(s);
            return m ? { param: m[1] } : { static: s };
          }),
        });
      }
    }
  }

  // specificity: static > param > catch-all, deeper paths first within a tier
  routes.sort((a, b) => {
    const rank = (r) =>
      r.segments.some((s) => s.rest) ? 2 : r.segments.filter((s) => s.param).length > 0 ? 1 : 0;
    return rank(a) - rank(b) || b.segments.length - a.segments.length;
  });
  return routes;
}

/** Match a pathname against the table → { route, params } | null. */
export function matchRoute(routes, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  outer: for (const route of routes) {
    const hasRest = route.segments.some((s) => s.rest);
    if (!hasRest && route.segments.length !== parts.length) continue;
    if (hasRest && parts.length < route.segments.length - 1) continue;
    const params = {};
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i];
      if (seg.rest) {
        // greedy: everything from here to the end (may be empty)
        params[seg.rest] = parts.slice(i).map(decodeURIComponent).join("/");
        return { route, params };
      }
      if (seg.param) params[seg.param] = decodeURIComponent(parts[i]);
      else if (seg.static !== parts[i]) continue outer;
    }
    return { route, params };
  }
  return null;
}

/**
 * Layouts wrapping a route: every `_layout.niral` from routes/ down to the
 * route's own directory, outermost first.
 *   routes/_layout.niral → routes/blog/_layout.niral → routes/blog/[slug].niral
 */
export function layoutChain(routesDir, routeRel) {
  const chain = [];
  const dirs = routeRel.split("/").slice(0, -1);
  let abs = routesDir;
  let rel = "";
  if (existsSync(join(abs, "_layout.niral"))) chain.push({ abs: join(abs, "_layout.niral"), rel: "_layout.niral" });
  for (const d of dirs) {
    abs = join(abs, d);
    rel += d + "/";
    if (existsSync(join(abs, "_layout.niral"))) chain.push({ abs: join(abs, "_layout.niral"), rel: rel + "_layout.niral" });
  }
  return chain;
}
