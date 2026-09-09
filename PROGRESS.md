# Niral Progress

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