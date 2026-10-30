import { Scanner, readExpressionStatement, RESERVED_WORDS } from "./scanner.js";
import { parseExpression, ExpressionParser, patternBindings } from "./expressions.js";
import { readType, readTypeParameters, typeReadCount } from "./types.js";

export { NiralScriptError } from "./errors.js";
export { analyzeNiralScript } from "./analysis.js";

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;

export function parseNiralScript(code, filename = "<anonymous>") {
  const parser = new StatementParser(code, filename);
  const reads = typeReadCount();
  const body = parser.body(true, 0);
  const typed = typeReadCount() > reads;
  return { type: "Program", body, source: code, filename, typed, start: 0, end: code.length };
}

export class StatementParser {
  constructor(code, filename) {
    this.scanner = new Scanner(code, filename);
    this.loopDepth = 0;
  }

  trivia() {
    const scanner = this.scanner;
    while (!scanner.eof()) {
      scanner.skipWs();
      if (scanner.eat("//")) {
        while (!scanner.eof() && !/[\r\n]/.test(scanner.peek())) scanner.pos++;
      } else if (scanner.eat("/*")) {
        scanner.readUntil("*/");
        scanner.expect("*/", "NRS070", "Unclosed NiralScript comment");
      } else break;
    }
  }

  name(names, declarationStart) {
    this.trivia();
    const scanner = this.scanner;
    const start = scanner.pos;
    const name = scanner.read(IDENTIFIER);
    if (!name || RESERVED_WORDS.has(name) || name.startsWith("__") || name.startsWith("$")) {
      scanner.error("NRS070", "Expected a non-reserved NiralScript identifier", { start: declarationStart });
    }
    if (names.has(name)) scanner.error("NRS070", `Duplicate declaration '${name}'`, { start: declarationStart });
    names.add(name);
    return { type: "Identifier", name, start, end: scanner.pos };
  }

  body(topLevel, depth, names = new Set()) {
    const body = [];
    this.trivia();
    while (!this.scanner.eof() && (topLevel || this.scanner.peek() !== "}")) {
      body.push(this.statement(topLevel, depth, names));
      this.trivia();
    }
    return body;
  }

  pattern(names) {
    this.trivia();
    const scanner = this.scanner;
    if (!"[{".includes(scanner.peek())) return this.name(names, scanner.pos);
    const parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
    const pattern = parser.binding(names, false);
    scanner.pos = pattern.end;
    return pattern;
  }

  annotation() {
    const parser = new ExpressionParser(this.scanner.src, this.scanner.filename, this.scanner.pos, this.scanner.src.length);
    const annotation = parser.annotation();
    if (annotation) this.scanner.pos = annotation.end;
    return annotation;
  }

  block(depth, names = new Set()) {
    this.trivia();
    const scanner = this.scanner;
    const start = scanner.pos;
    scanner.expect("{", "NRS072", "Expected a braced statement block");
    const body = this.body(false, depth, names);
    scanner.expect("}", "NRS072", "Expected '}' after statement block");
    return { type: "BlockStatement", body, start, end: scanner.pos };
  }

  classDeclaration(start, depth, names, optional = false) {
    const scanner = this.scanner;
    let id = null;
    if (!optional) {
      id = this.name(names, start);
    } else {
      const savedPos = scanner.pos;
      this.trivia();
      const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
      IDENTIFIER.lastIndex = scanner.pos;
      const word = IDENTIFIER.exec(scanner.src)?.[0];
      scanner.pos = savedPos;
      if (word && word !== "extends" && !RESERVED_WORDS.has(word)) id = this.name(names, start);
    }
    let parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
    const typeParameters = readTypeParameters(parser);
    let superClass = null;
    let superTypeArguments = null;
    if (parser.peek().value === "extends") {
      parser.take();
      superClass = parser.primary();
      if (parser.peek().kind === "<") {
        const opening = parser.take();
        const values = [];
        do { values.push(readType(parser).value); } while (parser.eat(","));
        const close = parser.expect(">");
        superTypeArguments = { type: "TypeAnnotation", value: { kind: "arguments", values }, start: opening.start, end: close.end };
      }
    }
    parser.expect("{");
    const members = [];
    const keys = new Map();
    while (parser.peek().kind !== "}") {
      if (parser.eat(";")) continue;
      const memberStart = parser.peek().start;
      let key = parser.take();
      let isStatic = false;
      let async = false;
      let kind = "method";
      if (key.value === "static" && !["(", ":", "=", ";", "}"].includes(parser.peek().kind)) {
        isStatic = true;
        if (parser.peek().kind === "{") {
          scanner.pos = parser.peek().start;
          const outerLoopDepth = this.loopDepth;
          this.loopDepth = 0;
          const body = this.block(depth + 1);
          this.loopDepth = outerLoopDepth;
          members.push({ type: "StaticBlock", static: true, body, start: memberStart, end: body.end });
          parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
          continue;
        }
        key = parser.take();
      }
      if (key.value === "async" && ["identifier", "#", "["].includes(parser.peek().kind)) { async = true; key = parser.take(); }
      if (["get", "set"].includes(key.value) && ["identifier", "#", "["].includes(parser.peek().kind)) { kind = key.value; key = parser.take(); }
      if (async && kind !== "method") parser.error("Accessors cannot be async", key.start);
      if (key.kind === "#") { const privateName = parser.expect("identifier"); key = { ...privateName, value: "#" + privateName.value, start: key.start }; }
      if (key.kind === "[") {
        key = parser.take();
        if (!["string", "number"].includes(key.kind)) parser.error("Computed class names require a string or number literal", key.start);
        parser.expect("]");
      }
      if (!["identifier", "string", "number"].includes(key.kind)) parser.error("Expected a class member name", key.start);
      const name = String(key.value);
      const memberKey = { type: "Identifier", name, start: key.start, end: key.end };
      const identity = `${isStatic}:${name}`;
      const previous = keys.get(identity);
      if (name === "#constructor") parser.error("Private constructors are not allowed", key.start);
      if (name.startsWith("#") && keys.has(`${!isStatic}:${name}`)) parser.error("Private names cannot be shared by static and instance members", key.start);
      if (previous && !(previous === "get" && kind === "set" || previous === "set" && kind === "get")) parser.error(`Duplicate class member '${name}'`, key.start);
      if (isStatic && name === "prototype") parser.error("Static prototype members are not allowed", key.start);
      const methodTypes = readTypeParameters(parser);
      if (parser.eat("(")) {
        if (name === "constructor" && !isStatic) {
          if (async || kind !== "method" || methodTypes) parser.error("A constructor cannot be async, generic or an accessor", key.start);
          kind = "constructor";
        }
        const params = parser.parameters().items;
        if (kind === "get" && params.length || kind === "set" && (params.length !== 1 || params[0].type === "RestElement")) parser.error("Invalid accessor parameters", key.start);
        const returnType = parser.annotation();
        if (kind === "constructor" && returnType) parser.error("Constructors cannot declare a return type", returnType.start);
        scanner.pos = parser.peek().start;
        const outerLoopDepth = this.loopDepth;
        this.loopDepth = 0;
        const body = this.block(depth + 1, new Set(params.flatMap(patternBindings).map(binding => binding.id.name)));
        this.loopDepth = outerLoopDepth;
        members.push({ type: "MethodDefinition", key: memberKey, static: isStatic, kind, async, params, returnType, typeParameters: methodTypes, body, start: memberStart, end: body.end });
        parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      } else {
        if (async || kind !== "method" || methodTypes || name === "constructor") parser.error("Invalid class field", key.start);
        const typeAnnotation = parser.annotation();
        const value = parser.eat("=") ? parser.expression() : null;
        const end = value?.end ?? typeAnnotation?.end ?? key.end;
        if (!parser.eat(";") && parser.peek().kind !== "}" && !/[\r\n]/.test(scanner.src.slice(end, parser.peek().start))) parser.error("Expected a semicolon or newline after field", end);
        members.push({ type: "PropertyDefinition", key: memberKey, static: isStatic, typeAnnotation, value, start: memberStart, end });
        kind = "field";
      }
      keys.set(identity, previous ? "accessors" : kind);
    }
    const end = parser.expect("}").end;
    scanner.pos = end;
    return { type: "ClassDeclaration", id, typeParameters, superClass, superTypeArguments, members, start, end };
  }

  statement(topLevel, depth, names) {
    const scanner = this.scanner;
    const start = scanner.pos;
    let kind = scanner.read(IDENTIFIER);
    let async = false;
    if (kind === "async") {
      const afterAsync = scanner.pos;
      this.trivia();
      if (scanner.read(IDENTIFIER) === "function") {
        if (/[\r\n]/.test(scanner.src.slice(afterAsync, scanner.pos))) scanner.error("NRS072", "Async function declarations require the same line", { start });
        kind = "function";
        async = true;
      } else scanner.pos = afterAsync;
    }
    if (kind === "import") {
      if (!topLevel) scanner.error("NRS078", "Imports are only valid at top level", { start });
      this.trivia();
      const importStart = scanner.pos;
      const typeOnly = scanner.read(IDENTIFIER) === "type";
      if (!typeOnly) scanner.pos = importStart;
      else { names = new Set(); this.trivia(); }
      scanner.expect("{", "NRS078", "Expected named imports in braces");
      const specifiers = [];
      this.trivia();
      while (scanner.peek() !== "}") {
        const imported = this.name(new Set(), scanner.pos);
        let local = imported;
        this.trivia();
        const afterName = scanner.pos;
        if (scanner.read(IDENTIFIER) === "as") local = this.name(names, scanner.pos);
        else {
          scanner.pos = afterName;
          if (names.has(local.name)) scanner.error("NRS070", `Duplicate declaration '${local.name}'`, { start: local.start });
          names.add(local.name);
        }
        specifiers.push({ type: "ImportSpecifier", imported, local, start: imported.start, end: local.end });
        this.trivia();
        if (!scanner.eat(",")) break;
        this.trivia();
      }
      scanner.expect("}", "NRS078", "Expected '}' after named imports");
      this.trivia();
      if (scanner.read(IDENTIFIER) !== "from") scanner.error("NRS078", "Expected 'from' after named imports", { start });
      this.trivia();
      const parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const token = parser.take();
      if (token.kind !== "string") scanner.error("NRS078", "Expected a quoted module specifier", { start });
      scanner.pos = token.end;
      this.trivia();
      const terminated = scanner.eat(";");
      if (!terminated && !scanner.eof() && !/[\r\n]/.test(scanner.src.slice(token.end, scanner.pos))) scanner.error("NRS078", "Expected a semicolon or newline after import", { start: token.end });
      return { type: "ImportDeclaration", ...(typeOnly ? { typeOnly } : {}), specifiers, source: { type: "Literal", value: token.value, start: token.start, end: token.end }, start, end: terminated ? scanner.pos : token.end };
    }
    if (kind === "export") {
      if (!topLevel) scanner.error("NRS078", "Exports are only valid at top level", { start });
      this.trivia();
      const declarationStart = scanner.pos;
      const declarationKind = scanner.read(IDENTIFIER);
      if (!["const", "function", "async", "type", "interface", "class"].includes(declarationKind)) scanner.error("NRS078", "Only constants, functions, classes and types can be exported", { start });
      scanner.pos = declarationStart;
      const declaration = this.statement(topLevel, depth, names);
      if (!["VariableDeclaration", "FunctionDeclaration", "TypeAliasDeclaration", "InterfaceDeclaration", "ClassDeclaration"].includes(declaration.type)) scanner.error("NRS078", "Only constants, functions, classes and types can be exported", { start });
      return { ...declaration, exported: true, start };
    }
    if (kind === "class") return this.classDeclaration(start, depth, names);
    if (kind === "type") {
      if (!topLevel) scanner.error("NRS080", "Type aliases are declared at module top level", { start });
      const id = this.name(new Set(), start);
      this.trivia();
      const genericParser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const typeParameters = readTypeParameters(genericParser);
      if (typeParameters) { scanner.pos = typeParameters.end; this.trivia(); }
      scanner.expect("=", "NRS080", "Expected '=' after type name");
      const parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const annotationStart = scanner.pos;
      const { value, end } = readType(parser);
      scanner.pos = end;
      scanner.eat(";");
      return { type: "TypeAliasDeclaration", id, ...(typeParameters ? { typeParameters } : {}), value: { type: "TypeAnnotation", value, start: annotationStart, end }, start, end: scanner.pos };
    }
    if (kind === "interface") {
      if (!topLevel) scanner.error("NRS080", "Interfaces are declared at module top level", { start });
      const id = this.name(new Set(), start);
      this.trivia();
      const genericParser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const typeParameters = readTypeParameters(genericParser);
      if (typeParameters) { scanner.pos = typeParameters.end; this.trivia(); }
      const extendsTypes = [];
      const afterId = scanner.pos;
      if (scanner.read(IDENTIFIER) === "extends") {
        do {
          this.trivia();
          const extParser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
          const { value: extValue, end: extEnd } = readType(extParser);
          extendsTypes.push({ type: "TypeAnnotation", value: extValue, start: scanner.pos, end: extEnd });
          scanner.pos = extEnd;
          this.trivia();
        } while (scanner.eat(","));
      } else scanner.pos = afterId;
      this.trivia();
      scanner.expect("{", "NRS080", "Expected '{' for interface body");
      const bodyParser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const properties = {};
      while (bodyParser.peek().kind !== "}") {
        const key = bodyParser.expect("identifier");
        if (Object.hasOwn(properties, key.value)) bodyParser.error(`Duplicate interface property '${key.value}'`, key.start);
        const optional = !!bodyParser.eat("?");
        bodyParser.expect(":");
        const { value: propValue } = readType(bodyParser);
        Object.defineProperty(properties, key.value, { value: optional ? { kind: "union", members: [propValue, { kind: "undefined" }] } : propValue, enumerable: true });
        if (!bodyParser.eat(",") && !bodyParser.eat(";")) break;
      }
      const closeEnd = bodyParser.expect("}").end;
      scanner.pos = closeEnd;
      const bodyAnnotation = { type: "TypeAnnotation", value: { kind: "object", properties }, start: start, end: closeEnd };
      return { type: "InterfaceDeclaration", id, ...(typeParameters ? { typeParameters } : {}), ...(extendsTypes.length ? { extends: extendsTypes } : {}), value: bodyAnnotation, start, end: scanner.pos };
    }
    if (kind === "input") {
      if (!topLevel) scanner.error("NRS072", "Inputs are only valid at component top level", { start });
      const id = this.name(names, start);
      const typeAnnotation = this.annotation();
      if (typeAnnotation) id.typeAnnotation = typeAnnotation;
      this.trivia();
      const terminated = scanner.eat(";");
      const bindingEnd = typeAnnotation?.end ?? id.end;
      if (!terminated && !scanner.eof() && !/[\r\n]/.test(scanner.src.slice(id.end, scanner.pos))) scanner.error("NRS072", "Expected a semicolon or newline after input", { start: bindingEnd });
      return { type: "InputDeclaration", id, start, end: terminated ? scanner.pos : bindingEnd };
    }
    if (["state", "derive", "const", "let"].includes(kind)) {
      if (!topLevel && (kind === "state" || kind === "derive")) {
        scanner.error("NRS072", "Reactive declarations must be at component top level", { start });
      }
      const id = kind === "const" || kind === "let" ? this.pattern(names) : this.name(names, start);
      const typeAnnotation = this.annotation();
      if (typeAnnotation) id.typeAnnotation = typeAnnotation;
      this.trivia();
      scanner.expect("=", "NRS070", `Expected '=' after binding`);
      if (scanner.peek() === "=" || scanner.peek() === ">") scanner.error("NRS070", `Expected an initializer after '=' for '${id.name}'`);
      const init = this.initializer(id.name, start);
      return {
        type: kind === "state" ? "StateDeclaration" : kind === "derive" ? "DerivedDeclaration" : "VariableDeclaration",
        ...(kind === "let" || kind === "const" ? { kind } : {}),
        id, init, start, end: scanner.pos,
      };
    }
    if (kind === "function") {
      const id = this.name(names, start);
      this.trivia();
      const genericParser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const typeParameters = readTypeParameters(genericParser);
      if (typeParameters) { scanner.pos = typeParameters.end; this.trivia(); }
      scanner.expect("(", "NRS072", "Expected function parameters");
      const parameterParser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      let params;
      try { params = parameterParser.parameters().items; }
      catch (error) {
        if (error.message === "Expected unique non-reserved binding names") error.code = "NRS070";
        throw error;
      }
      scanner.pos = parameterParser.scanner.pos;
      const returnType = this.annotation();
      const parameterNames = new Set();
      function collectNames(pattern) {
        if (!pattern) return;
        if (pattern.type === "Identifier") parameterNames.add(pattern.name);
        else if (pattern.type === "AssignmentPattern") collectNames(pattern.left);
        else if (pattern.type === "RestElement") collectNames(pattern.argument);
        else for (const item of pattern.elements ?? pattern.properties) collectNames(item?.value ?? item);
      }
      params.forEach(collectNames);
      const outerLoopDepth = this.loopDepth;
      this.loopDepth = 0;
      const body = this.block(depth + 1, parameterNames);
      this.loopDepth = outerLoopDepth;
      return { type: "FunctionDeclaration", ...(async ? { async: true } : {}), ...(returnType ? { returnType } : {}), ...(typeParameters ? { typeParameters } : {}), id, params, body, start, end: body.end };
    }
    if (kind === "for") {
      this.trivia();
      scanner.expect("(", "NRS072", "Expected '(' after for");
      this.trivia();
      const headerStart = scanner.pos;
      const declarationKind = scanner.read(IDENTIFIER);
      let init = null;
      let parser;
      if (["const", "let"].includes(declarationKind)) {
        const id = this.pattern(new Set());
        const typeAnnotation = this.annotation();
        if (typeAnnotation) id.typeAnnotation = typeAnnotation;
        this.trivia();
        parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
        if (parser.peek().value === "of") {
          parser.take();
          const right = parser.expression();
          parser.expect(")");
          scanner.pos = parser.scanner.pos;
          this.loopDepth++;
          const body = this.block(depth);
          this.loopDepth--;
          return { type: "ForOfStatement", kind: declarationKind, id, right, body, start, end: body.end };
        }
        parser.expect("=");
        const value = parser.expression();
        init = { type: "VariableDeclaration", kind: declarationKind, id, init: value, start: headerStart, end: value.end };
      } else {
        parser = new ExpressionParser(scanner.src, scanner.filename, headerStart, scanner.src.length);
        if (parser.peek().kind !== ";") init = this.simpleStatement(parser);
      }
      parser.expect(";");
      const test = parser.peek().kind === ";" ? null : parser.expression();
      parser.expect(";");
      const update = parser.peek().kind === ")" ? null : this.simpleStatement(parser);
      parser.expect(")");
      scanner.pos = parser.scanner.pos;
      this.loopDepth++;
      const body = this.block(depth);
      this.loopDepth--;
      return { type: "ForStatement", init, test, update, body, start, end: body.end };
    }
    if (kind === "while") {
      this.trivia();
      scanner.expect("(", "NRS072", "Expected '(' after while");
      const parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const test = parser.expression();
      parser.expect(")");
      scanner.pos = parser.scanner.pos;
      this.loopDepth++;
      const body = this.block(depth);
      this.loopDepth--;
      return { type: "WhileStatement", test, body, start, end: body.end };
    }
    if (kind === "break" || kind === "continue") {
      if (!this.loopDepth) scanner.error("NRS072", `${kind} is only valid inside a loop`, { start });
      const keywordEnd = scanner.pos;
      this.trivia();
      if (!scanner.eat(";") && scanner.peek() !== "}" && !scanner.eof() && !/[\r\n]/.test(scanner.src.slice(keywordEnd, scanner.pos))) scanner.error("NRS072", "Loop labels are not supported", { start });
      return { type: kind === "break" ? "BreakStatement" : "ContinueStatement", start, end: scanner.pos };
    }
    if (kind === "if") {
      this.trivia();
      scanner.expect("(", "NRS072", "Expected '(' after if");
      const parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const test = parser.expression();
      parser.expect(")");
      scanner.pos = parser.scanner.pos;
      const consequent = this.block(depth);
      this.trivia();
      let alternate = null;
      const afterConsequent = scanner.pos;
      if (scanner.read(IDENTIFIER) === "else") {
        this.trivia();
        const branchStart = scanner.pos;
        const branch = scanner.read(IDENTIFIER);
        scanner.pos = branchStart;
        alternate = branch === "if" ? this.statement(false, depth, new Set()) : this.block(depth);
      } else scanner.pos = afterConsequent;
      return { type: "IfStatement", test, consequent, alternate, start, end: alternate?.end ?? consequent.end };
    }
    if (kind === "try") {
      const block = this.block(depth);
      let handler = null;
      let finalizer = null;
      this.trivia();
      let next = scanner.pos;
      if (scanner.read(IDENTIFIER) === "catch") {
        this.trivia();
        const parameters = new Set();
        let param = null;
        if (scanner.eat("(")) {
          param = this.pattern(parameters);
          this.trivia();
          scanner.expect(")", "NRS072", "Expected ')' after catch binding");
        }
        const body = this.block(depth, parameters);
        handler = { type: "CatchClause", param, body, start: next, end: body.end };
      } else scanner.pos = next;
      this.trivia();
      next = scanner.pos;
      if (scanner.read(IDENTIFIER) === "finally") finalizer = this.block(depth);
      else scanner.pos = next;
      if (!handler && !finalizer) scanner.error("NRS072", "Try requires catch or finally", { start });
      return { type: "TryStatement", block, handler, finalizer, start, end: finalizer?.end ?? handler.end };
    }
    if (kind === "throw") {
      const argumentStart = scanner.pos;
      const raw = readExpressionStatement(scanner, true);
      if (this.empty(raw)) scanner.error("NRS072", "Throw requires an expression on the same line", { start });
      const argument = parseExpression(scanner.src, scanner.filename, argumentStart, scanner.pos);
      scanner.eat(";");
      return { type: "ThrowStatement", argument, start, end: scanner.pos };
    }
    if (kind === "return") {
      if (!depth) scanner.error("NRS072", "Return is only valid inside a function", { start });
      const argumentStart = scanner.pos;
      const raw = readExpressionStatement(scanner, true);
      const argument = this.empty(raw) ? null : parseExpression(scanner.src, scanner.filename, argumentStart, scanner.pos);
      scanner.eat(";");
      return { type: "ReturnStatement", argument, start, end: scanner.pos };
    }
    scanner.pos = start;
    if (scanner.peek() === "{") return this.block(depth);
    readExpressionStatement(scanner, true);
    const parser = new ExpressionParser(scanner.src, scanner.filename, start, scanner.pos);
    const statement = this.simpleStatement(parser);
    parser.expect("eof");
    scanner.eat(";");
    return { ...statement, start, end: scanner.pos };
  }

  simpleStatement(parser) {
    const scanner = this.scanner;
    const start = parser.peek().start;
    const prefix = ["++", "--"].includes(parser.peek().kind) ? parser.take() : null;
    const expression = parser.expression();
    const operator = prefix ?? parser.peek();
    let statement;
    if (["=", "+=", "-=", "*=", "/=", "%=", "++", "--"].includes(operator.kind)) {
      if (!prefix) parser.take();
      if (!["Identifier", "MemberExpression"].includes(expression.type)) scanner.error("NRS072", "Invalid assignment target", { start });
      for (let target = expression; target && ["MemberExpression", "CallExpression"].includes(target.type); target = target.object ?? target.callee) if (target.optional) scanner.error("NRS072", "Optional chains cannot be assignment targets", { start });
      const update = ["++", "--"].includes(operator.kind);
      const right = update ? { type: "Literal", value: 1, start: operator.start, end: operator.end } : parser.expression();
      statement = { type: "AssignmentStatement", left: expression, operator: update ? operator.kind === "++" ? "+=" : "-=" : operator.kind, ...(update ? { update: true } : {}), right };
    } else {
      if (!["CallExpression", "NewExpression", "AwaitExpression"].includes(expression.type)) scanner.error("NRS072", "Only calls, construction, await and assignments are expression statements", { start });
      statement = { type: "ExpressionStatement", expression };
    }
    return { ...statement, start, end: Math.max(expression.end, statement.right?.end ?? expression.end) };
  }

  empty(raw) {
    return /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*$/.test(raw);
  }

  initializer(name, start) {
    const scanner = this.scanner;
    const expressionStart = scanner.pos;
    const expression = readExpressionStatement(scanner, true);
    if (this.empty(expression)) scanner.error("NRS070", `Expected an initializer for '${name}'`, { start });
    const expressionEnd = scanner.pos;
    scanner.eat(";");
    return {
      ...parseExpression(scanner.src, scanner.filename, expressionStart, expressionEnd),
      raw: expression, start: expressionStart, end: expressionEnd,
    };
  }
}
