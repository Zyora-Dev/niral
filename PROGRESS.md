# Niral Progress

## 2026-10-26: NiralScript Semantic Safeguards (Verified Local)

- Named-function returns now participate in readonly-alias tracking and method
  override detection, including const function aliases, nested calls and recursive
  return paths. Nested function declarations are excluded from an enclosing
  function's return values; fresh mutable object returns remain writable.
- Captured local initialization checks now use active enclosing-function call
  positions, including nested forwarding calls and top-level blocks. Calls after
  initialization remain valid. All 28 language tests and editor diagnostics pass.
  Return analysis remains conservative and merges
  parameter sources across calls; arbitrary host calls are not analyzed.
- Niral's shared reactive runtime now detects self/mutual derived dependency
  cycles on reads, before the generic scheduling limit. Conditional recovery
  passes; 257 framework tests pass and runtime diagnostics are clean. Browser
  reporting/server throwing continue through the existing error handler.
- Cross-module diagnostic locations and logical returned aliases pass. Full
  standard `npm run test:release` passes, including language/framework/editor/docs,
  browser/forms and both offline installer scaffold/build/test flows. Whitespace
  and diagnostics clean. Windows CI and optional extended gates were not run.
- This completes the first bounded safeguard milestone, not a general soundness
  proof: unknown host calls and escaping/higher-order closures remain outside
  analysis. Next feature: props/server-data support. No publication, deployment
  or Git commit/push; pre-existing local changes preserved.

## 2026-10-26: Standalone NiralScript Checking (Verified Local)

- Added target-neutral `checkNiralScript(source, filename, options)` through the
  private language package's `./check` export. It composes the existing parser,
  module linker and analyzer without framework imports or implicit host globals.
- Added executable `niralscript/cli.js check` (`nrs` in the private package), with
  explicit entry files, canonical root, guarded relative imports, repeated host
  globals, text/JSON diagnostics and exit statuses 0/1/2. No source execution,
  output generation, dependencies or automatic discovery. Private sources may be
  checked; Niral client/server security validation remains the adapter's job.
- All 28 language tests pass, including a copied-package CLI without the framework,
  source-located transitive errors, cycles, missing/non-regular files, path escapes,
  symlinks, argument handling, explicit globals and non-execution. Executable help
  and editor diagnostics pass. Both package exports work in isolation; all 6
  release/build checks pass, including new core-file hashes. Full standard
  `npm run test:release` passes: framework/language/editor/docs regressions,
  browser/forms and both offline installer scaffold/build/test flows. Windows CI
  and optional extended gates were not run. README/design/local website source
  updated; whitespace checks clean.
- Dedicated editor support remains a subsequent step. No publication, deployment,
  commit or push.

## 2026-10-26: NiralScript Named Modules (Verified Local)

- Named imports/aliases and exported constants/functions now link through an
  independent dependency graph. Modules retain separate lexical scopes;
  readonly, derived-purity and source-located diagnostics cross import boundaries.
- Guarded relative .nrs imports work in inline/external components. Private,
  server-only, symlink and out-of-root files are rejected. Transitive source
  changes/deletions invalidate SSR; release hashes cover dependency bytes and the
  linker itself. Raw .nrs files remain private. No runtime dependencies added.
- 26 language tests, 6 release tests and 2 focused Chromium tests pass. Multi-file
  dev/production SSR, hydration, template aliases, state, bindings, lists and RPC
  verified. Transitive browser reload, isolated-core module linking, import
  terminators, eager module reads and RPC isolation also pass. Documentation
  updated. Full standard `npm run test:release` gate passes: framework regressions,
  language/editor/docs checks, full Chromium/forms coverage and both temporary
  offline installer scaffold/build/test flows. Editor diagnostics and whitespace
  checks clean. Windows CI and optional extended gates were not run for this task.
- Default/wildcard imports, re-exports, cycles and exported mutable/reactive
  declarations are rejected. Library top levels allow imports, constants and
  functions only, instantiated once per component execution, not global singletons.
- Niral remains the only integrated target. No standalone language CLI, dedicated
  .nrs editor or Next.js adapter added. Existing JS/TS/JSX/TSX support preserved.
  No production changes, publication, commit or push.

## 2026-10-26: Post-Optimization Three-Language Comparison (Local)

- Reran the unchanged benchmark sequentially in compile, browser and types modes;
  all assertions pass. Apple M1, macOS arm64, Node25.6.1, 12 balanced rounds.
  Compile/SSR use 30 warmups and 50/200 operations per batch. Median ms below;
  TS compile means Niral annotation stripping plus compilation, NOT tsc or type
  checking. NRS semantic checks remain enabled. No source/runtime changes.

| Workload | JS Compile | TS Strip + Compile | NRS Compile | JS SSR | TS SSR | NRS SSR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Counter | .0222 | .0316 | .0433 | .0008 | .0008 | .0008 |
| 100 pairs | .5930 | 6.4454 | .8371 | .0401 | .0406 | .0398 |
| 1,000 rows | 1.4071 | 5.4329 | 2.8518 | .0969 | .0966 | .0974 |

- Compile p90 JS/TS/NRS ms: .0281/.0362/.0632, .6319/6.6372/.9775,
  1.4535/5.6267/3.1712. Batch-average distributions, not individual request latency.
  JS remains fastest. NRS takes 1.41-2.03x JS time; Niral TS pipeline takes about
  7.7x/1.9x NRS time for 100 pairs/1,000 rows. Not a general TS compiler ranking.
- Exact cross-language HTML, DOM/string SSR and direct/legacy NRS backend parity
  pass. Generated raw/gzip sizes unchanged from earlier tables (shared runtime
  excluded). Paired direct/legacy script median ms: .0149/.0216, .3488/.4907,
  2.2254/3.0381. Both backends use the optimized tokenizer.
- Chromium151.0.7922.34, headless 1280x800, isolated high-resolution clock,
  five warmup batches, 12 balanced rounds. SSR element reuse, all updates and
  destroy cleanup pass. Hydration excludes HTML parsing/module loading; updates
  include click dispatch and synchronous DOM mutation, not paint/input latency.

| Workload | JS Hydrate / Update ms | TS Hydrate / Update ms | NRS Hydrate / Update ms |
| --- | ---: | ---: | ---: |
| Counter | .0030 / .0011 | .0033 / .0012 | .0037 / .0011 |
| 100 pairs | .0815 / .0539 | .0878 / .0540 | .0728 / .0525 |
| 1,000 rows | .9175 / .7553 | .8800 / .7515 | .8908 / .7585 |

- No consistent SSR/browser winner; sub-millisecond differences are noisy.
  Separate TS5.7.3 strict/noEmit/skipLibCheck fresh-program median/p90 ms:
  87.40/109.01, 90.83/122.73, 157.70/196.00. Includes standard-library reads/parsing,
  excludes startup and incremental reuse; not comparable to NRS script-only checks.
- Diagnostic probes pass: unresolved name rejected by NRS and TS strict check;
  number/string assignment only by TS strict check; impure derived Math.random
  only by NRS. JS/TS compile alone accepts all three. NRS does not provide TS's
  general type checking. These probes are not a comprehensive safety assessment.
- Benchmark-only rerun; compiler/full release gate passed in the preceding
  tokenizer checkpoint and was not rerun here. No dependencies, production,
  publication, preview-server, commit or push changes.

## 2026-10-26: NiralScript Tokenizer Optimization (Local)

- Profiled the 1,000-row script before editing: expression peek and scanner read
  together accounted for about 32% of sampled self time. Separate stage medians:
  parse 1.9463 ms, analysis of a reused parsed AST 1.0229 ms, full script 2.6657 ms.
  Stage runs have different allocation/JIT conditions and are not additive.
- Expression tokenization now dispatches by first character: punctuation skips
  regex scanning, numbers and identifiers only try their own matcher, and ASCII
  trivia avoids generic whitespace/comment probes. Unicode whitespace, maximal
  operators, string decoding and source spans remain supported. All semantic
  passes retained; no caching, AST mutation, runtime or dependency changes.
- Fresh before/after runs of the unchanged bench/niralscript.js on Apple M1,
  Node25.6.1; 30 warmups, 12 rotated batches, 50 compilations per batch. Median ms:

| Workload | NRS Before | NRS After | JS Before / After |
| --- | ---: | ---: | ---: |
| Counter | 0.0376 | 0.0401 | 0.0237 / 0.0210 |
| 100 state/derive pairs | 0.8569 | 0.8417 | 0.5899 / 0.5917 |
| 1,000 rows | 3.8726 | 2.8851 | 1.3988 / 1.4004 |

- About 25.5% less full compile time on the data-heavy fixture; smaller fixtures
  show little/no clear gain, including a slower counter median. Separate-run
  microbenchmarks, not a universal speed guarantee. Post-change NRS compile p90:
  .0527/.9614/3.1873 ms. Script-only direct medians before/after:
  .0148/.0156, .3620/.3483, 2.8741/2.2260 ms. Generated raw/gzip bytes unchanged;
  exact language SSR, DOM/string SSR and direct/legacy backend parity pass.
- Verification: 23 language tests pass, including token values, maximal operators,
  Unicode trivia, escapes, lookahead identity and error spans. Build/release
  integration tests and the full standard local release gate pass, including
  browser/forms checks and both packaged installer scaffold/build/test flows.
  Editor diagnostics and whitespace checks clean. No production, commit or push.

## 2026-10-26: JavaScript / TypeScript / NiralScript Comparison (Local)

- Extended the existing bench/niralscript.js, without compiler/runtime changes or
  dependencies. Three equivalent fixtures now have explicit TypeScript annotations;
  rotations cover all three ordering positions evenly in 12 rounds. Median for an
  even sample count averages the middle two values. Commands: default/compile,
  browser, types. Existing direct/legacy NRS backend assertions remain enabled.
- Apple M1, macOS arm64, Node25.6.1. Compile/SSR: 30 warmups, 50 compile and 200
  render calls per batch. Timings below are final warmed batch-average medians in
  milliseconds, excluding file I/O, process startup and module imports. All
  languages use Niral; TS means Niral's annotation stripper, NOT tsc transpilation
  or type checking. NRS semantic checks stay enabled. Workload order throughout:
  counter, 100 state/derive pairs, 1,000 inline-data rows.

| Workload | JS Compile | TS Strip + Compile | NRS Compile | JS SSR | TS SSR | NRS SSR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Counter | 0.0211 | 0.0313 | 0.0401 | 0.0010 | 0.0008 | 0.0009 |
| 100 pairs | 0.5882 | 6.4463 | 0.8701 | 0.0424 | 0.0404 | 0.0449 |
| 1,000 rows | 1.4717 | 5.5424 | 3.7612 | 0.0969 | 0.0972 | 0.0968 |

- Compile p90 JS/TS/NRS: .0257/.0424/.0713, .6213/6.4887/.9751,
  1.4832/5.5833/3.9447 ms. SSR p90: .0014/.0016/.0014,
  .0533/.0467/.0493, .0974/.0981/.1034 ms. These are batch distributions,
  not individual request percentiles or uncertainty/confidence intervals.

| Workload | JS Raw / Gzip Bytes | TS Raw / Gzip Bytes | NRS Raw / Gzip Bytes |
| --- | ---: | ---: | ---: |
| Counter | 1490 / 644 | 1488 / 643 | 1520 / 650 |
| 100 pairs | 39252 / 3893 | 39252 / 3893 | 40852 / 3868 |
| 1,000 rows | 82775 / 11679 | 82775 / 11679 | 82791 / 11695 |

- Sizes exclude shared runtime; Node default gzip. Exact cross-language SSR and
  DOM/string SSR assertions pass. Source bytes JS/TS/NRS: 204/236/206,
  9266/10876/7785, 40647/40730/40651. Text formatting can affect generated bytes.
- Browser: Chromium151.0.7922.34, headless 1280x800, cross-origin isolated clock;
  default clock initially quantized tiny counter hydrations to zero, so those
  preliminary numbers were discarded. Five warmup batches and 12 balanced rounds;
  10/10/3 hydrations per batch and 1000/50/10 updates per batch respectively.
  Hydration timers surround the component call after HTML insertion and imports;
  every run asserts SSR element identity, output and destroy cleanup. Updates time
  synchronous button.click through DOM mutation, excluding assertions and cleanup.
  Browser-only handlers update all 100 states, or map/rename all 1,000 keyed rows;
  every value is asserted. These handlers are not part of the compile fixtures.

| Workload | JS Hydrate / Update ms | TS Hydrate / Update ms | NRS Hydrate / Update ms |
| --- | ---: | ---: | ---: |
| Counter | .0050 / .0013 | .0045 / .0015 | .0045 / .0014 |
| 100 pairs | .0855 / .0541 | .0828 / .0537 | .0768 / .0527 |
| 1,000 rows | .9058 / .7603 | .9142 / .7343 | .9167 / .8007 |

- Browser hydration p90 JS/TS/NRS: .0080/.0055/.0085, .2315/.1165/.1405,
  1.3750/1.3500/1.1317 ms; update p90: .0025/.0026/.0026,
  .1094/.0926/.0633, .8900/.8750/.8800 ms. No page load, network, paint, frame-rate,
  real-user input latency or mobile timing claim. No consistent runtime winner;
  tiny measurements remain noisy even with the higher-resolution clock.
- Separate TypeScript5.7.3 strict/noEmit, skipLibCheck diagnostics: fresh programs
  including standard library reads/parsing, two warmups and 12 single-program
  samples per fixture. No incremental reuse, process startup, component/template
  compilation or project discovery. Median/p90 ms: counter81.77/103.24,
  100 pairs89.70/118.86, 1,000 rows137.85/167.29. Not comparable to NRS's
  script-only semantic pass; this is not editor incremental-check latency.
- Three diagnostic probes PASS: unresolved identifier rejected by NRS and TS
  checker (TS2304); number assigned a string rejected only by TS checker (TS2322);
  Math.random in derive rejected only by NRS. JS and TS compilation alone accept
  all three. These illustrate different guarantees, not a complete safety ranking.
- Interpretation: JS compiles fastest on all three fixtures. NRS is slower than
  TS stripping on the counter but about7.4x/1.47x faster on 100 pairs/1,000 rows.
  This measures our current Niral TS pipeline, not TypeScript compilers generally.
  NRS remains1.48-2.56x slower than JS. No consistent SSR/browser speed advantage.
- Verification: all three benchmark modes and their assertions pass; 22 language
  regression tests pass; editor diagnostics clean. Full release gate was verified
  for the preceding backend change, not rerun for this benchmark-only extension.
  No production, dependency, package, preview-server, commit or push changes.

## 2026-10-26: NiralScript Direct Runtime Backend (Local)

- Component compilation now calls compileNiralScript: the independent parser and
  analyzer feed the Niral adapter directly. Resolved bindings emit runtime signals,
  derived closures, reads, writes and nested renames, with metadata supplied to
  template codegen. No intermediate rune text, declaration regex scan, import
  hoisting or JavaScript script rewrite on this path. All semantic checks retained.
- Existing emitNiralScript/lowerNiralScript rune APIs remain compatible; shared
  source-span emission uses binary search to locate relevant edits. Original NRS
  script text is retained in compileClient's returned component AST. JS/TS/JSX/TSX
  and template expression rewriting remain on their existing paths. Core stays
  independent and zero-dependency; runtime unchanged.
- 22 focused tests pass, including exact direct/legacy output and metadata parity,
  diagnostic span parity, all assignment operators, RHS effect ordering, computed
  members, nested shadowing, shorthand and bare-return behavior. New coverage also
  checks quoted rune-like text does not invent declarations, and value methods
  named get/set are called on the value, not confused with runtime signal methods.
- Benchmark: Apple M1, macOS arm64, Node25.6.1; 30 warmups, 11 alternating batches,
  50 compile/200 render calls. Original three full-component workloads unchanged;
  added a separate paired NRS script-backend comparison, including parse/analyze
  in both paths but excluding component parsing/templates. Legacy is reconstructed
  through retained public lowering plus declaration/hoist/rewrite APIs, not a
  historical binary. No concurrent test/build load.

| Workload | Full Compile NRS / JS ms | Script Direct / Via JS ms | Script Time Saved |
| --- | ---: | ---: | ---: |
| Counter | 0.0405 / 0.0225 | 0.0174 / 0.0248 | 29.8% |
| 100 state/derive pairs | 0.8540 / 0.6096 | 0.3718 / 0.5085 | 26.9% |
| 1,000 inline-data rows | 3.6526 / 1.4453 | 2.9064 / 3.6869 | 21.2% |

- Full compile p90 NRS/JS: .0536/.0292, 1.0173/.6324, 4.1456/1.4746 ms.
  Script p90 direct/via-JS: .0195/.0320, .3854/.5846, 3.0531/3.7257 ms.
  SSR medians NRS/JS: .0009/.0010, .0423/.0421, .0972/.0966 ms. DOM/string
  SSR, language output and direct/legacy backend parity all pass; raw/gzip sizes
  match previous fixtures. Full compilation still takes 1.40-2.53x JS time in this
  run. Batch-average percentiles, not request latency; no runtime-speed or global
  fastest-compiler claim. Earlier full-compile medians are separate-run history.
- Verification: 22 language tests, 6 build/release tests and the full
  `npm run test:release` gate pass, including browser/forms and both temporary
  offline installer scaffold/build/test smoke checks. Editor diagnostics clean.
  Windows CI not run. No deployment, publication, dependencies, runtime upgrade,
  commit or push.

## 2026-10-25: NiralScript Compiler Traversal Optimization (Local)

- Node CPU sampling identified reflective analyzer child enumeration as the
  largest self-time hotspot: children plus its callback about 22% of the entire
  benchmark profile; generic expression traversal about 4%. Profile retained at
  /tmp/niral-compiler-profile.DTqxCI/before.cpuprofile (temporary local artifact).
- Replaced Object.entries/filter/flatMap and Object.values traversal with explicit
  AST-kind dispatch. Reuses existing collection child arrays and an immutable
  empty list for leaves. No semantic passes removed, no AST mutation and no cached
  results across compilations; unknown node types fail explicitly. Runtime unchanged.
- Initial verification: 20 language tests and all benchmark parity assertions pass.
  Unprofiled compile medians: counter 0.0471 ms, 100 state/derive pairs 1.0133 ms,
  1,000 rows 4.4005 ms. Earlier recorded baseline: 0.0596/1.5263/7.7152 ms.
  These separate local runs suggest 21%/34%/43% lower latency, not universal
  speedup guarantees. Current JS baselines: 0.0199/0.5912/1.4079 ms. Generated
  raw/gzip sizes match the earlier measurements. No runtime-speed claim.
- Compile p90 batch averages: 0.0705/1.0851/4.8765 ms. SSR medians NRS/JS:
  0.0009/0.0009, 0.0446/0.0537, 0.0964/0.0967 ms; no runtime change or claim.
- Final verification: 21 language tests (including nested unresolved references,
  mutation calls and cycles across ten expression forms), six build/release tests,
  and the full npm run test:release gate PASS. Browser/forms and both disposable
  offline installer scaffold/build/test checks pass. Editor diagnostics clean.
  Windows CI not run. No dependencies, deployment, publication, commit or push.

## 2026-10-25: NiralScript Tests and Local Microbenchmarks

- Fresh checks: all 20 language and 6 release/build tests pass; both focused
  Chromium scenarios pass for inline/external dev+production behavior and reload.
- Added `node bench/niralscript.js`, a zero-dependency, repeatable comparison
  against handwritten Niral JavaScript on the same runtime. Verifies matching
  language output, DOM/string SSR parity, counter output and 1,000 rendered rows.
- Apple M1, macOS arm64, Node v25.6.1. Each phase uses 30 warmup calls per variant,
  11 alternating-order rounds, 50 compilations or 200 renders per batch. Output
  is consumed. Timings below are medians of batch-average milliseconds/op.

| Workload | Compile NRS / JS | String SSR NRS / JS | Generated gzip bytes NRS / JS |
| --- | ---: | ---: | ---: |
| Counter | 0.0596 / 0.0221 | 0.0009 / 0.0009 | 650 / 644 |
| 100 state/derive pairs | 1.5263 / 0.6076 | 0.0436 / 0.0444 | 3868 / 3893 |
| 1,000 rows, inline literal data | 7.7152 / 1.4984 | 0.1006 / 0.0993 | 11695 / 11679 |

- Compile p90 NRS/JS: counter 0.0866/0.0256 ms; 100 pairs 1.6384/0.7049 ms;
  1,000 rows 8.1539/1.6170 ms. These are batch-average percentiles, not request
  latency percentiles. Compiler overhead was 2.51-5.15x; SSR ratios were 0.98-1.05x,
  too close to establish a meaningful runtime advantage from this local run.
- Generated sizes cover component DOM/SSR module code, excluding shared runtime;
  raw bytes NRS/JS: 1520/1490, 40852/39252, 82791/82775. This is not a bundle-size,
  cold-start, filesystem, HTTP, hydration-timing or cross-framework benchmark.
  The 1,000-row compile case includes parsing approximately 40 KB of inline data.
  Full release gate passed in the preceding milestone, not rerun for this bench-only
  addition. No compiler changes, dependencies, deployment, publication or commit.

## 2026-10-25: NiralScript Static Checks and External Sources (Local, Verified)

- Derived semantic checks now follow named/const-aliased functions, reject
  captured/object writes and unproven calls, and diagnose direct/call-mediated
  dependency cycles (NRS075/076). Pure intrinsic calls are explicitly approved
  by the Niral target. Added static readonly-alias and eager captured-read checks.
- Method approval accounts for reassignment/alias property writes; unproven
  methods on derived aliases fail. NiralScript rejects process aliases/computed
  access. These checks are conservative, not a general proof for arbitrary host
  objects/coercions/callbacks; function-return aliases remain untracked.
- External relative .nrs instance scripts now work in dev/build/SSR, including
  child-component source dependencies, streaming root propagation and the renderRoute
  root option. Loader077 rejects mixed inline code, escapes, private/missing files,
  symlinks and non-relative/non-.nrs specifiers. Raw .nrs/.NRS sources stay private.
- SSR cache validation compares source bytes; builds hash external paths/content.
  Invalid source leaves the prior release active. Dev reloads source edits,
  additions and deletions. Component LSP uses the project root and links external
  diagnostics to their file/range. Dedicated .nrs editor/type tooling remains pending.
- Verified: 20 language tests, 6 release/build tests, two focused Chromium scenarios
  covering inline/external dev+production hydration/RPC/privacy and external-edit
  reload/refreshed SSR. Full npm run test:release PASS, including framework, browser,
  forms and both temporary offline installer smoke tests. Editor diagnostics clean.
  Windows CI not run. Spec/README/context updated. Imports/exports, standalone CLI
  and non-Niral targets remain future work. No deployment, publication, dependencies,
  runtime upgrade, commit or push.

## 2026-10-25: NiralScript Statements and Scopes (Local)

- Added named/nested functions, parameters, lexical blocks, let/const, braced
  if/else, call/assignment statements and return to the independent parser.
  Statement boundaries include closing blocks and comment newlines. Expressions
  remain the existing bounded subset; reactive declarations stay top-level.
- New independent analysis.js resolves bindings and explicit target globals,
  rejects unresolved/duplicate names, direct eager reads before initialization,
  and immutable-binding writes. Niral supplies RPC names (not load), preserves
  client secret diagnostics, and renames nested bindings before reactive rewriting
  to preserve closures/shadowing. ASTs are not mutated.
- Sixteen focused language tests pass: isolated core, grammar/spans, recursion,
  closures, immediate state reads/writes, shadowing, object keys, newlines,
  const mutation rules, RPC boundaries, and executed DOM/string SSR. Editor
  diagnostics clean. Browser fixture now uses named NiralScript handlers.
  Build identity coverage includes analysis.js; all five release checks pass.
  Main framework suite: 255 passed, 0 failed (log:
  `/tmp/niral-statements-main.log`). Focused Chromium dev and built-production
  scenario passes SSR/hydration, named handlers/parameter shadowing, reactive
  updates, bindings, keyed list retention and RPC. Full release gate and Windows
  CI were not rerun for this milestone.
- Spec and README updated. Derived purity/cycles, indirect mutation and
  interprocedural initialization checks remain incomplete. External .nrs loading,
  imports, other targets and language-specific editor/type tooling remain pending.
  No dependencies, deployment, commit, push or publication.

## 2026-10-25: NiralScript Expression Parser (Verified Locally)

- Added independent `niralscript/expressions.js`: precedence-aware expression
  trees, literals, collections, calls/members, conditionals and templates.
  Initializer raw source/trivia remains for unchanged Niral emission, but is now
  validated. Unsupported syntax reports NRS071 with original spans and NIRAL071
  from the component adapter. Template boundary scanning respects comments.
- Thirteen language tests pass, including isolated core, grammar rejections,
  AST structure/spans, literal decoding, diagnostics and executed DOM/string SSR.
  Corrected a fixture's expected diagnostic line (4, not 5). Editor checks clean.
  All five release tests pass, including expressions.js build identity and
  previous-release retention. Main suite: 255 passed, 0 failed (full log at
  `/tmp/niral-expression-main.log`). Focused Chromium scenario passes dev and
  built-production SSR/hydration, state, bindings, keyed lists and RPC.
- Full release gate and Windows CI not rerun. Source emission is preserved;
  unsupported raw JavaScript initializers are now deliberately rejected.
- Statement parsing, functions, scopes/semantic checks, external .nrs loading
  and other targets remain pending. No dependencies, deployment, commit or push.

## 2026-10-25: NiralScript Website Page (Deployed and Verified)

- Added `/niralscript` with independent `.nrs` identity, Niral-first integration,
  embedded state/derive example and explicit implemented-versus-planned status.
  Uses ordinary existing component syntax; publishing the page does not require
  deploying the local experimental compiler. Shared navigation/footer and sitemap
  include the page; navigation switches to its mobile menu before links crowd.
- All three docs SEO tests pass with Chromium enabled, including initial HTML,
  metadata/schema, widths 390/1024/1440 and mobile navigation. Desktop/mobile
  screenshots reviewed; editor diagnostics clean.
- Published at `https://niral.site/niralscript`. Only four website files deployed;
  framework, Node22.23.3, environment, data and unrelated work remain unchanged.
  No language compiler deployment, package publication, commit or push.
- Private checkpoint `/root/niral-upgrade-checkpoints/20261025-niralscript`
  saves source, environment, configuration and old release. Separate staging at
  `/var/tmp/niral-language-20261025` built releaseba264ec1f6f4 using the unchanged
  production compiler. Production-runtime checks pass: 28 sitemap pages, 10
  assets, privacy and integrity59/59. Initial navigation assertion was narrowed
  after confirming changelog uses its own navigation rather than SiteHeader.
- Live rebuild matches staged releaseba264ec1f6f4, integrity59/59. Website restarted
  at 16:12:27 UTC, PID88688, NRestarts0. App/watchdog/nginx active; no systemd
  warning-priority entries since activation and recent request logs show200.
  Origin/public health, homepage, language page, about, getting-started, sitemap
  and hashed language asset pass. Public browser390/1440: correct title/canonical,
  loaded Geist and images, no horizontal overflow. Local1024 also passes.
  Environment byte-identical to checkpoint; old release85a914d39113 retained.

## 2026-10-25: Separate NiralScript Root Directory (Verified Locally)

- Extracted the language core to `niralscript/`: parser, scanner, diagnostics
  and a private zero-dependency ES module package. The core has no imports from
  the framework. Niral's existing compiler adapter retains rune emission and
  maps NRS diagnostics to compatible NIRAL errors and original source locations.
- Removed the moved expression reader from the framework scanner. Niral build
  hashes now include the language directory. Extended release tests cover
  changes to each language source file; the installer test fixture now includes
  the extracted directory, matching real whole-checkout installation.
- Verification: 9 language tests (including isolated-copy parsing), 5 release
  checks, 18 CLI checks and the main suite (255 passed, 0 failed). The first main
  run exposed the incomplete installer fixture; the corrected fixture and full
  rerun pass. Code editor diagnostics clean. No browser/full-release/Windows CI
  rerun. README and language draft describe the new ownership boundary.
- No new syntax or external `.nrs` loading, dependencies, publication, production
  changes, commits or pushes. Existing previews and unrelated local work remain.

## 2026-10-25: NiralScript Declaration AST (Verified Locally)

- Separated `parseNiralScript()` from `emitNiralScript()` in the existing
  compiler module. `lowerNiralScript()` remains the compatible composition.
  The parser returns target-neutral state/derived declarations, identifiers and
  raw initializers with original source spans; only the emitter chooses runes.
- Eight focused tests pass: added exact AST/span checks (including CRLF),
  exact generated output, trivia-only inputs and nonmutating emission. Existing
  diagnostics, secret/server boundaries and DOM/string SSR tests still pass.
- Main suite: 255 passed, 0 failed. Compiler/test editor diagnostics clean.
  README and NIRALSCRIPT.md reflect this milestone. No browser/full release
  gate or Windows CI rerun for this output-preserving refactor.
- Initializers are still RawExpression nodes, not a full expression parser.
  Functions, imports, exports, external `.nrs` loading and other targets remain
  pending. No new syntax, dependencies, deployment, commit or push.

## 2026-10-25: NiralScript Language Direction and v0.1 Draft

- User chose `.nrs` for the independent NiralScript language; `.niral` remains
  Niral's component format. Niral integration comes first, other frameworks later.
- Added NIRALSCRIPT.md as a proposed v0.1 contract: core constructs, reactive
  semantics, instance versus utility-module scope, target-neutral compiler
  structure, external-script syntax, security boundaries and acceptance gates.
- This checkpoint is documentation only. External `.nrs` support and the draft
  language constructs are not implemented; the earlier embedded experiment is
  unchanged. No build, deployment, dependency installation, commit or push.
- Verification: `node --test tests/niralscript.js` passes all six existing
  compiler/SSR checks; draft and progress/context editor diagnostics are clean.
  These checks validate the existing prototype, not the proposed language.

## 2026-10-25: NiralScript Experiment (Verified Locally)

- User authorized testing a flagship frontend language idea. Added opt-in
  `<script lang="niralscript">` lowering for top-level `state` and `derive`
  declarations with newline/semicolon separators and balanced initializers.
  Existing HTML, events, bindings, CSS and default JS/TS syntax are unchanged.
- Six focused compiler/SSR tests pass: generated-code equivalence, comments and
  multiline expressions, original-component diagnostics, client env guard/server
  exclusion, executed DOM/string SSR parity. Added to the release gate.
  Focused Chromium test passes in both dev and built production: SSR/hydration,
  increment/reset and derived updates, input binding, keyed-list node retention,
  local RPC, no browser errors or hydration warnings. Temporary test app removed.
- Main framework regression suite: 255 pass, 0 fail. Editor diagnostics clean.
  README documents the experiment and tests/fixtures/niralscript.niral example.
  Full release gate and Windows CI were not rerun for this local experiment.
- This is a syntax prototype, not a complete language or an all-language
  compatibility claim. No new view syntax, standalone extension, function/import
  declarations in NiralScript, or dedicated type-checker/editor integration.
  Initializer expressions inherit existing rewriter limitations, not full JS
  grammar/regex-literal support. Existing JS/TS/JSX/TSX remains unchanged.
- No production changes, commits, pushes or dependency installations.

## 2026-10-25: Security Release Deployment (Verified)

- User authorized commit, push and deployment. Security source `f0ccd99` pushed
  to origin/main; unrelated agent/editor files excluded. CI `40196641172` passed
  all four Windows/Linux Node22/24 release jobs for this exact commit.
- EC2 preflight verified Node 22.23.3, nginx/app/watchdog active, NRestarts0,
  PID82783 and healthy release b6feb5b537db. Runtime remains unchanged; its
  security patch is outstanding. Checkpoint/staged validation precede activation.
- Private checkpoint `/root/niral-upgrade-checkpoints/20261025-f0ccd99-security`
  preserves framework/app source, environment, service/nginx configuration and
  the complete previous release. Environment comparison passed; data untouched.
- Isolated stage `/home/ubuntu/niral-security-f0ccd99` builds 85a914d39113,
  integrity58/58. All 27 sitemap pages, referenced assets, installer bytes and
  private/unsafe-path/origin checks pass. Website tests: 7 pass/1 optional skip.
  Server main suite: 254 pass/1 failure solely because Ruby is not installed;
  docs uses no Ruby. No packages installed. Dry run shows 12 framework files;
  those src/ files were installed; app source and installer files were untouched.
- Live build as `niral` matches staged 85a914d39113, integrity58/58. First
  integrity guard ran as ubuntu and could not access the new private0700 release;
  it stopped before restart. Owner-context validation passed without rebuilding
  or relaxing permissions, then app/watchdog restarted at 13:18:44 UTC.
- nginx/app/watchdog active, PID87220, NRestarts0. Origin and public health
  confirm the new release/process; home/About/contact/DI/Getting Started/installer
  return200 and public HTML references the new assets. Live unsafe path400,
  foreign-origin RPC403 and private env404 verified. No live form data submitted.
- Environment remains byte-identical to checkpoint; data and nginx configuration
  untouched. Previous release and rollback source retained. Node22.23.3 unchanged;
  runtime patch remains outstanding. No npm publication or local Node upgrade.

## 2026-10-25: Security Boundary Hardening (Local)

- Reproduced private storage disclosure through a public dev symlink/junction:
  regression returned HTTP 200 before the fix. Shared file-serving guard now
  rejects links below the serving root and non-regular files. Framework 254/254
  passed after that fix.
- Build walker now skips symlinks/junctions and non-regular files. Shared private
  exclusions are case-insensitive; decoded ambiguous paths are rejected. Dev RPC
  targets must be non-private regular files. RPC uses form-origin validation;
  absolute request URLs cannot override the trusted origin, and configured
  NIRAL_ORIGIN requires exact origin matching.
- Reproduced uppercase component-extension bypass (HTTP 200 instead of 404),
  fixed dev dispatch and excluded all raw component sources from static builds.
  Expanded dev/build/prod tests cover aliases, private casing, component source,
  encoded paths, origin denial and allowed file/route/component/RPC controls.
  Main harness 255/255 passes; editor diagnostics and whitespace checks clean.
  Full local release gate passed: real TypeScript/main harness, focused checks,
  10 Chromium scenarios, four form/navigation combinations, and both packed
  launchers' isolated scaffold/build/test. Postgres/image tooling was not
  configured locally. Current security changes not Windows-CI tested.
- Local Node is 25.6.1. Official October 21 advisory lists patched 22.23.4,
  24.22.1 and 26.12.1; use a patched supported runtime. No runtime installation,
  production inspection, commit, push, publication or deployment performed.
  README documents rebuild requirement, stricter path/link policy, proxy origin
  configuration, local filesystem trust and runtime/DoS limits.

## 2026-10-25: Windows CI Coverage (Verified)
- Initial run `40193731256`: Linux Node 22/24 passed; both Windows versions had
  240 passing and 12 failing framework checks. Browser/package gates did not run.
- Shared build/rollback activation now uses guarded junction replacement on
  Windows, restoring the previous link if promotion fails. POSIX rename remains
  atomic. Windows replacement has a brief missing-link window and is not
  crash-atomic; interrupted activation may require recovering the retained
  `.current.*.previous` link and removing `.current-lock` after checking no
  activation process is running. Five focused release tests pass locally,
  including simulated promotion failure, restoration and concurrent refusal.
- Test fixes use file URL conversion, platform-appropriate permission assertions
  and a Node-based Tailwind fixture (including an actual exit-3 failure check).
  Local main harness: 253 passed, 0 failed. Full local release gate also passes:
  focused tests, Chromium, forms, and both packed launchers' scaffold/build/test.
  Exact POSIX mode checks do not establish Windows ACL privacy.

- Added a separate `windows-latest` Node 22/24 matrix using the existing release
  gate: framework tests, focused tests, Chromium, forms and packed npm launchers.
- Linux Node 22/24 jobs retain their extended Postgres/image checks unchanged;
  those optional services are not configured for Windows.
- The Windows release runner invokes npm's JavaScript entry through Node rather
  than spawning `npm.cmd` directly. No published launcher files were changed.
- Workflow YAML/matrix and release-runner syntax pass locally. The initial
  Windows failures are recorded above; final CI verification is below.
- No npm publication or production deployment. Unrelated local work preserved.
- Source fix `f01ae36` pushed; CI `40194727900` kept both Linux jobs green.
  Windows activation errors are resolved; three tests still compared relative
  link text against absolute junction targets. Their five link assertions now
  resolve destinations before comparison, retaining `readlinkSync` verification.
  Follow-up local harness: 253 passed, 0 failed.
- Follow-up source `5d75a7393bd17e12104cf3fc73d2b2e7182425ed` is pushed.
  [CI 40195078246](https://github.com/Zyora-Dev/niral/actions/runs/40195078246)
  passed all four Windows/Linux Node 22/24 jobs, including main/focused tests,
  Chromium, forms, and packed-launcher scaffold/build/test. Linux extended
  Postgres/image gates also passed. Windows crash-atomicity and ACL caveats above
  remain; npm packages stay at 0.1.4 with no republication or deployment.

## 2026-10-25: Release Reliability And Launcher Update (Published And Verified)

- User authorized the three release-reliability fixes, npm publication, and a
  source commit/push including pending Devtools tracing. No website deployment.
- Build now writes into disposable staging, includes framework and generated
  output in release identity, verifies existing releases instead of replacing
  them, and cleans failed staging. Four focused tests pass: identical rebuild,
  injected copy failure, changed framework input and tampered-release refusal.
- Both shell installers now use the npm updater's locking, validation, backups
  and custom-home launcher handling. `NIRAL_REF` supports persisted full commit
  SHAs or version tags, with explicit `main` to unpin. Eighteen offline launcher
  checks pass, including real shell entry-point success/failure preservation.
- Added `npm run test:release`, immutable-build regressions in the main harness,
  Node 22/24 CI with Postgres/image gates, and corrected the Node engine to >=22.
  Combined release validation passes, including docs browsers, Devtools, main
  Chromium and all four dev/prod form/navigation combinations. Local Postgres/image
  gates were unconfigured; both gates passed in Node 22/24 Linux CI. Package allowlists
  passed. A follow-up shell regression confirms updates bypass older pinned CLIs.
- Registry discovery found both packages at 0.1.3 before publishing 0.1.4.
  Documentation records pins, defaults, backups and the release gate. Source and
  npm uploads are now published as recorded below; no production changes.
- Final 0.1.4 release gate passes: 252 main checks, 15 focused Node tests, 10
  Chromium scenarios, and all four form/navigation combinations. Actual five-file
  tarballs install offline into disposable homes and scaffold/build/test against
  the current source. SHA1: niral `68beefcd85c902a7429c341f2f2c0c75ec8bdb20`;
  create-niral `965bda2d83ca7e336c37d3e50db5af3aff982c0a`.
- User completed terminal login; `npm whoami` now verifies `zyoralabs`.
  Source commit `825256b57262da6e326fc6219950b54d60472100` is pushed and verified
  on remote main, including Devtools tracing. npm accepted both launcher 0.1.4
  publications; five-file checksums match the validated tarballs above. Registry
  propagation is complete: exact versions, SHA1/SHA512 metadata and both latest
  tags verify 0.1.4. No republish was needed.
- Fresh public registry installs of BOTH packages passed in disposable homes:
  five-file allowlist, zero dependencies, help/version without framework download,
  real remote scaffold/build/test, network-blocked cached builds, identical-release
  inode preservation, main update, exact source pin, persisted shim update and
  explicit unpin. Downloads matched remote checkpoint `0cc02d9`; source pins
  matched `825256b`. An older `c0dbb6f` revision also upgraded through the shim.
- Actual `npx niral@latest update` upgraded an older archive cache and retained
  its complete private-data fixture in the backup. All temporary homes were removed.
- GitHub Release Checks runs `40190853399` (source) and `40191032126` (checkpoint)
  both succeeded. Source run jobs `validate (22)` and `validate (24)` passed every
  step, including the extended Postgres/image release gate. Windows remains
  unverified. No production deployment; unrelated local work preserved.

## 2026-10-25: Full-Stack Error Tracing (Verified, Source Published)

- Added local-only opaque response IDs, per-call RPC correlation and browser
  error/rejection/runtime capture. Caught, concurrent and streamed failures retain
  exact server links; network failures remain unlinked. Synchronous event-handler
  attribution stores only type/sequence, never values, targets or keys.
- Added an Errors tab with grouped counts, latest 20 occurrences per group,
  request navigation, source links, search, clear and keyboard-accessible tabs.
  Browser history is bounded to 100 groups and remains in its originating tab.
  Messages, stacks, arguments, responses and queries are not retained.
- Source links are deliberately partial: unique unchanged `.niral` script lines
  map exactly; transformed/duplicate lines, templates, JSX/TSX and unknown frames
  remain unresolved. No server source or full server exception stacks are shipped.
  Async-boundary actions are unattributed, never guessed from timing.
- Verification: 7 focused Node tests, 245 framework checks and 10 Chromium
  scenarios passed. Existing optional environment gates remain. Browser tests
  cover production exclusion, actual action/request correlation, repeated errors,
  stream/network failures, source links, privacy, clear/focus and 320/390/768/1440px
  layouts. Desktop/mobile screenshots reviewed; editor diagnostics clean.
- Disposable preview restarted at http://localhost:51644 with current code;
  page, protected inspector, tracker module and matching response ID verified.
- No runtime dependencies added. This change is uncommitted, unpushed and not
  deployed; previous publication/deployment records below are historical.

## 2026-10-25: Devtools (Verified, Not Deployed)

- Added request-scoped route/layout/loader and RPC metadata tracing, capped at
  100 completed requests and 32 loader spans each. No raw URLs, dynamic values,
  payloads, headers, cookies or error content are recorded. Loopback, Host/port,
  origin, Fetch Metadata and forwarded-header checks protect the read-only API.
- Added a charcoal/saffron shadow-DOM inspector through the dev HMR client:
  filtering, request details, failure categories, timings, pause, manual refresh,
  local clear and Escape/focus restoration. Polling stops when closed, hidden or
  paused. Default dev 404s also load the client; production remains unchanged.
- Four collector/HTTP tests pass, including concurrent isolation, privacy,
  history bounds, exact hostile headers, navigation, RPC/stream failures, preserved
  loader failure categories and successful 303 auth redirects.
- Framework suite: 245 passed, zero failures (existing TypeScript/cwebp/live
  Postgres environment gates remain). Browser suite: 9 passed, zero failures;
  inspector controls/polling/icons and widths 320/390/768/1440 verified, desktop
  and mobile captures reviewed, production launcher/endpoints absent. Fixed Clear
  disabling its focused button by moving focus to search.
- Local disposable preview: http://localhost:51644. README documents access,
  privacy and limits. No browser-error causal tracing or dedicated form-action
  spans in this version. No runtime dependencies or production deployment.
- Source commit: `f89e484` (`feat: add local development inspector`), with user
  authorization to publish to `Zyora-Dev/niral` on `main`. Local agent/editor
  settings and private files excluded; existing deployment records preserved.

## 2026-10-25: Production Deployment (Verified)

- User authorized deploying committed source `551ba8e` to the existing EC2 site.
  Preflight: Node 22.23.3, nginx/app/watchdog active, healthy `b6feb5b537db`,
  no automatic restarts. Private checkpoint:
  `/root/niral-upgrade-checkpoints/20261025-551ba8e` (source, environment,
  complete previous release and pointer).
- Isolated stage `/home/ubuntu/niral-release-20261025-551ba8e`: website tests
  7 passed, 1 optional browser skip; build `757dc255fd9e`, integrity 63/63.
  Production smoke passed all 27 sitemap pages, metadata, health, gold default
  404, installer bytes and private-path isolation. No live contact email sent.
- Reviewed checksum dry run; six changed framework/documentation files installed
  without deletes or data/environment transfer. Existing website source already
  matched. Installed syntax checks pass; production environment is byte-identical
  to checkpoint.
- Initial release-match guard stopped before restart: the staged archive included
  `dev.log` and `prod.log`, correctly excluded by the production sync. A clean
  staged app excluding logs/data/env builds `b6feb5b537db`, exactly matching the
  live build and its 61 integrity-checked files; only manifest creation time differs.
  The app-content hash excludes framework source, so the hash remains unchanged.
  Future stages must exclude logs even when their input is a Git archive.
- Built as `niral`, then restarted app and restored watchdog after validation.
  nginx/app/watchdog active, automatic restarts zero, new app PID 82783; clean
  startup logs and origin/public health confirmed. No nginx or environment changes.
- Public HTTPS home/About/contact/DI/Getting Started/installer all return 200;
  installer bytes match source. New default 404 returns 404 with saffron styling,
  no dev HMR, all three icons loaded and no browser overflow. No live email sent.
  Data untouched, full rollback checkpoint retained, no npm publication.

## 2026-10-25: Source Release Checkpoint

- User authorized committing and pushing all pending framework and website work,
  excluding private data and local editor/agent settings. Code checkpoint:
  `f6cd621` (`feat: refresh website, starter and diagnostic experience`), 43 files.
  Local AGENTS.md changes, CLAUDE.md, .kiro/ and .vscode/ were left untouched.
- Full framework suite: 245 passed, 0 failed; optional TypeScript/cwebp/live
  database checks remain environment-gated. Browser suite: 8 passed. Docs/contact
  suite: 7 passed, 1 optional browser test skipped. Staged whitespace, private-path
  and common credential-pattern checks passed.
- Distribution uses GitHub main: the shell installer and npm launchers download
  the framework; existing managed installations refresh with `niral update`.
  New starter templates apply to newly created apps, not existing route files.
  No npm version bump is required for these framework changes; launcher package
  code and versions are unchanged. npm README changes require a later package
  publication to appear on npm, independently of framework distribution.
- Running apps require a separate deployment to adopt framework changes. No
  production deployment or npm publication was performed for this checkpoint.

## 2026-10-25: Error Screens Saffron Theme and Icons (Local Only)

- Matched shared default 404/500 pages and compile/runtime overlays to the
  starter's charcoal/white/saffron-gold palette. Added pinned Lucide line icons
  for status, source, stack, suggested fixes and recovery/copy/dismiss controls.
  Icons use the same CDN as the starter and require network access; text labels
  remain available and no runtime dependencies were added.
- Preserved diagnostic escaping, production privacy, encoded-stack redaction,
  custom error-page precedence and overlay clipboard/keyboard behavior.
- Browser suite: 8 passed, including new fallback-page theme, image, privacy and
  responsive checks at 320/390/768/1440px, plus compile/runtime icon, clipboard,
  focus and dismissal checks. Desktop/mobile captures reviewed. Focused renderer
  security assertions, JavaScript syntax and editor diagnostics pass. The suite
  built only its disposable test fixture, not the website.
- Restarted the disposable preview at http://localhost:49867 with the updated
  server renderer; `/missing` shows the default 404. No production deployment,
  publication or changes to app-defined error pages.

## 2026-10-25: Starter Saffron Theme and Icons (Local Only)

- Kept the revised sidebar/workspace layout and applied the requested charcoal,
  white and saffron-gold (`#f2b544`) palette. Original logo artwork is unchanged;
  scoped CSS renders the mark gold with white lettering.
- Added Lucide line icons to navigation, section labels and controls. Reset is now
  an icon-only control with its accessible name and tooltip. Uses the docs site's
  pinned `lucide-static@0.468.0` CDN asset source; icons require network access.
  No npm/runtime JavaScript dependencies added.
- Generated starter compiles; editor diagnostics are clean. Chromium verified
  every image loads, gold accent/logo styles, no horizontal overflow at
  320/390/768/1440px, counter/reset, server RPC and collection behavior with a clean
  console. Desktop/mobile captures reviewed. Preview remains http://localhost:49867.
- Static/error pages unchanged. Visual approval pending; no production build,
  deployment or publication.

## 2026-10-25: Starter Layout Revision (Local Only)

- Reworked the default starter in `src/create.js`: dark project sidebar with
  metadata/resources, light workspace, and vertically arranged interactive examples.
  Mobile uses a compact project header; the oversized welcome section is removed.
- Preserved the original logo, SSR data, counter, RPC, keyed collection and static
  navigation. Static companion and error screens are unchanged. No new dependencies.
- Generated-template compilation and editor diagnostics pass. Live Chromium checks
  pass at 320/390/650/768/1100/1440px: no horizontal overflow, logo loaded, counter
  controls visible in the first 900px. Counter/reset, RPC, collection and static
  navigation pass with no console warnings/errors. Desktop/mobile captures reviewed.
- Preview: http://localhost:49867, disposable files `/tmp/niral-preview-cWHKlj/app`.
  Visual approval pending; no production build, deployment or publication.

## 2026-10-18: Starter and Diagnostic Redesign (Local Only)

- Refined the default `niral create` landing and static companion page with
  graphite/white/saffron styling, a bundled original logo, responsive layouts,
  labelled controls, and working counter, collection and server-RPC demos.
  Changes affect newly generated projects; existing applications are not rewritten.
- Redesigned compile/runtime overlays with isolated styles, readable source/stack
  sections, correct error labels, Copy/Dismiss controls, clipboard failure feedback,
  keyboard focus trapping/restoration and Escape dismissal. Diagnostic text remains
  selectable without dismissing the overlay.
- Added default HTML 404/500 screens while retaining custom error-page precedence
  and HTTP statuses. Development failures show escaped diagnostics and load the HMR
  client; production failures omit messages, paths and stacks. Encoded generated
  server modules are removed from displayed development stacks; positions remain.
- Verification: framework suite 245 passed, browser suite 7 passed. Covered starter
  hydration, increment/decrement/reset, RPC, keyed lists, static navigation, local
  logo loading, widths 320/390/768/1440, clipboard success/failure and modal focus.
  Following the final stack-formatting change, focused redaction checks passed and
  the live server-error preview confirmed removal of encoded source. Desktop/mobile
  starter, static and diagnostic captures reviewed; live mobile overlay bounds checked.
- Disposable preview: http://localhost:56885, with `/compile-error`, `/server-error`
  and `/missing` examples. Files are outside the repository at
  `/tmp/niral-preview-HrU4vg/app`; docs preview on 5199 was left untouched.
  No production deployment, Git push, npm publication or new runtime dependencies.

## 2026-10-18: Website Deployment and Canonical Installer (Deployed)

- User authorized production deployment of the updated website. The canonical
  installer is `curl -fsSL https://niral.site/install.sh | bash`; public endpoint
  already returns 200. Updated both installer headers, guide/README commands,
  generated project links and editor metadata. Shell/JS syntax and URL assertions
  pass; legacy nginx hostname remains supported without a DNS/configuration change.
- EC2 preflight: Node 22.23.3, release `35d6f8e95a5a`, nginx/app/watchdog active,
  health 200. No Cloudflare email settings existed in production. User explicitly
  approved adding only those three settings securely from local configuration,
  after a private remote backup, preserving all existing production settings.
- Private checkpoint `/root/niral-upgrade-checkpoints/20261018-website-canonical`
  contains source archives, the old environment and release `35d6f8e95a5a`.
  Isolated staging is `/home/ubuntu/niral-website-20261018/framework`.
- Local framework suite: 244 passed. Site SEO/contact checks: 7 passed, one
  optional browser test skipped, both locally and on Node 22 staging. Staged
  production build `b6feb5b537db` passes integrity 61/61 and all 27 page checks,
  canonical/schema validation and exact installer response. Dry run reviewed.
- Only the three approved email settings were appended over encrypted SSH stdin;
  all previous production values verified unchanged, no secrets displayed.
  The running service verified all three settings loaded; no real contact email
  was sent during deployment. No Git/npm/extension publication.
- Allowlisted source installed without deletes or private data/environment transfer.
  Production build matches staging: `b6feb5b537db`, integrity 61/61. App restarted,
  watchdog restored; nginx/app/watchdog active, automatic restart counts zero.
  Origin and public health report the new release; recent logs show successful
  home/About/contact/DI/Getting Started responses and no startup errors.
- Public installer SHA-256 matches the local script exactly:
  `70db2c7e7b19feed3068676fc277ceeda1b8b7e3b895aadb2460885aafb73680`.
  Browser confirms live About content. Full public crawl/navigation was interrupted
  by client TLS/network timeouts; all 27 pages passed staged production checks.
  Previous release and private checkpoint retained for rollback.

## 2026-10-18: About Us Page (Local Only)

- Added `/about`: Niral JS as ZyoraLabs' flagship web framework, compiler-first
  full-stack capabilities, India origin, and cloud deployment through zHost.
  Explains the framework/cloud distinction and preserves self-hosting as a choice.
  Content follows existing framework and zHost documentation; no invented metrics.
- Matching graphite/white/saffron layout, shared header/footer, active desktop
  and mobile About links, footer discovery, complete SEO and AboutPage JSON-LD.
  Sitemap now contains 27 pages (22 guides and five top-level pages).
- `node --test tests/docs-seo.js`: 3 passed including the new page's content/schema.
  Chromium verified widths 320/390/801/1000/1440, loaded images, mobile navigation,
  contact-to-About footer navigation, canonical update, single schema and no page
  errors. Full desktop/mobile screenshots reviewed; editor diagnostics clean.
- Preview: http://localhost:5199/about. No dependencies, private configuration
  edits, contact submissions, production build or deployment.

## 2026-10-18: Website SEO Completed (Local Only)

- Updated all 26 sitemap pages: 22 guides plus home, DI, contact and changelog.
  Unique authored titles/descriptions replace raw Markdown excerpts. Added visible
  guide summaries and linked breadcrumbs; clarified app AI versus terminal DI.
- Complete initial-HTML canonical, robots, Open Graph and Twitter metadata;
  shared JSON-LD includes website/organization, page types, technical articles,
  breadcrumbs and homepage source-code information. Client navigation keeps
  descriptions, canonicals and social tags synchronized. Existing square logo
  used for summary cards; no ranking guarantees or invented dates/ratings.
- Added docs-only canonical redirects and 404/noindex handling earlier in this
  SEO task. No framework router changes. Existing robots/sitemap coverage verified.
- Final `NIRAL_SEO_BROWSER=1 node --test tests/docs-seo.js`: 3 passed, including
  all-page HTML crawl, schema, navigation, missing pages and logo dimensions.
  Desktop/mobile screenshots reviewed at 1440/390px; diagnostics clean.
  Contact regression: 4 passed, optional browser test skipped in this run.
- Refreshed local preview at http://localhost:5199. No production build/deploy,
  dependencies, private configuration edits or live contact messages.

## 2026-10-18: Developer Intelligence Page (Local Only)

- Added native `/di` with highlighted desktop/mobile shared navigation, footer
  discovery and sitemap entry. Matches graphite/white/saffron and shared components.
  Includes approval-loop, provider-data-boundary and write-lifecycle infographics,
  interactive provider presets, copyable commands, setup, limits and detailed FAQs.
- Content follows current src/di/README.md: explicit provider/model, approval for
  reads and writes, private settings/backups, hash checks and honest limitations.
  No automatic shell/tests/deployment/rollback or guaranteed-local-data claims.
- Route compilation and final Chromium checks pass: active provider styling,
  exact readback for seven command copies, denied-clipboard feedback, seven FAQ
  panels, mobile menu, images/fonts and no hydration errors or text/page overflow
  at 320/390/768/1000/1440/1920px. Home/contact-to-DI client navigation and the
  footer/sitemap links pass. Fixed page margin, literal entities and boolean ARIA
  styling found during visual review; retained the small shared footer logo.
- Local preview: http://localhost:5199/di. Desktop/mobile captures reviewed;
  user visual approval and production build pending. No dependencies, provider
  requests, production changes, commit or deployment.

## 2026-10-18: Cloudflare Contact Email (Local Only)

- Sender display name is now `Niral.js`, using the documented REST
  `from: { address, name }` format; configured sender address unchanged.
  Focused mocked Cloudflare test passed; diagnostics clean. No new live email
  sent for this change, and no credentials or production files modified.
- Contact form now saves its private SQLite copy then calls Cloudflare Email
  Sending through server-only native fetch. Sends to developer@niral.site with
  the visitor as REST `reply_to`; the sender defaults to developer@niral.site.
  Ten-second timeout; HTTP/API errors, invalid responses and permanent bounces
  show a saved-but-not-notified error. Queued or delivered responses allow success.
  No SDK, SMTP, runtime dependencies, database deletion or production changes.
- Private ignored `apps/docs/.env` has `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_EMAIL_API_TOKEN` fields, plus `CLOUDFLARE_EMAIL_FROM`. Enter credentials
  locally, never in chat. Token requires Email Sending: Edit on the configured
  account. Preview task loads this file at startup; restart after setting values.
  Manual preview: `node --env-file-if-exists=apps/docs/.env bin/niral.js dev apps/docs -p 5199`.
- Homepage and Contact now share native SiteHeader/SiteFooter components; actual
  route header/footer HTML equality verified. Original small gold/white logo kept.
- `NIRAL_CONTACT_BROWSER=1 node --test tests/docs-contact.js`: 5 passed, including
  mocked Cloudflare request shape, delivered/queued/bounce/auth/API/network/timeout
  cases, preserved saved messages and JS/no-JS browser submissions. Diagnostics
  clean. Earlier 244-test
  framework result predates this app-only change; framework not changed here.
- User populated local credentials, then authorized one live test to
  info@zyoralabs.com. Cloudflare returned HTTP 404 / error 7003; delivery was not
  confirmed. No automatic retry, secrets displayed, contact recipient change,
  inbox write or production change.
- After the user updated credentials and requested another check, one authorized
  test to info@zyoralabs.com returned HTTP 200 with that recipient in `queued`.
  Cloudflare accepted the send; final inbox delivery is not yet confirmed.
  No application/config changes, extra sends or production operations performed.
  The running preview was not restarted for this standalone email test.

## 2026-10-18: Contact Us Page (Locally Verified)

- Added `/contact` with the existing graphite/white/saffron theme, original logo,
  email/WhatsApp links and native progressively enhanced form actions. Submissions
  are stored in private `apps/docs/data/contact.db`, not emailed. No SMTP setup or
  delivery is claimed. Includes bounded server validation, honeypot and persistent
  per-email limits (one/minute, five/day). Added homepage footer link and sitemap.
- Fixed empty textarea serialization in both SSR renderers and empty-text hydration
  so the field contains no visible marker and attaches without a fallback render.
  Renderer parity, escaping, validation, throttling, storage failure retention,
  origin protection and private-data access regressions pass. Actual Chromium
  submissions with and without JavaScript retain invalid inputs, save valid messages,
  show confirmation and allow a fresh message. Test data stays in temporary inboxes.
- `NIRAL_CONTACT_BROWSER=1 node --test tests/docs-contact.js`: 4 passed.
  Framework `npm test` with cached TypeScript: 244 passed, 0 failed.
  Desktop/mobile screenshots inspected; no overflow at 320/390/768/1000/1440px;
  images, mobile menu, footer navigation and hydration checks pass. Preview running
  at http://localhost:5199/contact. Visual approval pending; no deployment.

## 2026-10-18: Small Gold Footer Logo Only (Local Only)

- Per the latest request, removed the entire large bottom logo and its styles.
  Retained only the small original Niral logo with its icon in saffron gold
  (#f2b544) and lettering white, using a scoped mask of the original artwork.
  Shared asset unchanged; navigation/contact links preserved.
- Chromium verifies a single logo, no large logo block, correct gold color,
  all 12 navigation links and both contact URLs; no overflow at
  320/390/768/1440px. Desktop/mobile captures reviewed; diagnostics clean.
  Local preview only; no build or deployment.

## 2026-10-18: Correct Niral Footer Logo (Local Only)

- Replaced the rejected standalone `n.png` mark and typed NIRAL lettering with
  the actual `/niral-logo.svg` asset in both footer positions. Original logo
  colors, proportions and complete artwork preserved; no filter or cropping.
- Chromium confirms both assets load, no substitute mark/lettering remains,
  and no page overflow at 320/390/768/1440px. Desktop/mobile captures inspected;
  editor diagnostics clean. Contacts and navigation unchanged. Local only.

## 2026-10-18: Reference-Based Footer (Local Only)

- Supersedes the rejected alternate footer below. User supplied SK RADWOAN's
  "Modern Website Footer UI Design" Dribbble reference (shot 27425078).
  Matched its black canvas, compact top row with four link columns, oversized
  gold symbol/white wordmark below, thin divider and centered copyright.
  Uses Niral's existing bitmap mark; right-hand area contains working email
  and WhatsApp links instead of introducing an unimplemented newsletter.
- All 12 navigation destinations preserved. Chromium checks pass at
  320/390/580/768/801/1000/1101/1440/1920px: no text overflow, broken images
  or runtime errors. Desktop/mobile captures reviewed; editor diagnostics clean.
  Tablet layout corrected after a focused check found squeezed columns.
  Local preview http://localhost:5199/#footer; user approval pending.
  No dependencies, production build, deployment or changes outside the footer.

## 2026-10-18: Alternate Footer Design (Local Only)

- User rejected the compact column rearrangement below and requested a different
  design. Replaced it with a horizontal brand bar, ruled Learn/Build/Explore
  navigation rows, contrasting graphite contact panel and full-width bottom strip.
  No large heading or slogan. Native back-to-top anchor added and verified.
- Email `developer@niral.site`, WhatsApp `+918940189694`, and all 12 navigation
  destinations preserved. Chromium checks at 320/390/768/801/1000/1440/1920px
  show no overflow, clipped links, broken icons or runtime errors. Desktop/mobile
  screenshots reviewed; mobile text-spacing correction verified separately.
  Editor diagnostics clean. Preview http://localhost:5199/#footer; visual approval
  pending. No full build/deployment; other homepage sections preserved.

## 2026-10-18: Compact Footer Restructure (Local Only)

- Supersedes the footer refinement below, whose oversized slogan and separate
  contact band the user rejected. Removed the slogan, CTA and "Let's talk" band.
  Integrated email/WhatsApp beneath the brand alongside three navigation columns;
  balanced mobile link groups and a slim bottom row. Footer text is 11-13px.
- Contact destinations and all 12 navigation links preserved. Chromium checks at
  320/390/768/801/1000/1440/1920px pass without overflow, broken images or runtime
  errors. Captures reviewed: footer height 343px desktop, 665px at 390px mobile.
  Editor diagnostics clean. Local review only; no build or deployment.

## 2026-10-18: Homepage Footer Refinement (Local Only)

- Replaced the oversized footer invitation with a compact brand/navigation grid,
  graphite gradient, gold section labels, generous link spacing, and a separated
  contact row. Existing 12 navigation links preserved; other homepage work intact.
- Added email `developer@niral.site` using `mailto:` and WhatsApp
  `+918940189694` using `https://wa.me/918940189694` with a safe new-tab link.
- Local Chromium verified destinations, icons, no runtime errors or footer
  overflow at 320/390/768/801/1000/1440/1920px. Desktop/mobile screenshots reviewed;
  editor diagnostics clean. No messages sent, dependencies added, full build or
  deployment. Local preview remains http://localhost:5199/.

## 2026-10-18: Complete Homepage Replacement (Local Only)

- User rejected both previous homepage iterations because they retained the old
  layout. Replaced the entire homepage after inspecting Svelte and Next.js:
  left-aligned Niral opening, integrated development strip, interactive source/live
  preview, asymmetric feature grid, consolidated performance/deployment, resources
  and a new footer. Previous homepage entries below are superseded.
- Native Niral counter/derived and todo demos, example/deployment switches, copy
  controls and mobile navigation. Homepage is now interactive, not static.
  Self-hosted Geist Sans/Mono, black/graphite, white and saffron gold retained.
  No runtime dependencies added; docs/changelog and unrelated DI work preserved.
- Corrected quoted icon interpolations to expression attributes and a missing
  Lucide icon. Existing benchmark figures retained with hardware/load caveats;
  benchmarks were not rerun and are not VPS capacity claims.
- Local Chromium verifies counter/reset/derived, todo add/trim/toggle/delete/empty
  state, hosting switch, mobile documentation navigation, all 13 linked guide
  routes (HTTP 200), loaded icons/fonts, and no page/heading/card overflow at
  320/390/768/1000/1440/1920px. No browser runtime errors; editor diagnostics clean.
  All three copy controls pass exact isolated-browser clipboard readback; denied
  clipboard feedback passes. Desktop/mobile screenshots inspected using existing
  repository Playwright tooling after embedded-browser capture sizing issues.
- Preview: http://localhost:5199/. Visual acceptance remains pending. No full
  production build during design review, deployment, commit, push or publication.

## 2026-10-18: Homepage Feature Card Revision (Local Only)

- User rejected the previous homepage as cluttered. Rebuilt the feature section
  using shadcn-inspired header/content/footer composition in native Niral:
  two wide code/reactivity cards, six feature cards with Lucide icons, concise
  descriptions, capability lists and aligned documentation links. TypeScript and
  polyglot links remain directly below the grid. No React or packages installed.
- Features now follow the hero immediately. Removed the moving ticker, moved
  metrics beside benchmarks, softened the hero watermark, paired the full code
  example with explanatory steps, and styled workflow/economics/scaling items as
  consistent cards. Geist Sans/Mono, white text and graphite/gold palette retained.
- Browser confirms eight cards, loaded assets/font, corrected native-template code
  braces, and no page/card overflow at 320/390/768/1000/1440/1920px. Desktop card
  screenshots inspected; editor diagnostics clean. Example panel heights unified.
- Local visual iteration at http://localhost:5199/; user acceptance still pending.
  No full build, deployment, dependency change, commit or push. Changelog/docs and
  unrelated DI changes untouched by this revision.

## 2026-10-18: Homepage and Changelog Refinement (Local Only)

- Extended the selected Geist Sans, black/graphite, white and saffron-gold theme
  to the homepage and changelog. Inspected the supplied VoltJS design reference.
  Homepage now has a prominent Niral hero, monochrome brand artwork, clearer
  section hierarchy, unframed metrics/workflow/scaling rows, restrained capability
  cards, readable code/benchmark panels and consistent navigation/footer spacing.
- Both public pages use native details-based mobile navigation. Homepage remains
  static; code uses Geist Mono. Changelog has a month timeline, readable dates and
  linked commit hashes; loader, cache and release fallback remain unchanged.
- Corrected a literal HTML entity in the homepage scaling copy; browser readback
  confirms the intended zero-dependency wording.
- Browser checks confirm Geist, loaded images/icons, desktop/mobile screenshots,
  working changelog-to-home mobile navigation and all 56 loaded changelog entries.
  Homepage has no overflow at 320/390/768/1440/1920px; changelog passes at 390px
  and its desktop layout was inspected. Both files have clean editor diagnostics
  and pass whitespace checks. No dependencies or shared logo asset changes.
- Preview: http://localhost:5199/. No full build during visual iteration; awaiting
  visual review. No deployment, commit, push, npm publication or cache update.

## 2026-10-18: Black, Graphite and Saffron Docs Theme (Local Only)

- Applied the user's chosen black/graphite gradient, clean white text and saffron
  gold (#f2b544) accent to the shared documentation layout and article renderer.
  Neutralized green-tinted surfaces/borders across navigation, search, starter
  kit, code panels, tables, page outline and pager. Section titles remain bold
  uppercase with dividers, now white; gold emphasizes selection, links and actions.
- Reused shared CSS color tokens; preserved Geist Sans/Mono, layout, all 22 links,
  article content and interactions. Docs logo is monochrome via scoped CSS, leaving
  the shared asset and homepage unchanged. Browser theme-color matches the header.
  Syntax colors remain differentiated, with former green/blue tokens replaced.
- Verified rendered colors, navigation/search, mobile drawer and overflow at
  320/390/1440px; inspected desktop and mobile screenshots. Both files have no
  diagnostics. No dependencies, full build, commit, release or deployment.

## 2026-10-18: Documentation Geist Sans Consistency (Local Only)

- Confirmed the existing self-hosted "Geist" family is Geist Sans and already
  renders documentation headings, prose, navigation and search. Added a scoped
  font-family rule for buttons, inputs and selects to eliminate browser-default
  Arial on controls; code and the prompt preview retain Geist Mono.
- Browser font loading/computed styles, desktop screenshot and diagnostics pass.
  No new dependencies, full build or deployment.

## 2026-10-18: Sidebar Group Hierarchy (Local Only)

- Differentiated all five sidebar section titles using bold uppercase emerald
  labels and a subtle horizontal divider. Link styles, 20px group spacing and
  all 22 navigation links are unchanged.
- Verified computed styles and no desktop overflow in the running preview;
  inspected the sidebar screenshot. File diagnostics pass. No build or deployment.

## 2026-10-18: Copyable Agent Starter Kit (Local Only)

- Added a compact card below the Getting Started title with VS Code, JetBrains
  (assumed from "jtkins"), Claude Code and Codex icons, Copy prompt and an expandable
  read-only prompt. Existing article content and all navigation remain unchanged.
- The 2,755-character prompt covers workspace inspection, official docs, Node22+,
  new/existing app handling, Niral syntax, routes, server-only secrets, authorization,
  data preservation, accessible UI, validation and explicit deployment approval.
  It is generic guidance for these tools, not an installed agent integration.
- Browser tests with a stubbed clipboard confirm exact text copying and truthful
  failure feedback with full manual selection. Components compile; diagnostics
  pass. Desktop/mobile screenshots inspected;320-1440px layout checks pass, and the
  card is absent on other guides. All four logos and the copy icon decode correctly.
- Icons are version-pinned CDN SVG images (Devicon, Simple Icons, Lucide), with no
  new package dependencies. Image rendering survives client navigation; inline SVG
  in the page was observed to acquire the HTML namespace after navigation, so the
  new copy button uses an image. This does not fix the underlying framework issue.
- Preview: http://localhost:5199/docs/getting-started. No full build/framework-suite
  rerun, live-agent execution, system-clipboard readback, deployment or release.

## 2026-10-18: Sidebar Correction After Visual Feedback (Local Only)

- User rejected the initial presentation and requested the sidebar be corrected
  first. Removed bullet dots, replaced the placeholder book with Lucide's book-open
  SVG, and grouped navigation into aligned rows: 36px row height, 2px row gap,
  20px group gap, restrained active background and a slim emerald indicator.
- Uses native Niral markup with a shadcn-style menu treatment, not React/shadcn
  packages. All 22 links and all article content preserved. No dependencies added.
- Browser confirms loaded styles, Geist fonts and logo; icon has the correct SVG
  namespace and two rendered paths. Desktop screenshot inspected; mobile320/390
  checks confirm no overflow, working drawer, active link and close-on-navigation.
  Editor diagnostics pass. This is a local sidebar correction, not design approval.
- Preview remains http://localhost:5199/docs/getting-started. No build, deployment,
  commit, push or npm publication in this correction.

## 2026-10-18: Documentation Layout Refinement (Local Only)

- Refined the shared docs layout and article renderer using the supplied Material
  You documentation reference for hierarchy and spacing. Retained Niral's own
  charcoal/emerald palette, self-hosted Geist fonts, logo and zero dependencies.
- Wider desktop reading column, sticky search/resource header, grouped sidebar,
  breadcrumbs, readable page outline, stronger section rhythm, framed code panels
  with language labels and accessible icon copy controls, full-width scrollable
  reference tables, and paired previous/next navigation cards.
- Mobile navigation has explicit expanded state and hidden closed links; mobile
  page outlines expand inline. Added skip-to-content, visible focus, anchor offsets
  and reduced-motion handling. Search uses bound input state and discards stale
  asynchronous responses. Escape clears results and the visible input.
- Both components compile; all 22 Markdown guides render; all 22 local docs routes
  return HTTP200. Editor diagnostics and whitespace checks pass. Browser checks
  cover 320-1920px widths without page overflow, desktop/mobile screenshots,
  mobile navigation, section anchors, search/reset, table sizing and copy feedback.
  Clipboard readback is unverified: the integrated browser cannot grant permission.
- Preview task: `Preview Niral docs`, http://localhost:5199/docs/getting-started.
  The dev server was restarted to refresh its cached Markdown helper. No production
  build or full framework suite rerun in this visual iteration; awaiting review.
  No deployment, commit, push, npm publication or installed-cache change.

## 2026-10-18: Provider Presets Production Deployment

- User authorized deployment. Preflight: Node22.23.3, nginx/app/watchdog active,
  health200, current releasebbc96b5529dd. Private rollback checkpoint:
  /root/niral-upgrade-checkpoints/20261018T033336Z-di-presets (affected framework
  files, docs content, unchanged app.env and previous-current pointer).
- Isolated stage /home/ubuntu/niral-di-presets-20261018T033336Z passes16 DI,
  10 DI CLI and15 launcher groups; docs syntax passes. Allowlisted transfer dry
  run reviewed; no environment/data/deletions or unrelated local files included.
- Allowlisted source transferred; installed DI help and syntax pass. Docs built
  as niral into release35d6f8e95a5a; integrity50/50 before activation. Previous
  releasebbc96b5529dd retained. app.env byte-identical; data untouched.
- nginx/app/watchdog active, NRestarts0, clean startup logs. Origin and public
  health report35d6f8e95a5a; homepage/CLI docs HTTP200. Browser confirms presets,
  Custom flow, Azure v1 details and Bedrock limitation. Deployment complete.
- No commit/push/npm publish or installed user-cache update. Public Git/npm
  distribution still does not contain this follow-up.

## 2026-10-18: Provider-First DI Setup (Local Only)

- Setup now offers OpenAI, Claude (Anthropic), Azure OpenAI and Custom. Named
  providers resolve documented protocol/auth/base settings into the existing
  config schema; exact models/deployments and credential variable names remain
  user-supplied. Custom retains manual protocol/auth/version choices.
- Azure accepts an HTTPS resource URL or /openai/v1 base, normalizing to the v1
  Responses API without a version query. Incompatible paths, credentials, query
  strings and fragments are rejected without replacing config. Bedrock remains
  unsupported; no adapter, model fallback or network probing was added.
- Ten focused DI CLI groups pass, including exact mocked preset requests,
  offline setup, required model input, file permissions and cancellation/EOF.
  Full suite: 244 passed, 0 failed. Editor diagnostics, docs JavaScript syntax
  and diff whitespace checks pass. Guides updated. Requests were mocked; no
  live provider credentials or API calls were used.
- Local only: no commit, push, npm publication, deployment or installed-cache change.

## 2026-10-18: Interactive DI Setup (Local Only)

- Bare `niral di setup` now prompts for explicit provider settings and credential
  variable name, never the secret. Existing flags remain usable for automation.
  Invalid/empty selections retry; cancellation or invalid config leaves the old
  file intact. Existing settings still require --replace.
- Npm error log confirmed local niral@0.1.0-m1 lacked a bin mapping. Root package
  now maps niral to the existing CLI; actual offline npm exec DI help passes.
  Eight focused DI groups and fifteen launcher groups passed, including real
  readline input, Ctrl-C and EOF. Full suite: 242 passed, 0 failed. Docs syntax,
  editor diagnostics and diff whitespace checks pass. Documentation now leads
  with the short setup command.
- Not committed, published, deployed or copied into the user's installed cache.

## 2026-10-18: DI Commands Published and Deployed

- Added `niral di setup`, `status`, `ask`, `chat` and `new` through the existing
  framework dispatcher and both npm launchers. No separate package or cloud service.
- Setup saves exact provider/model/auth settings and only the credential variable
  name in private `NIRAL_HOME/di.json`; no automatic .env loading or secret storage.
- Workspace listing/reading/writing requires interactive per-call approval. Reads
  are bounded, conventional private paths and symlinks are excluded, writes require
  the current hash and save original content under `NIRAL_HOME/di-backups`.
- Read-only and prompt-only modes, bounded in-memory chat, cancellation, terminal
  control stripping and real template scaffolding are wired. No arbitrary shell,
  automatic tests, streaming, automatic rollback or transcript persistence.
- Six focused offline DI CLI groups pass, including both npm entrypoints,
  approval denial, backup/conflict protection, path escapes and chat/scaffolding.
  Fixed macOS canonical-path alias handling for a not-yet-created DI home.
- CLI/site/package documentation now covers the commands and safety limits.
  Full regression suite passed **240/0** with real TypeScript; final permission,
  hash-type and cancellation guards pass the six focused DI CLI groups.
  Fifteen launcher groups, documentation syntax and editor diagnostics pass.
- Both npm manifests prepared as **0.1.3** after registry versions confirmed
  0.1.0 through 0.1.2 only. Publication was initially blocked on npm login
  (whoami returned 401); no key/token was requested through chat.
- Actual 0.1.3 tarballs each contain exactly the five allowlisted files;
  extracted entrypoints pass DI help and version checks. Local docs build passed
  (release8ca5f61663cc). Whitespace check and fifteen launcher groups pass.
- Release source committed and pushed to main as **d2cf087**; remote revision
  matches local HEAD. Unrelated AGENTS.md, CLAUDE.md and .kiro changes excluded.
- Authorized EC2 read-only preflight: Node22.23.3, nginx/app/watchdog active,
  health200 on release cb55f099d593. Private checkpoint completed at
  /root/niral-upgrade-checkpoints/20261018-di-d2cf087 (source, env, current pointer).
- Committed source staged at /home/ubuntu/niral-di-release.v4YGWL: Node22 passes
  16 provider/agent, six DI CLI and fifteen launcher groups. Allowlisted source,
  installer packages and docs content copied without deletes or ownership changes;
  installed syntax/DI help pass and app.env remains byte-identical to checkpoint.
  No live provider request was made.
- EC2 docs built as niral and activated as **7bd11bf2707e**, after integrity50/50
  passed with no tampering and env byte comparison passed. App restarted and
  watchdog restored; nginx/app/watchdog active, NRestarts0, request logs healthy.
  Public home, /docs/cli and /@niral/health return200 with the new release;
  browser rendered-text assertions confirm all five DI commands. Initial raw-HTML
  command matching was unsuitable for highlighted code; rendered checks passed.
  Previous release cb55f099d593 retained.
- User completed npm login; whoami confirms zyoralabs, and 0.1.3 remains unused
  for both packages. Removed source-preview notices in release documentation;
  fifteen CLI groups, docs syntax/diagnostics and five-file package checks pass.
  Release guidance pushed as cbf06d2. Npm accepted publication of niral@0.1.3
  (five files, shasum6a4bbea6d2d0f8254684e608a6448b0addc12b04).
  Npm also accepted create-niral@0.1.3
  (five files, shasumf2219dec0451b8a3f25197d086918b5c1775b3f6).
  Both exact registry versions return200 with matching checksums. Fresh registry
  installs in disposable homes pass help/version, DI setup/status with private
  config, cache reuse, real minimal scaffold/build/test (1/0 each), and explicit
  Git update to cbf06d2. Published launcher upgrades a real pre-DI archive from
  1d41d44 and preserves its backup. No provider calls or user-cache edits.
- Both npm latest tags now resolve to **0.1.3**. Final documentation deployment
  checkpoint: /root/niral-upgrade-checkpoints/20261018-npm013-cbf06d2 (content,
  private env and previous pointer). Only docs content transferred; env unchanged.
  Built as niral, integrity50/50 passed, release **bbc96b5529dd** activated.
  nginx/app/watchdog active, NRestarts0, startup/request logs healthy; public
  home, CLI guide and health return200 on the new release. Browser verifies
  all five commands, launcher0.1.3 wording and removal of source-preview notice.
  Previous7bd11bf2707e retained. Npm publication and documentation deployment
  complete; Windows and additional live-provider compatibility remain untested.

## 2026-10-18: Global CLI Update Preparation (Local)

- Framework help and version commands now exit successfully without executing
  project commands; unknown commands fail clearly. Help includes the API recipe.
- Both npm launchers expose `update` before forwarding to an older cached CLI;
  installed framework CLI restricts updates to the managed `NIRAL_HOME/framework`.
- Git installs require a clean official-origin main checkout and fast-forward
  updates; Git failures never fall back to destructive archive replacement.
  New downloads are staged and CLI syntax-checked, archive replacements retain
  the full previous directory, and symlink/concurrent installations are refused.
- Scaffolder validates arguments/templates before downloads, forwards failures,
  and preserves custom install paths in generated launchers. Both package copies
  are kept identical; no automatic network refresh on ordinary cached commands.
- Fifteen focused offline CLI groups pass, including real creation of all three
  templates through both packages, existing-project preservation, and coverage of
  every dispatcher command/recipe in the CLI documentation.
- Added npm package READMEs, explicit package file allowlists, local release
  checklist and expanded getting-started/CLI docs. Update commands are marked
  as source previews until publication. Windows runtime behavior is not verified.
- Final full suite with the existing TypeScript cache: **234 passed, 0 failed**.
  Documentation syntax and editor diagnostics pass. Optional image-transcoding
  and live-Postgres checks remain environment-gated.
- Actual local npm tarballs verified for both unchanged 0.1.2 packages: exactly
  five allowlisted files each, zero dependencies, extracted help/version commands
  succeed without framework installation. Temporary artifacts were removed.
- No npm publication, version bump, Git commit/push or production deployment.
  DI commands and workspace tools remain a separate unfinished milestone.

## 2026-10-18: Niral DI Foundation (Local)

- Added independent, zero-dependency DI adapters for Chat Completions, Responses
  and Anthropic Messages. Explicit endpoint/model/auth configuration supports
  compatible services, Azure API keys and host-supplied renewable bearer tokens.
- Shared loop requires explicit host validators and default-deny authorization;
  preflights whole batches and enforces turn/call/result limits and a total
  deadline. Sequential tools receive cancellation signals; no automatic retries,
  unrestricted shell, filesystem tools or automatic transcript persistence.
- Sixteen deterministic DI tests pass (`node tests/di.js`), now registered in
  the main harness: three-protocol round trips, native state/usage, multiple
  calls, refusals, unsafe/incomplete output rejection, validation/approval,
  limits, cancellation/timeouts and credential-safe transport/tool errors.
- Internal API and limitations documented in `src/di/README.md`. Host validators
  enforce arguments; JSON Schema is only the provider-facing description.
  Cancellation cannot roll back or forcibly stop arbitrary host tool code.
- Full framework regression suite with cached TypeScript: **219 passed, 0 failed**
  (`NIRAL_TSC="$PWD/.niral/lib/typescript/typescript.js" npm test`). Editor
  diagnostics clean for DI modules and test files. Optional cwebp/live-Postgres
  checks remain environment-gated; provider tests use mocks, not live services.
- Live Azure Responses smoke test passed with user-selected deployment
  `gpt-6.1-sol` and API version `2025-04-01-preview`: two model turns, one
  validated/authorized synthetic tool execution, final answer verified against
  its random return value. Usage: 245 input tokens, 51 output tokens. Used the
  existing adapters/loop without code changes; no repository content sent.
- API key entered through a hidden terminal prompt, never written to disk or
  printed, and removed from the temporary shell variable after the test.
  Application-side `ai` and its environment variables are unchanged. No
  production changes, commits or pushes. Other provider live tests remain pending.
- CLI setup/chat/new-project commands, workspace tools and streaming are not
  implemented yet. DI is a framework feature;
  Cloud is an optional future add-on, not a prerequisite or the current focus.

## 2026-10-18: Shield Visitor Isolation

- Diagnosed a 15-minute scanner-triggered ban of nginx's loopback address;
  all visitors and watchdog probes shared that identity. Ban expired naturally.
- Added `NIRAL_TRUST_PROXY=loopback`: only loopback peers may supply a single
  valid visitor IP. Direct-peer spoofed headers and malformed lists are ignored.
- EC2 nginx trusts `CF-Connecting-IP` only from Cloudflare's official IPv4/IPv6
  networks (retrieved from its published endpoints), and overwrites forwarding
  headers with the resolved address. Service enables loopback-only trust.
- Public robots rules remain allow-all with a sitemap. Shield uses request
  behavior, not user-agent names; claiming to be a crawler never bypasses bans.
- Final local suite: **203 passed, 0 failed**, including attacker/visitor/watchdog
  isolation, direct-header spoofing, IPv6, crawler behavior and proxy diagnostics.
  `niral doctor --security` recognizes loopback-only trust and warns about legacy
  unrestricted trust. Editor, documentation syntax and whitespace checks clean.
- Deployed with user approval; checkpoint:
  `/root/niral-upgrade-checkpoints/20261018-shield-visitor-ip` preserves nginx,
  systemd unit, Shield source, environment and previous release pointer.
  nginx syntax, systemd validation and remote Node22 isolation checks passed.
  All services active; running process confirms loopback-only trust. Environment
  is byte-identical and release206194d9f600 remains active; data preserved.
- Live reserved attacker IP192.0.2.241 banned; other visitor and watchdog200.
  nginx ignores spoofed XFF/CF headers from untrusted peers. The first nginx
  test used fetch with a Host override and hit the default server404; explicit
  node:http Host routing passed. Synthetic ban audit records are preserved;
  the later documentation restart cleared in-memory bans as designed.
  A normal public request logged the visitor's
  address, not loopback. Forged Cloudflare-header request was rejected before origin.
- Public homepage, health, robots and sitemap200. Routing guide200 with browser,
  Googlebot, bingbot, GPTBot and ClaudeBot user agents (not proof of indexing).
  Security guide and doctor module published after adding source backups to the
  checkpoint. Docs release **cb55f099d593** built as app user; integrity50/50
  passed before restart. All services active; origin/public health200, Shield
  enabled with no lockdown or active bans at final verification. Environment
  unchanged; prior release retained. Updated Security guide200 for all five
  tested user agents. No Git commit/push or npm publication in this correction.

## 2026-10-17: State-Preserving Navigation (Verified Locally)

- Navigation responses are version-guarded across fetch and module loading.
  Shared layout prefixes retain DOM, local state and context; changed branches
  dispose cleanly and page leaves remount with destination loader props.
- Added read-only reactive `pageNavigation()` (`pending`, `from`, `to`), compiler
  ambient/type support, hash navigation, heading/anchor focus and per-history-entry
  window scroll restoration. Existing history state is preserved.
- All four dev/prod and layout/no-layout Chromium combinations pass, covering
  fetch/import races, nested layout lifecycle/context, local state, slot fallbacks,
  destination state initialization, hydration, anchors and Back/Forward. Six real
  TypeScript inference groups pass. Routing and browser-test docs updated.
- Final full regression recheck: **201 passed, 0 failed**, with real TypeScript.
  Documentation syntax, editor diagnostics and whitespace checks are clean.
  Optional external image-tool and live Postgres checks remain environment-gated.
- User authorized commit, push and deployment on 2026-10-17. Feature committed
  and pushed as `d8b4971`. EC2 preflight: Node22.23.3, all three services active,
  health200 on release `76cdffd10467`. Private checkpoint saved at
  `/root/niral-upgrade-checkpoints/20261017-d8b4971` (source, env, previous pointer).
  Allowlisted transfer completed preserving ownership, env and data. All five
  focused form/runtime groups and six real-TypeScript groups pass on EC2;
  docs syntax and environment byte comparison pass. Built release `206194d9f600`
  as the app user; integrity50/50 clean and environment unchanged. Activated;
  nginx, app and watchdog active. Origin/public health, homepage and routing
  documentation verified200. Live browser navigation smoke was inconclusive
  because a sidebar link was outside the viewport; local Chromium coverage passed.

## 2026-10-17: Refresh Upgrade Published

- User authorized commit and push. Feature and EC2 configuration committed as
  `1d41d44` and pushed successfully to `origin/main`.
- Pre-commit recheck: all five focused form/refresh groups pass; deployment script
  shell syntax and Git whitespace checks pass. Private keys and unrelated
  `AGENTS.md`, `.kiro/` and `CLAUDE.md` changes excluded.
- Live changelog confirmed to use GitHub history, not the release fallback.
  New commits become visible after its existing 10-minute cache expires.
  No production restart, configuration change or npm publication in this step.

## 2026-10-17: New EC2 Website Deployment

- Authorized target: `ubuntu@13.126.45.97`, Ubuntu 24.04 x86_64. SSH key is
  `aws-key/dream.pem`; permissions restricted to 600 and key directories ignored.
- Installed Node 22.23.3, nginx and UFW. SSH/HTTP allowed, other inbound ports
  denied by UFW. Added non-root app and separate watchdog service definitions.
- Checkpoint: `/root/niral-upgrade-checkpoints/20261017T141510Z-ec2`.
  Generated the application secret only on the server; existing env/data preserved.
- Configuration lives in `deploy/ec2/`. Allowlisted source transferred without
  keys, environment files, local data or build artifacts. Five form/refresh and
  six real-TypeScript checks passed on EC2. Release `76cdffd10467` built on the
  server, integrity 49/49 files clean; systemd unit validation passed.
- Activated release `76cdffd10467`; nginx, app and watchdog active, both Niral
  services with zero restarts. An immediate post-start health request raced the
  listener; logs confirmed normal startup and subsequent public health was 200.
- Public `http://13.126.45.97` homepage, Server/TypeScript guides, health, image,
  Geist CSS/font, robots and sitemap return 200. New refresh documentation is
  present. Environment, database and private-key URL probes return 404.
- Browser verification: Server guide renders at 1440px and 390px without horizontal
  overflow; self-hosted Geist loads at both widths. Environment matches private
  checkpoint backup. Source is root-owned; app runs as `niral`, with writable
  data/dist only; watchdog runs separately with restart authority.
- HTTP only: `NIRAL_SECURE=0` until HTTPS is configured. Domain/DNS cutover and TLS
  still require confirmation. Existing production host/DNS untouched. No Git
  commit, push, npm publication or old-server data migration performed.
- Subsequent user-managed Cloudflare cutover verified: `https://niral.site`
  homepage, Server guide and health return200 through Cloudflare (`DYNAMIC`),
  health reports EC2 release `76cdffd10467`. Browser-facing HTTPS is active;
  origin remains HTTP and `NIRAL_SECURE=0`. No server or Cloudflare settings
  changed during this verification; end-to-end origin TLS remains unconfigured.

## 2026-10-17: State-Preserving Page Refresh

- Added `pageRefresh()` and reactive page/layout props using the existing signal
  mechanism. Refresh bypasses the navigation cache and rejects stale responses.
- Added opt-in `formAction("save", { refresh: true })`; refresh errors remain
  separate from successful writes. Five focused lifecycle/form/bundle groups pass.
- Six TypeScript inference groups pass. All four Chromium combinations (dev/prod,
  with/without layouts) pass for reactive loader data, keyed-row identity,
  focus/files/scroll preservation, separate save/read failures, retry and stale
  responses after navigation. Controller reset/disposal cancels reads.
- Full suite: **201 passed, 0 failed**, with real TypeScript enabled. Editor
  diagnostics, documentation syntax and whitespace checks are clean. Local docs
  build produced release `e9924fec9201` (3 routes). Optional external image-tool
  and live Postgres checks remain environment-gated; runtime dependencies stay empty.
- Temporary app fixtures use distinct server source to avoid Node data-URL module
  caching carrying counters between repeated runs in one process.
- Initially verified locally; subsequently deployed to the new EC2 host above.
  No commit or push. Unrelated local work preserved.

## 2026-09-09: Reactive Form Actions

- Added opt-in `formAction("save")` with reactive status, pending, result, field
  errors, transport error and reset. Result-only dev/prod responses preserve the
  form DOM instead of reloading loader data. Existing native form actions remain.
- Shared submission transport preserves multipart files and submitter values,
  blocks concurrent submissions per form, and never retries uncertain writes
  automatically. Controller cleanup aborts fetches on component disposal.
- Compiler and production runtime bundler expose the new ambient. Real TypeScript
  checks infer local action names/results and validator schema field errors.
- Focused runtime/bundle and six inference regression groups passed. HTTP and
  Chromium tests now pass against dev and production: exact multipart bytes,
  cookies, validation, native fallback, focus/file retention, duplicate POST
  suppression, controller isolation, reset races and redirects. Form actions
  reject cross-host writes; result-only production 500s conceal exception details.
- Server, TypeScript and Validation guides now document reactive forms and their
  limits. Full suite: **200 passed, 0 failed**, with real TypeScript enabled.
  Both dev/prod Chromium groups pass via `npm run test:forms --prefix tests/browser`.
  Editor diagnostics and documentation syntax checks are clean; local docs build
  produced release `f3432dab528d` (3 routes). Optional external image-tool and live
  Postgres checks remain environment-gated. Framework runtime dependencies remain
  empty; Playwright stays isolated in browser tooling.
- Verification note: an initial full run with `NIRAL_LOG=off` failed the expected
  access-log assertion; rerunning with default logging passed the entire suite.
  Feature committed as `7b2b7c1`. Push and deployment subsequently authorized.
- Push to `origin/main` succeeded through `7b2b7c1`. Production preflight on
  Node 22.22.2: both services active, health 200, release `d890655607dc`.
  Checksum dry run reviewed; unrelated `src/create.js` difference excluded.
  Private checkpoint `/root/niral-upgrade-checkpoints/20260909-7b2b7c1` preserves
  framework/docs source, previous release and environment. Targeted transfer
  completed; four form and six inference regression groups passed on Node 22.22.2.
  Docs syntax passed; environment matches its backup byte-for-byte.
- Deployment completed: production release `f3432dab528d` built on the host and
  passed integrity checks for all 50 files before application restart. Watchdog
  briefly stopped for build/activation and restored. Both services active;
  startup logs show normal shutdown/restart and health returns 200 on the new release.
- Local and public HTTPS homepage, Server, TypeScript and Validation guides all
  returned 200 with the updated content. Production environment/data preserved;
  unrelated remote `src/create.js` and local instruction/spec files untouched.
  Feature pushed through `7b2b7c1`; no npm publication.

## 2026-09-09: End-to-End Type Inference

- Installed the existing pinned TypeScript 5.7.3 development tool in `.niral/`.
  Fixed its cache package scope so CommonJS TypeScript loads inside ESM projects.
- Checker uses virtual server modules for JS/JSDoc and TS RPC signatures, async
  results and page-local loader data; route parameters are strings. Generic async
  RPC signatures are preserved. Untyped TS loader parameters receive context.
- Component contracts infer annotated props and default values. Template checks
  cover prop values, required props, callbacks, binding write-back, and local
  loop/conditional/await scopes, with diagnostics mapped to original source.
- LSP performs debounced checks using unsaved document overlays and refreshes
  parent diagnostics after child contract edits. No compiler means existing
  syntax diagnostics remain available; it never auto-downloads a compiler.
- Five focused inference/LSP/installer regression groups passed with the real
  compiler. Full suite: **195 passed, 0 failed**, with TypeScript explicitly enabled.
  Optional external image-tool and live Postgres checks remain environment-gated.
  Updated the TypeScript guide with examples and limitations, and corrected the
  editor's outdated "not checked" hint. Docs syntax and completion-hint checks
  passed; local docs build produced release `d890655607dc` (3 routes).
- Commit and site deployment authorized on 2026-09-09. Pre-deployment inspection:
  Node 22.22.2, both services active, health 200, active release `b56a025ac2ea`.
  Feature commit: `f18532c`. Deployment checkpoint created at
  `/root/niral-upgrade-checkpoints/20260909-f18532c`: source, previous release
  `b56a025ac2ea`, release path and environment backup. Targeted rsync dry run
  reviewed. Environment/data were excluded from transfer.
- Targeted production transfer completed. All five inference/installer/LSP test
  groups passed on Node 22.22.2 using a private compiler copy in the checkpoint.
  Docs source syntax passed and environment matched its backup byte-for-byte.
- Deployment completed: release `d890655607dc` built on Node 22.22.2 and passed
  integrity checks for all 49 release files before service restart. Both
  `niral-demo` and `niral-demo-watchdog` are active; logs show normal restart.
- Local health, homepage and TypeScript guide returned 200. Public
  `https://niral.site/` and `https://niral.site/docs/typescript` returned 200;
  the guide includes inferred server contracts, component contracts, unsaved
  editor diagnostics and the documented limitations. Environment/data preserved.
- No Git push or npm publication in this deployment; unrelated instruction/spec
  changes remain untouched. The feature and deployment record are committed locally.
- Previous API/component commits were successfully pushed to `origin/main`
  through `f6dcd19` on 2026-09-08; prior no-push statements record earlier checkpoints.

## 2026-09-08: Native HTTP API Routes

- Added `.server.js` method endpoints with native Request/Response, dynamic and
  catch-all parameters, deterministic specificity and route-collision checks.
- Shared dev/prod execution supports HEAD fallback, OPTIONS/Allow, 405, streaming,
  multiple cookies, middleware locals and persisted session writes.
- Bodies default to a bounded 1 MiB; oversize requests return 413. Malformed JSON
  and URLs return 400; cross-host Origin writes return 403. Production 500s hide details.
- Production builds include a private, syntax-checked ESM dependency graph and hash
  imported helpers. Dev reloads changed dependency graphs. API-only builds work.
- Added `niral add api`, a full API documentation page, sitemap entry and five
  regression groups covering authenticated CRUD, byte-exact signed webhooks,
  dev/prod parity, private-source blocking, scaffold safety and failed-build rollback.
- Verification: **190 passed, 0 failed** in `npm test`; focused API tests and docs
  JavaScript syntax checks passed. Fixed a public-file enumeration regression so
  generated Tailwind CSS remains included in builds. Runtime dependencies remain empty.
- Commit and deployment explicitly authorized. Read-only production inspection:
  Node 22.22.2, `niral-demo` and watchdog active, health 200, release `8a3ac074df89`.
  `/opt/niral` has no Git metadata; use checkpointed file synchronization.
- Docs build `b56a025ac2ea` passed; a local production-server smoke check returned
  200 for `/docs/api-routes` and rendered the endpoint and signed-webhook sections.
- Feature commit: `352034e` (`feat: add native HTTP endpoints and component composition`).
- Authorized production deployment completed: release `b56a025ac2ea` built on
  Node 22.22.2 and passed integrity validation before restart. Both `niral-demo`
  and `niral-demo-watchdog` are active; recent service logs show normal startup.
- Remote API regression groups passed. Pre-activation validation found the older
  host lacked `src/server/stream.js`; synchronized it and its matching renderer
  from the committed source before rerunning successfully.
- Local health and API docs returned 200; public `https://niral.site/` and
  `https://niral.site/docs/api-routes` returned 200 with the signed-webhook guide.
- Rollback checkpoint: `/root/niral-upgrade-checkpoints/20260908-352034e`, containing
  source archive, active previous release, release path and environment backup.
  Production environment and persistent data were preserved. No Git push or npm publish.

## 2026-09-08: Component Composition and Lifecycle Upgrade

- Added named component slots, default/named fallback content, and wrapper-free
  `<template slot="name">` groups in the compiler and both renderers.
- Preserved the existing default-slot callback API. Slot assignments are static,
  direct component children; invalid names report `NIRAL060`.
- Added parent-opt-in component bindings (`<Editor bind:value={state}/>`),
  property paths and wrapper forwarding. Normal props remain read-only; invalid
  binding targets report `NIRAL061`. Child DOM and local state survive updates.
- Added `onMount`/`onDestroy` script ambients and checker declarations. Mounts run
  after attachment/hydration in a browser microtask and are canceled on early
  disposal. Cleanup is owned, idempotent and runs after failed setup as well.
- Runtime effects now run returned cleanup before re-execution and disposal.
- Added component documentation and seven regression tests covering slots,
  binding directions/forwarding/paths, lifecycle, SSR parity and hydration.
- Verification: `npm test` completed with **185 passed, 0 failed**. Focused
  binding/lifecycle checks passed; changed JavaScript has no editor diagnostics.
  Optional TypeScript, image-tool and live Postgres checks remain environment-gated;
  no real-browser Playwright suite was run.
- No dependencies were added. At this component-only checkpoint there were no
  production changes, commits or pushes; see the API entry above for deployment.

## 2026-09-08: Standalone Repository Relocation

- Moved the entire independent repository from
  `/Users/redfoxhotels/zyorabyte/niral` to `/Users/redfoxhotels/niral`.
- Verified identical HEAD and full untracked-file status immediately after moving.
  HEAD remained `7cc0e03`; origin remained
  `git@github-zyorabyte:Zyora-Dev/niral.git`.
- Preserved Git history, private data, generated files, existing `AGENTS.md`, and
  untracked `.kiro/` specifications. The parent repository did not track Niral files.
- Added portable `PROJECT_CONTEXT.md` from Niral-specific assistant memory and
  relevant historical context, plus `CLAUDE.md` loading instructions and progress.
- No tracked old absolute source-root references were found before context updates.
- No application code change, dependency installation, commit, push, build, test
  suite run or production deployment was performed. Verification is scoped to
  relocation integrity and portable context documents.