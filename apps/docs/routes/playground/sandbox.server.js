import { randomBytes } from "node:crypto";
import sandbox from "../../lib/playground-sandbox.json" with { type: "json" };

export function GET() {
  const nonce = randomBytes(18).toString("base64");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>NiralScript execution sandbox</title></head><body><script nonce="${nonce}">${sandbox}</script></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; connect-src 'none'; frame-ancestors 'self'; sandbox allow-scripts`,
      "x-frame-options": "SAMEORIGIN",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()"
    }
  });
}