export function sourceLocation(program, node) {
  const owner = program.sources?.find(source => node.start >= source.start && node.start <= source.end);
  return owner
    ? { source: owner.source, filename: owner.filename, start: node.start - owner.start, end: node.end - owner.start }
    : { source: program.source, filename: program.filename, start: node.start, end: node.end };
}

export class NiralScriptError extends Error {
  constructor(code, message, { source, filename, start, end, hint }) {
    super(message);
    this.name = "NiralScriptError";
    this.code = code;
    this.source = source;
    this.filename = filename;
    this.start = start;
    this.end = end;
    this.hint = hint ?? null;
    this.line = 1;
    let lineStart = 0;
    for (let offset = 0; offset < start && offset < source.length; offset++) {
      if (source[offset] === "\n") {
        this.line++;
        lineStart = offset + 1;
      }
    }
    this.col = start - lineStart + 1;
  }
}
