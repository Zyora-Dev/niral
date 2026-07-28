/**
 * Niral compiler — scoped styles.
 *
 * A component's <style> block only affects the elements THAT component
 * renders: the compiler adds a scope class (derived from the style content,
 * so it's identical across dev/SSR/build compiles) to every element the
 * component creates, and rewrites each selector to require it.
 *
 *   .card { … }        →  .card.n-4af2c1 { … }
 *   li:hover { … }     →  li.n-4af2c1:hover { … }
 *   body { … }         →  body { … }            (document-level: left global)
 *   @media (…) { … }   →  recursed
 *   @keyframes … { … } →  untouched
 *
 * Opt out entirely with <style global>.
 */

import { createHash } from "node:crypto";

/** Stable scope class for a style block (content-derived → same everywhere). */
export function styleScopeId(styleCode) {
  return "n-" + createHash("sha256").update(styleCode).digest("hex").slice(0, 6);
}

/** The CSS a component contributes to the page — scoped unless <style global>. */
export function componentCss(ast) {
  if (!ast?.style) return null;
  const css = ast.style.code.trim();
  if (!css) return null;
  if (ast.style.attrs?.global) return css;
  return scopeStyle(css, styleScopeId(ast.style.code));
}

/** The scope class codegen must stamp on elements (null = unscoped). */
export function componentScope(ast) {
  if (!ast?.style || ast.style.attrs?.global) return null;
  if (ast.style.code.trim() === "") return null;
  return styleScopeId(ast.style.code);
}

/* ── the transformer ── */

const KEEP_GLOBAL = /^(body|html|\*|:root)(::?[\w-]+(\([^)]*\))?)*$/;
const RECURSE_AT = /^@(media|supports|container|layer)\b/;

export function scopeStyle(css, scopeId) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    // copy whitespace/comments verbatim
    if (/\s/.test(css[i])) {
      out += css[i++];
      continue;
    }
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    // find the end of the prelude: `{` (rule/at-block) or `;` (at-statement)
    let j = i;
    let inStr = null;
    while (j < css.length) {
      const ch = css[j];
      if (inStr) {
        if (ch === inStr && css[j - 1] !== "\\") inStr = null;
      } else if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === "{" || ch === ";") break;
      j++;
    }
    const prelude = css.slice(i, j);

    if (css[j] === ";" || j >= css.length) {
      out += prelude + (css[j] === ";" ? ";" : "");
      i = j + 1;
      continue;
    }

    // balanced block body
    let depth = 1;
    let k = j + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      k++;
    }
    const body = css.slice(j + 1, k - 1);

    const trimmed = prelude.trim();
    if (trimmed.startsWith("@")) {
      out += RECURSE_AT.test(trimmed)
        ? `${prelude}{${scopeStyle(body, scopeId)}}`
        : `${prelude}{${body}}`; // @keyframes, @font-face, @page — untouched
    } else {
      out += `${scopeSelectorList(trimmed, scopeId)} {${body}}`;
    }
    i = k;
  }
  return out;
}

function scopeSelectorList(list, scopeId) {
  return splitTop(list, ",")
    .map((sel) => scopeSelector(sel.trim(), scopeId))
    .join(", ");
}

function scopeSelector(sel, scopeId) {
  // split into compound segments, keeping combinators
  const parts = splitCompounds(sel);
  return parts
    .map((p) => (p.isCombinator ? p.text : scopeCompound(p.text, scopeId)))
    .join("");
}

function scopeCompound(seg, scopeId) {
  if (KEEP_GLOBAL.test(seg)) return seg;
  // :global(...) — explicit escape hatch: emit the inner selector unscoped
  const g = seg.match(/^:global\((.*)\)$/s);
  if (g) return g[1];
  // insert the scope class before the first top-level pseudo (:hover, ::before)
  const at = topLevelColonIndex(seg);
  return at === -1 ? `${seg}.${scopeId}` : `${seg.slice(0, at)}.${scopeId}${seg.slice(at)}`;
}

/** Index of the first ':' outside brackets/parens/quotes, or -1. */
function topLevelColonIndex(s) {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === inStr && s[i - 1] !== "\\") inStr = null;
    } else if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/** Split on a separator at bracket/quote depth 0. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let inStr = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === inStr && s[i - 1] !== "\\") inStr = null;
    } else if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Break a selector into compound segments and combinator tokens. */
function splitCompounds(sel) {
  const parts = [];
  let depth = 0;
  let inStr = null;
  let cur = "";
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (!inStr && (ch === '"' || ch === "'")) inStr = ch;
    else if (inStr && ch === inStr && sel[i - 1] !== "\\") inStr = null;
    if (!inStr && depth === 0 && /[\s>+~]/.test(ch)) {
      if (cur) parts.push({ text: cur, isCombinator: false });
      cur = ch;
      while (i + 1 < sel.length && /[\s>+~]/.test(sel[i + 1])) cur += sel[++i];
      parts.push({ text: cur, isCombinator: true });
      cur = "";
      continue;
    }
    if (!inStr) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    cur += ch;
  }
  if (cur) parts.push({ text: cur, isCombinator: false });
  return parts;
}
