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
