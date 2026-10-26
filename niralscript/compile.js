import { checkNiralScript } from "./check.js";
import { sourceLocation } from "./errors.js";

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
  function emit(node) {
    if (!node) return;
    switch (node.type) {
      case "Identifier": {
        const binding = references.get(node) ?? declarations.get(node.start);
        write(identifier(binding) + (references.has(node) && reactive(binding) ? ".get()" : ""), node);
        break;
      }
      case "Literal": write(typeof node.value === "number" ? `(${String(node.value)})` : JSON.stringify(node.value), node); break;
      case "Program": joined(node.body, "\n"); break;
      case "ImportDeclaration": break;
      case "InputDeclaration":
        write("const ", node); emit(node.id); write(` = __runtime.signal(__inputs[${JSON.stringify(node.id.name)}]);\n`);
        write(`__inputCells[${JSON.stringify(node.id.name)}] = `); emit(node.id); write(";"); break;
      case "StateDeclaration":
      case "DerivedDeclaration":
        write("const ", node); emit(node.id);
        write(node.type === "StateDeclaration" ? " = __runtime.signal(" : " = __runtime.derived(() => (");
        emit(node.init); write(node.type === "StateDeclaration" ? ");" : "));"); break;
      case "VariableDeclaration":
        write(node.kind + " ", node); emit(node.id); write(" = "); emit(node.init); write(";"); break;
      case "FunctionDeclaration":
        write(node.async ? "async function " : "function ", node); emit(node.id); write("("); joined(node.params); write(") "); emit(node.body); break;
      case "ArrowFunctionExpression":
        write(node.async ? "(async (" : "((", node); joined(node.params); write(") => ");
        if (node.body.type === "BlockStatement") emit(node.body);
        else { write("("); emit(node.body); write(")"); }
        write(")"); break;
      case "BlockStatement": write("{\n", node); joined(node.body, "\n"); write("\n}"); break;
      case "ForOfStatement":
        write(`for (${node.kind} `, node); emit(node.id); write(" of "); emit(node.right); write(") "); emit(node.body); break;
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
          if (node.operator !== "=") write(identifier(binding) + ".get() " + node.operator.slice(0, -1) + " (");
          emit(node.right); write(node.operator === "=" ? ");" : "));");
        } else { emit(node.left); write(" " + node.operator + " "); emit(node.right); write(";"); }
        break;
      }
      case "ExpressionStatement": emit(node.expression); write(";"); break;
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
      case "CallExpression": emit(node.callee); write(node.optional ? "?.(" : "("); joined(node.arguments); write(")"); break;
      case "ArrayExpression":
      case "ArrayPattern": write("[", node); joined(node.elements); write("]"); break;
      case "ObjectExpression":
      case "ObjectPattern": write("{", node); joined(node.properties); write("}"); break;
      case "Property": {
        const key = JSON.stringify(node.key.name ?? node.key.value);
        write((node.shorthand ? `[${key}]` : key) + ": ", node.key); emit(node.value); break;
      }
      case "SpreadElement": write("...", node); emit(node.argument); break;
      case "TemplateLiteral":
        write("`", node);
        node.quasis.forEach((quasi, index) => { write(quasi.value.raw, quasi); if (!quasi.tail) { write("${"); emit(node.expressions[index]); write("}"); } });
        write("`"); break;
      default: throw new TypeError(`Unsupported NiralScript node '${node.type}'`);
    }
  }
  write(`const __createRuntime = ${createRuntime.toString()};\nexport function createInstance(__inputs = {}, __globals = {}, __runtime = __createRuntime()) {\nconst __inputCells = Object.create(null);\n`);
  for (const module of program.modules ?? []) { emit(module); write("\n"); }
  emit(program);
  write("\nconst values = Object.create(null);\nObject.defineProperties(values, {\n");
  const exposed = [...analysis.root.bindings];
  exposed.forEach(([name, binding], index) => {
    if (index) write(",\n");
    write(`${JSON.stringify(name)}: { enumerable: true, get: () => ${identifier(binding)}${reactive(binding) ? ".get()" : ""}`);
    if (binding.kind === "state") write(`, set: value => ${identifier(binding)}.set(value)`);
    write(" }");
  });
  write("\n});\nreturn { values, updateInputs(patch) { for (const name of Object.keys(patch)) { if (Object.hasOwn(__inputCells, name)) __inputCells[name].set(patch[name]); } } };\n}\n");
  return { code, map: { version: 3, file: options.file ?? "entry.mjs", sources: sources.map(input => input.filename), sourcesContent: sources.map(input => input.source), names: [], mappings: mappings.map(line => line.join(",")).join(";") } };
}