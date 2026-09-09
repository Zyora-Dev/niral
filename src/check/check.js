/**
 * niral check — REAL TypeScript checking for .niral projects (zero framework deps).
 *
 * We don't hand-roll a type checker — we drive the actual TypeScript compiler:
 *   resolution order for the compiler itself
 *     1. NIRAL_TSC env (absolute path to typescript.js)
 *     2. <project>/node_modules/typescript/lib/typescript.js (or any parent's)
 *     3. <project>/.niral/lib/typescript/typescript.js (from `niral add typescript`)
 *
 * What gets checked:
 *   · every .ts / .tsx file in the project (routes/, lib/, components/ …)
 *   · every <script lang="ts"> block in .niral files — extracted into a
 *     virtual `<file>.niral.ts` module with:
 *       – ambient declarations for runes + server ambients (niral-ambient.d.ts)
 *       – server-derived RPC signatures and loader props (type-only references)
 *       – `.niral` import specifiers mapped to their virtual .ts twins
 *     Diagnostics map back to the ORIGINAL .niral line/column.
 *   · <server lang="ts"> blocks the same way (`<file>.server.ts`)
 *
 * Plain-JS <script> blocks are not checked (opt in by adding lang="ts").
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { parse } from "../compiler/parser.js";
import { collectServerExports } from "../compiler/codegen.js";

const AMBIENT = `
declare function $state<T>(v: T): T;
declare function $derived<T>(v: T): T;
declare const $props: any;
declare function live(channel: string, cb: (data: any) => void): { send: (d: any) => void; close: () => void };
declare function t(key: string, params?: Record<string, unknown>): string;
declare function setContext(key: unknown, value: unknown): void;
declare function getContext<T = unknown>(key: unknown, fallback?: T): T;
declare function onMount(fn: () => void | (() => void)): void;
declare function onDestroy(fn: () => void): void;
declare const session: { get(k: string, d?: any): any; set(k: string, v: any): void; delete(k: string): void; clear(): void; all(): Record<string, any> };
declare function publish(channel: string, data: unknown): void;
declare function user(): any;
declare const auth: any;
declare function mail(opts: { to: string; from?: string; subject: string; text: string; html?: string; smtpUrl?: string }): Promise<any>;
declare function enqueue(name: string, data?: unknown, opts?: { delay?: number; maxAttempts?: number }): Promise<any>;
declare function env(key: string, fallback?: string): string | undefined;
type __niral_Rule<Value> = { __rule: (value: unknown, field: string) => { value?: Value; error?: string } };
type __niral_Shape = Record<string, __niral_Rule<any>>;
type __niral_Value<Rule> = Rule extends __niral_Rule<infer Value> ? Value : never;
type __niral_Values<Shape extends __niral_Shape> = {
  [Key in keyof Shape as undefined extends __niral_Value<Shape[Key]> ? never : Key]: __niral_Value<Shape[Key]>
} & {
  [Key in keyof Shape as undefined extends __niral_Value<Shape[Key]> ? Key : never]?: __niral_Value<Shape[Key]>
};
type __niral_Upload = { filename: string; type: string; size: number; data: Uint8Array };
type __niral_Errors<Input> = {
  [Key in Extract<keyof Input, string>]?: NonNullable<Input[Key]> extends readonly any[] | __niral_Upload ? string : NonNullable<Input[Key]> extends object ? string | __niral_Errors<NonNullable<Input[Key]>> : string
};
declare const v: {
  string(options?: { min?: number; max?: number; pattern?: RegExp; trim?: boolean }): __niral_Rule<string>;
  email(): __niral_Rule<string>;
  int(options?: { min?: number; max?: number }): __niral_Rule<number>;
  number(options?: { min?: number; max?: number }): __niral_Rule<number>;
  bool(): __niral_Rule<boolean>;
  oneOf<const Value>(options: readonly Value[]): __niral_Rule<Value>;
  optional<Value>(rule: __niral_Rule<Value>): __niral_Rule<Value | undefined>;
  array<Value>(rule: __niral_Rule<Value>, options?: { min?: number; max?: number }): __niral_Rule<Value[]>;
  file(options?: { maxSize?: number; types?: string[] }): __niral_Rule<__niral_Upload>;
  object<Shape extends __niral_Shape>(shape: Shape): __niral_Rule<__niral_Values<Shape>>;
};
declare function validate<Shape extends __niral_Shape>(shape: Shape, data: unknown): { ok: true; value: __niral_Values<Shape>; errors: null } | { ok: false; value: Partial<__niral_Values<Shape>>; errors: __niral_Errors<__niral_Values<Shape>> };
declare function withSchema<Shape extends __niral_Shape, Rest extends any[], Result>(shape: Shape, fn: (value: __niral_Values<Shape>, ...rest: Rest) => Result): (value: __niral_Values<Shape>, ...rest: Rest) => Promise<Awaited<Result>>;
type __niral_FormAction<Fn extends (...args: any[]) => any> = {
  readonly pending: boolean;
  readonly status: "idle" | "pending" | "success" | "error";
  readonly result: Awaited<ReturnType<Fn>> | undefined;
  readonly errors: __niral_Errors<Parameters<Fn>[0]>;
  readonly error: string | null;
  readonly statusCode: number;
  submit(event: SubmitEvent): Promise<void>;
  reset(): void;
};
declare function formAction(name: string): __niral_FormAction<(...args: any[]) => any>;
declare const log: { debug(m: unknown, f?: object): void; info(m: unknown, f?: object): void; warn(m: unknown, f?: object): void; error(m: unknown, f?: object): void };
declare function projectImport(p: string): Promise<any>;
`;

/** Load the TypeScript compiler module (throws a teaching error when absent). */
export function loadTypescript(root) {
  const req = createRequire(join(resolve(root), "package.json"));
  const candidates = [];
  if (process.env.NIRAL_TSC) candidates.push(process.env.NIRAL_TSC);
  for (let d = resolve(root); ; d = dirname(d)) {
    candidates.push(join(d, "node_modules", "typescript", "lib", "typescript.js"));
    if (dirname(d) === d) break;
  }
  candidates.push(join(resolve(root), ".niral", "lib", "typescript", "typescript.js"));
  for (const c of candidates) {
    if (existsSync(c)) return req(c);
  }
  throw new Error(
    "TypeScript compiler not found — run `niral add typescript` (downloads it once into .niral/), " +
      "or install typescript in the project. (NIRAL_TSC env can point at a typescript.js.)"
  );
}

const SKIP_DIRS = new Set(["node_modules", "dist", "data", ".git", ".niral"]);

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(abs, out);
    else if (/\.(niral|ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

/** Line number (0-based) of `index` within `source`. */
function lineOf(source, index) {
  let line = 0;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}

function routeParamType(root, filename) {
  const route = relative(join(resolve(root), "routes"), filename);
  if (route.startsWith("..")) return "{}";
  const names = [...route.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((match) => match[1]);
  return `{ ${[...new Set(names)].map((name) => `${JSON.stringify(name)}: string`).join("; ")} }`;
}

function sourceView(source, origin) {
  const view = { text: "", source, origin, mappings: [] };
  const append = (text, offset, exact = false) => {
    if (offset !== undefined) view.mappings.push({ start: view.text.length, end: view.text.length + text.length, offset, exact });
    view.text += text;
  };
  return { view, append };
}

function componentContract(ts, script, append) {
  const tree = ts.createSourceFile("component.ts", script, ts.ScriptTarget.Latest, true);
  const fields = [];
  const bindings = [];
  let annotation;
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer?.getText(tree) !== "$props") continue;
      if (declaration.type) annotation = declaration.type.getText(tree);
      if (!ts.isObjectBindingPattern(declaration.name)) return { props: annotation ?? "any", bindings: "{}" };
      for (const element of declaration.name.elements) {
        if (element.dotDotDotToken) continue;
        const property = element.propertyName ?? element.name;
        if (!ts.isIdentifier(property) && !ts.isStringLiteral(property)) continue;
        if (ts.isIdentifier(element.name)) bindings.push(`${JSON.stringify(property.text)}: typeof ${element.name.text}`);
        let type = "any";
        if (element.initializer) {
          const identifier = `__niral_default_${fields.length}`;
          append(`\nlet ${identifier} = (${element.initializer.getText(tree)});`);
          type = `typeof ${identifier}`;
        }
        fields.push(`${JSON.stringify(property.text)}${element.initializer ? "?" : ""}: ${type}`);
      }
    }
  }
  return { props: annotation ?? `{ ${fields.join("; ")} }`, bindings: `{ ${bindings.join("; ")} }` };
}

function templateChecks(nodes, append) {
  const expression = (value) => append(value.raw, value.start, true);
  for (const node of nodes) {
    if (node.type === "Element") {
      if (/^[A-Z]/.test(node.tag)) {
        append(`\n${node.tag}({`, node.start);
        for (const attribute of node.attrs) {
          if (!["Attr", "On", "Bind"].includes(attribute.type) || attribute.name === "slot") continue;
          const name = attribute.type === "On" ? "on" + attribute.event[0].toUpperCase() + attribute.event.slice(1) : attribute.name;
          append(`\n${JSON.stringify(name)}: `, attribute.expr?.start ?? node.start);
          if (attribute.type === "Attr" && typeof attribute.value !== "object") {
            append(JSON.stringify(attribute.value), node.start);
          } else {
            expression(attribute.expr ?? attribute.value);
          }
          append(",");
        }
        append("\n});", node.start);
        for (const attribute of node.attrs.filter((entry) => entry.type === "Bind")) {
          append(`\n((__niral_value: typeof ${node.tag}.__bindings[${JSON.stringify(attribute.name)}]) => { `, node.start);
          expression(attribute.expr);
          append(" = __niral_value; });", attribute.expr.start);
        }
      } else {
        for (const attribute of node.attrs) {
          if (attribute.type === "Attr" && typeof attribute.value === "object") {
            append("\nvoid ("); expression(attribute.value); append(");");
          }
        }
      }
      templateChecks(node.children, append);
    } else if (node.type === "Mustache" || node.type === "RawHtml") {
      append("\nvoid ("); expression(node.expr); append(");");
    } else if (node.type === "IfBlock") {
      node.branches.forEach((branch, index) => {
        append(index ? " else " : "\n");
        if (branch.expr) { append("if ("); expression(branch.expr); append(") "); }
        append("{\n"); templateChecks(branch.children, append); append("\n}");
      });
    } else if (node.type === "ForBlock") {
      append("\n{\n");
      if (node.index) append(`let ${node.index} = 0;\n`);
      append(`for (const ${node.item} of (`); expression(node.iterable); append(")) {\n");
      if (node.keyExpr) { append("void ("); expression(node.keyExpr); append(");\n"); }
      templateChecks(node.children, append);
      if (node.index) append(`\n${node.index}++;`);
      append("\n}}\n");
    } else if (node.type === "AwaitBlock") {
      templateChecks(node.pending, append);
      append("\nPromise.resolve("); expression(node.expr);
      append(`).then((${node.thenVar ?? "__niral_result"}) => {\n`);
      templateChecks(node.thenChildren ?? [], append);
      append(`\n}, (${node.catchVar ?? "__niral_error"}: any) => {\n`);
      templateChecks(node.catchChildren ?? [], append); append("\n});\n");
    }
  }
}

/** Build the virtual TS view of a project. */
export function collectVirtualFiles(root, { ts = loadTypescript(root), documents = new Map() } = {}) {
  const virtual = new Map(); // abs virtual path → { text, origin, originLine, realLen }
  const rootNames = [];
  const ambientPath = join(resolve(root), "__niral-ambient.d.ts");
  virtual.set(ambientPath, { text: AMBIENT, origin: null });
  rootNames.push(ambientPath);

  const files = new Set([...walkFiles(resolve(root)), ...documents.keys()]);
  for (const abs of files) {
    if (/\.(ts|tsx)$/.test(abs)) {
      if (documents.has(abs)) {
        const { view, append } = sourceView(documents.get(abs), abs);
        append(view.source, 0, true);
        virtual.set(abs, view);
      }
      rootNames.push(abs); // real file — TS reads it from disk
      continue;
    }
    // .niral — extract lang="ts" blocks
    let ast;
    if (!abs.endsWith(".niral")) continue;
    const source = documents.get(abs) ?? readFileSync(abs, "utf8");
    try {
      ast = parse(source, abs);
    } catch {
      continue; // compile errors are the dev server/build's job, not check's
    }
    const serverLang = ast.server?.attrs?.lang ?? "js";
    const typedServer = ast.server && ["js", "ts", "javascript", "typescript"].includes(serverLang);
    const serverExtension = ["ts", "typescript"].includes(serverLang) ? "ts" : "js";
    const serverModule = JSON.stringify("./" + abs.split(sep).pop() + ".server." + serverExtension);
    const serverExports = ast.server ? collectServerExports(ast.server.code, serverLang) : [];
    const stubs = ast.server
      ? serverExports
          .filter((f) => f !== "load")
          .map((f) => typedServer
            ? `declare const ${f}: __niral_RPC<typeof import(${serverModule}).${f}>;`
            : `declare function ${f}(...args: any[]): Promise<any>;`)
          .join("\n")
      : "";
    const routeParams = routeParamType(root, abs);
    const { view, append } = sourceView(source, abs);
    const code = ast.script?.code ?? "";
    view.checked = ast.script?.attrs?.lang === "ts";
    append(code, ast.script ? source.indexOf(code, ast.script.start) : 0, true);
    append(`\ntype __niral_RPC<Fn extends (...args: any[]) => any> = ReturnType<Fn> extends PromiseLike<any> ? Fn : (...args: Parameters<Fn>) => Promise<Awaited<ReturnType<Fn>>>;\n${stubs}\n`);
    const contract = componentContract(ts, code, append);
    const actions = serverExports.filter((name) => name !== "load");
    if (actions.length && !/\b(?:let|const|var|function|import)\s+(?:\{[^}]*\b)?formAction\b/.test(code)) {
      append(`\ntype __niral_Actions = { ${actions.map((name) => `${JSON.stringify(name)}: typeof ${name}`).join("; ")} };\ndeclare function formAction<Name extends keyof __niral_Actions>(name: Name): __niral_FormAction<__niral_Actions[Name]>;\n`);
    }
    const loader = `Awaited<ReturnType<typeof import(${serverModule}).load>>`;
    const props = typedServer && serverExports.includes("load")
      ? `Omit<${routeParams}, keyof ${loader}> & ${loader}`
      : relative(join(resolve(root), "routes"), abs).startsWith("..") ? contract.props : `${routeParams} & ${contract.props}`;
    append(`\ntype __niral_Props = ${props};\ndeclare const $props: __niral_Props;\ndeclare const __niral_component: { (props: __niral_Props): unknown; __bindings: Omit<__niral_Props, keyof ${contract.bindings}> & ${contract.bindings} };\nexport default __niral_component;\n`);
    if (view.checked) {
      append("\nfunction __niral_template() {\n");
      templateChecks(ast.template, append);
      append("\n}\n__niral_template();\n");
    }
    virtual.set(abs + ".ts", view);
    rootNames.push(abs + ".ts");
    if (typedServer) {
      const { view: serverView, append: appendServer } = sourceView(source, abs);
      const serverCode = ast.server.code;
      serverView.checked = serverExtension === "ts";
      const tree = ts.createSourceFile(abs + ".server." + serverExtension, serverCode, ts.ScriptTarget.Latest, true);
      const offset = source.indexOf(serverCode, ast.server.start);
      let cursor = 0;
      if (serverView.checked) {
        for (const statement of tree.statements) {
          if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== "load") continue;
          const parameter = statement.parameters[0];
          if (!parameter || parameter.type) continue;
          appendServer(serverCode.slice(cursor, parameter.name.end), offset + cursor, true);
          appendServer(`: { params: ${routeParams}; locals: Record<string, any> }`);
          cursor = parameter.name.end;
        }
      }
      appendServer(serverCode.slice(cursor), offset + cursor, true);
      appendServer("\nexport {};\n");
      virtual.set(abs + ".server." + serverExtension, serverView);
      rootNames.push(abs + ".server." + serverExtension);
    }
  }
  return { virtual, rootNames };
}

/**
 * Type-check the project. Returns { errors: [{file, line, col, code, message}], checked }.
 */
export function check({ root = ".", documents = new Map() } = {}) {
  const ts = loadTypescript(root);
  const { virtual, rootNames } = collectVirtualFiles(root, { ts, documents });

  // project tsconfig compilerOptions are respected when present
  let userOptions = {};
  const tsconfigPath = join(resolve(root), "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const parsed = ts.readConfigFile(tsconfigPath, (f) => readFileSync(f, "utf8"));
    if (parsed.config?.compilerOptions) {
      userOptions = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions, resolve(root)).options ?? {};
    }
  }
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    allowImportingTsExtensions: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
    types: [],
    ...userOptions,
    noEmit: true, // never let a tsconfig turn emit on
  };

  const host = ts.createCompilerHost(options, true);
  const norm = (f) => resolve(f);
  const realRead = host.readFile.bind(host);
  const realExists = host.fileExists.bind(host);
  host.readFile = (f) => virtual.get(norm(f))?.text ?? realRead(f);
  host.fileExists = (f) => virtual.has(norm(f)) || realExists(f);
  host.resolveModuleNames = (names, containingFile) => names.map((name) => {
    if (name.endsWith(".niral") && name.startsWith(".")) {
      const filename = resolve(dirname(containingFile), name) + ".ts";
      if (virtual.has(filename)) return { resolvedFileName: filename, extension: ts.Extension.Ts };
    }
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
  });

  const program = ts.createProgram(rootNames, options, host);
  const diags = ts.getPreEmitDiagnostics(program);

  const errors = [];
  for (const d of diags) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (!d.file) {
      errors.push({ file: "(global)", line: 0, col: 0, code: `TS${d.code}`, message });
      continue;
    }
    const vf = virtual.get(norm(d.file.fileName));
    const pos = ts.getLineAndCharacterOfPosition(d.file, d.start ?? 0);
    if (vf?.origin) {
      if (vf.checked === false) continue;
      const mapping = vf.mappings.find((entry) => (d.start ?? 0) >= entry.start && (d.start ?? 0) < entry.end);
      if (!mapping) continue;
      const offset = mapping.offset + (mapping.exact ? (d.start ?? 0) - mapping.start : 0);
      const line = lineOf(vf.source, offset);
      errors.push({
        file: vf.origin,
        line: line + 1,
        col: offset - vf.source.lastIndexOf("\n", offset - 1),
        code: `TS${d.code}`,
        message,
      });
    } else {
      errors.push({ file: d.file.fileName, line: pos.line + 1, col: pos.character + 1, code: `TS${d.code}`, message });
    }
  }
  const checked = rootNames.filter((f) => !f.endsWith("__niral-ambient.d.ts") && virtual.get(f)?.checked !== false).length;
  return { errors, checked };
}

/** CLI-facing formatter. */
export function formatCheck(result, root) {
  const lines = [];
  for (const e of result.errors) {
    const rel = e.file === "(global)" ? e.file : relative(resolve(root), e.file).split(sep).join("/");
    lines.push(`${rel}:${e.line}:${e.col} — ${e.code}: ${e.message.split("\n")[0]}`);
  }
  lines.push(
    result.errors.length
      ? `\nniral check · ${result.errors.length} error${result.errors.length === 1 ? "" : "s"} in ${result.checked} file(s)`
      : `niral check · clean — ${result.checked} file(s), 0 errors`
  );
  return lines.join("\n");
}
