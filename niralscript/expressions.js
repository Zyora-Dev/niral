import { Scanner, RESERVED_WORDS } from "./scanner.js";
import { StatementParser } from "./parser.js";
import { readType } from "./types.js";

const PRECEDENCE = new Map([
  ["??", 1], ["||", 1], ["&&", 2], ["===", 3], ["!==", 3],
  ["<", 4], ["<=", 4], [">", 4], [">=", 4],
  ["+", 5], ["-", 5], ["*", 6], ["/", 6], ["%", 6],
]);
const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const SYMBOL = /===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\*\*|=>|\?\?|\?\.|[+\-*/%!=<>]=?|[()[\]{},.:?`|]/y;

export function parseExpression(source, filename, start, end) {
  const parser = new ExpressionParser(source, filename, start, end);
  const expression = parser.expression();
  parser.expect("eof");
  return expression;
}

export function patternBindings(pattern, shorthand = false, path = []) {
  if (pattern.type === "Identifier") return [{ id: pattern, shorthand, path }];
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap((item, index) => patternBindings(item, false, [...path, index]));
  return pattern.properties.flatMap(property => patternBindings(property.value, property.shorthand, [...path, property.key.name ?? property.key.value]));
}

export class ExpressionParser {
  constructor(source, filename, start, end) {
    this.scanner = new Scanner(source, filename);
    this.scanner.pos = start;
    this.end = end;
    this.current = null;
  }

  error(message, start = this.scanner.pos) {
    this.scanner.error("NRS071", message, { start, end: Math.min(start + 1, this.end) });
  }

  peek() {
    if (this.current) return this.current;
    const scanner = this.scanner;
    while (scanner.pos < this.end) {
      const code = scanner.src.charCodeAt(scanner.pos);
      if (code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(scanner.peek()))) scanner.pos++;
      else if (code === 47 && scanner.eat("//")) {
        while (scanner.pos < this.end && !/[\r\n]/.test(scanner.peek())) scanner.pos++;
      } else if (code === 47 && scanner.eat("/*")) {
        scanner.readUntil("*/");
        if (scanner.pos >= this.end) this.error("Unclosed expression comment");
        scanner.pos += 2;
      } else break;
    }
    const start = scanner.pos;
    const char = scanner.peek();
    const code = scanner.src.charCodeAt(start);
    let kind;
    let value;
    if (start >= this.end) kind = "eof";
    else if (char === '"' || char === "'") {
      kind = "string";
      const quote = char;
      scanner.pos++;
      value = this.text(quote);
      if (!scanner.eat(quote)) this.error("Expected closing quote", start);
    } else if ((code >= 48 && code <= 57) || (char === "." && scanner.src.charCodeAt(start + 1) >= 48 && scanner.src.charCodeAt(start + 1) <= 57)) {
      kind = "number";
      value = Number(scanner.read(NUMBER));
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36) {
      kind = "identifier";
      value = scanner.read(IDENTIFIER);
    } else if (scanner.startsWith("...")) {
      kind = value = "...";
      scanner.pos += 3;
    } else if ("()[]{},.:`;".includes(char)) {
      kind = value = char;
      scanner.pos++;
    }
    else if ((value = scanner.read(SYMBOL)) !== null) kind = value;
    else this.error(`Unsupported expression token '${scanner.peek()}'`);
    this.current = { kind, value, start, end: scanner.pos };
    return this.current;
  }

  take() {
    const token = this.peek();
    this.current = null;
    return token;
  }

  eat(kind) {
    if (this.peek().kind !== kind) return null;
    return this.take();
  }

  expect(kind) {
    const token = this.peek();
    if (token.kind !== kind) this.error(`Expected '${kind}', found '${token.value ?? token.kind}'`, token.start);
    return this.take();
  }

  annotation() {
    const colon = this.eat(":");
    if (!colon) return null;
    const { value, end } = readType(this);
    return { type: "TypeAnnotation", value, start: colon.start, end };
  }

  parameter() {
    const node = this.expression();
    const typeAnnotation = this.annotation();
    return typeAnnotation ? { ...node, typeAnnotation } : node;
  }

  arrowReturn() {
    const position = this.scanner.pos;
    const current = this.current;
    try {
      const annotation = this.annotation();
      if (annotation && this.peek().kind === "=>") return annotation;
    } catch (error) {
      if (error.name !== "NiralScriptError") throw error;
    }
    this.scanner.pos = position;
    this.current = current;
    return null;
  }

  expression() {
    const test = this.binary(1);
    if (this.eat("=>")) {
      if (test.type !== "Identifier") this.error("A destructured arrow parameter requires parentheses", test.start);
      return this.arrow([test], test.start, false, test.end);
    }
    if (!this.eat("?")) return test;
    const consequent = this.expression();
    this.expect(":");
    const alternate = this.expression();
    return { type: "ConditionalExpression", test, consequent, alternate, start: test.start, end: alternate.end };
  }

  binary(minimum) {
    let left = this.unary();
    while ((PRECEDENCE.get(this.peek().kind) ?? 0) >= minimum) {
      const operator = this.take().kind;
      const right = this.binary(PRECEDENCE.get(operator) + 1);
      if (left.type === "ArrowFunctionExpression" || right.type === "ArrowFunctionExpression") this.error("Arrow operands require parentheses", left.start);
      for (const operand of [left, right]) if (operand.type === "LogicalExpression" && (operator === "??" ? ["&&", "||"].includes(operand.operator) : ["&&", "||"].includes(operator) && operand.operator === "??")) this.error("Mixing ?? with && or || requires parentheses", operand.start);
      left = {
        type: ["&&", "||", "??"].includes(operator) ? "LogicalExpression" : "BinaryExpression",
        operator, left, right, start: left.start, end: right.end,
      };
    }
    return left;
  }

  unary() {
    if (this.peek().kind === "identifier" && this.peek().value === "typeof") {
      const token = this.take();
      const argument = this.unary();
      if (argument.type === "ArrowFunctionExpression") this.error("Arrow operands require parentheses", token.start);
      return { type: "UnaryExpression", operator: "typeof", argument, start: token.start, end: argument.end };
    }
    if (this.peek().kind === "identifier" && this.peek().value === "await") {
      const token = this.take();
      const argument = this.unary();
      if (argument.type === "ArrowFunctionExpression") this.error("Arrow operands require parentheses", token.start);
      return { type: "AwaitExpression", argument, start: token.start, end: argument.end };
    }
    if (["!", "+", "-"].includes(this.peek().kind)) {
      const token = this.take();
      const argument = this.unary();
      if (argument.type === "ArrowFunctionExpression") this.error("Arrow operands require parentheses", token.start);
      return { type: "UnaryExpression", operator: token.kind, argument, start: token.start, end: argument.end };
    }
    let expression = this.primary();
    if (expression.type === "ArrowFunctionExpression") return expression;
    while (true) {
      const optional = !!this.eat("?.");
      if (optional && !["[", "("].includes(this.peek().kind) || !optional && this.eat(".")) {
        const token = this.expect("identifier");
        const property = { type: "Identifier", name: token.value, start: token.start, end: token.end };
        expression = { type: "MemberExpression", ...(optional ? { optional: true } : {}), object: expression, property, computed: false, start: expression.start, end: property.end };
      } else if (this.eat("[")) {
        const property = this.expression();
        const close = this.expect("]");
        expression = { type: "MemberExpression", ...(optional ? { optional: true } : {}), object: expression, property, computed: true, start: expression.start, end: close.end };
      } else if (this.eat("(")) {
        const args = this.list(")");
        expression = { type: "CallExpression", ...(optional ? { optional: true } : {}), callee: expression, arguments: args.items, start: expression.start, end: args.end };
      } else return expression;
    }
  }

  primary() {
    const token = this.take();
    const { start, end, value } = token;
    if (token.kind === "number" || token.kind === "string") return { type: "Literal", value, start, end };
    if (token.kind === "identifier") {
      if (value === "async") {
        const next = this.peek();
        let params;
        let parameterEnd;
        if (next.kind === "identifier") {
          const param = this.take();
          params = [{ type: "Identifier", name: param.value, start: param.start, end: param.end }];
          parameterEnd = param.end;
        } else if (this.eat("(")) {
          const list = this.list(")", false, true);
          params = list.items;
          parameterEnd = list.end;
        }
        const returnType = params ? this.arrowReturn() : null;
        if (params && this.eat("=>")) {
          if (/[\r\n]/.test(this.scanner.src.slice(end, next.start))) this.error("Async arrow headers require the same line", start);
          return this.arrow(params, start, true, parameterEnd, returnType);
        }
        if (returnType || params?.some(param => param.typeAnnotation)) this.error("Type annotations require an arrow function", start);
        if (params && next.kind === "(") return { type: "CallExpression", callee: { type: "Identifier", name: value, start, end }, arguments: params, start, end: parameterEnd };
        this.scanner.pos = end;
        this.current = null;
      }
      if (["true", "false", "null"].includes(value)) {
        return { type: "Literal", value: value === "null" ? null : value === "true", start, end };
      }
      if (RESERVED_WORDS.has(value)) this.error(`Unsupported expression keyword '${value}'`, start);
      return { type: "Identifier", name: value, start, end };
    }
    if (token.kind === "(") {
      const params = [];
      let trailingComma = false;
      if (this.peek().kind !== ")") {
        params.push(this.parameter());
        while (this.eat(",")) {
          if (this.peek().kind === ")") { trailingComma = true; break; }
          params.push(this.parameter());
        }
      }
      const close = this.expect(")");
      const returnType = this.arrowReturn();
      if (this.eat("=>")) return this.arrow(params, start, false, close.end, returnType);
      if (returnType || params.some(param => param.typeAnnotation)) this.error("Type annotations require an arrow function", start);
      if (params.length !== 1 || trailingComma) this.error("Expected one parenthesized expression", start);
      return { type: "ParenthesizedExpression", expression: params[0], start, end: close.end };
    }
    if (token.kind === "[") {
      const elements = this.list("]", true);
      return { type: "ArrayExpression", elements: elements.items, start, end: elements.end };
    }
    if (token.kind === "{") return this.object(start);
    if (token.kind === "`") return this.template(start);
    this.error(`Expected an expression, found '${value ?? token.kind}'`, start);
  }

  list(close, spread = false, parameters = false) {
    const items = [];
    while (this.peek().kind !== close) {
      items.push(spread && this.peek().kind === "..." ? this.spread() : parameters ? this.parameter() : this.expression());
      if (!this.eat(",")) break;
    }
    return { items, end: this.expect(close).end };
  }

  arrow(params, start, async = false, parameterEnd, returnType = null) {
    if (/[\r\n]/.test(this.scanner.src.slice(parameterEnd, this.scanner.pos))) this.error("Arrow parameters and => require the same line", start);
    const names = new Set();
    params = params.map(param => this.pattern(param, names));
    let body;
    if (this.peek().kind === "{") {
      const parser = new StatementParser(this.scanner.src, this.scanner.filename);
      parser.scanner.pos = this.peek().start;
      body = parser.block(1, names);
      if (body.end > this.end) this.error("Arrow body exceeds its expression", start);
      this.scanner.pos = body.end;
      this.current = null;
    } else body = this.expression();
    return { type: "ArrowFunctionExpression", ...(async ? { async: true } : {}), ...(returnType ? { returnType } : {}), params, body, start, end: body.end };
  }

  pattern(node, names) {
    if (node.type === "Identifier") {
      if (RESERVED_WORDS.has(node.name) || /^\$|^__/.test(node.name) || names.has(node.name)) this.error("Expected unique non-reserved binding names", node.start);
      names.add(node.name);
      return node;
    }
    if (node.type === "ArrayExpression") return { ...node, type: "ArrayPattern", elements: node.elements.map(item => this.pattern(item, names)) };
    if (node.type === "ObjectExpression") return { ...node, type: "ObjectPattern", properties: node.properties.map(property => {
      if (property.type !== "Property") this.error("Rest bindings are not supported", property.start);
      return { ...property, value: this.pattern(property.value, names) };
    }) };
    this.error("Expected an identifier or object/array binding pattern", node.start);
  }

  spread() {
    const token = this.expect("...");
    const argument = this.expression();
    return { type: "SpreadElement", argument, start: token.start, end: argument.end };
  }

  object(start) {
    const properties = [];
    let hasPrototype = false;
    while (this.peek().kind !== "}") {
      if (this.peek().kind === "...") {
        properties.push(this.spread());
        if (!this.eat(",")) break;
        continue;
      }
      const token = this.take();
      if (!["identifier", "string", "number"].includes(token.kind)) this.error("Expected a plain object key", token.start);
      const key = token.kind === "identifier"
        ? { type: "Identifier", name: token.value, start: token.start, end: token.end }
        : { type: "Literal", value: token.value, start: token.start, end: token.end };
      const shorthand = !this.eat(":");
      if (shorthand && (token.kind !== "identifier" || RESERVED_WORDS.has(token.value))) {
        this.error("Expected ':' after object key", token.start);
      }
      if (!shorthand && token.value === "__proto__") {
        if (hasPrototype) this.error("Duplicate __proto__ property", token.start);
        hasPrototype = true;
      }
      const value = shorthand ? { ...key } : this.expression();
      properties.push({ type: "Property", key, value, shorthand, start: key.start, end: value.end });
      if (!this.eat(",")) break;
    }
    return { type: "ObjectExpression", properties, start, end: this.expect("}").end };
  }

  template(start) {
    const quasis = [];
    const expressions = [];
    const scanner = this.scanner;
    while (true) {
      const chunkStart = scanner.pos;
      const cooked = this.text("`");
      const chunkEnd = scanner.pos;
      const tail = scanner.eat("`");
      quasis.push({ type: "TemplateElement", value: { raw: scanner.src.slice(chunkStart, chunkEnd), cooked }, tail, start: chunkStart, end: chunkEnd });
      if (tail) break;
      if (!scanner.eat("${")) this.error("Expected closing template delimiter", start);
      expressions.push(this.expression());
      this.expect("}");
    }
    return { type: "TemplateLiteral", quasis, expressions, start, end: scanner.pos };
  }

  text(quote) {
    const scanner = this.scanner;
    let value = "";
    while (scanner.pos < this.end && scanner.peek() !== quote) {
      if (quote === "`" && scanner.startsWith("${")) break;
      const start = scanner.pos;
      const char = scanner.peek();
      scanner.pos++;
      if (char !== "\\") {
        if (quote !== "`" && /[\r\n]/.test(char)) this.error("Unescaped newline in string", start);
        if (char === "\r") {
          scanner.eat("\n");
          value += "\n";
        } else value += char;
        continue;
      }
      if (scanner.pos >= this.end) this.error("Incomplete string escape", start);
      const escape = scanner.peek();
      scanner.pos++;
      if (escape === "\n") continue;
      if (escape === "\r") { scanner.eat("\n"); continue; }
      if (escape === "x" || escape === "u") {
        const braced = escape === "u" && scanner.eat("{");
        const digits = braced ? scanner.read(/[0-9a-fA-F]+/y) : scanner.read(escape === "x" ? /[0-9a-fA-F]{2}/y : /[0-9a-fA-F]{4}/y);
        if (!digits || (braced && !scanner.eat("}")) || Number.parseInt(digits, 16) > 0x10ffff) this.error("Invalid hexadecimal escape", start);
        value += String.fromCodePoint(Number.parseInt(digits, 16));
      } else {
        if (/[1-9]/.test(escape) || (escape === "0" && /\d/.test(scanner.peek() ?? ""))) this.error("Legacy numeric escapes are not supported", start);
        const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
        value += escapes[escape] ?? escape;
      }
    }
    return value;
  }
}