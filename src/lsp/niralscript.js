import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkNiralScript } from "../../niralscript/check.js";
import { parseNiralScript } from "../../niralscript/parser.js";
import { NiralScriptError, sourceLocation } from "../../niralscript/errors.js";
import { isPrivatePath, isServableFile } from "../server/security.js";
import { offsetToPosition } from "./analysis.js";

export function inspectNiralScript(text, filename, { root = dirname(resolve(filename)), documents = new Map(), globals = [], strictTypes = false } = {}) {
  return checkNiralScript(text, filename, {
    globals,
    strictTypes,
    resolveModule(specifier, importer, location) {
      const fail = message => { throw new NiralScriptError("NRS077", message, location); };
      if (!/^\.\.?\//.test(specifier) || !specifier.endsWith(".nrs") || /[\\?#%:\x00-\x1f\x7f]/.test(specifier)) {
        fail("Imports must be explicit relative .nrs file paths");
      }
      const target = resolve(dirname(importer), specifier);
      if (!isServableFile(root, target) || isPrivatePath(relative(root, target), { allowNiralScript: true })) {
        fail("Imports must be existing non-private files inside the project, without symlinks");
      }
      return { filename: target, source: documents.get(target) ?? readFileSync(target, "utf8") };
    },
  });
}

export function validateNiralScript(text, filename, options) {
  try {
    inspectNiralScript(text, filename, options);
    return [];
  } catch (error) {
    const external = error.filename && error.filename !== filename;
    let anchor = { start: error.start ?? 0, end: error.end ?? 1 };
    if (external) {
      try {
        anchor = parseNiralScript(text, filename).body.find(node => node.type === "ImportDeclaration")?.source ?? { start: 0, end: 1 };
      } catch {
        anchor = { start: 0, end: 1 };
      }
    }
    return [{
      range: { start: offsetToPosition(text, anchor.start), end: offsetToPosition(text, Math.max(anchor.start + 1, anchor.end)) },
      severity: 1, source: "niralscript", code: error.code,
      message: error.hint ? `${error.message}\n\nhint: ${error.hint}` : String(error.message ?? error),
      ...(external ? { relatedInformation: [{
        location: { uri: pathToFileURL(error.filename).href, range: {
          start: offsetToPosition(error.source, error.start), end: offsetToPosition(error.source, error.end),
        } }, message: error.message,
      }] } : {}),
    }];
  }
}

const KEYWORDS = {
  state: "Writable reactive state. Assignments invalidate derived values.",
  derive: "A cached, read-only derived value. Evaluation must be pure.",
  input: "A read-only value supplied by the host through createInstance/updateInputs.",
  const: "A binding that cannot be reassigned.",
  let: "A mutable local binding.",
  function: "A named function; parameters and return values can have type annotations.",
  class: "A native class with typed fields, constructors, methods and inheritance.",
  constructor: "Initialize a new instance; derived constructors call super() before this.",
  new: "Construct a class instance, optionally supplying generic type arguments.",
  extends: "Inherit instance and static members from a base class.",
  instanceof: "Test whether a value inherits from a constructor's prototype.",
  this: "The current class receiver; arrow functions preserve it lexically.",
  super: "Access a base member or initialize a derived instance.",
  static: "Declare a class-level field, method or initialization block.",
  async: "An asynchronous function returning a promise.",
  await: "Wait for a promise inside an async function, or at the top level of a module, where it makes createInstance asynchronous.",
  import: "Import named exports from an explicit relative .nrs path.",
  export: "Export a constant, function, class or type alias.",
  type: "A compile-time type alias, optionally generic; import it with import type.",
  contract: "contract<Type>(value) validates and copies data without coercion. Returns Type or throws NRS081 with path and expected fields. Ordinary annotations remain erased.",
  return: "Return a value from the current function.",
  if: "Conditional execution with a braced body.",
  else: "The alternative branch of an if statement.",
  for: "Iterate with for-of or for (let index = 0; index < count; index++) { ... }.",
  while: "Repeat a braced body while its condition is true.",
  break: "Exit the nearest loop, running intervening finally blocks.",
  continue: "Start the next loop iteration, running finally blocks and the for update.",
  try: "Execute a block with catch and/or finally handling.",
  catch: "Handle a thrown value.",
  finally: "Execute cleanup after try/catch.",
  throw: "Throw an error value.",
};

function nodesOf(node, result = []) {
  if (!node?.type || node.type === "TypeAnnotation") return result;
  result.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (["source", "sources", "key"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => nodesOf(child, result));
    else if (value?.type) nodesOf(value, result);
  }
  return result;
}

function symbolAt(text, offset, filename, options) {
  const result = inspectNiralScript(text, filename, options);
  const { program, analysis } = result;
  const position = (program.sources?.find(input => input.filename === filename)?.start ?? 0) + offset;
  const contains = node => node && node.start <= position && position < node.end;
  let binding = analysis.references.find(reference => contains(reference.node))?.binding;
  binding ??= analysis.bindings.find(candidate => contains(candidate.id));
  for (const [specifier, entry] of analysis.imports) {
    if (contains(specifier.imported) || contains(specifier.local)) binding = entry.binding;
  }
  binding ??= analysis.typeBindings?.find(candidate => contains(candidate.localId) || contains(candidate.importedId));
  binding ??= [...(analysis.typeReferences ?? [])].find(([node]) => contains(node))?.[1];
  if (!binding) {
    const access = nodesOf(program).find(node => node.type === "MemberExpression" && contains(node.property));
    const member = access ? analysis.memberOf(access) : analysis.classes.flatMap(node => node.members).find(member => contains(member.key));
    if (member) binding = { kind: member.type === "MethodDefinition" ? "method" : "field", id: member.key, declaration: member };
  }
  return { ...result, binding };
}

function signature(program, analysis, binding) {
  const declaration = binding.declaration ?? analysis.declarations.get(binding);
  // Decorators widen a declaration's span, so hover text starts after them.
  const head = node => node.decorators?.length ? node.decorators[node.decorators.length - 1].end : node.start;
  if (declaration?.type === "ClassDeclaration") return program.source.slice(head(declaration), declaration.members[0]?.start ?? declaration.end - 1).trim().replace(/\s*\{$/, "");
  if (declaration?.type === "MethodDefinition") return program.source.slice(head(declaration), declaration.body.start).trim();
  if (declaration?.type === "PropertyDefinition") return program.source.slice(head(declaration), declaration.end).trim();
  if (binding.kind === "type") return program.source.slice(declaration.start, declaration.end).trim();
  if (declaration?.type === "FunctionDeclaration") return program.source.slice(declaration.start, declaration.body.start).trim();
  const annotation = binding.id.typeAnnotation;
  const label = program.source.slice(binding.id.start, annotation?.end ?? binding.id.end);
  return `${binding.kind} ${label}${annotation ? "" : " (unannotated)"}`;
}

export function nrsHover(text, offset, filename, options = {}) {
  try {
    const { program, analysis, binding } = symbolAt(text, offset, filename, options);
    if (binding?.id) return `\`\`\`niralscript\n${signature(program, analysis, binding)}\n\`\`\``;
  } catch {}
  const start = text.slice(0, offset).search(/[A-Za-z_$][\w$]*$/);
  const word = text.slice(start < 0 ? offset : start).match(/^[A-Za-z_$][\w$]*/)?.[0];
  return KEYWORDS[word] ?? null;
}

export function nrsDefinition(text, offset, filename, options = {}) {
  try {
    const { program, binding } = symbolAt(text, offset, filename, options);
    if (!binding?.id) return null;
    const location = sourceLocation(program, binding.id);
    return {
      uri: location.filename === filename && options.uri ? options.uri : pathToFileURL(location.filename).href,
      range: { start: offsetToPosition(location.source, location.start), end: offsetToPosition(location.source, location.end) },
    };
  } catch {
    return null;
  }
}

export function nrsCompletions(text, offset, filename, options = {}) {
  const items = Object.entries(KEYWORDS).map(([label, detail]) => ({ label, detail, kind: 14 }));
  try {
    const prefix = text.slice(0, offset).match(/([A-Za-z_$][\w$]*)\.(#?[\w$]*)$/);
    let result;
    try { result = inspectNiralScript(text, filename, options); }
    catch (error) {
      if (!prefix) throw error;
      result = inspectNiralScript(text.slice(0, offset - prefix[2].length - 1) + text.slice(offset), filename, options);
    }
    const { program, analysis } = result;
    if (prefix) {
      const start = (program.sources?.find(input => input.filename === filename)?.start ?? 0) + offset - prefix[0].length;
      const receiver = nodesOf(program).find(node => ["Identifier", "ThisExpression", "Super"].includes(node.type) && node.start <= start && start < node.end && program.source.slice(node.start, start).trim() === "");
      const members = new Map();
      const isStatic = analysis.isStaticReceiver(receiver);
      for (let declaration = analysis.classOf(receiver); declaration; declaration = analysis.baseOf(declaration)) {
        for (const member of declaration.members) if (member.key && member.static === isStatic && member.kind !== "constructor" && (!member.key.name.startsWith("#") || prefix[1] === "this" && analysis.classContexts.get(receiver)?.declaration === declaration)) {
          if (!members.has(member.key.name)) members.set(member.key.name, { label: member.key.name, kind: member.type === "MethodDefinition" ? 2 : 5, detail: signature(program, analysis, { declaration: member }) });
        }
      }
      if (members.size) return [...members.values()];
    }
    for (const [label, binding] of analysis.root.bindings) {
      items.push({ label, kind: binding.kind === "class" ? 7 : binding.kind === "function" ? 3 : 6, detail: signature(program, analysis, binding) });
    }
    for (const binding of analysis.typeBindings ?? []) if (binding.owner === program) items.push({ label: binding.name, kind: 25, detail: signature(program, analysis, binding) });
  } catch {}
  return items;
}