# NiralScript v0.1 Design Draft

Status: proposed language contract, 2026-10-25. This is not a released language
specification or a claim that the examples below compile today.

## Identity

NiralScript is an independent, compiler-first frontend language. Its extension
is `.nrs`. Niral is its first framework integration; future framework targets
must preserve the language's observable behavior.

`.niral` remains Niral's component format, owning its template, styles, server
block and framework metadata. `.nrs` is not a renamed `.niral` file. Existing
JavaScript, TypeScript, JSX and TSX support remains available.

The goal is simpler authoring with explicit semantics and efficient generated
code. Shorter syntax alone does not establish a performance improvement.

## Implemented Baseline

The current experiment accepts top-level `input`, `state` and `derive`, ordinary `let`
and `const`, named functions, blocks, `if`/`else`, assignments, calls and `return`
inside `<script lang="niralscript">`. Expressions and statements pass through
the independent parser and lexical analyzer before the direct Niral runtime emitter.

The first compiler milestone is implemented: `parseNiralScript()` returns a
target-neutral declaration/statement AST; `analyzeNiralScript()` resolves names
and checks binding access; `emitNiralScript()` checks and emits Niral code.
`lowerNiralScript()` composes those stages for existing callers. The program
stores its source and filename. Declaration, identifier and initializer spans
use zero-based UTF-16 offsets with exclusive ends, relative to that source.
Initializers are parsed expression trees. The root initializer retains `raw`
and its original span including surrounding trivia for compatible emission;
child spans identify their expression tokens. Comments and whitespace between
declarations are retained through source spans; emission does not mutate the AST.

The component compiler now uses `compileNiralScript()` in the Niral adapter. It
returns final runtime script code and `signals`/`writable`/`props` sets from the
analyzed bindings, emitting signal creation, reads and writes directly. This skips
intermediate rune text, JavaScript declaration discovery, import hoisting and
script token rewriting. Source slices preserve expression syntax and trivia;
resolved reference spans drive the edits. Component parsing, template-expression
rewriting and all language semantic checks still run. The returned component AST
retains the original script text rather than replacing it with lowered JavaScript.
`emitNiralScript()` and `lowerNiralScript()` retain their rune-emitting behavior.

The language core now lives in root-level `niralscript/`, a private,
zero-dependency ES module package. `parser.js`, `expressions.js`, `analysis.js`, `modules.js`,
`scanner.js` and `errors.js`
operate without the Niral framework. `src/compiler/niralscript.js` remains the
Niral adapter: it emits runtime code (or runes for compatibility) and maps language `NRS` diagnostic codes to the
existing `NIRAL` codes, preserving source spans. The existing framework parser
entry point remains compatible. Niral build hashes include the language core.
Tests verify parsing from an isolated copy of this directory as well as the
integrated compiler. This is source organization, not a published package.

External `.nrs` instance scripts and named utility-module imports/exports work in
Niral dev/build/SSR. Standalone checking/compilation APIs and CLI commands, source
maps and gradual type annotations are implemented locally. Dedicated `.nrs`
support is implemented in the source VS Code extension and shared LSP.
Component diagnostics link to imported source errors. Niral is
the only current framework adapter; independent ESM output is also available.
React/Next.js and other framework integrations are future work.

### Editor and Browser Playground

The source extension adds `.nrs` highlighting, standalone compiler diagnostics,
declared-signature hover, keyword/top-level completions and local/imported
definitions. Existing imported files use unsaved editor contents, with project,
private-path and symlink guards. Configure explicit host names through
`niral.niralscriptGlobals`; opt into stricter unknown/null checking with
`niral.niralscriptStrictTypes` and reload the window. Type aliases, including
imported generic aliases, have hover, completion and definition support.
Hover/navigation require valid source; incomplete
source receives keywords only. An updated extension package is not published.
See `editors/vscode/README.md` for development-host setup.

The docs application's `/niralscript#playground` contains a single-file playground.
It compiles the actual language core locally, without submitting source to a
server. It instantiates the result, calls an exported `main()` when present,
awaits its result and prints non-undefined results. The explicit `print(...)`
host function writes text to Output. Inputs, imports, DOM APIs and external host
services are not exposed by this playground.

Before developing or building the docs application, run from the repository root:

```sh
npm run prepare:docs
node bin/niral.js dev apps/docs -p 5199
```

Preparation copies an allowlisted set of the original compiler modules into
ignored browser assets and generates the sandbox script JSON used by its endpoint.
Run preparation again after changing compiler or sandbox source, and before
`node bin/niral.js build apps/docs`. Generated assets ship in the docs release;
there is no runtime package dependency or handwritten compiler copy.

Compilation runs in a module worker. Execution runs in a classic worker inside
an opaque-origin, scripts-only sandbox iframe; generated JavaScript is imported
as an ES module. Endpoint-specific CSP blocks network access and dynamic eval,
and the opaque origin prevents access to the site's storage. Framework-wide
security headers are unchanged. Stop, reruns and unmount dispose active workers
and frames. Compilation/execution have two-second limits after initialization;
source/output size limits bound ordinary use. This is browser isolation, not an
OS process sandbox or a hard memory quota: intentionally memory-exhausting code
can still destabilize a browser. Chromium is the currently verified browser.

### Implemented Expression Subset

- Decimal numbers (including fractions and exponents), single/double-quoted
  strings, booleans and null. Parsing is syntax-only; identifier references are
  resolved by the separate analyzer. Strings support ordinary JavaScript escapes,
  hexadecimal and Unicode escapes; legacy numeric escapes are rejected.
- Arrays without holes; plain objects with identifier/string/number keys,
  explicit values or identifier shorthand. Array/object spreads and trailing
  commas are accepted, as is call-argument spread.
- Concise and braced arrows with lexical parameters: `value => value * 2` or
  `(left, right) => { return left + right }`. Unary/binary arrow operands and
  immediately invoked block arrows require parentheses.
- Member/index access, positional calls, `new Constructor(args)`, parentheses, and untagged template
  strings with recursively parsed interpolations.
- Optional member/index/call access uses `?.name`, `?.[key]` and `?.(args)`.
  Native short-circuiting skips keys/arguments and preserves method receivers;
  parentheses end a continuous chain. Optional chains cannot be assignment targets.
- Precedence, tightest first: member/index/call, unary `! + - await typeof`, `* / %`, `+ -`,
  `< <= > >= instanceof`, `=== !==`, `&&`, `||`/`??`, then conditional `?:`. Binary operators
  associate left; unary operators and conditional alternatives associate right.
  Mixing `??` with `&&`/`||` requires parentheses. `typeof` does not bypass name
  resolution: undeclared names remain errors.
- Unsupported syntax fails with source-spanned NRS071 (mapped to NIRAL071 in
  components). Assignment/update expressions, bitwise/exponent operators,
  loose equality, regex literals, nondecimal and legacy leading-zero
  numbers are not accepted.

### Compiler-Generated Runtime Contracts

`contract<Type>(value)` is an explicit checked-data boundary, not a cast. The
compiler resolves the type and generates ordinary JavaScript checks without a
schema library or runtime dependency. It evaluates the argument once, returns
a value statically typed as `Type`, or throws before returning a value.

```niralscript
type Order = { quantity: number, note?: string }

export function readOrder(candidate: unknown): Order {
  return contract<Order>(candidate)
}

const accepted = readOrder({ quantity: 2 })
```

- Supported: strings, booleans, finite numbers, string/number/boolean literals,
  null, undefined, arrays, plain records, unions and resolved aliases, including
  imported aliases and generic aliases with concrete arguments.
- No coercion or defaults. `"2"` is not a number; NaN and infinities fail.
- Records and arrays are copied recursively. Record extras, including symbol
  keys, fail. Only own data properties are accepted; record fields and array indices
  backed by accessors are
  rejected without invoking their getters. Records must have the current realm's
  `Object.prototype` or a null prototype. Returned records have ordinary prototypes.
- Missing fields validate as undefined. An optional field or a field whose type
  includes undefined accepts absence; absent fields stay absent. Sparse array
  slots likewise validate as undefined. Non-index array properties are ignored
  and are not copied. Copies do not preserve reference identity or shared aliases.
- Failures are `TypeError` instances named `NiralContractError`, with `code: "NRS081"`,
  `path` (for example `$.rows[0].quantity`) and `expected`. Rejected values are not
  included in messages; field names appear in paths. One failure is reported,
  not an aggregate. Unions try branches in declaration order and retain the longest
  reported path when none passes.
- Unknown, void, classes, function signatures, promises, recursive aliases and
  unresolved generic parameters cannot be runtime schemas. Unsupported contract
  types fail at compile time with NRS080 (NIRAL080 in components).
- Generated schemas are limited to 64 nesting levels and 1024 type nodes;
  evaluation permits 10000 validator visits, including union attempts. Arrays
  longer than 10000 are rejected before element traversal. These are traversal
  limits, not a hard memory quota or protection against hostile proxies.
- Contracts require an unshadowed `globalThis` and trusted standard intrinsics.
  Local declarations named `Object`, `Number`, etc. cannot replace the helpers.
  This is data validation, not a sandbox for arbitrary host objects or proxies.

Use a contract before handing external data to business logic, or after awaiting
a host call. A client-side contract is not a server security boundary. Standalone
generated ESM can also run on the server: export a guard from a private project
module and load it with Niral's `projectImport("./lib/guards.server.js")` ambient.
The Niral RPC dispatcher maps thrown contract failures to HTTP 400 and its existing
field-error response. Raw `.nrs` imports in JavaScript server blocks are not added.

Ordinary annotations remain erased, including `input` annotations. A contract in
a `const` initializer runs once; it does not validate subsequent `updateInputs()`
calls. Validate an entire patch before applying it when atomic host updates are
required. Catching a failure does not undo argument evaluation or earlier effects.
Contracts do not guarantee integer ranges, nonempty strings or business rules;
check those separately after the structural guard. Existing static-checking
limitations for dynamic methods and escaping aliases still apply.

### Classes and Constructors

Named classes emit native JavaScript classes in standalone ESM and both Niral
component backends. Classes can be exported/imported, used as annotation types,
and imported with `import type` without creating a value binding.

```niralscript
class Box<T> {
  value: T;
  constructor(value: T) { this.value = value }
  read(): T { return this.value }
}
class Counter extends Box<number> {
  #step: number = 1;
  add(): number { this.value += this.#step; return this.read() }
}
const counter = new Counter(2)
const result: number = counter.add()
const isBox: boolean = counter instanceof Box
```

- Public/private fields and methods, getters/setters, async methods, static
  fields/methods/blocks, literal computed names and generic members are supported.
  Constructor parameters accept types, defaults, destructuring and final rest.
  An omitted derived constructor forwards arguments to the specialized base
  constructor. `extends Base<T>` preserves inherited member/constructor contracts.
- `this` and `super` use native receivers; arrows retain lexical receivers and
  ordinary nested functions do not. `super()` initializes a derived instance.
  Construction is also permitted as a statement, and `instanceof` emits a native
  prototype-chain check. Optional-chain construction is rejected.
- Constructor flow checks require exactly one `super()` on each normally
  completing derived path before `this` or a super-member access. Conditional
  branches and early returns are tracked; throws terminate a path. Constructors
  may return `this` or nothing, not replacement objects. `super()` inside loops,
  try/catch/finally, parameter defaults or nested functions is not supported.
  Static blocks cannot return or await. Private names remain lexically restricted.
- Types check known constructor/method arguments, fields, accessor writes and
  return values, including generic inheritance and nested instance types.
  Readonly input provenance, derived effects and eager initialization checks
  follow known constructors, fields and methods. This is gradual checking, not
  full type soundness, definite-field-initialization or override validation.
- Methods can read/write top-level reactive state. Class fields themselves are
  ordinary JavaScript properties, not automatic signals. Native receiver rules
  still apply to detached methods. Dynamic aliases and unknown host classes are
  outside the complete static-checking guarantees.
- Class expressions/anonymous classes, arbitrary computed names, complex base
  expressions, `new.target`, decorators, abstract classes, `implements`, and
  TypeScript visibility/readonly/parameter-property modifiers are not supported.
  Use `#name` for native private members. This is not full JS/TS class parity.

### Implemented Statements and Scopes

- `let`/`const` require one binding and initializer per declaration. Bindings may
  be identifiers or nested static object/array patterns, including renamed object
  properties, nested defaults, array holes and final identifier rest bindings.
  Initializers and defaults evaluate left-to-right; computed pattern keys remain
  unsupported. `state`
  and `derive` remain restricted to component top level. `input name` declares a
  read-only, same-name external input at component top level, without an initializer.
- Named functions and arrows accept identifiers or nested binding patterns and close over lexical bindings.
  Nested functions, recursion and block shadowing are supported; parameters are
  mutable. Default parameters and a final identifier rest parameter are supported.
  Duplicate parameters and same-scope declarations are rejected.
- `if (expression) { ... }`, optional braced `else` or `else if`, ordinary blocks,
  call/construction statements, and function-only `return` with an optional expression.
- `for (const item of items) { ... }` and `let` variants accept the same patterns.
  Loop bindings are local to each iteration; the body must be braced.
  Conventional `for (let index = 0; index < limit; index++) { ... }` and
  `while (condition) { ... }` support `break` and `continue`, preserving finally
  completion and per-iteration let closure capture. For headers allow omitted
  parts, one initialized declaration or a simple statement; comma lists are not
  supported. Labels, do-while and async iteration remain unsupported.
- Assignment statements accept identifier/member targets and `= += -= *= /= %=`.
  Prefix/postfix `++` and `--` work as statements or for-header statements,
  including reactive state writes. Assignment/update expressions used as values,
  destructuring assignments and anonymous `function` expressions remain unsupported.
- Semicolons, closing blocks or newlines outside expression delimiters end simple
  statements, including newlines in comments. A bare return ends at that newline.
  Emission inserts explicit terminators rather than relying on JavaScript ASI.
- `analyzeNiralScript(program, { globals, moduleGlobals, reserved, pureGlobals, pureMethods })` is target-neutral and has
  no implicit globals. It returns binding/reference information without mutating
  the AST. Niral supplies an explicit ambient allowlist and server RPC names;
  `load` is not an RPC and RPC names cannot be redeclared at component top level.
- Unresolved names, direct eager reads before initialization, and writes to
  `const`, function, input or derived bindings are diagnosed. Direct input/derived-property
  writes are also rejected; `const` objects remain mutable. Statement syntax uses
  NRS072, name resolution NRS073, invalid binding access NRS074 (mapped to NIRAL
  codes with original component spans). Declaration errors retain NRS070.
- The Niral adapter uses resolved scopes for nested binding renames and signal
  access, preserving shadowing and object shorthand keys without a script rewrite.

### Implemented Callbacks and Collections

```html
<script lang="niralscript">
  state items = [{ id: 1, text: "First" }]
  derive labels = items.map(({ text }) => text).join(", ")
  const add = text => {
    const { length: id } = items
    items = [...items, { id, text }]
  }
  function length() {
    let total = 0
    for (const { text } of items) { total += text.length }
    return total
  }
  derive letters = length()
</script>
<p>{labels}: {letters}</p>
```

Niral approves `map`, `filter`, `find`, `findIndex`, `some`, `every`, `forEach`
and `reduce` on statically established arrays. Their callbacks participate in
derived-effect, dependency-cycle, initialization and readonly checks, including
block bodies. A helper may invoke a callback parameter only when all tracked
sources resolve to one statically known function. Different callback identities
merged at one invoked parameter are rejected conservatively.

Destructured bindings, iteration elements, callback parameters, callback returns,
reducer accumulators and spreads preserve tracked readonly origins. Spreads are
shallow: copying an input does not grant permission to mutate its tracked nested
values. The analysis can conservatively reject writes to the copy itself too.
Unknown receiver kinds do not receive derived-method approval; `[...items]`
establishes an array for collection operations on an input. The independent core
has no implicit array-method policy; these approvals belong to the Niral adapter.

### Implemented Async and Error Handling

```html
<server>
  export async function ping() { return "pong"; }
</server>
<script lang="niralscript">
  state pending = false
  state reply = ""
  state failure = ""
  const request = async () => {
    pending = true
    failure = ""
    try {
      reply = await ping()
    } catch (error) {
      failure = error.message
    } finally {
      pending = false
    }
  }
</script>
<button disabled={pending} on:click={request}>Ping</button>
<p>{reply}</p>
<p>{failure}</p>
```

- Named `async function` declarations and concise/block async arrows use native
  promise semantics in the Niral target. Both can be exported from utility modules.
  `await` is an expression or statement inside an async body; nested synchronous
  functions reset that context. No top-level await, generators or async iteration.
  Async headers cannot split `async` from `function`/parameters across a newline;
  arrow parameters and `=>` must also share a line. `async` remains a contextual
  identifier, not a globally reserved name.
- `try { ... }` requires a braced `catch`, `finally`, or both. Catch accepts an
  identifier, supported object/array binding pattern, or no binding. Its bindings
  do not escape the catch. Finally executes on return and throw; a finally return
  or throw overrides the preceding completion. Returning a rejecting promise
  without awaiting it does not enter the local catch.
- `throw expression` requires its operand on the same line. Niral exposes
  `Error(...)`, usable with or without `new`.
  Awaited server RPC failures use the existing RPC rejection/error sanitization,
  with no change to the server boundary or transport.
- Derived evaluation must stay synchronous: async calls (including approved
  collection callbacks), await and explicit throw are rejected with NRS075.
  Effects, dependencies and initialization checks traverse all try/catch/finally
  branches, even branches that may never execute. Initialization does not assume
  that suspension makes later declarations safe to read.
- Await preserves tracked readonly and method-override origins. Catch bindings
  conservatively merge explicit thrown values across the linked program, including
  known argument/return aliases and async rejections caused by explicit throw.
  This can reject a mutation in an unrelated catch; it is not path-sensitive
  exception analysis. Unknown host promise returns/rejections and escaping
  callbacks remain outside the bounded analysis. Nested object mutation still
  requires replacing the state binding to trigger reactivity.

### Implemented Inputs and Niral Server Data

`input name` is a target-neutral declaration of externally supplied data. The
language core does not know about Niral props, routing or server loaders. The
Niral adapter maps each declaration to the same-named component prop, including
existing route parameters and the values returned by a page's `load()` function:

```html
<server>
  export function load() { return { title: "Server title" }; }
</server>
<script lang="niralscript">
  input title
  state draft = title
  derive label = title + "!"
</script>
<h1>{label}</h1>
<input bind:value={draft} />
```

- Inputs work in inline and external instance scripts, not imported library
  modules. Each declaration takes one identifier, terminated by a newline or
  semicolon. Optional type annotations are supported; defaults, aliases and
  destructuring are not.
- A missing input is `undefined`; explicit `null` remains `null`. Declare inputs
  before eager reads, including reads through called helpers.
- Parent prop changes update input reads and derived values without remounting
  the child. `state draft = title` takes an initial snapshot once per instance;
  later parent updates do not reset that state. Ordinary `let`/`const` initializers
  also run once, rather than becoming implicitly derived.
- Input bindings and tracked aliases are read-only. Direct/property writes,
  tracked named-function returned-alias writes, and unproven method calls are
  rejected. Bind editable controls to local state, not an input or its property.
  The direct Niral emitter exposes get-only handles, without forwarded setters.
- This uses the existing server/client boundary: only return browser-safe data
  explicitly from `load()`. Inputs do not expose server variables or environment
  values, nor add a new serialization format. Server code stays server-only.
- Existing bounded-analysis limits still apply: template handlers remain Niral
  JavaScript, and arbitrary host objects, getters and escaping closures are not
  a general deep-readonly guarantee. No deep-reactive input mutation is added.

### Implemented Static Semantic Checks

- Derived evaluation follows named functions, arrows, approved collection callbacks
  and statically resolved callback forwarding. Local
  let/parameter reassignment is allowed; captured writes, object writes and
  unapproved calls fail NRS075. Global and method approvals belong to the target.
- Niral approves deterministic numeric intrinsics and a bounded set of array/string
  methods. Array methods: slice, concat, includes, indexOf, lastIndexOf, join, at,
  map, filter, find, findIndex, some, every, forEach and reduce.
  String methods additionally include substring, startsWith, endsWith, trim,
  trimStart, trimEnd, toLowerCase, toUpperCase, charAt, charCodeAt and split.
  Reassignment sources must agree on receiver kind; detected property overrides
  invalidate method approval. Randomness, time, fetch and RPC are not approved.
- Derived dependencies include reads inside called helpers. Direct, mutual and
  helper-mediated cycles fail NRS076. Initializers are eager: dependencies must
  already be initialized. Named-call reads of later root bindings fail NRS074.
  Calls also check captured locals against active enclosing-function positions,
  including nested forwarding calls and top-level block bindings.
- Readonly origin tracking follows binding assignments, known-call arguments and
  known-function returns, including const function aliases and recursive paths.
  Method-override detection also follows returned aliases. Return analysis skips
  nested function/arrow definitions and conservatively merges sources across calls.
  Derived/global aliases cannot be property-assignment targets. Unapproved methods
  on derived aliases are rejected. Niral also rejects references to the server-only
  process global, including aliases and computed access, with NIRAL044.

These are conservative static checks, not a general sound purity guarantee for
arbitrary host objects, getters, coercions or callbacks. Unknown host-call returns
and escaping closures remain outside the tracked higher-order subset. Niral's
runtime detects dynamic cycles when a derived read closes a dependency cycle;
SSR throws and the browser uses the existing runtime error reporting path.
Dependencies are refreshed on recomputation so conditional cycles can recover.
Host implementations of approved intrinsics are
trusted. Nested state-object mutation is not deep-reactive; replace the whole
binding to notify dependents. Template
handlers remain ordinary Niral/JavaScript, outside this script analyzer. Parsing
does not guarantee arbitrary expressions work on other targets.

## Proposed Core

Start with these constructs, without introducing a new markup syntax:

| Construct | Meaning |
| --- | --- |
| `const name = expression` | Ordinary binding that cannot be reassigned |
| `let name = expression` | Ordinary mutable, nonreactive binding |
| `state name = expression` | Mutable reactive binding |
| `derive name = expression` | Read-only computed reactive binding |
| `function name(parameters) { statements }` | Named function with lexical scope |
| `import { name } from "./utility.nrs"` | Named import from a pure utility module |
| `export function ...` / `export const ...` | Named utility-module exports |

The first parser should support literals (strings, numbers, booleans, null),
arrays, plain objects, identifiers, member/index access, calls, parentheses,
arithmetic, strict equality, comparison and boolean operators. Statements start
with declarations, assignment, calls, `if`/`else` and `return`. Functions accept
positional identifier parameters. Assignment and compound assignment are
statements, not expressions in this initial subset.

Use JavaScript-compatible value/operator behavior for this subset. Define
operator precedence explicitly in the parser; do not evaluate raw source or
silently accept arbitrary JavaScript as NiralScript. Do not coerce the language
into a collection of textual keyword replacements.

Declarations and simple statements end at a semicolon, closing block or newline
outside expression delimiters. Continue multiline expressions inside `()`, `[]`
or `{}`; a trailing operator alone does not continue a statement. Support `//`
and `/* ... */` comments. Precise lexical rules and the supported operator list
must be finalized alongside parser tests before declaring v0.1 stable.

## Reactive Contract

- Component state belongs to one component instance. Two instances must not
  share state merely because they use the same `.nrs` source.
- State initializers run once per instance, not on each rendered update.
- Assigning state updates its value immediately. A subsequent read in the same
  function sees that value. View updates may be batched.
- Derived bindings are pure and read-only. They track reactive values read
  during evaluation, including conditional dependencies. A read after a
  dependency write must observe the recomputed value.
- Derived evaluation must not write state or perform external side effects.
  Writes to derived bindings are compile errors; detectable cycles are
  diagnosed, and dynamic cycles must fail clearly rather than hang.
- Reactivity is binding-level in v0.1. Replace an array/object to notify its
  dependents. Nested mutation is not implicitly deep-reactive.
- Ordinary `let` bindings are not reactive; changes do not independently
  schedule view updates. `const` prevents rebinding, not object mutation.
- Functions close over their instance's live bindings, not a stale snapshot.
- Subscription cleanup follows component disposal. Server renders must not
  retain subscriptions or share component state between requests.

Browser/server ambient APIs belong to target integration, not the portable
language core. SSR/hydration support requires deterministic initial values or
explicitly serialized server data; time/random/browser-only initializers are
not automatically hydration-safe.

## First Niral Integration

Implemented external instance script syntax:

```html
<script lang="niralscript" src="./counter.nrs"></script>

<button on:click={increment}>Increase</button>
<output>{count} / {doubled}</output>
```

The associated `.nrs` source contains:

```text
state count = 0
derive doubled = count * 2

function increment() {
  count += 1
}
```

The external script is the component's instance body, not an eagerly evaluated
singleton module. Its top-level bindings are visible to that component's
template, matching embedded script scope. No exports are needed for that use.
A script that specifies both `src` and non-whitespace inline code is rejected.

Explicit relative `.nrs` paths resolve against the containing source file.
Resolution stays inside the application root and rejects private paths, symlinks,
missing files, URLs, queries, encoded paths and extension inference (NIRAL077).
The compiler API requires `root` and `filename` for external scripts; dev/build
supply them. `renderRoute(file, props, { root })` supports the same boundary.

Dev reloads pages when `.nrs` files change, appear or disappear. SSR caches compare
external source contents, including child-component dependencies; state remains
per instance. Builds hash external paths/bytes and exclude raw `.nrs` files from
static assets. Failed source compilation leaves the active release unchanged.
The component LSP supplies the project root and links external diagnostics to the
actual file/range. Dedicated `.nrs` document tooling uses the same checker.

### Named Modules

An inline or external instance script can import named bindings:

```text
import { twice, initial as start } from "./math.nrs"
state count = start
derive doubled = twice(count)
```

The corresponding `math.nrs` library contains:

```text
export const initial = 0
export function twice(value) { return value * 2 }
```

Library top levels permit imports, constants, functions and type aliases. Local names stay
private unless the declaration is exported; aliases do not expose other module
bindings. Imports are readonly bindings (constant objects are not deeply frozen).
Default/namespace imports, bare side-effect imports, re-exports, cyclic graphs and
exported mutable/reactive declarations are rejected with NRS078/NIRAL078.

Dependencies initialize before their importer and are deduplicated within that
component graph. All library initialization runs per component execution, including
SSR, not once per process as a native ES module singleton. Constant initializers
can call functions; libraries are not automatically pure. Calls made by a derived
value still undergo the existing purity and eager-initialization checks across
module boundaries. Library modules cannot access component RPC globals or state.

`linkNiralScript(program, resolveModule)` is independent of Niral and the filesystem.
Its resolver receives `(specifier, importerFilename, location)` and returns
`{ filename, source }`, with a stable canonical filename for deduplication. The
linked graph is passed to the analyzer/emitter without mutating the parsed AST.
Original file/span diagnostics are preserved. Niral's adapter supplies guarded
project-relative resolution and forwards all transitive source bytes to SSR cache
validation and release hashing. Imported file edits also trigger dev reloads.

Raw `.nrs` sources are not publicly served or copied into production static assets
(case-insensitive privacy rule). Existing `<server>` exclusion and RPC boundaries
remain intact. External diagnostics retain the actual file, source and span.
The same guards apply transitively; `.server.nrs` files cannot be client sources.

## Gradual Type Annotations

```text
input record: { name: string, count?: number } | null
state count: number = 0
const values: (number | string)[] = [1, "two"]
const twice = (value: number): number => value * 2
async function read(value: number): Promise<number> { return await value }
derive label: string = record?.name ?? "Missing"
```

Supported types are `number`, `string`, `boolean`, `null`, `undefined`, `void`,
`unknown`, postfix arrays, unions, parenthesized types, structural records with
comma-separated identifier fields (optionally `?`) and `Promise<T>`. Annotations
can appear on inputs/state/derive, ordinary declarations (including patterns),
named/arrow parameters and returns. Typed arrow parameters require parentheses.
Async return annotations require `Promise<T>`. Annotations are erased by both
emitters; the checker is independent of TypeScript and adds no runtime dependencies.

The shared semantic pipeline checks known annotated initializers, writes,
structural fields, named/arrow arguments, arity and return paths. Destructuring
projects field/element types; imports preserve annotated signatures. Invalid
contracts report NRS080 (NIRAL080 in components) at original source locations.
Missing returns are checked conservatively across branches and try/finally.

Statically named `push`, `unshift`, `splice` and `fill` calls on known typed
array receivers check every inserted value against the element contract.
`splice` and `fill` also check numeric positions and required arguments; optional
positions accept `undefined`, and `fill` accepts at most three arguments. Simple
aliases, record fields, annotated parameters/returns and literal bracket method
names retain these checks. Array unions must satisfy every array member's
contract. Unannotated arrays remain dynamic even beside other typed declarations.

String, number and boolean literal types, reusable `type` aliases and explicit
`import type { Name } from "./types.nrs"` are supported. Aliases are module-scoped,
can be exported and are erased from runtime output. Named functions and aliases
can declare type parameters, with explicit or inferred call arguments:

```text
type Box<T> = { value: T }
function identity<T>(value: T): T { return value }
function apply<T, U>(value: T, callback: (value: T) => U): U {
  return callback(value)
}
const box: Box<number> = { value: identity<number>(2) }
const label = apply(box.value, value => "Value: " + value)
```

Function signatures support optional/rest parameters. Known call signatures and
supported collection methods supply contextual callback parameter/result types.
Nested binding defaults and object/array rest project their types. Literal array
spreads are checked positionally; dynamic spreads into typed functions require a
rest parameter after all fixed arguments. Generic inference covers basic nested
arrays, records, promises and callbacks, not all union or recursive cases.

Branches narrow `typeof`, equality, null and discriminated unions, including
early-return guards. Calls/writes invalidate relevant facts; loops conservatively
discard facts across backedges. Assignment contracts use the declared type, not
only the current narrowed read type.

Checking remains gradual by default. Use `{ strictTypes: true }` in the checking,
standalone compile or component adapter API, `--strict` with standalone CLI
check/compile, or the reload-required `niral.niralscriptStrictTypes` editor setting
to require narrowing unknown and nullable values before typed use/property access.
This is not runtime validation or a sound replacement for TypeScript. Unannotated
host globals, server results and complex methods remain unknown; input annotations
do not validate supplied values. Interfaces, casts, generic arrows, constrained or
defaulted type parameters and recursive aliases are unsupported. Function variance,
generic inference and general collection-method checks remain bounded.
Dynamic method selection and
detached methods are not covered by the array checks. Inferred unannotated values
can change dynamically; escaping aliases and unknown host calls remain outside
static guarantees. Type annotations do not grant derived-method approval or
weaken readonly/effect/initialization checks. There is no runtime type coercion.

## Standalone Checking

Run the `check` command from this repository; no global installation is needed:

```sh
node niralscript/cli.js --help
node niralscript/cli.js check counter.nrs --root /path/to/project
node niralscript/cli.js check counter.nrs math.nrs --root /path/to/project --json
node niralscript/cli.js check counter.nrs --root /path/to/project --strict
```

The private language package also declares an `nrs` executable. It is not a
published npm release. The entire `niralscript/` directory works independently
of Niral, using Node >=22 and no runtime dependencies.

Entry paths are relative to `--root`, which defaults to the working directory.
Imports must use explicit relative `.nrs` paths inside that root; missing files,
non-regular files, descendant symlinks and escapes are rejected. The explicitly
selected root is canonicalized. No directory scanning, package resolution,
extension inference, source execution or JavaScript emission occurs. Entries use
instance-script rules; imported dependencies use the existing library restrictions.

The CLI has no implicit browser, JavaScript or Niral globals. Repeated
`--global name` options declare host-provided names in entries and libraries, but
do not assert that calls to them are pure. Unknown effects reached from `derive`
remain errors. Standalone success does not validate runtime host values or satisfy
Niral's client/server security policy. The checker can inspect private
source directories; it does not serve files or replace Niral's guarded loader.

Text errors include the original filename, one-based line/column and `NRS` code.
`--json` writes `{ ok, entries, diagnostics }` to stdout, with each diagnostic's
code, message, filename, zero-based `start`/exclusive `end`, line and column.
Checking reports the first error per entry graph and continues with other entries.
Exit status is 0 for success, 1 for source/file errors and 2 for invalid arguments.
Usage errors are written to stderr even when `--json` is supplied.

`niralscript/check` exports `checkNiralScript(source, filename, options)`, returning
`{ program, analysis }` or throwing the existing `NiralScriptError`. The package
root's parser exports remain unchanged. Options accept the linker's `resolveModule`
and the analyzer's explicit `globals`, `moduleGlobals`, `reserved`, `pureGlobals`
and `pureMethods` policies, plus opt-in `strictTypes`. The API performs no filesystem access or execution;
hosts supply resolution and policy. The CLI is a Node filesystem adapter to this
same parser/linker/analyzer, not a second implementation of language checks.

## Standalone Compilation

```sh
node niralscript/cli.js compile counter.nrs --root /path/to/project --out counter.mjs
node --enable-source-maps consumer.mjs
```

`compile` takes exactly one entry and an explicit `.mjs` output. It shares the
checker's root/import/global rules and never executes source while compiling.
It emits the entry and linked utility graph together, without framework imports,
plus `counter.mjs.map`. Parent directories must already exist inside the root,
without descendant symlinks. Both artifacts use exclusive creation: existing
files are refused, not replaced. Choose another output name for a later build.
Output errors report NRS079. There is no watch mode or automatic cleanup of old
builds. Filesystem checks assume a trusted workspace, not a hostile race sandbox.

```js
import { createInstance } from "./counter.mjs";
const counter = createInstance({ initial: 2 });
counter.values.increment();
console.log(counter.values.count);
counter.updateInputs({ initial: 8 });
```

The generated module exports `createInstance(inputs = {}, globals = {}, runtime?)`.
Each call executes utility/entry initializers afresh and owns isolated state.
`values` exposes entry bindings and imported aliases as enumerable getters;
only state bindings have setters. Inputs are read-only through `values` and
updated by name through `updateInputs`; unknown patch keys are ignored. Updating
inputs does not rerun ordinary initializers or reset state snapshots. Object
mutation is shallow and does not notify; replace a state binding to invalidate it.
Explicitly permitted host globals are supplied in the second argument, including
functions. No implicit browser, Node or Niral globals are injected.

The default dependency-free runtime caches derived values until a state/input
assignment changes the instance revision (`Object.is`). Derived values evaluate
on reads, detect recursive dependency cycles and retry after failed evaluation.
This is pull-based, with coarse instance-wide invalidation, no subscriptions and
no DOM rendering. A host may inject `signal(initial) -> { get, set }` and
`derived(compute) -> { get }` as the third argument to connect its own reactive
system; immediate reads, isolation and cycle handling are then the host's duty.

`niralscript/compile` exports `compileNiralScript(source, filename, options)` and
returns `{ code, map }`. It shares checking/resolution policies; `options.file`
names the generated file in the map (default `entry.mjs`). The API neither reads
nor writes files. Its version-3 source map includes every original source and
`sourcesContent`, with token/statement mappings and UTF-16 columns. The CLI makes
source paths relative to output and appends the sourceMappingURL. Generated
runtime/glue is not source-mapped. Imported exception stacks are verified with
Node's `--enable-source-maps`; maps do not rename generated bindings. These are
standalone-output maps, not a replacement for Niral component/devtools mapping.
Source maps contain source text: do not publish them where source must be private.

## Compiler Structure

```text
.nrs source -> tokens -> AST -> module graph -> semantic checks -> target emitter
                      |
                    Niral integration
```

Use the same language frontend for embedded and external scripts. AST nodes
carry original source spans and describe language concepts rather than Niral
runes or React hooks. Only the target emitter chooses reactive runtime calls.
Implement with Node built-ins and repository-owned code, without runtime
dependencies.

A future React target must preserve immediate reads, instance isolation and
derived semantics; replacing every assignment with a React setter is not
sufficient. Next.js additionally needs build integration and client/server
boundary handling. Neither target is part of the first milestone.

## Implementation Sequence and Acceptance

1. Completed locally: source-spanned declaration AST and separate Niral emitter.
  Eight focused checks pass, including exact lowering, AST spans/immutability
  and existing compiler/SSR behavior. Main framework suite: 255 passed. This
  establishes the stage boundary, not complete parsing or semantic analysis.
2. Implemented locally: expressions/statements, functions/scopes and the bounded
  static semantic checks above. Twenty language tests pass, including isolated
  core loading, readonly aliases, cycles, source security/diagnostics and SSR.
3. Implemented locally: external instance scripts, secure resolution, source
  privacy, SSR invalidation and build identity. Six release/build tests pass.
  Named utility-module imports/exports and transitive dependency tracking are now
  implemented. Twenty-six language tests cover module scopes, source diagnostics,
  privacy, initialization, purity and loading the core without the framework.
4. Chromium passes for inline/external dev and production scripts: SSR/hydration,
  state, input binding, keyed lists, derived values and RPC. External-edit reload
  and refreshed SSR pass; repeated SSR instances retain independent state.
  Multi-file components pass the same dev/production checks, including browser
  reload and refreshed SSR after editing a transitive dependency.
5. The full local `npm run test:release` gate passed on 2026-10-25, including
  framework regressions, all browser/form checks and temporary offline installer
  smoke tests. Windows CI was not run. No publication or deployment occurred.
6. The standard local release gate passed again on 2026-10-26 with named modules,
  transitive dependency reloads and the independent linker included. No new runtime
  dependencies, publication or deployment. Windows CI and optional extended gates
  were not run for this milestone.

7. Standalone checking API and CLI implemented locally on 2026-10-26. All 28
  language tests pass, including a copied-package CLI with source/file errors,
  explicit globals, JSON output, exit codes and no framework or source execution.
  Both package exports, all 6 release/build checks and the full standard local
  release gate pass, including browser/forms and offline installer flows.
  Windows CI and optional extended gates were not run. Nothing published/deployed.

8. Semantic safeguards extended locally on 2026-10-26: named-function returned
  aliases, captured-local initialization checks and Niral runtime derived-cycle
  detection with conditional recovery. All 28 language tests, 257 framework tests
  and the full standard local release gate pass, including browser/forms and both
  offline installer flows. Cross-module diagnostic locations are preserved.
  The bounded-analysis limitations above still apply. Windows/extended gates were
  not run; nothing published or deployed.

9. Props/server-data inputs implemented locally on 2026-10-26. All 30 language
  tests pass, including input initialization, readonly aliases, reactive updates,
  instance isolation and DOM/string SSR parity. Focused Chromium checks pass for
  server-loaded inputs and for parent updates preserving child DOM/local state,
  plus route parameters in dev/production. Full standard local release gate passes:
  258 framework tests, 45 language/editor/docs checks, 13 browser checks, forms and
  both offline installer flows. Windows CI and optional Postgres/image gates have
  not been rerun for these local changes. Nothing published or deployed.

10. Callbacks/collections implemented locally on 2026-10-26. All 35 language tests
  pass: concise/block arrows, nested binding patterns, array/object spread,
  braced for-of, checked array callbacks and uniquely resolved callback forwarding.
  Direct/legacy emission, SSR parity, imported arrows, readonly provenance,
  initialization, effects and cycles are covered. The full standard local release
  gate passes, including framework regressions, all 50 language/editor/docs checks,
  13 Chromium checks, forms and both offline installer flows. Collection workflows
  pass in inline/external/module scripts in dev/production. Windows CI and optional
  Postgres/image gates were not rerun. Nothing published or deployed.

11. Async/error handling implemented locally on 2026-10-26. All 38 language tests
  pass: named/exported async functions, async arrows, await, try/catch/finally and
  throw. Direct/legacy completion, imported rejection, scope and diagnostic spans,
  derived effects/cycles and awaited/thrown readonly origins are covered. Real RPC
  pending/success/server-rejection/finally/recovery passes for inline/external/module
  scripts in dev/production. The full standard local release gate passes: 258
  framework tests, 53 language/editor/docs checks, 13 Chromium checks, four form
  variants and both offline installer flows. Windows CI and optional Postgres/image
  gates were not rerun. Nothing published or deployed.

12. Standalone compilation/maps and gradual types/conveniences completed locally
  on 2026-10-26. All 42 language checks pass, including independent copied-package
  CLI compilation, original imported exception stacks, isolated instances and
  injected runtime behavior. Typed scripts, optional/nullish/typeof expressions
  and async RPC pass in inline/external/module dev/production browser workflows.
  Full standard release gate passes: 258 framework tests, 57 language/editor/docs
  checks, 13 Chromium checks, four form variants and both offline installer flows.
  Fresh component LSP validation passes. The type/runtime limits documented above
  remain intentional; Windows CI and optional Postgres/image gates were not run.
  Nothing published or deployed.

Watch commands, async iteration/generators, effects,
regex literals, component-valued modules, a new view syntax and other
framework targets are deferred. Input defaults/destructuring remain future work.
Dedicated editor support is implemented in the source extension; publication is
separate. Current expansion verification is recorded in `PROGRESS.md`; older
browser/hosted results above do not verify subsequent changes.
