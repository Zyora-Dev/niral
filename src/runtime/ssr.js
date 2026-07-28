/**
 * Niral runtime — string-mode SSR helpers.
 *
 * The compiler emits a second `__ssr(props)` per component that concatenates
 * HTML strings DIRECTLY — no shim DOM, no effects, no per-node objects. This
 * is what makes server rendering Svelte-class instead of tree-then-serialize.
 *
 * BYTE-IDENTITY CONTRACT: output must match the dom-shim serializer exactly —
 * hydration claims depend on it (region anchors, <!--n:t--> empty-text
 * markers, scope classes, attribute order, input value/checked reflection).
 */

// keep in sync with compiler/ast.js VOID_ELEMENTS (runtime can't import compiler)
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style"]);

// single-pass escapes with a clean-string bail — most text has nothing to escape
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escText = (s) => (/[&<>]/.test(s) ? s.replace(/[&<>]/g, (m) => ESC[m]) : s);
const escAttr = (s) => (/[&<>"]/.test(s) ? s.replace(/[&<>"]/g, (m) => ESC[m]) : s);

/** Element record — mirrors the shim's attribute + input-state semantics. */
export function sEl(tag) {
  return { tag, attrs: new Map(), value: "", checked: false };
}

/** setAttr semantics: false/null remove, true → bare attr, else String. */
export function sAttr(e, name, value) {
  if (value === false || value == null) e.attrs.delete(name);
  else if (value === true) e.attrs.set(name, "");
  else e.attrs.set(name, String(value));
}

/** class:name={on} — merge one class into the class attribute (shim path). */
export function sClass(e, name, on) {
  const cur = (e.attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
  const has = cur.includes(name);
  if (on && !has) e.attrs.set("class", [...cur, name].join(" "));
  else if (!on && has) e.attrs.set("class", cur.filter((c) => c !== name).join(" "));
}

/** style:prop={v} — merge one property into the style attribute (shim path). */
export function sStyle(e, prop, v) {
  const cur = (e.attrs.get("style") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith(prop + ":"));
  if (v != null && v !== "") cur.push(`${prop}: ${v}`);
  if (cur.length) e.attrs.set("style", cur.join("; "));
  else e.attrs.delete("style");
}

/** bind:value initial reflection — checkbox → checked, else value. */
export function sValue(e, v) {
  if ((e.attrs.get("type") ?? "") === "checkbox") e.checked = !!v;
  else e.value = v ?? "";
}

/** One dynamic attribute as a string fragment — setAttr + serializer semantics
 *  in a single call (the compiler's folded fast path). */
export function sA(name, value) {
  if (value === false || value == null) return "";
  if (value === true) return ` ${name}`;
  const s = String(value);
  return s === "" ? ` ${name}` : ` ${name}="${escAttr(s)}"`;
}

/** Open tag — attributes in insertion order + live input reflection. */
export function sOpen(e) {
  let out = `<${e.tag}`;
  for (const [name, value] of e.attrs) {
    out += value === "" ? ` ${name}` : ` ${name}="${escAttr(value)}"`;
  }
  if (e.tag === "input") {
    if (e.value && !e.attrs.has("value")) out += ` value="${escAttr(String(e.value))}"`;
    if (e.checked && !e.attrs.has("checked")) out += " checked";
  }
  return out + ">";
}

/** Close tag — void elements have none. */
export function sClose(e) {
  return VOID.has(e.tag) ? "" : `</${e.tag}>`;
}

/** Dynamic text — empty renders the claimable <!--n:t--> placeholder. */
export function sText(v) {
  const s = v == null ? "" : String(v);
  return s === "" ? "<!--n:t-->" : escText(s);
}

/** Dynamic text inside <script>/<style> — raw, no placeholder (shim RAW_TEXT path). */
export function sRawText(v) {
  return v == null ? "" : String(v);
}

/** {@html} — region-wrapped, intentionally unescaped. */
export function sHtml(v) {
  return `<!--niral:start-->${String(v ?? "")}<!--niral:end-->`;
}

/** Keyed {#for} item/index look like signals so shared expressions (`t.get()`) work. */
export function sSig(v) {
  return { get: () => v };
}

/** <Card/> — region-wrapped child component via ITS string renderer. */
export function sChild(Comp, props, slot) {
  const ssr = Comp.__ssr;
  if (typeof ssr !== "function") {
    throw new Error(`component has no string SSR renderer — recompile it with this version of niral`);
  }
  if (slot) props.children = slot;
  return `<!--niral:start-->${ssr(props)}<!--niral:end-->`;
}

/** {#await} — plain values render {:then} directly; promises render the
 *  NESTED pending region (matches awaitBlock's SSR anchor shape). */
export function sAwait(value, pendingFn, thenFn) {
  if (!value || typeof value.then !== "function") {
    return `<!--niral:start-->${thenFn ? thenFn(value) : ""}<!--niral:end-->`;
  }
  return `<!--niral:start--><!--niral:start-->${pendingFn ? pendingFn() : ""}<!--niral:end--><!--niral:end-->`;
}

export const sEscape = escText;
