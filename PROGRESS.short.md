# Niral Progress (current state)

Full history (all entries, unchanged): PROGRESS.md.

## Current branch

`ci/windows-niralscript-20261026` — dirty working tree. No commit/push/deploy without explicit approval.

## Latest verified work

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
5. Top-level await
6. Decorators
7. Broader coverage (`new.target`, recursive aliases, re-exports)

Keep all three emitters in parity (niralscript/compile.js, src/compiler/niralscript.js direct + legacy). Add tests to tests/niralscript.js; update LSP/grammar, NIRALSCRIPT.md and the docs page.

## Test commands

- `node --test tests/niralscript.js`
- `npm run test:release`
- `NIRAL_TSC="$PWD/.niral/lib/typescript/typescript.js" npm test`
- `npm run prepare:docs` before docs dev/build
