/**
 * Niral server — security defaults.
 *
 * Every production HTML response ships with a strict Content-Security-Policy
 * built around a PER-REQUEST NONCE: only our own modules ('self') and the
 * inline scripts we stamped with the nonce may run — injected `<script>`
 * from user content is dead on arrival. Plus the boring-but-vital headers
 * (nosniff, frame denial, referrer policy) on every response.
 *
 * Opt out (reverse proxy owns the headers): NIRAL_CSP=off · NIRAL_FRAME=off
 */

import { randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const PRIVATE_SEGMENTS = new Set(["data", "migrations", "tests", "deploy", "dist", "node_modules"]);

export function isPrivatePath(path) {
  return path.split(/[/\\]/).some((part) => {
    const name = part.toLowerCase();
    return name.startsWith(".") || PRIVATE_SEGMENTS.has(name) || /^(hooks|jobs)\.js$|\.env$|\.server\.(js|mjs|ts)$/.test(name);
  });
}

export function isSafeRequestPath(path) {
  return !/[\\:\x00-\x1f\x7f]/.test(path) &&
    !path.split("/").some((part) => part === "." || part === ".." || /[. ]$/.test(part));
}

export function isServableFile(base, target) {
  const root = resolve(base);
  const path = relative(root, resolve(target));
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) return false;
  let current = root;
  try {
    const parts = path.split(sep);
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const entry = lstatSync(current);
      if (entry.isSymbolicLink()) return false;
      if (index === parts.length - 1) return entry.isFile();
      if (!entry.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  return false;
}

export function makeNonce() {
  return randomBytes(16).toString("base64");
}

/** Headers for every response (HTML or not). */
export function baseSecurityHeaders() {
  const h = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  if (process.env.NIRAL_FRAME !== "off") h["x-frame-options"] = "DENY";
  return h;
}

/** Extra headers for RENDERED HTML pages (needs the page's script nonce). */
export function htmlSecurityHeaders(nonce) {
  if (process.env.NIRAL_CSP === "off") return {};
  return {
    "content-security-policy":
      `script-src 'self' 'nonce-${nonce}'; ` +
      `object-src 'none'; base-uri 'self'; ` +
      `style-src 'self' 'unsafe-inline'; ` + // scoped styles are inline <style> tags
      `frame-ancestors 'none'`,
  };
}

/** Hard cap on RPC / form-action argument lists. */
export const MAX_RPC_ARGS = 32;
