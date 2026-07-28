/**
 * Niral VS Code extension — a ZERO-DEPENDENCY LSP client.
 *
 * Spawns `niral lsp` (stdio) and bridges it to the VS Code API by hand:
 * diagnostics, completions and hover. No vscode-languageclient, no
 * node_modules — the extension is a single file, like the framework it
 * serves.
 */

const vscode = require("vscode");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

let proc = null;
let nextId = 1;
const pending = new Map(); // id → resolve
let diagnostics = null;

function findServer() {
  const configured = vscode.workspace.getConfiguration("niral").get("serverPath");
  if (configured && existsSync(configured)) return configured;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidates = [
      path.join(folder.uri.fsPath, "node_modules", "niral", "bin", "niral.js"),
      path.join(folder.uri.fsPath, "niral", "bin", "niral.js"),
      path.join(folder.uri.fsPath, "..", "niral", "bin", "niral.js"),
      path.join(folder.uri.fsPath, "bin", "niral.js"),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
  }
  return null;
}

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  proc.stdin.write(body);
}

function request(method, params) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, 3000);
  });
}

const notifyServer = (method, params) => send({ jsonrpc: "2.0", method, params });

function onServerMessage(msg) {
  if (msg.id !== undefined && pending.has(msg.id)) {
    const resolve = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg.result ?? null);
    return;
  }
  if (msg.method === "textDocument/publishDiagnostics") {
    const { uri, diagnostics: items } = msg.params;
    diagnostics.set(
      vscode.Uri.parse(uri),
      items.map((d) => {
        const range = new vscode.Range(
          d.range.start.line, d.range.start.character,
          d.range.end.line, d.range.end.character
        );
        const diag = new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Error);
        diag.source = d.source ?? "niral";
        if (d.code) diag.code = d.code;
        return diag;
      })
    );
  }
}

function attachReader(stream) {
  let buf = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const len = Number(buf.slice(0, headerEnd).toString("utf8").match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = headerEnd + 4;
      if (!Number.isFinite(len) || buf.length < start + len) return;
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      try {
        onServerMessage(JSON.parse(body));
      } catch {
        /* ignore malformed frames */
      }
    }
  });
}

function syncDoc(doc, isOpen) {
  if (doc.languageId !== "niral") return;
  const uri = doc.uri.toString();
  if (isOpen) {
    notifyServer("textDocument/didOpen", { textDocument: { uri, languageId: "niral", version: 1, text: doc.getText() } });
  } else {
    notifyServer("textDocument/didChange", {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text: doc.getText() }],
    });
  }
}

function activate(context) {
  const serverPath = findServer();
  diagnostics = vscode.languages.createDiagnosticCollection("niral");
  context.subscriptions.push(diagnostics);

  if (!serverPath) {
    vscode.window.showWarningMessage(
      "Niral: couldn't find the niral CLI — set `niral.serverPath` to <niral>/bin/niral.js for diagnostics & completions. (Syntax highlighting still works.)"
    );
    return;
  }

  proc = spawn(process.execPath, [serverPath, "lsp"], { stdio: ["pipe", "pipe", "inherit"] });
  attachReader(proc.stdout);
  request("initialize", { processId: process.pid, capabilities: {} }).then(() => notifyServer("initialized", {}));

  // document lifecycle → server
  for (const doc of vscode.workspace.textDocuments) syncDoc(doc, true);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => syncDoc(doc, true)),
    vscode.workspace.onDidChangeTextDocument((e) => syncDoc(e.document, false)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === "niral") {
        notifyServer("textDocument/didClose", { textDocument: { uri: doc.uri.toString() } });
      }
    })
  );

  // completions
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "niral",
      {
        async provideCompletionItems(doc, position) {
          const items = await request("textDocument/completion", {
            textDocument: { uri: doc.uri.toString() },
            position: { line: position.line, character: position.character },
          });
          return (items ?? []).map((it) => {
            const item = new vscode.CompletionItem(it.label, (it.kind ?? 1) - 1);
            item.detail = it.detail;
            if (it.insertTextFormat === 2) item.insertText = new vscode.SnippetString(it.insertText);
            else if (it.insertText) item.insertText = it.insertText;
            return item;
          });
        },
      },
      "{", "#", ":", "@", "$", "<", " "
    )
  );

  // hover
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("niral", {
      async provideHover(doc, position) {
        const res = await request("textDocument/hover", {
          textDocument: { uri: doc.uri.toString() },
          position: { line: position.line, character: position.character },
        });
        if (!res?.contents?.value) return null;
        return new vscode.Hover(new vscode.MarkdownString(res.contents.value));
      },
    })
  );
}

function deactivate() {
  try {
    proc?.kill();
  } catch {
    /* already gone */
  }
}

module.exports = { activate, deactivate };
