import { checkNiralScript } from "./check.js";
import { decoratorExpressions } from "./analysis.js";
import { sourceLocation } from "./errors.js";

// Serialized into the module only when a decorator is present, so undecorated output is unchanged.
const DECORATE = `const __decorate = (decorators, members, value, name) => {
for (const [name, kind, isStatic, list] of members) {
const target = isStatic ? value : value.prototype;
const descriptor = Object.getOwnPropertyDescriptor(target, name);
const slot = kind === "get" || kind === "set" ? kind : "value";
let current = descriptor[slot];
for (let index = list.length - 1; index >= 0; index--) {
const replacement = list[index](current, { kind, name, static: isStatic });
if (replacement !== undefined) current = replacement;
}
descriptor[slot] = current;
Object.defineProperty(target, name, descriptor);
}
for (let index = decorators.length - 1; index >= 0; index--) {
const replacement = decorators[index](value, { kind: "class", name, static: false });
if (replacement !== undefined) value = replacement;
}
return value;
};
`;

function createRuntime() {
  let revision = 0;
  return {
    signal(value) {
      return { get: () => value, set(next) { if (!Object.is(value, next)) { value = next; revision++; } } };
    },
    derived(compute) {
      let stamp = -1;
      let value;
      let running = false;
      return { get() {
        if (running) throw new Error("Reactive dependency cycle");
        if (stamp !== revision) {
          running = true;
          try { value = compute(); stamp = revision; } finally { running = false; }
        }
        return value;
      } };
    },
  };
}

// Serialized per member so modules only carry the reactive primitives they use.
const RUNTIME = createRuntime();

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(value) {
  let remaining = value < 0 ? -value * 2 + 1 : value * 2;
  let encoded = "";
  do {
    let digit = remaining % 32;
    remaining = Math.floor(remaining / 32);
    if (remaining) digit += 32;
    encoded += BASE64[digit];
  } while (remaining);
  return encoded;
}

const DERIVATION_BUDGET = 16;
// Duplicating a cheap derive at its reference sites removes a cell hop per read; the
// cap keeps the bytes that buys bounded when a derive is read from many places.
const INLINE_BUDGET = 48;

// A derive whose initializer is a short operator/property expression over non-derived
// bindings recomputes faster than a revision-stamped cell reads, so it skips the cache.
function cheapDerivation(node, references, budget = { left: DERIVATION_BUDGET }) {
  if (!node || budget.left-- <= 0) return false;
  switch (node.type) {
    case "Literal": return true;
    case "Identifier": return references.get(node)?.kind !== "derive";
    case "ParenthesizedExpression":
    case "CastExpression": return cheapDerivation(node.expression, references, budget);
    case "UnaryExpression": return cheapDerivation(node.argument, references, budget);
    case "BinaryExpression":
    case "LogicalExpression": return cheapDerivation(node.left, references, budget) && cheapDerivation(node.right, references, budget);
    case "ConditionalExpression": return [node.test, node.consequent, node.alternate].every(child => cheapDerivation(child, references, budget));
    case "MemberExpression": return !node.optional && cheapDerivation(node.object, references, budget) && (!node.computed || cheapDerivation(node.property, references, budget));
    default: return false;
  }
}

// Nodes the initializer spends, or null when it is not cheap.
function derivationCost(node, references) {
  const budget = { left: DERIVATION_BUDGET };
  return cheapDerivation(node, references, budget) ? DERIVATION_BUDGET - budget.left : null;
}

export function compileNiralScript(source, filename = "entry.nrs", options = {}) {
  const { program, analysis } = checkNiralScript(source, filename, options);
  const sources = program.sources ?? [{ filename, source, start: 0, end: source.length }];
  const lineOffsets = sources.map(input => {
    const offsets = [0];
    for (let offset = 0; offset < input.source.length; offset++) if (input.source[offset] === "\n") offsets.push(offset + 1);
    return offsets;
  });
  const references = analysis.resolved;
  const declarations = new Map(analysis.bindings.map(binding => [binding.id.start, binding]));
  const reads = new Map();
  for (const { binding } of analysis.references) reads.set(binding, (reads.get(binding) ?? 0) + 1);
  const cheap = new Set();
  const inlined = new Map();
  for (const binding of analysis.bindings) {
    if (binding.kind !== "derive") continue;
    const node = analysis.declarations.get(binding);
    const cost = node && derivationCost(node.init, references);
    if (cost == null) continue;
    cheap.add(node);
    // One copy replaces the declaration, so only the extra reference sites cost bytes.
    const copies = (reads.get(binding) ?? 0) + 1;
    if ((copies - 1) * cost <= INLINE_BUDGET) inlined.set(binding, node.init);
  }
  const identifier = binding => binding.kind === "global" ? `__globals[${JSON.stringify(binding.name)}]` : `__binding${binding.index}`;
  const reactive = binding => ["state", "derive", "input"].includes(binding?.kind);
  let code = "";
  let column = 0;
  let previousColumn = 0;
  let previousSource = 0;
  let previousLine = 0;
  let previousOriginalColumn = 0;
  const mappings = [[]];
  function write(text, node) {
    if (node) {
      const location = sourceLocation(program, node);
      const sourceIndex = sources.findIndex(input => input.filename === location.filename);
      const offsets = lineOffsets[sourceIndex];
      let low = 0;
      let high = offsets.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (offsets[middle] <= location.start) low = middle;
        else high = middle;
      }
      const line = low;
      const originalColumn = location.start - offsets[line];
      mappings.at(-1).push([column - previousColumn, sourceIndex - previousSource, line - previousLine, originalColumn - previousOriginalColumn].map(vlq).join(""));
      previousColumn = column;
      previousSource = sourceIndex;
      previousLine = line;
      previousOriginalColumn = originalColumn;
    }
    code += text;
    const lines = text.split("\n");
    if (lines.length > 1) {
      for (let index = 1; index < lines.length; index++) mappings.push([]);
      column = lines.at(-1).length;
      previousColumn = 0;
    } else column += text.length;
  }
  function joined(nodes, separator = ", ") {
    nodes.forEach((node, index) => { if (index) write(separator); emit(node); });
  }
  function emit(node, terminate = true) {
    if (!node) return;
    switch (node.type) {
      case "Identifier": {
        const binding = references.get(node) ?? declarations.get(node.start);
        // Every inlinable initializer emits as a self-delimited expression, so no wrapper is needed.
        if (references.has(node) && inlined.has(binding)) { emit(inlined.get(binding)); break; }
        write(identifier(binding) + (references.has(node) && reactive(binding) ? ".get()" : ""), node);
        break;
      }
      case "Literal": write(typeof node.value === "number" ? `(${String(node.value)})` : JSON.stringify(node.value), node); break;
      case "Program": joined(node.body, "\n"); break;
      case "ImportDeclaration":
      case "TypeAliasDeclaration":
      case "InterfaceDeclaration": break;
      case "InputDeclaration":
        write("const ", node); emit(node.id); write(` = __runtime.signal(__inputs[${JSON.stringify(node.id.name)}]);\n`);
        write(`__inputCells[${JSON.stringify(node.id.name)}] = `); emit(node.id); write(";"); break;
      case "StateDeclaration":
      case "DerivedDeclaration": {
        if (inlined.has(declarations.get(node.id.start))) break;
        write("const ", node); emit(node.id);
        if (node.type === "StateDeclaration") { write(" = __runtime.signal("); emit(node.init); write(");"); break; }
        write(cheap.has(node) ? " = { get: () => (" : " = __runtime.derived(() => (");
        emit(node.init); write(cheap.has(node) ? ") };" : "));"); break;
      }
      case "VariableDeclaration":
        write(node.kind + " ", node); emit(node.id); write(" = "); emit(node.init); if (terminate) write(";"); break;
      case "FunctionDeclaration":
        write(node.async ? "async function " : "function ", node); emit(node.id); write("("); joined(node.params); write(") "); emit(node.body); break;
      case "ClassDeclaration":
      case "ClassExpression": {
        write("class", node);
        if (node.id) { write(" "); emit(node.id); }
        if (node.superClass) { write(" extends "); emit(node.superClass); }
        write(" {\n"); joined(node.members, "\n"); write("\n}");
        const classDecorators = node.decorators ?? [];
        const decoratedMembers = node.members.filter(member => member.decorators?.length);
        if (!classDecorators.length && !decoratedMembers.length) break;
        write(";\n");
        if (classDecorators.length) { emit(node.id); write(" = "); }
        write("__decorate([");
        joined(classDecorators.map(decorator => decorator.expression));
        write("], [");
        decoratedMembers.forEach((member, index) => {
          if (index) write(", ");
          write(`[${JSON.stringify(member.key.name)}, ${JSON.stringify(member.type === "PropertyDefinition" ? "field" : member.kind)}, ${member.static}, [`);
          joined(member.decorators.map(decorator => decorator.expression));
          write("]]");
        });
        write("], "); emit(node.id); write(`, ${JSON.stringify(node.id.name)});`);
        break;
      }
      case "MethodDefinition":
        write((node.static ? "static " : "") + (node.async ? "async " : "") + (["get", "set"].includes(node.kind) ? node.kind + " " : "") + (node.key.name.startsWith("#") ? node.key.name : JSON.stringify(node.key.name)), node);
        write("("); joined(node.params); write(") "); emit(node.body); break;
      case "PropertyDefinition":
        write((node.static ? "static " : "") + (node.key.name.startsWith("#") ? node.key.name : JSON.stringify(node.key.name)), node);
        if (node.value) { write(" = "); emit(node.value); } write(";"); break;
      case "ThisExpression": write("this", node); break;
      case "StaticBlock": write("static ", node); emit(node.body); break;
      case "Super": write("super", node); break;
      case "ArrowFunctionExpression":
        write(node.async ? "(async (" : "((", node); joined(node.params); write(") => ");
        if (node.body.type === "BlockStatement") emit(node.body);
        else { write("("); emit(node.body); write(")"); }
        write(")"); break;
      case "BlockStatement": write("{\n", node); joined(node.body, "\n"); write("\n}"); break;
      case "ForOfStatement":
        write(`for (${node.kind} `, node); emit(node.id); write(" of "); emit(node.right); write(") "); emit(node.body); break;
      case "ForStatement":
        write("for (", node); emit(node.init, false); write("; "); emit(node.test); write("; "); emit(node.update, false); write(") "); emit(node.body); break;
      case "WhileStatement":
        write("while (", node); emit(node.test); write(") "); emit(node.body); break;
      case "BreakStatement": write("break;", node); break;
      case "ContinueStatement": write("continue;", node); break;
      case "IfStatement":
        write("if (", node); emit(node.test); write(") "); emit(node.consequent);
        if (node.alternate) { write(" else "); emit(node.alternate); } break;
      case "ReturnStatement":
      case "ThrowStatement":
        write(node.type === "ReturnStatement" ? "return" : "throw", node);
        if (node.argument) { write(" ("); emit(node.argument); write(")"); } write(";"); break;
      case "TryStatement":
        write("try ", node); emit(node.block);
        if (node.handler) { write(" "); emit(node.handler); }
        if (node.finalizer) { write(" finally "); emit(node.finalizer); } break;
      case "CatchClause":
        write("catch", node); if (node.param) { write(" ("); emit(node.param); write(")"); } write(" "); emit(node.body); break;
      case "AssignmentStatement": {
        const binding = references.get(node.left);
        if (binding?.kind === "state") {
          write(identifier(binding) + ".set(", node);
          if (node.operator !== "=") write((node.update ? "+" : "") + identifier(binding) + ".get() " + node.operator.slice(0, -1) + " (");
          emit(node.right); write(node.operator === "=" ? ")" : "))");
        } else if (node.update) { emit(node.left); write(node.operator === "+=" ? "++" : "--"); }
        else { emit(node.left); write(" " + node.operator + " "); emit(node.right); }
        if (terminate) write(";");
        break;
      }
      case "ExpressionStatement": emit(node.expression); if (terminate) write(";"); break;
      case "ParenthesizedExpression": write("(", node); emit(node.expression); write(")"); break;
      case "UnaryExpression":
      case "AwaitExpression": write("(" + (node.type === "AwaitExpression" ? "await " : node.operator + " "), node); emit(node.argument); write(")"); break;
      case "BinaryExpression":
      case "LogicalExpression": write("(", node); emit(node.left); write(" " + node.operator + " "); emit(node.right); write(")"); break;
      case "ConditionalExpression": write("(", node); emit(node.test); write(" ? "); emit(node.consequent); write(" : "); emit(node.alternate); write(")"); break;
      case "MemberExpression":
        emit(node.object);
        if (node.computed) { write(node.optional ? "?.[" : "["); emit(node.property); write("]"); }
        else write((node.optional ? "?." : ".") + node.property.name, node.property);
        break;
      case "CallExpression": {
        // An inlined `a.b` in callee position would otherwise gain `a` as its receiver.
        const indirect = node.callee.type === "Identifier" && inlined.has(references.get(node.callee));
        if (indirect) write("(0, ");
        emit(node.callee);
        if (indirect) write(")");
        write(node.optional ? "?.(" : "("); joined(node.arguments); write(")"); break;
      }
      case "ContractExpression": write(analysis.contracts.get(node), node); write("("); emit(node.argument); write(")"); break;
      case "CastExpression": emit(node.expression); break;
      case "NewExpression": write("new (", node); emit(node.callee); write(")("); joined(node.arguments); write(")"); break;
      case "ArrayExpression":
      case "ArrayPattern": write("[", node); joined(node.elements); if (node.elements.at(-1) === null) write(","); write("]"); break;
      case "ObjectExpression":
      case "ObjectPattern": write("{", node); joined(node.properties); write("}"); break;
      case "Property": {
        const key = JSON.stringify(node.key.name ?? node.key.value);
        write((node.shorthand ? `[${key}]` : key) + ": ", node.key); emit(node.value); break;
      }
      case "AssignmentPattern": emit(node.left); write(" = "); emit(node.right); break;
      case "RestElement":
      case "SpreadElement": write("...", node); emit(node.argument); break;
      case "TemplateLiteral":
        write("`", node);
        node.quasis.forEach((quasi, index) => { write(quasi.value.raw, quasi); if (!quasi.tail) { write("${"); emit(node.expressions[index]); write("}"); } });
        write("`"); break;
      default: throw new TypeError(`Unsupported NiralScript node '${node.type}'`);
    }
  }
  const kinds = new Set(analysis.bindings.map(binding => binding.kind));
  const members = [];
  if (kinds.has("state") || kinds.has("input")) members.push("signal");
  if (analysis.bindings.some(binding => binding.kind === "derive" && !cheap.has(analysis.declarations.get(binding)))) members.push("derived");
  const hasInputs = kinds.has("input");
  if (members.length) write(`const __createRuntime = () => { let revision = 0; return {\n${members.map(name => RUNTIME[name].toString()).join(",\n")}\n}; };\n`);
  if (analysis.classes.some(node => decoratorExpressions(node).length)) write(DECORATE);
  write(`export ${analysis.topLevelAwait ? "async " : ""}function createInstance(__inputs = {}, __globals = {}, __runtime = ${members.length ? "__createRuntime()" : "null"}) {\n`);
  if (hasInputs) write("const __inputCells = Object.create(null);\n");
  for (const module of program.modules ?? []) { emit(module); write("\n"); }
  emit(program);
  write("\nconst values = Object.create(null);\nObject.defineProperties(values, {\n");
  const exposed = [...analysis.root.bindings];
  exposed.forEach(([name, binding], index) => {
    if (index) write(",\n");
    if (["function", "class", "const"].includes(binding.kind)) {
      write(`${JSON.stringify(name)}: { enumerable: true, value: ${identifier(binding)} }`);
      return;
    }
    if (inlined.has(binding)) {
      write(`${JSON.stringify(name)}: { enumerable: true, get: () => `);
      emit(inlined.get(binding));
      write(" }");
      return;
    }
    write(`${JSON.stringify(name)}: { enumerable: true, get: () => ${identifier(binding)}${reactive(binding) ? ".get()" : ""}`);
    if (binding.kind === "state") write(`, set: value => ${identifier(binding)}.set(value)`);
    write(" }");
  });
  write(`\n});\nreturn { values, updateInputs(${hasInputs ? "patch" : ""}) {${hasInputs ? " for (const name of Object.keys(patch)) { if (Object.hasOwn(__inputCells, name)) __inputCells[name].set(patch[name]); } " : ""}} };\n}\n`);
  return { code, topLevelAwait: analysis.topLevelAwait, map: { version: 3, file: options.file ?? "entry.mjs", sources: sources.map(input => input.filename), sourcesContent: sources.map(input => input.source), names: [], mappings: mappings.map(line => line.join(",")).join(";") } };
}