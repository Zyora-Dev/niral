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
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../check/check.js";

export function startLsp({ input = process.stdin, output = process.stdout } = {}) {
  const docs = new Map(); // uri → text
  let buf = Buffer.alloc(0);
  let typeTimer;
  let workspaceRoots = [];

  function projectRoot(filename) {
    for (let directory = dirname(filename); ; directory = dirname(directory)) {
      if (workspaceRoots.includes(directory) || ["tsconfig.json", "package.json", "routes", ".niral"].some((name) => existsSync(join(directory, name)))) return directory;
      if (dirname(directory) === directory) return null;
    }
  }

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

  function scheduleTypes() {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => {
      const documents = new Map();
      const projects = new Map();
      for (const [uri, text] of docs) {
        if (!uri.startsWith("file:")) continue;
        const filename = fileURLToPath(uri);
        documents.set(filename, text);
        const root = projectRoot(filename);
        if (root) projects.set(root, []);
      }
      for (const root of projects.keys()) {
        const localDocuments = new Map([...documents].filter(([filename]) => filename.startsWith(root + sep)));
        try {
          projects.set(root, check({ root, documents: localDocuments }).errors);
        } catch (error) {
          if (!String(error.message).startsWith("TypeScript compiler not found")) {
            notify("window/logMessage", { type: 1, message: `Niral type checking: ${error.message}` });
          }
        }
      }
      for (const [uri, text] of docs) {
        if (!uri.startsWith("file:")) continue;
        const filename = fileURLToPath(uri);
        const diagnostics = validate(text, filename);
        if (!diagnostics.length) {
          for (const error of projects.get(projectRoot(filename)) ?? []) {
            if (error.file !== filename) continue;
            const start = { line: Math.max(0, error.line - 1), character: Math.max(0, error.col - 1) };
            diagnostics.push({
              range: { start, end: { ...start, character: start.character + 1 } },
              severity: 1, source: "niral", code: error.code, message: error.message,
            });
          }
        }
        notify("textDocument/publishDiagnostics", { uri, diagnostics });
      }
    }, 150);
    typeTimer.unref?.();
  }

  function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
      case "initialize":
        workspaceRoots = (params?.workspaceFolders?.map((folder) => folder.uri) ?? (params?.rootUri ? [params.rootUri] : []))
          .filter((uri) => uri.startsWith("file:")).map((uri) => fileURLToPath(uri));
        if (!workspaceRoots.length && params?.rootPath) workspaceRoots = [resolve(params.rootPath)];
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
        clearTimeout(typeTimer);
        return respond(id, null);
      case "exit":
        process.exit(0);
        return;

      case "textDocument/didOpen": {
        const { uri, text } = params.textDocument;
        docs.set(uri, text);
        scheduleTypes();
        return publishDiagnostics(uri);
      }
      case "textDocument/didChange": {
        const { uri } = params.textDocument;
        const change = params.contentChanges?.[params.contentChanges.length - 1];
        if (change) docs.set(uri, change.text); // full sync
        scheduleTypes();
        return publishDiagnostics(uri);
      }
      case "textDocument/didClose": {
        const { uri } = params.textDocument;
        docs.delete(uri);
        scheduleTypes();
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

  return { docs, dispose: () => clearTimeout(typeTimer) };
}
