import { NiralScriptError, sourceLocation } from "./errors.js";
import { ExpressionParser } from "./expressions.js";

const EMPTY_CHILDREN = Object.freeze([]);

export function analyzeNiralScript(program, { globals = [], moduleGlobals = globals, reserved = [], pureGlobals = [], pureMethods = {} } = {}) {
  const bindings = [];
  const references = [];
  const resolved = new WeakMap();
  const declarations = new WeakMap();
  const assignments = [];
  const calls = [];
  const ambient = new Map([...globals].map(name => [name, { name, kind: "global" }]));
  const root = { parent: { bindings: ambient }, bindings: new Map(), depth: 0 };
  const reservedNames = new Set(reserved);
  const modules = new Map();
  const imports = new Map();

  function fail(code, message, node) {
    throw new NiralScriptError(code, message, sourceLocation(program, node));
  }

  function declare(id, kind, scope, end = id.end, declaration = null) {
    if (scope.bindings.has(id.name) || (scope === root && reservedNames.has(id.name))) {
      fail("NRS073", `Duplicate binding '${id.name}'`, id);
    }
    const binding = { name: id.name, kind, id, scope, end, index: bindings.length };
    bindings.push(binding);
    scope.bindings.set(id.name, binding);
    if (declaration) declarations.set(binding, declaration);
  }

  function reference(node, scope, deferred, shorthand = false) {
    const token = node.raw === undefined ? node : new ExpressionParser(program.source, program.filename, node.start, node.end).take();
    let binding;
    for (let current = scope; current && !binding; current = current.parent) binding = current.bindings.get(node.name);
    if (!binding) fail("NRS073", `Unresolved name '${node.name}'`, token);
    if (!deferred && binding.scope?.depth === scope.depth && !["function", "parameter"].includes(binding.kind) && token.start < binding.end) {
      fail("NRS074", `Cannot read '${node.name}' before initialization`, token);
    }
    references.push({ node: token, binding, shorthand, localName: node.name });
    resolved.set(node, binding);
    return binding;
  }

  function expression(node, scope, deferred, shorthand = false) {
    if (!node) return;
    if (node.type === "Identifier") return reference(node, scope, deferred, shorthand);
    if (node.type === "MemberExpression") {
      expression(node.object, scope, deferred);
      if (node.computed) expression(node.property, scope, deferred);
    } else if (node.type === "Property") {
      expression(node.value, scope, deferred, node.shorthand);
    } else {
      for (const child of children(node)) expression(child, scope, deferred);
    }
  }

  function body(nodes, scope) {
    for (const node of nodes) {
      if (node.id) declare(node.id, node.kind ?? ({ StateDeclaration: "state", DerivedDeclaration: "derive", FunctionDeclaration: "function" })[node.type], scope, node.end, node);
    }
    for (const node of nodes) {
      if (node.type !== "ImportDeclaration") continue;
      const target = modules.get(node.target);
      if (!target) fail("NRS078", "Module imports must be linked before analysis", node);
      for (const specifier of node.specifiers) {
        const binding = target.bindings.get(specifier.imported.name);
        if (!binding || !declarations.get(binding)?.exported || binding.scope !== target) fail("NRS078", `Module does not export '${specifier.imported.name}'`, specifier.imported);
        if (scope.bindings.has(specifier.local.name) || (scope === root && reservedNames.has(specifier.local.name))) fail("NRS073", `Duplicate binding '${specifier.local.name}'`, specifier.local);
        scope.bindings.set(specifier.local.name, binding);
        imports.set(specifier, { binding, scope });
      }
    }
    for (const node of nodes) statement(node, scope);
  }

  function block(node, scope, functionScope = false, params = []) {
    const inner = { parent: scope, bindings: new Map(), depth: scope.depth + Number(functionScope), owner: functionScope ? node : scope.owner };
    for (const param of params) declare(param, "parameter", inner);
    body(node.body, inner);
  }

  function statement(node, scope) {
    switch (node.type) {
      case "ImportDeclaration":
        break;
      case "StateDeclaration":
      case "DerivedDeclaration":
      case "VariableDeclaration":
        expression(node.init, scope, node.type === "DerivedDeclaration");
        break;
      case "FunctionDeclaration":
        block(node.body, scope, true, node.params);
        break;
      case "BlockStatement":
        block(node, scope);
        break;
      case "IfStatement":
        expression(node.test, scope, false);
        statement(node.consequent, scope);
        if (node.alternate) statement(node.alternate, scope);
        break;
      case "ReturnStatement":
        expression(node.argument, scope, false);
        break;
      case "ExpressionStatement":
        expression(node.expression, scope, false);
        break;
      case "AssignmentStatement": {
        assignments.push(node);
        expression(node.left, scope, false);
        let target = node.left;
        while (target.type === "MemberExpression" || target.type === "ParenthesizedExpression") target = target.object ?? target.expression;
        if (target.type === "Identifier") {
          const binding = references.findLast(entry => entry.node.start === target.start)?.binding;
          if (binding && (binding.kind === "derive" || (node.left.type === "Identifier" && !["state", "let", "parameter"].includes(binding.kind)))) {
            fail("NRS074", `Cannot assign to read-only binding '${target.name}'`, target);
          }
        }
        expression(node.right, scope, false);
        break;
      }
      default:
        throw new TypeError(`Unsupported NiralScript declaration '${node.type}'`);
    }
  }

  for (const module of program.modules ?? []) {
    const scope = { parent: { bindings: new Map([...moduleGlobals].map(name => [name, { name, kind: "global" }])) }, bindings: new Map(), depth: 0, module: true };
    body(module.body, scope);
    modules.set(module.filename, scope);
  }
  body(program.body, root);

  function children(node) {
    switch (node.type) {
      case "Identifier":
      case "Literal":
      case "TemplateElement":
      case "ImportDeclaration":
        return EMPTY_CHILDREN;
      case "Program":
        return node.modules ? [...node.modules, ...node.body] : node.body;
      case "BlockStatement":
        return node.body;
      case "FunctionDeclaration":
        return [node.body];
      case "StateDeclaration":
      case "DerivedDeclaration":
      case "VariableDeclaration":
        return [node.init];
      case "IfStatement":
        return node.alternate ? [node.test, node.consequent, node.alternate] : [node.test, node.consequent];
      case "ReturnStatement":
        return node.argument ? [node.argument] : EMPTY_CHILDREN;
      case "ExpressionStatement":
      case "ParenthesizedExpression":
        return [node.expression];
      case "AssignmentStatement":
      case "BinaryExpression":
      case "LogicalExpression":
        return [node.left, node.right];
      case "ConditionalExpression":
        return [node.test, node.consequent, node.alternate];
      case "UnaryExpression":
        return [node.argument];
      case "MemberExpression":
        return node.computed ? [node.object, node.property] : [node.object];
      case "CallExpression":
        return [node.callee, ...node.arguments];
      case "ArrayExpression":
        return node.elements;
      case "ObjectExpression":
        return node.properties;
      case "Property":
        return [node.value];
      case "TemplateLiteral":
        return node.expressions;
      default:
        throw new TypeError(`Unsupported NiralScript node '${node.type}'`);
    }
  }

  function unwrap(node) {
    while (node?.type === "ParenthesizedExpression") node = node.expression;
    return node;
  }

  function callable(node, seen = new Set()) {
    node = unwrap(node);
    if (node?.type !== "Identifier") return null;
    const binding = resolved.get(node);
    if (!binding || seen.has(binding)) return null;
    seen.add(binding);
    const declaration = declarations.get(binding);
    if (binding.kind === "function") return declaration;
    return binding.kind === "const" ? callable(declaration.init, seen) : null;
  }

  function collectCalls(node) {
    if (node.type === "CallExpression") calls.push(node);
    for (const child of children(node)) collectCalls(child);
  }
  collectCalls(program);
  const sources = new Map();
  function addSource(binding, value) {
    if (!binding || !value) return;
    if (!sources.has(binding)) sources.set(binding, []);
    sources.get(binding).push(value);
  }
  for (const binding of bindings) addSource(binding, declarations.get(binding)?.init);
  for (const assignment of assignments) {
    if (assignment.left.type === "Identifier") addSource(resolved.get(assignment.left), assignment.right);
  }
  for (const call of calls) {
    const fn = callable(call.callee);
    if (fn) fn.params.forEach((param, index) => addSource(bindings.find(binding => binding.id === param), call.arguments[index]));
  }
  function readOnlyOrigin(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return null;
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      if (!binding || seen.has(binding)) return null;
      if (binding.kind === "derive" || binding.kind === "global") return binding;
      seen.add(binding);
      for (const source of sources.get(binding) ?? []) {
        const origin = readOnlyOrigin(source, new Set(seen));
        if (origin) return origin;
      }
    } else if (node.type === "MemberExpression") return readOnlyOrigin(node.object, seen);
    else if (["ConditionalExpression", "ArrayExpression", "ObjectExpression", "Property"].includes(node.type)) {
      for (const child of children(node)) {
        const origin = readOnlyOrigin(child, new Set(seen));
        if (origin) return origin;
      }
    }
    return null;
  }
  for (const assignment of assignments) {
    if (assignment.left.type !== "MemberExpression") continue;
    const origin = readOnlyOrigin(assignment.left);
    if (origin) fail("NRS074", `Cannot mutate an alias of read-only binding '${origin.name}'`, assignment.left);
  }

  function literalKind(node, seen = new Set()) {
    node = unwrap(node);
    if (node.type === "ArrayExpression") return "array";
    if (node.type === "TemplateLiteral" || (node.type === "Literal" && typeof node.value === "string")) return "string";
    if (node.type !== "Identifier") return null;
    const binding = resolved.get(node);
    if (!binding || seen.has(binding)) return null;
    seen.add(binding);
    const values = sources.get(binding) ?? [];
    const kinds = values.map(value => literalKind(value, new Set(seen)));
    return kinds.length && kinds.every(kind => kind === kinds[0]) ? kinds[0] : null;
  }

  const pure = new Set(pureGlobals);
  const methods = Object.fromEntries(Object.entries(pureMethods).map(([kind, names]) => [kind, new Set(names)]));
  function origins(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return seen;
    if (node.type === "MemberExpression") return origins(node.object, seen);
    const binding = resolved.get(node);
    if (binding && !seen.has(binding)) {
      seen.add(binding);
      for (const value of sources.get(binding) ?? []) origins(value, seen);
    }
    return seen;
  }
  const modifiedObjects = assignments.filter(node => node.left.type === "MemberExpression").map(node => origins(node.left));
  function intrinsic(node) {
    node = unwrap(node);
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      return binding?.kind === "global" && pure.has(binding.name);
    }
    if (node.type !== "MemberExpression" || node.computed) return false;
    const object = unwrap(node.object);
    const binding = resolved.get(object);
    const aliases = origins(object);
    if (modifiedObjects.some(modified => [...aliases].some(alias => modified.has(alias)))) return false;
    return (binding?.kind === "global" && pure.has(`${binding.name}.${node.property.name}`)) || methods[literalKind(object)]?.has(node.property.name);
  }

  for (const call of calls) {
    const callee = unwrap(call.callee);
    if (callee.type !== "MemberExpression") continue;
    const origin = readOnlyOrigin(callee.object);
    if (origin?.kind === "derive" && !intrinsic(callee)) fail("NRS074", "Cannot call an unproven method on a derived value or its alias", callee);
  }

  const dependencies = new Map();
  for (const binding of bindings.filter(binding => binding.kind === "derive")) {
    const dependsOn = new Set();
    const visited = new Set();
    function inspect(node, owner = null) {
      if (!node || node.type === "FunctionDeclaration") return;
      if (node.type === "Identifier") {
        const target = resolved.get(node);
        if (target?.kind === "derive") dependsOn.add(target);
        return;
      }
      if (node.type === "AssignmentStatement") {
        const target = resolved.get(node.left);
        if (node.left.type !== "Identifier" || !owner || target?.scope?.owner !== owner || !["let", "parameter"].includes(target.kind)) {
          fail("NRS075", "Derived evaluation cannot mutate captured bindings or objects", node.left);
        }
      }
      if (node.type === "CallExpression") {
        const fn = callable(node.callee);
        if (!fn && !intrinsic(node.callee)) fail("NRS075", "Derived evaluation requires a provably pure function call", node.callee);
        if (fn && !visited.has(fn)) {
          visited.add(fn);
          inspect(fn.body, fn.body);
        }
      }
      for (const child of children(node)) inspect(child, owner);
    }
    inspect(declarations.get(binding).init);
    dependencies.set(binding, dependsOn);
  }
  const done = new Set();
  function visit(binding, path = []) {
    if (path.includes(binding)) fail("NRS076", `Derived dependency cycle: ${[...path, binding].map(item => item.name).join(" -> ")}`, binding.id);
    if (done.has(binding)) return;
    for (const dependency of dependencies.get(binding) ?? []) visit(dependency, [...path, binding]);
    done.add(binding);
  }
  for (const binding of dependencies.keys()) visit(binding);

  function initialized(node, position, seen = new Set()) {
    if (!node || node.type === "FunctionDeclaration") return;
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      if ((binding?.scope === root || binding?.scope?.module) && !["function", "parameter"].includes(binding.kind)) {
        if (binding.end > position) fail("NRS074", `Call reads '${binding.name}' before initialization`, node);
        if (binding.kind === "derive" && !seen.has(binding)) {
          seen.add(binding);
          initialized(declarations.get(binding).init, position, seen);
        }
      }
      return;
    }
    if (node.type === "CallExpression") {
      const fn = callable(node.callee);
      if (fn && !seen.has(fn)) {
        seen.add(fn);
        initialized(fn.body, position, seen);
      }
    }
    for (const child of children(node)) initialized(child, position, seen);
  }
  for (const module of [...(program.modules ?? []), program]) {
    for (const node of module.body) initialized(node, node.start);
  }
  return { bindings, references, root, imports };
}