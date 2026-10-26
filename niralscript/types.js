import { NiralScriptError, sourceLocation } from "./errors.js";

export function readType(parser) {
  function primary() {
    const token = parser.take();
    let value;
    if (token.kind === "(") { value = union(); parser.expect(")"); }
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
    } else parser.error("Expected a primitive, object, array or Promise type", token.start);
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

export function typeAnnotations(node, result = []) {
  if (!node || typeof node !== "object") return result;
  if (node.type === "TypeAnnotation") { result.push(node); return result; }
  for (const [key, value] of Object.entries(node)) {
    if (["source", "sources", "key"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => typeAnnotations(child, result));
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

function accepts(expected, actual) {
  if (expected.kind === "unknown" || actual.kind === "unknown" || actual.kind === "never") return true;
  if (actual.kind === "union") return actual.members.every(value => accepts(expected, value));
  if (expected.kind === "union") return expected.members.some(value => accepts(value, actual));
  if (expected.kind === "void") return actual.kind === "undefined" || actual.kind === "void";
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "array") return accepts(expected.element, actual.element);
  if (expected.kind === "promise") return accepts(expected.result, actual.result);
  if (expected.kind === "object") return Object.entries(expected.properties).every(([name, value]) => accepts(value, Object.hasOwn(actual.properties, name) ? actual.properties[name] : UNDEFINED));
  return true;
}

function describe(value) {
  if (value.kind === "union") return value.members.map(describe).join(" | ");
  if (value.kind === "array") return `(${describe(value.element)})[]`;
  if (value.kind === "promise") return `Promise<${describe(value.result)}>`;
  if (value.kind === "object") return `{ ${Object.entries(value.properties).map(([name, type]) => `${name}: ${describe(type)}`).join(", ")} }`;
  return value.kind;
}

function walk(node, visit) {
  if (!node?.type || node.type === "TypeAnnotation") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["source", "sources", "key"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value?.type) walk(value, visit);
  }
}

export function checkTypes(program, analysis) {
  if (!typeAnnotations(program).length) return;
  const annotated = new Map();
  const declared = new Map(analysis.bindings.map(binding => [binding.id, binding]));
  const functions = [];
  const assignments = [];
  const calls = [];
  const variables = [];
  const fail = (message, node) => { throw new NiralScriptError("NRS080", message, sourceLocation(program, node)); };
  const check = (expected, actual, node) => { if (!accepts(expected, actual)) fail(`Expected ${describe(expected)}, received ${describe(actual)}`, node); };
  function property(value, key) {
    if (value.kind === "union") return merge(value.members.map(member => property(member, key)));
    if (value.kind === "object") return Object.hasOwn(value.properties, key) ? value.properties[key] : UNDEFINED;
    if ((value.kind === "array" || value.kind === "string") && key === "length") return { kind: "number" };
    if (value.kind === "array" && /^(0|[1-9]\d*)$/.test(key)) return value.element;
    if (["null", "undefined"].includes(value.kind)) return UNDEFINED;
    return UNKNOWN;
  }
  function annotate(pattern, value) {
    if (pattern.type === "Identifier") annotated.set(declared.get(pattern), value);
    if (pattern.type === "ArrayPattern") pattern.elements.forEach((item, index) => annotate(item, property(value, index)));
    if (pattern.type === "ObjectPattern") pattern.properties.forEach(item => annotate(item.value, property(value, item.key.name ?? item.key.value)));
  }
  walk(program, node => {
    if (node.typeAnnotation) annotate(node, node.typeAnnotation.value);
    if (["FunctionDeclaration", "ArrowFunctionExpression"].includes(node.type)) functions.push(node);
    if (node.type === "AssignmentStatement") assignments.push(node);
    if (node.type === "CallExpression") calls.push(node);
    if (node.init) variables.push(node);
  });
  function resultOf(fn, seen) {
    if (fn.returnType) return fn.returnType.value;
    const result = fn.body.type === "BlockStatement" ? merge(returns(fn.body).map(node => infer(node.argument, seen)).concat(terminates(fn.body) ? [] : [UNDEFINED])) : infer(fn.body, seen);
    return fn.async ? { kind: "promise", result: unwrap(result) } : result;
  }
  function unwrap(value) {
    return value.kind === "promise" ? unwrap(value.result) : value.kind === "union" ? merge(value.members.map(unwrap)) : value;
  }
  function infer(node, seen = new Set()) {
    if (!node) return UNDEFINED;
    if (seen.has(node)) return UNKNOWN;
    seen = new Set(seen).add(node);
    if (node.type === "Literal") return { kind: node.value === null ? "null" : typeof node.value };
    if (node.type === "Identifier") {
      const binding = analysis.resolved.get(node) ?? declared.get(node);
      if (annotated.has(binding)) return annotated.get(binding);
      const declaration = analysis.declarations.get(binding);
      if (declaration?.type === "FunctionDeclaration") return { kind: "function", node: declaration };
      let value = declaration?.init ? infer(declaration.init, seen) : UNKNOWN;
      for (const key of binding?.path ?? []) value = property(value, key);
      return value;
    }
    if (node.type === "ParenthesizedExpression") return infer(node.expression, seen);
    if (node.type === "ArrowFunctionExpression") return { kind: "function", node };
    if (node.type === "AwaitExpression") return unwrap(infer(node.argument, seen));
    if (node.type === "TemplateLiteral") return { kind: "string" };
    if (node.type === "UnaryExpression") return { kind: node.operator === "typeof" ? "string" : node.operator === "!" ? "boolean" : "number" };
    if (node.type === "BinaryExpression") {
      if (["===", "!==", "<", "<=", ">", ">="].includes(node.operator)) return { kind: "boolean" };
      if (node.operator !== "+") return { kind: "number" };
      const left = infer(node.left, seen);
      const right = infer(node.right, seen);
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
      return key !== null ? property(receiver, key) : receiver.kind === "array" ? receiver.element : UNKNOWN;
    }
    if (node.type === "CallExpression") {
      const callee = infer(node.callee, seen);
      if (callee.kind === "function") return resultOf(callee.node, seen);
      if (node.callee.type === "MemberExpression") {
        const receiver = infer(node.callee.object, seen);
        const method = node.callee.computed ? node.callee.property.value : node.callee.property.name;
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
    if (!node || ["FunctionDeclaration", "ArrowFunctionExpression"].includes(node.type)) return result;
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
    if (node.type === "Identifier") {
      const binding = analysis.resolved.get(node);
      return annotated.has(binding) || contracted(analysis.declarations.get(binding)?.init, seen);
    }
    if (node.type === "MemberExpression") return contracted(node.object, seen);
    if (node.type === "ParenthesizedExpression") return contracted(node.expression, seen);
    if (node.type === "CallExpression") return !!infer(node.callee).node?.returnType;
    return false;
  }
  for (const node of variables) if (node.id.typeAnnotation) check(node.id.typeAnnotation.value, infer(node.init), node.init);
  for (const node of assignments) {
    const expected = infer(node.left);
    let actual = infer(node.right);
    if (node.operator === "+=") actual = expected.kind === "string" || actual.kind === "string" ? { kind: "string" } : UNKNOWN;
    else if (node.operator !== "=") actual = { kind: "number" };
    if (contracted(node.left)) check(expected, actual, node.right);
  }
  for (const node of calls) {
    const callee = infer(node.callee);
    if (callee.kind !== "function") continue;
    callee.node.params.forEach((param, index) => {
      if (param.typeAnnotation) check(param.typeAnnotation.value, infer(node.arguments[index]), node.arguments[index] ?? node);
    });
    if (callee.node.params.some(param => param.typeAnnotation) && node.arguments.length > callee.node.params.length) fail("Too many arguments for the annotated function", node);
  }
  for (const fn of functions) {
    if (!fn.returnType) continue;
    let expected = fn.returnType.value;
    if (fn.async) {
      if (expected.kind !== "promise") fail("Async return annotations require Promise<T>", fn.returnType);
      expected = unwrap(expected);
    }
    const values = fn.body.type === "BlockStatement" ? returns(fn.body).map(node => node.argument) : [fn.body];
    for (const value of values) check(expected, fn.async ? unwrap(infer(value)) : infer(value), value ?? fn.returnType);
    if (fn.body.type === "BlockStatement" && !terminates(fn.body)) check(expected, UNDEFINED, fn.returnType);
  }
}