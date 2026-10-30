import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { isPrivatePath, isServableFile } from "../server/security.js";
import { parseNiralScript as parseLanguage, analyzeNiralScript, NiralScriptError } from "../../niralscript/parser.js";
import { linkNiralScript } from "../../niralscript/modules.js";
import { sourceLocation } from "../../niralscript/errors.js";
import { typeAnnotations, walk, hasTypeSyntax } from "../../niralscript/types.js";
import { NiralError } from "./errors.js";

export function loadNiralScriptSource(script, componentSource, options) {
  if (!Object.hasOwn(script.attrs, "src")) return null;
  const location = {
    source: componentSource, filename: options.filename, start: script.start, end: script.end,
  };
  if (script.code.trim()) throw new NiralError("NIRAL077", "An external NiralScript block cannot contain inline code", location);
  return readNiralScriptSource(script.attrs.src, options.sourceFile ?? options.filename, options, location);
}

function readNiralScriptSource(specifier, importer, options, location) {
  const fail = message => { throw new NiralError("NIRAL077", message, location); };
  if (typeof specifier !== "string" || !/^\.\.?\//.test(specifier) || !specifier.endsWith(".nrs") || /[\\?#%:\x00-\x1f\x7f]/.test(specifier)) {
    fail("NiralScript sources must be explicit relative .nrs file paths");
  }
  if (!options.root || !importer) fail("External NiralScript requires a project root and importer filename");
  const root = resolve(options.root);
  const component = resolve(root, importer);
  const filename = resolve(dirname(component), specifier);
  if (!isServableFile(root, component) || !isServableFile(root, filename) || isPrivatePath(relative(root, filename), { allowNiralScript: true })) {
    fail("NiralScript src must be an existing non-private file inside the project, without symlinks");
  }
  const input = { filename, source: readFileSync(filename, "utf8") };
  options.onSource?.(input);
  return input;
}

export function parseNiralScript(code, filename = "<anonymous>") {
  try {
    return parseLanguage(code, filename);
  } catch (error) {
    if (!(error instanceof NiralScriptError)) throw error;
    throw new NiralError(error.code.replace(/^NRS/, "NIRAL"), error.message, error);
  }
}

const GLOBALS = "undefined NaN Infinity Math JSON Object Array String Number Boolean Date RegExp Map Set WeakMap WeakSet BigInt Symbol Promise Error TypeError RangeError parseInt parseFloat isNaN isFinite encodeURI encodeURIComponent decodeURI decodeURIComponent console globalThis window document navigator location history localStorage sessionStorage performance fetch URL URLSearchParams setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame cancelAnimationFrame live t process".split(" ");

export function emitNiralScript(program, options = {}) {
  return emitProgram(program, options, false).code;
}

function emitProgram(program, options, direct) {
  const pureGlobals = ["Number", "String", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "Number.isFinite", "Number.isInteger", "Number.isNaN", "Array.isArray",
    ..."abs ceil floor round trunc max min pow sqrt cbrt sign exp log log2 log10 sin cos tan asin acos atan atan2 hypot".split(" ").map(name => `Math.${name}`)];
  const pureMethods = {
    array: ["slice", "concat", "includes", "indexOf", "lastIndexOf", "join", "at", "map", "filter", "find", "findIndex", "some", "every", "forEach", "reduce"],
    string: ["slice", "substring", "includes", "indexOf", "lastIndexOf", "startsWith", "endsWith", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "charAt", "charCodeAt", "at", "split"],
  };
  const analysis = analyzeNiralScript(program, { globals: [...GLOBALS, ...(options.globals ?? [])], moduleGlobals: GLOBALS, reserved: options.reserved, pureGlobals, pureMethods, strictTypes: options.strictTypes });
  const processReference = analysis.references.find(reference => reference.binding.kind === "global" && reference.binding.name === "process");
  if (processReference) throw new NiralError("NIRAL044", "process is server-only; client code cannot read environment variables", sourceLocation(program, processReference.node));
  const typed = hasTypeSyntax(program);
  const edits = typed ? typeAnnotations(program).map(node => ({ start: node.start, end: node.end, text: "" })) : [];
  const references = new Map();
  const signals = new Set();
  const writable = new Set();
  const props = new Set();
  function name(binding) {
    return binding.scope && binding.scope !== analysis.root ? `__nrs${binding.index}` : binding.name;
  }
  for (const binding of analysis.bindings) {
    if (binding.scope !== analysis.root) edits.push({ start: binding.id.start, end: binding.id.end, text: (binding.shorthand ? `${binding.name}: ` : "") + name(binding) });
    if (binding.kind === "state" || binding.kind === "derive") signals.add(binding.name);
    if (binding.kind === "state") writable.add(binding.name);
    if (binding.kind === "input") props.add(binding.name);
  }
  for (const { node, binding, shorthand, localName } of analysis.references) {
    if (direct) references.set(node.start, binding);
    const read = name(binding) + (direct && ["state", "derive", "input"].includes(binding.kind) ? ".get()" : "");
    if (read !== localName) edits.push({ start: node.start, end: node.end, text: (shorthand ? `${localName}: ` : "") + read });
  }
  edits.sort((left, right) => left.start - right.start);

  function source(node) {
    let output = "";
    let cursor = node.start;
    let low = 0;
    let high = edits.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (edits[middle].start < node.start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < edits.length && edits[index].start < node.end; index++) {
      const edit = edits[index];
      if (edit.start < cursor) continue;
      if (edit.end > node.end) continue;
      output += program.source.slice(cursor, edit.start) + edit.text;
      cursor = edit.end;
    }
    return output + program.source.slice(cursor, node.end);
  }

  function body(node, start, end) {
    let output = "";
    let cursor = start;
    for (const statement of node.body) {
      output += program.source.slice(cursor, statement.start) + emit(statement);
      cursor = statement.end;
    }
    return output + program.source.slice(cursor, end);
  }

  function emit(node) {
    switch (node.type) {
      case "TypeAliasDeclaration": return "";
      case "InterfaceDeclaration": return "";
      case "ImportDeclaration":
        if (node.typeOnly) return "";
        return node.specifiers.filter(specifier => analysis.imports.get(specifier).scope === analysis.root)
          .map(specifier => `const ${specifier.local.name} = ${name(analysis.imports.get(specifier).binding)};`).join("\n");
      case "Program":
        return body(node, node.start, node.end);
      case "InputDeclaration":
        return direct
          ? `const ${source(node.id)} = { get: __n.prop(__props, ${JSON.stringify(node.id.name)}).get };`
          : `const { ${source(node.id)} } = $props;`;
      case "StateDeclaration":
      case "DerivedDeclaration":
        if (direct) {
          const init = source(node.init);
          return node.type === "StateDeclaration"
            ? `const ${source(node.id)} = __n.signal(${init}\n);`
            : `const ${source(node.id)} = __n.derived(() => (${init}\n));`;
        }
        return `let ${source(node.id)} = $${node.type === "StateDeclaration" ? "state" : "derived"}(${source(node.init)}\n);`;
      case "VariableDeclaration":
        return `${node.kind} ${source(node.id)} = (${source(node.init)}\n);`;
      case "FunctionDeclaration":
        return `${node.async ? "async " : ""}function ${source(node.id)}(${node.params.map(source).join(", ")}) ${emit(node.body)}`;
      case "ClassDeclaration":
      case "ClassExpression":
        return `class${node.id ? " " + source(node.id) : ""}${node.superClass ? " extends " + source(node.superClass) : ""} {\n${node.members.map(emit).join("\n")}\n}`;
      case "MethodDefinition":
        return `${node.static ? "static " : ""}${node.async ? "async " : ""}${["get", "set"].includes(node.kind) ? node.kind + " " : ""}${node.key.name.startsWith("#") ? node.key.name : JSON.stringify(node.key.name)}(${node.params.map(source).join(", ")}) ${emit(node.body)}`;
      case "PropertyDefinition":
        return `${node.static ? "static " : ""}${node.key.name.startsWith("#") ? node.key.name : JSON.stringify(node.key.name)}${node.value ? " = " + source(node.value) : ""};`;
      case "StaticBlock": return `static ${emit(node.body)}`;
      case "BlockStatement":
        return `{${body(node, node.start + 1, node.end - 1)}}`;
      case "ForOfStatement":
        return `for (${node.kind} ${source(node.id)} of ${source(node.right)}\n) ${emit(node.body)}`;
      case "ForStatement":
        return `for (${node.init ? emit(node.init).replace(/;$/, "") : ""}; ${node.test ? source(node.test) : ""}; ${node.update ? emit(node.update).replace(/;$/, "") : ""}) ${emit(node.body)}`;
      case "WhileStatement":
        return `while (${source(node.test)}\n) ${emit(node.body)}`;
      case "BreakStatement": return "break;";
      case "ContinueStatement": return "continue;";
      case "IfStatement":
        return `if (${source(node.test)}\n) ${emit(node.consequent)}${node.alternate ? " else " + emit(node.alternate) : ""}`;
      case "ReturnStatement":
        return node.argument ? `return (${source(node.argument)}\n);` : "return;";
      case "ThrowStatement":
        return `throw (${source(node.argument)}\n);`;
      case "TryStatement":
        return `try ${emit(node.block)}${node.handler ? " " + emit(node.handler) : ""}${node.finalizer ? " finally " + emit(node.finalizer) : ""}`;
      case "CatchClause":
        return `catch${node.param ? " (" + source(node.param) + ")" : ""} ${emit(node.body)}`;
      case "AssignmentStatement":
        if (direct && node.left.type === "Identifier" && references.get(node.left.start)?.kind === "state") {
          const target = name(references.get(node.left.start));
          if (node.update) return `${target}.set(+${target}.get() ${node.operator.slice(0, -1)} 1);`;
          const right = `(${source(node.right)}\n)`;
          return node.operator === "="
            ? `${target}.set((${right}));`
            : `${target}.set(${target}.get() ${node.operator.slice(0, -1)} (${right}));`;
        }
        return node.update ? `${source(node.left)}${node.operator === "+=" ? "++" : "--"};` : `${source(node.left)} ${node.operator} (${source(node.right)}\n);`;
      case "ExpressionStatement":
        return `${source(node.expression)}\n;`;
      default:
        throw new TypeError(`Unsupported NiralScript declaration '${node.type}'`);
    }
  }
  const replacements = [
    ...analysis.arrows.filter(node => node.body.type === "BlockStatement").map(node => node.body),
    ...(analysis.contracts?.keys() ?? []),
  ];
  if (typed) walk(program, node => { if (node.type === "CastExpression") replacements.push(node); });
  replacements.sort((left, right) => (left.end - left.start) - (right.end - right.start));
  for (const node of replacements) {
    const text = node.type === "ContractExpression"
      ? `${analysis.contracts.get(node)}(${source(node.argument)}\n)`
      : node.type === "CastExpression" ? source(node.expression)
      : emit(node);
    edits.push({ start: node.start, end: node.end, text });
    edits.sort((left, right) => left.start - right.start || right.end - left.end);
  }
  return { code: [...(program.modules ?? []).map(emit), body(program, program.start, program.end)].join("\n"), signals, writable, props };
}

export function compileNiralScript(code, filename = "<anonymous>", options = {}) {
  try {
    const resolveModule = options.resolveModule ?? (options.root ? (specifier, importer, location) => readNiralScriptSource(specifier, importer === filename ? options.sourceFile ?? importer : importer, options, location) : undefined);
    return emitProgram(linkNiralScript(parseNiralScript(code, filename), resolveModule), options, true);
  } catch (error) {
    if (!(error instanceof NiralScriptError)) throw error;
    throw new NiralError(error.code.replace(/^NRS/, "NIRAL"), error.message, error);
  }
}

export function lowerNiralScript(code, filename = "<anonymous>", options = {}) {
  try {
    return emitNiralScript(linkNiralScript(parseNiralScript(code, filename), options.resolveModule), options);
  } catch (error) {
    if (!(error instanceof NiralScriptError)) throw error;
    throw new NiralError(error.code.replace(/^NRS/, "NIRAL"), error.message, error);
  }
}
