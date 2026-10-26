import { NiralScriptError, sourceLocation } from "./errors.js";
import { ExpressionParser, patternBindings } from "./expressions.js";
import { checkTypes } from "./types.js";

const EMPTY_CHILDREN = Object.freeze([]);
const CALLBACK_METHODS = new Set(["map", "filter", "find", "findIndex", "some", "every", "forEach", "reduce"]);

export function analyzeNiralScript(program, { globals = [], moduleGlobals = globals, reserved = [], pureGlobals = [], pureMethods = {} } = {}) {
  const bindings = [];
  const references = [];
  const resolved = new WeakMap();
  const declarations = new WeakMap();
  const assignments = [];
  const calls = [];
  const arrows = [];
  const loops = [];
  const catches = [];
  const throws = [];
  const ambient = new Map([...globals].map(name => [name, { name, kind: "global" }]));
  const root = { parent: { bindings: ambient }, bindings: new Map(), depth: 0 };
  const reservedNames = new Set(reserved);
  const modules = new Map();
  const imports = new Map();

  function fail(code, message, node) {
    throw new NiralScriptError(code, message, sourceLocation(program, node));
  }

  function declare(pattern, kind, scope, end = pattern.end, declaration = null) {
    for (const { id, shorthand, path } of patternBindings(pattern)) declareName(id, kind, scope, end, declaration, shorthand, path);
  }

  function declareName(id, kind, scope, end, declaration, shorthand, path) {
    if (scope.bindings.has(id.name) || (scope === root && reservedNames.has(id.name))) {
      fail("NRS073", `Duplicate binding '${id.name}'`, id);
    }
    const binding = { name: id.name, kind, id, shorthand, path, scope, end, index: bindings.length };
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
    if (node.type === "ArrowFunctionExpression") {
      arrows.push(node);
      const inner = { parent: scope, bindings: new Map(), depth: scope.depth + 1, owner: node.body, async: !!node.async };
      for (const param of node.params) declare(param, "parameter", inner);
      if (node.body.type === "BlockStatement") body(node.body.body, inner);
      else expression(node.body, inner, false);
      return;
    }
    if (node.type === "AwaitExpression" && !scope.async) fail("NRS072", "Await is only valid inside an async function", node);
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
      if (node.id && node.type !== "ForOfStatement") declare(node.id, node.kind ?? ({ InputDeclaration: "input", StateDeclaration: "state", DerivedDeclaration: "derive", FunctionDeclaration: "function" })[node.type], scope, node.end, node);
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

  function block(node, scope, functionScope = false, params = [], async = false) {
    const inner = { parent: scope, bindings: new Map(), depth: scope.depth + Number(functionScope), owner: functionScope ? node : scope.owner, async: functionScope ? async : scope.async };
    for (const param of params) declare(param, "parameter", inner);
    body(node.body, inner);
  }

  function statement(node, scope) {
    switch (node.type) {
      case "InputDeclaration":
        if (scope !== root) fail("NRS072", "Inputs are only valid at component top level", node);
        break;
      case "ImportDeclaration":
        break;
      case "StateDeclaration":
      case "DerivedDeclaration":
      case "VariableDeclaration":
        expression(node.init, scope, node.type === "DerivedDeclaration");
        break;
      case "FunctionDeclaration":
        block(node.body, scope, true, node.params, !!node.async);
        break;
      case "BlockStatement":
        block(node, scope);
        break;
      case "ForOfStatement": {
        loops.push(node);
        const inner = { parent: scope, bindings: new Map(), depth: scope.depth, owner: scope.owner, async: scope.async };
        declare(node.id, node.kind, inner, node.right.end, node);
        expression(node.right, inner, false);
        block(node.body, inner);
        break;
      }
      case "IfStatement":
        expression(node.test, scope, false);
        statement(node.consequent, scope);
        if (node.alternate) statement(node.alternate, scope);
        break;
      case "TryStatement":
        statement(node.block, scope);
        if (node.handler) statement(node.handler, scope);
        if (node.finalizer) statement(node.finalizer, scope);
        break;
      case "CatchClause":
        catches.push(node);
        block(node.body, scope, false, node.param ? [node.param] : []);
        break;
      case "ThrowStatement":
        throws.push(node);
        expression(node.argument, scope, false);
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
      case "InputDeclaration":
        return EMPTY_CHILDREN;
      case "Program":
        return node.modules ? [...node.modules, ...node.body] : node.body;
      case "BlockStatement":
        return node.body;
      case "FunctionDeclaration":
      case "ArrowFunctionExpression":
        return [node.body];
      case "StateDeclaration":
      case "DerivedDeclaration":
      case "VariableDeclaration":
        return [node.init];
      case "IfStatement":
        return node.alternate ? [node.test, node.consequent, node.alternate] : [node.test, node.consequent];
      case "TryStatement":
        return [node.block, node.handler, node.finalizer].filter(Boolean);
      case "CatchClause":
        return [node.body];
      case "ThrowStatement":
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
      case "AwaitExpression":
      case "SpreadElement":
        return [node.argument];
      case "ForOfStatement":
        return [node.right, node.body];
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
    if (node?.type === "ArrowFunctionExpression") return node;
    if (node?.type !== "Identifier") return null;
    const binding = resolved.get(node);
    if (!binding || seen.has(binding)) return null;
    seen.add(binding);
    const declaration = declarations.get(binding);
    if (binding.kind === "function") return declaration;
    if (binding.kind === "const" && !binding.path.length) return callable(declaration.init, seen);
    if (binding.kind === "parameter" && !binding.path.length) {
      const values = sources.get(binding) ?? [];
      const targets = values.map(value => callable(value, new Set(seen)));
      return targets.length && targets.every(target => target && target === targets[0]) ? targets[0] : null;
    }
    return null;
  }

  function collectCalls(node) {
    if (node.type === "CallExpression") calls.push(node);
    for (const child of children(node)) collectCalls(child);
  }
  collectCalls(program);
  const sources = new Map();
  const sourceNodes = new Map();
  let sourceCount = 0;
  function addSource(binding, value) {
    if (!binding || !value) return;
    if (!sources.has(binding)) sources.set(binding, []);
    if (!sourceNodes.has(binding)) sourceNodes.set(binding, new Set());
    if (sourceNodes.get(binding).has(value)) return;
    sourceNodes.get(binding).add(value);
    sourceCount++;
    for (const key of binding.path) value = { type: "MemberExpression", object: value, property: { type: "Literal", value: key }, computed: true };
    sources.get(binding).push(value);
  }
  for (const binding of bindings) addSource(binding, declarations.get(binding)?.init);
  for (const assignment of assignments) {
    if (assignment.left.type === "Identifier") addSource(resolved.get(assignment.left), assignment.right);
  }
  function parameterSource(pattern, value) {
    if (pattern) for (const { id } of patternBindings(pattern)) addSource(bindings.find(binding => binding.id === id), value);
  }
  for (const loop of loops) parameterSource(loop.id, { type: "MemberExpression", object: loop.right, computed: false });
  for (const handler of catches) for (const thrown of throws) parameterSource(handler.param, thrown.argument);
  const callbackValues = new Map();
  for (const call of calls) {
    const callee = unwrap(call.callee);
    if (callee.type === "MemberExpression" && !callee.computed && CALLBACK_METHODS.has(callee.property.name)) {
      const element = { type: "MemberExpression", object: callee.object, computed: false };
      const indexValue = { type: "Literal", value: 0 };
      callbackValues.set(call, callee.property.name === "reduce" ? [call.arguments[1] ?? element, element, indexValue, callee.object] : [element, indexValue, callee.object]);
    }
  }
  const returns = new Map();
  let previousCount = -1;
  while (previousCount !== sourceCount) {
    previousCount = sourceCount;
    for (const call of calls) {
      const fn = callable(call.callee);
      if (fn) fn.params.forEach((param, index) => parameterSource(param, call.arguments[index]));
      const callback = callbackValues.has(call) ? callable(call.arguments[0]) : null;
      if (callback) {
        callback.params.forEach((param, index) => parameterSource(param, callbackValues.get(call)[index]));
        if (unwrap(call.callee).property.name === "reduce") for (const value of returnValues(callback)) parameterSource(callback.params[0], value);
      }
    }
  }
  for (const call of calls) {
    if (resolved.get(unwrap(call.callee))?.kind === "parameter" && !callable(call.callee)) fail("NRS075", "Invoked callback parameters require one statically known function", call.callee);
  }
  function returnValues(fn) {
    if (!returns.has(fn)) {
      if (fn.type === "ArrowFunctionExpression" && fn.body.type !== "BlockStatement") {
        returns.set(fn, [fn.body]);
        return returns.get(fn);
      }
      const values = [];
      function collect(node) {
        if (["FunctionDeclaration", "ArrowFunctionExpression"].includes(node.type)) return;
        if (node.type === "ReturnStatement") {
          if (node.argument) values.push(node.argument);
          return;
        }
        for (const child of children(node)) collect(child);
      }
      collect(fn.body);
      returns.set(fn, values);
    }
    return returns.get(fn);
  }
  function readOnlyOrigin(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return null;
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      if (!binding || seen.has(binding)) return null;
      if (binding.kind === "derive" || binding.kind === "input" || binding.kind === "global") return binding;
      seen.add(binding);
      for (const source of sources.get(binding) ?? []) {
        const origin = readOnlyOrigin(source, new Set(seen));
        if (origin) return origin;
      }
    } else if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);
      if (callee.type === "MemberExpression" && !callee.computed) {
        if (["slice", "concat", "filter", "find", "at"].includes(callee.property.name)) {
          const origin = readOnlyOrigin(callee.object, new Set(seen));
          if (origin) return origin;
          if (callee.property.name === "concat") for (const value of node.arguments) {
            const origin = readOnlyOrigin(value, new Set(seen));
            if (origin) return origin;
          }
        }
        if (["map", "reduce"].includes(callee.property.name)) {
          const callback = callable(node.arguments[0]);
          if (callback && !seen.has(callback)) {
            seen.add(callback);
            for (const value of returnValues(callback)) {
              const origin = readOnlyOrigin(value, new Set(seen));
              if (origin) return origin;
            }
          }
          if (callee.property.name === "reduce") return readOnlyOrigin(node.arguments[1], seen);
        }
      }
      const fn = callable(node.callee);
      if (fn && !seen.has(fn)) {
        seen.add(fn);
        for (const value of returnValues(fn)) {
          const origin = readOnlyOrigin(value, new Set(seen));
          if (origin) return origin;
        }
      }
    } else if (node.type === "MemberExpression") return readOnlyOrigin(node.object, seen);
    else if (["ConditionalExpression", "LogicalExpression", "ArrayExpression", "ObjectExpression", "Property", "SpreadElement", "AwaitExpression"].includes(node.type)) {
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
    if (!node) return null;
    if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);
      if (callee.type === "MemberExpression" && !callee.computed && ["map", "filter", "slice", "concat"].includes(callee.property.name) && literalKind(callee.object, seen) === "array") return "array";
    }
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
    if (node.type === "CallExpression") {
      const fn = callable(node.callee);
      if (fn && !seen.has(fn)) {
        seen.add(fn);
        for (const value of returnValues(fn)) origins(value, seen);
      }
      const callee = unwrap(node.callee);
      if (callee.type === "MemberExpression" && !callee.computed && ["map", "filter", "slice", "concat", "find", "at", "reduce"].includes(callee.property.name)) {
        origins(callee.object, seen);
        for (const value of node.arguments) origins(value, seen);
        const callback = callable(node.arguments[0]);
        if (callback && !seen.has(callback)) {
          seen.add(callback);
          for (const value of returnValues(callback)) origins(value, seen);
        }
      }
      return seen;
    }
    if (["ConditionalExpression", "LogicalExpression", "ArrayExpression", "ObjectExpression", "Property", "SpreadElement", "AwaitExpression"].includes(node.type)) {
      for (const child of children(node)) origins(child, seen);
      return seen;
    }
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

  function invoked(call) {
    const direct = callable(call.callee);
    if (direct) return [direct];
    const callee = unwrap(call.callee);
    if (callee.type === "MemberExpression" && !callee.computed && CALLBACK_METHODS.has(callee.property.name) && intrinsic(callee)) {
      const callback = callable(call.arguments[0]);
      if (!callback) fail("NRS075", "Collection callbacks must be statically known functions", call);
      return [callback];
    }
    return [];
  }

  for (const call of calls) {
    const callee = unwrap(call.callee);
    if (callee.type !== "MemberExpression") continue;
    const origin = readOnlyOrigin(callee.object);
    if (["derive", "input"].includes(origin?.kind) && !intrinsic(callee)) fail("NRS074", "Cannot call an unproven method on a read-only value or its alias", callee);
  }

  const dependencies = new Map();
  for (const binding of bindings.filter(binding => binding.kind === "derive")) {
    const dependsOn = new Set();
    const visited = new Set();
    function inspect(node, owner = null) {
      if (!node || ["FunctionDeclaration", "ArrowFunctionExpression"].includes(node.type)) return;
      if (node.type === "AwaitExpression") fail("NRS075", "Derived evaluation must remain synchronous", node);
      if (node.type === "ThrowStatement") fail("NRS075", "Derived evaluation cannot explicitly throw", node);
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
        const targets = invoked(node);
        if (!targets.length && !intrinsic(node.callee)) fail("NRS075", "Derived evaluation requires a provably pure function call", node.callee);
        for (const fn of targets) if (!visited.has(fn)) {
          if (fn.async) fail("NRS075", "Derived evaluation cannot invoke async functions", node.callee);
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

  function initialized(node, position, seen = new Set(), active = new Map(), owner = null) {
    if (!node || ["FunctionDeclaration", "ArrowFunctionExpression"].includes(node.type)) return;
    if (owner) active.set(owner, node.start);
    if (node.type === "BlockStatement" && !owner) {
      for (const child of node.body) initialized(child, child.start, seen, active);
      return;
    }
    if (node.type === "ForOfStatement" && !owner) {
      initialized(node.right, position, seen, active);
      initialized(node.body, node.body.start, seen, active);
      return;
    }
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      const currentPosition = binding?.scope?.depth === 0 ? position : active.get(binding?.scope?.owner);
      if (currentPosition !== undefined && !["function", "parameter"].includes(binding.kind)) {
        if (binding.end > currentPosition) fail("NRS074", `Call reads '${binding.name}' before initialization`, node);
        if (binding.kind === "derive" && !seen.has(binding)) {
          seen.add(binding);
          initialized(declarations.get(binding).init, position, seen, active);
        }
      }
      return;
    }
    if (node.type === "CallExpression") {
      for (const fn of invoked(node)) if (!seen.has(fn)) {
        seen.add(fn);
        initialized(fn.body, position, seen, new Map(active), fn.body);
      }
    }
    for (const child of children(node)) initialized(child, position, seen, active, owner);
  }
  for (const module of [...(program.modules ?? []), program]) {
    for (const node of module.body) initialized(node, node.start);
  }
  const analysis = { bindings, references, root, imports, arrows, resolved, declarations };
  checkTypes(program, analysis);
  return analysis;
}