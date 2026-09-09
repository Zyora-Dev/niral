/**
 * Niral server — form actions.
 *
 * Progressive enhancement, the old-web way:
 *
 *   <form method="post" action="?/save">
 *     <input name="text" />
 *     <button>Save</button>
 *   </form>
 *
 * POSTing `?/save` on a route calls the exported `save(form)` function in
 * that route's <server> block (any language) with the fields as an object.
 * Without JS the server re-renders the page (the action's return value
 * arrives as the `form` prop) or 303-redirects when the action returns
 * `{ redirect: "/path" }`. With JS the runtime router intercepts the submit
 * and applies the same result in place — no reload either way.
 */

/** application/x-www-form-urlencoded → plain object (repeated keys → array). */
export function parseFormBody(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) {
    if (k in out) {
      if (Array.isArray(out[k])) out[k].push(v);
      else out[k] = [out[k], v];
    } else out[k] = v;
  }
  return out;
}

/** The `?/name` action selector from a URL search string, or null. */
export function actionName(search) {
  if (!search?.startsWith("?/")) return null;
  const name = search.slice(2);
  return /^[A-Za-z_]\w*$/.test(name) ? name : null;
}

/** Did the action ask for a redirect? Returns the target path or null. */
export function actionRedirect(result) {
  return result && typeof result === "object" && typeof result.redirect === "string" ? result.redirect : null;
}

export function allowFormOrigin(req) {
  if (!req.headers.origin) return req.headers["sec-fetch-site"] !== "cross-site";
  try {
    const target = new URL(req.url, process.env.NIRAL_ORIGIN ?? `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`);
    return new URL(req.headers.origin).host === target.host;
  } catch { return false; }
}

export function sendFormResult(req, res, out, { development = false } = {}) {
  if (req.headers["x-niral-form"] !== "1" || req.headers["x-niral-result"] !== "1") return false;
  const result = out.body.result;
  const rejected = out.body.ok && result && typeof result === "object" && (result.error || result.errors);
  const status = rejected ? 400 : out.status;
  const body = out.status >= 500 && !development ? { ok: false, error: "Internal server error" } : rejected
    ? { ok: false, error: result.error ?? "Validation failed", errors: result.errors }
    : out.body.ok ? { ok: true, result, redirect: actionRedirect(result) } : out.body;
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (out.setCookie) headers["set-cookie"] = out.setCookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
  return true;
}
