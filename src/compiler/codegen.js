/**
 * Niral compiler — client code generation.
 *
 * Component AST → a self-contained ES module:
 *
 *   import * as __n from "<runtime>";
 *   export default function Component(__target, __props = {}) {
 *     return __n.mount(__target, () => {
 *       ...user script (rewritten to signals)...
 *       ...template built with fine-grained bindings...
 *       return [rootNodes];
 *     });
 *   }
 *
 * No virtual DOM. Every dynamic part compiles to one effect on one node.
 */

import { parse } from "./parser.js";
import { parseJsx } from "./jsx.js";
import { stripTypes } from "./typescript.js";
import { NiralError } from "./errors.js";
import { collectDeclarations, rewriteScript, rewriteExpr } from "./rewrite.js";
import { componentScope } from "./style.js";
import { VOID_ELEMENTS } from "./ast.js";

/**
 * Exported function names in a <server> block — these become RPC stubs on
 * the client, whatever language the server side is written in.
 *   js:     export [async] function name(...)
 *   python: top-level def name(...)
 *   ruby:   def name(...)  /  def name
 *   go:     top-level func name(...) — methods (func (r T) …) excluded
 */
export function collectServerExports(code, lang = "js") {
  const names = [];
  const re =
    lang === "python"
      ? /^def\s+([A-Za-z_]\w*)\s*\(/gm
      : lang === "ruby"
        ? /^def\s+([a-z_]\w*[?!]?)/gm
        : lang === "go"
          ? /^func\s+([A-Za-z_]\w*)\s*\(/gm
          : // fn, async fn, async fn* (streaming), AND `export const x = withSchema(…)`-style bindings
            /export\s+(?:(?:async\s+)?function\s*\*?\s*|const\s+)([A-Za-z_$][\w$]*)/g;
  for (const m of code.matchAll(re)) {
    if (!m[1].startsWith("_") && m[1] !== "main" && m[1] !== "init") names.push(m[1]);
  }
  return names;
}

/**
 * Split top-level import statements out of a <script> block — they must live
 * at module level, not inside the component function. v0.2: one import per line.
 */
export function hoistImports(code) {
  const imports = [];
  const rest = code.replace(
    /^[ \t]*import\s+(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}\s*|\*\s+as\s+[\w$]+\s*)?(?:from\s+)?["'][^"']+["'][ \t]*;?[ \t]*$/gm,
    (line) => {
      imports.push(line.trim());
      return "";
    }
  );
  return { imports, rest };
}

/**
 * @param {string} source     .niral source text
 * @param {object} options    { filename, runtime, moduleId } — moduleId = RPC route for <server> stubs
 * @returns {{ code: string, ast: object }}
 */
/** Parse any supported component syntax (.niral / .jsx / .tsx) to the shared AST. */
export function parseComponent(source, filename = "<anonymous>") {
  if (/\.tsx$/.test(filename)) return parseJsx(stripTypes(source), filename);
  if (/\.jsx$/.test(filename)) return parseJsx(source, filename);
  return parse(source, filename);
}

export function compileClient(source, options = {}) {
  const filename = options.filename ?? "<anonymous>";
  const runtime = options.runtime ?? "niral/runtime";
  const moduleId = options.moduleId ?? filename;

  // multi-syntax front-ends — same AST, same codegen, same runtime
  const ast = parseComponent(source, filename);

  // <script lang="ts"> — strip types before the reactive rewrite
  if (ast.script && ast.script.attrs?.lang === "ts") {
    ast.script = { ...ast.script, code: stripTypes(ast.script.code) };
  }

  const { signals, props } = ast.script
    ? collectDeclarations(ast.script.code)
    : { signals: new Set(), props: new Set() };
  // props compile to reactive prop() bindings — reads rewrite like signals
  const tracked = new Set([...signals, ...props]);

  const ctx = { signals: tracked, locals: new Set(), counter: 0, lines: [], scope: componentScope(ast) };
  const roots = genNodes(ast.template, ctx);

  const { imports, rest: scriptRest } = ast.script
    ? hoistImports(ast.script.code)
    : { imports: [], rest: "" };
  const scriptCode = scriptRest ? rewriteScript(scriptRest, tracked).trim() : "";

  // secrets can NEVER ship: client code has no business reading process.env
  if (/\bprocess\.env\b/.test(scriptCode)) {
    throw new NiralError("NIRAL044", "process.env in client code — this would ship your secrets to every browser", {
      source,
      filename,
      start: source.indexOf("process.env"),
      end: source.indexOf("process.env") + "process.env".length,
      hint: "Read env in a <server> block (ambient env(\"KEY\")) and pass values via load().",
    });
  }

  // <server> exports → client-side RPC stubs (the server code itself never ships).
  // `load` is special: it runs during SSR only and is never callable from the client.
  const serverLang = ast.server?.attrs?.lang ?? "js";
  const serverFns = ast.server
    ? collectServerExports(ast.server.code, serverLang).filter((f) => f !== "load")
    : [];
  const stubs = serverFns
    .map((f) => `const ${f} = (...__a) => __n.rpc(${JSON.stringify(moduleId)}, ${JSON.stringify(f)}, __a);`)
    .join("\n");

  const body = [];
  // `live("channel", cb)` — real-time channels, available wherever it's used
  if (/\blive\s*\(/.test(scriptCode) && !/\b(?:let|const|var|function)\s+live\b/.test(scriptCode)) {
    body.push("  const live = __n.live;");
  }
  // `t("key")` — i18n translations (script OR template), unless the user owns `t`
  {
    const tplCode = ctx.lines.join("\n");
    if (
      /\bt\s*\(/.test(scriptCode + "\n" + tplCode) &&
      !/\b(?:let|const|var|function)\s+t\b/.test(scriptCode) &&
      !imports.some((l) => /[\s{,]t[\s},]/.test(l)) &&
      !serverFns.includes("t")
    ) {
      body.push("  const t = __n.t;");
    }
  }
  // context — share values with any descendant component, no prop drilling
  for (const fn of ["setContext", "getContext"]) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(scriptCode) && !new RegExp(`\\b(?:let|const|var|function)\\s+${fn}\\b`).test(scriptCode)) {
      body.push(`  const ${fn} = __n.${fn};`);
    }
  }
  if (stubs) body.push(indent(stubs, 2));
  if (scriptCode) body.push(indent(scriptCode, 2));
  const prelude = [...body]; // injections + stubs + script — shared with the SSR renderer
  body.push(ctx.lines.map((l) => "  " + l).join("\n"));
  body.push(`  return [${roots.join(", ")}];`);

  // STRING-MODE SSR: a second renderer that concatenates HTML directly —
  // no shim DOM, no effects. Byte-identical to the serializer (hydration
  // claims depend on it). Wrapped in root() so setContext/effects own a scope.
  const sctx = { signals: tracked, locals: new Set(), counter: 0, lines: [], scope: componentScope(ast), raw: false };
  genNodesS(ast.template, sctx);
  const sBody = [
    ...prelude,
    '  let __h = "";',
    sctx.lines.map((l) => "  " + l).join("\n"),
    "  return __h;",
  ];

  const code = `// compiled by niral v0.1 from ${filename}
import * as __n from ${JSON.stringify(runtime)};
${imports.join("\n")}

function __build(__props = {}) {
${body.filter(Boolean).join("\n")}
}

function __ssr(__props = {}) {
  const __s = globalThis.__niralSSR; // server-installed helpers — never in the client bundle
  if (!__s) throw new Error("__ssr is server-only — render through niral's renderComponent");
  const [__out, __dispose] = __n.root(() => {
${sBody.filter(Boolean).map((l) => "  " + l).join("\n")}
  });
  __dispose();
  return __out;
}

export default function Component(__target, __props = {}) {
  return __n.mount(__target, () => __build(__props));
}
Component.__build = __build;
Component.__ssr = __ssr;
//# sourceURL=niral:${filename}
`;
  return { code, ast };
}

/* ── template walking ── */

function genNodes(nodes, ctx) {
  const vars = [];
  for (let i = 0; i < nodes.length; i++) {
    // COALESCE adjacent text/expression siblings into ONE reactive text node:
    // `{t.id}: {t.text}` becomes a single bindText(`…`) — one DOM node, one
    // effect, and hydration claims the browser's merged text node directly
    // (adjacent SSR text parses as one node — no splitText surgery per row).
    if (nodes[i].type === "Text" || nodes[i].type === "Mustache") {
      let j = i;
      let mustaches = 0;
      const pieces = [];
      while (j < nodes.length && (nodes[j].type === "Text" || nodes[j].type === "Mustache")) {
        if (nodes[j].type === "Mustache") {
          mustaches++;
          pieces.push({ dyn: expr(nodes[j].expr, ctx) });
        } else {
          const value = normalizeText(nodes[j].value);
          if (value !== "") pieces.push({ lit: value });
        }
        j++;
      }
      if (pieces.length >= 2 && mustaches >= 1) {
        const tpl = pieces
          .map((p) => (p.lit != null ? p.lit.replace(/[\\`$]/g, (m) => "\\" + m) : `\${(${p.dyn}) ?? ""}`))
          .join("");
        const v = fresh(ctx, "t");
        ctx.lines.push(`const ${v} = __n.bindText(() => \`${tpl}\`);`);
        vars.push(v);
        i = j - 1;
        continue;
      }
    }
    const v = genNode(nodes[i], ctx);
    if (v) vars.push(v);
  }
  return vars;
}

function genNode(node, ctx) {
  switch (node.type) {
    case "Text": {
      const value = normalizeText(node.value);
      if (value === "") return null;
      const v = fresh(ctx, "t");
      ctx.lines.push(`const ${v} = __n.text(${JSON.stringify(value)});`);
      return v;
    }
    case "Mustache": {
      const v = fresh(ctx, "t");
      ctx.lines.push(`const ${v} = __n.bindText(() => (${expr(node.expr, ctx)}));`);
      return v;
    }
    case "RawHtml": {
      const v = fresh(ctx, "h");
      ctx.lines.push(`const ${v} = __n.rawHtml(() => (${expr(node.expr, ctx)}));`);
      return v;
    }
    case "Element":
      return genElement(node, ctx);
    case "IfBlock":
      return genIf(node, ctx);
    case "ForBlock":
      return genFor(node, ctx);
    case "AwaitBlock":
      return genAwait(node, ctx);
    default:
      return null;
  }
}

function genElement(node, ctx) {
  // <Card .../> — capitalized tags are component instances
  if (/^[A-Z]/.test(node.tag)) return genComponent(node, ctx);

  // <slot/> — render the children passed by the parent component
  if (node.tag === "slot") {
    const v = fresh(ctx, "s");
    ctx.lines.push(`const ${v} = __props.children ? __props.children() : [];`);
    return v;
  }

  const v = fresh(ctx, "e");
  ctx.lines.push(`const ${v} = __n.el(${JSON.stringify(node.tag)});`);

  let hasClass = false;
  for (const attr of node.attrs) {
    switch (attr.type) {
      case "Attr":
        // scoped styles: merge the scope class into whatever class the element has
        if (attr.name === "class" && ctx.scope) {
          hasClass = true;
          if (typeof attr.value === "string") {
            ctx.lines.push(`__n.setAttr(${v}, "class", ${JSON.stringify(`${attr.value} ${ctx.scope}`)});`);
          } else if (attr.value === true) {
            ctx.lines.push(`__n.setAttr(${v}, "class", ${JSON.stringify(ctx.scope)});`);
          } else {
            ctx.lines.push(`__n.bindAttr(${v}, "class", () => ((${expr(attr.value, ctx)}) || "") + " ${ctx.scope}");`);
          }
          break;
        }
        if (attr.value === true) {
          ctx.lines.push(`__n.setAttr(${v}, ${JSON.stringify(attr.name)}, true);`);
        } else if (typeof attr.value === "string") {
          ctx.lines.push(`__n.setAttr(${v}, ${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`);
        } else {
          ctx.lines.push(`__n.bindAttr(${v}, ${JSON.stringify(attr.name)}, () => (${expr(attr.value, ctx)}));`);
        }
        break;
      case "On":
        ctx.lines.push(`__n.on(${v}, ${JSON.stringify(attr.event)}, ${expr(attr.expr, ctx)});`);
        break;
      case "ClassToggle":
        ctx.lines.push(`__n.bindClass(${v}, ${JSON.stringify(attr.name)}, () => (${expr(attr.expr, ctx)}));`);
        break;
      case "StyleProp":
        ctx.lines.push(`__n.bindStyle(${v}, ${JSON.stringify(attr.name)}, () => (${expr(attr.expr, ctx)}));`);
        break;
      case "Transition":
        ctx.lines.push(
          `__n.transition(${v}, ${JSON.stringify(attr.name)}, ${attr.expr ? `() => (${expr(attr.expr, ctx)})` : "null"});`
        );
        break;
      case "Animate":
        ctx.lines.push(`__n.animateFlip(${v});`);
        break;
      case "Bind":
        if (attr.name !== "value") {
          ctx.lines.push(`__n.bindAttr(${v}, ${JSON.stringify(attr.name)}, () => (${expr(attr.expr, ctx)}));`);
        } else {
          const raw = attr.expr.raw.trim();
          if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
            // whole signal — classic two-way
            ctx.lines.push(`__n.bindValue(${v}, ${raw});`);
          } else {
            // a PATH on a signal — works on $state objects AND keyed {#for}
            // items: reads are fine-grained, writes mutate the underlying
            // object in place (source array stays the source of truth) and
            // touch() re-runs the signal's subscribers.
            const root = raw.match(/^([A-Za-z_$][\w$]*)\s*[.[]/)?.[1];
            if (!root || !ctx.signals.has(root)) {
              throw new NiralError("NIRAL042", `bind:value target must be a $state variable or a path on one — got {${raw}}`, {
                source: raw,
                filename: "<template>",
                start: 0,
                hint: "Bind to something writable: bind:value={name} or bind:value={todo.text}.",
              });
            }
            const rewritten = expr(attr.expr, ctx);
            ctx.lines.push(`__n.bindPath(${v}, () => (${rewritten}), (__v) => { (${rewritten}) = __v; ${root}.touch(); });`);
          }
        }
        break;
      case "Use":
        ctx.lines.push(
          attr.expr
            ? `${attr.name}(${v}, (${expr(attr.expr, ctx)}));`
            : `${attr.name}(${v});`
        );
        break;
    }
  }

  if (ctx.scope && !hasClass) {
    ctx.lines.push(`__n.setAttr(${v}, "class", ${JSON.stringify(ctx.scope)});`);
  }

  if (node.children.length > 0) {
    const children = genNodes(node.children, ctx);
    if (children.length > 0) ctx.lines.push(`__n.append(${v}, ${children.join(", ")});`);
  }
  return v;
}

/** <Card title={x}>children</Card> → __n.child(Card, propsFn, slotFn) */
function genComponent(node, ctx) {
  const v = fresh(ctx, "c");
  const props = [];
  for (const attr of node.attrs) {
    if (attr.type === "Attr") {
      if (attr.value === true) props.push(`${JSON.stringify(attr.name)}: true`);
      else if (typeof attr.value === "string") props.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value)}`);
      else props.push(`${JSON.stringify(attr.name)}: (${expr(attr.value, ctx)})`);
    } else if (attr.type === "On") {
      // <Card on:save={fn}> → the child receives an `onSave` handler prop
      const prop = "on" + attr.event.charAt(0).toUpperCase() + attr.event.slice(1);
      props.push(`${JSON.stringify(prop)}: (${expr(attr.expr, ctx)})`);
    }
    // bind:/use: on components — not supported: pass handlers/values as props.
  }
  const slot =
    node.children.length > 0 ? `, ${childBuilder(node.children, ctx, [])}` : "";
  ctx.lines.push(
    `const ${v} = __n.child(${node.tag}, () => ({ ${props.join(", ")} })${slot});`
  );
  return v;
}

function genIf(node, ctx) {
  const v = fresh(ctx, "b");
  const branches = node.branches.map(({ expr: e, children }) => {
    const inner = childBuilder(children, ctx, []);
    const cond = e ? `() => (${expr(e, ctx)})` : "null";
    return `[${cond}, ${inner}]`;
  });
  ctx.lines.push(`const ${v} = __n.ifBlock([${branches.join(", ")}]);`);
  return v;
}

/** {#await p} … {:then v} … {:catch e} … {/await} */
function genAwait(node, ctx) {
  const v = fresh(ctx, "b");
  const pending = childBuilder(node.pending ?? [], ctx, []);
  const thenB = node.thenChildren
    ? childBuilder(node.thenChildren, ctx, [node.thenVar].filter(Boolean), node.thenVar ?? "")
    : "null";
  const catchB = node.catchChildren
    ? childBuilder(node.catchChildren, ctx, [node.catchVar].filter(Boolean), node.catchVar ?? "")
    : "null";
  ctx.lines.push(
    `const ${v} = __n.awaitBlock(() => (${expr(node.expr, ctx)}), ${pending}, ${thenB}, ${catchB});`
  );
  return v;
}

function genFor(node, ctx) {
  const v = fresh(ctx, "b");
  const params = node.index ? `${node.item}, ${node.index}` : node.item;

  if (node.keyExpr) {
    // keyed: entries are reused — item/index become SIGNALS inside the block
    // so content updates fine-grained without rebuilding the entry's DOM.
    const signalLocals = [node.item, node.index].filter(Boolean);
    const inner = childBuilder(node.children, ctx, [], params, signalLocals);
    const keyLocals = new Set([...ctx.locals, ...signalLocals]); // keyFn gets PLAIN values
    const key = rewriteExpr(node.keyExpr.raw, ctx.signals, keyLocals).trim();
    ctx.lines.push(
      `const ${v} = __n.forBlock(() => (${expr(node.iterable, ctx)}), ${inner}, (${params}) => (${key}));`
    );
    return v;
  }

  const inner = childBuilder(node.children, ctx, [node.item, node.index].filter(Boolean), params);
  ctx.lines.push(
    `const ${v} = __n.forBlock(() => (${expr(node.iterable, ctx)}), ${inner});`
  );
  return v;
}

/** Generate a `() => [nodes]` builder for a nested region, with extra locals shadowing signals. */
function childBuilder(children, ctx, extraLocals, params = "", extraSignals = []) {
  const child = {
    signals: extraSignals.length ? new Set([...ctx.signals, ...extraSignals]) : ctx.signals,
    locals: new Set([...ctx.locals, ...extraLocals].filter((n) => !extraSignals.includes(n))),
    counter: ctx.counter,
    lines: [],
    scope: ctx.scope,
  };
  const vars = genNodes(children, child);
  ctx.counter = child.counter;
  const body = child.lines.map((l) => "      " + l).join("\n");
  return `(${params}) => {\n${body}\n      return [${vars.join(", ")}];\n    }`;
}

/* ── STRING-MODE SSR walking ──────────────────────────────────
   A parallel walker that emits `__h += …` statements — direct string
   concatenation instead of DOM construction. Every case mirrors its DOM
   twin's serialized output EXACTLY (anchors, placeholders, attr order,
   scope classes) so hydration claims the markup byte-for-byte. */

const escStatic = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function genNodesS(nodes, ctx) {
  for (let i = 0; i < nodes.length; i++) {
    // same coalescing as the DOM walker — one merged text node per run
    if (nodes[i].type === "Text" || nodes[i].type === "Mustache") {
      let j = i;
      let mustaches = 0;
      const pieces = [];
      while (j < nodes.length && (nodes[j].type === "Text" || nodes[j].type === "Mustache")) {
        if (nodes[j].type === "Mustache") {
          mustaches++;
          pieces.push({ dyn: expr(nodes[j].expr, ctx) });
        } else {
          const value = normalizeText(nodes[j].value);
          if (value !== "") pieces.push({ lit: value });
        }
        j++;
      }
      if (pieces.length >= 2 && mustaches >= 1) {
        const tpl = pieces
          .map((p) => (p.lit != null ? p.lit.replace(/[\\`$]/g, (m) => "\\" + m) : `\${(${p.dyn}) ?? ""}`))
          .join("");
        ctx.lines.push(ctx.raw ? `__h += \`${tpl}\`;` : `__h += __s.sText(\`${tpl}\`);`);
        i = j - 1;
        continue;
      }
    }
    genNodeS(nodes[i], ctx);
  }
}

function genNodeS(node, ctx) {
  switch (node.type) {
    case "Text": {
      const value = normalizeText(node.value);
      if (value === "") return;
      // static text escapes at COMPILE time (raw inside <script>/<style>)
      ctx.lines.push(`__h += ${JSON.stringify(ctx.raw ? value : escStatic(value))};`);
      return;
    }
    case "Mustache":
      ctx.lines.push(
        ctx.raw
          ? `__h += __s.sRawText((${expr(node.expr, ctx)}));`
          : `__h += __s.sText((${expr(node.expr, ctx)}));`
      );
      return;
    case "RawHtml":
      ctx.lines.push(`__h += __s.sHtml((${expr(node.expr, ctx)}));`);
      return;
    case "Element":
      return genElementS(node, ctx);
    case "IfBlock":
      return genIfS(node, ctx);
    case "ForBlock":
      return genForS(node, ctx);
    case "AwaitBlock":
      return genAwaitS(node, ctx);
    default:
      return;
  }
}

function genElementS(node, ctx) {
  if (/^[A-Z]/.test(node.tag)) return genComponentS(node, ctx);

  if (node.tag === "slot") {
    ctx.lines.push(`__h += __props.children ? __props.children() : "";`);
    return;
  }

  // ── fast paths ──────────────────────────────────────────────
  // Merge/reflection semantics (class:/style:/bind:) need the element
  // record; everything else compiles to direct string concatenation —
  // fully-static open tags FOLD AT COMPILE TIME.
  const needsRecord = node.attrs.some((a) => a.type === "ClassToggle" || a.type === "StyleProp" || a.type === "Bind");
  const attrNames = node.attrs.filter((a) => a.type === "Attr").map((a) => a.name);
  const hasDupes = new Set(attrNames).size !== attrNames.length;

  if (!needsRecord && !hasDupes) {
    const parts = [`"<${node.tag}"`]; // compile-time string pieces + runtime sA() calls, in source order
    let hasClass = false;
    let allStatic = true;
    const escA = (s) => escStatic(s).replace(/"/g, "&quot;");
    const staticAttr = (name, value) => (value === "" ? ` ${name}` : ` ${name}="${escA(value)}"`);
    for (const attr of node.attrs) {
      if (attr.type !== "Attr") continue; // On/Use/Transition/Animate — client-only
      if (attr.name === "class" && ctx.scope) {
        hasClass = true;
        if (typeof attr.value === "string") parts.push(JSON.stringify(staticAttr("class", `${attr.value} ${ctx.scope}`)));
        else if (attr.value === true) parts.push(JSON.stringify(staticAttr("class", ctx.scope)));
        else {
          allStatic = false;
          parts.push(`__s.sA("class", ((${expr(attr.value, ctx)}) || "") + " ${ctx.scope}")`);
        }
        continue;
      }
      if (attr.value === true) parts.push(JSON.stringify(` ${attr.name}`));
      else if (typeof attr.value === "string") parts.push(JSON.stringify(staticAttr(attr.name, attr.value)));
      else {
        allStatic = false;
        parts.push(`__s.sA(${JSON.stringify(attr.name)}, (${expr(attr.value, ctx)}))`);
      }
    }
    if (ctx.scope && !hasClass) parts.push(JSON.stringify(staticAttr("class", ctx.scope)));
    parts.push(`">"`);
    // fully static → ONE folded literal; else minimal concat
    if (allStatic) {
      const folded = parts.map((p) => JSON.parse(p)).join("");
      ctx.lines.push(`__h += ${JSON.stringify(folded)};`);
    } else {
      ctx.lines.push(`__h += ${parts.join(" + ")};`);
    }
    if (node.children.length > 0 && !VOID_ELEMENTS.has(node.tag)) {
      const prevRaw = ctx.raw;
      ctx.raw = node.tag === "script" || node.tag === "style";
      genNodesS(node.children, ctx);
      ctx.raw = prevRaw;
    }
    if (!VOID_ELEMENTS.has(node.tag)) ctx.lines.push(`__h += "</${node.tag}>";`);
    return;
  }

  const v = fresh(ctx, "se");
  ctx.lines.push(`const ${v} = __s.sEl(${JSON.stringify(node.tag)});`);

  let hasClass = false;
  for (const attr of node.attrs) {
    switch (attr.type) {
      case "Attr":
        if (attr.name === "class" && ctx.scope) {
          hasClass = true;
          if (typeof attr.value === "string") {
            ctx.lines.push(`__s.sAttr(${v}, "class", ${JSON.stringify(`${attr.value} ${ctx.scope}`)});`);
          } else if (attr.value === true) {
            ctx.lines.push(`__s.sAttr(${v}, "class", ${JSON.stringify(ctx.scope)});`);
          } else {
            ctx.lines.push(`__s.sAttr(${v}, "class", ((${expr(attr.value, ctx)}) || "") + " ${ctx.scope}");`);
          }
          break;
        }
        if (attr.value === true) {
          ctx.lines.push(`__s.sAttr(${v}, ${JSON.stringify(attr.name)}, true);`);
        } else if (typeof attr.value === "string") {
          ctx.lines.push(`__s.sAttr(${v}, ${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`);
        } else {
          ctx.lines.push(`__s.sAttr(${v}, ${JSON.stringify(attr.name)}, (${expr(attr.value, ctx)}));`);
        }
        break;
      case "ClassToggle":
        ctx.lines.push(`__s.sClass(${v}, ${JSON.stringify(attr.name)}, !!(${expr(attr.expr, ctx)}));`);
        break;
      case "StyleProp":
        ctx.lines.push(`__s.sStyle(${v}, ${JSON.stringify(attr.name)}, (${expr(attr.expr, ctx)}));`);
        break;
      case "Bind":
        if (attr.name !== "value") {
          ctx.lines.push(`__s.sAttr(${v}, ${JSON.stringify(attr.name)}, (${expr(attr.expr, ctx)}));`);
        } else {
          // initial reflection only — two-way wiring is a client concern
          ctx.lines.push(`__s.sValue(${v}, (${expr(attr.expr, ctx)}));`);
        }
        break;
      // On/Use/Transition/Animate — client-only, no server markup
    }
  }
  if (ctx.scope && !hasClass) {
    ctx.lines.push(`__s.sAttr(${v}, "class", ${JSON.stringify(ctx.scope)});`);
  }

  ctx.lines.push(`__h += __s.sOpen(${v});`);
  if (node.children.length > 0 && !VOID_ELEMENTS.has(node.tag)) {
    const prevRaw = ctx.raw;
    ctx.raw = node.tag === "script" || node.tag === "style";
    genNodesS(node.children, ctx);
    ctx.raw = prevRaw;
  }
  ctx.lines.push(`__h += __s.sClose(${v});`);
}

function genComponentS(node, ctx) {
  const props = [];
  for (const attr of node.attrs) {
    if (attr.type === "Attr") {
      if (attr.value === true) props.push(`${JSON.stringify(attr.name)}: true`);
      else if (typeof attr.value === "string") props.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value)}`);
      else props.push(`${JSON.stringify(attr.name)}: (${expr(attr.value, ctx)})`);
    } else if (attr.type === "On") {
      const prop = "on" + attr.event.charAt(0).toUpperCase() + attr.event.slice(1);
      props.push(`${JSON.stringify(prop)}: (${expr(attr.expr, ctx)})`);
    }
  }
  const slot = node.children.length > 0 ? `, ${stringBuilder(node.children, ctx, [])}` : "";
  ctx.lines.push(`__h += __s.sChild(${node.tag}, { ${props.join(", ")} }${slot});`);
}

function genIfS(node, ctx) {
  ctx.lines.push(`__h += "<!--niral:start-->";`);
  let first = true;
  for (const { expr: e, children } of node.branches) {
    const block = { ...ctx, lines: [] };
    genNodesS(children, block);
    ctx.counter = block.counter;
    const body = block.lines.map((l) => "  " + l).join("\n");
    if (e) {
      ctx.lines.push(`${first ? "if" : "else if"} ((${expr(e, ctx)})) {\n${body}\n}`);
      first = false;
    } else {
      ctx.lines.push(first ? `{\n${body}\n}` : `else {\n${body}\n}`);
    }
  }
  ctx.lines.push(`__h += "<!--niral:end-->";`);
}

function genForS(node, ctx) {
  const iv = fresh(ctx, "si");
  ctx.lines.push(`__h += "<!--niral:start-->";`);

  if (node.keyExpr) {
    // keyed — per-entry anchors; item/index look like signals (t.get())
    const signalLocals = [node.item, node.index].filter(Boolean);
    const block = {
      ...ctx,
      signals: new Set([...ctx.signals, ...signalLocals]),
      locals: new Set([...ctx.locals].filter((n) => !signalLocals.includes(n))),
      lines: [],
    };
    genNodesS(node.children, block);
    ctx.counter = block.counter;
    const body = block.lines.map((l) => "    " + l).join("\n");
    const idx = node.index ? `const ${node.index} = __s.sSig(${iv}++);` : "";
    ctx.lines.push(
      `{ let ${iv} = 0; for (const __${iv} of ((${expr(node.iterable, ctx)}) ?? [])) {\n` +
        `  const ${node.item} = __s.sSig(__${iv}); ${idx}\n` +
        `  __h += "<!--niral:start-->";\n${body}\n  __h += "<!--niral:end-->";\n} }`
    );
  } else {
    // plain — one region, items are plain locals
    const extraLocals = [node.item, node.index].filter(Boolean);
    const block = { ...ctx, locals: new Set([...ctx.locals, ...extraLocals]), lines: [] };
    genNodesS(node.children, block);
    ctx.counter = block.counter;
    const body = block.lines.map((l) => "    " + l).join("\n");
    const idx = node.index ? `const ${node.index} = ${iv}++;` : "";
    ctx.lines.push(
      `{ let ${iv} = 0; for (const ${node.item} of ((${expr(node.iterable, ctx)}) ?? [])) { ${idx}\n${body}\n} }`
    );
  }
  ctx.lines.push(`__h += "<!--niral:end-->";`);
}

function genAwaitS(node, ctx) {
  const pending = stringBuilder(node.pending ?? [], ctx, []);
  const thenB = node.thenChildren
    ? stringBuilder(node.thenChildren, ctx, [node.thenVar].filter(Boolean), node.thenVar ?? "")
    : "null";
  ctx.lines.push(`__h += __s.sAwait((${expr(node.expr, ctx)}), ${pending}, ${thenB});`);
}

/** A `(params) => htmlString` builder for slots / await branches. */
function stringBuilder(children, ctx, extraLocals, params = "") {
  const child = {
    ...ctx,
    locals: new Set([...ctx.locals, ...extraLocals]),
    lines: [],
  };
  genNodesS(children, child);
  ctx.counter = child.counter;
  const body = child.lines.map((l) => "      " + l).join("\n");
  return `(${params}) => {\n      let __h = "";\n${body}\n      return __h;\n    }`;
}

/* ── helpers ── */

function expr(e, ctx) {
  return rewriteExpr(e.raw, ctx.signals, ctx.locals).trim();
}

function fresh(ctx, prefix) {
  return `${prefix}${ctx.counter++}`;
}

function normalizeText(value) {
  // collapse whitespace runs; drop whitespace-only nodes that span newlines
  if (value.trim() === "") return /\n/.test(value) ? "" : value;
  return value.replace(/\s+/g, " ");
}

function indent(code, spaces) {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.trim() ? pad + l : l))
    .join("\n");
}
