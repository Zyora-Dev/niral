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

class StatementParser {
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
    const kind = scanner.read(IDENTIFIER);
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
      if (!["const", "function"].includes(declarationKind)) scanner.error("NRS078", "Only constants and functions can be exported", { start });
      scanner.pos = declarationStart;
      return { ...this.statement(topLevel, depth, names), exported: true, start };
    }
    if (["state", "derive", "const", "let"].includes(kind)) {
      if (!topLevel && (kind === "state" || kind === "derive")) {
        scanner.error("NRS072", "Reactive declarations must be at component top level", { start });
      }
      const id = this.name(names, start);
      this.trivia();
      scanner.expect("=", "NRS070", `Expected '=' after '${id.name}'`);
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
        params.push(this.name(parameters, scanner.pos));
        this.trivia();
        if (!scanner.eat(",")) break;
        this.trivia();
      }
      scanner.expect(")", "NRS072", "Expected ')' after function parameters");
      const body = this.block(depth + 1, parameters);
      return { type: "FunctionDeclaration", id, params, body, start, end: body.end };
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
      const right = parser.expression();
      statement = { type: "AssignmentStatement", left: expression, operator: operator.kind, right };
    } else {
      if (expression.type !== "CallExpression") scanner.error("NRS072", "Only calls and assignments are expression statements", { start });
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
