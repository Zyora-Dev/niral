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
 *       – `declare function <fn>(…): Promise<any>` per <server> export (RPC stubs)
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
declare const session: { get(k: string, d?: any): any; set(k: string, v: any): void; delete(k: string): void; clear(): void; all(): Record<string, any> };
declare function publish(channel: string, data: unknown): void;
declare function user(): any;
declare const auth: any;
declare function mail(opts: { to: string; from?: string; subject: string; text: string; html?: string; smtpUrl?: string }): Promise<any>;
declare function enqueue(name: string, data?: unknown, opts?: { delay?: number; maxAttempts?: number }): Promise<any>;
declare function env(key: string, fallback?: string): string | undefined;
declare const v: any;
declare function validate(shape: any, data: any): { ok: boolean; value: any; errors: Record<string, string> };
declare function withSchema(shape: any, fn: (value: any, ...rest: any[]) => any): (...args: any[]) => any;
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

/** Build the virtual TS view of a project. */
export function collectVirtualFiles(root) {
  const virtual = new Map(); // abs virtual path → { text, origin, originLine, realLen }
  const rootNames = [];
  const ambientPath = join(resolve(root), "__niral-ambient.d.ts");
  virtual.set(ambientPath, { text: AMBIENT, origin: null });
  rootNames.push(ambientPath);

  for (const abs of walkFiles(resolve(root))) {
    if (/\.(ts|tsx)$/.test(abs)) {
      rootNames.push(abs); // real file — TS reads it from disk
      continue;
    }
    // .niral — extract lang="ts" blocks
    let ast;
    const source = readFileSync(abs, "utf8");
    try {
      ast = parse(source, abs);
    } catch {
      continue; // compile errors are the dev server/build's job, not check's
    }
    const serverLang = ast.server?.attrs?.lang ?? "js";
    const stubs = ast.server
      ? collectServerExports(ast.server.code, serverLang)
          .filter((f) => f !== "load")
          .map((f) => `declare function ${f}(...args: any[]): Promise<any>;`)
          .join("\n")
      : "";

    if (ast.script?.attrs?.lang === "ts") {
      const code = ast.script.code;
      // imports of sibling .niral components → their virtual .ts twins
      const mapped = code.replace(/(from\s*")([^"]+)\.niral(")/g, "$1$2.niral.ts$3");
      const tail = `\n${stubs}\ndeclare const __niral_component: any;\nexport default __niral_component;\nexport {};`;
      virtual.set(abs + ".ts", {
        text: mapped + tail,
        origin: abs,
        originLine: lineOf(source, source.indexOf(code)),
        realLen: mapped.length,
      });
      rootNames.push(abs + ".ts");
    }
    if (ast.server && serverLang === "ts") {
      const code = ast.server.code;
      virtual.set(abs + ".server.ts", {
        text: code + "\nexport {};",
        origin: abs,
        originLine: lineOf(source, source.indexOf(code)),
        realLen: code.length,
      });
      rootNames.push(abs + ".server.ts");
    }
  }
  return { virtual, rootNames };
}

/**
 * Type-check the project. Returns { errors: [{file, line, col, code, message}], checked }.
 */
export function check({ root = "." } = {}) {
  const ts = loadTypescript(root);
  const { virtual, rootNames } = collectVirtualFiles(root);

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
      if ((d.start ?? 0) >= vf.realLen) continue; // our appended tail — not user code
      errors.push({
        file: vf.origin,
        line: pos.line + vf.originLine + 1,
        col: pos.character + 1,
        code: `TS${d.code}`,
        message,
      });
    } else {
      errors.push({ file: d.file.fileName, line: pos.line + 1, col: pos.character + 1, code: `TS${d.code}`, message });
    }
  }
  const checked = rootNames.filter((f) => !f.endsWith("__niral-ambient.d.ts")).length;
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
