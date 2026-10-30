#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkNiralScript } from "./check.js";
import { compileNiralScript } from "./compile.js";
import { NiralScriptError } from "./errors.js";

const HELP = `Usage: nrs check <file.nrs>... [--root <directory>] [--global <name>] [--strict] [--json]
  nrs compile <file.nrs> --out <file.mjs> [--root <directory>] [--global <name>] [--strict] [--json]

Check source and relative imports without executing or emitting code.
Compile emits an independent ESM instance factory and a .mjs.map source map.
Output paths are relative to --root; parents must exist; files are never overwritten.
Entry paths are relative to --root (default: current working directory).
Host globals must be declared explicitly; --global can be repeated.
--strict requires narrowing unknown and nullable values before typed use.
Exit codes: 0 success, 1 source/file errors, 2 invalid arguments.
`;

function argumentsFor(args) {
  if (!["check", "compile"].includes(args[0])) throw new Error("Expected the 'check' or 'compile' command");
  const options = { command: args[0], root: process.cwd(), files: [], globals: [], json: false };
  let positional = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (positional) options.files.push(arg);
    else if (arg === "--") positional = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--strict") options.strictTypes = true;
    else if (arg === "--root" || arg === "--global" || arg === "--out") {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`Expected a value after ${arg}`);
      if (arg === "--root") options.root = value;
      else if (arg === "--out") options.out = value;
      else {
        if (!/^[A-Za-z_$][\w$]*$/.test(value)) throw new Error("--global requires an identifier");
        options.globals.push(value);
      }
    } else if (arg.startsWith("-")) throw new Error(`Unknown option '${arg}'`);
    else options.files.push(arg);
  }
  if (!options.files.length) throw new Error("At least one .nrs entry file is required");
  if (options.command === "compile" && (options.files.length !== 1 || !options.out?.endsWith(".mjs"))) throw new Error("Compile requires one entry and --out <file.mjs>");
  if (options.command === "check" && options.out) throw new Error("--out requires the compile command");
  return options;
}

function checkFiles(options) {
  const diagnostics = [];
  const report = error => {
    if (!(error instanceof NiralScriptError)) throw error;
    diagnostics.push({ code: error.code, message: error.message, filename: error.filename, start: error.start, end: error.end, line: error.line, column: error.col });
  };
  let root;
  try {
    root = realpathSync(resolve(options.root));
    if (!lstatSync(root).isDirectory()) throw new Error("not a directory");
  } catch {
    report(new NiralScriptError("NRS077", "Root must be an existing directory", { source: "", filename: resolve(options.root), start: 0, end: 0 }));
    return diagnostics;
  }
  const sources = new Map();
  function load(filename, location = { source: "", filename, start: 0, end: 0 }) {
    const fail = message => { throw new NiralScriptError("NRS077", message, location); };
    const local = relative(root, filename);
    if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) fail("NiralScript sources must stay inside the root directory");
    if (!filename.endsWith(".nrs")) fail("NiralScript sources require the .nrs extension");
    try {
      let current = root;
      for (const segment of local.split(sep)) {
        current = join(current, segment);
        if (lstatSync(current).isSymbolicLink()) fail("NiralScript source paths cannot contain symlinks");
      }
      if (!lstatSync(filename).isFile()) fail("NiralScript sources must be regular files");
      const canonical = realpathSync(filename);
      if (!sources.has(canonical)) sources.set(canonical, { filename: canonical, source: readFileSync(canonical, "utf8") });
      return sources.get(canonical);
    } catch (error) {
      if (error instanceof NiralScriptError) throw error;
      fail(`Cannot read NiralScript source (${error.code ?? "I/O error"})`);
    }
  }
  const resolveModule = (specifier, importer, location) => {
    if (!/^\.\.?\//.test(specifier) || !specifier.endsWith(".nrs") || /[\\?#%:\x00-\x1f\x7f]/.test(specifier)) {
      throw new NiralScriptError("NRS077", "Imports must be explicit relative .nrs file paths", location);
    }
    return load(resolve(dirname(importer), specifier), location);
  };
  for (const file of options.files) {
    try {
      const input = load(resolve(root, file));
      const policy = { resolveModule, globals: options.globals, strictTypes: options.strictTypes };
      if (options.command === "check") checkNiralScript(input.source, input.filename, policy);
      else {
        const output = resolve(root, options.out);
        const local = relative(root, output);
        const location = { source: input.source, filename: input.filename, start: 0, end: 0 };
        const fail = message => { throw new NiralScriptError("NRS079", message, location); };
        if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) fail("Output must stay inside the root directory");
        const result = compileNiralScript(input.source, input.filename, { ...policy, file: basename(output) });
        result.map.sources = result.map.sources.map(filename => relative(dirname(output), filename).split(sep).join("/"));
        let createdMap = false;
        try {
          let current = root;
          for (const segment of local.split(sep).slice(0, -1)) {
            current = join(current, segment);
            if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) fail("Output parents must be existing directories without symlinks");
          }
          writeFileSync(output + ".map", JSON.stringify(result.map) + "\n", { flag: "wx" });
          createdMap = true;
          writeFileSync(output, result.code + `//# sourceMappingURL=${encodeURIComponent(basename(output))}.map\n`, { flag: "wx" });
        } catch (error) {
          if (createdMap) unlinkSync(output + ".map");
          if (error instanceof NiralScriptError) throw error;
          fail(`Cannot write output (${error.code ?? "I/O error"}); existing files are not overwritten`);
        }
      }
    } catch (error) {
      report(error);
    }
  }
  return diagnostics;
}

function main(args) {
  if ((args.length === 1 && ["--help", "-h"].includes(args[0])) || (args.length === 2 && ["check", "compile"].includes(args[0]) && ["--help", "-h"].includes(args[1]))) {
    process.stdout.write(HELP);
    return 0;
  }
  let options;
  try {
    options = argumentsFor(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${HELP}`);
    return 2;
  }
  const diagnostics = checkFiles(options);
  if (options.json) process.stdout.write(JSON.stringify({ ok: diagnostics.length === 0, entries: options.files.length, diagnostics }) + "\n");
  else if (diagnostics.length) {
    for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}: ${diagnostic.message}\n`);
  } else process.stdout.write(`${options.command === "compile" ? "Compiled" : "Checked"} ${options.files.length} NiralScript ${options.files.length === 1 ? "entry" : "entries"}.\n`);
  return diagnostics.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));