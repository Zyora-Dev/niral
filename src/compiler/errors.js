/**
 * Niral compiler — error engine.
 *
 * Every compiler error carries: a stable code, a plain-language message,
 * a hint on how to fix it, and a source span. `codeFrame()` renders the
 * offending source with a caret — errors that teach, not confuse.
 */

export class NiralError extends Error {
  /**
   * @param {string} code    e.g. "NIRAL001"
   * @param {string} message plain-language description
   * @param {object} opts    { hint, source, filename, start, end }
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = "NiralError";
    this.code = code;
    this.hint = opts.hint ?? null;
    this.filename = opts.filename ?? "<unknown>";
    this.source = opts.source ?? null;
    this.start = opts.start ?? 0;
    this.end = opts.end ?? opts.start ?? 0;
    if (this.source != null) {
      const { line, col } = offsetToLineCol(this.source, this.start);
      this.line = line;
      this.col = col;
    }
  }

  /** Human-friendly multi-line rendering with a source frame. */
  format() {
    let out = `${this.code}: ${this.message}\n  at ${this.filename}`;
    if (this.line != null) out += `:${this.line}:${this.col}`;
    if (this.source != null) out += `\n\n${codeFrame(this.source, this.start, this.end)}`;
    if (this.hint) out += `\n  hint: ${this.hint}`;
    return out;
  }
}

/** 1-based line/col for a byte offset. */
export function offsetToLineCol(source, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

/** Render up to 3 lines of context with a caret under the span. */
export function codeFrame(source, start, end = start) {
  const { line, col } = offsetToLineCol(source, start);
  const lines = source.split("\n");
  const from = Math.max(0, line - 2);
  const to = Math.min(lines.length, line + 1);
  const width = String(to).length;
  let out = "";
  for (let i = from; i < to; i++) {
    const no = String(i + 1).padStart(width);
    const marker = i + 1 === line ? ">" : " ";
    out += `  ${marker} ${no} | ${lines[i]}\n`;
    if (i + 1 === line) {
      const len = Math.max(1, Math.min(end - start, lines[i].length - col + 1));
      out += `    ${" ".repeat(width)} | ${" ".repeat(col - 1)}${"^".repeat(len)}\n`;
    }
  }
  return out.replace(/\n$/, "");
}
