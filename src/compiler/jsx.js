/**
 * Niral compiler — JSX surface syntax.
 *
 * `.jsx` / `.tsx` files are a SECOND WAY to write Niral components: the
 * familiar React shape, compiled to the SAME AST → same codegen → OUR
 * signals runtime. No React, no hooks, no virtual DOM — runes work as-is.
 *
 *   import Card from "../components/Card.niral"
 *
 *   export default function Home({ slug }) {
 *     let count = $state(0)
 *     return (
 *       <div class="app">
 *         <h1>Hello {count}</h1>
 *         <button onClick={() => count++}>+1</button>
 *         {count > 5 ? <p>big</p> : <p>small</p>}
 *         {count > 0 && <p>started</p>}
 *         {items.map((t) => <li key={t.id}>{t.text}</li>)}
 *         <Card title={count}>slot content</Card>
 *       </div>
 *     )
 *   }
 *
 * Translations: onClick → on:click · className → class · ternary/&& → {#if}
 * · .map(…) → {#for} (key={} → keyed) · fragments <>…</> supported.
 */

import { Scanner } from "./scanner.js";
import { NiralError } from "./errors.js";
import * as n from "./ast.js";

const TAG = /[A-Za-z][\w.-]*/y;
const ATTR = /[A-Za-z_][\w-]*(?::[A-Za-z_][\w-]*)?/y;

export function parseJsx(source, filename = "<anonymous>.jsx") {
  const comp = n.component(filename);

  const m = source.match(/export\s+default\s+function\s+([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)\s*\{/);
  if (!m) {
    throw new NiralError("NIRAL050", "A .jsx component needs `export default function Name(props) { … }`", {
      source,
      filename,
      start: 0,
      hint: "export default function App() { return <div>…</div> }",
    });
  }

  const header = source.slice(0, m.index);
  const bodyStart = m.index + m[0].length;
  const bodyEnd = matchBrace(source, bodyStart - 1);
  const body = source.slice(bodyStart, bodyEnd);

  const retAt = topLevelReturn(body);
  if (retAt === -1) {
    throw new NiralError("NIRAL051", "The component function must `return` JSX", {
      source,
      filename,
      start: m.index,
      hint: "End the function with: return <div>…</div>",
    });
  }

  // script = module header (imports get hoisted by codegen) + pre-return body
  let script = (header.trim() ? header.trim() + "\n" : "") + body.slice(0, retAt).trim();
  const params = m[2].trim();
  if (params) {
    if (!params.startsWith("{")) {
      throw new NiralError("NIRAL052", "Destructure your props: function App({ title }) { … }", {
        source,
        filename,
        start: m.index,
        hint: `Write function ${m[1] ?? "App"}({ ${params} }) instead of (${params}).`,
      });
    }
    script = `let ${params} = $props\n` + script;
  }
  comp.script = { type: "Block", kind: "script", code: script, attrs: {}, start: 0, end: 0 };

  // the returned JSX
  let ret = body.slice(retAt + "return".length).trim();
  if (ret.endsWith(";")) ret = ret.slice(0, -1).trim();
  if (ret.startsWith("(") && ret.endsWith(")")) ret = ret.slice(1, -1).trim();

  comp.template = parseChildren(new Scanner(ret, filename), null).flatMap(flattenFragment);
  return comp;
}

/* ── JSX tree ── */

function parseChildren(sc, closeTag) {
  const nodes = [];
  for (;;) {
    if (sc.eof()) {
      if (closeTag == null) return nodes;
      sc.error("NIRAL053", `<${closeTag}> is never closed`, { hint: `Add </${closeTag}>.` });
    }
    if (sc.startsWith("</")) return nodes; // caller validates

    if (sc.startsWith("{/*")) {
      // JSX comment {/* … */}
      sc.readUntil("*/}");
      sc.eat("*/}");
      continue;
    }

    if (sc.peek() === "{") {
      const open = sc.pos;
      sc.pos++;
      const expr = readJsxExpr(sc, open);
      const node = classifyExpr(expr, sc.filename);
      if (node) nodes.push(node);
      continue;
    }

    if (sc.peek() === "<") {
      nodes.push(parseElement(sc));
      continue;
    }

    // text run
    const start = sc.pos;
    const text = sc.readUntil("<", "{");
    nodes.push(n.text(text, start, sc.pos));
  }
}

function parseElement(sc) {
  const start = sc.pos;
  sc.eat("<");

  // fragment <>…</>
  if (sc.eat(">")) {
    const kids = parseChildren(sc, "");
    sc.expect("</>", "NIRAL053", "Fragment <> is never closed", "Close it with </>.");
    // fragments flatten — represent as a transparent element? just return kids via a wrapper marker
    return { type: "Fragment", children: kids, start, end: sc.pos };
  }

  const tag = sc.read(TAG);
  if (!tag) sc.error("NIRAL054", "Expected a tag name after '<'");
  const el = n.element(tag, start);

  for (;;) {
    sc.skipWs();
    if (sc.eof()) sc.error("NIRAL053", `<${tag}> is never closed`, { start });
    if (sc.eat("/>")) {
      el.selfClosing = true;
      el.end = sc.pos;
      return el;
    }
    if (sc.eat(">")) break;
    parseAttr(sc, el);
  }

  el.children = parseChildren(sc, tag).flatMap(flattenFragment);
  sc.expect("</", "NIRAL053", `<${tag}> is never closed`, `Add </${tag}>.`);
  const closeName = sc.read(TAG);
  sc.skipWs();
  sc.expect(">", "NIRAL053", `Malformed closing tag for <${tag}>`);
  if (closeName !== tag) {
    sc.error("NIRAL055", `Expected </${tag}> but found </${closeName}>`, {
      start,
      hint: "JSX tags must close in the order they were opened.",
    });
  }
  el.end = sc.pos;
  return el;
}

function parseAttr(sc, el) {
  const start = sc.pos;
  let name = sc.read(ATTR);
  if (!name) sc.error("NIRAL054", `Unexpected character in <${el.tag}>: '${sc.peek()}'`);

  let value = true;
  sc.skipWs();
  if (sc.eat("=")) {
    sc.skipWs();
    if (sc.peek() === "{") {
      const open = sc.pos;
      sc.pos++;
      value = readJsxExpr(sc, open);
    } else if (sc.peek() === '"' || sc.peek() === "'") {
      const q = sc.peek();
      sc.pos++;
      value = sc.readUntil(q);
      sc.pos++;
    } else {
      sc.error("NIRAL054", `Attribute '${name}' needs a quoted value or {expression}`);
    }
  }

  // JSX conventions → Niral AST
  if (name === "className") name = "class";
  if (name === "htmlFor") name = "for";
  if (name === "key") {
    el.jsxKey = typeof value === "object" ? value : null;
    return;
  }
  // Niral directives work in JSX too: bind:value={x} · on:click={h}
  if (name.startsWith("bind:")) {
    if (typeof value !== "object") sc.error("NIRAL054", `${name} needs a {expression}`);
    el.attrs.push({ type: "Bind", name: name.slice(5), expr: value, start, end: sc.pos });
    return;
  }
  if (name.startsWith("on:")) {
    if (typeof value !== "object") sc.error("NIRAL054", `${name} needs a {handler} expression`);
    el.attrs.push({ type: "On", event: name.slice(3), expr: value, start, end: sc.pos });
    return;
  }
  if (/^on[A-Z]/.test(name)) {
    if (typeof value !== "object") {
      sc.error("NIRAL054", `${name} needs a {handler} expression`);
    }
    el.attrs.push({ type: "On", event: name.slice(2).toLowerCase(), expr: value, start, end: sc.pos });
    return;
  }
  el.attrs.push({ type: "Attr", name, value, start, end: sc.pos });
}

function flattenFragment(node) {
  return node?.type === "Fragment" ? node.children.flatMap(flattenFragment) : [node];
}

/* ── JSX-aware balanced expression reader ──
   Like the scanner's readBalancedExpression, but the expression may CONTAIN
   JSX text — so an apostrophe in `<p>that's it</p>` must not start a JS
   string. A quote only counts as a string when it isn't a contraction
   (letter'letter) and actually terminates on the same line. */

function jsxStringStarts(src, i) {
  const q = src[i];
  if (q === "`") return true; // template literals span lines — always real
  const prev = src[i - 1] ?? "";
  const next = src[i + 1] ?? "";
  if (q === "'" && /[\w$]/.test(prev) && /[A-Za-z]/.test(next)) return false; // that's / it's
  const nl = src.indexOf("\n", i + 1);
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === "\\") j++;
    if (src[j] === "\n") return false; // unterminated on this line → JSX text
    j++;
  }
  if (j >= src.length) return false;
  return nl === -1 || j < nl;
}

function readJsxExpr(sc, openBracePos) {
  const start = sc.pos;
  let depth = 1;
  while (!sc.eof()) {
    const ch = sc.peek();
    if ((ch === '"' || ch === "'" || ch === "`") && jsxStringStarts(sc.src, sc.pos)) {
      const q = ch;
      sc.pos++;
      while (!sc.eof() && sc.peek() !== q) {
        if (sc.peek() === "\\") sc.pos++;
        sc.pos++;
      }
      sc.pos++;
    } else if (ch === "{") {
      depth++;
      sc.pos++;
    } else if (ch === "}") {
      depth--;
      sc.pos++;
      if (depth === 0) return { raw: sc.src.slice(start, sc.pos - 1).trim(), start, end: sc.pos - 1 };
    } else sc.pos++;
  }
  sc.error("NIRAL011", "Expression is missing its closing '}'", {
    start: openBracePos,
    hint: "Every '{' in JSX must have a matching '}'.",
  });
}

/* ── expression children: {expr} → mustache / if / for ── */

function classifyExpr(expr, filename) {
  const raw = expr.raw;
  if (raw.trim() === "") return null;

  // {list.map((item, i) => <jsx/>)}  → ForBlock
  const map = matchMap(raw);
  if (map) {
    const blk = n.forBlock(map.item, map.index, { raw: map.list, start: expr.start, end: expr.end }, expr.start);
    const bodyNodes = parseChildren(new Scanner(map.body, filename), null).flatMap(flattenFragment);
    blk.children = bodyNodes;
    // key={expr} on the root element → keyed reconciliation
    const rootEl = bodyNodes.find((x) => x.type === "Element");
    if (rootEl?.jsxKey) blk.keyExpr = rootEl.jsxKey;
    blk.end = expr.end;
    return blk;
  }

  // {cond ? <a/> : <b/>}  → IfBlock with two branches
  const tern = splitTernary(raw);
  if (tern && (tern.then.trim().startsWith("<") || tern.else.trim().startsWith("<"))) {
    const blk = n.ifBlock(expr.start);
    blk.branches.push({ expr: { raw: tern.cond, start: expr.start, end: expr.end }, children: branchNodes(tern.then, filename, expr) });
    const elseChildren = branchNodes(tern.else, filename, expr);
    if (elseChildren.length) blk.branches.push({ expr: null, children: elseChildren });
    blk.end = expr.end;
    return blk;
  }

  // {cond && <jsx/>}  → IfBlock single branch
  const and = splitLastTopLevel(raw, "&&");
  if (and && and.right.trim().startsWith("<")) {
    const blk = n.ifBlock(expr.start);
    blk.branches.push({ expr: { raw: and.left, start: expr.start, end: expr.end }, children: branchNodes(and.right, filename, expr) });
    blk.end = expr.end;
    return blk;
  }

  return n.mustache(expr, expr.start, expr.end);
}

function branchNodes(part, filename, expr) {
  const t = part.trim();
  if (t === "" || t === "null" || t === "undefined" || t === "false") return [];
  if (t.startsWith("<")) return parseChildren(new Scanner(t, filename), null).flatMap(flattenFragment);
  return [n.mustache({ raw: t, start: expr.start, end: expr.end }, expr.start, expr.end)];
}

/** …list.map((item, i) => body) — body may be (<jsx/>) or <jsx/>. */
function matchMap(raw) {
  const at = lastTopLevelIndex(raw, ".map(");
  if (at === -1) return null;
  const list = raw.slice(0, at).trim();
  let rest = raw.slice(at + 5);
  const arrow = rest.match(/^\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*/);
  if (!arrow) return null;
  const paramsRaw = (arrow[1] ?? arrow[2]).trim();
  const [item, index] = paramsRaw.split(",").map((s) => s.trim());
  rest = rest.slice(arrow[0].length).trim();
  if (rest.endsWith(")")) rest = rest.slice(0, -1).trim(); // closes .map(
  if (rest.startsWith("(") && rest.endsWith(")")) rest = rest.slice(1, -1).trim();
  if (!rest.startsWith("<")) return null; // non-JSX map — plain mustache
  return { list, item, index: index || null, body: rest };
}

/* ── top-level scanning helpers (depth + string aware) ── */

function scanTop(s, cb) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'" || c === "`") && jsxStringStarts(s, i)) {
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0) {
      const stop = cb(c, i);
      if (stop !== undefined) return stop;
    }
  }
  return undefined;
}

function lastTopLevelIndex(s, needle) {
  let found = -1;
  scanTop(s, (c, i) => {
    if (s.startsWith(needle, i)) found = i;
  });
  return found;
}

function splitLastTopLevel(s, op) {
  const at = lastTopLevelIndex(s, op);
  if (at === -1) return null;
  return { left: s.slice(0, at).trim(), right: s.slice(at + op.length).trim() };
}

/** cond ? a : b (handles nesting by counting ?/: pairs). */
function splitTernary(s) {
  let q = -1;
  scanTop(s, (c, i) => {
    if (c === "?" && s[i + 1] !== "." && s[i + 1] !== "?" && q === -1) {
      q = i;
      return true;
    }
  });
  if (q === -1) return null;
  let depth = 0;
  let colon = -1;
  scanTop(s.slice(q + 1), (c, i) => {
    if (c === "?" && s[q + 1 + i + 1] !== "." && s[q + 1 + i + 1] !== "?") depth++;
    else if (c === ":") {
      if (depth === 0) {
        colon = q + 1 + i;
        return true;
      }
      depth--;
    }
  });
  if (colon === -1) return null;
  return { cond: s.slice(0, q).trim(), then: s.slice(q + 1, colon).trim(), else: s.slice(colon + 1).trim() };
}

/* ── function body helpers ── */

/** Index of the matching `}` for the `{` at `openAt`. */
function matchBrace(code, openAt) {
  let depth = 0;
  let i = openAt;
  while (i < code.length) {
    const c = code[i];
    if ((c === '"' || c === "'" || c === "`") && jsxStringStarts(code, i)) i = skipStr(code, i);
    else {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
  }
  return code.length;
}

/** Index of a top-level `return` keyword in a function body. */
function topLevelReturn(body) {
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if ((c === '"' || c === "'" || c === "`") && jsxStringStarts(body, i)) {
      i = skipStr(body, i);
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      i = body.indexOf("\n", i);
      if (i === -1) return -1;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && body.startsWith("return", i) && !/[\w$]/.test(body[i - 1] ?? "") && !/[\w$]/.test(body[i + 6] ?? "")) {
      return i;
    }
    i++;
  }
  return -1;
}

function skipStr(code, i) {
  const q = code[i];
  i++;
  while (i < code.length && code[i] !== q) {
    if (code[i] === "\\") i++;
    i++;
  }
  return i + 1;
}
