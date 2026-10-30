import { NiralScriptError, sourceLocation } from "./errors.js";
import { ExpressionParser, patternBindings, patternExpressions } from "./expressions.js";
import { checkTypes } from "./types.js";

const EMPTY_CHILDREN = Object.freeze([]);
const CALLBACK_METHODS = new Set(["map", "filter", "find", "findIndex", "some", "every", "forEach", "reduce"]);
// Hoisted so the hot traversals test membership without allocating a literal per node.
const FUNCTION_LIKE = new Set(["FunctionDeclaration", "ArrowFunctionExpression", "MethodDefinition"]);
const SCOPE_LIKE = new Set(["FunctionDeclaration", "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression", "MethodDefinition"]);
const INVOCATIONS = new Set(["CallExpression", "NewExpression"]);
const EFFECT_NODES = new Set(["CallExpression", "NewExpression", "MemberExpression", "AssignmentStatement"]);
const RECEIVERS = new Set(["ThisExpression", "Super"]);

export function analyzeNiralScript(program, { globals = [], moduleGlobals = globals, reserved = [], pureGlobals = [], pureMethods = {}, strictTypes = false } = {}) {
  const bindings = [];
  const references = [];
  const resolved = new WeakMap();
  const initializedPatternReads = new WeakSet();
  const declarations = new WeakMap();
  const assignments = [];
  const calls = [];
  const arrows = [];
  const loops = [];
  const catches = [];
  const throws = [];
  const defaultSources = [];
  const ambient = new Map([...globals].map(name => [name, { name, kind: "global" }]));
  const root = { parent: { bindings: ambient }, bindings: new Map(), depth: 0 };
  const reservedNames = new Set(reserved);
  const modules = new Map();
  const imports = new Map();
  const classes = [];
  const classContexts = new WeakMap();
  const receiverSources = new Map();

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
    if (scope.pendingParameters?.has(binding)) fail("NRS074", `Cannot read '${node.name}' before parameter initialization`, token);
    if (!deferred && binding.scope?.depth === scope.depth && !scope.initializedPatterns?.has(binding) && binding.kind !== "function" && binding.kind !== "parameter" && token.start < binding.end) {
      fail("NRS074", `Cannot read '${node.name}' before initialization`, token);
    }
    references.push({ node: token, binding, shorthand, localName: node.name });
    if (scope.initializedPatterns?.has(binding)) initializedPatternReads.add(node);
    resolved.set(node, binding);
    return binding;
  }

  function expression(node, scope, deferred, shorthand = false) {
    if (!node) return;
    if (node.type === "ArrowFunctionExpression") {
      arrows.push(node);
      const inner = { parent: scope, bindings: new Map(), depth: scope.depth + 1, owner: node.body, async: !!node.async, receiver: scope.receiver };
      for (const param of node.params) declare(param, "parameter", inner);
      parameterDefaults(node.params, inner);
      if (node.body.type === "BlockStatement") body(node.body.body, inner);
      else expression(node.body, inner, false);
      return;
    }
    if (node.type === "AwaitExpression" && !scope.async) fail("NRS072", "Await is only valid inside an async function", node);
    if (RECEIVERS.has(node.type)) {
      if (!scope.receiver) fail("NRS072", `${node.type === "Super" ? "super" : "this"} is only valid in a class member`, node);
      if (node.type === "Super" && !scope.receiver.declaration.superClass) fail("NRS072", "super requires a base class", node);
      classContexts.set(node, scope.receiver);
      return;
    }
    if (node.type === "CallExpression" && node.callee.type === "Super" && (scope.receiver?.member.kind !== "constructor" || scope.receiver.member.static)) fail("NRS072", "super() is only valid in a derived constructor", node);
    if (node.type === "ClassExpression") {
      // optional name is scoped inside the class expression only
      const inner = { parent: scope, bindings: new Map(), depth: scope.depth, owner: scope.owner, async: scope.async, receiver: scope.receiver };
      if (node.id) declareName(node.id, "class", inner, node.end, node);
      classes.push(node);
      expression(node.superClass, scope, false);
      for (const member of node.members) {
        const receiver = { declaration: node, member };
        classContexts.set(member, receiver);
        if (member.type === "StaticBlock") block(member.body, scope, true, [], false, receiver);
        else if (member.type === "MethodDefinition") block(member.body, scope, true, member.params, member.async, receiver);
        else expression(member.value, { ...scope, receiver, depth: scope.depth + 1, async: false }, !member.static);
      }
      return;
    }
    if (node.type === "Identifier") return reference(node, scope, deferred, shorthand);
    if (node.type === "MemberExpression") {
      if (!node.computed && node.property.name.startsWith("#")) {
        if (node.object.type === "Super") fail("NRS072", "super cannot access private members", node);
        const declaration = scope.receiver?.declaration;
        if (!declaration?.members.some(member => member.key?.name === node.property.name)) fail("NRS073", "Private member is not declared in this class", node.property);
      }
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
      if (node.id && !["ForOfStatement", "TypeAliasDeclaration", "InterfaceDeclaration"].includes(node.type)) declare(node.id, node.kind ?? ({ InputDeclaration: "input", StateDeclaration: "state", DerivedDeclaration: "derive", FunctionDeclaration: "function", ClassDeclaration: "class" })[node.type], scope, node.end, node);
    }
    for (const node of nodes) {
      if (node.type !== "ImportDeclaration" || node.typeOnly) continue;
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

  function block(node, scope, functionScope = false, params = [], async = false, receiver = functionScope ? null : scope.receiver) {
    const inner = { parent: scope, bindings: new Map(), depth: scope.depth + Number(functionScope), owner: functionScope ? node : scope.owner, async: functionScope ? async : scope.async, receiver };
    for (const param of params) declare(param, "parameter", inner);
    parameterDefaults(params, inner);
    body(node.body, inner);
  }

  function parameterDefaults(params, scope) {
    scope.pendingParameters = new Set(params.flatMap(patternBindings).map(({ id }) => scope.bindings.get(id.name)));
    scope.initializedPatterns = new Set();
    function initialize(pattern) {
      if (!pattern) return;
      if (pattern.type === "AssignmentPattern") {
        expression(pattern.right, scope, false);
        defaultSources.push([pattern.left, pattern.right]);
        initialize(pattern.left);
      } else if (pattern.type === "RestElement") initialize(pattern.argument);
      else if (pattern.type === "Identifier") {
        const binding = scope.bindings.get(pattern.name);
        scope.pendingParameters.delete(binding);
        scope.initializedPatterns.add(binding);
      } else for (const item of pattern.elements ?? pattern.properties) initialize(item?.value ?? item);
    }
    params.forEach(initialize);
    scope.pendingParameters = null;
    scope.initializedPatterns = null;
  }

  function statement(node, scope) {
    switch (node.type) {
      case "InputDeclaration":
        if (scope !== root) fail("NRS072", "Inputs are only valid at component top level", node);
        break;
      case "ImportDeclaration":
      case "TypeAliasDeclaration":
      case "InterfaceDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        break;
      case "StateDeclaration":
      case "DerivedDeclaration":
      case "VariableDeclaration":
        expression(node.init, scope, node.type === "DerivedDeclaration");
        parameterDefaults([node.id], scope);
        break;
      case "FunctionDeclaration":
        block(node.body, scope, true, node.params, !!node.async);
        break;
      case "ClassDeclaration":
      case "ClassExpression": {
        classes.push(node);
        expression(node.superClass, scope, false);
        for (const member of node.members) {
          const receiver = { declaration: node, member };
          classContexts.set(member, receiver);
          if (member.type === "StaticBlock") block(member.body, scope, true, [], false, receiver);
          else if (member.type === "MethodDefinition") block(member.body, scope, true, member.params, member.async, receiver);
          else expression(member.value, { ...scope, receiver, depth: scope.depth + 1, async: false }, !member.static);
          if (member.kind === "constructor") {
            function construction(node, states, nested = false) {
              if (!node || !states.size) return states;
              if (["FunctionDeclaration", "ClassDeclaration", "ClassExpression"].includes(node.type)) return states;
              if (node.type === "ArrowFunctionExpression") { construction(node.body, states, true); return states; }
              if ((node.type === "ThisExpression" || node.type === "MemberExpression" && node.object.type === "Super") && states.has(false)) fail("NRS074", "Cannot use this or a super member before super()", node);
              if (node.type === "ReturnStatement" && node.argument && node.argument.type !== "ThisExpression") fail("NRS072", "Class constructors initialize this; return replacement objects from a factory method", node);
              if (node.type === "CallExpression" && node.callee.type === "Super") {
                if (nested || states.has(true)) fail("NRS074", "super() must initialize a derived constructor exactly once on each path", node);
                for (const argument of node.arguments) states = construction(argument, states, nested);
                if (states.has(true)) fail("NRS074", "super() must initialize a derived constructor exactly once on each path", node);
                return new Set([true]);
              }
              if (["IfStatement", "ConditionalExpression"].includes(node.type)) {
                states = construction(node.test, states, nested);
                return new Set([...construction(node.consequent, states, nested), ...construction(node.alternate, states, nested)]);
              }
              if (node.type === "LogicalExpression") {
                states = construction(node.left, states, nested);
                return new Set([...states, ...construction(node.right, states, nested)]);
              }
              if (["ForStatement", "ForOfStatement", "WhileStatement", "TryStatement"].includes(node.type)) {
                for (const child of children(node)) construction(child, states, true);
                return states;
              }
              if (node.type === "ReturnStatement" && states.has(false)) fail("NRS074", "Derived constructors must call super() before returning", node);
              for (const child of children(node)) states = construction(child, states, nested);
              return ["ReturnStatement", "ThrowStatement"].includes(node.type) ? new Set() : states;
            }
            for (const value of member.params.flatMap(patternExpressions)) construction(value, new Set([!node.superClass]), true);
            if (construction(member.body, new Set([!node.superClass])).has(false)) fail("NRS074", "Derived constructors must call super() on every path", member);
          }
        }
        break;
      }
      case "BlockStatement":
        block(node, scope);
        break;
      case "ForOfStatement": {
        loops.push(node);
        const inner = { parent: scope, bindings: new Map(), depth: scope.depth, owner: scope.owner, async: scope.async, receiver: scope.receiver };
        declare(node.id, node.kind, inner, node.right.end, node);
        expression(node.right, inner, false);
        parameterDefaults([node.id], inner);
        block(node.body, inner);
        break;
      }
      case "ForStatement": {
        const inner = { parent: scope, bindings: new Map(), depth: scope.depth, owner: scope.owner, async: scope.async, receiver: scope.receiver };
        if (node.init?.type === "VariableDeclaration") declare(node.init.id, node.init.kind, inner, node.init.end, node.init);
        if (node.init) statement(node.init, inner);
        expression(node.test, inner, false);
        if (node.update) statement(node.update, inner);
        block(node.body, inner);
        break;
      }
      case "WhileStatement":
        expression(node.test, scope, false);
        block(node.body, scope);
        break;
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
        if (scope.receiver?.member.type === "StaticBlock" && scope.owner === scope.receiver.member.body) fail("NRS072", "Static blocks cannot return", node);
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
      case "ThisExpression":
      case "Super":
      case "Literal":
      case "TemplateElement":
      case "ImportDeclaration":
      case "TypeAliasDeclaration":
      case "InterfaceDeclaration":
      case "InputDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        return EMPTY_CHILDREN;
      case "Program":
        return node.modules ? [...node.modules, ...node.body] : node.body;
      case "BlockStatement":
        return node.body;
      case "FunctionDeclaration":
      case "MethodDefinition":
      case "ArrowFunctionExpression":
        return [...node.params.flatMap(patternExpressions), node.body];
      case "ClassDeclaration":
      case "ClassExpression": return [node.superClass, ...node.members].filter(Boolean);
      case "StaticBlock": return [node.body];
      case "PropertyDefinition": return node.value ? [node.value] : EMPTY_CHILDREN;
      case "StateDeclaration":
      case "DerivedDeclaration":
      case "VariableDeclaration":
        return [node.init, ...patternExpressions(node.id)];
      case "IfStatement":
        return node.alternate ? [node.test, node.consequent, node.alternate] : [node.test, node.consequent];
      case "TryStatement":
        return [node.block, node.handler, node.finalizer].filter(Boolean);
      case "CatchClause":
        return [...patternExpressions(node.param), node.body];
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
      case "ContractExpression":
      case "SpreadElement":
        return [node.argument];
      case "CastExpression":
        return [node.expression];
      case "ForOfStatement":
        return [node.right, ...patternExpressions(node.id), node.body];
      case "ForStatement":
        return [node.init, node.test, node.body, node.update].filter(Boolean);
      case "WhileStatement":
        return [node.test, node.body];
      case "MemberExpression":
        return node.computed ? [node.object, node.property] : [node.object];
      case "CallExpression":
      case "NewExpression":
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
    if (node?.type === "Super") return constructorOf(baseOf(classContexts.get(node)?.declaration));
    if (node?.type === "MemberExpression") {
      const member = memberOf(node, seen);
      return member?.type === "MethodDefinition" ? member : member?.value?.type === "ArrowFunctionExpression" ? member.value : null;
    }
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

  function collectCalls(node, parent) {
    if (node.type === "Super" && !(parent?.type === "MemberExpression" && parent.object === node || parent?.type === "CallExpression" && parent.callee === node)) fail("NRS072", "super requires a member access or constructor call", node);
    if (INVOCATIONS.has(node.type)) calls.push(node);
    for (const child of children(node)) collectCalls(child, node);
  }
  collectCalls(program);
  const sources = new Map();
  const returns = new Map();
  function classOf(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (node.type === "ThisExpression") return classContexts.get(node)?.declaration;
    if (node.type === "Super") return baseOf(classContexts.get(node)?.declaration);
    if (node.type === "NewExpression") return classOf(node.callee, seen);
    if (node.type === "CallExpression") {
      const fn = callable(node.callee, new Set(seen));
      if (fn) {
        const candidates = returnValues(fn).map(value => classOf(value, new Set(seen)));
        return candidates.length && candidates.every(value => value === candidates[0]) ? candidates[0] : null;
      }
    }
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      const declaration = declarations.get(binding);
      if (declaration?.type === "ClassDeclaration" || declaration?.type === "ClassExpression") return declaration;
      const candidates = (sources.get(binding) ?? []).map(value => classOf(value, new Set(seen)));
      return candidates.length && candidates.every(value => value === candidates[0]) ? candidates[0] : null;
    }
    return null;
  }
  function baseOf(declaration) { return declaration?.superClass ? classOf(declaration.superClass) : null; }
  function constructorOf(declaration) { return declaration?.members.find(member => member.kind === "constructor") ?? (declaration ? constructorOf(baseOf(declaration)) : null); }
  function isStaticReceiver(node) {
    node = unwrap(node);
    if (RECEIVERS.has(node?.type)) return !!classContexts.get(node)?.member.static;
    return node?.type === "Identifier" && resolved.get(node)?.kind === "class";
  }
  function memberOf(node, resolving = new Set()) {
    const key = node.computed ? node.property?.value : node.property?.name;
    let declaration = classOf(node.object, resolving);
    const isStatic = isStaticReceiver(node.object);
    const seen = new Set();
    while (declaration && !seen.has(declaration)) {
      seen.add(declaration);
      const member = declaration.members.find(member => member.static === isStatic && member.key?.name === String(key));
      if (member) return member;
      declaration = baseOf(declaration);
    }
    return null;
  }
  function retainedValues(declaration) {
    const values = [];
    for (let current = declaration; current; current = baseOf(current)) {
      for (const member of current.members) if (member.type === "PropertyDefinition" && !member.static && member.value) values.push(member.value);
      for (const assignment of assignments) if (assignment.left.type === "MemberExpression" && assignment.left.object.type === "ThisExpression" && classContexts.get(assignment.left.object)?.declaration === current) values.push(assignment.right);
    }
    return values;
  }
  function accessorOf(node, kind) {
    const member = memberOf(node);
    if (!member || !["get", "set"].includes(member.kind)) return null;
    return classContexts.get(member).declaration.members.find(candidate => candidate.static === member.static && candidate.key?.name === member.key.name && candidate.kind === kind);
  }
  function collectAccessors(node, parent) {
    if (node.type === "MemberExpression") {
      const assignment = parent?.type === "AssignmentStatement" && parent.left === node;
      const kind = assignment ? "set" : "get";
      const fn = accessorOf(node, kind);
      if (fn) calls.push({ type: "CallExpression", callee: node, arguments: assignment ? [parent.right] : [], accessor: fn });
    }
    for (const child of children(node)) collectAccessors(child, node);
  }
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
  for (const [pattern, value] of defaultSources) parameterSource(pattern, value);
  collectAccessors(program);
  const argumentSources = new Map(calls.map(call => [call, call.arguments.flatMap(argument => argument.type === "SpreadElement" ? argument.argument.type === "ArrayExpression" ? argument.argument.elements : [{ type: "MemberExpression", object: argument.argument, computed: false }] : [argument])]));
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
  let previousCount = -1;
  while (previousCount !== sourceCount) {
    previousCount = sourceCount;
    for (const call of calls) {
      const fn = call.accessor ?? (call.type === "NewExpression" ? constructorOf(classOf(call.callee)) : callable(call.callee));
      if (fn && (call.type === "NewExpression" || call.callee.type === "MemberExpression")) {
        if (!receiverSources.has(fn)) receiverSources.set(fn, new Set());
        receiverSources.get(fn).add(call.type === "NewExpression" ? call : call.callee.object);
      }
      if (fn) fn.params.forEach((param, index) => {
        const args = argumentSources.get(call);
        for (const value of patternExpressions(param)) parameterSource(param, value);
        const values = call.arguments.some(argument => argument.type === "SpreadElement") || param.type === "RestElement" ? args : [args[index]];
        for (const value of values) parameterSource(param, value);
      });
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
        if (["FunctionDeclaration", "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression", "MethodDefinition"].includes(node.type)) return;
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
    if (seen.has(node)) return null;
    seen.add(node);
    if (node.type === "ThisExpression") {
      for (const receiver of receiverSources.get(classContexts.get(node)?.member) ?? []) {
        const origin = readOnlyOrigin(receiver, new Set(seen));
        if (origin) return origin;
      }
    }
    if (node.type === "NewExpression") {
      for (const value of [...node.arguments, ...retainedValues(classOf(node.callee))]) {
        const origin = readOnlyOrigin(value, new Set(seen));
        if (origin) return origin;
      }
    }
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
    } else if (node.type === "MemberExpression") {
      const getter = accessorOf(node, "get");
      if (getter && !seen.has(getter)) {
        seen.add(getter);
        for (const value of returnValues(getter)) {
          const origin = readOnlyOrigin(value, new Set(seen));
          if (origin) return origin;
        }
      }
      return readOnlyOrigin(node.object, seen);
    }
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
    if (assignment.left.object.type === "ThisExpression" && classContexts.get(assignment.left.object)?.member.kind === "constructor") continue;
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
    if (call.type === "NewExpression") {
      const declaration = classOf(call.callee);
      const targets = [];
      const constructor = constructorOf(declaration);
      if (constructor) targets.push(constructor);
      for (let current = declaration; current; current = baseOf(current)) {
        for (const field of current.members.filter(member => member.type === "PropertyDefinition" && !member.static && member.value)) targets.push({ params: [], body: field.value });
      }
      return targets;
    }
    if (call.type === "MemberExpression") {
      const member = accessorOf(call, "get");
      return member ? [member] : [];
    }
    if (call.type === "AssignmentStatement" && call.left.type === "MemberExpression") {
      const setter = accessorOf(call.left, "set");
      return setter ? [setter] : [];
    }
    if (call.type === "AssignmentStatement") return [];
    const direct = callable(call.callee);
    if (direct) {
      const targets = [direct];
      if (call.callee.type === "MemberExpression" && call.callee.object.type !== "Super") {
        const context = classContexts.get(direct);
        if (context) for (const declaration of classes) {
          for (let base = baseOf(declaration); base; base = baseOf(base)) if (base === context.declaration) {
            const override = declaration.members.find(member => member.type === "MethodDefinition" && member.static === direct.static && member.key.name === direct.key.name);
            if (override) targets.push(override);
          }
        }
      }
      return targets;
    }
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
    if (["derive", "input"].includes(origin?.kind) && !intrinsic(callee) && !callable(callee)) fail("NRS074", "Cannot call an unproven method on a read-only value or its alias", callee);
  }

  const dependencies = new Map();
  for (const binding of bindings.filter(binding => binding.kind === "derive")) {
    const dependsOn = new Set();
    const visited = new Set();
    function inspect(node, owner = null) {
      if (!node || SCOPE_LIKE.has(node.type)) return;
      if (node.type === "AwaitExpression") fail("NRS075", "Derived evaluation must remain synchronous", node);
      if (node.type === "ThrowStatement") fail("NRS075", "Derived evaluation cannot explicitly throw", node);
      if (node.type === "Identifier") {
        const target = resolved.get(node);
        if (target?.kind === "derive") dependsOn.add(target);
        return;
      }
      if (node.type === "AssignmentStatement") {
        const target = resolved.get(node.left);
        const construction = node.left.type === "MemberExpression" && node.left.object.type === "ThisExpression" && classContexts.get(node.left.object)?.member.kind === "constructor";
        if (!construction && (node.left.type !== "Identifier" || !owner || target?.scope?.owner !== owner || !["let", "parameter"].includes(target.kind))) {
          fail("NRS075", "Derived evaluation cannot mutate captured bindings or objects", node.left);
        }
      }
      if (EFFECT_NODES.has(node.type)) {
        const targets = invoked(node);
        if (INVOCATIONS.has(node.type) && !targets.length && !(node.type === "NewExpression" && classOf(node.callee)) && !intrinsic(node.callee)) fail("NRS075", "Derived evaluation requires a provably pure function call", node.callee);
        for (const fn of targets) if (!visited.has(fn)) {
          if (fn.async) fail("NRS075", "Derived evaluation cannot invoke async functions", node.callee);
          visited.add(fn);
          for (const value of fn.params.flatMap(patternExpressions)) inspect(value, fn.body);
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
    if (!node || FUNCTION_LIKE.has(node.type)) return;
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      initialized(node.superClass, position, seen, active, owner);
      for (const member of node.members) if (member.static) {
        if (member.type === "PropertyDefinition") initialized(member.value, node.end, seen, active, owner);
        else if (member.type === "StaticBlock") initialized(member.body, node.end, seen, active, member.body);
      }
      return;
    }
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
    if (node.type === "ForStatement" && !owner) {
      for (const child of [node.init, node.test, node.body, node.update].filter(Boolean)) initialized(child, child.start, seen, active);
      return;
    }
    if (node.type === "Identifier") {
      const binding = resolved.get(node);
      const currentPosition = binding?.scope?.depth === 0 ? position : active.get(binding?.scope?.owner);
      if (initializedPatternReads.has(node)) return;
      if (currentPosition !== undefined && !["function", "parameter"].includes(binding.kind)) {
        if (binding.end > currentPosition) fail("NRS074", `Call reads '${binding.name}' before initialization`, node);
        if (binding.kind === "derive" && !seen.has(binding)) {
          seen.add(binding);
          initialized(declarations.get(binding).init, position, seen, active);
        }
      }
      return;
    }
    if (EFFECT_NODES.has(node.type)) {
      for (const fn of invoked(node)) if (!seen.has(fn)) {
        seen.add(fn);
        for (const value of fn.params.flatMap(patternExpressions)) initialized(value, position, seen, new Map(active), fn.body);
        initialized(fn.body, position, seen, new Map(active), fn.body);
      }
    }
    for (const child of children(node)) initialized(child, position, seen, active, owner);
  }
  for (const module of [...(program.modules ?? []), program]) {
    for (const node of module.body) initialized(node, node.start);
  }
  const analysis = { bindings, references, root, imports, arrows, resolved, declarations, classes, classContexts, classOf, memberOf, constructorOf, baseOf, isStaticReceiver };
  checkTypes(program, analysis, { strictTypes });
  return analysis;
}