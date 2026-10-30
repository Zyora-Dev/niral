import { NiralScriptError, sourceLocation } from "./errors.js";
import { emitContractValidator } from "./contracts.js";

// Mirrors analysis.js; duplicated to keep types.js free of a circular import.
function assignmentTargets(node) {
  if (node.type === "ArrayPattern") return node.elements.filter(Boolean).flatMap(assignmentTargets);
  if (node.type === "ObjectPattern") return node.properties.flatMap(property => assignmentTargets(property.value));
  if (node.type === "RestElement") return assignmentTargets(node.argument);
  return [node];
}

// Bumped whenever type syntax is consumed, so a parse can record whether the program
// contains any annotations or casts without walking the tree afterwards.
let typeReads = 0;
export function typeReadCount() { return typeReads; }
export function hasTypeSyntax(program) {
  return program.typed !== false || (program.modules ?? []).some(module => module.typed !== false);
}

export function readTypeParameters(parser) {
  const opening = parser.eat("<");
  if (!opening) return null;
  typeReads++;
  const params = [];
  const names = [];
  do {
    const name = parser.expect("identifier");
    if (names.includes(name.value)) parser.error("Duplicate type parameter", name.start);
    names.push(name.value);
    let constraint = null;
    let defaultType = null;
    const afterName = parser.scanner?.pos ?? parser.pos;
    const extendsToken = parser.peek();
    if (extendsToken.kind === "identifier" && extendsToken.value === "extends") {
      parser.take();
      constraint = readType(parser).value;
    }
    if (parser.eat("=")) {
      defaultType = readType(parser).value;
    }
    params.push({ name: name.value, ...(constraint ? { constraint } : {}), ...(defaultType ? { default: defaultType } : {}) });
  } while (parser.eat(","));
  const close = parser.expect(">");
  return { type: "TypeAnnotation", value: { kind: "parameters", names, params }, start: opening.start, end: close.end };
}

export function readType(parser) {
  typeReads++;
  function primary() {
    const token = parser.take();
    let value;
    if (token.kind === "(") {
      const position = parser.scanner.pos;
      const current = parser.current;
      try {
        const params = [];
        while (parser.peek().kind !== ")") {
          const rest = !!parser.eat("...");
          const name = parser.expect("identifier");
          const optional = !!parser.eat("?");
          parser.expect(":");
          const value = union();
          if (rest && value.kind !== "array") parser.error("Rest function types require an array", name.start);
          params.push({ name: name.value, value, optional, rest });
          if (rest && parser.peek().kind !== ")") parser.error("Rest must be last", name.start);
          if (!parser.eat(",")) break;
        }
        parser.expect(")"); parser.expect("=>");
        value = { kind: "signature", params, result: union() };
      } catch (error) {
        if (error.name !== "NiralScriptError") throw error;
        parser.scanner.pos = position; parser.current = current;
        value = union(); parser.expect(")");
      }
    }
    else if (token.kind === "{") {
      const properties = {};
      while (parser.peek().kind !== "}") {
        const key = parser.expect("identifier");
        if (Object.hasOwn(properties, key.value)) parser.error("Duplicate type property", key.start);
        const optional = !!parser.eat("?");
        parser.expect(":");
        const property = union();
        Object.defineProperty(properties, key.value, { value: optional ? { kind: "union", members: [property, { kind: "undefined" }] } : property, enumerable: true });
        if (!parser.eat(",")) break;
      }
      parser.expect("}");
      value = { kind: "object", properties };
    } else if (token.kind === "identifier" && ["number", "string", "boolean", "null", "undefined", "void", "unknown"].includes(token.value)) value = { kind: token.value };
    else if (token.kind === "identifier" && token.value === "Promise") {
      parser.expect("<"); const result = union(); parser.expect(">"); value = { kind: "promise", result };
    } else if (["number", "string"].includes(token.kind) || token.kind === "identifier" && ["true", "false"].includes(token.value)) value = { kind: "literal", value: token.kind === "identifier" ? token.value === "true" : token.value };
    else if (token.kind === "-") value = { kind: "literal", value: -parser.expect("number").value };
    else if (token.kind === "identifier") {
      const args = [];
      if (parser.eat("<")) { do { args.push(union()); } while (parser.eat(",")); parser.expect(">"); }
      value = { kind: "reference", name: token.value, args, start: token.start, end: token.end };
    }
    else parser.error("Expected a type", token.start);
    while (parser.eat("[")) { parser.expect("]"); value = { kind: "array", element: value }; }
    return value;
  }
  function union() {
    const members = [primary()];
    while (parser.eat("|")) members.push(primary());
    return members.length === 1 ? members[0] : { kind: "union", members };
  }
  const value = union();
  return { value, end: parser.peek().start };
}

// Traversal runs several times over every node, so it avoids Object.entries and per-node allocation.
const SKIPPED_KEYS = new Set(["source", "sources", "key"]);

export function typeAnnotations(node, result = []) {
  if (!node || typeof node !== "object") return result;
  if (node.type === "TypeAnnotation") { result.push(node); return result; }
  for (const key in node) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const child of value) typeAnnotations(child, result); }
    else if (value?.type) typeAnnotations(value, result);
  }
  return result;
}

const UNKNOWN = { kind: "unknown" };
const UNDEFINED = { kind: "undefined" };
function merge(members) {
  const flattened = members.flatMap(value => value.kind === "union" ? value.members : [value]);
  const unique = [...new Map(flattened.map(value => [JSON.stringify(value), value])).values()];
  return unique.length === 1 ? unique[0] : unique.length ? { kind: "union", members: unique } : { kind: "never" };
}

function accepts(expected, actual, strict = false, base = () => null) {
  if (expected.kind === "unknown" || actual.kind === "never") return true;
  if (actual.kind === "unknown") return !strict;
  if (actual.kind === "union") return actual.members.every(value => accepts(expected, value, strict, base));
  if (expected.kind === "union") return expected.members.some(value => accepts(value, actual, strict, base));
  if (expected.kind === "void") return actual.kind === "undefined" || actual.kind === "void";
  if (expected.kind === "literal") return actual.kind === "literal" && expected.value === actual.value;
  if (actual.kind === "literal") return expected.kind === typeof actual.value;
  if (expected.kind !== actual.kind) return false;
  if (["instance", "constructor"].includes(expected.kind)) {
    while (actual && expected.classId !== actual.classId) actual = base(actual);
    return !!actual && expected.args.every((value, index) => accepts(value, actual.args[index] ?? UNKNOWN, strict, base));
  }
  if (expected.kind === "parameter") return expected.name === actual.name && expected.owner === actual.owner;
  if (expected.kind === "signature") {
    if (actual.params.filter(param => !param.optional && !param.rest).length > expected.params.filter(param => !param.optional && !param.rest).length) return false;
    return actual.params.every((param, index) => !expected.params[index] || accepts(param.value, expected.params[index].value, strict, base)) && (expected.result.kind === "void" || accepts(expected.result, actual.result, strict, base));
  }
  if (expected.kind === "array") return accepts(expected.element, actual.element, strict, base);
  if (expected.kind === "promise") return accepts(expected.result, actual.result, strict, base);
  if (expected.kind === "object") return Object.entries(expected.properties).every(([name, value]) => accepts(value, Object.hasOwn(actual.properties, name) ? actual.properties[name] : UNDEFINED, strict, base));
  return true;
}

function describe(value) {
  if (["instance", "constructor"].includes(value.kind)) return `${value.kind} ${value.name}`;
  if (value.kind === "parameter") return value.name;
  if (value.kind === "signature") return `(${value.params.map(param => `${param.name}: ${describe(param.value)}`).join(", ")}) => ${describe(value.result)}`;
  if (value.kind === "literal") return `${typeof value.value} literal ${JSON.stringify(value.value)}`;
  if (value.kind === "union") return value.members.map(describe).join(" | ");
  if (value.kind === "array") return `(${describe(value.element)})[]`;
  if (value.kind === "promise") return `Promise<${describe(value.result)}>`;
  if (value.kind === "object") return `{ ${Object.entries(value.properties).map(([name, type]) => `${name}: ${describe(type)}`).join(", ")} }`;
  return value.kind;
}

export function walk(node, visit) {
  if (!node?.type || node.type === "TypeAnnotation") return;
  visit(node);
  for (const key in node) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const child of value) walk(child, visit); }
    else if (value?.type) walk(value, visit);
  }
}

export function checkTypes(program, analysis, { strictTypes = false } = {}) {
  const annotations = hasTypeSyntax(program) ? typeAnnotations(program) : [];
  if (!strictTypes && !analysis.classes.length && !annotations.length && ![...(program.modules ?? []), program].some(owner => owner.body.some(node => node.typeOnly))) return;
  const annotated = new Map();
  const declared = new Map(analysis.bindings.map(binding => [binding.id, binding]));
  const functions = [];
  const assignments = [];
  const calls = [];
  const variables = [];
  const flows = new WeakMap();
  const contextualResults = new WeakMap();
  const patternDefaults = new Map();
  const fail = (message, node) => { throw new NiralScriptError("NRS080", message, sourceLocation(program, node)); };
  const owners = [...(program.modules ?? []), program];
  const genericOwners = [];
  walk(program, node => { if (node.typeParameters) genericOwners.push(node); });
  genericOwners.sort((left, right) => left.end - left.start - (right.end - right.start));
  const typeScopes = new Map(owners.map(owner => [owner, new Map()]));
  analysis.typeBindings = [];
  analysis.typeReferences = new Map();
  const ownerOf = node => owners.find(owner => node.start >= owner.start && node.start < owner.end) ?? program;
  const classById = identity => analysis.classes.find(node => node.start === identity);
  function classType(declaration, kind = "instance", args = declaration.typeParameters?.value.names.map(name => ({ kind: "parameter", name, owner: declaration.start })) ?? []) {
    return { kind, classId: declaration.start, name: declaration.id?.name ?? "(anonymous)", args };
  }
  function classSubstitutions(value) {
    const declaration = classById(value.classId);
    return new Map((declaration.typeParameters?.value.names ?? []).map((name, index) => [`${declaration.start}:${name}`, value.args[index] ?? UNKNOWN]));
  }
  function baseType(value) {
    const declaration = classById(value.classId);
    const base = analysis.baseOf(declaration);
    if (!base) return null;
    const args = declaration.superTypeArguments ? typeOf(declaration.superTypeArguments).values.map(argument => substitute(argument, classSubstitutions(value))) : [];
    return classType(base, value.kind, args);
  }
  function classMember(value, key) {
    let declaration = classById(value.classId);
    while (declaration) {
      const member = declaration.members.find(member => member.static === (value.kind === "constructor") && member.key?.name === String(key));
      if (member) return member;
      declaration = analysis.baseOf(declaration);
    }
    return null;
  }
  for (const owner of owners) {
    const scope = typeScopes.get(owner);
    for (const node of owner.body) if (["TypeAliasDeclaration", "InterfaceDeclaration", "ClassDeclaration"].includes(node.type)) {
      if (scope.has(node.id.name)) fail(`Duplicate type '${node.id.name}'`, node.id);
      scope.set(node.id.name, node);
    }
    for (const node of owner.body) if (node.type === "ImportDeclaration") {
      const target = owners.find(owner => owner.filename === node.target);
      for (const specifier of node.specifiers) {
        const alias = typeScopes.get(target)?.get(specifier.imported.name);
        if (!node.typeOnly && alias?.type !== "ClassDeclaration") continue;
        if (!alias?.exported || ownerOf(alias) !== target) fail(`Module does not export type '${specifier.imported.name}'`, specifier.imported);
        if (scope.has(specifier.local.name)) fail(`Duplicate type '${specifier.local.name}'`, specifier.local);
        scope.set(specifier.local.name, alias);
      }
    }
  }
  function resolveType(value, location, seen = new Set(), substitutions = new Map()) {
    if (value.kind === "reference") {
      if (substitutions.has(value.name)) return substitutions.get(value.name);
      const generic = genericOwners.find(owner => location.start >= owner.start && location.start < owner.end && owner.typeParameters.value.names.includes(value.name));
      if (generic) {
        if (value.args.length) fail("Type parameters cannot take type arguments", value);
        return { kind: "parameter", name: value.name, owner: generic.start };
      }
      const lexicalClass = analysis.classes.filter(node => node.id.name === value.name && node.start <= location.start && location.end <= node.end).sort((left, right) => left.end - left.start - (right.end - right.start))[0];
      const alias = lexicalClass ?? typeScopes.get(ownerOf(location)).get(value.name);
      if (!alias) fail(`Unknown type '${value.name}'`, value);
      analysis.typeReferences.set(value, { kind: "type", id: alias.id, declaration: alias });
      if (seen.has(alias)) fail(`Circular type alias '${value.name}'`, value);
      const names = alias.typeParameters?.value.names ?? [];
      const paramDefs = alias.typeParameters?.value.params ?? names.map(n => ({ name: n }));
      const requiredCount = paramDefs.filter(p => !p.default).length;
      if (value.args.length < requiredCount || value.args.length > names.length) fail(`Type '${value.name}' expects ${requiredCount === names.length ? names.length : `${requiredCount}–${names.length}`} type arguments`, value);
      const argumentsMap = new Map();
      for (const [index, param] of paramDefs.entries()) {
        const resolved = index < value.args.length
          ? resolveType(value.args[index], location, seen, substitutions)
          : resolveType(param.default, alias, seen, argumentsMap);
        argumentsMap.set(param.name, resolved);
      }
      for (const [i, param] of paramDefs.entries()) {
        if (!param.constraint) continue;
        const constraint = resolveType(param.constraint, alias, seen, argumentsMap);
        const arg = argumentsMap.get(param.name);
        if (!accepts(constraint, arg, false)) fail(`Type argument '${describe(arg)}' does not satisfy constraint '${describe(constraint)}'`, value);
      }
      if (alias.type === "ClassDeclaration") return classType(alias, "instance", [...argumentsMap.values()]);
      if (alias.type === "InterfaceDeclaration") {
        const own = resolveType(alias.value.value, alias, new Set(seen).add(alias), argumentsMap);
        if (!alias.extends?.length) return own;
        const bases = alias.extends.map(ext => resolveType(ext.value, alias, new Set(seen).add(alias), argumentsMap));
        const merged = Object.assign(Object.create(null), ...bases.map(b => b.kind === "object" ? b.properties : {}), own.kind === "object" ? own.properties : {});
        return { kind: "object", properties: merged };
      }
      return resolveType(alias.value.value, alias, new Set(seen).add(alias), argumentsMap);
    }
    if (value.kind === "array") return { ...value, element: resolveType(value.element, location, seen, substitutions) };
    if (value.kind === "promise") return { ...value, result: resolveType(value.result, location, seen, substitutions) };
    if (value.kind === "signature") return { ...value, params: value.params.map(param => ({ ...param, value: resolveType(param.value, location, seen, substitutions) })), result: resolveType(value.result, location, seen, substitutions) };
    if (value.kind === "arguments") return { ...value, values: value.values.map(member => resolveType(member, location, seen, substitutions)) };
    if (value.kind === "union") return merge(value.members.map(member => resolveType(member, location, seen, substitutions)));
    if (value.kind === "object") return { ...value, properties: Object.fromEntries(Object.entries(value.properties).map(([key, member]) => [key, resolveType(member, location, seen, substitutions)])) };
    return value;
  }
  const typeOf = annotation => resolveType(annotation.value, annotation);
  for (const owner of owners) for (const [name, alias] of typeScopes.get(owner)) {
    const specifier = owner.body.filter(node => node.type === "ImportDeclaration" && node.typeOnly).flatMap(node => node.specifiers).find(specifier => specifier.local.name === name);
    analysis.typeBindings.push({ name, kind: "type", id: alias.id, localId: specifier?.local ?? alias.id, importedId: specifier?.imported, declaration: alias, owner });
  }
  for (const annotation of annotations) typeOf(annotation);
  analysis.contracts = new Map();
  walk(program, node => {
    if (node.type !== "ContractExpression") return;
    try {
      analysis.contracts.set(node, emitContractValidator(typeOf(node.typeAnnotation)));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      fail(error.message, node.typeAnnotation);
    }
  });
  if (analysis.contracts.size) {
    const shadow = analysis.bindings.find(binding => binding.name === "globalThis");
    if (shadow) fail("Runtime contracts require an unshadowed globalThis", shadow.id);
    const imported = [...analysis.imports.keys()].find(specifier => specifier.local.name === "globalThis");
    if (imported) fail("Runtime contracts require an unshadowed globalThis", imported.local);
  }
  const check = (expected, actual, node) => {
    if (expected.kind === "signature" && actual.kind === "function") actual = signature(actual.node);
    if (expected.kind === "object" && actual.kind === "instance") {
      for (const [key, value] of Object.entries(expected.properties)) check(value, property(actual, key), node);
      return;
    }
    if (!accepts(expected, actual, strictTypes, baseType)) fail(`Expected ${describe(expected)}, received ${describe(actual)}`, node);
  };
  function property(value, key, seen = new Set()) {
    if (value.kind === "literal") value = { kind: typeof value.value };
    if (value.kind === "union") return merge(value.members.map(member => property(member, key, seen)));
    if (["instance", "constructor"].includes(value.kind)) {
      const own = classById(value.classId).members.find(member => member.static === (value.kind === "constructor") && member.key?.name === String(key));
      const base = baseType(value);
      if (!own && base) return property(base, key, seen);
      const member = classMember(value, key);
      const substitutions = classSubstitutions(value);
      if (member?.type === "MethodDefinition") {
        if (member.kind === "get") return substitute(resultOf(member, new Set(seen).add(member)), substitutions);
        if (member.kind === "set") return member.params[0].typeAnnotation ? substitute(typeOf(member.params[0].typeAnnotation), substitutions) : UNKNOWN;
        return { kind: "function", node: member, receiver: value };
      }
      if (member?.typeAnnotation || member?.value) return substitute(member.typeAnnotation ? typeOf(member.typeAnnotation) : widen(infer(member.value, seen)), substitutions);
      const declaration = classById(value.classId);
      const assignment = assignments.find(node => node.left.type === "MemberExpression" && node.left.object.type === "ThisExpression" && (node.left.computed ? node.left.property.value : node.left.property.name) === key && analysis.classContexts.get(node.left.object)?.declaration === declaration);
      return assignment ? substitute(widen(infer(assignment.right, seen)), substitutions) : member ? UNKNOWN : UNDEFINED;
    }
    if (value.kind === "object") return Object.hasOwn(value.properties, key) ? value.properties[key] : UNDEFINED;
    if ((value.kind === "array" || value.kind === "string") && key === "length") return { kind: "number" };
    if (value.kind === "array" && /^(0|[1-9]\d*)$/.test(key)) return value.element;
    if (["null", "undefined"].includes(value.kind)) return UNDEFINED;
    return UNKNOWN;
  }
  function annotate(pattern, value) {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") {
      patternDefaults.set(pattern, value);
      return annotate(pattern.left, merge((value.kind === "union" ? value.members : [value]).filter(member => member.kind !== "undefined")));
    }
    if (pattern.type === "RestElement") return annotate(pattern.argument, value);
    if (pattern.type === "Identifier") annotated.set(declared.get(pattern), value);
    if (pattern.type === "ArrayPattern") pattern.elements.forEach((item, index) => annotate(item, item?.type === "RestElement" ? value : property(value, index)));
    if (pattern.type === "ObjectPattern") {
      const keys = new Set(pattern.properties.filter(item => item.type !== "RestElement").map(item => String(item.key.name ?? item.key.value)));
      const remaining = value.kind === "object" ? { kind: "object", properties: Object.fromEntries(Object.entries(value.properties).filter(([key]) => !keys.has(key))) } : value;
      pattern.properties.forEach(item => annotate(item.value ?? item, item.type === "RestElement" ? remaining : property(value, item.key.name ?? item.key.value)));
    }
  }
  walk(program, node => {
    if (node.typeAnnotation) annotate(node, typeOf(node.typeAnnotation));
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "MethodDefinition"].includes(node.type)) functions.push(node);
    if (node.type === "AssignmentStatement") assignments.push(node);
    if (["CallExpression", "NewExpression"].includes(node.type)) calls.push(node);
    if (node.init && node.id) variables.push(node);
  });
  function resultOf(fn, seen) {
    if (fn.returnType) return typeOf(fn.returnType);
    const result = fn.body.type === "BlockStatement" ? merge(returns(fn.body).map(node => infer(node.argument, seen)).concat(terminates(fn.body) ? [] : [UNDEFINED])) : infer(fn.body, seen);
    return fn.async ? { kind: "promise", result: unwrap(result) } : result;
  }
  function unwrap(value) {
    return value.kind === "promise" ? unwrap(value.result) : value.kind === "union" ? merge(value.members.map(unwrap)) : value;
  }
  function substitute(value, bindings) {
    if (["instance", "constructor"].includes(value.kind)) return { ...value, args: value.args.map(argument => substitute(argument, bindings)) };
    if (value.kind === "parameter") return bindings.get(`${value.owner}:${value.name}`) ?? value;
    if (value.kind === "array") return { ...value, element: substitute(value.element, bindings) };
    if (value.kind === "promise") return { ...value, result: substitute(value.result, bindings) };
    if (value.kind === "union") return merge(value.members.map(member => substitute(member, bindings)));
    if (value.kind === "object") return { ...value, properties: Object.fromEntries(Object.entries(value.properties).map(([key, member]) => [key, substitute(member, bindings)])) };
    if (value.kind === "signature") return { ...value, params: value.params.map(param => ({ ...param, value: substitute(param.value, bindings) })), result: substitute(value.result, bindings) };
    return value;
  }
  function signature(fn, seen = new Set()) {
    return { kind: "signature", params: fn.params.map(param => ({ name: param.name ?? param.argument?.name ?? "value", value: param.typeAnnotation ? typeOf(param.typeAnnotation) : annotated.get(declared.get(param)) ?? UNKNOWN, optional: param.type === "AssignmentPattern", rest: param.type === "RestElement" })), result: fn.resultType ?? resultOf(fn, seen) };
  }
  function contextualize(node, expected) {
    if (!node || expected.kind !== "signature") return;
    const actual = infer(node);
    if (actual.kind !== "function") return;
    actual.node.params.forEach((param, index) => {
      if (!param.typeAnnotation && expected.params[index]) annotate(param, expected.params[index].value);
    });
    if (!actual.node.returnType && expected.result.kind !== "unknown" && expected.result.kind !== "parameter") contextualResults.set(actual.node, expected.result);
  }
  function callSignature(fn, call, seen = new Set(), prepared) {
    const receiver = infer(call.callee, new Set(seen)).receiver;
    const contract = prepared ?? (receiver ? substitute(signature(fn, seen), classSubstitutions(receiver)) : signature(fn, seen));
    const bindings = new Map();
    const names = fn.typeParameters?.value.names ?? [];
    const paramDefs = fn.typeParameters?.value.params ?? names.map(n => ({ name: n }));
    if (call.typeArguments) {
      const values = typeOf(call.typeArguments).values;
      if (values.length !== names.length) fail(`Expected ${names.length} type arguments`, call.typeArguments);
      names.forEach((name, index) => bindings.set(`${fn.start}:${name}`, values[index]));
    }
    function collect(expected, actual) {
      if (expected.kind === "parameter") {
        const key = `${expected.owner}:${expected.name}`;
        if (!bindings.has(key) && actual.kind !== "unknown") bindings.set(key, actual.kind === "literal" ? { kind: typeof actual.value } : actual);
      } else if (expected.kind === "array" && actual.kind === "array") collect(expected.element, actual.element);
      else if (expected.kind === "promise" && actual.kind === "promise") collect(expected.result, actual.result);
      else if (expected.kind === "object" && actual.kind === "object") {
        for (const [key, member] of Object.entries(expected.properties)) if (actual.properties[key]) collect(member, actual.properties[key]);
      }
      else if (expected.kind === "signature" && actual.kind === "signature") { expected.params.forEach((param, index) => { if (actual.params[index]) collect(param.value, actual.params[index].value); }); collect(expected.result, actual.result); }
    }
    const args = flattenArguments(call.arguments);
    contract.params.forEach((param, index) => {
      for (const argument of param.rest ? args.slice(index) : [args[index]]) {
        contextualize(argument, substitute(param.rest ? param.value.element : param.value, bindings));
        const actual = infer(argument, seen);
        collect(param.rest ? param.value.element : param.value, actual.kind === "function" ? signature(actual.node, seen) : actual);
      }
    });
    // fill in defaults for unresolved type parameters
    for (const param of paramDefs) {
      const key = `${fn.start}:${param.name}`;
      if (!bindings.has(key) && param.default) bindings.set(key, resolveType(param.default, fn, seen, bindings));
    }
    // check inferred/explicit type arguments against constraints
    for (const param of paramDefs) {
      if (!param.constraint) continue;
      const key = `${fn.start}:${param.name}`;
      const arg = bindings.get(key);
      if (!arg || arg.kind === "unknown") continue;
      const constraint = resolveType(param.constraint, fn, seen, bindings);
      if (!accepts(constraint, arg, false)) fail(`Type argument '${describe(arg)}' does not satisfy constraint '${describe(constraint)}'`, call);
    }
    return substitute(contract, bindings);
  }
  function constructorSignature(value, call, seen = new Set()) {
    const declaration = classById(value.classId);
    function contractOf(receiver) {
      const owner = classById(receiver.classId);
      const constructor = owner.members.find(member => member.kind === "constructor");
      if (constructor) return substitute(signature({ ...constructor, resultType: UNDEFINED }, seen), classSubstitutions(receiver));
      const base = baseType(receiver);
      return base ? contractOf(base) : { kind: "signature", params: [], result: UNDEFINED };
    }
    const contract = { ...contractOf(value), result: classType(declaration) };
    return callSignature(declaration, call, seen, contract);
  }
  function flattenArguments(args) {
    return args.flatMap(argument => argument.type === "SpreadElement" && argument.argument.type === "ArrayExpression" ? flattenArguments(argument.argument.elements) : [argument]);
  }
  function widen(value) {
    if (value.kind === "literal") return { kind: typeof value.value };
    if (value.kind === "array") return { ...value, element: widen(value.element) };
    if (value.kind === "object") return { ...value, properties: Object.fromEntries(Object.entries(value.properties).map(([key, member]) => [key, widen(member)])) };
    if (value.kind === "union") return merge(value.members.map(widen));
    return value;
  }
  function projectPattern(pattern, value, target, seen) {
    if (!pattern) return null;
    if (pattern.type === "Identifier") return pattern === target ? value : null;
    if (pattern.type === "AssignmentPattern") {
      const members = value.kind === "union" ? value.members : [value];
      const initialized = members.some(member => member.kind === "undefined")
        ? merge([...members.filter(member => member.kind !== "undefined"), infer(pattern.right, seen)]) : value;
      return projectPattern(pattern.left, initialized, target, seen);
    }
    if (pattern.type === "RestElement") return projectPattern(pattern.argument, value, target, seen);
    if (pattern.type === "ArrayPattern") {
      for (const [index, item] of pattern.elements.entries()) {
        const result = projectPattern(item, item?.type === "RestElement" ? value : property(value, index), target, seen);
        if (result) return result;
      }
    }
    if (pattern.type === "ObjectPattern") {
      const keys = new Set(pattern.properties.filter(item => item.type !== "RestElement").map(item => String(item.key.name ?? item.key.value)));
      const remaining = value.kind === "object" ? { kind: "object", properties: Object.fromEntries(Object.entries(value.properties).filter(([key]) => !keys.has(key))) } : value;
      for (const item of pattern.properties) {
        const result = projectPattern(item.value ?? item, item.type === "RestElement" ? remaining : property(value, item.key.name ?? item.key.value), target, seen);
        if (result) return result;
      }
    }
    return null;
  }
  function infer(node, seen = new Set()) {
    if (!node) return UNDEFINED;
    if (seen.has(node)) return UNKNOWN;
    seen = new Set(seen).add(node);
    if (node.type === "Literal") return node.value === null ? { kind: "null" } : { kind: "literal", value: node.value };
    if (node.type === "Identifier") {
      const binding = analysis.resolved.get(node) ?? declared.get(node);
      if (flows.get(node)?.has(binding)) return flows.get(node).get(binding);
      if (annotated.has(binding)) return annotated.get(binding);
      const declaration = analysis.declarations.get(binding);
      if (["FunctionDeclaration", "FunctionExpression"].includes(declaration?.type)) return { kind: "function", node: declaration };
      if (declaration?.type === "ClassDeclaration" || declaration?.type === "ClassExpression") return classType(declaration, "constructor");
      let value = declaration?.init ? infer(declaration.init, seen) : UNKNOWN;
      if (declaration?.id) value = projectPattern(declaration.id, value, binding?.id, seen) ?? UNKNOWN;
      if (["let", "state"].includes(binding?.kind) || ["array", "object"].includes(value.kind)) value = widen(value);
      return value;
    }
    if (node.type === "ParenthesizedExpression") return infer(node.expression, seen);
    if (node.type === "ContractExpression") return typeOf(node.typeAnnotation);
    if (node.type === "CastExpression") {
      return node.operator === "as" ? typeOf(node.castType) : infer(node.expression, seen);
    }
    if (node.type === "ClassExpression") return classType(node, "constructor");
    if (["ThisExpression", "Super"].includes(node.type)) {
      const context = analysis.classContexts.get(node);
      const value = classType(context.declaration, context.member.static ? "constructor" : "instance");
      return node.type === "Super" ? baseType(value) : value;
    }
    if (node.type === "NewExpression") {
      const callee = infer(node.callee, seen);
      return callee.kind === "constructor" ? constructorSignature(callee, node, seen).result : UNKNOWN;
    }
    if (node.type === "SpreadElement") return infer(node.argument, seen).element ?? UNKNOWN;
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return { kind: "function", node };
    if (node.type === "AwaitExpression") return unwrap(infer(node.argument, seen));
    if (node.type === "TemplateLiteral") return { kind: "string" };
    if (node.type === "UnaryExpression") return { kind: node.operator === "typeof" ? "string" : node.operator === "!" ? "boolean" : "number" };
    if (node.type === "BinaryExpression") {
      if (["===", "!==", "<", "<=", ">", ">=", "instanceof"].includes(node.operator)) return { kind: "boolean" };
      if (node.operator !== "+") return { kind: "number" };
      const leftValue = infer(node.left, seen);
      const rightValue = infer(node.right, seen);
      const left = leftValue.kind === "literal" ? { kind: typeof leftValue.value } : leftValue;
      const right = rightValue.kind === "literal" ? { kind: typeof rightValue.value } : rightValue;
      if (left.kind === "string" || right.kind === "string") return { kind: "string" };
      return left.kind === "number" && right.kind === "number" ? { kind: "number" } : UNKNOWN;
    }
    if (node.type === "LogicalExpression") {
      let left = infer(node.left, seen);
      if (node.operator === "??") left = merge((left.kind === "union" ? left.members : [left]).filter(value => !["null", "undefined"].includes(value.kind)));
      return merge([left, infer(node.right, seen)]);
    }
    if (node.type === "ConditionalExpression") return merge([infer(node.consequent, seen), infer(node.alternate, seen)]);
    if (node.type === "ArrayExpression") return { kind: "array", element: merge(node.elements.map(item => item.type === "SpreadElement" ? infer(item.argument, seen).element ?? UNKNOWN : infer(item, seen))) };
    if (node.type === "ObjectExpression") {
      const properties = Object.create(null);
      for (const item of node.properties) {
        if (item.type === "SpreadElement") {
          const value = infer(item.argument, seen);
          if (value.kind !== "object") return UNKNOWN;
          Object.assign(properties, value.properties);
        } else properties[item.key.name ?? item.key.value] = infer(item.value, seen);
      }
      return { kind: "object", properties };
    }
    if (node.type === "MemberExpression") {
      const key = node.computed ? node.property.type === "Literal" ? node.property.value : null : node.property.name;
      const receiver = infer(node.object, seen);
      return key !== null ? property(receiver, key, seen) : receiver.kind === "array" ? receiver.element : UNKNOWN;
    }
    if (node.type === "CallExpression") {
      const callee = infer(node.callee, seen);
      if (callee.kind === "function") return callSignature(callee.node, node, seen).result;
      if (callee.kind === "signature") return callee.result;
      if (node.callee.type === "MemberExpression") {
        const receiver = infer(node.callee.object, seen);
        const method = node.callee.computed ? node.callee.property.value : node.callee.property.name;
        if (receiver.kind === "string" || receiver.kind === "literal" && typeof receiver.value === "string") {
          if (["slice", "substring", "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase", "charAt"].includes(method)) return { kind: "string" };
          if (["includes", "startsWith", "endsWith"].includes(method)) return { kind: "boolean" };
          if (["indexOf", "lastIndexOf", "charCodeAt"].includes(method)) return { kind: "number" };
          if (method === "split") return { kind: "array", element: { kind: "string" } };
        }
        if (receiver.kind === "array") {
          if (["slice", "filter", "concat"].includes(method)) return receiver;
          if (["includes", "some", "every"].includes(method)) return { kind: "boolean" };
          if (["indexOf", "lastIndexOf", "findIndex"].includes(method)) return { kind: "number" };
          if (method === "join") return { kind: "string" };
          if (["at", "find"].includes(method)) return merge([receiver.element, UNDEFINED]);
          const callback = infer(node.arguments[0], seen);
          if (method === "map" && callback.kind === "function") return { kind: "array", element: resultOf(callback.node, seen) };
        }
      }
    }
    return UNKNOWN;
  }
  function returns(node, result = []) {
    if (!node || ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression", "MethodDefinition"].includes(node.type)) return result;
    if (node.type === "ReturnStatement") result.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === "argument") continue;
      if (Array.isArray(value)) value.forEach(child => child?.type && returns(child, result));
      else if (value?.type) returns(value, result);
    }
    return result;
  }
  function terminates(node) {
    if (!node) return false;
    if (["ReturnStatement", "ThrowStatement"].includes(node.type)) return true;
    if (node.type === "BlockStatement") return node.body.some(terminates);
    if (node.type === "IfStatement") return terminates(node.consequent) && terminates(node.alternate);
    if (node.type === "TryStatement") return terminates(node.finalizer) || terminates(node.block) && (!node.handler || terminates(node.handler.body));
    return false;
  }
  function contracted(node, seen = new Set()) {
    if (!node || seen.has(node)) return false;
    seen = new Set(seen).add(node);
    if (["ThisExpression", "Super", "NewExpression", "ContractExpression"].includes(node.type)) return true;
    if (node.type === "Identifier") {
      const binding = analysis.resolved.get(node);
      return annotated.has(binding) || contracted(analysis.declarations.get(binding)?.init, seen);
    }
    if (node.type === "MemberExpression") return contracted(node.object, seen);
    if (node.type === "ParenthesizedExpression") return contracted(node.expression, seen);
    if (node.type === "CallExpression") return !!infer(node.callee).node?.returnType;
    return false;
  }

  function narrowed(test, environment, truth) {
    const result = new Map(environment);
    if (test.type === "ParenthesizedExpression") return narrowed(test.expression, result, truth);
    if (test.type === "UnaryExpression" && test.operator === "!") return narrowed(test.argument, result, !truth);
    if (test.type === "LogicalExpression" && (test.operator === "&&" && truth || test.operator === "||" && !truth)) return narrowed(test.right, narrowed(test.left, result, truth), truth);
    let subject = test;
    let literal;
    let typeofCheck = false;
    let equal = truth;
    if (test.type === "BinaryExpression" && ["===", "!=="].includes(test.operator)) {
      subject = test.left;
      literal = test.right;
      if (subject.type === "Literal") [subject, literal] = [literal, subject];
      if (literal.type !== "Literal" && !(literal.type === "Identifier" && literal.name === "undefined" && analysis.resolved.get(literal)?.kind === "global")) return result;
      equal = test.operator === "===" ? truth : !truth;
      if (subject.type === "UnaryExpression" && subject.operator === "typeof") { typeofCheck = true; subject = subject.argument; }
    } else if (test.type !== "Identifier") return result;
    const identifier = subject.type === "MemberExpression" && !subject.computed ? subject.object : subject;
    if (identifier.type !== "Identifier") return result;
    const binding = analysis.resolved.get(identifier);
    if (!binding) return result;
    const value = environment.get(binding) ?? infer(identifier);
    const members = value.kind === "union" ? value.members : [value];
    const target = literal ? literal.type === "Identifier" ? UNDEFINED : literal.value === null ? { kind: "null" } : { kind: "literal", value: literal.value } : null;
    const selected = members.filter(member => {
      const candidate = subject.type === "MemberExpression" ? property(member, subject.property.name) : member;
      if (typeofCheck) {
        if (candidate.kind === "unknown") return true;
        const matches = (candidate.kind === "literal" ? typeof candidate.value : candidate.kind === "null" || candidate.kind === "array" ? "object" : candidate.kind) === literal.value;
        return matches === equal;
      }
      if (!target) return !truth || !["null", "undefined"].includes(candidate.kind) && !(candidate.kind === "literal" && !candidate.value);
      if (candidate.kind === "unknown" || candidate.kind === "string" || candidate.kind === "number" || candidate.kind === "boolean") return true;
      return accepts(target, candidate, true) === equal;
    });
    let narrowedValue = merge(selected);
    if (typeofCheck && equal && ["string", "number", "boolean", "undefined"].includes(literal.value) && value.kind === "unknown") narrowedValue = { kind: literal.value };
    else if (target && equal && subject.type === "Identifier" && !typeofCheck) narrowedValue = target;
    result.set(binding, narrowedValue);
    return result;
  }
  function flow(node, environment) {
    if (!node?.type || node.type === "TypeAnnotation") return environment;
    flows.set(node, new Map(environment));
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "MethodDefinition"].includes(node.type)) {
      for (const param of node.params) flow(param, new Map());
      flow(node.body, new Map());
      return environment;
    }
    if (node.type === "Program" || node.type === "BlockStatement") {
      let current = new Map(environment);
      for (const child of node.body) current = flow(child, current);
      return current;
    }
    if (node.type === "IfStatement" || node.type === "ConditionalExpression") {
      const current = flow(node.test, environment);
      const consequent = flow(node.consequent, narrowed(node.test, current, true));
      const alternate = node.alternate ? flow(node.alternate, narrowed(node.test, current, false)) : narrowed(node.test, current, false);
      if (terminates(node.consequent)) return alternate;
      if (terminates(node.alternate)) return consequent;
      return new Map([...consequent].filter(([binding, value]) => JSON.stringify(alternate.get(binding)) === JSON.stringify(value)));
    }
    if (node.type === "LogicalExpression") {
      flow(node.left, environment);
      flow(node.right, narrowed(node.left, environment, node.operator === "&&"));
      return environment;
    }
    if (["ForStatement", "WhileStatement", "ForOfStatement", "ForInStatement"].includes(node.type)) {
      flow(node.init, new Map());
      flow(node.test ?? node.right, new Map());
      flow(node.body, node.test ? narrowed(node.test, new Map(), true) : new Map());
      flow(node.update, new Map());
      return new Map();
    }
    let current = new Map(environment);
    for (const [key, child] of Object.entries(node)) {
      if (["key", "source", "sources", "id", "typeAnnotation", "returnType"].includes(key)) continue;
      if (Array.isArray(child)) for (const item of child) current = flow(item, current);
      else if (child?.type) current = flow(child, current);
    }
    if (node.type === "AssignmentStatement") {
      for (const leaf of assignmentTargets(node.left)) {
        current.delete(analysis.resolved.get(leaf.type === "MemberExpression" ? leaf.object : leaf));
      }
    }
    if (node.type === "CallExpression") for (const [binding, value] of current) {
      if (["let", "state"].includes(binding.kind) || !["literal", "string", "number", "boolean"].includes(value.kind)) current.delete(binding);
    }
    return current;
  }
  for (const node of variables) if (node.id?.typeAnnotation) contextualize(node.init, typeOf(node.id.typeAnnotation));
  for (const node of calls) {
    const callee = infer(node.callee);
    if (callee.kind === "function") callSignature(callee.node, node);
    else if (callee.kind === "signature") callee.params.forEach((param, index) => contextualize(node.arguments[index], param.value));
    if (node.callee.type === "MemberExpression") {
      const receiver = infer(node.callee.object);
      const method = node.callee.computed ? node.callee.property.value : node.callee.property.name;
      if (receiver.kind === "array" && ["map", "filter", "find", "findIndex", "some", "every", "forEach"].includes(method)) contextualize(node.arguments[0], { kind: "signature", params: [{ value: receiver.element }, { value: { kind: "number" } }, { value: receiver }], result: UNKNOWN });
    }
  }
  walk(program, node => {
    if (node.type === "ForOfStatement") {
      const element = infer(node.right).element ?? UNKNOWN;
      if (node.id.typeAnnotation) check(typeOf(node.id.typeAnnotation), element, node.right);
      else annotate(node.id, element);
    }
    if (node.type === "ForInStatement") annotate(node.id, { kind: "string" });
  });
  for (const owner of owners) flow(owner, new Map());
  if (strictTypes) walk(program, node => {
    if (node.type !== "MemberExpression") return;
    const receiver = infer(node.object);
    const members = receiver.kind === "union" ? receiver.members : [receiver];
    if (members.some(value => value.kind === "unknown" || !node.optional && ["null", "undefined"].includes(value.kind))) fail("Property access requires a non-null, known value; narrow it first", node.object);
  });
  for (const node of variables) if (node.id.typeAnnotation) check(typeOf(node.id.typeAnnotation), infer(node.init), node.init);
  for (const [pattern, expected] of patternDefaults) check(expected, infer(pattern.right), pattern.right);
  walk(program, node => {
    if (node.type === "CastExpression" && node.operator === "satisfies") check(typeOf(node.castType), infer(node.expression), node.expression);
    if (node.type === "PropertyDefinition" && node.value && node.typeAnnotation) check(typeOf(node.typeAnnotation), infer(node.value), node.value);
    if (node.type === "AssignmentPattern" && node.typeAnnotation) check(typeOf(node.typeAnnotation), infer(node.right), node.right);
    if (node.type === "RestElement" && node.typeAnnotation && typeOf(node.typeAnnotation).kind !== "array") fail("Rest parameters require an array type", node);
  });
  // Destructuring assignment writes existing bindings, so each leaf is checked against its projection.
  function checkPatternTargets(pattern, value, origin) {
    if (pattern.type === "ArrayPattern") {
      pattern.elements.forEach((item, index) => {
        if (item) checkPatternTargets(item, item.type === "RestElement" ? value : property(value, index), origin);
      });
      return;
    }
    if (pattern.type === "ObjectPattern") {
      pattern.properties.forEach(item => checkPatternTargets(item.value, property(value, item.key.name ?? item.key.value), origin));
      return;
    }
    if (pattern.type === "RestElement") return checkPatternTargets(pattern.argument, value, origin);
    if (contracted(pattern)) check(assignmentType(pattern), value, origin);
  }

  function assignmentType(node) {
    if (node.type === "Identifier") return annotated.get(analysis.resolved.get(node)) ?? infer(node);
    if (node.type === "MemberExpression") {
      const receiver = assignmentType(node.object);
      const key = node.computed ? node.property.value : node.property.name;
      return key !== undefined ? property(receiver, key) : receiver.kind === "array" ? receiver.element : UNKNOWN;
    }
    return infer(node);
  }
  for (const node of assignments) {
    if (["ArrayPattern", "ObjectPattern"].includes(node.left.type)) {
      checkPatternTargets(node.left, infer(node.right), node.right);
      continue;
    }
    const expected = assignmentType(node.left);
    let actual = infer(node.right);
    if (node.update) actual = { kind: "number" };
    else if (node.operator === "+=") actual = expected.kind === "string" || actual.kind === "string" || actual.kind === "literal" && typeof actual.value === "string" ? { kind: "string" } : { kind: "number" };
    else if (node.operator !== "=") actual = { kind: "number" };
    if (node.left.type === "MemberExpression") {
      const receiver = infer(node.left.object);
      if (["instance", "constructor"].includes(receiver.kind)) {
        const key = node.left.computed ? node.left.property.value : node.left.property.name;
        const member = classMember(receiver, key);
        const setter = member && analysis.classContexts.get(member).declaration.members.find(candidate => candidate.static === member.static && candidate.key?.name === key && candidate.kind === "set");
        if (member?.kind === "get" && !setter) fail("Cannot assign to a getter-only property", node.left);
        if (member?.type === "MethodDefinition" && !["get", "set"].includes(member.kind)) fail("Cannot replace a statically checked class method", node.left);
        if (setter?.params[0].typeAnnotation && node.operator === "=") {
          let owner = receiver;
          while (owner.classId !== analysis.classContexts.get(setter).declaration.start) owner = baseType(owner);
          check(substitute(typeOf(setter.params[0].typeAnnotation), classSubstitutions(owner)), actual, node.right);
        } else check(expected, actual, node.right);
        continue;
      }
    }
    if (contracted(node.left)) check(expected, actual, node.right);
  }
  for (const node of calls) {
    let target = node.callee;
    while (target.type === "ParenthesizedExpression") target = target.expression;
    if (target.type === "MemberExpression" && contracted(target.object)) {
      const method = target.computed ? target.property.type === "Literal" ? target.property.value : null : target.property.name;
      const receiver = infer(target.object);
      const members = receiver.kind === "union" ? receiver.members : [receiver];
      for (const member of members) {
        if (member.kind !== "array" || !["push", "unshift", "splice", "fill"].includes(method)) continue;
        const args = flattenArguments(node.arguments);
        if (["splice", "fill"].includes(method) && !args.length) fail(`Array ${method} requires at least one argument`, node);
        if (method === "fill" && args.length > 3) fail("Array fill accepts at most three arguments", node);
        args.forEach((argument, index) => {
          if (argument.type === "SpreadElement" && (method === "fill" || method === "splice" && index < 2)) fail("Dynamic spread cannot fill fixed typed arguments", argument);
          let expected = member.element;
          if (method === "splice" && index === 0) expected = { kind: "number" };
          if (method === "splice" && index === 1 || method === "fill" && index > 0) expected = merge([{ kind: "number" }, UNDEFINED]);
          check(expected, infer(argument), argument);
        });
      }
    }
    let callee = infer(node.callee);
    if (node.type === "NewExpression") {
      if (callee.kind === "constructor") callee = constructorSignature(callee, node);
      else if (callee.kind !== "unknown") fail("new requires a class constructor", node.callee);
    } else if (node.callee.type === "Super") {
      callee = constructorSignature(callee, node);
    } else if (callee.kind === "constructor") fail("Class constructors must be invoked with new", node.callee);
    if (node.callee.type === "MemberExpression" && ["instance", "constructor"].includes(infer(node.callee.object).kind) && !["function", "signature", "unknown"].includes(callee.kind)) fail("Class member is not callable", node.callee);
    if (!["function", "signature"].includes(callee.kind)) continue;
    const contract = callee.kind === "function" ? callSignature(callee.node, node) : callee;
    const argumentsList = flattenArguments(node.arguments);
    if (contract.params.some(param => param.value.kind !== "unknown")) argumentsList.forEach((argument, index) => {
      if (argument.type === "SpreadElement" && (!contract.params.at(-1)?.rest || index < contract.params.length - 1)) fail("Dynamic spread requires a rest parameter after all fixed arguments", argument);
    });
    contract.params.forEach((param, index) => {
      if (param.value.kind === "unknown") return;
      if (param.rest) {
        for (const argument of argumentsList.slice(index)) check(param.value.element, infer(argument), argument);
      } else {
        const argument = argumentsList[index];
        let actual = infer(argument);
        if (actual.kind === "function") actual = signature(actual.node);
        if (!param.optional || actual.kind !== "undefined") check(param.value, actual, argument ?? node);
      }
    });
    if (contract.params.some(param => param.value.kind !== "unknown") && !contract.params.at(-1)?.rest && argumentsList.length > contract.params.length) fail("Too many arguments for the annotated function", node);
  }
  for (const fn of functions) {
    if (!fn.returnType && !contextualResults.has(fn)) continue;
    let expected = fn.returnType ? typeOf(fn.returnType) : contextualResults.get(fn);
    if (!fn.returnType && expected.kind === "void") continue;
    if (fn.async) {
      if (expected.kind !== "promise") fail("Async return annotations require Promise<T>", fn.returnType ?? fn);
      expected = unwrap(expected);
    }
    const values = fn.body.type === "BlockStatement" ? returns(fn.body).map(node => node.argument) : [fn.body];
    for (const value of values) check(expected, fn.async ? unwrap(infer(value)) : infer(value), value ?? fn.returnType ?? fn);
    if (fn.body.type === "BlockStatement" && !terminates(fn.body)) check(expected, UNDEFINED, fn.returnType ?? fn);
  }
}