import assert from "node:assert/strict";
import { cpus, platform, arch } from "node:os";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadTypescript } from "../src/check/check.js";
import { compileClient, hoistImports } from "../src/compiler/codegen.js";
import { compileNiralScript, lowerNiralScript } from "../src/compiler/niralscript.js";
import { compileNiralScript as compileStandalone } from "../niralscript/compile.js";
import { collectDeclarations, rewriteScript } from "../src/compiler/rewrite.js";
import { renderComponent } from "../src/server/render.js";

const runtime = new URL("../src/runtime/index.js", import.meta.url).href;
const rounds = 12;
const warmup = 30;
const mode = process.argv[2] ?? "compile";
assert.ok(["compile", "browser", "types", "standalone", "language"].includes(mode), "Mode must be compile, browser, types, standalone or language");
let sink = 0;

function summarize(values) {
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return { median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, p90: values[Math.ceil(values.length * 0.9) - 1] };
}

function compare(tasks, iterations) {
  const samples = tasks.map(() => []);
  for (let iteration = 0; iteration < warmup; iteration++) {
    for (const task of tasks) sink += task.run();
  }
  for (let round = 0; round < rounds; round++) {
    const order = tasks.map((_, index) => (round + index) % tasks.length);
    for (const index of order) {
      const start = performance.now();
      for (let iteration = 0; iteration < iterations; iteration++) sink += tasks[index].run();
      samples[index].push((performance.now() - start) / iterations);
    }
  }
  return samples.map(summarize);
}

function reactiveBindings(count) {
  const nrs = [];
  const js = [];
  const ts = [];
  const markup = [];
  for (let index = 0; index < count; index++) {
    nrs.push(`state count${index} = ${index}\nderive doubled${index} = count${index} * 2`);
    js.push(`let count${index} = $state(${index});\nlet doubled${index} = $derived(count${index} * 2);`);
    ts.push(`let count${index}: number = $state(${index});\nlet doubled${index}: number = $derived(count${index} * 2);`);
    markup.push(`<output>{doubled${index}}</output>`);
  }
  return { nrs: nrs.join("\n"), js: js.join("\n"), ts: ts.join("\n"), markup: markup.join("") };
}

function legacyScript(source) {
  const lowered = lowerNiralScript(source, "benchmark.niral");
  const declarations = collectDeclarations(lowered);
  const { rest } = hoistImports(lowered);
  return { ...declarations, code: rewriteScript(rest, new Set([...declarations.signals, ...declarations.props])) };
}

const rows = JSON.stringify(Array.from({ length: 1000 }, (_, index) => ({ id: index, text: `Row ${index}`, done: index % 3 === 0 })));
const cases = [
  {
    name: "counter",
    nrs: "state count = 0\nderive doubled = count * 2\nfunction increment() { count += 1 }\nincrement()",
    js: "let count = $state(0);\nlet doubled = $derived(count * 2);\nfunction increment() { count += 1; }\nincrement();",
    ts: "let count: number = $state(0);\nlet doubled: number = $derived(count * 2);\nfunction increment(): void { count += 1; }\nincrement();",
    markup: '<button on:click={increment}>Increase</button><output>{count}/{doubled}</output>',
  },
  { name: "100 state/derive pairs", ...reactiveBindings(100) },
  {
    name: "1000 rows",
    nrs: `state items = ${rows}\nderive total = items.length`,
    js: `let items = $state(${rows});\nlet total = $derived(items.length);`,
    ts: `interface Row { id: number; text: string; done: boolean }\nlet items: Row[] = $state(${rows});\nlet total: number = $derived(items.length);`,
    markup: '<h1>{total}</h1><ul>{#for item of items key item.id}<li class={item.done ? "done" : ""}>{item.id}: {item.text}</li>{/for}</ul>',
  },
];

function variantsFor(fixture) {
  return [
    { name: "NiralScript", source: `<script lang="niralscript">${fixture.nrs}</script>${fixture.markup}` },
    { name: "Niral JS", source: `<script>${fixture.js}</script>${fixture.markup}` },
    { name: "Niral TS", source: `<script lang="ts">${fixture.ts}</script>${fixture.markup}` },
  ];
}

console.log(JSON.stringify({ mode, node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, rounds }));
if (mode === "language") {
  const ts = loadTypescript(fileURLToPath(new URL("../", import.meta.url)));
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, skipLibCheck: true, sourceMap: true, inlineSources: true };
  const numbers = Array.from({ length: 10000 }, (_, index) => index % 100);
  const records = Array.from({ length: 1000 }, (_, index) => ({ price: index % 100, quantity: index % 5 + 1, active: index % 3 === 0 }));
  const words = Array.from({ length: 1000 }, (_, index) => `word${index}`);
  const fixtures = [
    { name: "10000 numbers: sum of squares", type: "number[]", body: "let total = 0; for (const value of values) { total += value * value; } return total;", input: numbers, expected: numbers.reduce((total, value) => total + value * value, 0), edge: [-2, 0, 3], edgeExpected: 13, iterations: 1000 },
    { name: "1000 records: filtered total", type: "{ price: number, quantity: number, active: boolean }[]", body: "let total = 0; for (const value of values) { if (value.active) { total += value.price * value.quantity; } } return total;", input: records, expected: records.filter(value => value.active).reduce((total, value) => total + value.price * value.quantity, 0), edge: [{ price: 3, quantity: 2, active: true }, { price: 50, quantity: 2, active: false }], edgeExpected: 6, iterations: 1000 },
    { name: "1000 strings: uppercase and join", type: "string[]", body: "let result = ''; for (const value of values) { result += value.toUpperCase() + ':'; } return result;", returns: "string", input: words, expected: words.map(value => value.toUpperCase() + ":").join(""), edge: ["ab", "Cd"], edgeExpected: "AB:CD:", iterations: 200 },
    { name: "100 awaits: numeric accumulation", type: "number[]", body: "let total = 0; for (const value of values) { total += await value; } return total;", async: true, input: numbers.slice(0, 100), expected: 4950, edge: [-2, 0, 3], edgeExpected: 1, iterations: 200 },
  ];
  console.log(`JavaScript vs TypeScript ${ts.version} vs NiralScript: identical function bodies and inputs, no component/DOM/reactive operations.`);
  console.log("All execute on the same Node/V8 engine. Imports, instance setup, strict TS validation and assertions are outside runtime timing; function references are extracted once.");
  console.log(`Runtime: ${warmup} warmup calls, ${rounds} rotated rounds, median/p90 batch-average ms per complete function call. Async calls are awaited sequentially.`);
  console.log("Transforms are reported separately: NRS checking+emission+maps vs TS transpileModule+maps (not strict checking); JS needs no transform. Bundled NRS factory/runtime bytes included even though unused by these functions.");
  const results = [];
  for (const fixture of fixtures) {
    const returnType = fixture.returns ?? "number";
    const source = typed => `${fixture.async ? "async " : ""}function run(values${typed ? `: ${fixture.type}` : ""})${typed ? `: ${fixture.async ? `Promise<${returnType}>` : returnType}` : ""} { ${fixture.body} }`;
    const scripts = [source(false) + "\nexport { run };", source(true) + "\nexport { run };", source(true)];
    const filename = fileURLToPath(new URL("language-benchmark.ts", import.meta.url));
    const host = ts.createCompilerHost(compilerOptions);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (path, version, onError, shouldCreateNewSourceFile) => path === filename
      ? ts.createSourceFile(path, scripts[1], version, true)
      : getSourceFile(path, version, onError, shouldCreateNewSourceFile);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], { ...compilerOptions, noEmit: true }, host));
    assert.equal(diagnostics.length, 0, diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
    const transpile = () => {
      const output = ts.transpileModule(scripts[1], { compilerOptions, fileName: "language-benchmark.ts", reportDiagnostics: true });
      assert.equal(output.diagnostics.length, 0);
      return { code: output.outputText, map: output.sourceMapText };
    };
    const compile = () => compileStandalone(scripts[2], "language-benchmark.nrs", { file: "language-benchmark.mjs" });
    const output = [{ code: scripts[0] }, transpile(), compile()];
    const variants = await Promise.all(output.map(async (result, index) => {
      const module = await import("data:text/javascript;base64," + Buffer.from(result.code).toString("base64"));
      return { name: ["JavaScript", "TypeScript", "NiralScript"][index], ...result, run: index === 2 ? module.createInstance().values.run : module.run };
    }));
    const snapshot = structuredClone(fixture.input);
    for (const variant of variants) {
      assert.equal(await variant.run(fixture.input), fixture.expected, `${variant.name}: main output`);
      assert.equal(await variant.run(fixture.edge), fixture.edgeExpected, `${variant.name}: edge output`);
      assert.equal(await variant.run([]), returnType === "string" ? "" : 0, `${variant.name}: empty output`);
      assert.deepEqual(fixture.input, snapshot, `${variant.name}: no input mutation`);
    }
    const consume = value => typeof value === "string" ? value.length : value;
    let timing;
    if (fixture.async) {
      const samples = variants.map(() => []);
      for (let iteration = 0; iteration < warmup; iteration++) {
        for (const variant of variants) sink += consume(await variant.run(fixture.input));
      }
      for (let round = 0; round < rounds; round++) {
        for (let offset = 0; offset < variants.length; offset++) {
          const index = (round + offset) % variants.length;
          const start = performance.now();
          for (let iteration = 0; iteration < fixture.iterations; iteration++) sink += consume(await variants[index].run(fixture.input));
          samples[index].push((performance.now() - start) / fixture.iterations);
        }
      }
      timing = samples.map(summarize);
    } else {
      timing = compare(variants.map(variant => ({ run: () => consume(variant.run(fixture.input)) })), fixture.iterations);
    }
    const transforms = compare([{ run: () => transpile().code.length }, { run: () => compile().code.length }], 20);
    console.log(`\n${fixture.name}: main/edge/empty/nonmutation correctness and TS strict check PASS; ${fixture.iterations} calls per timed batch`);
    console.table(variants.map((variant, index) => ({
      language: variant.name,
      runtimeMedianMs: timing[index].median.toFixed(6),
      runtimeP90Ms: timing[index].p90.toFixed(6),
      transformMedianMs: index ? transforms[index - 1].median.toFixed(4) : "not required",
      transformP90Ms: index ? transforms[index - 1].p90.toFixed(4) : "not required",
      sourceBytes: Buffer.byteLength(scripts[index]),
      moduleBytes: Buffer.byteLength(variant.code),
      gzipBytes: gzipSync(variant.code).length,
    })));
    results.push({ workload: fixture.name, ...Object.fromEntries(variants.map((variant, index) => [variant.name, timing[index].median.toFixed(6)])) });
  }
  assert.ok(sink > 0);
  console.log("\nDirect language execution summary: median milliseconds per complete function call");
  console.table(results);
  console.log(`PASS: four equivalent workloads in three languages. Output consumed: ${sink}. Warm microbenchmarks, not a general language ranking; TS and NRS compile to JavaScript.`);
}
if (mode === "standalone") {
  const ts = loadTypescript(fileURLToPath(new URL("../", import.meta.url)));
  const standaloneOptions = { file: "benchmark.mjs", pureMethods: { array: ["map"] } };
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true, strict: true };
  const transpile = source => {
    const result = ts.transpileModule(source, { compilerOptions, fileName: "benchmark.ts", reportDiagnostics: true });
    assert.equal(result.diagnostics.length, 0);
    return { code: result.outputText, map: result.sourceMapText };
  };
  function reference(collection, typed) {
    const initialType = typed ? (collection ? ": number[]" : ": number") : "";
    const returns = typed ? ": number" : "";
    const state = collection ? "let items = [...initial];" : "let count = initial;";
    const read = collection ? "items[0] + items.length" : "count * 2";
    const update = collection ? "items = [...items].map(value => value + 1);" : "count += 1;";
    return `export function createInstance(inputs${typed ? `: { initial${initialType} }` : ""}) {
      let initial = inputs.initial;
      ${state}
      function increment()${returns} { ${update} return ${read}; }
      function read()${returns} { return ${read}; }
      function reset()${typed ? ": void" : ""} { ${collection ? "items = [...initial]" : "count = initial"}; }
      async function settle(fail${typed ? ": boolean" : ""})${typed ? ": Promise<string>" : ""} {
        try { if (fail) { throw "failed"; } return await "ok"; }
        catch { return "failed"; }
      }
      return { values: { increment, read, reset, settle }, updateInputs(patch${typed ? `: { initial?${initialType} }` : ""}) { initial = patch.initial ?? initial; } };
    }`;
  }
  console.log(`TypeScript ${ts.version}; independent ESM, no Niral runtime. Plain JS reference implements the tested operations directly.`);
  console.log("NRS compile includes checking + emission + maps; TS transpileModule includes emission + maps, NOT type checking. JS needs no source transform.");
  console.log("Runtime imports/compilation and assertions excluded from timing. Fresh instance per batch, 100 writes+reads or 1000 unchanged reads; all return values consumed.");
  console.log("NRS default runtime is pull-based/cached; JS/TS references recompute on reads. Same outputs, different strategies; neither has subscriptions/DOM.");
  console.log("Host policy explicitly trusts native Array.map on literal arrays; array copies and mapping are identical across variants.");
  console.log("Bytes include complete generated module (NRS bundled runtime/glue) but exclude separate maps. No tree shaking/minification or startup/HTTP/paint timing.");
  for (const collection of [false, true]) {
    const name = collection ? "1000-number map + derived length" : "state counter + derived double";
    const initial = collection ? Array.from({ length: 1000 }, (_, index) => index) : 2;
    const nrs = collection
      ? "input initial: number[]\nstate items: number[] = [...initial]\nderive total: number = items.length\nfunction increment(): number { items = [...items].map((value: number): number => value + 1); return items[0] + total }\nfunction read(): number { return items[0] + total }\nfunction reset(): void { items = [...initial] }"
      : "input initial: number\nstate count: number = initial\nderive doubled: number = count * 2\nfunction increment(): number { count += 1; return doubled }\nfunction read(): number { return doubled }\nfunction reset(): void { count = initial }";
    const source = nrs + '\nasync function settle(fail: boolean): Promise<string> { try { if (fail) { throw "failed" } return await "ok" } catch { return "failed" } }';
    const scripts = [source, reference(collection, false), reference(collection, true)];
    const output = [compileStandalone(source, "benchmark.nrs", standaloneOptions), { code: scripts[1] }, transpile(scripts[2])];
    const variants = await Promise.all(output.map(async (result, index) => ({
      name: ["NiralScript", "JavaScript", "TypeScript"][index],
      ...result,
      create: (await import("data:text/javascript;base64," + Buffer.from(result.code).toString("base64"))).createInstance,
    })));
    for (const variant of variants) {
      const first = variant.create({ initial });
      const second = variant.create({ initial });
      assert.equal(first.values.read(), collection ? 1000 : 4);
      assert.equal(first.values.increment(), collection ? 1001 : 6);
      assert.equal(second.values.read(), collection ? 1000 : 4, "instance isolation");
      first.updateInputs({ initial: collection ? [7, 8] : 9 });
      assert.equal(first.values.read(), collection ? 1001 : 6, "inputs do not reset state");
      first.values.reset();
      assert.equal(first.values.read(), collection ? 9 : 18);
      assert.equal(await first.values.settle(false), "ok");
      assert.equal(await first.values.settle(true), "failed");
    }
    function batch(variant, writes) {
      const instance = variant.create({ initial });
      let checksum = 0;
      for (let index = 0; index < (writes ? 100 : 1000); index++) checksum += writes ? instance.values.increment() : instance.values.read();
      return checksum;
    }
    for (const writes of [false, true]) for (const variant of variants) assert.equal(batch(variant, writes), batch(variants[1], writes), "batch output parity");
    const compile = compare([
      { run: () => compileStandalone(source, "benchmark.nrs", standaloneOptions).code.length },
      { run: () => transpile(scripts[2]).code.length },
    ], 20);
    const writes = compare(variants.map(variant => ({ run: () => batch(variant, true) })), collection ? 10 : 100);
    const reads = compare(variants.map(variant => ({ run: () => batch(variant, false) })), 100);
    console.log(`\n${name}: correctness PASS (outputs, input updates, reset, isolated instances, async success/catch)`);
    console.table(variants.map((variant, index) => ({
      language: variant.name,
      sourceBytes: Buffer.byteLength(scripts[index]),
      generatedBytes: Buffer.byteLength(variant.code),
      gzipBytes: gzipSync(variant.code).length,
      mapBytes: variant.map ? Buffer.byteLength(typeof variant.map === "string" ? variant.map : JSON.stringify(variant.map)) : 0,
      transformMedianMs: index === 1 ? "not required" : compile[index === 0 ? 0 : 1].median.toFixed(4),
      transformP90Ms: index === 1 ? "not required" : compile[index === 0 ? 0 : 1].p90.toFixed(4),
      writeBatchMedianMs: writes[index].median.toFixed(4),
      writeBatchP90Ms: writes[index].p90.toFixed(4),
      readBatchMedianMs: reads[index].median.toFixed(4),
      readBatchP90Ms: reads[index].p90.toFixed(4),
    })));
  }
  assert.ok(sink > 0);
  console.log(`Output consumed: ${sink}. TypeScript runs emitted JavaScript; this is not a separate runtime engine comparison.`);
}
if (mode === "compile") {
console.log(JSON.stringify({ warmup, compileIterations: 50, renderIterations: 200 }));
console.log("Warm in-process compilation and string SSR; no file I/O, HTTP, hydration or startup timings.");
console.log("Median/p90 are distributions of batch-average ms/op, not individual request latency.");
console.log("Generated bytes include component DOM/SSR code, exclude shared runtime; gzip uses Node defaults.");
console.log("All variants use Niral; TypeScript compilation is Niral type stripping, not tsc or type checking. NRS semantic checks remain enabled.");

for (const fixture of cases) {
  const options = { filename: "benchmark.niral", runtime };
  const variants = variantsFor(fixture);
  for (const variant of variants) {
    variant.code = compileClient(variant.source, options).code;
    variant.component = (await import("data:text/javascript;base64," + Buffer.from(variant.code).toString("base64"))).default;
    assert.equal(typeof variant.component.__ssr, "function");
    variant.html = renderComponent(variant.component);
    assert.equal(renderComponent((target, props) => variant.component(target, props)), variant.html, `${fixture.name}: DOM/string SSR parity`);
  }
  for (const variant of variants) assert.equal(variant.html, variants[0].html, `${fixture.name}: ${variant.name} language parity`);
  if (fixture.name === "counter") assert.match(variants[0].html, /<output>1\/2<\/output>/);
  if (fixture.name === "1000 rows") assert.equal((variants[0].html.match(/<li\b/g) ?? []).length, 1000);
  const compile = compare(variants.map(variant => ({ run: () => compileClient(variant.source, options).code.length })), 50);
  const render = compare(variants.map(variant => ({ run: () => renderComponent(variant.component).length })), 200);
  console.log(`\n${fixture.name}: correctness PASS; HTML ${Buffer.byteLength(variants[0].html)} bytes`);
  console.table(variants.map((variant, index) => ({
    language: variant.name,
    sourceBytes: Buffer.byteLength(variant.source),
    generatedBytes: Buffer.byteLength(variant.code),
    gzipBytes: gzipSync(variant.code).length,
    compileMedianMs: compile[index].median.toFixed(4),
    compileP90Ms: compile[index].p90.toFixed(4),
    ssrMedianMs: render[index].median.toFixed(4),
    ssrP90Ms: render[index].p90.toFixed(4),
  })));
  console.log(`Compile median NRS/JS: ${(compile[0].median / compile[1].median).toFixed(2)}x; SSR median NRS/JS: ${(render[0].median / render[1].median).toFixed(2)}x`);
  const direct = compileNiralScript(fixture.nrs, options.filename);
  const legacy = legacyScript(fixture.nrs);
  assert.deepEqual(direct, legacy, `${fixture.name}: direct/legacy script output and metadata parity`);
  const backend = compare([
    { run: () => compileNiralScript(fixture.nrs, options.filename).code.length },
    { run: () => legacyScript(fixture.nrs).code.length },
  ], 50);
  console.log("Paired NRS script backends (parse + analysis + emit; legacy also collects/hoists/rewrites; excludes component parsing/templates):");
  console.table(backend.map((timing, index) => ({
    backend: index === 0 ? "Direct AST" : "Via Niral JS",
    medianMs: timing.median.toFixed(4),
    p90Ms: timing.p90.toFixed(4),
  })));
  console.log(`Direct script backend: ${(backend[1].median / backend[0].median).toFixed(2)}x speedup; ${(100 * (1 - backend[0].median / backend[1].median)).toFixed(1)}% less time`);
}
assert.ok(sink > 0);
console.log(`\nOutput consumed: ${sink}. Local microbenchmark only; no cross-framework performance claim.`);
}

if (mode === "types") {
  const ts = loadTypescript(fileURLToPath(new URL("../", import.meta.url)));
  const filename = fileURLToPath(new URL("./__virtual_benchmark__.ts", import.meta.url));
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
  function diagnostics(script) {
    const source = `export {};\ndeclare function $state<T>(value: T): T;\ndeclare function $derived<T>(value: T): T;\n${script}`;
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, version, ...rest) => path === filename
      ? ts.createSourceFile(path, source, version, true)
      : original(path, version, ...rest);
    return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  }
  console.log(`TypeScript ${ts.version}: strict noEmit, skipLibCheck; fresh programs including standard library reads/parsing, no incremental reuse.`);
  console.log("Two warmups, 12 rotated single-program samples per fixture; excludes process startup, component/template compilation and project discovery. Not comparable to script-only NRS checking.");
  const samples = cases.map(() => []);
  for (const fixture of cases) {
    for (let iteration = 0; iteration < 2; iteration++) assert.equal(diagnostics(fixture.ts).length, 0, fixture.name);
  }
  for (let round = 0; round < rounds; round++) {
    for (let offset = 0; offset < cases.length; offset++) {
      const index = (round + offset) % cases.length;
      const start = performance.now();
      const errors = diagnostics(cases[index].ts);
      samples[index].push(performance.now() - start);
      assert.equal(errors.length, 0, cases[index].name);
    }
  }
  console.table(cases.map((fixture, index) => {
    const timing = summarize(samples[index]);
    return { workload: fixture.name, typeCheckMedianMs: timing.median.toFixed(2), p90Ms: timing.p90.toFixed(2) };
  }));
  const probes = [
    { name: "Unresolved identifier", nrs: "state count = missing", js: "let count = $state(missing);", ts: "let count: number = $state(missing);", nrsRejects: true, tsRejects: true },
    { name: "Number assigned a string", nrs: 'state count = 0\ncount = "text"', js: 'let count = $state(0); count = "text";', ts: 'let count: number = $state(0); count = "text";', nrsRejects: false, tsRejects: true },
    { name: "Annotated number assigned a string", nrs: 'state count: number = 0\ncount = "text"', js: 'let count = $state(0); count = "text";', ts: 'let count: number = $state(0); count = "text";', nrsRejects: true, tsRejects: true },
    { name: "Annotated record field mismatch", nrs: 'const record: { name: string } = { name: 1 }', js: 'const record = { name: 1 };', ts: 'const record: { name: string } = { name: 1 };', nrsRejects: true, tsRejects: true },
    { name: "Annotated function argument mismatch", nrs: 'function take(value: number): number { return value }\nconst result = take("bad")', js: 'function take(value) { return value; } const result = take("bad");', ts: 'function take(value: number): number { return value; } const result = take("bad");', nrsRejects: true, tsRejects: true },
    { name: "Annotated async return mismatch", nrs: 'async function take(): Promise<number> { return "bad" }', js: 'async function take() { return "bad"; }', ts: 'async function take(): Promise<number> { return "bad"; }', nrsRejects: true, tsRejects: true },
    { name: "Annotated array mutator argument mismatch", nrs: 'const values: number[] = [1]\nvalues.push("bad")', js: 'const values = [1]; values.push("bad");', ts: 'const values: number[] = [1]; values.push("bad");', nrsRejects: true, tsRejects: true },
    { name: "Optional/nullish typed function", nrs: 'function label(record: { name: string } | null): string { return record?.name ?? "none" }', js: 'function label(record) { return record?.name ?? "none"; }', ts: 'function label(record: { name: string } | null): string { return record?.name ?? "none"; }', nrsRejects: false, tsRejects: false },
    { name: "Impure derived call", nrs: "derive value = Math.random()", js: "let value = $derived(Math.random());", ts: "let value: number = $derived(Math.random());", nrsRejects: true, tsRejects: false },
  ];
  console.table(probes.map(probe => {
    const result = { check: probe.name };
    for (const variant of variantsFor({ ...probe, markup: "" })) {
      let rejected = false;
      try { compileClient(variant.source); }
      catch (error) {
        assert.match(error.code ?? "", /^NIRAL\d+$/);
        rejected = true;
      }
      result[variant.name + " compile"] = rejected ? "rejected" : "accepted";
      if (variant.name === "NiralScript") assert.equal(rejected, probe.nrsRejects, probe.name);
      else assert.equal(rejected, false, probe.name);
    }
    const errors = diagnostics(probe.ts);
    assert.equal(errors.length > 0, probe.tsRejects, probe.name);
    result["TS strict check"] = errors.length ? errors.map(error => `TS${error.code}`).join(", ") : "accepted";
    return result;
  }));
  console.log("PASS: valid typed fixtures and expected diagnostics. Nine probes illustrate differences, including NRS gradual-type limits, not comprehensive language safety rankings.");
}

if (mode === "browser") {
  const { chromium } = createRequire(new URL("../tests/browser/package.json", import.meta.url))("playwright");
  const assets = new Map();
  const runtimeDir = new URL("../src/runtime/", import.meta.url);
  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) assets.set(`/runtime/${entry.name}`, readFileSync(new URL(entry.name, runtimeDir), "utf8"));
  }
  const server = createServer((request, response) => {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      return response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><main id="benchmark"></main></body></html>');
    }
    if (!assets.has(path)) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end(assets.get(path));
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true, "High-resolution timing requires cross-origin isolation");
    console.log(`Chromium ${browser.version()}, 1280x800, headless, cross-origin isolated clock; shared Niral runtime, 5 warmup batches and 12 balanced rounds.`);
    console.log("Hydration excludes module loading and HTML parsing; asserts SSR element reuse. Updates time click dispatch + synchronous DOM mutation, not paint, input latency or Playwright transport.");
    for (const [caseIndex, fixture] of cases.entries()) {
      const interactive = { ...fixture };
      if (caseIndex === 1) {
        const writes = Array.from({ length: 100 }, (_, index) => `count${index} += 1`).join("; ");
        for (const language of ["nrs", "js", "ts"]) interactive[language] += `\nfunction increment()${language === "ts" ? ": void" : ""} { ${writes} }`;
        interactive.markup = '<button on:click={increment}>Increase</button>' + fixture.markup;
      } else if (caseIndex === 2) {
        for (const language of ["nrs", "js", "ts"]) {
          interactive[language] += `\nfunction rename(item${language === "ts" ? ": Row" : ""})${language === "ts" ? ": Row" : ""} { return { id: item.id, text: item.text + "!", done: item.done } }\nfunction increment() { items = items.map(rename) }`;
        }
        interactive.markup = '<button on:click={increment}>Rename</button>' + fixture.markup;
      }
      const variants = variantsFor(interactive);
      for (const [index, variant] of variants.entries()) {
        const options = { filename: "benchmark.niral", runtime };
        const compiled = compileClient(variant.source, options).code;
        const component = (await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"))).default;
        variant.html = renderComponent(component);
        variant.url = `/component-${caseIndex}-${index}.js`;
        assets.set(variant.url, compileClient(variant.source, { ...options, runtime: "/runtime/index.js" }).code);
        assert.equal(variant.html, variants[0].html, fixture.name);
      }
      const result = await page.evaluate(async ({ variants, caseIndex, rounds }) => {
        const runtime = await import("/runtime/index.js");
        const components = await Promise.all(variants.map(async variant => (await import(variant.url)).default));
        const target = document.querySelector("#benchmark");
        function check(condition, message) { if (!condition) throw new Error(message); }
        function verify(clicks) {
          if (caseIndex === 0) check(target.querySelector("output").textContent === `${clicks + 1}/${(clicks + 1) * 2}`, "Counter update mismatch");
          if (caseIndex === 1) {
            const outputs = target.querySelectorAll("output");
            check(outputs.length === 100, "Binding count mismatch");
            outputs.forEach((output, index) => check(output.textContent === String((index + clicks) * 2), "Derived update mismatch"));
          }
          if (caseIndex === 2) {
            const items = target.querySelectorAll("li");
            check(items.length === 1000 && target.querySelector("h1").textContent === "1000", "Row count mismatch");
            items.forEach((item, index) => check(item.textContent === `${index}: Row ${index}${"!".repeat(clicks)}`, "Row update mismatch"));
          }
        }
        function hydrate(index) {
          target.innerHTML = variants[index].html;
          const original = [...target.querySelectorAll("*")];
          runtime._hydrateNext(target);
          const start = performance.now();
          const instance = components[index](target);
          const elapsed = performance.now() - start;
          const hydrated = [...target.querySelectorAll("*")];
          check(original.length === hydrated.length && original.every((node, offset) => node === hydrated[offset]), "Hydration replaced SSR elements");
          verify(0);
          return { instance, elapsed };
        }
        const hydrationIterations = caseIndex === 2 ? 3 : 10;
        const updateIterations = [1000, 50, 10][caseIndex];
        function batch(index) {
          let hydration = 0;
          for (let iteration = 0; iteration < hydrationIterations; iteration++) {
            const { instance, elapsed } = hydrate(index);
            hydration += elapsed;
            instance.destroy();
          }
          const { instance } = hydrate(index);
          const button = target.querySelector("button");
          const start = performance.now();
          for (let iteration = 0; iteration < updateIterations; iteration++) button.click();
          const update = (performance.now() - start) / updateIterations;
          verify(updateIterations);
          instance.destroy();
          check(target.childNodes.length === 0, "Component cleanup left nodes");
          return { hydration: hydration / hydrationIterations, update };
        }
        for (let warmup = 0; warmup < 5; warmup++) for (let index = 0; index < variants.length; index++) batch(index);
        const samples = variants.map(() => ({ hydration: [], update: [] }));
        for (let round = 0; round < rounds; round++) {
          for (let offset = 0; offset < variants.length; offset++) {
            const index = (round + offset) % variants.length;
            const timing = batch(index);
            samples[index].hydration.push(timing.hydration);
            samples[index].update.push(timing.update);
          }
        }
        return { samples, hydrationIterations, updateIterations };
      }, { variants, caseIndex, rounds });
      console.log(`\n${fixture.name}: hydration/update/cleanup parity PASS; ${result.hydrationIterations} hydrations and ${result.updateIterations} updates/batch`);
      console.table(variants.map((variant, index) => {
        const hydration = summarize(result.samples[index].hydration);
        const update = summarize(result.samples[index].update);
        return { language: variant.name, hydrateMedianMs: hydration.median.toFixed(4), hydrateP90Ms: hydration.p90.toFixed(4), updateMedianMs: update.median.toFixed(4), updateP90Ms: update.p90.toFixed(4) };
      }));
      assert.deepEqual(errors, [], "Browser errors or hydration warnings");
    }
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  console.log("PASS: all browser variants. Small sub-millisecond differences are noisy; no cross-framework or end-user latency claim.");
}