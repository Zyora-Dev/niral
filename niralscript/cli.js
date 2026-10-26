#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkNiralScript } from "./check.js";
import { NiralScriptError } from "./errors.js";

const HELP = `Usage: nrs check <file.nrs>... [--root <directory>] [--global <name>] [--json]

Check source and relative imports without executing or emitting code.
Entry paths are relative to --root (default: current working directory).
Host globals must be declared explicitly; --global can be repeated.
Exit codes: 0 success, 1 source/file errors, 2 invalid arguments.
`;

function argumentsFor(args) {
  if (args[0] !== "check") throw new Error("Expected the 'check' command");
  const options = { root: process.cwd(), files: [], globals: [], json: false };
  let positional = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (positional) options.files.push(arg);
    else if (arg === "--") positional = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--root" || arg === "--global") {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`Expected a value after ${arg}`);
      if (arg === "--root") options.root = value;
      else {
        if (!/^[A-Za-z_$][\w$]*$/.test(value)) throw new Error("--global requires an identifier");
        options.globals.push(value);
      }
    } else if (arg.startsWith("-")) throw new Error(`Unknown option '${arg}'`);
    else options.files.push(arg);
  }
  if (!options.files.length) throw new Error("At least one .nrs entry file is required");
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
      checkNiralScript(input.source, input.filename, { resolveModule, globals: options.globals });
    } catch (error) {
      report(error);
    }
  }
  return diagnostics;
}

function main(args) {
  if ((args.length === 1 && ["--help", "-h"].includes(args[0])) || (args.length === 2 && args[0] === "check" && ["--help", "-h"].includes(args[1]))) {
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
  } else process.stdout.write(`Checked ${options.files.length} NiralScript ${options.files.length === 1 ? "entry" : "entries"}.\n`);
  return diagnostics.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));