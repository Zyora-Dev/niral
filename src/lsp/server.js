/**
 * Niral LSP — the language server (`niral lsp`).
 *
 * A hand-rolled Language Server Protocol implementation over stdio —
 * JSON-RPC 2.0 with Content-Length framing, Node stdlib only, like
 * everything else here. Works with any LSP client: VS Code (see
 * editors/vscode), Neovim, Zed, Helix, …
 *
 * Capabilities:
 *   • diagnostics — the compiler's teaching errors as squiggles (live)
 *   • completions — blocks, runes, directives, tags, server-fn names
 *   • hover       — docs for every Niral concept under the cursor
 */

import { validate, completions, hover, positionToOffset } from "./analysis.js";

export function startLsp({ input = process.stdin, output = process.stdout } = {}) {
  const docs = new Map(); // uri → text
  let buf = Buffer.alloc(0);

  function write(msg) {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    output.write(`Content-Length: ${body.length}\r\n\r\n`);
    output.write(body);
  }
  const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
  const respondError = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });
  const notify = (method, params) => write({ jsonrpc: "2.0", method, params });

  function publishDiagnostics(uri) {
    const text = docs.get(uri);
    if (text == null) return;
    const filename = uri.split("/").pop() ?? "file.niral";
    notify("textDocument/publishDiagnostics", { uri, diagnostics: validate(text, filename) });
  }

  function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
      case "initialize":
        return respond(id, {
          capabilities: {
            textDocumentSync: 1, // full document sync
            completionProvider: { triggerCharacters: ["{", "#", ":", "@", "$", "<", " "] },
            hoverProvider: true,
          },
          serverInfo: { name: "niral", version: "0.1.0" },
        });
      case "initialized":
        return;
      case "shutdown":
        return respond(id, null);
      case "exit":
        process.exit(0);
        return;

      case "textDocument/didOpen": {
        const { uri, text } = params.textDocument;
        docs.set(uri, text);
        return publishDiagnostics(uri);
      }
      case "textDocument/didChange": {
        const { uri } = params.textDocument;
        const change = params.contentChanges?.[params.contentChanges.length - 1];
        if (change) docs.set(uri, change.text); // full sync
        return publishDiagnostics(uri);
      }
      case "textDocument/didClose": {
        const { uri } = params.textDocument;
        docs.delete(uri);
        return notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
      }

      case "textDocument/completion": {
        const text = docs.get(params.textDocument.uri);
        if (text == null) return respond(id, []);
        const offset = positionToOffset(text, params.position);
        return respond(id, completions(text, offset));
      }
      case "textDocument/hover": {
        const text = docs.get(params.textDocument.uri);
        if (text == null) return respond(id, null);
        const offset = positionToOffset(text, params.position);
        const md = hover(text, offset);
        return respond(id, md ? { contents: { kind: "markdown", value: md } } : null);
      }

      default:
        // be a good citizen: answer unknown REQUESTS (they have an id)
        if (id !== undefined) return respondError(id, -32601, `method not found: ${method}`);
    }
  }

  input.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const len = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(len)) {
        buf = buf.slice(headerEnd + 4); // malformed — skip the header
        continue;
      }
      const start = headerEnd + 4;
      if (buf.length < start + len) return; // body not fully arrived yet
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      try {
        handle(msg);
      } catch (e) {
        if (msg.id !== undefined) respondError(msg.id, -32603, String(e?.message ?? e));
      }
    }
  });

  return { docs };
}
