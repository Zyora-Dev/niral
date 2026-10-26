import { parseNiralScript } from "./parser.js";
import { NiralScriptError } from "./errors.js";

export function linkNiralScript(program, resolveModule) {
  if (!program.body.some(node => node.type === "ImportDeclaration")) return program;
  const loaded = new Map([[program.filename, program]]);
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  const targets = new Map();
  function fail(message, owner, node) {
    throw new NiralScriptError("NRS078", message, { source: owner.source, filename: owner.filename, start: node.start, end: node.end });
  }
  function visit(owner) {
    visiting.add(owner.filename);
    for (const node of owner.body) {
      if (owner !== program && node.type !== "ImportDeclaration" && node.type !== "FunctionDeclaration" && !(node.type === "VariableDeclaration" && node.kind === "const")) {
        fail("Library modules may only contain imports, constants and functions", owner, node);
      }
      if (node.type !== "ImportDeclaration") continue;
      if (!resolveModule) fail("Module imports require a module resolver", owner, node);
      const input = resolveModule(node.source.value, owner.filename, { source: owner.source, filename: owner.filename, start: node.source.start, end: node.source.end });
      if (!input || typeof input.filename !== "string" || typeof input.source !== "string") fail("Module resolver must return a filename and source", owner, node.source);
      if (visiting.has(input.filename)) fail(`Module dependency cycle through '${input.filename}'`, owner, node.source);
      let dependency = loaded.get(input.filename);
      if (!dependency) {
        dependency = parseNiralScript(input.source, input.filename);
        loaded.set(input.filename, dependency);
      }
      targets.set(node, input.filename);
      if (!visited.has(input.filename)) visit(dependency);
    }
    visiting.delete(owner.filename);
    visited.add(owner.filename);
    ordered.push(owner);
  }
  visit(program);
  const sources = [];
  let combined = "";
  function shift(value, offset) {
    if (Array.isArray(value)) return value.map(child => shift(child, offset));
    if (!value || typeof value !== "object") return value;
    const copy = {};
    for (const [key, child] of Object.entries(value)) copy[key] = (key === "start" || key === "end") && typeof child === "number" ? child + offset : shift(child, offset);
    if (targets.has(value)) copy.target = targets.get(value);
    return copy;
  }
  const modules = ordered.map(owner => {
    const start = combined.length;
    combined += owner.source + "\n";
    sources.push({ filename: owner.filename, source: owner.source, start, end: start + owner.source.length });
    return shift(owner, start);
  });
  const entry = modules.pop();
  return { ...entry, source: combined, modules, sources };
}