/**
 * Niral LSP — analysis (the editor-facing brain, protocol-free).
 *
 *   validate(text, filename)     → LSP diagnostics (the SAME teaching errors
 *                                  the dev overlay shows, as red squiggles)
 *   completions(text, offset)    → context-aware completion items
 *   hover(text, offset)          → markdown docs for the symbol under cursor
 *
 * Reuses the real compiler — the editor can never disagree with the build.
 */

import { compileClient } from "../compiler/codegen.js";
import { NiralError } from "../compiler/errors.js";

/* ── positions ── */

export function offsetToPosition(text, offset) {
  let line = 0;
  let last = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      last = i + 1;
    }
  }
  return { line, character: Math.max(0, Math.min(offset, text.length) - last) };
}

export function positionToOffset(text, { line, character }) {
  let i = 0;
  for (let l = 0; l < line; l++) {
    const nl = text.indexOf("\n", i);
    if (nl === -1) return text.length;
    i = nl + 1;
  }
  return Math.min(text.length, i + character);
}

/* ── diagnostics ── */

export function validate(text, filename = "file.niral") {
  try {
    compileClient(text, { filename, runtime: "niral/runtime" });
    return [];
  } catch (e) {
    if (!(e instanceof NiralError)) {
      return [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          source: "niral",
          message: String(e?.message ?? e),
        },
      ];
    }
    const start = offsetToPosition(text, e.start ?? 0);
    const end = offsetToPosition(text, Math.max((e.start ?? 0) + 1, e.end ?? 0));
    return [
      {
        range: { start, end },
        severity: 1,
        source: "niral",
        code: e.code,
        message: e.hint ? `${e.message}\n\nhint: ${e.hint}` : e.message,
      },
    ];
  }
}

/* ── completions ── */

const S = 15; // CompletionItemKind.Snippet
const K = 14; // Keyword
const F = 3; //  Function
const P = 10; // Property

const snip = (label, insertText, detail, kind = S) => ({
  label,
  kind,
  detail,
  insertText,
  insertTextFormat: 2, // snippet
});
const kw = (label, detail, kind = K) => ({ label, kind, detail, insertText: label, insertTextFormat: 1 });

const BLOCKS = [
  snip("{#if}", "#if ${1:condition}}\n\t$0\n{/if}", "conditional block"),
  snip("{#if}{:else}", "#if ${1:condition}}\n\t$2\n{:else}\n\t$0\n{/if}", "conditional with else"),
  snip("{#for}", "#for ${1:item} of ${2:items}}\n\t$0\n{/for}", "loop block"),
  snip("{#for key}", "#for ${1:item} of ${2:items} key ${1:item}.id}\n\t$0\n{/for}", "keyed loop (DOM reuse)"),
  snip("{#await}", "#await ${1:promise}}\n\tloading…\n{:then ${2:value}}\n\t$0\n{:catch ${3:err}}\n\t<p>{${3:err}.message}</p>\n{/await}", "async block"),
];
const CLAUSES = [
  kw(":else", "else branch"),
  snip(":else if", ":else if ${1:condition}}", "else-if branch"),
  snip(":then", ":then ${1:value}}", "resolved branch"),
  snip(":catch", ":catch ${1:err}}", "rejection branch"),
];
const RUNES = [
  snip("$state", "state(${1:initial})", "reactive state — updates flow to the DOM", F),
  snip("$derived", "derived(${1:expr})", "computed value — recomputes when inputs change", F),
  kw("$props", "props passed by the parent / route (params + load data)", P),
];
const TAGS = [
  snip("server", "server>\n${1:export async function load({ params }) {\n\treturn { }\n\\}}\n</server>", "server block — never ships to the client"),
  snip("server lang", 'server lang="${1|python,ruby,go|}">\n$0\n</server>', "polyglot server block"),
  snip("script", "script>\n\t$0\n</script>", "component logic (runes live here)"),
  snip("style", "style>\n\t$0\n</style>", "scoped styles (this component only)"),
  snip("head", "head>\n\t<title>$0</title>\n</head>", "per-page head — {prop} interpolates"),
  kw("slot /", "render children passed by the parent component"),
];
const DIRECTIVES = [
  snip("bind:value", 'bind:value={${1:state}}', "two-way input binding (paths work: todo.text)"),
  snip("on:click", "on:click={${1:handler}}", "event handler"),
  snip("on:input", "on:input={${1:handler}}", "event handler"),
  snip("on:submit", "on:submit={${1:handler}}", "event handler"),
  snip("on:change", "on:change={${1:handler}}", "event handler"),
  snip("on:keydown", "on:keydown={${1:handler}}", "event handler"),
  snip("class:", "class:${1:name}={${2:condition}}", "conditional class toggle"),
  snip("style:", "style:${1:property}={${2:value}}", "reactive style property"),
  snip("use:", "use:${1:action}", "action directive"),
];
const SCRIPT_ATTRS = [
  kw('lang="ts"', "TypeScript in this script (types stripped, not checked)"),
  kw('mode="static"', "zero JS — SSR only, no hydration"),
  kw("stream", "streaming SSR — head flushes early; {#await} branches stream in as they resolve"),
];

export function completions(text, offset) {
  const before = text.slice(0, offset);

  const mBlock = before.match(/\{#?\w*$/);
  if (mBlock) {
    if (mBlock[0].startsWith("{#") || mBlock[0] === "{") {
      const items = [...BLOCKS];
      items.push(snip("{@html}", "@html ${1:trustedHtml}}", "raw html — TRUSTED content only"));
      return items;
    }
  }
  if (/\{:\w*$/.test(before)) return CLAUSES;
  if (/\{@\w*$/.test(before)) return [snip("@html", "@html ${1:trustedHtml}}", "raw html — TRUSTED content only")];
  if (/\$\w*$/.test(before)) return RUNES;

  // inside an open tag? complete attributes / directives
  const lastOpen = before.lastIndexOf("<");
  const lastClose = before.lastIndexOf(">");
  if (lastOpen > lastClose) {
    const tagText = before.slice(lastOpen);
    // …unless the cursor is INSIDE an ={expression} — that's script land
    const exprOpen = tagText.lastIndexOf("={");
    const inExpr = exprOpen !== -1 && !tagText.slice(exprOpen).includes("}");
    if (!inExpr) {
      const mTag = tagText.match(/^<([A-Za-z][\w-]*)?\s*$/);
      if (mTag !== null && !/\s/.test(tagText.slice(1))) return TAGS; // still typing the tag name
      const tag = tagText.match(/^<([A-Za-z][\w-]*)/)?.[1];
      if (tag === "script") return SCRIPT_ATTRS;
      if (tag === "server") return [snip('lang="…"', 'lang="${1|python,ruby,go|}"', "backend language (default: js)")];
      if (tag === "style") return [kw("global", "opt OUT of style scoping")];
      return DIRECTIVES;
    }
  }

  // server-block function names → usable as RPC calls in the script
  const server = text.match(/<server[^>]*>([\s\S]*?)<\/server>/i);
  if (server && /\w$/.test(before)) {
    const names = [...server[1].matchAll(/(?:export\s+(?:async\s+)?function|^def|^func)\s+([A-Za-z_]\w*)/gm)]
      .map((m) => m[1])
      .filter((n) => !n.startsWith("_") && n !== "load");
    return names.map((n) => ({ label: n, kind: F, detail: "server function (called over RPC)" }));
  }
  return [];
}

/* ── hover ── */

const DOCS = {
  $state: "**$state(initial)** — reactive state. Assignments (`count++`, `todos = [...]`) update the DOM surgically — no virtual DOM, no re-render.",
  $derived: "**$derived(expr)** — computed value. Recomputes when the signals it reads change.",
  $props: "**$props** — what the parent passed in. For routes: URL params + everything `load()` returned. Destructure it: `let { slug } = $props`.",
  "#if": "**{#if cond} … {:else if} … {:else} … {/if}** — conditional rendering. Only the active branch exists in the DOM.",
  "#for": "**{#for item, i of items key item.id} … {/for}** — loop. With `key`, rows are matched by identity: DOM, input state and effects survive reorders.",
  "#await": "**{#await promise} pending {:then v} … {:catch e} … {/await}** — async rendering. On a `<script stream>` page the server flushes the pending branch immediately, then streams the resolved `{:then}`/`{:catch}` HTML out of order as the promise settles. Otherwise SSR shows pending and the client swaps on settle. Re-runs when a signal inside the expression changes.",
  "@html": "**{@html expr}** — render raw, UNESCAPED html. ⚠️ Trusted content only — this bypasses Niral's XSS protection.",
  "bind:": "**bind:value={state}** — two-way input binding. Paths work too: `bind:value={todo.text}` writes through to the object.",
  "on:": "**on:click={handler}** — DOM event. Handlers may be async; thrown errors are contained and reported, the app stays alive.",
  "class:": "**class:active={cond}** — toggle one class reactively. Plays nice with scoped-style classes.",
  "style:": "**style:color={value}** — set one style property reactively.",
  "use:": "**use:action** — run a function with the element when it mounts. Client-only: actions do NOT run during server rendering.",
  session: "**session** — ambient signed-cookie session, available in every `<server>` function (any language): `session.get(k)`, `session.set(k, v)`, `session.delete(k)`, `session.clear()`.",
  publish: "**publish(channel, data)** — push to everyone subscribed to a live channel. Available in `<server>` blocks (JS, Python, Ruby, Go).",
  live: '**live(channel, onMessage)** — join a real-time channel from the component. Returns `{ send(data), close() }`. Reconnects automatically; no-op during SSR.',
  load: "**export async function load({ params, locals })** — runs during SSR (and on client-side navigation). Its return value merges into `$props`. Never callable from the browser.",
  slot: "**<slot />** — where children passed by the parent component render.",
  server: "**<server>** — backend code that NEVER ships to the client. Exported functions become type-safe RPC stubs. `lang=\"python|ruby|go\"` for other languages.",
  head: "**<head>** — per-page head content. `{prop}` interpolates load() data into e.g. `<title>` (HTML-escaped).",
  stream: "**<script stream>** — streaming SSR: the shell + styles flush before `load()` runs, and each `{#await}` branch streams in out of order as its promise settles (fastest first). Note: load() can't set session cookies on streamed pages.",
  batch: "**batch(fn)** — group many state writes into one flush; effects see only the final state.",
};

export function hover(text, offset) {
  // expand the word under the cursor (runes, directives, block keywords)
  let s = offset;
  let e = offset;
  const wordChar = /[\w$#@:]/;
  while (s > 0 && wordChar.test(text[s - 1])) s--;
  while (e < text.length && wordChar.test(text[e])) e++;
  let word = text.slice(s, e);

  if (DOCS[word]) return DOCS[word];
  const prefix = word.match(/^(bind|on|class|style|use):/)?.[0];
  if (prefix && DOCS[prefix]) return DOCS[prefix];
  const block = word.match(/#(if|for|await)/)?.[0] ?? word.match(/@html/)?.[0];
  if (block && DOCS[block]) return DOCS[block];
  return null;
}
