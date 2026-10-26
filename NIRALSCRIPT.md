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

The current experiment accepts top-level `state` and `derive`, ordinary `let`
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
Niral dev/build/SSR. A standalone checking API and check-only CLI are implemented
locally. Dedicated `.nrs` editor/type-checker support remains deferred.
Component diagnostics link to imported source errors. Niral is
the only current target. React/Next.js and other integrations are future work.

### Implemented Expression Subset

- Decimal numbers (including fractions and exponents), single/double-quoted
  strings, booleans and null. Parsing is syntax-only; identifier references are
  resolved by the separate analyzer. Strings support ordinary JavaScript escapes,
  hexadecimal and Unicode escapes; legacy numeric escapes are rejected.
- Arrays without holes/spreads; plain objects with identifier/string/number
  keys, explicit values or identifier shorthand. Trailing commas are accepted.
- Member/index access, positional calls, parentheses, and untagged template
  strings with recursively parsed interpolations.
- Precedence, tightest first: member/index/call, unary `! + -`, `* / %`, `+ -`,
  `< <= > >=`, `=== !==`, `&&`, `||`, then conditional `?:`. Binary operators
  associate left; unary operators and conditional alternatives associate right.
- Unsupported syntax fails with source-spanned NRS071 (mapped to NIRAL071 in
  components). Assignment/update expressions, arrows, spreads, optional chaining,
  nullish/bitwise/exponent operators, loose equality, regex literals, `new`,
  `await`, `typeof`, nondecimal and legacy leading-zero numbers are not accepted.

### Implemented Statements and Scopes

- `let`/`const` require one identifier and initializer per declaration. `state`
  and `derive` remain restricted to component top level.
- Named functions accept identifier parameters and close over lexical bindings.
  Nested functions, recursion and block shadowing are supported; parameters are
  mutable. Duplicate parameters and same-scope declarations are rejected.
- `if (expression) { ... }`, optional braced `else` or `else if`, ordinary blocks,
  call statements, and function-only `return` with an optional expression.
- Assignment statements accept identifier/member targets and `= += -= *= /= %=`.
  Updates, assignment expressions, loops, destructuring, default/rest parameters
  and anonymous functions remain unsupported.
- Semicolons, closing blocks or newlines outside expression delimiters end simple
  statements, including newlines in comments. A bare return ends at that newline.
  Emission inserts explicit terminators rather than relying on JavaScript ASI.
- `analyzeNiralScript(program, { globals, moduleGlobals, reserved, pureGlobals, pureMethods })` is target-neutral and has
  no implicit globals. It returns binding/reference information without mutating
  the AST. Niral supplies an explicit ambient allowlist and server RPC names;
  `load` is not an RPC and RPC names cannot be redeclared at component top level.
- Unresolved names, direct eager reads before initialization, and writes to
  `const`, function or derived bindings are diagnosed. Direct derived-property
  writes are also rejected; `const` objects remain mutable. Statement syntax uses
  NRS072, name resolution NRS073, invalid binding access NRS074 (mapped to NIRAL
  codes with original component spans). Declaration errors retain NRS070.
- The Niral adapter uses resolved scopes for nested binding renames and signal
  access, preserving shadowing and object shorthand keys without a script rewrite.

### Implemented Static Semantic Checks

- Derived evaluation follows named functions and const function aliases. Local
  let/parameter reassignment is allowed; captured writes, object writes and
  unapproved calls fail NRS075. Global and method approvals belong to the target.
- Niral approves deterministic numeric intrinsics and a bounded set of array/string
  methods. Array methods: slice, concat, includes, indexOf, lastIndexOf, join, at.
  String methods additionally include substring, startsWith, endsWith, trim,
  trimStart, trimEnd, toLowerCase, toUpperCase, charAt, charCodeAt and split.
  Reassignment sources must agree on receiver kind; detected property overrides
  invalidate method approval. Randomness, time, fetch and RPC are not approved.
- Derived dependencies include reads inside called helpers. Direct, mutual and
  helper-mediated cycles fail NRS076. Initializers are eager: dependencies must
  already be initialized. Named-call reads of later root bindings fail NRS074.
  Calls also check captured locals against active enclosing-function positions,
  including nested forwarding calls and top-level block bindings.
- Readonly origin tracking follows binding assignments, named-call arguments and
  named-function returns, including const function aliases and recursive paths.
  Method-override detection also follows returned aliases. Return analysis skips
  nested function declarations and conservatively merges sources across calls.
  Derived/global aliases cannot be property-assignment targets. Unapproved methods
  on derived aliases are rejected. Niral also rejects references to the server-only
  process global, including aliases and computed access, with NIRAL044.

These are conservative static checks, not a general sound purity guarantee for
arbitrary host objects, getters, coercions or callbacks. Unknown host-call returns
and escaping/higher-order closure initialization paths are not tracked. Niral's
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
actual file/range. Dedicated `.nrs` document tooling remains deferred.

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

Library top levels permit imports, constants and functions only. Local names stay
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

## Standalone Checking

Run the check-only CLI from this repository; no global installation is needed:

```sh
node niralscript/cli.js --help
node niralscript/cli.js check counter.nrs --root /path/to/project
node niralscript/cli.js check counter.nrs math.nrs --root /path/to/project --json
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
remain errors. Standalone success does not prove type correctness or satisfy
Niral's client/server security policy. This check-only tool can inspect private
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
and `pureMethods` policies. The API performs no filesystem access or execution;
hosts supply resolution and policy. The CLI is a Node filesystem adapter to this
same parser/linker/analyzer, not a second implementation of language checks.

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

Standalone compilation/watch commands, type annotations, async language constructs, effects,
classes, regex literals, component-valued modules, a new view syntax and other
framework targets are deferred. Props/server-data syntax and source-map/editor
integration need separate design before being advertised as supported.
