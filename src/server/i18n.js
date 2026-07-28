/**
 * Niral server — i18n catalogs + locale negotiation.
 *
 * Project layout:  i18n/<locale>.json  (nested objects flatten to "a.b.c")
 *   i18n/en.json   { "nav": { "home": "Home" }, "greet": "Hello {name}!" }
 *   i18n/ta.json   { "nav": { "home": "முகப்பு" }, "greet": "வணக்கம் {name}!" }
 *
 * Locale resolution per request:
 *   1. `niral_locale` cookie (a language switcher just sets it)
 *   2. Accept-Language header (q-values respected, region tags fall back
 *      to their base language: ta-IN → ta)
 *   3. NIRAL_LOCALE env → "en" if present → first catalog alphabetically
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

const cache = new Map(); // dir → { stamp, data }

/** Load every i18n/*.json (mtime-cached). Returns null when the project has no i18n/. */
export function loadCatalogs(root) {
  const dir = join(root, "i18n");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return null;
  const stamp = files.map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`).join("|");
  const hit = cache.get(dir);
  if (hit && hit.stamp === stamp) return hit.data;

  const catalogs = {};
  for (const f of files) {
    const locale = f.replace(/\.json$/, "").toLowerCase();
    try {
      catalogs[locale] = flatten(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch (e) {
      throw new Error(`i18n/${f}: invalid JSON — ${e.message}`);
    }
  }
  const locales = Object.keys(catalogs);
  const envDefault = (process.env.NIRAL_LOCALE ?? "").toLowerCase();
  const defaultLocale = catalogs[envDefault] ? envDefault : catalogs.en ? "en" : locales[0];
  const data = { locales, catalogs, defaultLocale };
  cache.set(dir, { stamp, data });
  return data;
}

/** Pick the locale for one request. */
export function negotiate(cookieHeader, acceptLanguage, i18n) {
  const m = /(?:^|;\s*)niral_locale=([\w-]+)/.exec(cookieHeader ?? "");
  if (m && i18n.catalogs[m[1].toLowerCase()]) return m[1].toLowerCase();
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())).find(Boolean);
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q[1]) : 1 };
    })
    .filter((r) => r.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (i18n.catalogs[tag]) return tag;
    const base = tag.split("-")[0];
    if (i18n.catalogs[base]) return base;
  }
  return i18n.defaultLocale;
}
