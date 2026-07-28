/**
 * Niral runtime — i18n.
 *
 * `t("nav.home")` / `t("greet", { name })` — translations from the page's
 * active catalog. The server negotiates the locale per request (cookie
 * `niral_locale` → Accept-Language → default), sets the catalog before SSR,
 * and ships it in the hydration payload so `t()` gives identical output on
 * both sides. Missing keys render the key itself — visible, never a crash.
 */

let cat = {};
let loc = "";

/** @internal server/boot — install the active catalog. */
export function _setI18n(messages, locale) {
  cat = messages ?? {};
  loc = locale ?? "";
}

/** The negotiated locale for this page ("" when the project has no i18n/). */
export function currentLocale() {
  return loc;
}

/** Translate a key with optional {param} interpolation. */
export function t(key, params) {
  let s = cat[key];
  if (s == null) return key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}
