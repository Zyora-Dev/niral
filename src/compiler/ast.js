/**
 * Niral compiler — AST node shapes.
 *
 * Deliberately plain objects (JSON-serializable) so tooling, tests and
 * future passes (analyzer, codegen) can treat the tree as data.
 *
 * Component
 *   { type:"Component", filename,
 *     server: Block|null, script: Block|null, style: Block|null,
 *     template: Node[] }
 * Block        { type:"Block", kind:"server"|"script"|"style", code, start, end }
 * Element      { type:"Element", tag, attrs: Attr[], children: Node[], selfClosing, start, end }
 * Text         { type:"Text", value, start, end }
 * Mustache     { type:"Mustache", expr: Expr, start, end }
 * IfBlock      { type:"IfBlock", branches: [{ expr: Expr|null, children: Node[] }], start, end }
 *               — first branch is the #if, an `expr: null` branch is the final {:else}
 * ForBlock     { type:"ForBlock", item, index|null, iterable: Expr, children: Node[], start, end }
 * Expr         { raw, start, end }
 * Attr kinds:
 *   { type:"Attr",  name, value: string|true|Expr }        plain attribute
 *   { type:"Bind",  name, expr: Expr }                     bind:value={x}
 *   { type:"On",    event, expr: Expr }                    on:click={fn}
 *   { type:"Use",   name, expr: Expr|null }                use:action={arg}
 */

export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export function component(filename) {
  return { type: "Component", filename, server: null, script: null, style: null, head: null, template: [] };
}

export function block(kind, code, start, end, attrs = {}) {
  return { type: "Block", kind, code, start, end, attrs };
}

export function element(tag, start) {
  return { type: "Element", tag, attrs: [], children: [], selfClosing: false, start, end: start };
}

export function text(value, start, end) {
  return { type: "Text", value, start, end };
}

export function mustache(expr, start, end) {
  return { type: "Mustache", expr, start, end };
}

/** {@html expr} — raw, UNESCAPED html (trusted content only). */
export function rawHtml(expr, start, end) {
  return { type: "RawHtml", expr, start, end };
}

export function ifBlock(start) {
  return { type: "IfBlock", branches: [], start, end: start };
}

export function forBlock(item, index, iterable, start, keyExpr = null) {
  return { type: "ForBlock", item, index, iterable, keyExpr, children: [], start, end: start };
}

export function awaitBlock(expr, start) {
  return {
    type: "AwaitBlock", expr,
    pending: [], thenVar: null, thenChildren: null, catchVar: null, catchChildren: null,
    start, end: start,
  };
}
