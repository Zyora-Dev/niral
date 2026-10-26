import { NiralScriptError } from "./errors.js";

export const RESERVED_WORDS = new Set(("await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield state derive arguments eval").split(" "));

export class Scanner {
  constructor(source, filename = "<anonymous>") {
    this.src = source;
    this.filename = filename;
    this.pos = 0;
  }

  eof() {
    return this.pos >= this.src.length;
  }

  peek(offset = 0) {
    return this.src[this.pos + offset];
  }

  startsWith(text) {
    return this.src.startsWith(text, this.pos);
  }

  eat(text) {
    if (!this.startsWith(text)) return false;
    this.pos += text.length;
    return true;
  }

  expect(text, code, message) {
    if (!this.eat(text)) this.error(code, message);
  }

  read(pattern) {
    pattern.lastIndex = this.pos;
    const match = pattern.exec(this.src);
    if (!match || match.index !== this.pos) return null;
    this.pos += match[0].length;
    return match[0];
  }

  skipWs() {
    while (!this.eof() && /\s/.test(this.peek())) this.pos++;
  }

  readUntil(stop) {
    const start = this.pos;
    while (!this.eof() && !this.startsWith(stop)) this.pos++;
    return this.src.slice(start, this.pos);
  }

  error(code, message, opts = {}) {
    throw new NiralScriptError(code, message, {
      source: this.src,
      filename: this.filename,
      start: opts.start ?? this.pos,
      end: opts.end ?? (opts.start ?? this.pos) + 1,
      hint: opts.hint,
    });
  }
}

export function readExpressionStatement(scanner, stopAtBlock = false) {
  const start = scanner.pos;
  const closers = [];
  while (!scanner.eof()) {
    const char = scanner.peek();
    if (stopAtBlock && closers.length === 0 && char === "}") break;
    if (closers.length === 0 && (char === ";" || char === "\n" || char === "\r")) break;
    if (char === '"' || char === "'") skipString(scanner, char);
    else if (char === "`") skipTemplate(scanner);
    else if (scanner.startsWith("//")) {
      while (!scanner.eof() && scanner.peek() !== "\n" && !(scanner.peek() === "\r" && scanner.src[scanner.pos + 1] !== "\n")) scanner.pos++;
    } else if (scanner.startsWith("/*")) {
      const commentStart = scanner.pos;
      skipBlockComment(scanner);
      if (closers.length === 0 && /[\r\n]/.test(scanner.src.slice(commentStart, scanner.pos))) break;
    }
    else if (["(", "[", "{"].includes(char)) {
      closers.push({ close: { "(": ")", "[": "]", "{": "}" }[char], start: scanner.pos });
      scanner.pos++;
    } else if (")]}".includes(char)) {
      if (closers.at(-1)?.close !== char) {
        scanner.error("NRS070", `Unexpected '${char}' in NiralScript expression`);
      }
      closers.pop();
      scanner.pos++;
    } else scanner.pos++;
  }
  if (closers.length) {
    scanner.error("NRS070", `Expected '${closers.at(-1).close}' in NiralScript expression`, {
      start: closers.at(-1).start,
    });
  }
  return scanner.src.slice(start, scanner.pos);
}

function skipString(scanner, quote) {
  const start = scanner.pos;
  scanner.pos++;
  while (!scanner.eof()) {
    const char = scanner.peek();
    if (char === "\\") scanner.pos += 2;
    else if (char === quote) {
      scanner.pos++;
      return;
    } else if (char === "\n") return;
    else scanner.pos++;
  }
  scanner.error("NRS012", "String literal is never closed", { start });
}

function skipTemplate(scanner) {
  const start = scanner.pos;
  scanner.pos++;
  while (!scanner.eof()) {
    const char = scanner.peek();
    if (char === "\\") scanner.pos += 2;
    else if (char === "`") {
      scanner.pos++;
      return;
    } else if (char === "$" && scanner.peek(1) === "{") {
      scanner.pos += 2;
      let depth = 1;
      while (!scanner.eof() && depth > 0) {
        const inner = scanner.peek();
        if (inner === '"' || inner === "'") skipString(scanner, inner);
        else if (inner === "`") skipTemplate(scanner);
        else if (scanner.startsWith("//")) scanner.readUntil("\n");
        else if (scanner.startsWith("/*")) skipBlockComment(scanner);
        else {
          if (inner === "{") depth++;
          else if (inner === "}") depth--;
          scanner.pos++;
        }
      }
    } else scanner.pos++;
  }
  scanner.error("NRS013", "Template literal is never closed", { start });
}

function skipBlockComment(scanner) {
  const start = scanner.pos;
  scanner.pos += 2;
  while (!scanner.eof() && !scanner.startsWith("*/")) scanner.pos++;
  if (scanner.eof()) scanner.error("NRS014", "Block comment is never closed", { start });
  scanner.pos += 2;
}
