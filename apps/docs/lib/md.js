/**
 * Docs — tiny markdown renderer (headers, fenced code, inline code, bold,
 * links, lists, tables, paragraphs). Content is trusted (our own docs).
 */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ── syntax highlighting — tiny rule-based tokenizer ─────────────
   Earliest-match wins; plain text between tokens is escaped. */

const JS_RULES = [
  [/\/\/[^\n]*|\/\*[\s\S]*?\*\//, "c"], // comments
  [/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/, "s"], // strings
  [/\$(?:state|derived|props)\b/, "r"], // runes
  [/\b(?:const|let|var|function|return|if|else|for|of|in|await|async|export|import|from|new|class|extends|try|catch|finally|throw|yield|switch|case|break|continue|typeof|instanceof|null|undefined|true|false|this|default|def|end)\b/, "k"],
  [/\b\d[\d_.]*\b/, "n"],
];
const HTML_RULES = [
  [/<!--[\s\S]*?-->/, "c"],
  [/(["'])(?:\\.|(?!\1)[^\\\n])*\1/, "s"],
  [/\{[#/:@][^}]*\}/, "r"], // {#if} {:else} {/for} {@html}
  [/\$(?:state|derived|props)\b/, "r"],
  [/<\/?[\w!-]+|\/?>/, "t"], // tag open/close
  [/\b(?:const|let|function|return|if|else|for|of|await|async|export|import|from|null|true|false|yield)\b/, "k"],
];
const SH_RULES = [
  [/#[^\n]*/, "c"],
  [/(["'])(?:\\.|(?!\1)[^\\\n])*\1/, "s"],
  [/^\s*niral\b|\bniral\b/m, "r"],
  [/NIRAL_[A-Z_]+/, "n"],
];
const RULES = { js: JS_RULES, jsx: JS_RULES, ts: JS_RULES, json: JS_RULES, html: HTML_RULES, niral: HTML_RULES, sh: SH_RULES, bash: SH_RULES };

export function highlight(code, lang) {
  const rules = RULES[lang];
  if (!rules) return esc(code);
  let out = "";
  let rest = code;
  while (rest) {
    let best = null;
    for (const [re, cls] of rules) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.index)) best = { index: m.index, text: m[0], cls };
    }
    if (!best) {
      out += esc(rest);
      break;
    }
    out += esc(rest.slice(0, best.index));
    out += `<span class="tok-${best.cls}">${esc(best.text)}</span>`;
    rest = rest.slice(best.index + best.text.length);
  }
  return out;
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function md(src) {
  const lines = src.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre data-lang="${esc(lang)}"><code>${highlight(buf.join("\n"), lang)}</code></pre>`);
      continue;
    }
    // headers — ## → h2, ### → h3 (page h1 comes from the title)
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.max(2, h[1].length);
      const id = h[2].toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // tables
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[\s\-|:]+\|$/)) {
      const cells = (l) => l.split("|").slice(1, -1).map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
      continue;
    }
    // lists
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s/, ""));
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    // blank
    if (!line.trim()) {
      i++;
      continue;
    }
    // paragraph — merge consecutive lines
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|```|\||[-*]\s|\d+\.\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

/** Markdown → searchable plain text (code + markup stripped). */
export function plainText(src) {
  return src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*#|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
