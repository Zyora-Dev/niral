/**
 * Niral compiler — recursive-descent parser for the `.niral` format.
 *
 * Grammar surface (v0.1, deliberately tiny):
 *   component  := (block | node)*
 *   block      := <server>JS</server> | <script>JS</script> | <style>CSS</style>   (top level only)
 *   node       := element | text | mustache | ifblock | forblock | comment
 *   element    := <tag attrs> children </tag>  |  self-closing <tag attrs />  |  void elements
 *   attr       := name | name="text" | name={expr} | bind:x={expr} | on:evt={expr} | use:x[={expr}]
 *   mustache   := { expr }
 *   ifblock    := {#if e} node* ({:else if e} node*)* ({:else} node*)? {/if}
 *   forblock   := {#for item[, index] of e} node* {/for}
 */

import { Scanner, readJsUntilCloseTag, readBalancedExpression } from "./scanner.js";
import * as n from "./ast.js";

const TAG_NAME = /[a-zA-Z][a-zA-Z0-9-]*/y;
const ATTR_NAME = /[^\s=/>{}]+/y;
const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y;

/** Parse a .niral source file into a Component AST. */
export function parse(source, filename = "<anonymous>") {
  const sc = new Scanner(source, filename);
  const comp = n.component(filename);
  comp.template = parseNodes(sc, comp, null);
  // Trim pure-whitespace text nodes at the template edges for a tidy tree.
  comp.template = comp.template.filter(
    (node, i) =>
      !(node.type === "Text" && node.value.trim() === "" && (i === 0 || i === comp.template.length - 1))
  );
  return comp;
}

/**
 * Parse child nodes until EOF or until `stop(sc)` says the caller's
 * terminator is at the cursor (without consuming it).
 * `comp` is non-null only at top level (enables <server>/<script>/<style>).
 */
function parseNodes(sc, comp, stop) {
  const nodes = [];
  while (!sc.eof()) {
    if (stop && stop(sc)) break;

    if (sc.startsWith("<!--")) {
      skipComment(sc);
      continue;
    }

    if (sc.startsWith("</")) break; // caller (parseElement) handles/validates closing tags

    if (sc.peek() === "<" && TAG_NAME.test(peekAt(sc, 1))) {
      const special = comp && peekSpecialBlock(sc);
      if (special) {
        parseSpecialBlock(sc, comp, special);
        continue;
      }
      // top-level <head> — raw HTML injected into the page head (title, meta)
      if (comp && sc.startsWithI("<head") && /[>\s]/.test(sc.peek(5) ?? "")) {
        parseHeadBlock(sc, comp);
        continue;
      }
      nodes.push(parseElement(sc));
      continue;
    }

    if (sc.peek() === "{") {
      if (sc.startsWith("{#if")) {
        nodes.push(parseIfBlock(sc));
        continue;
      }
      if (sc.startsWith("{#for")) {
        nodes.push(parseForBlock(sc));
        continue;
      }
      if (sc.startsWith("{#await")) {
        nodes.push(parseAwaitBlock(sc));
        continue;
      }
      if (sc.startsWith("{@html")) {
        const start = sc.pos;
        sc.eat("{@html");
        sc.skipWs();
        // rewind one char so the balanced reader sees depth from the '{'
        const expr = readBalancedExpression(sc, start);
        if (!expr.raw) sc.error("NIRAL021", "{@html} needs an expression", { start });
        nodes.push(n.rawHtml(expr, start, sc.pos));
        continue;
      }
      if (sc.startsWith("{#")) {
        const start = sc.pos;
        const word = sc.src.slice(start + 2, start + 12).match(/^[a-z]*/)[0];
        sc.error("NIRAL020", `Unknown block '{#${word}}'`, {
          start,
          end: start + 2 + word.length,
          hint: "Niral v0.1 supports {#if} and {#for}.",
        });
      }
      if (sc.startsWith("{:") || sc.startsWith("{/")) break; // caller's terminator
      nodes.push(parseMustache(sc));
      continue;
    }

    nodes.push(parseText(sc));
  }
  return nodes;
}

/* ── text & mustache ── */

function parseText(sc) {
  const start = sc.pos;
  const value = sc.readUntil("<", "{");
  return n.text(value, start, sc.pos);
}

function parseMustache(sc) {
  const start = sc.pos;
  sc.eat("{");
  const expr = readBalancedExpression(sc, start);
  if (expr.raw === "") {
    sc.error("NIRAL021", "Empty expression: '{}'", {
      start,
      end: start + 2,
      hint: "Put a value inside the braces, e.g. {user.name}.",
    });
  }
  return n.mustache(expr, start, sc.pos);
}

/* ── special top-level blocks ── */

function peekSpecialBlock(sc) {
  for (const kind of ["server", "script", "style"]) {
    if (sc.startsWithI(`<${kind}`)) {
      const after = sc.peek(1 + kind.length);
      if (after === ">" || /\s/.test(after ?? "")) return kind;
    }
  }
  return null;
}

/** Top-level <head>…</head>: raw static HTML for the document head. */
function parseHeadBlock(sc, comp) {
  const start = sc.pos;
  sc.eat("<head");
  sc.readUntil(">");
  sc.expect(">", "NIRAL022", "Malformed <head> tag");
  const raw = sc.readUntil("</head");
  if (!sc.eat("</head")) {
    sc.error("NIRAL024", "<head> block is never closed", { start, hint: "Add </head>." });
  }
  sc.skipWs();
  sc.expect(">", "NIRAL022", "Malformed closing </head> tag");
  if (comp.head) {
    sc.error("NIRAL023", "Duplicate <head> block — a component may have only one", { start });
  }
  comp.head = { raw: raw.trim(), start, end: sc.pos };
}

function parseSpecialBlock(sc, comp, kind) {
  const start = sc.pos;
  sc.eat(`<${kind}`);
  // capture tag attributes (e.g. mode="static", lang="ts")
  const rawAttrs = sc.readUntil(">");
  const attrs = {};
  for (const m of rawAttrs.matchAll(/([a-zA-Z][\w-]*)(?:\s*=\s*"([^"]*)")?/g)) {
    attrs[m[1]] = m[2] ?? true;
  }
  sc.expect(">", "NIRAL022", `Malformed <${kind}> tag`);
  const { code, start: cs, end: ce } = readJsUntilCloseTag(sc, kind);
  sc.eat(`</${kind}`);
  sc.skipWs();
  sc.expect(">", "NIRAL022", `Malformed closing </${kind}> tag`);
  if (comp[kind]) {
    sc.error("NIRAL023", `Duplicate <${kind}> block — a component may have only one`, {
      start,
      hint: `Merge this code into the first <${kind}> block.`,
    });
  }
  comp[kind] = n.block(kind, code, cs, ce, attrs);
}

/* ── elements ── */

function parseElement(sc) {
  const start = sc.pos;
  sc.eat("<");
  const tag = sc.read(TAG_NAME);
  if (["server", "script", "style"].includes(tag)) {
    sc.error("NIRAL025", `<${tag}> blocks are only allowed at the top level of a component`, {
      start,
      hint: `Move this <${tag}> block out of the markup, next to your other top-level blocks.`,
    });
  }
  const el = n.element(tag, start);

  // attributes
  for (;;) {
    sc.skipWs();
    if (sc.eof()) sc.error("NIRAL024", `<${tag}> tag is never closed`, { start });
    if (sc.eat("/>")) {
      el.selfClosing = true;
      el.end = sc.pos;
      return el;
    }
    if (sc.eat(">")) break;
    el.attrs.push(parseAttr(sc, tag));
  }

  if (n.VOID_ELEMENTS.has(tag.toLowerCase())) {
    el.end = sc.pos;
    return el;
  }

  el.children = parseNodes(sc, null, null);

  // closing tag
  const closeStart = sc.pos;
  if (!sc.eat("</")) {
    sc.error("NIRAL024", `<${tag}> tag is never closed`, {
      start,
      hint: `Add </${tag}> before the end of the ${describeContext(sc)}.`,
    });
  }
  const closeName = sc.read(TAG_NAME);
  sc.skipWs();
  sc.expect(">", "NIRAL022", `Malformed closing tag for <${tag}>`);
  if (closeName !== tag) {
    sc.error("NIRAL026", `Expected </${tag}> but found </${closeName}>`, {
      start: closeStart,
      end: sc.pos,
      hint: `Tags must close in the order they were opened — check the nesting of <${tag}> and <${closeName}>.`,
    });
  }
  el.end = sc.pos;
  return el;
}

function describeContext(sc) {
  return sc.eof() ? "file" : "enclosing block";
}

function parseAttr(sc, tag) {
  const start = sc.pos;
  const name = sc.read(ATTR_NAME);
  if (!name) sc.error("NIRAL027", `Unexpected character '${sc.peek()}' in <${tag}>`, { start });

  // directives: on:event, bind:prop, use:action
  const colon = name.indexOf(":");
  const directive = colon > 0 ? name.slice(0, colon) : null;
  const arg = colon > 0 ? name.slice(colon + 1) : null;

  let value = true;
  if (sc.eat("=")) {
    if (sc.peek() === "{") {
      const bStart = sc.pos;
      sc.eat("{");
      value = readBalancedExpression(sc, bStart);
    } else if (sc.peek() === '"' || sc.peek() === "'") {
      const quote = sc.peek();
      sc.pos++;
      const vStart = sc.pos;
      const text = sc.readUntil(quote);
      if (sc.eof()) sc.error("NIRAL028", `Attribute '${name}' value is never closed`, { start: vStart });
      sc.pos++; // closing quote
      value = text;
    } else {
      sc.error("NIRAL029", `Attribute '${name}' needs a quoted value or a {expression}`, {
        start: sc.pos,
        hint: `Write ${name}="text" or ${name}={expr}.`,
      });
    }
  }

  if (directive === "on") {
    requireExpr(sc, value, start, `on:${arg} needs a handler: on:${arg}={fn}`);
    return { type: "On", event: arg, expr: value, start, end: sc.pos };
  }
  if (directive === "bind") {
    requireExpr(sc, value, start, `bind:${arg} needs a state target: bind:${arg}={myState}`);
    return { type: "Bind", name: arg, expr: value, start, end: sc.pos };
  }
  if (directive === "use") {
    return { type: "Use", name: arg, expr: typeof value === "object" ? value : null, start, end: sc.pos };
  }
  if (directive === "class") {
    requireExpr(sc, value, start, `class:${arg} needs a condition: class:${arg}={isActive}`);
    return { type: "ClassToggle", name: arg, expr: value, start, end: sc.pos };
  }
  if (directive === "style") {
    requireExpr(sc, value, start, `style:${arg} needs a value: style:${arg}={color}`);
    return { type: "StyleProp", name: arg, expr: value, start, end: sc.pos };
  }
  if (directive === "transition") {
    return { type: "Transition", name: arg, expr: typeof value === "object" ? value : null, start, end: sc.pos };
  }
  if (directive === "animate") {
    return { type: "Animate", name: arg, start, end: sc.pos };
  }
  return { type: "Attr", name, value, start, end: sc.pos };
}

function requireExpr(sc, value, start, hint) {
  if (typeof value !== "object") {
    sc.error("NIRAL030", "This directive needs a {expression} value", { start, hint });
  }
}

/* ── control blocks ── */

function parseIfBlock(sc) {
  const start = sc.pos;
  const blk = n.ifBlock(start);
  sc.eat("{#if");
  sc.skipWs();
  const expr = readBalancedExpression(sc, start);
  blk.branches.push({ expr, children: [] });

  for (;;) {
    const children = parseNodes(sc, null, (s) => s.startsWith("{:else") || s.startsWith("{/if"));
    blk.branches[blk.branches.length - 1].children = children;

    if (sc.startsWith("{:else")) {
      const bStart = sc.pos;
      sc.eat("{:else");
      sc.skipWs();
      if (sc.startsWith("if ") || sc.startsWith("if\t")) {
        sc.eat("if");
        sc.skipWs();
        const e = readBalancedExpression(sc, bStart);
        blk.branches.push({ expr: e, children: [] });
      } else {
        sc.expect("}", "NIRAL022", "Malformed {:else}");
        blk.branches.push({ expr: null, children: [] });
      }
      continue;
    }
    if (sc.eat("{/if}")) {
      blk.end = sc.pos;
      return blk;
    }
    sc.error("NIRAL031", "{#if} block is never closed", {
      start,
      hint: "Add {/if} to close the block.",
    });
  }
}

function parseForBlock(sc) {
  const start = sc.pos;
  sc.eat("{#for");
  sc.skipWs();

  const item = sc.read(IDENT);
  if (!item) {
    sc.error("NIRAL032", "{#for} needs an item name", {
      start,
      hint: "Write {#for item of items} or {#for item, i of items}.",
    });
  }
  let index = null;
  sc.skipWs();
  if (sc.eat(",")) {
    sc.skipWs();
    index = sc.read(IDENT);
    if (!index) sc.error("NIRAL032", "{#for} index needs a name after the comma", { start });
    sc.skipWs();
  }
  if (!sc.eat("of")) {
    sc.error("NIRAL032", "{#for} is missing 'of'", {
      start,
      hint: "Write {#for item of items}.",
    });
  }
  sc.skipWs();
  const iterable = readBalancedExpression(sc, start);

  // optional `key <expr>` clause: {#for t of todos key t.id}
  let keyExpr = null;
  const keyAt = topLevelKeyIndex(iterable.raw);
  if (keyAt !== -1) {
    keyExpr = {
      raw: iterable.raw.slice(keyAt + 4),
      start: iterable.start + keyAt + 4,
      end: iterable.end,
    };
    iterable.raw = iterable.raw.slice(0, keyAt);
    iterable.end = iterable.start + keyAt;
    if (keyExpr.raw.trim() === "") {
      sc.error("NIRAL034", "{#for} 'key' needs an expression", {
        start,
        hint: "Write {#for item of items key item.id}.",
      });
    }
  }

  const blk = n.forBlock(item, index, iterable, start, keyExpr);
  blk.children = parseNodes(sc, null, (s) => s.startsWith("{/for"));
  if (!sc.eat("{/for}")) {
    sc.error("NIRAL033", "{#for} block is never closed", {
      start,
      hint: "Add {/for} to close the loop.",
    });
  }
  blk.end = sc.pos;
  return blk;
}

/* ── comments ── */

/**
 * {#await promise} pending {:then value} … {:catch err} … {/await}
 * Both {:then} and {:catch} are optional; names are optional too.
 */
function parseAwaitBlock(sc) {
  const start = sc.pos;
  sc.eat("{#await");
  sc.skipWs();
  const expr = readBalancedExpression(sc, start);
  const blk = n.awaitBlock(expr, start);

  const stops = (s) => s.startsWith("{:then") || s.startsWith("{:catch") || s.startsWith("{/await");
  blk.pending = parseNodes(sc, null, stops);

  if (sc.startsWith("{:then")) {
    sc.eat("{:then");
    sc.skipWs();
    blk.thenVar = sc.read(IDENT) || null;
    sc.skipWs();
    sc.expect("}", "NIRAL022", "Malformed {:then}");
    blk.thenChildren = parseNodes(sc, null, (s) => s.startsWith("{:catch") || s.startsWith("{/await"));
  }
  if (sc.startsWith("{:catch")) {
    sc.eat("{:catch");
    sc.skipWs();
    blk.catchVar = sc.read(IDENT) || null;
    sc.skipWs();
    sc.expect("}", "NIRAL022", "Malformed {:catch}");
    blk.catchChildren = parseNodes(sc, null, (s) => s.startsWith("{/await"));
  }
  if (!sc.eat("{/await}")) {
    sc.error("NIRAL035", "{#await} block is never closed", {
      start,
      hint: "Add {/await} to close the block.",
    });
  }
  blk.end = sc.pos;
  return blk;
}

/** Index of a top-level ` key ` token in a for-header expression, or -1. */
function topLevelKeyIndex(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === "\\") i++;
        i++;
      }
    } else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (
      depth === 0 &&
      s.startsWith("key", i) &&
      i > 0 && /\s/.test(s[i - 1]) &&
      (i + 3 === s.length || /\s/.test(s[i + 3]))
    ) {
      return i;
    }
  }
  return -1;
}

function skipComment(sc) {
  const start = sc.pos;
  sc.eat("<!--");
  sc.readUntil("-->");
  if (sc.eof()) sc.error("NIRAL034", "HTML comment is never closed", { start });
  sc.eat("-->");
}

function peekAt(sc, n_) {
  // regex .test with lastIndex on the char after '<'
  TAG_NAME.lastIndex = 0;
  return sc.src.slice(sc.pos + n_, sc.pos + n_ + 1);
}
