import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, readdirSync } from "node:fs";
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
import { compileNiralScript as compileStandalone } from "../niralscript/compile.js";
import { SourceMap } from "node:module";
import { nrsHover, nrsDefinition, nrsCompletions } from "../src/lsp/niralscript.js";
import { startLsp } from "../src/lsp/server.js";
import { PassThrough } from "node:stream";

test("NiralScript runtime contracts execute across all emitters", async () => {
  const source = 'type Item = { quantity: number, tags?: string[] }\nfunction read(candidate: unknown): Item { return contract<Item>(candidate) }\nconst result = read({ quantity: 4 })';
  const output = compileStandalone(source, "contracts.nrs", { strictTypes: true });
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const variants = [
    module.createInstance().values,
    new Function(compileNiralScript(source, "contracts.nrs", { strictTypes: true }).code + ";return {read,result}")(),
    new Function(lowerNiralScript(source, "contracts.nrs", { strictTypes: true }) + ";return {read,result}")(),
  ];
  for (const variant of variants) {
    assert.deepEqual(variant.result, { quantity: 4 });
    assert.deepEqual(variant.read({ quantity: 2, tags: ["new"] }), { quantity: 2, tags: ["new"] });
    assert.throws(() => variant.read({ quantity: "4" }), { code: "NRS081", path: "$.quantity" });
    assert.throws(() => variant.read({ quantity: 4, tags: [2] }), { path: "$.tags[0]" });
    assert.throws(() => variant.read({ quantity: 4, extra: true }), { path: "$.extra" });
  }
  assert.throws(() => compileStandalone('function read(candidate: unknown) { return contract<Promise<number>>(candidate) }'), /Unsupported runtime contract/);
  assert.throws(() => compileStandalone('const result: string = contract<number>(4)'), /Expected string/);
});

test("NiralScript runtime contracts resolve imports and preserve explicit boundaries", async () => {
  const source = 'import { read } from "./reader.nrs"\nconst result = read({ value: 4 })';
  const options = { strictTypes: true, resolveModule(specifier) {
    return specifier === "./reader.nrs"
      ? { filename: "reader.nrs", source: 'import type { Box } from "./types.nrs"\nexport function read(candidate: unknown) { return contract<Box<number>>(candidate) }' }
      : { filename: "types.nrs", source: 'export type Box<T> = { value: T }' };
  } };
  const output = compileStandalone(source, "entry.nrs", options);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.deepEqual(module.createInstance().values.result, { value: 4 });
  for (const compile of [compileNiralScript, lowerNiralScript]) {
    const result = compile(source, "entry.nrs", options);
    assert.deepEqual(new Function((result.code ?? result) + ";return result")(), { value: 4 });
  }
  const nested = 'const read = (candidate) => { return contract<{ value: number }>({ value: contract<number>(candidate) }) }\nconst result = read(3)';
  for (const compile of [compileNiralScript, lowerNiralScript]) {
    const output = compile(nested);
    assert.deepEqual(new Function((output.code ?? output) + ";return result")(), { value: 3 });
  }
  const primitive = compileStandalone('const result = contract<number>(4)');
  const primitiveModule = await import("data:text/javascript;base64," + Buffer.from(primitive.code).toString("base64"));
  assert.equal(primitiveModule.createInstance().values.result, 4);
  for (const source of ['const result = contract<unknown>(4)', 'const result = contract<number>(4, 5)', 'const result = contract<number>()']) assert.throws(() => compileStandalone(source));
  assert.throws(() => compileStandalone('const result = contract<{ value: number }>({ value: 4 }); result.value = "bad"'), { code: "NRS080" });
  assert.throws(() => compileStandalone('const result = contract<number[]>([4]); result.push("bad")'), { code: "NRS080" });
  const ordinary = compileStandalone('input quantity: number\nderive total = quantity + 1', "ordinary.nrs", { strictTypes: true });
  const ordinaryModule = await import("data:text/javascript;base64," + Buffer.from(ordinary.code).toString("base64"));
  const instance = ordinaryModule.createInstance({ quantity: "4" });
  assert.equal(instance.values.total, "41");
  instance.updateInputs({ quantity: "9" });
  assert.equal(instance.values.total, "91");
});

test("NiralScript runtime contracts reject unsafe data without leaking payloads", async () => {
  const source = 'type Result = { kind: "ok", rows: { amount: number }[] } | { kind: "error", message: string }\nfunction read(candidate: unknown) { return contract<Result>(candidate) }';
  const output = compileStandalone(source, "contract-safety.nrs");
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const readers = [module.createInstance().values.read];
  for (const compile of [compileNiralScript, lowerNiralScript]) {
    const compiled = compile(source);
    readers.push(new Function((compiled.code ?? compiled) + ";return read")());
  }
  for (const read of readers) {
    const data = { kind: "ok", rows: [{ amount: 4 }] };
    const copy = read(data);
    copy.rows[0].amount = 9;
    assert.equal(data.rows[0].amount, 4);
    assert.deepEqual(read({ kind: "error", message: "no" }), { kind: "error", message: "no" });
    for (const amount of ["PRIVATE_PAYLOAD", NaN, Infinity, null, undefined, {}, true]) {
      assert.throws(() => read({ kind: "ok", rows: [{ amount }] }), error => {
        assert.equal(error.path, "$.rows[0].amount");
        assert.doesNotMatch(error.message, /PRIVATE_PAYLOAD/);
        return true;
      });
    }
    assert.throws(() => read({ kind: "ok", rows: new Array(10001) }), { code: "NRS081" });
    let invoked = false;
    const rows = [];
    Object.defineProperty(rows, "0", { get() { invoked = true; return { amount: 1 }; } });
    assert.throws(() => read({ kind: "ok", rows }), { path: "$.rows[0]" });
    assert.equal(invoked, false);
    assert.throws(() => read(Object.create({ kind: "error", message: "inherited" })), { code: "NRS081" });
    assert.throws(() => read({ kind: "error", message: "no", [Symbol("extra")]: true }), { code: "NRS081" });
    assert.throws(() => read(JSON.parse('{"kind":"error","message":"no","__proto__":{"polluted":true}}')), { code: "NRS081" });
  }
  for (const type of ["unknown", "void", "Promise<number>", "(value: number) => number"]) {
    assert.throws(() => compileStandalone(`const result = contract<${type}>(4)`, "invalid-contract.nrs"), error => error.code === "NRS080" && error.filename === "invalid-contract.nrs" && error.start > 0);
  }
  assert.throws(() => compileStandalone('function read<T>(value: unknown) { return contract<T>(value) }'), /Unsupported runtime contract/);
  assert.throws(() => compileStandalone('const result = contract<1e999>(null)'), /must be finite/);
  assert.throws(() => compileStandalone(`const result = contract<number${"[]".repeat(66)}>([])`), /64 levels/);
  const oversized = Array.from({ length: 1024 }, (_, index) => `field${index}: number`).join(",");
  assert.throws(() => compileStandalone(`const result = contract<{ ${oversized} }>({})`), /1024 type nodes/);
  assert.throws(() => compileStandalone('const globalThis = 2; const value = contract<number>(1)'), /unshadowed globalThis/);
  for (const compile of [compileNiralScript, lowerNiralScript]) {
    const output = compile('const Object = 0; const Number = 0; const result = contract<{ value: number }>({ value: 4 })');
    assert.deepEqual(new Function((output.code ?? output) + ";return result")(), { value: 4 });
  }
  assert.match(nrsHover("contract", 3, "entry.nrs"), /validates and copies/);
  assert.ok(nrsCompletions("", 0, "entry.nrs").some(item => item.label === "contract"));
});

test("NiralScript runtime contracts validate awaited host results once before mutation", async () => {
  const source = 'state saved = 0\nasync function save() { const data = contract<{ quantity: number }>(await fetchData()); saved = data.quantity; return saved }';
  const output = compileStandalone(source, "async-contract.nrs", { strictTypes: true, globals: ["fetchData"] });
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  let candidate = { quantity: 4 };
  let calls = 0;
  const fetchData = async () => { calls++; return candidate; };
  const instance = module.createInstance({}, { fetchData });
  assert.equal(await instance.values.save(), 4);
  assert.equal(calls, 1);
  candidate = { quantity: "4" };
  await assert.rejects(instance.values.save(), { code: "NRS081", path: "$.quantity" });
  assert.equal(calls, 2);
  assert.equal(instance.values.saved, 4);
  const checkedInput = compileStandalone('input candidate: unknown\nconst data = contract<{ quantity: number }>(candidate)', "checked-input.nrs", { strictTypes: true });
  const inputModule = await import("data:text/javascript;base64," + Buffer.from(checkedInput.code).toString("base64"));
  assert.equal(inputModule.createInstance({ candidate: { quantity: 4 } }).values.data.quantity, 4);
  assert.throws(() => inputModule.createInstance({ candidate: { quantity: "4" } }), { code: "NRS081" });
});

test("NiralScript parses class constructors, members and inheritance", () => {
  const program = parseNiralScript('class Base { value: number = 1; constructor(value: number = 2) { this.value = value } get doubled(): number { return this.value * 2 } set doubled(value: number) { this.value = value / 2 } static make() { return new Base(3) } } class Child extends Base { constructor(...values: number[]) { super(...values) } read() { return super.doubled } } const result = new Child(4).read()');
  assert.equal(program.body[0].type, "ClassDeclaration");
  assert.equal(program.body[0].members[1].kind, "constructor");
  assert.equal(program.body[1].superClass.name, "Base");
  assert.equal(program.body[2].init.callee.object.type, "NewExpression");
  for (const source of ['class Bad { constructor() {} constructor() {} }', 'class Bad { async constructor() {} }', 'class Bad { get value(arg) {} }']) assert.throws(() => parseNiralScript(source), NiralScriptError);
});

test("NiralScript class execution preserves native receivers and inheritance", async () => {
  const source = 'class Base { value = 1; constructor(value = 2) { this.value = value } get doubled() { return this.value * 2 } set doubled(value) { this.value = value / 2 } static make() { return new Base(3) } read() { return this.doubled } } class Child extends Base { extra = 1; constructor(value) { super(value) } read() { const read = () => super.read() + this.extra; return read() } } const instance = new Child(4); instance.doubled = 12; const result = instance.read() + Base.make().value';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 16);
  assert.equal(new Function(compileNiralScript(source).code + ';return result')(), 16);
  assert.equal(new Function(lowerNiralScript(source) + ';return result')(), 16);
  assert.throws(() => compileStandalone('const value = this'), /only valid in a class/);
  assert.throws(() => compileStandalone('class Bad { read() { function nested() { return this } return nested() } }'), /only valid in a class/);
});

test("NiralScript class contracts check constructors, fields, methods and generic instances", async () => {
  const source = 'class Box<T> { value: T; constructor(value: T) { this.value = value } read(): T { return this.value } } const box: Box<number> = new Box<number>(3); const result: number = box.read()';
  const output = compileStandalone(source, "classes.nrs", { strictTypes: true });
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 3);
  for (const source of [
    'class Box { value: number = "bad" }',
    'class Box { value: number = 1; constructor(value: number) { this.value = value } } const box = new Box("bad")',
    'class Box { value: number = 1 } const box = new Box(); box.value = "bad"',
    'class Box { read(): number { return "bad" } }',
    'class Box { read(value: number): number { return value } } const box = new Box(); box.read("bad")',
    'class Box {} const box = Box()',
    'class Box<T> { value: T; constructor(value: T) { this.value = value } } const box: Box<string> = new Box<number>(1)',
  ]) assert.throws(() => compileStandalone(source), /Expected|must be invoked with new/);
});

test("NiralScript classes preserve readonly, purity and initialization guards", async () => {
  const rejected = [
    ['input data; class Box { value; constructor(value) { this.value = value } mutate() { this.value.count = 2 } } const box = new Box(data); box.mutate()', /read-only/],
    ['input data; class Box { value = data; mutate() { this.value.count = 2 } } const box = new Box(); box.mutate()', /read-only/],
    ['state count = 0; class Box { constructor() { count++ } } derive box = new Box()', /cannot mutate/],
    ['state count = 0; class Box { get value() { count++; return count } } const box = new Box(); derive result = box.value', /cannot mutate/],
    ['state count = 0; class Base { read() { return 1 } } class Child extends Base { read() { count++; return count } } function read(value) { return value.read() } const box = new Child(); derive result = read(box)', /cannot mutate/],
    ['class Box { value = later } const box = new Box(); const later = 2', /before initialization/],
    ['class Base {} class Child extends Base { constructor() { this.value = 1; super() } }', /before super/],
    ['class Base {} class Child extends Base { constructor() {} }', /call super/],
    ['class Base {} class Child extends Base { constructor() { super(); super() } }', /exactly once/],
    ['class Base {} class Child extends Base { constructor(flag) { if (flag) { super() } } }', /every path/],
    ['class Base {} class Child extends Base { read() { return super } }', /requires a member/],
    ['class Base {} class Child extends Base { constructor(flag) { if (flag) { super() } super() } }', /exactly once/],
    ['class Base {} class Child extends Base { constructor(flag) { const value = flag && super() } }', /every path/],
    ['class Base { read() {} } class Child extends Base { constructor() { super.read(); super() } }', /before super/],
    ['class Box { static { return } }', /cannot return/],
    ['class Box {} const box = new Box?.()', /optional chaining/],
    ['state count = 0; class Box { set value(value) { count = value } run() { this.value = 2; return 1 } } const box = new Box(); derive result = box.run()', /cannot mutate/],
  ];
  for (const [source, message] of rejected) assert.throws(() => compileStandalone(source), message, source);
  const source = 'state count = 2; class Box { value: number; constructor(value: number) { this.value = value } read(): number { return this.value * 2 } } derive result = new Box(count).read()';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const instance = module.createInstance();
  assert.equal(instance.values.result, 4);
  instance.values.count = 3;
  assert.equal(instance.values.result, 6);
  compileStandalone('class Base {} class Child extends Base { constructor(flag) { if (flag) { super(); return } super() } }');
  compileStandalone('class Base<T> { constructor(value: T) {} } class Child<U> extends Base<U> { constructor(value: U) { super(value) } } const child = new Child<number>(2)');
  assert.throws(() => compileStandalone('class Base<T> { constructor(value: T) {} } class Child extends Base<number> { constructor() { super("bad") } }'), { code: 'NRS080' });
  const accessors = 'class Box { static {} #stored = 1; get #value(): number { return this.#stored } set #value(value: number) { this.#stored = value } read() { this.#value = 3; return this.#value } } const result = new Box().read()';
  const accessorModule = await import('data:text/javascript;base64,' + Buffer.from(compileStandalone(accessors).code).toString('base64'));
  assert.equal(accessorModule.createInstance().values.result, 3);
});

test("NiralScript private members, static initialization and inherited generics execute", async () => {
  const source = 'class Base<T> { value: T; constructor(value: T) { this.value = value } read(): T { return this.value } } class Box extends Base<number> { #offset: number = 2; static total: number = 0; static { this.total = 3 } ["result"](): number { return this.read() + this.#offset } } const box = new Box(4); const result: number = box.result() + Box.total';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 9);
  assert.equal(new Function(compileNiralScript(source).code + ';return result')(), 9);
  assert.equal(new Function(lowerNiralScript(source) + ';return result')(), 9);
  assert.throws(() => compileStandalone('class Box { #value = 1 } const box = new Box(); const result = box.#value'), /Private member/);
  assert.throws(() => compileStandalone('class Box { static { this.value = later } } const later = 2'), /before initialization/);
  assert.throws(() => compileStandalone(source.replace('new Box(4)', 'new Box("bad")')), { code: 'NRS080' });
  assert.throws(() => compileStandalone('class Box<T> { value: T; constructor(value: T) { this.value = value } } const boxes: Box<number>[] = [new Box<string>("bad")]'), { code: 'NRS080' });
  compileStandalone('class Base<T> { value: T; constructor(value: T) { this.value = value } } class Child extends Base<number> {} const boxes: Base<number>[] = [new Child(2)]', 'inherit.nrs', { strictTypes: true });
});

test("NiralScript editor navigates imported classes and members", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'niral-editor-classes-')));
  try {
    const filename = join(directory, 'entry.nrs');
    const library = join(directory, 'box.nrs');
    writeFileSync(library, 'export class Box<T> { value: T; constructor(value: T) { this.value = value } read(): T { return this.value } }');
    const source = 'import { Box } from "./box.nrs"\nconst box = new Box<number>(2)\nconst result = box.read()';
    const options = { root: directory, strictTypes: true };
    assert.deepEqual(validate(source, filename, options), []);
    assert.match(nrsHover(source, source.lastIndexOf('Box') + 1, filename, options), /class Box<T>/);
    assert.match(nrsHover(source, source.lastIndexOf('read') + 1, filename, options), /read\(\): T/);
    assert.equal(nrsDefinition(source, source.lastIndexOf('read') + 1, filename, options).uri, pathToFileURL(library).href);
    assert.deepEqual(nrsCompletions(source, source.lastIndexOf('read') + 2, filename, options).map(item => item.label).sort(), ['read', 'value']);
    const incomplete = source.slice(0, source.lastIndexOf('read'));
    assert.ok(nrsCompletions(incomplete, incomplete.length, filename, options).some(item => item.label === 'read'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("NiralScript classes preserve reactive writes and type-only module contracts", async () => {
  const runtime = await import('../src/runtime/index.js');
  const construction = 'let count = 0; class Base { constructor() { count += 1 } } class Child extends Base {} new Child(); const result: boolean = new Child() instanceof Base && count === 2';
  assert.throws(() => compileStandalone('const invalid = 1 "+" 2'), { code: 'NRS071' });
  const constructed = await import('data:text/javascript;base64,' + Buffer.from(compileStandalone(construction).code).toString('base64'));
  assert.equal(constructed.createInstance().values.result, true);
  for (const code of [compileNiralScript(construction).code, lowerNiralScript(construction)]) assert.equal(new Function(code + '\nreturn result')(), true);
  const source = 'input initial: number\nstate count: number = initial\nclass Counter { increment(delta: number = 1): number { count += delta; return this.read() } read(): number { return count * 2 } }\nconst counter = new Counter()\nderive doubled = counter.read()';
  const compiled = compileStandalone(source);
  const { createInstance } = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'));
  const first = createInstance({ initial: 2 });
  const second = createInstance({ initial: 9 });
  assert.equal(first.values.doubled, 4);
  assert.equal(first.values.counter.increment(), 6);
  assert.equal(first.values.doubled, 6);
  assert.equal(second.values.doubled, 18);
  const direct = compileNiralScript(source);
  for (const code of [direct.code, rewriteScript(lowerNiralScript(source), new Set([...direct.signals, ...direct.props]))]) {
    const instance = new Function('__n', '__props', code + '\nreturn { counter, doubled };')(runtime, { initial: 2 });
    assert.equal(instance.doubled.get(), 4);
    assert.equal(instance.counter.increment(3), 10);
    assert.equal(instance.doubled.get(), 10);
  }
  const library = 'export class Box<T> { value: T; constructor(value: T) { this.value = value } read(): T { return this.value } }\nexport function create(value: number): Box<number> { return new Box<number>(value) }';
  const options = { strictTypes: true, resolveModule: () => ({ filename: 'box.nrs', source: library }) };
  const entry = 'import { create } from "./box.nrs"\nimport type { Box } from "./box.nrs"\nconst box: Box<number> = create(2)\nconst result = box.read()';
  const linked = compileStandalone(entry, 'entry.nrs', options);
  const module = await import('data:text/javascript;base64,' + Buffer.from(linked.code).toString('base64'));
  assert.equal(module.createInstance().values.result, 2);
  assert.equal(Object.hasOwn(module.createInstance().values, 'Box'), false);
  assert.throws(() => compileStandalone(entry + '\nconst invalid = new Box<number>(2)', 'entry.nrs', options), { code: 'NRS073' });
});

test("NiralScript expansion serves inline and external scripts in dev and production", async () => {
  const { createDevServer } = await import("../src/dev/server.js");
  const { createProdServer } = await import("../src/server/prod.js");
  const { build } = await import("../src/build/build.js");
  const root = mkdtempSync(join(tmpdir(), "niral-expanded-http-"));
  const previousRoot = globalThis.__niralProjectRoot;
  let app;
  try {
    mkdirSync(join(root, "routes"));
    mkdirSync(join(root, "lib"));
    const guard = compileStandalone('state calls = 0\nfunction accept(candidate: unknown) { const row = contract<{ quantity: number }>(candidate); calls++; return { quantity: row.quantity, calls } }', "guard.nrs", { strictTypes: true });
    writeFileSync(join(root, "lib", "contracts.server.js"), guard.code + '\nexport const guard = createInstance().values;');
    writeFileSync(join(root, "types.nrs"), 'export type Box<T> = { value: T }');
    writeFileSync(join(root, "math.nrs"), 'export function apply<T, U>(value: T, callback: (value: T) => U): U { return callback(value) }');
    writeFileSync(join(root, "classes.nrs"), 'export class Counter { #offset: number; constructor(offset: number) { this.#offset = offset } read(value: number): number { return value + this.#offset } }');
    const script = 'import type { Box } from "../types.nrs"\nimport { apply } from "../math.nrs"\nimport { Counter } from "../classes.nrs"\ninput seed: number\nconst { nested: { value = 2 }, ...rest } = { nested: {}, extra: 1 }\nfunction sum(first: number = value, ...items: number[]): number { let total: number = first; for (let index = 0; index < items.length; index++) { if (index === 1) { continue } total += items[index] } while (total > 6) { total--; break } return total }\nconst box: Box<number> = { value: sum() }\nstate count: number = sum(seed, ...[2, 3, 4])\nconst twice = (amount: number): number => amount * 2\nderive doubled = apply<number, number>(count, twice)\nconst counter = new Counter(1)\nderive classResult = counter.read(count)';
    const server = '<server>const privateValue = "SERVER_ONLY_EXPANSION"; export function load() { return { seed: 1 } } export function ping() { return privateValue.length } export async function validateRow(candidate) { const { guard } = await projectImport("./lib/contracts.server.js"); return guard.accept(candidate) }</server>';
    const checkedScript = script + '\nconst checked = contract<Box<number>>(box)';
    const markup = '<output>{count}:{doubled}:{box.value}:{rest.extra}:{classResult}:{checked.value}</output>';
    writeFileSync(join(root, "routes", "program.nrs"), checkedScript);
    writeFileSync(join(root, "routes", "index.niral"), `${server}<script lang="niralscript">${checkedScript}</script>${markup}`);
    writeFileSync(join(root, "routes", "external.niral"), `${server}<script lang="niralscript" src="./program.nrs"></script>${markup}`);
    for (const production of [false, true]) {
      if (production) {
        const release = build({ root });
        assert.ok(readdirSync(release.release, { recursive: true }).every(file => !/\.nrs$/i.test(file)));
      }
      app = production ? createProdServer({ dist: join(root, "dist"), cwd: root, port: 0 }) : createDevServer({ root, port: 0, watch: false });
      const port = await new Promise(accept => app.listen(accept));
      const base = `http://localhost:${port}`;
      for (const route of ["/", "/external"]) {
        const response = await fetch(base + route);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, />6:12:2:1:7:2<\/output>/);
        assert.doesNotMatch(html, /SERVER_ONLY_EXPANSION/);
        const asset = html.match(/import __page from "([^"]+)"/);
        assert.ok(asset, html);
        const client = await fetch(base + asset[1]);
        assert.equal(client.status, 200);
        const code = await client.text();
        assert.doesNotMatch(code, /SERVER_ONLY_EXPANSION|import type|Box<number>|apply<number/);
        const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: code, encoding: "utf8" });
        assert.equal(syntax.status, 0, syntax.stderr);
        const rpc = await fetch(base + "/@niral/rpc", {
          method: "POST", headers: { "content-type": "application/json", "x-niral-rpc": "1" },
          body: JSON.stringify({ module: route === "/" ? "/routes/index.niral" : "/routes/external.niral", fn: "ping", args: [] }),
        });
        assert.equal(rpc.status, 200);
        assert.equal((await rpc.json()).result, "SERVER_ONLY_EXPANSION".length);
        const validateRow = candidate => fetch(base + "/@niral/rpc", {
          method: "POST", headers: { "content-type": "application/json", "x-niral-rpc": "1" },
          body: JSON.stringify({ module: route === "/" ? "/routes/index.niral" : "/routes/external.niral", fn: "validateRow", args: [candidate] }),
        });
        const accepted = await validateRow({ quantity: 2 });
        assert.equal(accepted.status, 200);
        const first = (await accepted.json()).result;
        assert.equal(first.quantity, 2);
        const rejected = await validateRow({ quantity: "PRIVATE_PAYLOAD" });
        assert.equal(rejected.status, 400);
        assert.deepEqual(await rejected.json(), { ok: false, error: "validation failed", errors: { "$.quantity": "Expected number" } });
        const next = await validateRow({ quantity: 3 });
        assert.equal((await next.json()).result.calls, first.calls + 1);
        const privateAsset = await fetch(base + "/lib/contracts.server.js");
        assert.equal(privateAsset.status, 404);
      }
      app.close();
      app = null;
    }
  } finally {
    app?.close();
    globalThis.__niralProjectRoot = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("NiralScript call spread executes through the standalone compiler", async () => {
  const source = 'function add(left, right) { return left + right }\nconst result = add(...[2, 3])';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 5);
});

test("NiralScript editor reports standalone compiler diagnostics", () => {
  assert.deepEqual(validate("state count: number = 0\nderive doubled = count * 2", "counter.nrs"), []);
  const diagnostics = validate('state count: number = "wrong"', "counter.nrs");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "NRS080");
  assert.equal(diagnostics[0].source, "niralscript");
  assert.equal(diagnostics[0].range.start.line, 0);
});

test("NiralScript binding defaults and rest execute and preserve guards", async () => {
  const source = 'const { nested: { value = 4 }, ...other } = { nested: {}, extra: 8 }\nconst [first = 2, ...tail] = [3, 5, 7]\nfunction sum(start = value, ...items) { let total = start; for (const item of items) { total += item } return total }\nconst arrow = ({ amount = 6 } = {}, ...items) => sum(amount, ...items)\nconst result = arrow({}, ...tail) + sum() + other.extra + first';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 33);
  assert.equal(new Function(compileNiralScript(source).code + "\nreturn result")(), 33);
  assert.equal(new Function(lowerNiralScript(source) + "\nreturn result")(), 33);
  for (const invalid of ['function bad(...items, last) {}', 'function bad(first = later, later = 1) {}', 'input source\nfunction change(value = source) { value.item = 1 }\nchange()', 'state count = 0\nfunction mutate(value = bump()) { return value }\nfunction bump() { count += 1; return count }\nderive result = mutate()']) assert.throws(() => compileNiralScript(invalid));
});

test("NiralScript typed defaults and rest retain argument contracts", async () => {
  const source = 'function sum(first: number = 2, ...items: number[]): number { let result: number = first; for (const item of items) { result += item } return result }\nconst result = sum(...[3, 4, 5]) + sum()';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 14);
  assert.equal(new Function(compileNiralScript(source).code + "\nreturn result")(), 14);
  for (const source of ['function bad(value: number = "bad") {}', 'function bad(...values: number) {}', 'function sum(...values: number[]) {}\nsum(...[1, "bad"])']) assert.throws(() => compileStandalone(source), { code: "NRS080" });
  assert.doesNotThrow(() => compileStandalone('const { first = 1, second = first } = {}\nfunction read({ first = 1, second = first } = {}) { return second }'));
  assert.throws(() => compileStandalone('const { first = second, second = 1 } = {}'), { code: "NRS074" });
});

test("NiralScript type aliases and literal contracts erase across modules", async () => {
  const source = 'import type { Status as State } from "./types.nrs"\ntype Row = { status: State, count: number }\nconst row: Row = { status: "ready", count: 3 }\nconst result = row.count';
  const options = { resolveModule: () => ({ filename: "types.nrs", source: 'export type Status = "ready" | "done"' }) };
  const output = compileStandalone(source, "entry.nrs", options);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 3);
  assert.equal(new Function(compileNiralScript(source, "entry.nrs", options).code + "\nreturn result")(), 3);
  for (const source of ['type Status = "ready" | "done"\nconst value: Status = "other"', 'type Value = Missing', 'type Value = Value', 'type Value = number\ntype Value = string']) assert.throws(() => compileStandalone(source), { code: "NRS080" });
  assert.throws(() => compileStandalone(source.replace('"ready"', '"invalid"'), "entry.nrs", options), { code: "NRS080" });
  assert.throws(() => compileStandalone('import type { Missing } from "./types.nrs"', 'entry.nrs', options), { code: 'NRS080' });
});

test("NiralScript editor resolves imported and generic type aliases", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'niral-editor-types-')));
  try {
    const filename = join(directory, 'entry.nrs');
    const library = join(directory, 'types.nrs');
    writeFileSync(library, 'export type Box<T> = { value: T }');
    const source = 'import type { Box as Container } from "./types.nrs"\ntype Count = number\nconst box: Container<Count> = { value: 1 }\nfor (let index = 0; index < box.value; index++) {}';
    const options = { root: directory };
    assert.deepEqual(validate(source, filename, options), []);
    assert.match(nrsHover(source, source.lastIndexOf('Container'), filename, options), /type Box<T>/);
    assert.equal(nrsDefinition(source, source.lastIndexOf('Container'), filename, options).uri, pathToFileURL(library).href);
    assert.equal(nrsDefinition(source, source.lastIndexOf('Count'), filename, options).range.start.line, 1);
    const labels = nrsCompletions(source, source.length, filename, options).map(item => item.label);
    for (const name of ['Container', 'Count', 'type', 'while', 'break', 'continue']) assert.ok(labels.includes(name), name);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("NiralScript narrows branches and offers strict null and unknown checks", async () => {
  const source = 'type Result = { kind: "ok", value: number } | { kind: "error", message: string }\nfunction read(value: unknown): number { if (typeof value === "number") { return value } return 0 }\nfunction size(value: string | null): number { if (value === null) { return 0 } return value.length }\nfunction unwrap(result: Result): number { if (result.kind === "ok") { return result.value } return result.message.length }\nconst result = read(3) + size("yes") + unwrap({ kind: "ok", value: 4 })';
  const output = compileStandalone(source, "narrow.nrs", { strictTypes: true });
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 10);
  for (const source of ['function bad(value: unknown): number { return value }', 'function bad(value: string | null): number { return value.length }', 'function bad(value: string | null): number { if (value !== null) { value = null; return value.length } return 0 }']) assert.throws(() => compileStandalone(source, "strict.nrs", { strictTypes: true }), { code: "NRS080" });
  assert.doesNotThrow(() => compileStandalone('function gradual(value: unknown): number { return value }'));
});

test("NiralScript editor resolves typed symbols, shadowing and unsaved imports", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "niral-editor-")));
  try {
    const filename = join(directory, "entry.nrs");
    const library = join(directory, "math.nrs");
    writeFileSync(library, "export function twice(value: number): number { return value * 2 }");
    const source = 'import { twice as double } from "./math.nrs"\nstate count: number = 2\nfunction use(count: string): string { return count }\nconst result = double(count)';
    const options = { root: directory };
    assert.deepEqual(validate(source, filename, options), []);
    assert.match(nrsHover(source, source.lastIndexOf("count"), filename, options), /state count: number/);
    assert.match(nrsHover(source, source.indexOf("return count") + 7, filename, options), /parameter count: string/);
    assert.match(nrsHover(source, source.lastIndexOf("double"), filename, options), /twice\(value: number\): number/);
    assert.equal(nrsDefinition(source, source.lastIndexOf("double"), filename, options).uri, pathToFileURL(library).href);
    assert.equal(nrsDefinition(source, source.indexOf("twice"), filename, options).range.start.character, 16);
    assert.equal(nrsDefinition(source, source.lastIndexOf("count"), filename, options).range.start.line, 1);
    assert.ok(nrsCompletions(source, source.length, filename, options).some(item => item.label === "double"));
    assert.ok(nrsCompletions("state ", 6, filename, options).some(item => item.label === "derive"));
    const documents = new Map([[library, 'export function twice(value: number): number { return "bad" }']]);
    const diagnostics = validate(source, filename, { ...options, documents });
    assert.equal(diagnostics[0].code, "NRS080");
    assert.equal(diagnostics[0].relatedInformation[0].location.uri, pathToFileURL(library).href);
    assert.equal(diagnostics[0].range.start.line, 0);
    assert.equal(validate('import { nope } from "../outside.nrs"', filename, options)[0].code, "NRS077");
    assert.equal(validate('const value = host()', filename, options)[0].code, "NRS073");
    assert.deepEqual(validate('const value = host()', filename, { ...options, globals: ["host"] }), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("NiralScript editor protocol refreshes dependents and clears closed diagnostics", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "niral-editor-lsp-")));
  const input = new PassThrough();
  const messages = [];
  let onMessage = () => {};
  const server = startLsp({ input, output: { write(chunk) {
    if (Buffer.isBuffer(chunk)) { const message = JSON.parse(chunk.toString()); messages.push(message); onMessage(message); }
  } } });
  const send = (method, params, id) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    input.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  };
  try {
    const filename = join(directory, "entry.nrs");
    const library = join(directory, "library.nrs");
    const uri = pathToFileURL(filename).href;
    const libraryUri = pathToFileURL(library).href;
    const libraryText = "export const amount: number = 2";
    writeFileSync(library, libraryText);
    send("initialize", { workspaceFolders: [{ uri: pathToFileURL(directory).href }] }, 1);
    assert.equal(messages.find(message => message.id === 1).result.capabilities.definitionProvider, true);
    send("textDocument/didOpen", { textDocument: { uri, languageId: "niralscript", text: 'import { amount } from "./library.nrs"\nconst result = amount' } });
    send("textDocument/definition", { textDocument: { uri }, position: { line: 1, character: 16 } }, 2);
    assert.equal(messages.find(message => message.id === 2).result.uri, libraryUri);
    send("textDocument/hover", { textDocument: { uri }, position: { line: 1, character: 16 } }, 3);
    assert.match(messages.find(message => message.id === 3).result.contents.value, /amount: number/);
    send("textDocument/completion", { textDocument: { uri }, position: { line: 1, character: 16 } }, 4);
    assert.ok(messages.find(message => message.id === 4).result.some(item => item.label === "state"));
    send("textDocument/didOpen", { textDocument: { uri: libraryUri, languageId: "niralscript", text: libraryText } });
    const updated = new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("Dependent diagnostics were not refreshed")), 3000);
      onMessage = message => {
        if (message.method === "textDocument/publishDiagnostics" && message.params.uri === uri && message.params.diagnostics[0]?.code === "NRS080") {
          clearTimeout(timer); accept();
        }
      };
    });
    send("textDocument/didChange", { textDocument: { uri: libraryUri }, contentChanges: [{ text: 'export const amount: number = "wrong"' }] });
    await updated;
    send("textDocument/didChange", { textDocument: { uri: libraryUri }, contentChanges: [{ text: libraryText }] });
    assert.deepEqual(messages.at(-1).params.diagnostics, []);
    send("textDocument/didClose", { textDocument: { uri: libraryUri } });
    assert.deepEqual(messages.at(-1).params.diagnostics, []);
    send("textDocument/didOpen", { textDocument: { uri: "untitled:example.nrs", languageId: "niralscript", text: 'state value: number = "wrong"' } });
    assert.equal(messages.at(-1).params.diagnostics[0].code, "NRS080");
    const manifest = JSON.parse(readFileSync(new URL("../editors/vscode/package.json", import.meta.url), "utf8"));
    assert.ok(manifest.contributes.languages.some(language => language.id === "niralscript" && language.extensions.includes(".nrs")));
    const grammar = JSON.parse(readFileSync(new URL("../editors/vscode/syntaxes/niralscript.tmLanguage.json", import.meta.url), "utf8"));
    assert.equal(grammar.scopeName, "source.niralscript");
  } finally {
    server.dispose(); input.destroy(); rmSync(directory, { recursive: true, force: true });
  }
});

test("NiralScript standalone covers collections, errors and short-circuit evaluation", async () => {
  const source = 'const empty = null\nstate count = 0\nstate items = [1, 2]\nfunction bump() { count += 1; return count }\nconst skipped = empty?.[bump()]?.(bump()) ?? "fallback"\nconst grouped = true ? (1) : 2\nconst numeric = 1 .toString()\nconst record = { count, ...{ label: `count ${count}` } }\nfunction collect() { let total = 0; for (const value of [...items, 3]) { total += value } return total }\nasync function run(fail) { try { if (fail) { throw { message: "failed" } } items = items.map(value => { return value * 2 }); return await collect() } catch ({ message }) { return message } finally { count += 1 } }';
  const result = compileStandalone(source);
  const { createInstance } = await import("data:text/javascript;base64," + Buffer.from(result.code).toString("base64"));
  const instance = createInstance({ empty: null });
  assert.equal(instance.values.count, 0);
  assert.equal(instance.values.skipped, "fallback");
  assert.equal(instance.values.grouped, 1);
  assert.equal(instance.values.numeric, "1");
  assert.deepEqual(instance.values.record, { count: 0, label: "count 0" });
  assert.equal(await instance.values.run(false), 9);
  assert.equal(await instance.values.run(true), "failed");
  assert.equal(instance.values.count, 2);
  assert.deepEqual(instance.values.items, [2, 4]);
  const parenthesized = compileStandalone('input empty\nconst value = (empty?.child).value');
  const grouped = await import("data:text/javascript;base64," + Buffer.from(parenthesized.code).toString("base64"));
  assert.throws(() => grouped.createInstance({ empty: null }), TypeError);
  const special = compileStandalone('const constructor = 7\nconst record = { constructor }\nconst value = host?.method?.()', "entry.nrs", { globals: ["host"] });
  const loaded = await import("data:text/javascript;base64," + Buffer.from(special.code).toString("base64"));
  const host = { value: 5, method() { return this.value; } };
  const values = loaded.createInstance({}, { host }).values;
  assert.equal(values.constructor, 7);
  assert.equal(Object.getPrototypeOf(values), null);
  assert.ok(Object.hasOwn(values.record, "constructor"));
  assert.equal(values.record.constructor, 7);
  assert.equal(values.value, 5);
});

test("NiralScript generics preserve execution and reject invalid instantiation", async () => {
  const source = 'type Box<T> = { value: T }\nfunction identity<T>(value: T): T { return value }\nconst box: Box<number> = { value: 4 }\nconst result: number = identity<number>(box.value) + identity(2)';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.equal(module.createInstance().values.result, 6);
  assert.equal(new Function(compileNiralScript(source).code + "\nreturn result")(), 6);
  assert.doesNotThrow(() => parseNiralScript('type Callback = (value: number) => string'));
  for (const source of ['function identity<T>(value: T): T { return value }\nconst bad = identity<number>("wrong")', 'function bad<T>(value: T): T { return 1 }', 'type Box<T> = { value: T }\nconst box: Box<number> = { value: "bad" }']) assert.throws(() => compileStandalone(source), { code: "NRS080" });
});

test("NiralScript infers typed callbacks and generic callback results", async () => {
  const source = 'function apply<T, U>(value: T, transform: (item: T) => U): U { return transform(value) }\nconst result: number = apply("hello", item => item.length)\nconst lengths: number[] = ["a", "long"].map(item => item.length)\nconst double: (value: number) => number = value => value * 2\nconst doubled: number = double(result)';
  const output = compileStandalone(source, "callbacks.nrs", { strictTypes: true });
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const values = module.createInstance().values;
  assert.equal(values.doubled, 10);
  assert.deepEqual(values.lengths, [1, 4]);
  for (const source of ['const fn: (value: number) => number = value => "bad"', 'function apply(fn: (value: number) => number): number { return fn("bad") }\nconst result = apply(value => value * 2)', 'const fn: (value: number) => number = (value: string) => 1']) assert.throws(() => compileStandalone(source), { code: "NRS080" });
});

test("NiralScript loop control preserves scope, completion and reactive writes", async () => {
  const source = 'state count = 0\nfunction run() { let total = 0; for (let index = 0; index < 5; index++) { try { if (index === 1) { continue } if (index === 4) { break } total += index } finally { count++ } } let remaining = 2; while (remaining > 0) { --remaining; total += 10 } return total }\nconst result = run()';
  const output = compileStandalone(source);
  const module = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const instance = module.createInstance();
  assert.equal(instance.values.result, 25);
  assert.equal(instance.values.count, 5);
  const plain = source.replace('state count', 'let count');
  for (const code of [compileNiralScript(plain).code, lowerNiralScript(plain)]) assert.deepEqual(new Function(code + '\nreturn [result, count]')(), [25, 5]);
  for (const source of ['break', 'continue', 'while (true) { function bad() { break } }', 'while (true) { const bad = () => { continue } }', 'for (let index = 0; index < 2; index++) {}\nconst bad = index', 'input value\nwhile (true) { value++; break }']) assert.throws(() => compileStandalone(source));
  assert.doesNotThrow(() => compileStandalone('function sum() { let total = 0; for (let index = 0; index < 3; index++) { total += index } return total }\nderive result = sum()'));
  const runtime = await import('../src/runtime/index.js');
  const reactive = 'state count = 0\nderive doubled = count * 2\nfunction run() { for (; count < 3; count++) {} while (count > 1) { count-- } return doubled }';
  const direct = compileNiralScript(reactive);
  for (const code of [direct.code, rewriteScript(lowerNiralScript(reactive), direct.signals)]) {
    const instance = new Function('__n', code + '\nreturn { run, count, doubled }')(runtime);
    assert.equal(instance.run(), 2);
    assert.equal(instance.count.get(), 1);
    assert.equal(instance.doubled.get(), 2);
  }
  const closures = 'const callbacks = []\nfor (let index = 0; index < 3; index++) { callbacks.push(() => index) }\nlet count = 0\nfor (;;) { for (const value of [1, 2]) { if (value === 1) { continue } count += value; break } break }\nconst result = [callbacks[0](), callbacks[1](), callbacks[2]()].join(",")';
  const compiled = compileStandalone(closures);
  const closureModule = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'));
  assert.equal(closureModule.createInstance().values.result, '0,1,2');
  for (const code of [compileNiralScript(closures).code, lowerNiralScript(closures)]) assert.deepEqual(new Function(code + '\nreturn [result, count]')(), ['0,1,2', 2]);
});

test("NiralScript strict contracts cover loops, nested defaults and spread positions", async () => {
  const source = 'function sum(...values: number[]): number { let total: number = 0; for (let index: number = 0; index < values.length; index++) { total += values[index] } return total }\nfunction size(value: string | null): number { while (value !== null) { const count: number = value.length; value = null; return count } return 0 }\nconst { amount = 2 }: { amount?: number } = {}\nconst items: number[] = [3, 4]\nconst result: number = sum(...[amount, ...items]) + size("abc")';
  const output = compileStandalone(source, 'strict.nrs', { strictTypes: true });
  const module = await import('data:text/javascript;base64,' + Buffer.from(output.code).toString('base64'));
  assert.equal(module.createInstance().values.result, 12);
  assert.equal(new Function(compileNiralScript(source, 'strict.nrs', { strictTypes: true }).code + '\nreturn result')(), 12);
  assert.doesNotThrow(() => compileStandalone('const accept: (value: number) => void = value => value + 1\naccept(1)', 'strict.nrs', { strictTypes: true }));
  assert.doesNotThrow(() => compileStandalone('function first(items: number[]): number { for (const item of items) { return item } return 0 }', 'strict.nrs', { strictTypes: true }));
  for (const source of [
    'const { amount = "bad" }: { amount?: number } = {}',
    'function fixed(value: number): number { return value }\nconst items: number[] = []\nfixed(...items)',
    'function fixed(value: number, ...items: number[]) {}\nconst items: number[] = []\nfixed(...items)',
    'function sum(...items: number[]) {}\nsum(...[1, ...["bad"]])',
    'const items: number[] = []\nitems.splice(...[0, 0, "bad"])',
    'function bad(value: string | null): number { while (true) { if (value !== null) { value = null; continue } return value.length } return 0 }',
  ]) assert.throws(() => compileStandalone(source, 'strict.nrs', { strictTypes: true }), { code: 'NRS080' }, source);
});

test("NiralScript types check values, signatures, records and async results", () => {
  for (const source of [
    'state count: number = "wrong"',
    'state count: number = 1\nfunction write() { count = "wrong" }',
    'state count: number = 1\nfunction write() { count += "wrong" }',
    'const values: number[] = [1, "wrong"]',
    'const record: { name: string } = { name: 1 }',
    'function take(value: number): number { return value }\nconst answer = take("wrong")',
    'function take(value: number): number { return value }\nconst answer = take()',
    'function take(value: number): number { return value }\nconst answer = take(1, 2)',
    'function take(): number { return "wrong" }',
    'function take(): number { if (true) { return 1 } }',
    'const take = (value: number): string => value',
    'const take = async (value: number): Promise<string> => value',
    'async function take(): number { return 1 }',
    'async function take(): Promise<number> { return "wrong" }',
    'function take({ value }: { value: number }): string { return value }',
    'const record: { name: string } = { name: "good" }\nrecord.name = 3',
  ]) {
    assert.throws(() => checkNiralScript(source, "types.nrs"), error => error.code === "NRS080" && error.filename === "types.nrs", source);
    assert.throws(() => compileNiralScript(source), { code: "NIRAL080" }, source);
  }
  for (const source of [
    'const values: number[] = []',
    'const record: { name: string, count?: number } = { name: "good" }',
    'const values: (number | string)[] = [1, "two"]',
    'function take({ value }: { value: number }): number { return value }\nconst result = take({ value: 2 })',
    'async function take(): Promise<number> { return 1 }\nasync function run(): Promise<number> { return await take() }',
    'function run(): void { return }',
    'function run(): number { throw "fail" }',
    'const value: number = true ? (1) : 2',
    'const value: number = host()',
    'input value: number;\nstate count: number = 1;',
    'const typed: number = 1\nconst untyped = { value: 1 }\nuntyped.value = "changed"',
  ]) assert.doesNotThrow(() => checkNiralScript(source, "types.nrs", { globals: ["host"] }), source);
  assert.throws(() => checkNiralScript('import { take } from "./typed.nrs"\nconst result = take(1)', "entry.nrs", { resolveModule: () => ({ filename: "typed.nrs", source: 'export function take(value: number): string {\nreturn value\n}' }) }), error => error.code === "NRS080" && error.filename === "typed.nrs" && error.line === 2);
});

test("NiralScript typed array mutators validate inserted values and positions", () => {
  for (const call of ['push("wrong")', 'push(1, "wrong")', 'unshift("wrong")', 'unshift(1, "wrong")', 'splice(0, 1, "wrong")', 'splice(0, 1, 2, "wrong")', 'splice("wrong", 1)', 'splice(0, "wrong")', 'fill("wrong")', 'fill(1, "wrong")', 'fill(1, 0, "wrong")', 'fill(1, 0, 1, 2)', 'fill()', 'splice()']) {
    const source = `state items: number[] = []\nitems.${call}`;
    assert.throws(() => checkNiralScript(source, "mutators.nrs"), error => error.code === "NRS080" && error.filename === "mutators.nrs" && error.line === 2, call);
    assert.throws(() => compileNiralScript(source), { code: "NIRAL080" }, call);
  }
  for (const call of ['push()', 'push(1, 2)', 'unshift()', 'unshift(1, 2)', 'splice(0)', 'splice(0, 1)', 'splice(0, options.position, 1)', 'splice(0, 0, 1, 2)', 'fill(1)', 'fill(1, options.position, options.position)']) {
    assert.doesNotThrow(() => checkNiralScript(`const options: { position?: number } = {}\nstate items: number[] = []\nitems.${call}`), call);
  }
  assert.doesNotThrow(() => checkNiralScript('const typed: number = 1\nstate items = [1]\nitems.push("allowed")'));
});

test("NiralScript typed array mutators retain receiver contracts", () => {
  for (const source of [
    'state items: number[] = []\nconst alias = items\nalias.push("wrong")',
    'state items: number[] = []\nitems["push"]("wrong")',
    'state items: number[] = []\n(items.push)("wrong")',
    'state items: number[] = []\n(items).push("wrong")',
    'const record: { items: number[] } = { items: [] }\nrecord.items.unshift("wrong")',
    'state items: { value: number }[] = []\nitems.push({ value: "wrong" })',
    'state items: number[][] = []\nitems.push(["wrong"])',
    'state items: (number | string)[] = []\nitems.push(true)',
    'state items: number[] | string[] = [1]\nitems.push(1)',
    'function change(items: number[]) { items.fill("wrong") }',
    'function values(): number[] { return [] }\nvalues().push("wrong")',
  ]) {
    assert.throws(() => checkNiralScript(source), { code: "NRS080" }, source);
    assert.throws(() => compileStandalone(source), { code: "NRS080" }, source);
  }
  for (const source of [
    'state items: (number | string)[] = []\nitems.push(1, "two")',
    'state items: { value: number }[] = []\nitems.push({ value: 1 })',
    'state items: number[][] = []\nitems.push([1, 2], [])',
    'state items: number[] = []\nconst alias = items\nalias["push"](1)',
    'state items: number[] = []\nitems.push(host())',
    'const object: { push: unknown } = { push: host }\nobject.push("allowed")',
  ]) assert.doesNotThrow(() => checkNiralScript(source, "mutators.nrs", { globals: ["host"] }), source);
  assert.throws(() => checkNiralScript('import { change } from "./mutators.nrs"', "entry.nrs", { resolveModule: () => ({ filename: "mutators.nrs", source: 'export function change(items: number[]) {\nitems.push("wrong")\n}' }) }), error => error.code === "NRS080" && error.filename === "mutators.nrs" && error.line === 2);
});

test("NiralScript typed array mutators preserve JavaScript runtime behavior", async () => {
  const source = 'state items: number[] = [1, 2]\nfunction change() { const length = items.push(3, 4); items.unshift(0); const removed = items.splice(1, 2, 8, 9); items.fill(7, 3); return { values: [...items], removed, length } }';
  const output = compileStandalone(source);
  const { createInstance } = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  assert.deepEqual(createInstance().values.change(), { values: [0, 8, 9, 7, 7], removed: [1, 2], length: 4 });
  assert.doesNotThrow(() => compileNiralScript(source));
  assert.doesNotThrow(() => lowerNiralScript(source));
});

test("NiralScript annotated syntax and optional expressions emit on both targets", async () => {
  const source = 'input data: { label: string } | null\nstate count: number = 2\nconst twice = (value: number): number => value * 2\nfunction increment(value: number): number { count += value; return count }\nconst label: string = data?.label ?? "none"\nconst kind: string = typeof count';
  const output = compileStandalone(source);
  const { createInstance } = await import("data:text/javascript;base64," + Buffer.from(output.code).toString("base64"));
  const instance = createInstance({ data: null });
  assert.equal(instance.values.label, "none");
  assert.equal(instance.values.kind, "number");
  assert.equal(instance.values.twice(4), 8);
  assert.equal(instance.values.increment(3), 5);
  const direct = compileNiralScript(source).code;
  const legacy = lowerNiralScript(source);
  assert.doesNotMatch(direct, /: number|: string/);
  assert.doesNotMatch(legacy, /: number|: string/);
  for (const invalid of ['const result = 1 ?? 2 || 3', 'const result = 1 && 2 ?? 3', 'input data\ndata?.value = 2']) assert.throws(() => compileStandalone(invalid));
});

test("NiralScript standalone ESM preserves instances, modules and source maps", async () => {
  const source = 'import { twice } from "./math.nrs"\ninput initial\nstate count = initial\nderive doubled = twice(count)\nasync function increment() { count += await 1; return doubled }';
  const result = compileStandalone(source, "entry.nrs", { resolveModule: () => ({ filename: "math.nrs", source: "export function twice(value) { return value * 2 }" }) });
  const { createInstance } = await import("data:text/javascript;base64," + Buffer.from(result.code).toString("base64"));
  const first = createInstance({ initial: 2 });
  const second = createInstance({ initial: 9 });
  assert.equal(first.values.doubled, 4);
  assert.equal(await first.values.increment(), 6);
  assert.equal(second.values.count, 9);
  assert.equal(first.values.twice(5), 10);
  first.values.count = 7;
  assert.equal(first.values.doubled, 14);
  first.updateInputs({ initial: 8 });
  assert.equal(first.values.initial, 8);
  assert.equal(first.values.count, 7);
  const runtime = await import("../src/runtime/index.js");
  const injected = createInstance({ initial: 4 }, {}, runtime);
  assert.equal(injected.values.doubled, 8);
  assert.equal(await injected.values.increment(), 10);
  injected.updateInputs({ initial: 12, missing: 3 });
  assert.equal(injected.values.initial, 12);
  assert.equal(injected.values.count, 5);
  assert.ok(!Object.hasOwn(injected.values, "missing"));
  assert.equal(second.values.count, 9);
  assert.deepEqual(result.map.sources, ["math.nrs", "entry.nrs"]);
  assert.equal(result.map.sourcesContent[1], source);
  assert.ok(result.map.mappings.includes(","));
  const generated = result.code.split("\n");
  const returnLine = generated.findIndex(line => line.startsWith("return (("));
  const mapped = new SourceMap(result.map).findEntry(returnLine, 0);
  assert.equal(mapped.originalSource, "math.nrs");
  assert.equal(mapped.originalLine, 0);
  assert.equal(mapped.originalColumn, 31);
  assert.doesNotMatch(result.code, /from ["'].*niral|process\.env/);
});

test("NiralScript inlines cheap derives at their reference sites", async () => {
  const source = "state count = 2\nderive doubled = count * 2\nfunction read() { return doubled }\nfunction bump() { count += 1; return doubled }";
  const inline = compileStandalone(source);
  assert.doesNotMatch(inline.code, /derived|get: \(\) => \(\(/);
  const { createInstance } = await import("data:text/javascript;base64," + Buffer.from(inline.code).toString("base64"));
  const instance = createInstance();
  assert.equal(instance.values.doubled, 4);
  assert.equal(instance.values.read(), 4);
  assert.equal(instance.values.bump(), 6);
  assert.equal(instance.values.doubled, 6);

  // Inlining a member expression must not hand the call its object as a receiver.
  const callee = compileStandalone("state host = source\nderive method = host.read\nfunction call() { return method() }", "callee.nrs", { globals: ["source"] });
  const calleeModule = await import("data:text/javascript;base64," + Buffer.from(callee.code).toString("base64"));
  const host = { tag: "outer", read() { "use strict"; return this === undefined ? "unbound" : "bound"; } };
  assert.equal(calleeModule.createInstance({}, { source: host }).values.call(), "unbound");

  // Reading a cheap derive from many sites keeps one shared cell instead of duplicating it.
  const widely = compileStandalone("state count = 2\nderive doubled = count * 2\n" + Array.from({ length: 24 }, (_, index) => `function read${index}() { return doubled }`).join("\n"));
  assert.match(widely.code, /const __binding\d+ = \{ get: \(\) =>/);
});

test("NiralScript async functions await results without weakening semantics", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "state total = 1\nasync function double(value) { return await value * 2 }\nasync function run() { await 0; for (const value of [2, 3]) { total += await double(value) } return total }";
  const direct = compileNiralScript(script);
  for (const code of [direct.code, rewriteScript(lowerNiralScript(script), direct.signals)]) {
    const instance = new Function("__n", code + "\nreturn { run, total };")(runtime);
    const pending = instance.run();
    assert.equal(instance.total.get(), 1);
    assert.equal(await pending, 11);
    assert.equal(instance.total.get(), 11);
  }
  const linked = compileNiralScript('import { value } from "./async.nrs"\nconst result = value()', "entry.nrs", {
    resolveModule: () => ({ filename: "async.nrs", source: "export async function value() { return await 7 }" }),
  });
  assert.equal(await new Function("__n", linked.code + "\nreturn result;")(runtime), 7);
  for (const source of ["const value = await 1", "function read() { return await 1 }", "async function outer() { function inner() { return await 1 } }", "async function outer() { const inner = () => await 1 }"]) assert.throws(() => checkNiralScript(source), { code: "NRS072" });
  for (const source of ["async function read() { return 1 }\nderive result = read()", "async function read(value) { return value }\nderive result = [1].map(read)"]) assert.throws(() => compileNiralScript(source), { code: "NIRAL075" });
  assert.throws(() => checkNiralScript("input item\nasync function identity(value) { return await value }\nasync function run() { const alias = await identity(item); alias.name = 1 }"), { code: "NRS074" });
  assert.throws(() => checkNiralScript("async function read() { await 0; return later }\nconst pending = read()\nconst later = 1"), { code: "NRS074" });
});

test("NiralScript async arrows and error handling preserve completion and scope", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "state result = ''\nstate busy = false\nstate finished = 0\nconst identity = async value => await value\nconst run = async ({ fail }) => { busy = true; try { const value = await identity('ready'); if (fail) { throw { message: 'failed' } } result = value; return value } catch ({ message }) { result = message; return message } finally { await 0; busy = false; finished += 1 } }\nconst reject = async () => { try { throw 'rejected' } finally { finished += 1 } }\nconst override = async () => { try { return 'first' } finally { return 'last' } }";
  const direct = compileNiralScript(script);
  for (const code of [direct.code, rewriteScript(lowerNiralScript(script), direct.signals)]) {
    const instance = new Function("__n", code + "\nreturn { run, reject, override, result, busy, finished };")(runtime);
    const pending = instance.run({ fail: false });
    assert.equal(instance.busy.get(), true);
    assert.equal(await pending, "ready");
    assert.equal(instance.result.get(), "ready");
    assert.equal(instance.busy.get(), false);
    assert.equal(await instance.run({ fail: true }), "failed");
    assert.equal(instance.result.get(), "failed");
    await assert.rejects(instance.reject(), error => error === "rejected");
    assert.equal(instance.finished.get(), 3);
    assert.equal(await instance.override(), "last");
  }
  const plain = compileNiralScript("const async = value => value + 1\nconst result = async(async(2))\nfunction fallback() { try { throw 'bad' } catch { return 4 } }").code;
  assert.deepEqual(new Function("__n", plain + "\nreturn [result, fallback()];")(runtime), [4, 4]);
  for (const source of [
    "const run = async () => { const sync = () => await 1 }",
    "function run() { try {} finally { await 1 } }",
    "try {} catch (error) {}\nconst value = error",
    "try {} catch (error) { const error = 1 }",
    "input item\nasync function fail() { throw item }\nasync function run() { try { await fail() } catch (error) { error.name = 'changed' } }",
    "input item\nfunction run() { try { throw { nested: item } } catch ({ nested }) { nested.name = 'changed' } }",
    "const read = async () => 1\nderive result = read()",
    "derive result = [1].map(async value => value)",
    "function read() { try { throw 'bad' } catch { return 1 } }\nderive result = read()",
  ]) assert.throws(() => compileNiralScript(source), /async function|Unresolved|Duplicate|read-only|async functions|explicitly throw/);
  for (const source of ["try {}", "try {} catch () {}", "throw", "throw\n'bad'", "throw /*\n*/ 'bad'", "const run = [async\n() => 1]", "const run = [(value)\n=> value]", "async\nfunction run() {}"]) assert.throws(() => parseNiralScript(source), NiralScriptError);
});

test("NiralScript async modules retain rejection, diagnostics and effect checks", async () => {
  const runtime = await import("../src/runtime/index.js");
  const source = 'import { read } from "./async.nrs"\nstate finished = 0\nasync function run(fail) { try { return await read(fail) } catch ({ message: reason }) { return reason } finally { finished += 1 } }\nasync function forward() { try { return read(true) } catch { return "unexpected" } finally { finished += 1 } }';
  const options = { resolveModule: () => ({ filename: "async.nrs", source: 'export async function value(fail) { if (fail) { throw Error("module failure") } return await 4 }\nexport const read = async flag => await value(flag) * 2' }) };
  const direct = compileNiralScript(source, "entry.nrs", options);
  for (const code of [direct.code, rewriteScript(lowerNiralScript(source, "entry.nrs", options), direct.signals)]) {
    const instance = new Function("__n", code + "\nreturn { run, forward, finished };")(runtime);
    assert.equal(await instance.run(false), 8);
    assert.equal(await instance.run(true), "module failure");
    await assert.rejects(instance.forward(), /module failure/);
    assert.equal(instance.finished.get(), 3);
  }
  const invalid = "export const read = async () => {\n  try { return await missing } finally {}\n}";
  assert.throws(() => checkNiralScript('import { read } from "./async.nrs"', "entry.nrs", { resolveModule: () => ({ filename: "async.nrs", source: invalid }) }), error => error.code === "NRS073" && error.filename === "async.nrs" && error.line === 2 && invalid.slice(error.start, error.end) === "missing");
  for (const body of ["try { return 1 } catch { count += 1 }", "try { return 1 } finally { count += 1 }", "try { count += 1 } finally {}"]) {
    assert.throws(() => compileNiralScript(`state count = 0\nfunction read() { ${body} }\nderive result = read()`), { code: "NIRAL075" });
  }
  assert.throws(() => compileNiralScript("function read() { try { return result } finally {} }\nderive result = read()"), { code: "NIRAL076" });
  assert.throws(() => compileNiralScript("input item\nasync function fail(value) { throw value }\nasync function run() { try { await fail(item) } catch (error) { error.update() } }"), { code: "NIRAL074" });
  assert.throws(() => compileNiralScript("const values = [1]\nasync function identity(value) { return await value }\nfunction replacement(value) { return value }\nasync function change() { const alias = await identity(values); alias.map = replacement }\nderive result = values.map(replacement)"), { code: "NIRAL075" });
});

test("NiralScript arrows preserve lexical scope and call safeguards", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "state value = 3\nconst twice = value => value * 2\nconst add = (left, right) => left + right\nderive result = add(twice(value), (() => 1)())";
  const compiled = compileNiralScript(script);
  const instance = new Function("__n", compiled.code + "\nreturn { value, result };")(runtime);
  assert.equal(instance.result.get(), 7);
  instance.value.set(5);
  assert.equal(instance.result.get(), 11);
  for (const source of [
    "input item\nconst identity = value => value\nconst alias = identity(item)\nalias.name = 1",
    "const read = () => later\nconst first = read()\nconst later = 1",
  ]) assert.throws(() => checkNiralScript(source), { code: "NRS074" });
  assert.throws(() => compileNiralScript("const read = () => fetch('/data')\nderive result = read()"), { code: "NIRAL075" });
  for (const source of ["const bad = (item, item) => item", "const bad = (item + 1) => item", "const bad = (__private) => 1"]) assert.throws(() => checkNiralScript(source), NiralScriptError);
});

test("NiralScript block callbacks lower writes and enforce collection effects", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "state values = [1, 2, 3]\nstate total = 0\nconst run = () => { values.forEach(value => { total += value }) }\nderive doubled = values.map(value => { return value * 2 })\nderive sum = doubled.reduce((accumulator, value) => accumulator + value, 0)";
  const compiled = compileNiralScript(script);
  const instance = new Function("__n", compiled.code + "\nreturn { run, total, sum, values };")(runtime);
  instance.run();
  assert.equal(instance.total.get(), 6);
  assert.equal(instance.sum.get(), 12);
  instance.values.set([4, 5]);
  assert.equal(instance.sum.get(), 18);
  for (const source of [
    "state values = [1]\nstate count = 0\nderive bad = values.map(value => { count += value; return value })",
    "const values = [1]\nconst first = values.map(value => later)\nconst later = 1",
    "derive values = [{ name: 'A' }]\nvalues.forEach(value => { value.name = 'B' })",
    "derive values = [{ name: 'A' }]\nconst aliases = values.map(value => value)\naliases[0].name = 'B'",
  ]) assert.throws(() => compileNiralScript(source), /read-only|initialization|cannot mutate/);
  assert.equal(checkNiralScript("const value = (1 /* comment */)").program.body.length, 1);
});

test("NiralScript patterns, spreads and for-of preserve bindings and readonly values", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "input items\nstate total = 0\nconst { title, nested: [first] } = { title: 'A', nested: [2] }\nconst double = ({ value }) => value * 2\nconst run = () => { for (const { value } of items) { total += double({ value }) } }\nfunction sum(values) { let result = 0; for (let [left, right] of values) { result += left + right } return result }\nderive labels = [...items].map(({ value }) => ({ ...{ label: title }, value: value + first }))\nderive combined = sum([[1, 2], [3, 4]])";
  const compiled = compileNiralScript(script);
  const instance = new Function("__n", "__props", compiled.code + "\nreturn { run, total, labels, combined };")(runtime, { items: [{ value: 3 }, { value: 4 }] });
  instance.run();
  assert.equal(instance.total.get(), 14);
  assert.equal(instance.combined.get(), 10);
  assert.deepEqual(instance.labels.get(), [{ label: "A", value: 5 }, { label: "A", value: 6 }]);
  for (const source of [
    "input item\nconst { nested: alias } = item\nalias.name = 'B'",
    "input items\nfor (const item of items) { item.name = 'B' }",
    "input items\nconst aliases = [...items]\naliases[0].name = 'B'",
    "input item\nconst alias = { ...item }\nalias.nested.name = 'B'",
    "const values = [1]\nfor (const values of values) { values = 2 }",
    "const { value, other: value } = { value: 1 }",
    "const values = [1]\nfor (const value of values) {}\nconst result = value",
  ]) assert.throws(() => compileNiralScript(source), /read-only|initialization|binding names|Unresolved/);
});

test("NiralScript callback forwarding retains effects, aliases and method provenance", async () => {
  const runtime = await import("../src/runtime/index.js");
  const code = compileNiralScript("function apply(callback, value) { return callback(value) }\nconst twice = value => value * 2\nderive result = apply(twice, 3)").code;
  assert.equal(new Function("__n", code + "\nreturn result.get();")(runtime), 6);
  for (const source of [
    "input item\nfunction apply(callback, value) { return callback(value) }\nconst identity = value => value\nconst alias = apply(identity, item)\nalias.name = 1",
    "const values = [1]\nfunction apply(callback) { return callback() }\nconst result = apply(() => later)\nconst later = 1",
    "state count = 0\nfunction apply(callback) { return callback() }\nderive result = apply(() => { count += 1; return count })",
    "input items\n[...items].reduce((accumulator, item) => { accumulator.name = 1; return item }, {})",
    "input item\nconst values = [].concat([item])\nvalues[0].name = 1",
    "state values = [1]\nconst mapped = values.map(value => value)\nmapped.map = fetch\nderive result = mapped.map(value => value)",
    "const [value] = [{ map: fetch }]\nderive result = value.map(item => item)",
  ]) assert.throws(() => compileNiralScript(source), /read-only|initialization|cannot mutate|provably pure/);
});

test("NiralScript collections preserve execution order, diagnostics and module scopes", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "const { first, nested: [second] } = create()\nstate count = first\nconst update = () => { count += second }\nderive result = [count].filter(value => value > 0).map(value => value * 2).reduce((sum, value) => sum + value, 0)";
  const direct = compileNiralScript(script, "collections.nrs", { globals: ["create"] });
  for (const code of [direct.code, rewriteScript(lowerNiralScript(script, "collections.nrs", { globals: ["create"] }), direct.signals)]) {
    let calls = 0;
    const instance = new Function("__n", "create", code + "\nreturn { update, result };")(runtime, () => { calls++; return { first: 1, nested: [2] }; });
    assert.equal(instance.result.get(), 2);
    instance.update();
    assert.equal(instance.result.get(), 6);
    assert.equal(calls, 1);
  }
  const component = '<script lang="niralscript">const { label } = { label: "<&" }\nderive text = [label].map(value => value + "!").join("")</script><p>{text}</p>';
  const compiled = compileClient(component, { runtime: new URL("../src/runtime/index.js", import.meta.url).href });
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(compiled.code).toString("base64"));
  assert.equal(renderComponent(Component), renderComponent((target, props) => Component(target, props)));
  const linked = compileNiralScript('import { twice } from "./math.nrs"\nderive result = twice({ value: 3 })', "entry.nrs", {
    resolveModule: () => ({ filename: "math.nrs", source: "export const twice = ({ value }) => { const [factor] = [2]; return value * factor }" }),
  });
  assert.equal(new Function("__n", linked.code + "\nreturn result.get();")(runtime), 6);
  for (const source of [
    "derive first = [1].map(value => second)\nderive second = first[0]",
    "input value\nconst { nested } = value\nderive result = nested.map(item => item)",
    "state count = 0\nfunction sum() { for (const value of [1]) { count += value } return count }\nderive result = sum()",
    "const items = [1]\nfor (const item of items) { const first = read(); const later = 1; function read() { return later } }",
  ]) assert.throws(() => compileNiralScript(source), /cycle|provably pure|cannot mutate|initialization|unproven method/);
  for (const source of ["const [...rest, last] = []", "const { ...rest, last } = {}", "const run = (...args, last) => args", "for (let value in {}) {}", "for (let value of []) value = 1", "state [value] = [1]"]) assert.throws(() => parseNiralScript(source), NiralScriptError);
  const source = "const items = [1]\nderive result = items.map(value => missing)";
  assert.throws(() => compileNiralScript(source, "callback.nrs"), error => error.filename === "callback.nrs" && error.line === 2 && source.slice(error.start, error.end) === "missing");
});

test("NiralScript inputs are portable read-only declarations", () => {
  const script = "input title\ninput record;\nstate draft = title\nderive label = record.name";
  const checked = checkNiralScript(script, "inputs.nrs");
  assert.equal(checked.program.body[0].type, "InputDeclaration");
  assert.equal(checked.analysis.bindings[0].kind, "input");
  const compiled = compileNiralScript(script);
  assert.deepEqual([...compiled.props], ["title", "record"]);
  assert.deepEqual([...compiled.writable], ["draft"]);
  assert.match(compiled.code, /get: __n\.prop\(__props, "title"\)\.get/);
  assert.match(compiled.code, /record\.get\(\)\.name/);
  for (const source of [
    "input value\nvalue = 1",
    "input value\nvalue.name = 1",
    "input value\nconst alias = value\nalias.name = 1",
    "input value\nfunction identity(item) { return item }\nconst alias = identity(value)\nalias.name = 1",
    "input value\nvalue.push(1)",
    "state value = title\ninput title",
    "const value = read()\ninput title\nfunction read() { return title }",
  ]) assert.throws(() => checkNiralScript(source), { code: "NRS074" }, source);
  for (const source of ["function read() { input value }", "input value = 1", "input { value }", "input value input other"]) {
    assert.throws(() => checkNiralScript(source), NiralScriptError, source);
  }
  assert.throws(() => checkNiralScript('import { value } from "./lib.nrs"', "entry.nrs", {
    resolveModule: () => ({ filename: "lib.nrs", source: "input title\nexport const value = title" }),
  }), { code: "NRS078" });
});

test("NiralScript inputs preserve reactive updates, instance state and SSR parity", async () => {
  const runtime = await import("../src/runtime/index.js");
  const script = "input title\ninput record\ninput missing\nstate draft = title\nderive label = title + record.name";
  const direct = compileNiralScript(script);
  const legacy = rewriteScript(lowerNiralScript(script), new Set([...direct.signals, ...direct.props]));
  for (const code of [direct.code, legacy]) {
    const parent = runtime.signal({ title: "First", record: { name: "One" } });
    const create = new Function("__n", "__props", code + "\nreturn { title, draft, label, missing };");
    const instance = create(runtime, { __sig: parent });
    assert.equal(instance.label.get(), "FirstOne");
    assert.equal(instance.missing.get(), undefined);
    parent.set({ title: "Next", record: { name: "Two" } });
    assert.equal(instance.title.get(), "Next");
    assert.equal(instance.label.get(), "NextTwo");
    assert.equal(instance.draft.get(), "First");
    const other = create(runtime, { title: "Other", record: { name: "Three" }, missing: null });
    assert.equal(other.missing.get(), null);
    instance.draft.set("Edited");
    assert.equal(other.draft.get(), "Other");
    if (code === direct.code) {
      let writes = 0;
      const bound = create(runtime, { title: "Bound", record: { name: "Four" }, __bindings: { title: { set() { writes++; } } } });
      assert.equal(bound.title.set, undefined);
      assert.equal(writes, 0);
    }
  }
  const component = `<script lang="niralscript">${script}</script><p>{label}/{draft}/{missing === undefined}</p>`;
  const { code } = compileClient(component, { runtime: new URL("../src/runtime/index.js", import.meta.url).href });
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  for (const props of [{ title: "A", record: { name: "B" } }, { title: "<C>", record: { name: "&D" } }]) {
    assert.equal(renderComponent(Component, props), renderComponent((target, values) => Component(target, values), props));
  }
  for (const target of ["title", "title.name"]) {
    assert.throws(() => compileClient(`<script lang="niralscript">input title</script><input bind:value={${target}} />`), { code: "NIRAL042" });
  }
  assert.throws(() => compileNiralScript("input ping", "input.nrs", { reserved: ["ping"] }), { code: "NIRAL073" });
  assert.throws(() => compileNiralScript("input title\nconst secret = process.env.KEY"), { code: "NIRAL044" });
});

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
    writeFileSync(join(project, 'strict.nrs'), 'function value(candidate: unknown): number { return candidate }');
    assert.equal(check('strict.nrs').status, 0);
    assert.equal(check('strict.nrs', '--strict').status, 1);
    assert.equal(run('compile', 'strict.nrs', '--strict', '--out', 'strict.mjs').status, 1);
    writeFileSync(join(project, 'strict.nrs'), 'function value(candidate: unknown): number { if (typeof candidate === "number") { return candidate } return 0 }');
    assert.equal(check('strict.nrs', '--strict').status, 0);
    const compiled = run("compile", "entry.nrs", "--out", "entry.mjs", "--json");
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(JSON.parse(compiled.stdout).ok, true);
    const compiledCode = readFileSync(join(project, "entry.mjs"), "utf8");
    assert.match(compiledCode, /sourceMappingURL=entry.mjs.map/);
    assert.deepEqual(JSON.parse(readFileSync(join(project, "entry.mjs.map"), "utf8")).sources, ["base.nrs", "math.nrs", "entry.nrs"]);
    assert.equal(run("compile", "entry.nrs", "--out", "entry.mjs").status, 1);
    assert.equal(readFileSync(join(project, "entry.mjs"), "utf8"), compiledCode);
    assert.equal(run("compile", "entry.nrs", "--out", "../escape.mjs").status, 1);
    assert.equal(run("compile", "entry.nrs", "--out", "missing/output.mjs").status, 1);
    assert.equal(run("compile", "entry.nrs").status, 2);
    writeFileSync(join(project, "trace.nrs"), 'import { fail } from "./fail.nrs"\nfunction run() { return fail() }');
    writeFileSync(join(project, "fail.nrs"), 'export class Failure { run() {\n  throw Error("mapped")\n} }\nexport function fail() { return new Failure().run() }');
    assert.equal(run("compile", "trace.nrs", "--out", "trace.mjs", "--global", "Error").status, 0);
    const traced = spawnSync(process.execPath, ["--enable-source-maps", "--input-type=module", "-e", 'import { createInstance } from "./trace.mjs"; createInstance({}, { Error }).values.run();'], { cwd: project, encoding: "utf8" });
    assert.equal(traced.status, 1);
    assert.match(traced.stderr, /fail\.nrs:2:/);
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
    assert.equal(run("compile", "host.nrs", "--global", "mustNotExecute", "--out", "linked/escape.mjs").status, 1);
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
  assert.equal(parseNiralScript("const value = new Thing()").body[0].init.type, "NewExpression");
  for (const expression of ["1 +", "1 2", "count = 2", "count++", "new", "() =>"]) {
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
    "a == b", "a != b", "a ** b", "a ??", "a?.", "a & b", "a, b", "a += 1",
    "++a", "[1,,2]", "[...]", "{...}", "{[key]: 1}", "{get x() {}}",
    "{true}", "{x:}", "{__proto__: null, '__proto__': null}", "fn(,)", "fn(1 2)",
    "record[]", "record.", "a ? b", "a ? : b", "(1, 2)", "1e+", "01", "0x10",
    '"\\xGG"', '"\\uXYZW"', '"\\u{110000}"', '"\\1"', '"\\08"', "`bad ${1 +}`",
    "function() {}", "/pattern/", "await", "typeof",
    "1 + () => 2", "!() => 1", "() => {}()", "fn(...)",
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
    "function run() {", "function run(...args, last) {}", "function run(arg =) {}",
    "function run() { state local = 1 }", "if (true) { derive local = 1 }",
    "let value = 1\nconst invalid = value++", "let value = 1\nvalue = other = 2",
    "1 + 2", "(1 + 2) = 3", "function run() { return 1 +\n 2 }",
    "while (true) call()", "for (;;) call()", "const value = 1, another = 2",
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

test("NiralScript as and satisfies casts erase at runtime and check types", async () => {
  // as: asserts the type, erases to the inner expression, no runtime check
  const asSource = 'function load(x: unknown): string { return x as string }\nconst result = load("hello")';
  assert.equal(new Function(compileNiralScript(asSource, "cast.nrs", { strictTypes: true }).code + ";return result")(), "hello");
  assert.equal(new Function(lowerNiralScript(asSource, "cast.nrs", { strictTypes: true }) + ";return result")(), "hello");
  const asStandalone = await import("data:text/javascript;base64," + Buffer.from(compileStandalone(asSource, "cast.nrs", { strictTypes: true }).code).toString("base64"));
  assert.equal(asStandalone.createInstance().values.result, "hello");

  // satisfies: checks the type at compile time, erases to the inner expression
  const satSource = 'type Point = { x: number, y: number }\nconst p = { x: 1, y: 2 } satisfies Point\nconst sum = p.x + p.y';
  assert.equal(new Function(compileNiralScript(satSource, "satisfies.nrs", { strictTypes: true }).code + ";return sum")(), 3);
  assert.equal(new Function(lowerNiralScript(satSource, "satisfies.nrs", { strictTypes: true }) + ";return sum")(), 3);

  // satisfies rejects a type mismatch at compile time
  assert.throws(
    () => compileStandalone('type Point = { x: number, y: number }\nconst p = { x: 1, y: "bad" } satisfies Point', "bad-satisfies.nrs", { strictTypes: true }),
    { code: "NRS080" }
  );

  // as does NOT reject a type mismatch (it is an assertion, not a check)
  assert.doesNotThrow(
    () => compileStandalone('const x = "hello" as number', "as-assert.nrs", { strictTypes: true })
  );

  // both work in all three emitters
  const multiSource = 'const value = (42 as number) + (0 satisfies number)';
  assert.equal(new Function(compileNiralScript(multiSource, "multi.nrs").code + ";return value")(), 42);
  assert.equal(new Function(lowerNiralScript(multiSource, "multi.nrs") + ";return value")(), 42);
  const multiStandalone = await import("data:text/javascript;base64," + Buffer.from(compileStandalone(multiSource, "multi.nrs").code).toString("base64"));
  assert.equal(multiStandalone.createInstance().values.value, 42);

  // chained casts work
  const chainSource = 'const x = 1 as unknown as number';
  assert.equal(new Function(compileNiralScript(chainSource, "chain.nrs").code + ";return x")(), 1);

  // as inside a member expression
  const exprSource = 'function id(x: unknown) { return x as string }\nconst r = id("ok").length';
  assert.equal(new Function(compileNiralScript(exprSource, "expr.nrs", { strictTypes: true }).code + ";return r")(), 2);
});

test("NiralScript interfaces erase at runtime and check types", async () => {
  // basic interface erases — value still works
  const basic = `interface Point { x: number; y: number }\nconst p: Point = { x: 1, y: 2 }\nconst r = p.x + p.y`;
  assert.equal(new Function(compileNiralScript(basic, "iface.nrs", { strictTypes: true }).code + ";return r")(), 3);

  // interface erases in standalone emitter
  const standaloneCode = `interface Box { value: number }\nconst b: Box = { value: 42 }`;
  const { code: saCode } = compileStandalone(standaloneCode, "box.nrs");
  assert.ok(!saCode.includes("interface"), "interface keyword must be erased in standalone output");

  // interface erases in legacy emitter
  const legacyCode = lowerNiralScript(basic, "iface.nrs", { strictTypes: true });
  assert.ok(!legacyCode.includes("interface"), "interface keyword must be erased in legacy output");

  // interface with extends merges properties
  const extendsCode = `interface Named { name: string }\ninterface Aged extends Named { age: number }\nconst a: Aged = { name: "x", age: 1 }`;
  assert.doesNotThrow(() => compileNiralScript(extendsCode, "ext.nrs", { strictTypes: true }));

  // extends — missing base property is rejected
  assert.throws(
    () => compileNiralScript(`interface Named { name: string }\ninterface Aged extends Named { age: number }\nconst a: Aged = { age: 1 }`, "bad.nrs", { strictTypes: true })
  );

  // interface with type parameter
  const genericCode = `interface Box<T> { value: T }\nconst b: Box<number> = { value: 7 }`;
  assert.doesNotThrow(() => compileNiralScript(genericCode, "gen.nrs", { strictTypes: true }));

  // generic interface — wrong type rejected
  assert.throws(
    () => compileNiralScript(`interface Box<T> { value: T }\nconst b: Box<number> = { value: "oops" }`, "badgen.nrs", { strictTypes: true })
  );

  // exported interface is usable across modules via type import
  const libSrc = `export interface Shape { area: number }`;
  const appSrc = `import type { Shape } from "./lib.nrs"\nconst s: Shape = { area: 5 }`;
  const linked = linkNiralScript(parseNiralScript(appSrc, "app.nrs"), () => ({ filename: "lib.nrs", source: libSrc }));
  assert.doesNotThrow(() => analyzeNiralScript(linked, { strictTypes: true }));

  // satisfies against interface
  const satisfiesCode = `interface Point { x: number; y: number }\nconst p = { x: 1, y: 2 } satisfies Point`;
  assert.doesNotThrow(() => compileNiralScript(satisfiesCode, "sat.nrs", { strictTypes: true }));

  // satisfies against interface — mismatch rejected
  assert.throws(
    () => compileNiralScript(`interface Point { x: number; y: number }\nconst p = { x: 1 } satisfies Point`, "badsat.nrs", { strictTypes: true })
  );
});

test("NiralScript generic constraints and defaults", () => {
  // constraint accepted — number satisfies number
  assert.doesNotThrow(() => compileNiralScript(
    `type Box<T extends number> = { value: T }\nconst b: Box<number> = { value: 1 }`,
    "c.nrs", { strictTypes: true }
  ));

  // constraint rejected — string does not satisfy number
  assert.throws(() => compileNiralScript(
    `type Box<T extends number> = { value: T }\nconst b: Box<string> = { value: "x" }`,
    "c.nrs", { strictTypes: true }
  ));

  // default applied when no argument given
  assert.doesNotThrow(() => compileNiralScript(
    `type Box<T = string> = { value: T }\nconst b: Box = { value: "hi" }`,
    "d.nrs", { strictTypes: true }
  ));

  // default rejected when value doesn't match default type
  assert.throws(() => compileNiralScript(
    `type Box<T = string> = { value: T }\nconst b: Box = { value: 42 }`,
    "d.nrs", { strictTypes: true }
  ));

  // explicit arg overrides default
  assert.doesNotThrow(() => compileNiralScript(
    `type Box<T = string> = { value: T }\nconst b: Box<number> = { value: 7 }`,
    "d.nrs", { strictTypes: true }
  ));

  // constraint + default — default satisfies constraint
  assert.doesNotThrow(() => compileNiralScript(
    `type Box<T extends number = number> = { value: T }\nconst b: Box = { value: 5 }`,
    "cd.nrs", { strictTypes: true }
  ));

  // constraint + default — explicit arg violates constraint
  assert.throws(() => compileNiralScript(
    `type Box<T extends number = number> = { value: T }\nconst b: Box<string> = { value: "x" }`,
    "cd.nrs", { strictTypes: true }
  ));

  // interface with constraint
  assert.doesNotThrow(() => compileNiralScript(
    `interface Pair<T extends string> { first: T; second: T }\nconst p: Pair<string> = { first: "a", second: "b" }`,
    "ip.nrs", { strictTypes: true }
  ));

  // interface with constraint — violation
  assert.throws(() => compileNiralScript(
    `interface Pair<T extends string> { first: T; second: T }\nconst p: Pair<number> = { first: 1, second: 2 }`,
    "ip.nrs", { strictTypes: true }
  ));

  // interface with default
  assert.doesNotThrow(() => compileNiralScript(
    `interface Wrapper<T = boolean> { val: T }\nconst w: Wrapper = { val: true }`,
    "iw.nrs", { strictTypes: true }
  ));

  // generic function with constraint — call accepted
  const fnOk = `function identity<T extends string>(x: T): T { return x }\nconst r = identity("hello")`;
  assert.doesNotThrow(() => compileNiralScript(fnOk, "fn.nrs", { strictTypes: true }));

  // generic function with constraint — call rejected
  const fnBad = `function identity<T extends string>(x: T): T { return x }\nconst r = identity(42)`;
  assert.throws(() => compileNiralScript(fnBad, "fn.nrs", { strictTypes: true }));

  // multiple params — second has default depending on first
  assert.doesNotThrow(() => compileNiralScript(
    `type Pair<A, B = A> = { a: A, b: B }\nconst p: Pair<number> = { a: 1, b: 2 }`,
    "mp.nrs", { strictTypes: true }
  ));
});

test("NiralScript class expressions", async () => {
  // anonymous class expression assigned to const
  const anon = `const Animal = class {\n  greet() { return "hi" }\n}\nconst a = new Animal()\nconst r = a.greet()`;
  assert.equal(new Function(compileNiralScript(anon, "anon.nrs").code + ";return r")(), "hi");

  // named class expression — name accessible inside, not outside
  const named = `const Foo = class Bar {\n  name() { return "Bar" }\n}\nconst f = new Foo()\nconst r = f.name()`;
  assert.equal(new Function(compileNiralScript(named, "named.nrs").code + ";return r")(), "Bar");

  // class expression with extends
  const ext = `class Base {\n  val() { return 1 }\n}\nconst Child = class extends Base {\n  val() { return 2 }\n}\nconst c = new Child()\nconst r = c.val()`;
  assert.equal(new Function(compileNiralScript(ext, "ext.nrs").code + ";return r")(), 2);

  // class expression in standalone emitter
  const { code: saCode } = compileStandalone(`const C = class { run() { return 42 } }`, "sa.nrs");
  assert.ok(!saCode.includes("class C"), "anonymous class expression must not emit a name");
  const saResult = await import(`data:text/javascript,${encodeURIComponent(saCode + "\nexport const inst = createInstance({},{},__runtime);\n".replace("createInstance", "export default createInstance; const inst"))}`).catch(() => null);

  // class expression in legacy emitter
  const legacyCode = lowerNiralScript(`const C = class { run() { return 99 } }`, "leg.nrs");
  assert.ok(legacyCode.includes("class"), "class keyword must appear in legacy output");

  // type checking — class expression used with new
  const typed = `const C = class {\n  x: number = 1\n}\nconst c = new C()`;
  assert.doesNotThrow(() => compileNiralScript(typed, "typed.nrs", { strictTypes: true }));

  // class expression with generic type parameter
  const generic = `const Box = class<T> {\n  value: T;\n  constructor(v: T) { this.value = v }\n}\nconst b = new Box(42)`;
  assert.doesNotThrow(() => compileNiralScript(generic, "gen.nrs", { strictTypes: true }));

  // class expression passed as argument
  const inline = `const items = [class { val() { return 7 } }]\nconst r = new items[0]().val()`;
  assert.doesNotThrow(() => compileNiralScript(inline, "inline.nrs"));
});
