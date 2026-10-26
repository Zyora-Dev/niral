import { Scanner, readExpressionStatement, RESERVED_WORDS } from "./scanner.js";
import { parseExpression, ExpressionParser } from "./expressions.js";

export { NiralScriptError } from "./errors.js";
export { analyzeNiralScript } from "./analysis.js";

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;

export function parseNiralScript(code, filename = "<anonymous>") {
  const parser = new StatementParser(code, filename);
  const body = parser.body(true, 0);
  return { type: "Program", body, source: code, filename, start: 0, end: code.length };
}

export class StatementParser {
  constructor(code, filename) {
    this.scanner = new Scanner(code, filename);
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
    const pattern = parser.pattern(parser.primary(), names);
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
      return { type: "ImportDeclaration", specifiers, source: { type: "Literal", value: token.value, start: token.start, end: token.end }, start, end: terminated ? scanner.pos : token.end };
    }
    if (kind === "export") {
      if (!topLevel) scanner.error("NRS078", "Exports are only valid at top level", { start });
      this.trivia();
      const declarationStart = scanner.pos;
      const declarationKind = scanner.read(IDENTIFIER);
      if (!["const", "function", "async"].includes(declarationKind)) scanner.error("NRS078", "Only constants and functions can be exported", { start });
      scanner.pos = declarationStart;
      const declaration = this.statement(topLevel, depth, names);
      if (!["VariableDeclaration", "FunctionDeclaration"].includes(declaration.type)) scanner.error("NRS078", "Only constants and functions can be exported", { start });
      return { ...declaration, exported: true, start };
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
      scanner.expect("(", "NRS072", "Expected function parameters");
      const parameters = new Set();
      const params = [];
      this.trivia();
      while (scanner.peek() !== ")") {
        const param = this.pattern(parameters);
        const typeAnnotation = this.annotation();
        if (typeAnnotation) param.typeAnnotation = typeAnnotation;
        params.push(param);
        this.trivia();
        if (!scanner.eat(",")) break;
        this.trivia();
      }
      scanner.expect(")", "NRS072", "Expected ')' after function parameters");
      const returnType = this.annotation();
      const body = this.block(depth + 1, parameters);
      return { type: "FunctionDeclaration", ...(async ? { async: true } : {}), ...(returnType ? { returnType } : {}), id, params, body, start, end: body.end };
    }
    if (kind === "for") {
      this.trivia();
      scanner.expect("(", "NRS072", "Expected '(' after for");
      this.trivia();
      const declarationKind = scanner.read(IDENTIFIER);
      if (!["const", "let"].includes(declarationKind)) scanner.error("NRS072", "For-of requires a const or let binding", { start });
      const parameters = new Set();
      const id = this.pattern(parameters);
      this.trivia();
      if (scanner.read(IDENTIFIER) !== "of") scanner.error("NRS072", "Only for-of iteration is supported", { start });
      const parser = new ExpressionParser(scanner.src, scanner.filename, scanner.pos, scanner.src.length);
      const right = parser.expression();
      parser.expect(")");
      scanner.pos = parser.scanner.pos;
      const body = this.block(depth);
      return { type: "ForOfStatement", kind: declarationKind, id, right, body, start, end: body.end };
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
    const expression = parser.expression();
    const operator = parser.peek();
    let statement;
    if (["=", "+=", "-=", "*=", "/=", "%="].includes(operator.kind)) {
      parser.take();
      if (!["Identifier", "MemberExpression"].includes(expression.type)) scanner.error("NRS072", "Invalid assignment target", { start });
      for (let target = expression; target && ["MemberExpression", "CallExpression"].includes(target.type); target = target.object ?? target.callee) if (target.optional) scanner.error("NRS072", "Optional chains cannot be assignment targets", { start });
      const right = parser.expression();
      statement = { type: "AssignmentStatement", left: expression, operator: operator.kind, right };
    } else {
      if (!["CallExpression", "AwaitExpression"].includes(expression.type)) scanner.error("NRS072", "Only calls, await and assignments are expression statements", { start });
      statement = { type: "ExpressionStatement", expression };
    }
    parser.expect("eof");
    scanner.eat(";");
    return { ...statement, start, end: scanner.pos };
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
