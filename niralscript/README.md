# NiralScript

**Explicit state. Checked semantics. Ordinary JavaScript.**

[![npm](https://img.shields.io/npm/v/niralscript)](https://www.npmjs.com/package/niralscript)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-43853d)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

NiralScript is an independent, compiler-first language for `.nrs` files. Its own
parser, semantic analyzer, type checker and module linker compile reactive source
into standalone JavaScript ES modules. The compiler has **zero dependencies**;
generated modules include only the reactive primitives they need.

[Documentation](https://niral.site/docs/niralscript) |
[Language Reference](https://github.com/Zyora-Dev/niralscript/blob/main/NIRALSCRIPT.md) |
[npm Package](https://www.npmjs.com/package/niralscript) |
[Issues](https://github.com/Zyora-Dev/niralscript/issues)

> NiralScript is experimental. Version 0.1 is not a promise of language stability,
> full JavaScript/TypeScript compatibility, or a universal performance advantage.

## Install

Requires **Node.js 22 or newer**. Install the compiler as development tooling:

```sh
npm install --save-dev niralscript
npx nrs --help
```

Without adding it to a project:

```sh
npx --package niralscript nrs --help
```

The package is named `niralscript`; its executable is named `nrs`.
Using `npx nrs` without first installing NiralScript can resolve a different npm
package. Use the explicit `--package niralscript` form for one-off commands.

## Your First Module

Create `counter.nrs`:

```text
input initial: number
state count: number = initial
derive doubled: number = count * 2

export function increment(): number {
  count += 1
  return doubled
}
```

Check it and compile it:

```sh
npx nrs check counter.nrs --strict
npx nrs compile counter.nrs --strict --out counter.mjs
```

Compilation produces `counter.mjs` and `counter.mjs.map`. Create `consumer.mjs`:

```js
import { createInstance } from "./counter.mjs";

const counter = createInstance({ initial: 2 });
console.log(counter.values.count);       // 2
console.log(counter.values.increment()); // 6
console.log(counter.values.count);       // 3

const another = createInstance({ initial: 10 });
console.log(another.values.count);       // 10: an independent instance
```

```sh
node --enable-source-maps consumer.mjs
```

No Niral application or separately installed reactive runtime is required.

## CLI Reference

```text
nrs check <file.nrs>... [--root <directory>] [--global <name>] [--strict] [--json]
nrs compile <file.nrs> --out <file.mjs> [--root <directory>] [--global <name>] [--strict] [--json]
```

| Command / option | Behavior |
| --- | --- |
| `check` | Check one or more entries and their relative imports without executing or emitting code. |
| `compile` | Compile exactly one entry and its imported module graph into an ESM instance factory and source map. |
| `--root <directory>` | Existing project root; entries and output paths are relative to it. Defaults to the current directory. |
| `--out <file.mjs>` | Required for compile. Output parents must already exist inside the root. |
| `--strict` | Require narrowing of unknown and nullable values before typed use. |
| `--global <name>` | Explicitly allow a host identifier; repeat for multiple names. Does not provide its runtime value. |
| `--json` | Emit structured results with `ok`, entry count and diagnostics. |
| `--help`, `-h` | Show usage; also supported after `check` or `compile`. |
| `--` | Treat the remaining arguments as entry paths. |

Exit codes: **0** success, **1** source/file errors, **2** invalid arguments.
The CLI rejects source paths outside the root and symlinked source paths. Imports
must be explicit relative `.nrs` paths. Existing output files are **never
overwritten**; use a new name or deliberately remove your previous generated
artifacts. There is no watch mode or `nrs build` command.

```sh
npx nrs check src/app.nrs src/worker.nrs --strict --json
npx nrs compile src/app.nrs --out dist/app.mjs --global print
```

The second example requires an existing `dist` directory and a host-provided
`print` function when the generated instance is created.

## Language Capabilities

| Area | Implemented capabilities |
| --- | --- |
| Reactive declarations | Top-level `input`, `state`, `derive`; readonly inputs and derived bindings; immediate state reads. |
| Functions and control flow | Named/anonymous functions, arrows, defaults/rest, spread, destructuring, conditionals, for/of/in, while, break and continue. |
| Async and errors | Async functions/arrows, await, throw, try/catch/finally; top-level await in standalone modules. |
| Gradual types | Primitives, literals, unions, records, arrays, aliases, interfaces, casts, signatures, generics, constraints/defaults, recursive types and opt-in strict narrowing. |
| Classes | Typed constructors, generic inheritance, private members, accessors, static blocks, class expressions and a documented decorator subset. |
| Modules | Named exports, explicit relative `.nrs` imports, type-only imports, isolated module scopes and original-source diagnostics. |
| Runtime contracts | Explicit `contract<Type>(value)` expressions emit validators for supported finite-data types. |
| Output | Standalone ESM, version-3 source maps and embedded reactive primitives. |

Ordinary type annotations are erased; they do not validate external data.

```text
type Order = { quantity: number, note?: string }

export function readOrder(candidate: unknown): Order {
  return contract<Order>(candidate)
}
```

An explicit contract copies valid data and throws **NRS081** with a field path on
invalid data. It does not coerce values or add business rules. Recursive, class,
function, promise and unknown schemas cannot become runtime contracts.

## Compiler APIs

```js
import { parseNiralScript } from "niralscript";
import { checkNiralScript } from "niralscript/check";
import { compileNiralScript } from "niralscript/compile";

const source = "state count: number = 1\nderive doubled = count * 2";
const program = parseNiralScript(source, "counter.nrs");
checkNiralScript(source, "counter.nrs", { strictTypes: true });
const { code, map, topLevelAwait } = compileNiralScript(source, "counter.nrs", {
  strictTypes: true,
  file: "counter.mjs",
});
```

These APIs do not read/write files or execute source. `map` contains original
source text; do not expose source maps publicly when your source is private.
The parser entry also exports `analyzeNiralScript` and `NiralScriptError`.

For imports, provide `resolveModule(specifier, importer, location)` returning
`{ filename, source }`. Hosts own filesystem resolution and policy. `globals`
explicitly permits host identifiers; supply their actual values at runtime.
See the language reference for the complete analyzer policy options.

## Generated Runtime

```js
const instance = createInstance({ initial: 2 }, { print: console.log });
instance.values.increment();
instance.updateInputs({ initial: 8 });
```

- Each instance initializes its own state and imported module graph.
- `values` exposes entry bindings; state is writable, while inputs and derives are readonly.
- `updateInputs` updates known inputs without resetting state or rerunning ordinary initializers.
- The default runtime is pull-based: derives are evaluated on reads, with instance-wide revision invalidation where caching is needed. Simple derives may be inlined by the compiler.
- Object/array reactivity is shallow. Replace a binding to invalidate dependent values; nested mutation is not automatically reactive.
- There are no default subscriptions or DOM rendering. Host globals are never injected implicitly.
- Top-level await makes `createInstance` asynchronous; await it before reading `values`.

A host can pass a compatible runtime as the third argument:
`createInstance(inputs, globals, runtime)`. It must provide
`signal(initial) -> { get, set }` and `derived(compute) -> { get }` and preserve
immediate reads, instance isolation and cycle safety. This is an integration
interface, not a finished React or Next.js adapter.

## Niral and Other Frameworks

**Niral is the first implemented adapter.** It connects `.nrs` source to Niral's
component compiler, server/client boundaries and fine-grained runtime. `.niral`
remains the framework's component format; `.nrs` is the language's source format.
Niral vendors the compiler to retain its own zero-dependency guarantee.

React, Next.js and other framework adapters are **future work**, not included in
this package. Standalone compilation works independently of any framework.

The published [Niral VS Code extension](https://marketplace.visualstudio.com/items?itemName=zyoralabs.niral-vscode)
supports `.nrs` highlighting, snippets, diagnostics, hover, completions and
definitions. Language-server features currently require `niral lsp`; the
standalone npm compiler does not include its own language server.

## Source and Verification

This repository is the standalone source of record. The Niral workspace keeps a
vendored copy; compiler changes must be synchronized deliberately.
The framework-hosted suite currently contains 81 language tests plus 258
framework tests, verified on 6 November 2026. A real npm tarball installation
also passed API, CLI, generated runtime, isolation, input-update, source-map and
error-path checks. These are verification results, not a stability guarantee.

```sh
node niralscript/cli.js --help
node --test tests/niralscript.js
```

These source test commands are run from the **Niral framework repository**;
the standalone checkout does not yet contain that framework-dependent suite.

## License

The **NiralScript compiler is Apache-2.0**, with a **Runtime Library Exception**.
The exception permits emitted runtime code and compiled output to be used and
distributed under terms of your choosing without compiler-license attribution
requirements for those emitted portions. It does not relicense the compiler.

See [LICENSE](LICENSE) for the full terms. The **Niral framework is separately
MIT-licensed**; that does not make NiralScript MIT-licensed.

Built by [ZyoraLabs](https://github.com/Zyora-Dev).