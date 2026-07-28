/**
 * Niral compiler — reactive rewriter.
 *
 * Turns author-friendly code into signal calls:
 *
 *   let count = $state(0)         →  const count = __n.signal(0)
 *   let big = $derived(count*2)   →  const big = __n.derived(() => (count.get()*2))
 *   let { items } = $props        →  const { items } = __props
 *   count++                       →  count.set(count.get() + 1)
 *   count = 5                     →  count.set((5))
 *   count += n                    →  count.set(count.get() + (n))
 *   {count}   (in templates)      →  count.get()
 *
 * A token-level walker (string/template/comment aware) — not a regex soup,
 * not yet a full JS parser. Full semantic analysis lands with the analyzer
 * in a later milestone; these rules cover real component code today.
 */

import { NiralError } from "./errors.js";

const ID_START = /[A-Za-z_$]/;
const ID_CHAR = /[A-Za-z0-9_$]/;

/** Split a $props destructure body on TOP-LEVEL commas and parse each part:
 *  `key`, `key = default`, `key: local`, `key: local = default`.
 *  Comments inside the pattern are dropped (string-aware — `"https://x"`
 *  in a default survives). */
export function parsePropsPattern(inner) {
  // strip comments without touching string contents
  let clean = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < inner.length && inner[j] !== ch) j += inner[j] === "\\" ? 2 : 1;
      clean += inner.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "/" && inner[i + 1] === "/") {
      const nl = inner.indexOf("\n", i);
      i = nl === -1 ? inner.length : nl;
      clean += "\n";
      continue;
    }
    if (ch === "/" && inner[i + 1] === "*") {
      const end = inner.indexOf("*/", i + 2);
      i = end === -1 ? inner.length : end + 1;
      continue;
    }
    clean += ch;
  }
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of clean) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((p) => {
      const eq = p.indexOf("=");
      const def = eq === -1 ? null : p.slice(eq + 1).trim();
      const head = (eq === -1 ? p : p.slice(0, eq)).trim();
      const colon = head.indexOf(":");
      const key = (colon === -1 ? head : head.slice(0, colon)).trim();
      const local = (colon === -1 ? head : head.slice(colon + 1)).trim();
      return { key, local, def };
    })
    .filter((p) => p.key);
}

/** Collect $state/$derived/$props names from a <script> block. */
export function collectDeclarations(code) {
  const signals = new Set();
  const props = new Set();
  const declRe = /(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\$(state|derived)\b/g;
  let m;
  while ((m = declRe.exec(code))) signals.add(m[1]);
  const propsRe = /(?:let|const|var)\s*\{([^}]*)\}\s*=\s*\$props\b/g;
  while ((m = propsRe.exec(code))) {
    for (const { local } of parsePropsPattern(m[1])) props.add(local);
  }
  return { signals, props };
}

/** Rewrite a full <script> block. */
export function rewriteScript(code, signals, locals = new Set()) {
  guardUnsupported(code, signals);
  return walk(code, signals, locals, true);
}

/**
 * The rewriter is a token walker, not a full JS parser. For constructs it
 * would silently miscompile, fail LOUDLY with a teaching error instead.
 */
function guardUnsupported(code, signals) {
  // prefix ++/-- on reactive state (the walker only rewrites postfix)
  for (const m of code.matchAll(/(^|[^\w$.])(\+\+|--)\s*([A-Za-z_$][\w$]*)/g)) {
    if (signals.has(m[3])) {
      throw new NiralError("NIRAL041", `Prefix ${m[2]} on reactive state '${m[3]}' isn't supported`, {
        source: code,
        start: m.index + m[1].length,
        hint: `Write ${m[3]}${m[2]} (postfix) or ${m[3]} = ${m[3]} ${m[2][0]} 1 instead.`,
      });
    }
  }

  // destructuring ASSIGNMENT into reactive state: [a, b] = …  /  ({ a } = …)
  // (declarations — let/const/var — are fine; $props destructuring is handled)
  for (const m of code.matchAll(/[\]\}]\s*=(?![=>])/g)) {
    const closeAt = m.index;
    const close = code[closeAt];
    const open = close === "]" ? "[" : "{";
    let depth = 1;
    let i = closeAt - 1;
    while (i >= 0 && depth > 0) {
      if (code[i] === close) depth++;
      else if (code[i] === open) depth--;
      i--;
    }
    if (depth !== 0) continue;
    const before = code.slice(0, i + 1);
    if (/(let|const|var)\s*$/.test(before)) continue; // declaration — allowed
    const inner = code.slice(i + 2, closeAt);
    for (const id of inner.matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (signals.has(id[0])) {
        throw new NiralError("NIRAL040", `Destructuring assignment into reactive state ('${id[0]}') isn't supported`, {
          source: code,
          start: i + 1,
          end: closeAt + 1,
          hint: `Assign each piece directly: ${id[0]} = value.`,
        });
      }
    }
  }
}

/** Rewrite a template expression. */
export function rewriteExpr(code, signals, locals = new Set()) {
  return walk(code, signals, locals, false);
}

function walk(code, signals, locals, isScript) {
  let out = "";
  let i = 0;
  const n = code.length;
  let prevSig = ""; // last significant (non-whitespace) char emitted

  const declRe = /(?:let|const|var)(\s+)([A-Za-z_$][\w$]*)(\s*=\s*)\$(state|derived)\s*\(/y;
  const propsRe = /(?:let|const|var)(\s*)\{([^}]*)\}(\s*=\s*)\$props\b/y;

  while (i < n) {
    const ch = code[i];

    // strings / templates / comments pass through (templates rewritten inside ${})
    if (ch === '"' || ch === "'") {
      const j = endOfString(code, i);
      out += code.slice(i, j);
      i = j;
      prevSig = ch;
      continue;
    }
    if (ch === "`") {
      const [seg, j] = rewriteTemplateLiteral(code, i, signals, locals);
      out += seg;
      i = j;
      prevSig = "`";
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const j = code.indexOf("\n", i);
      const k = j === -1 ? n : j;
      out += code.slice(i, k);
      i = k;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const j = code.indexOf("*/", i + 2);
      const k = j === -1 ? n : j + 2;
      out += code.slice(i, k);
      i = k;
      continue;
    }

    // declarations (script only)
    if (isScript && ID_START.test(ch) && !ID_CHAR.test(code[i - 1] ?? "")) {
      declRe.lastIndex = i;
      let m = declRe.exec(code);
      if (m) {
        const [, , name, , kind] = m;
        const open = i + m[0].length - 1; // position of '('
        const close = balancedParenEnd(code, open);
        const inner = walk(code.slice(open + 1, close), signals, locals, false);
        out +=
          kind === "state"
            ? `const ${name} = __n.signal(${inner})`
            : `const ${name} = __n.derived(() => (${inner}))`;
        i = close + 1;
        prevSig = ")";
        continue;
      }
      propsRe.lastIndex = i;
      m = propsRe.exec(code);
      if (m) {
        // reactive props: each binding is a live view into the parent's
        // props signal — updates flow fine-grained, child state survives
        out += parsePropsPattern(m[2])
          .map(
            ({ key, local, def }) =>
              `const ${local} = __n.prop(__props, ${JSON.stringify(key)}${
                def ? `, () => (${walk(def, signals, locals, false)})` : ""
              })`
          )
          .join("; ");
        i += m[0].length;
        prevSig = "s";
        continue;
      }
    }

    // identifiers
    if (ID_START.test(ch) && !ID_CHAR.test(code[i - 1] ?? "")) {
      let j = i + 1;
      while (j < n && ID_CHAR.test(code[j])) j++;
      const id = code.slice(i, j);

      if (!signals.has(id) || locals.has(id) || prevSig === ".") {
        out += id;
        i = j;
        prevSig = id[id.length - 1];
        continue;
      }

      // lookahead past whitespace
      let k = j;
      while (k < n && /\s/.test(code[k])) k++;
      const two = code.slice(k, k + 2);
      const nextCh = code[k];

      // object literal positions: { count } shorthand / { count: ... } key
      if ((prevSig === "{" || prevSig === ",") && (nextCh === "," || nextCh === "}" )) {
        out += `${id}: ${id}.get()`;
        i = j;
        prevSig = ")";
        continue;
      }
      if ((prevSig === "{" || prevSig === ",") && nextCh === ":") {
        out += id; // object key — leave untouched
        i = j;
        prevSig = id[id.length - 1];
        continue;
      }

      if (two === "++" || two === "--") {
        out += `${id}.set(${id}.get() ${two[0]} 1)`;
        i = k + 2;
        prevSig = ")";
        continue;
      }

      const compound = /^([+\-*/%]|\*\*)=/.exec(code.slice(k, k + 3));
      const isPlainAssign =
        nextCh === "=" && code[k + 1] !== "=" && code[k + 1] !== ">" && prevSig !== "=" &&
        prevSig !== "!" && prevSig !== "<" && prevSig !== ">";

      if (compound && code[k + compound[1].length + 1] !== "=") {
        const op = compound[1];
        const rhsStart = k + op.length + 1;
        const rhsEnd = statementEnd(code, rhsStart);
        const rhs = walk(code.slice(rhsStart, rhsEnd), signals, locals, false);
        // a trailing // comment must not swallow our closing parens
        const sep = rhs.includes("//") ? "\n" : "";
        out += `${id}.set(${id}.get() ${op} (${rhs.trim()}${sep}))`;
        i = rhsEnd;
        prevSig = ")";
        continue;
      }
      if (isPlainAssign) {
        const rhsStart = k + 1;
        const rhsEnd = statementEnd(code, rhsStart);
        const rhs = walk(code.slice(rhsStart, rhsEnd), signals, locals, false);
        const sep = rhs.includes("//") ? "\n" : "";
        out += `${id}.set((${rhs.trim()}${sep}))`;
        i = rhsEnd;
        prevSig = ")";
        continue;
      }

      // already-rewritten access guard
      if (code.slice(k, k + 5) === ".get(" || code.slice(k, k + 5) === ".set(") {
        out += id;
        i = j;
        prevSig = id[id.length - 1];
        continue;
      }

      out += `${id}.get()`;
      i = j;
      prevSig = ")";
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) {
      // a '.' in a spread/rest '...' is neither member access nor an object-key
      // position — use a neutral marker so the next identifier reads as a value
      if (ch === "." && (code[i + 1] === "." || code[i - 1] === ".")) prevSig = "#";
      // an arrow's '>' is NOT a comparison — `() => count = 5` must still
      // rewrite the assignment (marker keeps the assign-guard permissive)
      else if (ch === ">" && code[i - 1] === "=") prevSig = "\u21d2";
      else prevSig = ch;
    }
    i++;
  }
  return out;
}

/* ── helpers ── */

function endOfString(code, i) {
  const quote = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === "\\") j += 2;
    else if (code[j] === quote) return j + 1;
    else if (code[j] === "\n") return j; // unterminated — stop at newline
    else j++;
  }
  return j;
}

function rewriteTemplateLiteral(code, i, signals, locals) {
  let out = "`";
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === "\\") {
      out += code.slice(j, j + 2);
      j += 2;
    } else if (code[j] === "`") {
      return [out + "`", j + 1];
    } else if (code[j] === "$" && code[j + 1] === "{") {
      const close = balancedBraceEnd(code, j + 1);
      out += "${" + walk(code.slice(j + 2, close), signals, locals, false) + "}";
      j = close + 1;
    } else {
      out += code[j];
      j++;
    }
  }
  return [out, j];
}

function balancedParenEnd(code, open) {
  return balancedEnd(code, open, "(", ")");
}

function balancedBraceEnd(code, open) {
  return balancedEnd(code, open, "{", "}");
}

function balancedEnd(code, open, oc, cc) {
  let depth = 0;
  let j = open;
  while (j < code.length) {
    const ch = code[j];
    if (ch === '"' || ch === "'") j = endOfString(code, j) - 1;
    else if (ch === "`") {
      // skip template coarsely (handles nesting via recursion in rewrite paths)
      let d = 0;
      j++;
      while (j < code.length) {
        if (code[j] === "\\") j++;
        else if (code[j] === "`" && d === 0) break;
        else if (code[j] === "$" && code[j + 1] === "{") d++;
        else if (code[j] === "}" && d > 0) d--;
        j++;
      }
    } else if (ch === oc) depth++;
    else if (ch === cc) {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return j;
}

/** End of an assignment RHS: top-level ';', newline, ',' or a closing bracket. */
function statementEnd(code, start) {
  let depth = 0;
  let j = start;
  while (j < code.length) {
    const ch = code[j];
    if (ch === '"' || ch === "'") {
      j = endOfString(code, j);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return j;
      depth--;
    } else if (depth === 0 && (ch === ";" || ch === "\n" || ch === ",")) {
      return j;
    }
    j++;
  }
  return j;
}
