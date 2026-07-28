/**
 * Niral compiler — TypeScript type stripping (no type CHECKING).
 *
 * A pragmatic, documented subset — enough for real component code:
 *   • `interface X { … }` and `type X = …` statements       → removed
 *   • `import type … from "x"`                              → removed
 *   • variable annotations       let x: T =                 → removed
 *   • function param annotations function f(a: T, b?: U)    → removed
 *   • return annotations         function f(): T {          → removed
 *   • arrow params               (a: T, b: U) => …          → removed
 *   • casts                      expr as T                  → removed
 *   • optional marker            (a?: T)                    → `?` removed
 *   • declaration generics       function f<T>( / class C<T> → removed
 *
 * NOT handled (throws nowhere — write these in plain JS): call-site
 * generics `f<T>(x)`, decorators, enums, namespaces, abstract classes.
 */

export function stripTypes(source) {
  let code = source;

  // whole-statement removals
  code = removeStatements(code, /(^|\n)\s*(export\s+)?interface\s+[A-Za-z_$][\w$]*/g, "{", true);
  code = removeStatements(code, /(^|\n)\s*(export\s+)?type\s+[A-Za-z_$][\w$]*\s*(<[^>]*>)?\s*=/g, ";", false);
  code = code.replace(/(^|\n)\s*import\s+type\s[^\n]*/g, "$1");
  code = code.replace(/(^|\n)\s*declare\s[^\n]*/g, "$1");

  // token-aware pass for annotations, casts, generics
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // strings / templates / comments pass through untouched
    if (ch === '"' || ch === "'") {
      const end = skipString(code, i);
      out += code.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = skipTemplate(code, i);
      out += code.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl === -1 ? code.length : nl;
      out += code.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      const end = close === -1 ? code.length : close + 2;
      out += code.slice(i, end);
      i = end;
      continue;
    }

    // declaration generics: function f<T>( … / class C<T>
    const gen = matchAt(code, i, /(function\s+[A-Za-z_$][\w$]*\s*|class\s+[A-Za-z_$][\w$]*\s*)</y);
    if (gen) {
      out += gen[1];
      i += gen[1].length;
      i = skipAngles(code, i); // past the matching >
      continue;
    }

    // `as Type` cast — preceded by a value token
    const as = matchAt(code, i, /\s+as\s+(const\b|[A-Za-z_$][\w$]*)/y);
    if (as && /[\w$)\]"'`]/.test(out.trimEnd().slice(-1))) {
      i += as[0].length;
      i = extendTypeTail(code, i);
      continue;
    }

    // annotation `: Type` in a type position: after ident/`)`/`?`, when the
    // statement context is a declaration, a param list, or a return type.
    if (ch === ":" && isTypePosition(out)) {
      i = skipType(code, i + 1);
      continue;
    }

    // optional param marker `?:` — drop the `?` (the `:` branch handles the type)
    if (ch === "?" && code[i + 1] === ":" && /[\w$]/.test(out.trimEnd().slice(-1)) && isTypePosition(out)) {
      i++; // skip '?', loop re-sees ':'
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/* ── helpers ── */

function matchAt(code, i, re) {
  re.lastIndex = i;
  return re.exec(code);
}

/** Heuristic: is a `:` here an annotation (not object literal / ternary / case)? */
function isTypePosition(before) {
  const t = before.trimEnd();
  // must directly follow an identifier, `)` or a destructuring pattern `}`/`]`
  if (!/[\w$)\]}]$/.test(t)) return false;
  // walk back to the statement/context opener
  for (let j = t.length - 1, depth = 0; j >= 0; j--) {
    const c = t[j];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) {
        // inside an open group: `(` = param list or call — annotations only
        // make sense in param lists; calls with `name:` are invalid JS anyway,
        // EXCEPT object literals `{`: real ambiguity — do NOT strip there.
        return c === "(";
      }
      depth--;
    } else if (depth === 0) {
      if (c === "?" ) return false; // ternary
      // statement keywords that legitimately precede annotations
      const head = t.slice(Math.max(0, j - 8), j + 1);
      if (/\b(let|const|var|function)\s*$/.test(t.slice(0, j + 1)) ) return true;
      if (c === ";" || c === "\n" || c === "{" ) break;
    }
  }
  // top level of a statement: `let x:`/`const x:` or return type `):`
  return /\b(let|const|var)\s+[A-Za-z_$][\w$]*$/.test(t) || /\)$/.test(t);
}

/** Skip a type expression starting after ':'; returns index of the delimiter. */
function skipType(code, i) {
  let depth = 0;
  let consumed = false; // any non-whitespace type token seen yet?
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") i = skipString(code, i);
    else if (c === "`") i = skipTemplate(code, i);
    else if (c === "{" && depth === 0 && consumed) {
      return i; // `): T {` — the function BODY starts, type is done
    } else if (c === "(" || c === "[" || c === "{" || c === "<") {
      depth++;
      consumed = true;
      i++;
    } else if (c === ")" || c === "]" || c === "}" || c === ">") {
      if (depth === 0) return i; // closing the enclosing group — done
      depth--;
      i++;
    } else if (depth === 0 && (c === "=" || c === "," || c === ";" || c === "\n")) {
      if (c === "=" && code[i + 1] === ">") {
        i += 2; // `=>` belongs to the arrow, keep scanning? no — return type ended
        return i - 2;
      }
      return i;
    } else {
      if (!/\s/.test(c)) consumed = true;
      i++;
    }
  }
  return i;
}

/** After `as X`, swallow trailing type syntax like `[]`, `<T>`, `.Y`. */
function extendTypeTail(code, i) {
  for (;;) {
    if (code.startsWith("[]", i)) i += 2;
    else if (code[i] === "." ) {
      const m = matchAt(code, i, /\.[A-Za-z_$][\w$]*/y);
      if (!m) break;
      i += m[0].length;
    } else if (code[i] === "<") i = skipAngles(code, i);
    else break;
  }
  return i;
}

function skipAngles(code, i) {
  let depth = 0;
  while (i < code.length) {
    if (code[i] === "<") depth++;
    else if (code[i] === ">") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function skipString(code, i) {
  const q = code[i];
  i++;
  while (i < code.length && code[i] !== q) {
    if (code[i] === "\\") i++;
    i++;
  }
  return i + 1;
}

function skipTemplate(code, i) {
  i++;
  while (i < code.length && code[i] !== "`") {
    if (code[i] === "\\") i++;
    else if (code[i] === "$" && code[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < code.length && depth > 0) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i + 1;
}

/** Remove statements matched by `re` through a balanced {..} or to a ';'. */
function removeStatements(code, re, until, balanced) {
  let out = code;
  let m;
  while ((m = re.exec(out))) {
    const start = m.index + (m[1] ? m[1].length : 0);
    let end;
    if (balanced) {
      const open = out.indexOf("{", start);
      if (open === -1) break;
      let depth = 1;
      end = open + 1;
      while (end < out.length && depth > 0) {
        if (out[end] === "{") depth++;
        else if (out[end] === "}") depth--;
        end++;
      }
    } else {
      // to the terminating ';' or double newline at depth 0
      let depth = 0;
      end = start;
      while (end < out.length) {
        const c = out[end];
        if ("([{<".includes(c)) depth++;
        else if (")]}>".includes(c)) depth--;
        else if (depth === 0 && (c === ";" || (c === "\n" && out[end + 1] === "\n"))) {
          end++;
          break;
        }
        end++;
      }
    }
    out = out.slice(0, start) + out.slice(end);
    re.lastIndex = 0;
  }
  return out;
}
