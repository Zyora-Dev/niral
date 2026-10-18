# Niral Progress

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