const assert = require("node:assert/strict");
const { writeFileSync, readFileSync } = require("node:fs");
const { basename, join, resolve } = require("node:path");
const vscode = require("vscode");

function waitForDiagnostics(uri, predicate) {
  return new Promise((accept, reject) => {
    const subscription = vscode.languages.onDidChangeDiagnostics(check);
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`Diagnostics timed out: ${uri.fsPath}: ${JSON.stringify(vscode.languages.getDiagnostics(uri))}`));
    }, 15000);
    function check() {
      const items = vscode.languages.getDiagnostics(uri).filter(item => item.source === "niralscript");
      if (!predicate(items)) return;
      clearTimeout(timer);
      subscription.dispose();
      accept(items);
    }
    check();
  });
}

async function replaceText(document, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

async function run() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root && basename(root).startsWith("niral-vscode-host-"), "Launch with an isolated niral-vscode-host-* workspace");
  await vscode.workspace.getConfiguration("niral").update("serverPath", resolve(__dirname, "../bin/niral.js"), vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration("niral").update("niralscriptStrictTypes", true, vscode.ConfigurationTarget.Workspace);
  const checks = [];
  const filename = join(root, "entry.nrs");
  const library = join(root, "math.nrs");
  const libraryText = "export function twice(value: number): number { return value * 2 }";
  writeFileSync(filename, 'state count: number = "wrong"');
  writeFileSync(library, libraryText);
  const document = await vscode.workspace.openTextDocument(filename);
  await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, "niralscript");
  const extension = vscode.extensions.getExtension("zyoralabs.niral-vscode");
  assert.ok(extension);
  await extension.activate();
  assert.equal(extension.isActive, true);
  checks.push("activation and .nrs registration");

  const diagnostics = await waitForDiagnostics(document.uri, items => items.some(item => item.code === "NRS080"));
  assert.equal(diagnostics[0].range.start.line, 0);
  assert.equal(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
  checks.push("compiler diagnostic code, range and severity");

  const source = 'import { twice as double } from "./math.nrs"\nstate count: number = 2\nfunction use(count: string): string { return count }\nconst result = double(count)';
  await replaceText(document, source);
  await waitForDiagnostics(document.uri, items => items.length === 0);
  const position = document.positionAt(source.lastIndexOf("double") + 1);
  const hover = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, position);
  assert.match(hover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n"), /twice\(value: number\): number/);
  const completions = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, position);
  const labels = completions.items.map(item => typeof item.label === "string" ? item.label : item.label.label);
  assert.ok(labels.includes("double"));
  assert.ok(labels.includes("state"));
  const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, position);
  assert.equal(definitions[0].uri.fsPath, library);
  assert.equal(definitions[0].range.start.character, 16);
  const local = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, document.positionAt(source.lastIndexOf("count") + 1));
  assert.equal(local[0].uri.fsPath, filename);
  assert.equal(local[0].range.start.line, 1);
  const shadowed = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, document.positionAt(source.indexOf("return count") + 8));
  assert.equal(shadowed[0].range.start.line, 2);
  checks.push("hover, completion, imported/local/shadowed definitions");

  const dependency = await vscode.workspace.openTextDocument(library);
  await replaceText(dependency, 'export function twice(value: number): number { return "bad" }');
  const imported = await waitForDiagnostics(document.uri, items => items.some(item => item.code === "NRS080"));
  assert.equal(imported[0].relatedInformation[0].location.uri.fsPath, library);
  assert.equal(dependency.isDirty, true);
  assert.equal(readFileSync(library, "utf8"), libraryText);
  await replaceText(dependency, libraryText);
  await waitForDiagnostics(document.uri, items => items.length === 0);
  checks.push("unsaved dependency diagnostics, related location and recovery");

  const types = join(root, "types.nrs");
  writeFileSync(types, 'export type Box<T> = { value: T }');
  const expanded = 'import type { Box } from "./types.nrs"\nfunction identity<T>(value: T): T { return value }\nconst box: Box<number> = { value: identity<number>(2) }\nfunction run(first: number = 1, ...items: number[]): number { let total: number = first; for (let index: number = 0; index < items.length; index++) { if (index === 1) { continue } total += items[index] } while (total > 10) { total--; break } return total }\nconst result = run(...[box.value, 3, 4])';
  await replaceText(document, expanded);
  await waitForDiagnostics(document.uri, items => items.length === 0);
  const typePosition = document.positionAt(expanded.indexOf('Box<number>') + 1);
  const typeHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, typePosition);
  assert.match(typeHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n"), /type Box<T>/);
  const typeDefinition = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, typePosition);
  assert.equal(typeDefinition[0].uri.fsPath, types);
  const expandedCompletions = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, typePosition);
  for (const label of ['Box', 'type', 'while', 'break', 'continue']) assert.ok(expandedCompletions.items.some(item => item.label === label), label);
  await replaceText(document, expanded.replace('identity<number>(2)', 'identity<number>("bad")'));
  await waitForDiagnostics(document.uri, items => items.some(item => item.code === 'NRS080'));
  await replaceText(document, expanded);
  await waitForDiagnostics(document.uri, items => items.length === 0);
  checks.push("generic types, defaults/rest, loops, type navigation and diagnostic recovery");
  await replaceText(document, 'function read(value: unknown): number { return value }');
  await waitForDiagnostics(document.uri, items => items.some(item => item.code === 'NRS080'));
  await replaceText(document, 'function read(value: unknown): number { if (typeof value === "number") { return value } return 0 }');
  await waitForDiagnostics(document.uri, items => items.length === 0);
  checks.push("strict setting and unknown narrowing");

  const classes = join(root, "classes.nrs");
  writeFileSync(classes, 'export class Box<T> { value: T; constructor(value: T) { this.value = value } read(): T { return this.value } }');
  const classSource = 'import { Box } from "./classes.nrs"\nconst box = new Box<number>(3)\nconst result = box.read()';
  await replaceText(document, classSource);
  await waitForDiagnostics(document.uri, items => items.length === 0);
  const memberPosition = document.positionAt(classSource.lastIndexOf("read") + 1);
  const memberHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, memberPosition);
  assert.match(memberHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n"), /read\(\): T/);
  const memberDefinitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, memberPosition);
  assert.equal(memberDefinitions[0].uri.fsPath, classes);
  const memberCompletions = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, memberPosition);
  assert.ok(memberCompletions.items.some(item => item.label === "read"));
  await replaceText(document, classSource.replace("(3)", '("bad")'));
  await waitForDiagnostics(document.uri, items => items.some(item => item.code === "NRS080"));
  await replaceText(document, classSource);
  await waitForDiagnostics(document.uri, items => items.length === 0);
  checks.push("imported generic classes, member navigation/completion and constructor diagnostics");

  await replaceText(document, "state ");
  const incomplete = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, document.positionAt(document.getText().length));
  assert.ok(incomplete.items.some(item => item.label === "derive"));
  checks.push("incomplete-source keyword completion");

  const component = await vscode.workspace.openTextDocument({ language: "niral", content: "<h1>Niral</h1>" });
  assert.equal(component.languageId, "niral");
  checks.push("existing .niral language registration");
  const result = { passed: true, vscode: vscode.version, host: process.version, checks };
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log("Niral Extension Host checks passed:", JSON.stringify(result));
}

module.exports = { run };