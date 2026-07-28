/**
 * Niral compiler — scanner (lexing layer).
 *
 * A character-level cursor over the source plus the JS-aware readers the
 * parser needs. `.niral` is context-sensitive (HTML dialect wrapping JS
 * expressions and raw JS blocks), so instead of a flat token stream we
 * expose precise scanning primitives that the recursive-descent parser
 * drives — the same approach used by every serious single-file-component
 * compiler, except this one is entirely ours.
 */

import { NiralError } from "./errors.js";

export class Scanner {
  constructor(source, filename = "<anonymous>") {
    this.src = source;
    this.filename = filename;
    this.pos = 0;
  }

  eof() {
    return this.pos >= this.src.length;
  }

  /** Current char (or char at +n). */
  peek(n = 0) {
    return this.src[this.pos + n];
  }

  /** Does the source at the cursor start with `str`? */
  startsWith(str) {
    return this.src.startsWith(str, this.pos);
  }

  /** Case-insensitive startsWith. */
  startsWithI(str) {
    return this.src.slice(this.pos, this.pos + str.length).toLowerCase() === str.toLowerCase();
  }

  /** Consume `str` if present; returns true if consumed. */
  eat(str) {
    if (this.startsWith(str)) {
      this.pos += str.length;
      return true;
    }
    return false;
  }

  /** Consume `str` or raise a NiralError. */
  expect(str, code, message, hint) {
    if (!this.eat(str)) {
      this.error(code, message ?? `Expected '${str}'`, { hint });
    }
  }

  /** Consume a run matching a regex anchored at the cursor. Returns match text or null. */
  read(re) {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (!m || m.index !== this.pos) return null;
    this.pos += m[0].length;
    return m[0];
  }

  /** Skip ASCII whitespace. */
  skipWs() {
    while (!this.eof() && /\s/.test(this.peek())) this.pos++;
  }

  /** Read raw text until (not including) any of the given stop strings, or EOF. */
  readUntil(...stops) {
    const start = this.pos;
    while (!this.eof() && !stops.some((s) => this.startsWith(s))) this.pos++;
    return this.src.slice(start, this.pos);
  }

  error(code, message, opts = {}) {
    throw new NiralError(code, message, {
      source: this.src,
      filename: this.filename,
      start: opts.start ?? this.pos,
      end: opts.end ?? (opts.start ?? this.pos) + 1,
      hint: opts.hint,
    });
  }
}

/* ── JS-aware readers ──────────────────────────────────────────────
   These understand strings, template literals (with ${} nesting) and
   comments, so JS content never confuses the template parser. */

/**
 * Read raw JS starting at the cursor until the top-level closing tag
 * (e.g. `</script>`) is found. Cursor is left ON the closing tag.
 * Strings/templates/comments are skipped, so `"</script>"` inside a
 * string literal is handled correctly.
 */
export function readJsUntilCloseTag(sc, tagName) {
  const start = sc.pos;
  const close = `</${tagName}`;
  while (!sc.eof()) {
    const ch = sc.peek();
    if (ch === '"' || ch === "'") skipString(sc, ch);
    else if (ch === "`") skipTemplate(sc);
    else if (ch === "/" && sc.peek(1) === "/") sc.readUntil("\n");
    else if (ch === "/" && sc.peek(1) === "*") skipBlockComment(sc);
    else if (sc.startsWithI(close)) return { code: sc.src.slice(start, sc.pos), start, end: sc.pos };
    else sc.pos++;
  }
  sc.error("NIRAL010", `<${tagName}> block is never closed`, {
    start,
    hint: `Add a closing </${tagName}> tag.`,
  });
}

/**
 * Read a brace-balanced JS expression. Call with the cursor just AFTER
 * the opening '{'. Consumes through the matching '}' and returns the
 * inner expression text and its span.
 */
export function readBalancedExpression(sc, openBracePos) {
  const start = sc.pos;
  let depth = 1;
  while (!sc.eof()) {
    const ch = sc.peek();
    if (ch === '"' || ch === "'") skipString(sc, ch);
    else if (ch === "`") skipTemplate(sc);
    else if (ch === "/" && sc.peek(1) === "/") sc.readUntil("\n");
    else if (ch === "/" && sc.peek(1) === "*") skipBlockComment(sc);
    else if (ch === "{") {
      depth++;
      sc.pos++;
    } else if (ch === "}") {
      depth--;
      sc.pos++;
      if (depth === 0) {
        return { raw: sc.src.slice(start, sc.pos - 1).trim(), start, end: sc.pos - 1 };
      }
    } else sc.pos++;
  }
  sc.error("NIRAL011", "Expression is missing its closing '}'", {
    start: openBracePos,
    hint: "Every '{' in the template must have a matching '}'.",
  });
}

function skipString(sc, quote) {
  const start = sc.pos;
  sc.pos++; // opening quote
  while (!sc.eof()) {
    const ch = sc.peek();
    if (ch === "\\") sc.pos += 2;
    else if (ch === quote) {
      sc.pos++;
      return;
    } else if (ch === "\n" ) {
      // Unterminated single-line string — let JS itself complain later;
      // for scanning purposes stop at the newline.
      return;
    } else sc.pos++;
  }
  sc.error("NIRAL012", "String literal is never closed", { start });
}

function skipTemplate(sc) {
  const start = sc.pos;
  sc.pos++; // backtick
  while (!sc.eof()) {
    const ch = sc.peek();
    if (ch === "\\") sc.pos += 2;
    else if (ch === "`") {
      sc.pos++;
      return;
    } else if (ch === "$" && sc.peek(1) === "{") {
      sc.pos += 2;
      let depth = 1;
      while (!sc.eof() && depth > 0) {
        const c = sc.peek();
        if (c === '"' || c === "'") skipString(sc, c);
        else if (c === "`") skipTemplate(sc);
        else {
          if (c === "{") depth++;
          else if (c === "}") depth--;
          sc.pos++;
        }
      }
    } else sc.pos++;
  }
  sc.error("NIRAL013", "Template literal is never closed", { start });
}

function skipBlockComment(sc) {
  const start = sc.pos;
  sc.pos += 2;
  while (!sc.eof() && !sc.startsWith("*/")) sc.pos++;
  if (sc.eof()) sc.error("NIRAL014", "Block comment is never closed", { start });
  sc.pos += 2;
}
