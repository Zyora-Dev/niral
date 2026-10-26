import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileClient } from "../src/compiler/codegen.js";
import { loadComponent, renderComponent } from "../src/server/render.js";
import { validate } from "../src/lsp/analysis.js";
import { compileNiralScript, emitNiralScript, lowerNiralScript } from "../src/compiler/niralscript.js";
import { collectDeclarations, rewriteScript } from "../src/compiler/rewrite.js";
import { parseNiralScript, analyzeNiralScript, NiralScriptError } from "../niralscript/parser.js";
import { ExpressionParser } from "../niralscript/expressions.js";
import { linkNiralScript } from "../niralscript/modules.js";
import { checkNiralScript } from "../niralscript/check.js";

test("NiralScript standalone CLI checks copied sources without the framework", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nrs-cli-")));
  try {
    const project = join(root, "project");
    mkdirSync(project);
    cpSync(new URL("../niralscript/", import.meta.url), join(root, "language"), { recursive: true });
    const cli = join(root, "language", "cli.js");
    const api = spawnSync(process.execPath, ["--input-type=module", "--eval", 'import { parseNiralScript } from "niralscript"; import { checkNiralScript } from "niralscript/check"; if (parseNiralScript("state count = 1").body.length !== 1 || checkNiralScript("state count = 1").analysis.bindings.length !== 1) throw new Error("Invalid package exports")'], { cwd: join(root, "language"), encoding: "utf8", timeout: 10000 });
    assert.ifError(api.error);
    assert.equal(api.status, 0, api.stderr);
    const run = (...args) => {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: project, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      return result;
    };
    const check = (...args) => run("check", ...args);
    writeFileSync(join(project, "base.nrs"), "export const base = 2");
    writeFileSync(join(project, "math.nrs"), 'import { base } from "./base.nrs"\nexport function twice(value) { return value * base }');
    writeFileSync(join(project, "entry.nrs"), 'import { twice } from "./math.nrs"\nstate count = 2\nderive result = twice(count)');
    assert.equal(check("entry.nrs").status, 0);
    assert.match(check("entry.nrs").stdout, /Checked 1 NiralScript entry/);
    assert.equal(check("project/entry.nrs", "--root", "..").status, 0);
    const successful = check("--root", project, "entry.nrs", "math.nrs", "--json");
    assert.equal(successful.status, 0);
    assert.equal(successful.stderr, "");
    assert.deepEqual(JSON.parse(successful.stdout), { ok: true, entries: 2, diagnostics: [] });
    writeFileSync(join(project, "host.nrs"), "const result = mustNotExecute()");
    const before = readdirSync(project).sort();
    assert.equal(check("host.nrs").status, 1);
    assert.equal(check("host.nrs", "--global", "mustNotExecute").status, 0);
    assert.deepEqual(readdirSync(project).sort(), before);
    writeFileSync(join(project, "base.nrs"), "\nexport const base = missing");
    const invalid = check("entry.nrs", "--json");
    assert.equal(invalid.status, 1);
    const report = JSON.parse(invalid.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.diagnostics[0], { code: "NRS073", message: "Unresolved name 'missing'", filename: join(project, "base.nrs"), start: 21, end: 28, line: 2, column: 21 });
    assert.match(check("entry.nrs").stderr, /base\.nrs:2:21 NRS073/);
    assert.equal(JSON.parse(check("entry.nrs", "host.nrs", "--json").stdout).diagnostics.length, 2);
    writeFileSync(join(project, "base.nrs"), 'import { twice } from "./math.nrs"\nexport const base = 2');
    assert.equal(JSON.parse(check("entry.nrs", "--json").stdout).diagnostics[0].code, "NRS078");
    writeFileSync(join(project, "base.nrs"), "export const base = 2");
    writeFileSync(join(root, "outside.nrs"), "export const base = 99");
    symlinkSync(join(root, "outside.nrs"), join(project, "link.nrs"));
    symlinkSync(root, join(project, "linked"), process.platform === "win32" ? "junction" : "dir");
    mkdirSync(join(project, "directory.nrs"));
    for (const file of ["../outside.nrs", "link.nrs", "linked/outside.nrs", "missing.nrs", "directory.nrs", "base.js"]) {
      const failure = check(file, "--json");
      assert.equal(failure.status, 1, file);
      assert.equal(JSON.parse(failure.stdout).diagnostics[0].code, "NRS077", file);
    }
    for (const specifier of ["../outside.nrs", "./link.nrs", "./linked/outside.nrs", "./missing.nrs", "./directory.nrs", "./base.js", "package", "https://example.invalid/base.nrs", "./base.nrs?raw", "./%62ase.nrs", ".\\base.nrs"]) {
      writeFileSync(join(project, "entry.nrs"), `import { base } from ${JSON.stringify(specifier)}`);
      const failure = check("entry.nrs", "--json");
      assert.equal(failure.status, 1, specifier);
      const diagnostic = JSON.parse(failure.stdout).diagnostics[0];
      assert.equal(diagnostic.code, "NRS077", specifier);
      assert.equal(diagnostic.filename, join(project, "entry.nrs"));
      assert.equal(diagnostic.start, 21);
    }
    assert.equal(check("entry.nrs", "--root", join(root, "absent"), "--json").status, 1);
    for (const args of [[], ["build"], ["check"], ["check", "--root"], ["check", "--global"], ["check", "--global", "not.a.name", "entry.nrs"], ["check", "--unknown", "entry.nrs"]]) {
      const failure = run(...args);
      assert.equal(failure.status, 2, args.join(" "));
      assert.match(failure.stderr, /Usage: nrs check/);
    }
    for (const args of [["--help"], ["-h"], ["check", "--help"]]) {
      const help = run(...args);
      assert.equal(help.status, 0);
      assert.match(help.stdout, /without executing or emitting code/);
    }
    writeFileSync(join(project, "-entry.nrs"), "state count = 1");
    assert.equal(check("--", "-entry.nrs").status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NiralScript standalone checking shares module and semantic diagnostics", () => {
  const source = 'import { twice } from "./math.nrs"\nstate count = 2\nderive result = twice(count)';
  let dependency = "export function twice(value) { return value * 2 }";
  const resolveModule = () => ({ filename: "math.nrs", source: dependency });
  const checked = checkNiralScript(source, "entry.nrs", { resolveModule });
  assert.equal(checked.program.modules.length, 1);
  assert.ok(checked.analysis.bindings.some(binding => binding.name === "result" && binding.kind === "derive"));
  dependency = "export function twice(value) {\n  return missing\n}";
  assert.throws(() => checkNiralScript(source, "entry.nrs", { resolveModule }), error => error.code === "NRS073" && error.filename === "math.nrs" && error.line === 2 && error.col === 10);
  assert.throws(() => checkNiralScript(source, "entry.nrs"), { code: "NRS078" });
  for (const [script, code] of [
    ["state count = 1\nstate count = 2", "NRS070"],
    ["state count = missing", "NRS073"],
    ["const count = 1\ncount = 2", "NRS074"],
    ["state count = read()\nfunction read() { return later }\nconst later = 1", "NRS074"],
    ["state count = 1\nfunction change() { count += 1; return count }\nderive result = change()", "NRS075"],
    ["derive first = second\nderive second = first", "NRS076"],
  ]) assert.throws(() => checkNiralScript(script, "entry.nrs"), { code }, script);
  assert.throws(() => checkNiralScript("state result = ping()"), { code: "NRS073" });
  assert.doesNotThrow(() => checkNiralScript("state result = ping()", "entry.nrs", { globals: ["ping"] }));
  dependency = "export function twice(value) { return ping() }";
  assert.throws(() => checkNiralScript(source, "entry.nrs", { resolveModule, globals: ["ping"], moduleGlobals: [] }), { code: "NRS073" });
  dependency = "export function twice(value) { return value }";
  const returnedAlias = 'import { twice } from "./math.nrs"\nderive value = { item: 1 }\nconst alias = twice(value)\nalias.item = 2';
  assert.throws(() => checkNiralScript(returnedAlias, "entry.nrs", { resolveModule }), error => error.code === "NRS074" && error.filename === "entry.nrs" && error.line === 4);
  dependency = "export function twice(value) {\n  function read() { return later }\n  const result = read()\n  const later = value\n  return result\n}";
  assert.throws(() => checkNiralScript(source, "entry.nrs", { resolveModule }), error => error.code === "NRS074" && error.filename === "math.nrs" && error.line === 2);
});

test("NiralScript links isolated modules with transitive semantic checks", async () => {
  const files = new Map([
    ["./base.nrs", "export const base = 2\nconst hidden = 5\nexport function twice(value) { return value * base }"],
    ["./math.nrs", 'import { twice as scale } from "./base.nrs"\nconst hidden = 10\nexport function calculate(value) { return scale(value) + hidden }'],
  ]);
  const resolveModule = specifier => ({ filename: specifier, source: files.get(specifier) });
  const source = 'import { calculate as run } from "./math.nrs"\nimport { base } from "./base.nrs"\nstate count = base\nderive result = run(count)\nconst record = { run }';
  const parsed = parseNiralScript(source, "entry.nrs");
  const snapshot = JSON.stringify(parsed);
  const linked = linkNiralScript(parsed, resolveModule);
  assert.equal(linked.modules.length, 2);
  assert.equal(JSON.stringify(parsed), snapshot);
  assert.doesNotThrow(() => analyzeNiralScript(linked));
  const compiled = compileNiralScript(source, "entry.nrs", { resolveModule });
  const runtime = new URL("../src/runtime/index.js", import.meta.url).href;
  const executable = `import * as __n from ${JSON.stringify(runtime)};\n${compiled.code}\nexport function values() { return [result.get(), record.run(1), run(2), base] }`;
  const result = await import("data:text/javascript;base64," + Buffer.from(executable).toString("base64"));
  assert.deepEqual(result.values(), [14, 12, 14, 2]);
  for (const [script, code] of [
    ['import { hidden } from "./base.nrs"', "NIRAL078"],
    ['import { base } from "./base.nrs"\nbase = 3', "NIRAL074"],
    ['import { twice } from "./base.nrs"\ntwice = 3', "NIRAL074"],
    ['import { base } from "./base.nrs"\nstate result = hidden', "NIRAL073"],
  ]) assert.throws(() => compileNiralScript(script, "entry.nrs", { resolveModule }), { code });
  files.set("./base.nrs", "const secret = missing\nexport const base = 2");
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule }), error => error.code === "NIRAL073" && error.filename === "./base.nrs" && error.start === 15 && error.line === 1);
  files.set("./base.nrs", 'import { calculate } from "./math.nrs"\nexport const base = 2');
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule }), /Module dependency cycle/);
  files.set("./base.nrs", "export const base = 2\nexport function twice(value) { return Math.random() }");
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule }), error => error.code === "NIRAL075" && error.filename === "./base.nrs");
  files.set("./base.nrs", "export const base = process.env.SECRET\nexport function twice(value) { return value }");
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule }), error => error.code === "NIRAL044" && error.filename === "./base.nrs");
  files.set("./base.nrs", "state base = 2");
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule }), /Library modules may only contain/);
  files.set("./base.nrs", "export const base = read()\nfunction read() { return later }\nconst later = 2\nexport function twice(value) { return value * base }");
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule }), { code: "NIRAL074" });
  files.set("./base.nrs", "export const base = ping()\nexport function twice(value) { return value * base }");
  assert.throws(() => compileNiralScript(source, "entry.nrs", { resolveModule, globals: ["ping"] }), { code: "NIRAL073" });
  assert.throws(() => compileNiralScript(source), { code: "NIRAL078" });
});

test("NiralScript parses named module imports and exported declarations", () => {
  const source = 'import { twice, base as initial, } from "./math.nrs";\nexport const answer = twice(initial)\nexport function read() { return answer }';
  const program = parseNiralScript(source, "module.nrs");
  assert.equal(program.body[0].type, "ImportDeclaration");
  assert.deepEqual(program.body[0].specifiers.map(({ imported, local }) => [imported.name, local.name]), [["twice", "twice"], ["base", "initial"]]);
  assert.equal(program.body[0].source.value, "./math.nrs");
  assert.equal(source.slice(program.body[0].start, program.body[0].end), source.split("\n")[0]);
  assert.equal(program.body[1].exported, true);
  assert.equal(program.body[2].exported, true);
  for (const separator of [" ; ", "\n", " /* separator */ ; ", " /*\n*/ "]) {
    assert.equal(parseNiralScript(`import { base } from "./math.nrs"${separator}const answer = base`).body.length, 2);
  }
  for (const script of [
    'import thing from "./math.nrs"', 'import * as math from "./math.nrs"',
    'export default 1', 'export state count = 0', 'export let count = 0',
    'export { value }', 'function read() { import { value } from "./math.nrs" }',
    'function read() { export const value = 1 }',
    'import { base } from "./math.nrs" const answer = base',
  ]) assert.throws(() => parseNiralScript(script), { code: "NRS078" }, script);
  assert.throws(() => parseNiralScript('import { first as value, second as value } from "./math.nrs"'), { code: "NRS070" });
});

test("NiralScript token dispatch preserves values, maximal operators and source spans", () => {
  const punctuation = "( ) [ ] { } , . : ` ? === !== == != <= >= && || ++ -- ** => ?? ?. += -= *= /= %= + - * / % ! = < >".split(" ");
  const fixtures = [
    { source: punctuation.join(" "), expected: punctuation.map(token => [token, token, token]) },
    { source: "0 12 10. .5 2.5e-3 1E+2", expected: [["0", "number", 0], ["12", "number", 12], ["10.", "number", 10], [".5", "number", 0.5], ["2.5e-3", "number", 0.0025], ["1E+2", "number", 100]] },
    { source: "\t\r\n\v\f\u00a0\u2028\u2029\ufeffAlpha_1 /* comment */ $value // trailing\r\n_next", expected: [["Alpha_1", "identifier", "Alpha_1"], ["$value", "identifier", "$value"], ["_next", "identifier", "_next"]] },
    { source: String.raw`"a\n\u0041" 'it\'s'`, expected: [[String.raw`"a\n\u0041"`, "string", "a\nA"], [String.raw`'it\'s'`, "string", "it's"]] },
  ];
  for (const { source, expected } of fixtures) {
    const parser = new ExpressionParser(source, "tokens.nrs", 0, source.length);
    let cursor = 0;
    for (const [raw, kind, value] of expected) {
      const start = source.indexOf(raw, cursor);
      const token = parser.peek();
      assert.equal(parser.peek(), token);
      assert.equal(parser.take(), token);
      assert.deepEqual(token, { kind, value, start, end: start + raw.length });
      cursor = token.end;
    }
    assert.equal(parser.take().kind, "eof");
  }
  for (const source of [" \u200b", " @"]) {
    const parser = new ExpressionParser(source, "tokens.nrs", 0, source.length);
    assert.throws(() => parser.take(), error => error.code === "NRS071" && error.start === 1 && error.end === 2 && error.filename === "tokens.nrs");
  }
});

test("NiralScript traversal preserves nested name, effect and cycle checks", () => {
  const wrap = value => [
    `[${value}]`, `{ item: ${value} }`, `\`value: \${${value}}\``,
    `(${value})`, `!${value}`, `1 + ${value}`, `false || ${value}`,
    `true ? 1 : ${value}`, `[1][${value}]`, `identity(${value})`,
  ];
  const identity = "function identity(value) { return value }\n";
  for (const expression of wrap("missing")) {
    assert.throws(() => lowerNiralScript(`${identity}state result = ${expression}`), { code: "NIRAL073" }, expression);
  }
  for (const expression of wrap("change()")) {
    const source = `${identity}state count = 0\nfunction change() { count += 1; return count }\nderive result = ${expression}`;
    assert.throws(() => lowerNiralScript(source), { code: "NIRAL075" }, expression);
  }
  for (const expression of wrap("result")) {
    assert.throws(() => lowerNiralScript(`${identity}derive result = ${expression}`), { code: "NIRAL076" }, expression);
  }
  assert.doesNotThrow(() => lowerNiralScript('state key = "item"\nconst record = { item: 1 }\nconst item = 2\nderive result = `${record[key]}:${({ item }).item}`'));
});

test("NiralScript rejects impure derived calls and dependency cycles", () => {
  for (const script of [
    "state count = 0\nfunction change() { count += 1; return count }\nderive result = change()",
    "state count = 0\nfunction change() { count = 2 }\nfunction indirect() { change(); return count }\nderive result = indirect()",
    "derive result = fetch('/value')",
    "derive result = result + 1",
    "derive first = second + 1\nderive second = first + 1",
    "function read() { return second }\nderive first = read()\nderive second = first",
    "state values = []\nstate count = 0\nfunction change() { count += 1; return count }\nvalues = { slice: change }\nderive result = values.slice()",
    "state values = []\nstate count = 0\nfunction change() { count += 1; return count }\nconst alias = values\nalias.slice = change\nderive result = values.slice()",
  ]) assert.throws(() => lowerNiralScript(script), error => ["NIRAL075", "NIRAL076"].includes(error.code), script);
  assert.doesNotThrow(() => lowerNiralScript("state count = 2\nfunction twice(value) { let result = value; result += value; return result }\nderive result = twice(count)"));
});

test("NiralScript checks aliases and eager captured reads", () => {
  for (const script of [
    "derive value = { item: 1 }\nconst alias = value\nalias.item = 2",
    "derive value = { item: 1 }\nlet alias = {}\nalias = value\nalias.item = 2",
    "derive value = { item: 1 }\nfunction change(item) { item.item = 2 }\nchange(value)",
    "derive values = []\nconst alias = values\nalias.push(1)",
    "derive value = { item: 1 }\nfunction read() { return value }\nconst alias = read()\nalias.item = 2",
    "derive value = { item: 1 }\nfunction identity(item) { return item }\nconst alias = identity(value)\nalias.item = 2",
    "derive value = { item: 1 }\nfunction read() { return value }\nconst reader = read\nfunction forward() { return reader() }\nforward().item = 2",
    "derive values = []\nfunction read() { return values }\nread().push(1)",
    "derive value = { item: 1 }\nfunction read(flag) { if (flag) { return read(false) } return value }\nread(true).item = 2",
    "derive value = { item: 1 }\nfunction read() { return value || {} }\nread().item = 2",
    "derive value = { item: 1 }\nfunction read() { return true && value }\nread().item = 2",
    "function read() { return Math }\nread().abs = replacement\nfunction replacement(value) { return value }",
    "state result = read()\nconst later = 2\nfunction read() { return later }",
    "derive result = later\nstate later = 2",
    "derive result = later\nconst eager = result\nstate later = 2",
    "function run() { const result = read(); const later = 2; function read() { return later } return result }\nstate result = run()",
    "function run() { const result = forward(); const later = 2; function forward() { return read() } function read() { return later } return result }\nstate result = run()",
    "{ const result = read(); const later = 2; function read() { return later } }",
    "const math = Math\nmath.abs = replacement\nfunction replacement(value) { return value }",
  ]) assert.throws(() => lowerNiralScript(script), { code: "NIRAL074" }, script);
  assert.doesNotThrow(() => lowerNiralScript("state count = 0\nfunction read() { return count }\nstate result = read()"));
  assert.doesNotThrow(() => lowerNiralScript("function run() { function read() { return later } const later = 2; return read() }\nstate result = run()"));
  assert.doesNotThrow(() => lowerNiralScript("{ function read() { return later } const later = 2; const result = read() }"));
  assert.doesNotThrow(() => lowerNiralScript("derive value = { item: 1 }\nfunction fresh() { function nested() { return value } return { item: 0 } }\nfresh().item = 2"));
  assert.doesNotThrow(() => lowerNiralScript("function fresh() { return { item: 0 } }\nconst first = fresh()\nfirst.item = 2"));
  assert.throws(() => lowerNiralScript("state values = []\nstate count = 0\nfunction read() { return values }\nfunction change() { count += 1; return count }\nread().slice = change\nderive result = values.slice()"), { code: "NIRAL075" });
  assert.throws(() => lowerNiralScript("state values = []\nstate count = 0\nfunction read() { return values || [] }\nfunction change() { count += 1; return count }\nread().slice = change\nderive result = values.slice()"), { code: "NIRAL075" });
});

test("NiralScript external sources resolve securely and retain their own diagnostics", () => {
  const root = mkdtempSync(join(tmpdir(), "niral-nrs-source-"));
  const filename = join(root, "routes", "index.niral");
  const external = join(root, "counter.nrs");
  const source = '<script lang="niralscript" src="../counter.nrs"></script><p>{count}</p>';
  mkdirSync(join(root, "routes"));
  writeFileSync(filename, source);
  writeFileSync(external, "state count = 1");
  try {
    const inputs = [];
    const compiled = compileClient(source, { root, filename, onSource: input => inputs.push(input) });
    assert.match(compiled.code, /count/);
    assert.equal(inputs[0].filename, external);
    assert.equal(compiled.ast.script.external.source, "state count = 1");
    assert.deepEqual(validate(source, filename, { root }), []);
    for (const specifier of ["counter.nrs", "/counter.nrs", "https://host/counter.nrs", "../counter.js", "../counter.nrs?raw", "../../outside.nrs", "../data/private.nrs", "../link.nrs"]) {
      if (specifier === "../link.nrs") symlinkSync(external, join(root, "link.nrs"));
      assert.throws(() => compileClient(source.replace("../counter.nrs", specifier), { root, filename }), { code: "NIRAL077" }, specifier);
    }
    assert.throws(() => compileClient(source.replace("></script>", ">state inline = 0</script>"), { root, filename }), { code: "NIRAL077" });
    writeFileSync(external, "state count = 1\nderive result = missing");
    assert.throws(() => compileClient(source, { root, filename }), error => error.code === "NIRAL073" && error.filename === external && error.line === 2 && error.source.includes("missing"));
    const diagnostic = validate(source, filename, { root })[0];
    assert.equal(diagnostic.relatedInformation[0].location.uri, pathToFileURL(external).href);
    assert.equal(diagnostic.relatedInformation[0].location.range.start.line, 1);
    writeFileSync(external, 'const secret = process.env.SECRET');
    assert.throws(() => compileClient(source, { root, filename }), error => error.code === "NIRAL044" && error.filename === external && error.start === 15);
    for (const code of ['const secret = process["env"]', 'const host = process\nconst secret = host.env']) {
      writeFileSync(external, code);
      assert.throws(() => compileClient(source, { root, filename }), { code: "NIRAL044" });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("NiralScript external SSR cache follows edits and deletion with isolated instances", async () => {
  const root = mkdtempSync(join(tmpdir(), "niral-nrs-ssr-"));
  const filename = join(root, "index.niral");
  const external = join(root, "counter.nrs");
  writeFileSync(filename, '<script lang="niralscript" src="./counter.nrs"></script><p>{count}</p>');
  writeFileSync(external, "state count = 1\ncount += 1");
  try {
    const first = await loadComponent(filename, [], root);
    assert.match(renderComponent(first.mod.default), /<p>2<\/p>/);
    assert.match(renderComponent(first.mod.default), /<p>2<\/p>/);
    writeFileSync(external, "state count = 3");
    const second = await loadComponent(filename, [], root);
    assert.notEqual(first, second);
    assert.match(renderComponent(second.mod.default), /<p>3<\/p>/);
    rmSync(external);
    await assert.rejects(loadComponent(filename, [], root), { code: "NIRAL077" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("NiralScript module files preserve privacy, dependency invalidation and diagnostics", async () => {
  const root = mkdtempSync(join(tmpdir(), "niral-nrs-modules-"));
  const filename = join(root, "index.niral");
  const base = join(root, "base.nrs");
  const library = join(root, "library.nrs");
  const entry = join(root, "entry.nrs");
  const script = 'import { read, value as initial } from "./library.nrs"\nstate count = initial\nderive result = read(count)';
  const inline = `<script lang="niralscript">${script}</script><p>{result}/{initial}</p>`;
  writeFileSync(base, "export const base = 2");
  writeFileSync(library, 'import { base } from "./base.nrs"\nexport const value = base\nexport function read(value) { return value * base }');
  writeFileSync(entry, script);
  writeFileSync(filename, inline);
  try {
    const sources = [];
    compileClient(inline, { root, filename, onSource: input => sources.push(input) });
    assert.deepEqual(sources.map(input => input.filename).sort(), [base, library]);
    for (const source of [inline, '<script lang="niralscript" src="./entry.nrs"></script><p>{result}/{initial}</p>']) {
      writeFileSync(filename, source);
      const first = await loadComponent(filename, [], root);
      assert.match(renderComponent(first.mod.default), /<p>4\/2<\/p>/);
      assert.match(renderComponent(first.mod.default), /<p>4\/2<\/p>/);
      writeFileSync(base, "export const base = 3");
      const next = await loadComponent(filename, [], root);
      assert.notEqual(first, next);
      assert.match(renderComponent(next.mod.default), /<p>9\/3<\/p>/);
      writeFileSync(base, "export const base = missing");
      assert.throws(() => compileClient(source, { root, filename }), error => error.code === "NIRAL073" && error.filename === base && error.start === 20);
      const diagnostic = validate(source, filename, { root })[0];
      assert.equal(diagnostic.relatedInformation[0].location.uri, pathToFileURL(base).href);
      writeFileSync(base, "export const base = 2");
    }
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "private.nrs"), "export const read = 1");
    writeFileSync(join(root, "secret.server.nrs"), "export const read = 1");
    symlinkSync(library, join(root, "linked.nrs"));
    for (const specifier of ["library.nrs", "./base.js", "../outside.nrs", "./data/private.nrs", "./secret.server.nrs", "./linked.nrs", "./base.nrs?raw", "https://host/base.nrs"]) {
      const source = inline.replace("./library.nrs", specifier);
      assert.throws(() => compileClient(source, { root, filename }), { code: "NIRAL077" }, specifier);
    }
    writeFileSync(base, "const secret = process.env.TOKEN\nexport const base = 2");
    assert.throws(() => compileClient(inline, { root, filename }), error => error.code === "NIRAL044" && error.filename === base && error.start === 15);
    writeFileSync(base, "export const base = 2");
    await loadComponent(filename, [], root);
    rmSync(base);
    await assert.rejects(loadComponent(filename, [], root), { code: "NIRAL077" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("NiralScript core runs independently of the framework directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "niralscript-core-"));
  try {
    cpSync(new URL("../niralscript/", import.meta.url), join(root, "niralscript"), { recursive: true });
    const isolated = await import(pathToFileURL(join(root, "niralscript/parser.js")).href);
    const linker = await import(pathToFileURL(join(root, "niralscript/modules.js")).href);
    const entry = isolated.parseNiralScript('import { twice } from "./math.nrs"\nderive total = twice(2)', "entry.nrs");
    const graph = linker.linkNiralScript(entry, filename => ({ filename, source: "export function twice(value) { return value * 2 }" }));
    assert.equal(isolated.analyzeNiralScript(graph).imports.size, 1);
    const source = 'state text = `Count: ${[1, 2].length}`\nderive label = text';
    assert.deepEqual(isolated.parseNiralScript(source, "counter.nrs"), parseNiralScript(source, "counter.nrs"));
    const functions = "state count = 0\nfunction increment(step) { count += step; return count }\nincrement(2)";
    assert.equal(isolated.analyzeNiralScript(isolated.parseNiralScript(functions)).bindings.length, 3);
    assert.throws(() => isolated.analyzeNiralScript(isolated.parseNiralScript("state count = missing")), { code: "NRS073" });
    for (const [script, code] of [
      ["state count = 0\nderive count = 1", "070"],
      ['state text = "unfinished', "012"],
      ["state text = `unfinished", "013"],
      ["state count = 1 /* unfinished", "014"],
      ["state count = 1 + * 2", "071"],
    ]) {
      let diagnostic;
      assert.throws(() => parseNiralScript(script, "counter.nrs"), error => {
        assert.ok(error instanceof NiralScriptError);
        assert.equal(error.code, `NRS${code}`);
        diagnostic = error;
        return true;
      });
      assert.throws(() => isolated.parseNiralScript(script, "counter.nrs"), error => {
        assert.ok(error instanceof isolated.NiralScriptError);
        for (const key of ["code", "message", "filename", "source", "start", "end", "line", "col"]) {
          assert.equal(error[key], diagnostic[key]);
        }
        return true;
      });
      assert.throws(() => lowerNiralScript(script, "counter.nrs"), error => {
        assert.equal(error.name, "NiralError");
        assert.equal(error.code, `NIRAL${code}`);
        for (const key of ["message", "filename", "source", "start", "end", "line", "col"]) {
          assert.equal(error[key], diagnostic[key]);
        }
        return true;
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NiralScript parses target-neutral declarations with original source spans", () => {
  const source = '// leading\r\nstate label = "ready";\r\n/* between */\r\nderive text = (\r\n label + "!"\r\n) // trailing\r\n';
  const program = parseNiralScript(source, "counter.nrs");
  assert.equal(program.type, "Program");
  assert.equal(program.filename, "counter.nrs");
  assert.equal(program.source, source);
  assert.equal(program.start, 0);
  assert.equal(program.end, source.length);
  assert.deepEqual(program.body.map(declaration => declaration.type), ["StateDeclaration", "DerivedDeclaration"]);
  const [state, derived] = program.body;
  assert.deepEqual(state, {
    type: "StateDeclaration",
    id: { type: "Identifier", name: "label", start: source.indexOf("label"), end: source.indexOf("label") + 5 },
    init: { type: "Literal", value: "ready", raw: ' "ready"', start: source.indexOf("=") + 1, end: source.indexOf(";") },
    start: source.indexOf("state"),
    end: source.indexOf(";") + 1,
  });
  assert.equal(source.slice(derived.start, derived.end), 'derive text = (\r\n label + "!"\r\n) // trailing\r');
  for (const declaration of program.body) {
    assert.equal(source.slice(declaration.id.start, declaration.id.end), declaration.id.name);
    assert.equal(source.slice(declaration.init.start, declaration.init.end), declaration.init.raw);
  }
});

test("NiralScript emitter preserves exact lowering and does not mutate the AST", () => {
  const source = '// leading\nstate count = 0;\n/* between */ derive doubled = count * 2 // trailing\n';
  const program = parseNiralScript(source);
  const original = structuredClone(program);
  const expected = '// leading\nlet count = $state( 0\n);\n/* between */ let doubled = $derived( count * 2 // trailing\n);\n';
  assert.equal(emitNiralScript(program), expected);
  assert.equal(lowerNiralScript(source), expected);
  assert.deepEqual(program, original);
  for (const trivia of ["", " \r\n\t", "// comment", "/* comment */\n"]) {
    assert.deepEqual(parseNiralScript(trivia).body, []);
    assert.equal(emitNiralScript(parseNiralScript(trivia)), trivia);
  }
  assert.throws(() => emitNiralScript({ source: "", body: [{ type: "UnknownDeclaration" }] }), TypeError);
});

test("NiralScript lowers state and derive into existing reactive declarations", () => {
  const script = "state count = 0\nderive doubled = count * 2";
  const template = '<button on:click={() => count += 1}>{count}</button><output>{doubled}</output>';
  const actual = compileClient(`<script lang="niralscript">${script}</script>${template}`);
  const expected = compileClient(`<script>${lowerNiralScript(script)}</script>${template}`);
  assert.equal(actual.code, expected.code);
  assert.match(actual.code, /__n\.signal\(/);
  assert.match(actual.code, /__n\.derived\(/);
  assert.match(actual.code, /count\.set\(/);
});

test("NiralScript direct backend uses resolved declarations and preserves legacy output", () => {
  for (const script of [
    "state count = 3\nderive doubled = count * 2\nconst snapshot = count // trailing",
    "state count = 1\nfunction change(step) { count += step; count -= 1; count *= 2; count /= 3; count %= 4; count = step }\nchange(5)",
    "state count = 1\nfunction echo(count) { count += 1; return { count } }\nconst record = { count }\nconst result = echo(count)",
    'state key = "value"\nstate record = { value: 1 }\nrecord[key] += 2\nconst result = `value: ${record[key]}`',
    "// leading\r\nstate count = 1\r\nfunction next() { return count }\nfunction read() { return /*\n newline */ next() }\nread()",
  ]) {
    const direct = compileNiralScript(script);
    const lowered = lowerNiralScript(script);
    const legacy = collectDeclarations(lowered);
    assert.equal(direct.code, rewriteScript(lowered, legacy.signals), script);
    for (const key of ["signals", "writable", "props"]) assert.deepEqual(direct[key], legacy[key]);
  }
  const source = 'const fake = 7\nstate count = 1\nderive doubled = count * 2\nconst text = "let fake = $state(0); ++count"';
  const direct = compileNiralScript(source);
  assert.deepEqual([...direct.signals], ["count", "doubled"]);
  assert.deepEqual([...direct.writable], ["count"]);
  assert.match(direct.code, /"let fake = \$state\(0\); \+\+count"/);
  const { code, ast } = compileClient(`<script lang="niralscript">${source}</script><p>{fake}</p>`);
  assert.ok(!code.includes("fake.get()"));
  assert.equal(ast.script.code, source);
  for (const script of ["state count = missing", "derive count = count + 1", "const host = process", "derive value = fetch('/')"]) {
    let expected;
    assert.throws(() => lowerNiralScript(script, "invalid.nrs"), error => { expected = error; return true; });
    assert.throws(() => compileNiralScript(script, "invalid.nrs"), error => {
      for (const key of ["code", "message", "filename", "source", "start", "end", "line", "col"]) assert.equal(error[key], expected[key]);
      return true;
    });
  }
});

test("NiralScript parses operator precedence rather than accepting raw expressions", () => {
  const { init } = parseNiralScript("derive result = 1 + 2 * 3 === 7 && !false").body[0];
  assert.equal(init.type, "LogicalExpression");
  assert.equal(init.operator, "&&");
  assert.equal(init.left.operator, "===");
  assert.equal(init.left.left.operator, "+");
  assert.equal(init.left.left.right.operator, "*");
  assert.equal(init.right.type, "UnaryExpression");
  for (const expression of ["1 +", "1 2", "count = 2", "count++", "new Thing()", "() => 1"]) {
    assert.throws(() => parseNiralScript(`state value = ${expression}`, "invalid.nrs"), { code: "NRS071" }, expression);
  }
});

test("NiralScript parses functions and structured statements", () => {
  const source = "state count = 0\nconst step = 2\nfunction increment(amount) {\n let next = count + amount\n if (next > 10) { return count } else { count = next }\n return count\n}\nincrement(step)";
  const program = parseNiralScript(source, "counter.nrs");
  assert.deepEqual(program.body.map(node => node.type), ["StateDeclaration", "VariableDeclaration", "FunctionDeclaration", "ExpressionStatement"]);
  const fn = program.body[2];
  assert.equal(fn.params[0].name, "amount");
  assert.equal(fn.body.body[1].type, "IfStatement");
  assert.equal(fn.body.body[1].alternate.body[0].type, "AssignmentStatement");
  assert.equal(fn.body.body[2].type, "ReturnStatement");
  assert.equal(source.slice(fn.start, fn.end), source.slice(source.indexOf("function"), source.lastIndexOf("}") + 1));
});

test("NiralScript expression trees cover collections, calls, members and conditionals", () => {
  const source = 'derive value = active ? format({ label, "count": values[0] }, [1, 2,]).text : null';
  const { init } = parseNiralScript(source, "expressions.nrs").body[0];
  assert.equal(init.type, "ConditionalExpression");
  assert.equal(init.test.name, "active");
  assert.equal(init.alternate.value, null);
  const member = init.consequent;
  assert.equal(member.type, "MemberExpression");
  assert.equal(member.computed, false);
  assert.equal(member.property.name, "text");
  const call = member.object;
  assert.equal(call.type, "CallExpression");
  assert.equal(call.callee.name, "format");
  assert.equal(call.arguments[0].type, "ObjectExpression");
  assert.equal(call.arguments[0].properties[0].shorthand, true);
  assert.equal(call.arguments[0].properties[1].value.computed, true);
  assert.deepEqual(call.arguments[1].elements.map(element => element.value), [1, 2]);
  assert.equal(source.slice(member.start, member.end), 'format({ label, "count": values[0] }, [1, 2,]).text');
  assert.equal(source.slice(call.callee.start, call.callee.end), "format");
  const subtraction = parseNiralScript("derive value = 9 - 3 - 1").body[0].init;
  assert.equal(subtraction.left.operator, "-");
  assert.equal(subtraction.right.value, 1);
  const conditional = parseNiralScript("derive value = first ? 1 : second ? 2 : 3").body[0].init;
  assert.equal(conditional.alternate.type, "ConditionalExpression");
});

test("NiralScript decodes literals and parses nested template interpolations", () => {
  for (const [expression, expected] of [
    ['"a\\n\\x42\\u0043\\u{1f600}"', "a\nBC\u{1f600}"],
    ["'can\\'t'", "can't"], ['"\\0"', "\0"],
    [".25e2", 25], ["1.", 1], ["true", true], ["null", null],
  ]) assert.equal(parseNiralScript(`state value = ${expression}`).body[0].init.value, expected);
  const source = 'derive text = `outer ${`inner ${values[0]}`} ${1 /* } ` ignored */ + 2}`';
  const { init } = parseNiralScript(source).body[0];
  assert.equal(init.type, "TemplateLiteral");
  assert.equal(init.quasis[0].value.cooked, "outer ");
  assert.equal(init.quasis.at(-1).tail, true);
  assert.equal(init.expressions[0].type, "TemplateLiteral");
  assert.equal(init.expressions[0].expressions[0].computed, true);
  assert.equal(init.expressions[1].operator, "+");
  assert.equal(source.slice(init.expressions[1].start, init.expressions[1].end), '1 /* } ` ignored */ + 2');
});

test("NiralScript rejects malformed literals and syntax outside the expression subset", () => {
  for (const expression of [
    "a == b", "a != b", "a ** b", "a ?? b", "a?.b", "a & b", "a, b", "a += 1",
    "++a", "[1,,2]", "[...items]", "{...record}", "{[key]: 1}", "{get x() {}}",
    "{true}", "{x:}", "{__proto__: null, '__proto__': null}", "fn(,)", "fn(1 2)",
    "record[]", "record.", "a ? b", "a ? : b", "(1, 2)", "1e+", "01", "0x10",
    '"\\xGG"', '"\\uXYZW"', '"\\u{110000}"', '"\\1"', '"\\08"', "`bad ${1 +}`",
    "function() {}", "/pattern/", "await task()", "typeof value",
  ]) assert.throws(() => parseNiralScript(`state value = ${expression}`, "bad.nrs"), { code: "NRS071" }, expression);
  const source = "// header\r\nstate count = 1\r\nderive value = (\r\n  count + * 2\r\n)";
  assert.throws(() => parseNiralScript(source, "bad.nrs"), error => {
    assert.equal(error.code, "NRS071");
    assert.equal(error.filename, "bad.nrs");
    assert.equal(error.source, source);
    assert.equal(error.line, 4);
    assert.equal(error.col, 11);
    assert.equal(source.slice(error.start, error.end), "*");
    return true;
  });
  const component = `<h1>Example</h1>\n<script lang="niralscript">\nstate value = 1 + * 2\n</script>`;
  assert.throws(() => compileClient(component, { filename: "bad.niral" }), error => {
    assert.equal(error.code, "NIRAL071");
    assert.equal(error.filename, "bad.niral");
    assert.equal(error.source, component);
    assert.equal(error.line, 3);
    assert.equal(component.slice(error.start, error.end), "*");
    return true;
  });
});

test("NiralScript handles comments, quoted delimiters and multiline initializers", () => {
  const script = '// state fake = 9\nstate label = "a; }";\n/* derive fake = 0 */\nstate values = [\n  1, 2\n]\nderive total = (\n values[0] + values[1]\n) // keep this comment\n';
  const lowered = lowerNiralScript(script);
  assert.match(lowered, /\$state\( "a; }"/);
  assert.match(lowered, /\$derived\(/);
  const { code } = compileClient(`<script lang="niralscript">${script}</script><p>{total}</p>`);
  assert.match(code, /values\.get\(\)\[0\]/);
});

test("NiralScript rejects malformed and unsupported declarations", () => {
  for (const script of [
    "state = 0", "state count", "state count =", "state count = // empty",
    "state count = (1]", "state count = (1", "state count = 0; derive count = 1",
    "state class = 0", "state __n = 0", "function __n() {}", "/* unfinished",
    "state count = /* empty */", "state count == 0", "state count => 0",
  ]) {
    assert.throws(() => lowerNiralScript(script, "counter.niral"), { code: "NIRAL070" }, script);
  }
});

test("NiralScript preserves client secret guards and server exclusion", () => {
  assert.throws(() => compileClient('<script lang="niralscript">state secret = process.env.SECRET</script>'), { code: "NIRAL044" });
  const { code } = compileClient('<server>export function ping() { return "server-only-marker" }</server><script lang="niralscript">state count = 0</script><p>{count}</p>');
  assert.ok(!code.includes("server-only-marker"));
  assert.match(code, /__n\.rpc/);
  assert.doesNotThrow(() => compileClient('<server>export function ping() { return "server-only-marker" }</server><script lang="niralscript">function request() { return ping() }</script>'));
  assert.throws(() => compileClient('<server>export function load() { return {} }</server><script lang="niralscript">function request() { return load() }</script>'), { code: "NIRAL073" });
  assert.throws(() => compileClient('<server>export function ping() { return 1 }</server><script lang="niralscript">function ping() { return 2 }</script>'), { code: "NIRAL073" });
});

test("NiralScript diagnostics refer to original component lines", () => {
  const source = '<h1>Counter</h1>\n\n<script lang="niralscript">\nstate count = 0\nderive count = 1\n</script>';
  assert.throws(() => compileClient(source, { filename: "counter.niral" }), error => {
    assert.equal(error.code, "NIRAL070");
    assert.equal(error.filename, "counter.niral");
    assert.equal(error.source, source);
    assert.equal(error.line, 5);
    return true;
  });
});

test("NiralScript executes generated modules with identical DOM and string SSR", async () => {
  const { renderComponent } = await import("../src/server/render.js");
  const runtime = new URL("../src/runtime/index.js", import.meta.url).href;
  for (const [script, expression, expected] of [
    ["state count = 3\nderive doubled = count * 2", "doubled", "6"],
    ['state label = "a; }"', "label", "a; }"],
    ["state values = [\n 1, 2\n]\nderive total = (\n values[0] + values[1]\n) // trailing", "total", "3"],
    ["state record = { text: 'nested; }', count: 8 / 2 }", "record.count", "4"],
    ['state count = 2\nderive label = `Count: ${count}`', "label", "Count: 2"],
    ["state count = 2\nderive result = count > 1 && count < 4 ? (count + 3) * -2 : 0", "result", "-10"],
    ["state values = [1, 2]\nderive result = values.slice(0, 1)[0]", "result", "1"],
    ["state count = 2\nfunction unused() { return 99 }\nderive result = false && unused() || count", "result", "2"],
    ["state count = 0\nconst step = 2\nfunction increment(amount) { let next = count + amount; if (next > 10) { return count } else { count = next } return count }\nincrement(step)", "count", "2"],
    ["state count = 3\nfunction echo(count) { const record = { count }; return record.count }\nstate result = echo(8)", "result + count", "11"],
    ["state count = 0\nfunction increment() { count += 1; return count }\nstate result = increment()", "result + count", "2"],
    ["state count = 5\nfunction build(count) { function next(step) { count += step; return { count } } return next }\nconst next = build(1)\nconst result = next(2)\nnext(4)", "result.count + count", "8"],
    ["state count = 7\nfunction label(count) { return `outer ${`inner ${count}`}` }\nconst result = label(2)", "result", "outer inner 2"],
    ["state count = 1\nfunction calculate(count) { let result = count; { const count = 9; result += count } return result }\nconst result = calculate(2)", "result + count", "12"],
    ["state count = 0\nfunction change() { count += 1 }\nfunction empty() { return\n change() }\nempty()", "count", "0"],
    ["function factorial(value) { if (value <= 1) { return 1 } else if (value === 2) { return 2 } else { return value * factorial(value - 1) } }\nconst result = factorial(5)", "result", "120"],
    ["const record = { value: 1 }; record.value += 2", "record.value", "3"],
    ["state count = 0\nfunction change() { count += 1 }\nfunction empty() { return /*\n boundary */ change() }\nempty()", "count", "0"],
    ["state count = 1 // comment\rfunction change() { count += 2 }\rchange()", "count", "3"],
    ["const value = 1 /*\n boundary */ const other = 2", "value + other", "3"],
    ['state count = 2\nderive result = `outer ${`inner ${count + 1}`}`', "result", "outer inner 3"],
    ["state count = 12\ncount += 4\ncount -= 1\ncount *= 2\ncount /= 3\ncount %= 4", "count", "2"],
    ["state count = 1\nfunction next() { count += 1; return count }\ncount += next()", "count", "3"],
    ["state count = 1\nfunction next() { count += 1; return count }\ncount = next() + 1", "count", "3"],
    ['state key = "count"\nstate record = { count: 1 }\nrecord[key] += 2', "record.count", "3"],
    ['const fake = 7\nstate count = 1\nconst text = "let fake = $state(0); ++count"', "fake + count", "8"],
    ["function read() { return 3 }\nfunction write(value) { return value + 1 }\nstate record = { get: read, set: write }\nconst result = record.get() + record.set(4)", "result", "8"],
  ]) {
    const { code } = compileClient(`<script lang="niralscript">${script}\n</script><p>{${expression}}</p>`, { runtime });
    const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    assert.equal(renderComponent(Component), `<p>${expected}</p>`);
    assert.equal(renderComponent((target, props) => Component(target, props)), `<p>${expected}</p>`);
  }
});

test("NiralScript rejects unsupported statements and malformed blocks", () => {
  for (const script of [
    "return 1", "if true {}", "if (true) call()", "if (true) {} else call()",
    "function run() {", "function run(...args) {}", "function run(arg = 1) {}",
    "function run() { state local = 1 }", "if (true) { derive local = 1 }",
    "let value = 1\nvalue++", "let value = 1\nvalue = other = 2",
    "1 + 2", "(1 + 2) = 3", "function run() { return 1 +\n 2 }",
    "while (true) {}", "for (;;) {}", "const value = 1, another = 2",
  ]) assert.throws(() => parseNiralScript(script), error => error instanceof NiralScriptError, script);
  const script = "function call() { return 1 }\ncall()\n(call)()";
  const lowered = lowerNiralScript(script);
  assert.match(lowered, /call\(\)\n;\n\(call\)\(\)/);
  assert.doesNotThrow(() => Function(lowered)());
});

test("NiralScript resolves lexical scopes and rejects invalid binding access", () => {
  for (const script of [
    "state value = absent", "function read() { return absent }",
    "if (true) { let inner = 1 }\nstate value = inner",
    "state value = later\nlet later = 2", "let value = value",
    "const value = 1\nvalue = 2", "derive value = 1\nfunction set() { value += 1 }",
    "derive value = { item: 1 }\nvalue.item = 2",
    "function read() { return 1 }\nread = 2",
  ]) assert.throws(() => analyzeNiralScript(parseNiralScript(script)), error => /^NRS07[34]$/.test(error.code), script);
  for (const script of [
    "function duplicate(arg, arg) {}", "function duplicate(arg) { let arg = 1 }",
    "let duplicate = 1\nconst duplicate = 2",
  ]) assert.throws(() => parseNiralScript(script), { code: "NRS070" }, script);
  const program = parseNiralScript("state count = 1\nfunction echo(count) { let local = count; { const count = 3; local = count } return { count, local } }\nstate result = echo(2)");
  const original = structuredClone(program);
  const analysis = analyzeNiralScript(program);
  assert.equal(analysis.bindings.filter(binding => binding.name === "count").length, 3);
  assert.ok(analysis.references.every(reference => reference.binding));
  assert.deepEqual(program, original);
  const ambient = parseNiralScript("state result = external(1)");
  assert.throws(() => analyzeNiralScript(ambient), { code: "NRS073" });
  assert.doesNotThrow(() => analyzeNiralScript(ambient, { globals: ["external"] }));
  const component = '<script lang="niralscript">\nfunction read() { return missing }\n</script>';
  assert.throws(() => compileClient(component), error => error.code === "NIRAL073" && error.line === 2 && component.slice(error.start, error.end) === "missing");
});
