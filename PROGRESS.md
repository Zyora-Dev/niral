# Niral Progress

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
- Commit and checkpointed deployment are pending at this entry.

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
- No dependencies, production changes, commits, or pushes.

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