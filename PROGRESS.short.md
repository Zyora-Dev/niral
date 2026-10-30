# Niral Progress (current state)

Full history (all entries, unchanged): PROGRESS.md.

## Current branch

`ci/windows-niralscript-20261026` — dirty working tree. No commit/push/deploy without explicit approval.

## Latest verified work

- 2026-11-04: Generic constraints inside bodies, generic arrows and recursive types. A constrained parameter now carries its resolved constraint, so `v.id` on `T extends { id: number }` typechecks and the value is assignable wherever the constraint is expected. `<T>(v: T): T => v` parses with no backtracking (nothing else opens an expression with `<`) and erases for free via `typeAnnotations()`; `async <T>(…) => …` works, and type parameters without an arrow fail NRS071. `resolveType()` keeps a map of aliases under expansion and ties a self-reference to the in-progress shell, so `type Tree = { value: number, next: Tree | null }`, the equivalent interface, arrays and mutual recursion all resolve, while `type Loop = Loop` and `type A = B; type B = A` still fail as circular. `merge`, `accepts`, `substitute` and `describe` were made cycle-safe; recursive types in `contract<T>()` now fail with a precise message. 81 language + 258 framework tests pass, release gate green.
- 2026-11-03: `for...in`, destructuring assignment and `function` expressions — the three constructs the language benchmark actually lacked. `for (const key in record)` binds a `string` key and rejects annotations/patterns (NRS072). Destructuring assignment to existing bindings supports array, object, renamed, nested, member and rest targets; object patterns must be parenthesised (`({ x } = point)`), read-only leaves fail NRS074, reactive `state` cannot be a direct target, and annotated leaves are type-checked against their projection. `function` expressions are named or anonymous, support `async`, generics and annotations; the optional name is scoped to the expression so it can recurse but never leaks, and it cannot be exported. All three emitters; `src/compiler/niralscript.js` pushes function-expression bodies onto `replacements`. 78 language + 258 framework tests pass, release gate green.
- 2026-11-02: Decorators — `@name`, `@name.path`, `@name(args)` on class declarations, methods, getters, setters and static fields, in all three emitters. Desugars to `X = __decorate([...], [...], X, "X")` (`__nrsDecorate` in components); members apply before class decorators, each list bottom-up, descriptors preserved, helper only emitted when used. Rejected on class expressions, `#private`, constructors, static blocks and instance fields (NRS071); derives cannot touch a decorated class (NRS075); a decorated class cannot be read from its own static initializers (NRS074). 77 language + 258 framework tests pass, release gate green.
- 2026-11-01: Top-level await — standalone NiralScript modules may `await` in an entry or linked utility body. `analyzeNiralScript` takes `topLevelAwait` (default off), `checkNiralScript` defaults it on, and `compileNiralScript` returns `topLevelAwait` plus an `export async function createInstance` when it fires. Component `<script lang="niralscript">` keeps synchronous setup and rejects it with NIRAL072; derives still reject await (NRS075). 76 language + 258 framework tests pass, release gate green.
- 2026-10-31: Signal read overhead — cheap derives are now duplicated at their reference sites instead of living in a cell, bounded by `(copies - 1) * cost <= 48`; `CallExpression` emits `(0, expr)(…)` so an inlined member expression in callee position does not gain a receiver. `standalone` read-batch NiralScript-vs-JS: 1.84×→1.51× counter, 1.95×→1.58× 1000-number map. `derived` drops out of the emitted runtime when every derive inlines. 75 language + 258 framework tests pass.
- 2026-10-30: Brand refresh (PNG logo + favicon, purple homepage) and `.xml` MIME fix deployed to production as release `c866fa49ef9c`.
- 2026-10-29: Compile throughput — AST traversal allocation removed from `types.js` (`typeAnnotations`, `walk`) and `analysis.js` (hoisted membership sets); parser records a `typed` flag so untyped modules skip three whole-AST walks (checkTypes guard, annotation erasure, cast collection). `compile` benchmark NiralScript-vs-JS: 3.34×→2.47× counter, 2.81×→1.69× 100 pairs, 6.98×→2.94× 1000 rows. SSR parity held; direct AST backend 1.24–1.28× ahead of legacy. 74 language + 258 framework tests pass.
- 2026-10-29: Output size — conditional runtime factory, conditional input plumbing, data descriptors for const/function/class, and inlined cheap derives in `niralscript/compile.js`. Module bytes ~66% smaller, gzip ~54% smaller. 74 language + 258 framework tests pass.
- 2026-10-28: Class expressions — `const C = class { ... }`, named and anonymous, with extends and generic type parameters. All three emitters. 74 language tests pass.
- 2026-10-28: Generic constraints and defaults — `<T extends Constraint = Default>` on type aliases, interfaces, generic functions and classes. Constraint checked at instantiation and call sites. Defaults applied incrementally. 73 language tests pass.
- 2026-10-28: Interfaces — `interface X<T> extends Y {}`. Parser, type scope, extends merging, cross-module `import type`, both emitters erase. 72 language tests pass.
- 2026-10-28: `as` / `satisfies` casts — erased at runtime, `satisfies` checked at compile time. All three emitters. 71 language tests pass.
- 2026-10-27: Runtime contracts — `contract<Type>(value)` in standalone, direct and legacy emitters. 85 nonbrowser tests pass / 1 intentional browser skip (all 70 language tests); framework 258 pass with real `NIRAL_TSC`. Local only.
- 2026-10-27: JS / TS / NiralScript and Modal language benchmarks recorded (`bench/niralscript*.json`).
- 2026-10-26: NiralScript classes, expansion, editor + playground, real VS Code host verified; playground deployed to production.
- 2026-10-25: Security deployment of `f0ccd99` to EC2 (release `85a914d39113`), verified healthy.

## Next (requested, not started)

NiralScript features, in order:
7. Broader coverage (`new.target`, re-exports, labels, `do…while`, `for await…of`, assignment in value position)

Keep all three emitters in parity (niralscript/compile.js, src/compiler/niralscript.js direct + legacy). Add tests to tests/niralscript.js; update LSP/grammar, NIRALSCRIPT.md and the docs page.

## Test commands

- `node --test tests/niralscript.js`
- `npm run test:release`
- `NIRAL_TSC="$PWD/.niral/lib/typescript/typescript.js" npm test`
- `npm run prepare:docs` before docs dev/build
