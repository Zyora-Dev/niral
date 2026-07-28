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
