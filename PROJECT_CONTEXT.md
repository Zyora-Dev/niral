# Niral Project Context

Transferred from ZyoraByte-scoped Niral memory on 2026-09-08. This file is the
portable repository-owned context for future sessions. Operational facts below
are historical unless explicitly marked as verified with a date.

## Identity and Repository

- Niral is a zero-dependency, compiler-first full-stack web framework by ZyoraLabs.
- Framework source and the landing/docs app (`apps/docs`) belong to this repository.
- Local root: `/Users/redfoxhotels/niral` (verified 2026-09-08).
- Former root: `/Users/redfoxhotels/zyorabyte/niral`; moved intact, not copied or recreated.
- Git remote: `git@github-zyorabyte:Zyora-Dev/niral.git` (verified 2026-09-08).
- Branch: `main`; relocation HEAD: `7cc0e03` (`fix: make npm launcher scaffold reliably`).
- Refresh upgrade and EC2 configuration committed as `1d41d44` and pushed to
  `origin/main` on 2026-10-17 with user approval. Live changelog uses GitHub
  history with a 10-minute cache. Private keys and unrelated local work excluded.
- The existing untracked `.kiro/` specifications were preserved unchanged.
- Read `AGENTS.md` for the compiler, runtime, routing, security, CLI and contribution rules.
- The framework must retain zero runtime dependencies. Do not apply the parent
  project's FastAPI/Next.js setup or deployment conventions to Niral.

## Local Development

- Semantic safeguards (2026-10-26, verified local): named-function return paths now
  feed readonly and method-override alias checks. Captured locals are checked
  against active caller positions; initialized captures remain valid. All 28
  language tests and diagnostics pass. Runtime derived reads now detect dependency
  cycles; recovery and all 257 framework tests pass. Cross-module diagnostics and
  logical aliases pass. Full standard local release gate passes, including browser/
  forms and both offline installer flows; Windows/extended gates not run. Unknown
  host calls and escaping closures remain outside analysis. Props/server-data
  support is next. No publication, deployment, commit or push.

- Standalone NiralScript checking (2026-10-26, local): `./check` exposes
  checkNiralScript, composing the existing independent frontend with explicit
  host policies. Check-only CLI supports guarded root-relative graphs, declared
  globals, text/JSON diagnostics and exit codes; no execution/emission. All 28
  language tests pass, including an isolated copied CLI; executable help and
  diagnostics clean. Package exports and all 6 release/build checks pass. Full
  standard release gate passes, including browser/forms and both offline installer
  flows; Windows CI and optional extended gates not run.
  Dedicated editor support remains deferred. No production changes.

- NiralScript modules (2026-10-26, local): independent graph linker, named imports
  and aliases, const/function exports, isolated scopes and cross-module semantic
  checks implemented. Guarded filesystem imports feed existing SSR/build source
  tracking; private/server .nrs files cannot be client dependencies. 26 language,
  6 release and 2 focused Chromium tests pass, including multi-file dev/production
  components and transitive browser reload. Isolated-core module loading, import
  terminators and eager-read/RPC isolation checks pass. Full standard local release
  gate passes, including browser/forms and both offline installer flows. Compiler
  diagnostics and whitespace checks clean; Windows/extended gates not run here.
  See latest PROGRESS.md checkpoint for limits; no production changes.

- Post-optimization comparison rerun (2026-10-26, local): all three unchanged
  bench/niralscript.js modes pass. Fresh JS/TS/NRS compile medians ms:
  counter .0222/.0316/.0433, 100 pairs .5930/6.4454/.8371,
  1,000 rows 1.4071/5.4329/2.8518. TS means Niral stripping, not tsc.
  JS fastest; NRS faster than this TS pipeline on larger fixtures, with all NRS
  checks retained. SSR/browser behavior parity passes; no consistent runtime
  winner. TS5.7.3 fresh strict-check medians 87.40/90.83/157.70 ms include library
  reads/parsing, not comparable to NRS checking. Three diagnostic probes confirm
  distinct name/effect versus type guarantees. Full tables/caveats in PROGRESS.md.
  No compiler/runtime changes; full release gate passed in preceding checkpoint.

- NiralScript tokenizer optimization (2026-10-26, local): profile-led first-character
  dispatch skips irrelevant regex/comment probes while retaining Unicode trivia,
  token spans and all semantic passes. Unchanged benchmark NRS medians before/after
  ms: counter .0376/.0401, 100 pairs .8569/.8417, 1,000 rows 3.8726/2.8851.
  Data-heavy compilation takes about 25.5% less time; no clear small-fixture gain
  or runtime-speed claim. Output sizes/SSR/backend parity unchanged. 23 language
  tests, build/release integration tests and the full standard local release gate
  pass (including browser/forms and packaged installer smoke tests). Diagnostics
  and whitespace checks clean. No caching, runtime, dependency or production
  changes. Details and caveats in PROGRESS.md.

- Three-language benchmark (2026-10-26, local): bench/niralscript.js now compares
  NiralScript/JS/annotated TS using balanced 12-round batches; browser and types
  modes reuse existing Playwright and TypeScript installations. Final JS/TS/NRS
  compile medians ms: counter .0211/.0313/.0401, 100 pairs .5882/6.4463/.8701,
  1,000 rows 1.4717/5.5424/3.7612. TS here is Niral's stripping pipeline, not tsc.
  Chromium hydration/update and SSR parity pass; no consistent runtime winner.
  Separate fresh TS5.7.3 strict/noEmit program medians81.77/89.70/137.85 ms include
  standard library reads/parsing, not incremental/editor timing. Diagnostic probes
  distinguish NRS name/effect checks from TS type checks. All modes and 22 language
  tests pass; no compiler/runtime/dependency/production changes. Full gate was
  earlier for direct backend, not rerun for benchmark-only work. README commands
  and PROGRESS full tables document scope and limitations.

- NiralScript direct runtime backend (2026-10-26, local): compileClient now feeds
  the independent parsed/analyzed NRS AST into runtime emission, skipping rune
  discovery/import hoisting/script rewriting. Metadata comes from resolved bindings;
  source-span edits preserve syntax and scope. Lowering APIs remain rune-compatible;
  returned component AST retains original NRS script text. JS/TS/JSX/TSX/template
  pipelines unchanged. 22 tests and benchmark parity pass, diagnostics clean.
  Same-process paired script backends direct/via-JS ms: .0174/.0248, .3718/.5085,
  2.9064/3.6869 (counter/100 pairs/1,000 rows), 21-30% less script compilation time.
  Full NRS component compile .0405/.8540/3.6526 ms, still 1.40-2.53x handwritten
  Niral JS in this run. No runtime-speed claim. Six build/release tests and full
  release gate pass, including browser/forms and both offline installer smoke
  checks. Windows CI not run; no production/dependency changes.
  Details and limitations in PROGRESS.md.

- NiralScript compiler optimization (2026-10-25, local): CPU profile identified
  reflective AST traversal as the largest hotspot. Explicit node dispatch replaces
  repeated entries/filter/flatMap and values enumeration without removing semantic
  passes or mutating the AST. 21 language tests pass, including new nested traversal
  regressions. Unchanged benchmark compile medians: 0.0471/1.0133/4.4005 ms for
  counter/100 state-derive pairs/1,000 rows, versus earlier 0.0596/1.5263/7.7152 ms.
  Separate-run comparison only; output parity and raw/gzip sizes preserved. Six
  build/release tests and full npm run test:release PASS, including browser/forms
  and both offline installer checks. Windows CI not run. No dependencies or
  production changes. See PROGRESS.md for timing methodology and limitations.

- NiralScript benchmark (2026-10-25, local): `node bench/niralscript.js` compares
  warm compilation/string SSR and generated raw/gzip sizes against handwritten
  Niral JS, with parity assertions and 11 alternating batches. Apple M1/Node25.6.1:
  compile medians NRS/JS counter 0.0596/0.0221 ms, 100 state/derive pairs
  1.5263/0.6076 ms, 1,000 inline-data rows 7.7152/1.4984 ms. SSR essentially equal
  in this run (ratios 0.98-1.05); no cross-framework/runtime-speed claim. All 26
  language/release tests and both Chromium scenarios freshly pass. See PROGRESS.md
  for methodology, sizes and limitations. No compiler/dependency/production changes.

- NiralScript integration (2026-10-25, LOCAL VERIFIED; supersedes pending items in
  earlier milestones below): bounded derived effects/cycles, readonly-alias and
  eager captured-read checks implemented. Intrinsic policies live in the adapter;
  arbitrary host purity and function-return aliases are not proven. External .nrs
  instance scripts work through guarded relative src loading in dev/build/SSR,
  source-byte cache/hash invalidation and full reload on external changes. Raw
  .nrs files are private; external diagnostics preserve file/range and component
  LSP links them. Process aliases/computed access are rejected. 20 language tests,
  6 release/build tests and two focused Chromium scenarios pass. Full local
  npm run test:release PASS including all browser/forms and installer smoke tests.
  Windows CI not run; no deployment/publication/deps/commit/push. Module imports,
  exports, standalone tooling and React/Next.js remain pending. See NIRALSCRIPT.md
  for supported rules and explicit semantic limitations.

- NiralScript statements/scopes (2026-10-25, local): functions/nested closures,
  parameters, let/const, blocks, if/else, assignments, calls and return implemented.
  Independent analysis.js resolves explicit globals and lexical bindings; Niral
  passes RPC names and renames nested bindings before reactive rewriting.
  Duplicate/unresolved names, direct eager use-before-initialization and immutable
  writes have source-spanned diagnostics. Sixteen language checks pass including
  executed SSR; editor diagnostics clean. Five release checks and main255/255
  pass; focused Chromium dev/production passes with named handlers, shadowing,
  hydration, state, bindings, keyed lists and RPC. Full release/Windows CI not
  rerun. Derived purity/cycles, indirect mutation and
  interprocedural initialization remain incomplete; external .nrs and other
  targets remain pending. Supersedes older statements/scopes-pending notes.
  No production changes, dependencies, publication, commit or push.

- NiralScript expression parser (2026-10-25, local): independent expressions.js
  builds precedence-aware ASTs for validated initializers, retaining raw/trivia
  for compatible Niral emission. Covers literals, collections, calls/members,
  conditionals and nested templates; rejects unsupported syntax with NRS071 /
  mapped NIRAL071 and original spans. Verified: 13 language tests, 5 release
  tests, main255/255 and focused Chromium dev/production scenario all pass.
  Full release/Windows CI not rerun. Supersedes older RawExpression-only notes.
  Functions, statement/scope/semantic analysis and external .nrs remain pending.
  No production changes, publication, dependencies, commit or push.

- NiralScript website page (2026-10-25, deployed and verified): `/niralscript`
  describes the independent language, embedded prototype and planned integrations.
  Shared header/footer and sitemap updated. All three docs SEO tests pass with
  Chromium, including 390/1024/1440 layouts and mobile menu; screenshots reviewed.
  Published at https://niral.site/niralscript with four website files only;
  local language/compiler changes are not deployed. Node22.23.3 unchanged.
  No package publication, commit or push.
  Staging now passes on the existing production runtime: releaseba264ec1f6f4,
  28 sitemap pages, 10 assets, privacy checks and integrity59/59. Private rollback
  checkpoint is `/root/niral-upgrade-checkpoints/20261025-niralscript`. Live
  build matches stage, activated16:12:27UTC (PID88688,NRestarts0). App/watchdog/
  nginx active; origin/public health, pages, navigation, sitemap and language
  asset200. Public390/1440 browser checks pass for title/canonical, fonts/images
  and overflow. Logs healthy; environment byte-identical and old85a914d39113
  retained. Data/config/framework untouched. Staging copy retained privately.

- NiralScript directory separation (2026-10-25, local): independent core is now
  root-level `niralscript/` (parser.js, scanner.js, errors.js, private ESM package).
  It has zero dependencies and no framework imports. src/compiler/niralscript.js
  retains the Niral emitter and compatibility diagnostic adapter (NRS -> NIRAL).
  Build identity includes the new directory; copied installer fixtures include
  it too. Verified: 9 language + 5 release tests, 18 CLI checks, main 255/255.
  Initial main failure was the incomplete fixture, repaired and rerun green.
  Standalone .nrs loading and new syntax remain pending. No browser/full-release/
  Windows rerun, publication, deployment, commit or push.

- NiralScript declaration AST (2026-10-25, local): parseNiralScript returns
  target-neutral source-spanned declarations; emitNiralScript selects Niral
  runes. Existing lowerNiralScript composes both. Initializers remain explicit
  RawExpression nodes. Eight focused tests and main suite255/255 pass, including
  exact emission, span/trivia preservation, diagnostics and DOM/string SSR.
  This is implementation step1 of NIRALSCRIPT.md, not standalone .nrs support
  or a full expression parser. No browser/full-release/Windows rerun, dependency
  installation, deployment, commit or push. README/draft/progress updated.

- NiralScript direction (2026-10-25): user confirmed independent language with
  `.nrs` extension; `.niral` remains the framework component format. Niral first,
  other framework integrations later. NIRALSCRIPT.md is the proposed v0.1 design,
  not implemented support: portable semantics, instance/utility scope, external
  script integration, secure resolution, compiler stages and acceptance gates.
  Current executable support remains the embedded experiment described below.

- NiralScript experiment (2026-10-25, local): opt-in script lang="niralscript"
  lowers top-level state/derive declarations into existing reactive codegen.
  Six focused compiler/SSR tests pass, including original-component diagnostics.
  Chromium dev + built-production test passes: hydration without warnings,
  state/derived updates, input binding, retained keyed nodes and local RPC.
  Main regression 255/255 passed; focused tests added to release gate. Full
  release/Windows CI not rerun. README and tests/fixtures/niralscript.niral show
  usage. Prototype keeps HTML/CSS/events, not the illustrated view syntax.
  Function/import declarations, standalone extension and dedicated type-checker/
  editor integration are not implemented; expressions inherit existing rewriter
  limitations, not a full JS grammar. No production changes, commits, dependencies,
  default language replacement or all-language compatibility promise.

- Security hardening 2026-10-25 (local only): reproduced dev private symlink/junction
  disclosure and uppercase component compilation bypass. Shared descendant-file
  guard rejects links/non-regular files; static builds skip links, private names
  case-insensitively and raw component sources. Unsafe decoded paths and private
  dev RPC targets are rejected. RPC shares form-origin validation; absolute request
  targets cannot redefine the origin; NIRAL_ORIGIN enables exact proxy-facing origin
  matching. Main harness 255/255 passes with dev/build/prod regression coverage.
  Full local release gate passed, including TypeScript, focused checks, Chromium,
  forms/navigation and both packed launchers. Postgres/image tools unconfigured;
  no new Windows CI, commits, pushes, publication or deployment.
  Rebuild apps to remove previously copied private/source files.
  Local Node25.6.1 has not been upgraded; official October21 security releases are
  22.23.4/24.22.1/26.12.1. Middleware is not a substitute for a patched runtime.
  Filesystem root/release contents remain trusted; no local race/hard-link sandbox.

- Windows CI added 2026-10-25: separate `windows-latest` Node 22/24 jobs run the
  existing release gate with isolated TypeScript and Chromium. Linux extended
  Postgres/image jobs are unchanged; Windows does not configure those optional
  gates. Windows npm packing/installing uses npm's JavaScript entry through Node.
  Initial run `40193731256` passed Linux but Windows had 240 passes/12 failures.
  Portability fixes are verified: shared build/rollback junction activation
  (5 focused tests pass), portable file URLs, permission assertions and Tailwind
  fixtures. POSIX activation remains atomic; Windows uses a guarded swap with
  error restoration, not crash-atomic replacement. Interrupted Windows activation
  retains the previous link and lock for manual recovery. Local main harness:
  253 passed, 0 failed. Full local release gate passes, including Chromium/forms
  and both packed launchers.
  Fix `f01ae36` / CI `40194727900`: Linux green; Windows activation errors gone,
  but three tests still expected relative symlink text. Follow-up normalizes all
  five affected destination assertions; local harness 253/253. Source `5d75a73`
  passed all four Windows/Linux Node 22/24 jobs in CI `40195078246`, including
  main/focused tests, Chromium, forms and packed-launcher scaffold/build/test.
  Linux extended Postgres/image checks passed; Windows leaves them unconfigured.
  No npm republication or production deployment is part of this change.

- Release reliability work approved 2026-10-25: user explicitly authorized npm
  publication plus source commit/push including Devtools tracing, not a website
  deployment. Immutable staged builds and framework/output-aware hashes pass four
  focused checks. Shell/npm safety parity and persisted `NIRAL_REF` pins pass 18
  offline launcher checks, including direct updates of older pinned CLIs. Combined
  release gate passes locally and on Node 22/24 Linux CI, including Postgres/image
  gates in CI (unconfigured locally). Root Node requirement is now >=22. Registry
  discovery found both launchers at 0.1.3 before the 0.1.4 uploads recorded below.
- Final 0.1.4 gate passes: 252 main checks, 15 focused Node tests, 10 Chromium
  scenarios, four form/navigation combinations, actual five-file package installs
  and isolated scaffold/build/test against current source. User completed npm
  login; `npm whoami` verifies `zyoralabs`. Source including Devtools tracing is
  committed/pushed as `825256b57262da6e326fc6219950b54d60472100`, remote verified.
  niral@0.1.4 and create-niral@0.1.4 are registry-verified with matching validated
  tarball checksums and both latest tags at 0.1.4. Fresh registry installs passed
  five-file/zero-dependency checks, help/version without download, remote scaffold,
  build/test, offline cache reuse, immutable rebuild, main update, exact source
  pins, persisted shim updates and unpinning. Older-revision shim and older-archive
  upgrades passed; private-data backup preserved. Temporary homes removed.
  CI runs40190853399 and40191032126 succeeded, including Node22/24 extended gates.
  Windows remains unverified. No deployment.

- Full-stack error tracing verified locally (2026-10-25), subsequently published
  in source commit825256b, not deployed: Errors tab records redacted browser/rejection/runtime/RPC failures,
  grouped into 100 bounded groups with 20 recent occurrences each. Opaque local
  response IDs join exact server traces across concurrent and streamed calls.
  Event attribution covers synchronous handlers only. VS Code links cover unique
  unchanged `.niral` script lines; transformed/duplicate lines and templates are
  unresolved, not guessed. No server source, messages, stacks or payloads are
  retained in browser error history. Seven focused Node tests, framework245 and
  browser10 pass; responsive screenshots reviewed and production exclusion tested.
  Disposable preview refreshed at http://localhost:51644; page/API/tracker and
  response-to-trace correlation verified against the running process.

- Devtools verified locally (2026-10-25): request-scoped, 100-record metadata
  buffer with loopback/Host/origin/forwarded-header restrictions; no payloads,
  raw URLs, dynamic values, headers or error content. Shadow-DOM panel provides
  filters, route/layout/loader/RPC timings, failure categories and polling controls.
  Four collector/HTTP tests pass, including auth redirects and loader/stream
  failures; framework245/browser9 pass with existing environment gates. Desktop
  and mobile captures reviewed; production launcher/endpoints absent. Preview:
  http://localhost:51644. That initial checkpoint excluded browser-error tracing;
  dedicated form-action spans remain outside this inspector. Source committed as
  `f89e484`; user authorized GitHub publication
  to `Zyora-Dev/niral` on `main`. Local agent/editor settings excluded. README
  updated; no production deployment or npm publication for Devtools.

- Source release checkpoint (2026-10-25): user authorized commit/push of pending
  framework and website changes; code commit `f6cd621` contains 43 files. Private
  data and local editor/agent settings excluded. Framework245/browser8 passed;
  docs/contact7 passed with one optional browser skip; environment-gated framework
  checks remain optional. Shell/npm launchers fetch framework from GitHub main;
  existing managed installs use `niral update`. No npm version bump is needed for
  framework changes, and existing app routes are not rewritten. npm README updates
  need a separate package publication; running apps need a separate deployment.
  No production deployment or npm publication performed for this checkpoint.

- Error screens matched to the starter theme (2026-10-25): shared default 404/500
  pages and compile/runtime overlays now use charcoal/white/saffron gold and pinned
  Lucide CDN icons. Text labels, diagnostic escaping/redaction, production privacy,
  custom-page precedence and copy/dismiss/focus behavior retained. Browser suite
  8 passed with responsive/icon/privacy checks and captures reviewed; focused
  renderer security/syntax checks and editor diagnostics pass. Disposable preview
  restarted at http://localhost:49867 (`/missing` for 404). Only the disposable
  browser-test fixture was built; no website build, deployment or publication.

- Starter palette updated at user request (2026-10-25): charcoal/white/saffron gold
  with gold original logo mark and Lucide line icons. Supersedes the light/green
  palette below while retaining its layout. Uses the same pinned Lucide CDN assets
  as docs, so icons require network access; no npm dependency. Generated compile,
  four-width browser/image checks and starter interactions pass; captures reviewed.
  Local preview remains http://localhost:49867; no production build/deployment.

- Starter layout revised locally (2026-10-25) in `src/create.js`: dark project
  sidebar, light workspace, vertically arranged demos and compact mobile header.
  Existing interactions and logo retained; static/error pages unchanged. Generated
  compilation and six-width Chromium layout/interaction checks pass. Current preview
  http://localhost:49867, `/tmp/niral-preview-cWHKlj/app`. Visual approval pending;
  no production build or deployment. Supersedes the home layout and preview below.

- Starter and diagnostic redesign completed locally (2026-10-18). `src/create.js`
  generates the refined home/static pages and copies the original logo. Dev overlays
  have separate compile/runtime labels, isolated CSS, copy/dismiss controls and
  keyboard focus management. `src/server/page.js` supplies default 404/500 HTML;
  custom app error pages still win, production diagnostics stay private, and dev
  stacks remove encoded generated-server source. Framework245/browser7 passed;
  final stack redaction separately verified and browser-confirmed. Preview:
  http://localhost:56885 (`/compile-error`, `/server-error`, `/missing`), disposable
  files `/tmp/niral-preview-HrU4vg/app`. Newly generated apps only; not distributed
  or deployed. Existing docs preview 5199 and production were not changed.

- About Us page added locally (2026-10-18), http://localhost:5199/about. Positions
  Niral JS as ZyoraLabs' flagship framework and explains the compiler/full stack,
  zHost deployment cloud, self-hosting choice and India origin. Shared navigation
  and footer link it; AboutPage JSON-LD and full metadata included. Sitemap now has
  27 pages. SEO tests pass (3); Chromium verifies five widths, images, mobile menu,
  footer navigation and metadata; desktop/mobile captures reviewed. No deployment.

- Website SEO completed locally (2026-10-18) across 26 pages: 22 guides plus
  home/DI/contact/changelog. Authored titles/descriptions, visible guide summaries,
  canonical/social tags, linked breadcrumbs and shared JSON-LD. Initial HTML has
  full metadata; Seo component synchronizes it after client navigation. Docs hooks
  provide canonical redirects and 404/noindex for invalid guide slugs. SEO crawl
  and Chromium navigation checks pass (3 tests); contact tests 4 passed/1 optional
  browser test skipped. Screenshots reviewed at 390/1440px. Preview refreshed on
  port 5199; no production build/deployment or private configuration changes.
- Native head constraint: child component heads are not included in initial SSR;
  root static page heads use literal values, dynamic guide heads use loader props.
  Do not replace static head values with client-script constants. Imported content
  helpers can remain cached in dev; restart the preview after editing them.

- New local `/di` page (2026-10-18) explains Developer Intelligence with approval,
  provider-data-boundary and write-lifecycle infographics, provider selector,
  copyable commands and detailed safety/API FAQs. Shared desktop/mobile header
  highlights DI; footer and sitemap link it. Current DI README is content authority.
  Chromium verifies selected-provider styling, seven exact command copies and
  denied feedback, seven FAQs, mobile menu, assets/fonts, hydration, text/page
  bounds at six widths (320-1920px), home/contact client navigation and sitemap.
  Desktop/mobile captures reviewed; user approval and production build pending.
  No dependencies, live provider calls or deployment. Preview: http://localhost:5199/di.

- Contact email sender display name is `Niral.js` (REST `from: { address, name }`).
  Address still comes from CLOUDFLARE_EMAIL_FROM; focused mocked provider test
  passes. No live email sent specifically for the display-name change.
- Cloudflare contact notifications added locally on 2026-10-18. Server-only
  `sendContact` saves the existing private copy then calls the Email Sending REST
  API with native fetch, a ten-second timeout and visitor `reply_to`. Recipient:
  developer@niral.site. Delivered/queued responses succeed; other outcomes report
  saved-but-not-notified without leaking upstream errors. Private ignored
  `apps/docs/.env`: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN (Email Sending:
  Edit), optional CLOUDFLARE_EMAIL_FROM (default developer@niral.site). Preview task
  loads that file at startup; restart after credentials change. User populated
  credentials; initial test failed with HTTP 404 / Cloudflare error 7003. After
  user correction, one requested retest to info@zyoralabs.com returned HTTP 200
  and `queued`: live API acceptance verified, final inbox delivery unconfirmed.
  Preview not restarted for the standalone test; default contact recipient
  unchanged. Five contact tests pass with mocked Cloudflare
  and actual JS/no-JS browser submissions. Shared SiteHeader/SiteFooter used by
  homepage/contact; route markup equality verified. Local only, not deployed.

- Contact Us page added locally on 2026-10-18 at `/contact`, linked in homepage
  footer and sitemap. Native form actions persist to private `apps/docs/data/contact.db`
  using `lib/contact.js`; originally storage-only (email integration above). Includes validation,
  honeypot and one/minute, five/day per-email limits. Matching graphite/white/gold
  design and original logo; direct email/WhatsApp preserved. Empty textarea text
  corrected in both SSR renderers and client hydration. Four contact test groups
  pass, including real Chromium submissions with/without JavaScript and temporary
  inboxes: `NIRAL_CONTACT_BROWSER=1 node --test tests/docs-contact.js` (browser tooling
  lives in tests/browser). Without the flag, three Node groups run and browser is
  skipped. Framework suite: 244 passed. Desktop/mobile screenshots, navigation,
  assets, hydration and no-overflow checks at 320-1440px pass. Preview:
  http://localhost:5199/contact. Visual approval pending; not deployed.

- Current homepage footer (2026-10-18) follows the user's supplied Dribbble
  reference: https://dribbble.com/shots/27425078-Modern-Website-Footer-UI-Design.
  Rejected ruled-row/contact-panel version is superseded. Black background,
  four compact navigation columns, divider and centered copyright. Latest request
  removes the large bottom logo entirely. Only the small `/niral-logo.svg` remains,
  with its original icon shape in saffron gold (#f2b544) and lettering white via
  scoped CSS/masking; the shared asset is unchanged. Do not restore the large
  logo, standalone `n.png` mark or typed NIRAL lettering.
  Email `developer@niral.site` and WhatsApp `https://wa.me/918940189694` occupy
  the reference's right-hand area; all 12 navigation destinations preserved.
  Chromium checks at nine widths from 320-1920px, desktop/mobile screenshots
  and editor diagnostics pass. Logo correction additionally verified at
  320/390/768/1440px with desktop/mobile captures. Local visual approval pending at
  http://localhost:5199/#footer; no full build or deployment.

- Current homepage (2026-10-18) is a complete replacement; both previous layout
  iterations were rejected and are superseded. Svelte/Next.js references informed
  a left-aligned brand opening, development strip, working counter/todo code and
  preview, asymmetric feature grid, consolidated benchmarks/deployment, resources
  and new footer. Native interactive Niral replaces the static homepage; Geist,
  graphite, white and saffron gold retained, no runtime dependencies added.
  Local Chromium passes counter/derived/reset, todo actions, hosting switches,
  mobile navigation, all 13 linked guides, icons/fonts, and no page/heading/card
  overflow at 320-1920px. All three copy actions verified with exact clipboard
  readback plus denied-copy feedback. Desktop/mobile screenshots inspected;
  editor diagnostics clean. Historical benchmark figures remain qualified, not
  rerun. Preview http://localhost:5199/; user visual approval and production build
  pending. No deployment/release; docs/changelog and unrelated work preserved.

- Earlier homepage (now superseded) and changelog refined locally on 2026-10-18 to match the chosen docs
  theme: self-hosted Geist Sans/Mono, black/graphite, white and saffron #f2b544.
  VoltJS reference informed the dark surfaces, gold emphasis and code treatment.
  Prominent Niral hero, clearer full-width sections, restrained feature cards,
  unframed metrics/scaling and month-based commit timeline. Native details mobile
  menus; homepage remains static, changelog loader/cache/fallback preserved.
  Browser screenshots/assets/fonts/navigation, homepage widths320-1920 and
  changelog390 checked; 56 loaded entries preserved. Diagnostics/whitespace pass.
  Fixed a literal entity in scaling copy, with browser text verification.
  Preview http://localhost:5199/. No full build/deployment; visual review pending.

- Current local docs theme (2026-10-18) supersedes the earlier emerald styling:
  user chose black/graphite gradients, white text and saffron gold (#f2b544).
  Shared layout tokens cover navigation/search and article UI, including starter
  kit, code panels, tables and pager. Group titles are white with dividers; accents
  are restrained. Geist, content and spacing retained. Docs logo uses a scoped
  monochrome filter; shared asset unchanged. Browser theme-color updated.
  Desktop/mobile screenshots, 320/390/1440px overflow, search/navigation/drawer and
  diagnostics verified. No full build/deployment; visual review remains local.

- Documentation uses self-hosted Geist Sans (CSS family "Geist"). On 2026-10-18,
  extended it to all documentation buttons, inputs and selects; browser checks
  confirm loaded Geist, with Geist Mono retained for code/prompt preview. Local
  screenshot and diagnostics verified; no dependencies added or deployment.

- Sidebar hierarchy refined locally on 2026-10-18: section headings are now bold
  uppercase emerald with fine dividers; link styles and spacing are unchanged.
  Browser styles/screenshot and file diagnostics verified. Not deployed.

- Local Getting Started agent kit added2026-10-18: compact card with VS Code,
  JetBrains, Claude Code and Codex logo images; copyable2,755-character Niral prompt
  and collapsed read-only preview. Content/nav preserved. Copy success and denied
  clipboard fallback verified with browser stubs; desktop/mobile320-1440 layouts,
  icon decode and navigation checks pass. Images use version-pinned public CDNs;
  no packages added. Native inline SVG in page components was observed to become
  HTML namespace after client navigation; the new copy control uses an SVG image
  instead. Compiler's client env guard also matches instructional strings, so the
  prompt says "environment variables". Local only; no deployment or agent execution.

- Follow-up visual feedback rejected the first docs presentation. Latest local
  correction is sidebar-only: no bullets, consistent36px rows/2px gaps/20px group
  spacing, active-page indicator, Lucide book-open SVG replacing the CSS placeholder.
  Native Niral menu, not installed React/shadcn components. All22 links and article
  content preserved; desktop screenshot and mobile320/390 navigation checks pass,
  including SVG rendering, active route and drawer close. Styles/fonts/logo load.
  Editor diagnostics clean. Still awaiting visual acceptance; no deployment/build.

- Docs presentation refined locally on 2026-10-18 in the shared docs layout,
  slug renderer and Markdown table wrapper. Wider three-column desktop layout,
  sticky top search, responsive navigation/page outline, clearer typography and
  section spacing, code headers/copy icons, scrollable tables and page-link cards.
  Existing content, dark Niral identity, local fonts and zero dependencies retained.
  Components compile; 22 guides render and 22 preview routes return200; diagnostics
  and whitespace checks pass. Browser verifies desktop/mobile layouts at320-1920px,
  navigation, anchors, search/reset, table width and copy feedback. Clipboard
  readback unverified because the browser permission API is unavailable.
  Local preview task runs at http://localhost:5199/docs/getting-started. Restart
  preview after changing project-imported helpers such as lib/md.js to clear cache.
  Visual review pending; no production build/full-suite rerun, deployment or release.

- Provider-first follow-up on 2026-10-18: setup now offers OpenAI (Responses/bearer),
  Claude (Messages/x-api-key/version 2023-06-01), Azure OpenAI (v1 Responses/api-key)
  and Custom (manual settings). Azure accepts resource or /openai/v1 URLs. Exact
  model/deployment and credential variable stay explicit; no probing or Bedrock
  adapter. DI10 passes with mocked wire requests and cancellation tests; full
  suite244/0, docs syntax and whitespace checks pass. No live provider calls.
  This work and the interactive fix below were subsequently deployed to EC2 as
  release35d6f8e95a5a; still uncommitted/unpushed and not distributed through npm.

- Local follow-up on 2026-10-18: bare DI setup prompts for exact settings (not
  secrets), with cancellation and explicit-flag automation preserved. Root bin
  mapping fixes npx selecting the local framework manifest without an executable.
  Offline npm exec help, DI8/CLI15 checks and full suite242/0 pass, including
  readline input/Ctrl-C/EOF. Docs syntax and editor diagnostics are clean.
  Docs updated; subsequently deployed to EC2 as release35d6f8e95a5a. Still not
  committed/pushed/published or in the installed user cache.

- DI commands implemented locally on 2026-10-18: `di setup/status/ask/chat/new`.
  Existing npm launchers forward these; config references an environment variable
  rather than storing credentials. Per-call approval gates bounded source-file
  tools, private-path checks, hash-conflict detection and external backups.
  `--read-only` removes writes; `--no-tools` allows prompt-only automation.
  Six focused offline CLI groups and full suite240/0 pass; fifteen launcher groups,
  docs syntax and diagnostics pass. Command/safety docs cover site and npm packages.
  No shell/test execution, streaming or transcript persistence. Both npm packages
  published as0.1.3 after user restored authentication (whoami zyoralabs).
  Both latest tags confirm0.1.3; exact registry records return200 with matching
  inspected checksums. Final package/docs checks pass.
  Fresh registry installs pass DI/help/version/config/cache, scaffolding/build/test
  and Git updates. Published launcher upgrades pre-DI1d41d44 archive with backup.
  Final docs releasebbc96b5529dd deployed after checkpoint20261018-npm013-cbf06d2,
  integrity50/50 and unchanged env. All services active, NRestarts0, public
  home/CLI/health200; browser confirms release wording and all DI commands.
  Previous7bd11bf2707e retained. Npm publication and docs deployment complete.
  Actual packed entrypoint DI help/version checks pass for both five-file archives;
  local documentation build passed (8ca5f61663cc).
  Release source d2cf087 committed/pushed to main with matching remote revision.
  EC2 checkpoint20261018-di-d2cf087 created; isolated Node22 validates16 DI,
  six DI CLI and15 launcher groups. Allowlisted source copied, installed DI help
  and syntax pass, env unchanged. Docs release7bd11bf2707e built as niral and
  activated after integrity50/50; all services active, no automatic restarts,
  public home/CLI/health200 and browser verifies all five DI commands. Previous
  cb55f099d593 retained. Release-facing preview notices removed for publication.

- Global CLI release prepared locally on 2026-10-18: successful side-effect-free
  help/version, explicit `niral update` and npm bootstrap updates of older cached
  frameworks, strict create arguments and custom-home launcher preservation.
  Git updates reject dirty/non-main/custom-origin installs and never destructively
  fallback; staged archive replacements preserve the previous directory. No
  automatic update or source-checkout/server update. Fifteen focused groups pass;
  real template creation is tested for both packages. Docs, package READMEs,
  allowlists and release checklist added. Final validation: 15 focused CLI groups,
  full suite 234/0 with real TypeScript, clean diagnostics/docs syntax, and actual
  local npm tarballs with five allowed files each. Extracted entry points pass
  help/version without downloads; Windows runtime remains unverified.
  Nothing version-bumped, published to npm or deployed in that earlier step.

- Niral DI implementation started locally on 2026-10-18. `src/di/provider.js`
  normalizes completed tool-calling responses for Chat Completions, Responses
  and Anthropic while retaining protocol continuation payloads. `src/di/agent.js`
  adds a bounded, cancellable loop with mandatory host validators and default-deny
  authorization. Sixteen mock tests pass via `node tests/di.js`, registered in
  the main harness. Live Azure Responses test passed on 2026-10-18 using exact
  deployment `gpt-6.1-sol`, API version `2025-04-01-preview`: two turns, one
  approved synthetic tool call, returned value verified; 245 input/51 output
  tokens. Key supplied through hidden terminal input and not persisted; no
  repository content sent or production changes. Other live protocols untested.
  Contract and cancellation limitations are documented in `src/di/README.md`.
  Full framework suite with cached TypeScript passes219/0; editor diagnostics
  clean. Optional external image/live-Postgres coverage remains environment-gated.
  Separate from app-side `ai`, zero runtime dependencies, exact user-selected
  endpoint/model/credentials. CLI/workspace tools added above; streaming is pending.
  DI belongs to the framework; Cloud and browser IDE are optional later work.
  Existing agent instruction files remain intact; no "first AI framework" claim.

- Navigation upgrade implemented locally on 2026-10-17: shared layout prefixes
  persist, changed route branches dispose, and pages remount with new loader data.
  `pageNavigation()` reports read-only pending/from/to; latest navigation wins
  across fetch/import races. Hash focus and Back/Forward window scroll are handled
  by the router. `pageRefresh()` still preserves page-local state. Four Chromium
  dev/prod layout/no-layout combinations and six real-TypeScript groups pass.
  Final framework suite: 201 passed, 0 failed; docs syntax and editor checks clean.
  User authorized navigation commit, push and deployment to the existing EC2
  site on 2026-10-17; feature d8b4971 pushed and release206194d9f600 activated.
  Integrity50/50, origin/public health and docs200; app/nginx/watchdog active.

- Shield correction authorized 2026-10-18 after scanner probes banned nginx's
  shared loopback identity for 15 minutes. Local fix supports
  `NIRAL_TRUST_PROXY=loopback` with single-IP validation; EC2 nginx resolves
  CF-Connecting-IP only for official Cloudflare networks and overwrites XFF.
  Public docs allow search/AI crawling; no user-agent security bypass.
  Full local suite203/0; deployed with checkpoint
  `/root/niral-upgrade-checkpoints/20261018-shield-visitor-ip`. Live synthetic
  attacker banned while other visitor/watchdog200; spoofed proxy headers ignored.
  Real visitor identity confirmed through Cloudflare. All services active; env/data
  preserved. Security guide and updated proxy-mode doctor checks published;
  docs releasecb55f099d593 integrity50/50, origin/public health200. Prior release
  206194d9f600 retained. Public docs200 with browser/search/AI user agents;
  robots/sitemap200. No commit/push for this correction. Refresh Cloudflare's
  trusted CIDR list in deploy/ec2/nginx.conf when its published networks change.

- Historical local PATH setup: `export PATH="$HOME/homebrew/bin:$PATH"`.
- Build docs from this root: `node bin/niral.js build apps/docs`.
- Preview docs: `node bin/niral.js start apps/docs -p 5917`.
- Framework tests: `npm test` runs `node tests/run.js`.
- Earlier sandbox environments blocked port binding, localhost reads and SSH
  configuration access. Request the environment's appropriate permission if
  blocked; do not assume obsolete tool-specific flags still exist.
- `AGENTS.md` specifies Node >=22, while `package.json` currently declares >=20.
  Use Node >=22 for the documented SQLite workflow; the existing discrepancy was
  not changed as part of relocation.

## Production Reference

- Security deployment authorized 2026-10-25: source `f0ccd99` committed/pushed.
  EC2 preflight confirms Node22.23.3, nginx/app/watchdog active, NRestarts0,
  PID82783, healthy b6feb5b537db. CI40196641172 passes all Windows/Linux22/24 jobs.
  Private checkpoint20261025-f0ccd99-security saves source/env/config/old release.
  Stage `/home/ubuntu/niral-security-f0ccd99`: release85a914d39113, integrity58/58,
  27 pages/assets/installer/security smoke pass; site7 pass/1 optional skip.
  Main254 pass/1 failure: Ruby absent on host (not used by docs). Runtime remains
  unchanged with its security patch outstanding. DEPLOYED: 12 reviewed src/ files,
  live app rebuilt as niral into matching85a914d39113, integrity58/58. Initial
  ubuntu-context integrity check could not read private0700 release; stopped
  before restart, then owner-context check passed. No permission relaxation.
  Restart13:18:44UTC, PID87220, nginx/app/watchdog active,NRestarts0. Origin/public
  health and six key page/installer checks pass; public HTML uses new assets.
  Live invalid path400, foreign RPC403, private env404. Environment byte-identical,
  data/config/app-source/installers untouched, full rollback retained. No npm
  publication, runtime installation or live form submissions.

- Deployment authorized 2026-10-25 for source `551ba8e`. Healthy preflight on
  `b6feb5b537db`; private checkpoint `20261025-551ba8e` preserves source/env,
  full previous release and pointer. Isolated stage builds `757dc255fd9e`,
  integrity 63/63; website tests 7 pass/1 optional skip and all 27 production
  page checks pass. Six reviewed files installed, syntax clean and env unchanged;
  initial activation guard stopped because staging included two log files excluded
  from production. Clean log-free stage and live build both `b6feb5b537db`,
  integrity 61/61 and identical content (manifest timestamp aside). Hash covers app
  inputs, not framework source. Exclude logs/env/data from future Git archive stages.
  DEPLOYED: build as niral, app/watchdog restarted, nginx and both services active,
  NRestarts0, PID82783. Origin/public health and main pages/installer200 verified;
  live gold404/icons/no-overflow verified in browser. Environment byte-identical,
  data/config untouched, clean startup logs and rollback backup retained. No npm
  publication or live email. Supersedes local-only framework status above.

- Website deployment authorized 2026-10-18: updated design, contact, DI, About and
  SEO, plus canonical `https://niral.site/install.sh` command. Shell/JS and public
  URL checks pass. Healthy EC2 preflight served `35d6f8e95a5a`. User approved
  securely adding only three missing Cloudflare email settings after backup;
  never replace the whole production environment. Settings now added with all
  prior values verified unchanged. Checkpoint `20261018-website-canonical` saves
  source/env/old release. Local framework 244/0; local and staged site tests 7 pass,
  one optional browser skip. Staged production build `b6feb5b537db`, integrity
  61/61 and all 27 page/installer checks pass. Production activated the same release,
  integrity 61/61; nginx/app/watchdog active, automatic restart counts zero, startup
  logs clean. Origin/public health report the new release, public installer hash
  matches local bytes, and new pages return 200. Live About content browser-verified;
  full public crawl/navigation interrupted by client TLS/network timeouts, not a
  completed all-page public check. Running service loaded all three email settings;
  no live message sent. Existing data/settings and rollback checkpoint preserved.
  No Git/npm/extension publication. Supersedes local-only website status above.

- Provider presets deployment authorized 2026-10-18: healthy EC2 preflight on
  releasebbc96b5529dd; private checkpoint20261018T033336Z-di-presets under
  /root/niral-upgrade-checkpoints preserves affected source, app.env and pointer.
  Isolated Node22 stage passes16 DI +10 DI CLI +15 launcher groups and docs
  syntax. Allowlisted source deployed and docs built as niral into35d6f8e95a5a,
  integrity50/50; old bbc96b5529dd retained, env byte-identical, data untouched.
  nginx/app/watchdog active with NRestarts0 and clean logs. Origin/public health
  report new release; home/CLI HTTP200, browser confirms preset guide. Complete;
  no Git/npm release or installed user-cache update.

- New EC2 deployment authorized 2026-10-17: `ubuntu@13.126.45.97`, local key
  `aws-key/dream.pem` (ignored, mode 600). Node 22.23.3/nginx/UFW provisioned;
  app `/opt/niral-demo`, framework `/opt/niral`, units `niral-demo` and
  `niral-demo-watchdog`. Release `76cdffd10467` active; integrity49/49, five form
  and six TS regression groups pass remotely. Public homepage/docs/assets/health
  verified200; private paths404; desktop/mobile rendering and Geist verified.
  App runs as `niral`; framework/source root-owned, data/dist writable by app.
  Watchdog runs as root. Services enabled at boot; UFW allows22/80 only.
  Checkpoint `/root/niral-upgrade-checkpoints/20261017T141510Z-ec2` includes system
  configuration and the generated env backup; env stays at `/opt/niral-demo/app.env`.
  HTTP-by-IP only (`NIRAL_SECURE=0`); enable secure cookies when TLS is configured.
  Reusable config: `deploy/ec2/`; no DNS change or old-host migration performed.
  Later source transfers require sudo rsync or staging because source is root-owned.
  Subsequent user-managed orange-proxy DNS cutover verified on 2026-10-17:
  `https://niral.site` serves EC2 release `76cdffd10467` through Cloudflare;
  homepage/docs/health200. Origin still HTTP; no origin certificate installed
  and secure-cookie setting remains0. Old server unchanged.

- Historical host: `139.59.38.116`, SSH alias `zyora-prod`.
- Framework: `/opt/niral`; separately deployed docs app: `/opt/niral-demo`.
- Docs content on production: `/opt/niral-demo/lib/content.js`.
- Services: `niral-demo` and `niral-demo-watchdog`; docs port 8199; nginx site `niral-demo`.
- Primary canonical domain: `niral.site`; `niral.zyora.club` also serves the site.
- Cloudflare HTTPS terminates before the HTTP origin on port 80.
- The droplet historically lacked curl and package-manager binaries; check from
  the local machine where necessary. Never assume missing tooling is repaired.
- No production access or changes were performed during relocation.

The previous docs-only synchronization command was:

```sh
rsync -az --delete --exclude dist --exclude data --exclude .niral --exclude node_modules --exclude '*.env' --exclude '*.log' apps/docs/ zyora-prod:/opt/niral-demo/
```

Treat this as historical operational context, not an instruction to run it.
Before any approved deployment, inspect the destination, take a checkpoint, and
review a dry run, especially deletions and private environment-file exclusions.
Never replace production configuration with local environment files. Build using
`/usr/bin/node /opt/niral/bin/niral.js build .` from `/opt/niral-demo` before an
authorized service restart; verify health, `systemctl is-active` and recent logs.

## Verified Deployment: 2026-09-08

- Feature commit `352034e` deployed by targeted rsync; `/opt/niral` has no Git metadata.
- Node 22.22.2; docs release `b56a025ac2ea` built on the host and integrity-checked.
- Remote API regression groups passed. Both services active; health and API guide
  returned 200 locally; public homepage and `/docs/api-routes` verified as 200.
- Checkpoint: `/root/niral-upgrade-checkpoints/20260908-352034e` preserves source,
  previous release `8a3ac074df89`, its original path and the environment file.
- Environment file is `/opt/niral-demo/app.env`; preserved unchanged along with data.
- Older remote source lacked the streaming module and matching renderer update;
  both were synchronized from committed source before activation. Compare runtime
  dependencies as well as the new commit's changed files on subsequent deployments.
- Watchdog briefly stopped during build/activation and restarted afterward.
- No Git push or npm publication. Unrelated local instruction/spec files untouched.

## HTTP API Routes

- `.server.js` routes export HTTP verbs; handlers receive native `request`, `url`,
  `params`, middleware `locals`, `session`, and `user()`, returning a Response.
- `niral add api` scaffolds `/api`. API-only projects build and serve without pages.
- Relative explicit-extension ESM imports and Node built-ins are supported. Endpoint
  dependencies are private and must not be shared with client modules. Computed
  dynamic imports and CommonJS loading are outside the endpoint build contract.
- `NIRAL_MAX_BODY` controls the 1 MiB default cap; `NIRAL_ORIGIN` supplies the canonical
  URL behind proxies. Cross-host Origin writes are rejected; authorize endpoints explicitly.
- Verified 2026-09-08: full suite 190 passed, 0 failed, including authenticated CRUD,
  signed webhooks, response streaming, session persistence and private-source blocking
  in dev and production. Docs module syntax passed.

## Type Inference: 2026-09-09

- Development compiler is cached at `.niral/lib/typescript/`; its package scope
  must be CommonJS even though the framework is ESM. No runtime dependency added.
- `niral check` uses type-only virtual server contracts for JS/JSDoc and TS RPCs,
  page-local loader results and URL parameters. Async generic signatures survive;
  synchronous generic/overloaded RPCs use Parameters/ReturnType projection.
- `.niral` component annotations/defaults define prop contracts. Template checks
  include callbacks, binding write-back and control-flow scopes; unannotated props
  without defaults stay permissive. Plain JS scripts stay unchecked.
- LSP uses debounced project checks and open-document overlays. Syntax checking
  still works without TypeScript. No runtime validation or serialization changes.
- Five focused inference, unsaved-editor and installer-cache tests passed.
  Full suite: 195 passed, 0 failed with TypeScript 5.7.3 explicitly enabled.
  Local and production docs builds passed: `d890655607dc` (3 routes).
  Commit and site deployment authorized and completed on 2026-09-09.
  Pre-deployment health 200, both services active on release `b56a025ac2ea`.
  Feature commit `f18532c`; private source/release/environment checkpoint at
  `/root/niral-upgrade-checkpoints/20260909-f18532c` created before transfer.
  Remote focused tests passed on Node22.22.2. Release integrity passed (49 files),
  both services active, local health and public homepage/TypeScript guide 200.
  Public guide confirmed updated; production environment/data preserved.
  No Git push or npm publication in this deployment.
  Prior API commits were pushed through `f6dcd19`.

## Component Pitfalls

- State-preserving refresh (2026-10-17, verified locally): `pageRefresh()` updates
  page/layout prop signals without remounting; local `$state` drafts are retained.
  `formAction("save", { refresh: true })` refreshes after non-redirect success,
  exposing `refreshing`/`refreshError` separately from write status. Reset/disposal
  cancels reads, navigation invalidates them, and latest-started refresh wins.
  Full suite 201/0 with real TypeScript; four dev/prod layout/no-layout Chromium
  combinations pass. Local docs build `e9924fec9201`; subsequently deployed to
  new EC2 as `76cdffd10467` (see above), without a Git commit or push.

- Reactive forms verified locally (2026-09-09): `formAction("save")` plus
  `on:submit={saving.submit}` opts into per-form reactive state and result-only
  responses without remounting or rerunning `load()`. Results and schema errors
  are inferred in TS clients. Multipart, duplicate protection, reset/abort and
  native fallback verified against dev/prod; full suite 200/0 and both Chromium
  groups pass. Docs build `f3432dab528d` verified locally. Push/deployment then
  authorized and completed: `origin/main` pushed through `7b2b7c1`; production
  release `f3432dab528d` passes integrity (50 files), both services active, health
  and public homepage/Server/TypeScript/Validation guides 200 with updated content.
  Four form and six inference groups pass remotely on Node22.22.2. Checkpoint:
  `/root/niral-upgrade-checkpoints/20260909-7b2b7c1`, preserving source, prior
  release `d890655607dc` and environment. Data/environment unchanged; unrelated
  remote `src/create.js` excluded from transfer. No npm publication.

- Named slots use `<slot name="header">fallback</slot>` and direct children with
  `slot="header"`. `<template slot="header">` groups content without a DOM wrapper.
  Names must be static non-empty strings; default slots remain backward compatible.
- Component `bind:value={state}` explicitly grants write-through to the parent.
  Ordinary props remain read-only; no child-side `$bindable` rune is needed.
  Bindings support state property paths and forwarding through wrapper props.
  Invalid binding targets report `NIRAL061`.
- `onMount` and `onDestroy` are script ambients. Mount runs in a browser microtask
  after attachment/hydration, never SSR; its returned cleanup runs on disposal.
  `onDestroy` also runs during SSR and failed setup. Runtime effects support
  returned cleanup on rerun/disposal. Register lifecycle hooks during setup.
- Component upgrade verified locally on 2026-09-08: `npm test` reported 185 passed,
  0 failed. Optional tool/service checks are environment-gated; browser verification
  used the DOM shim, not Playwright. Subsequently deployed with the API upgrade above.
- `<script mode="static">` supports compile-time constants, not runes or reactive
  state. Use a plain `<script>` block for reactivity.
- The parser historically breaks on literal backticks in regex/template literals
  with `NIRAL013 Template literal never closed`. Use `\x60` in regex and string
  concatenation when this limitation applies.
- Avoid HTML entity double escaping: use plain `$`, not `$&nbsp;`, and the JS
  expression `{"<slug>"}` rather than `&lt;slug&gt;`.

## Responsive Docs and Landing Page

Historical responsive release: `59955ce50f27`.

- `apps/docs/routes/docs/_layout.niral`: reactive `sidebarOpen = $state(false)`,
  sticky `.mtopbar`, `.hamburger`, `.mbrand`, off-canvas aside and scrim below
  860px. `.nav-open aside` opens the drawer; navigation closes it.
- `apps/docs/routes/docs/[slug].niral`: mobile `.page` uses
  `grid-template-columns: minmax(0,1fr)` and `article { min-width:0 }` to prevent
  long code lines stretching the page. Tables scroll internally; article elements
  have explicit styling and smaller typography below 860px.
- `apps/docs/routes/index.niral`: static-script, CSS-only mobile navigation uses
  checkbox `navtoggle`, `.nav-burger`, and `.nav-links` below 720px. Checked sibling
  selectors open the dropdown and animate the hamburger. Do not replace it with
  reactive code inside a static script.
- `.window-wrap { overflow-x: clip }` contains the negative-inset `.window-halo`.
- Responsive acceptance: document scroll width equals viewport width at 390px;
  also inspect desktop and working mobile navigation.

## Self-Hosted Geist Fonts

- The previous Google Fonts stylesheet silently failed to register Geist faces,
  leaving the site on fallback fonts. `document.fonts.check('16px Geist')` returned
  true even though no matching font faces existed; that check alone is insufficient.
- Four variable WOFF2 files (Latin and Latin Extended for Geist and Geist Mono)
  live under `apps/docs/styles/fonts/geist/`.
- `apps/docs/styles/geist.css` declares variable weight ranges 400-700 and 400-500.
  The global `apps/docs/routes/_shell.html` links `/styles/geist.css`.
- Google Fonts links/preconnects were removed from landing and docs head blocks.
- Verify actual font loading: `document.fonts.load('600 32px Geist')` should return
  faces, `document.fonts` should show loaded Geist faces, and measured Geist text
  width should differ from a serif fallback.
- Docs builds write to `apps/docs/dist/current/`, not repository-root `dist/`.
  Static files are under `dist/current/static/`; styles are copied automatically.

## SEO and Claims

- Landing and dynamic docs include metadata, Open Graph, Twitter and canonical
  URLs for `niral.site`. Landing JSON-LD renders through `{@html ld}`.
- Historical sitemap contains 22 URLs; robots.txt is included.
- Use evidence-qualified claims such as "faster than every JS meta-framework we
  tested", never "unhackable" or "fastest ever".
- Tamil was intentionally limited to the homepage footer.

## Recovery Work and Recent History

- Niral's deployment/recovery story is source -> snapshot -> release -> verify ->
  activate, with persistent shared data separated from releases.
- Commit `c7c5c97` added encrypted off-box snapshots on 2026-08-08.
  `src/server/remote-snapshot.js` compresses SQLite snapshots with gzip, derives a
  256-bit key using scrypt, and uses AES-256-GCM with the `NIRALRS1` format.
  Ciphertext uploads use path-style S3-compatible storage and native SigV4.
- CLI supports remote create/push/list/restore; generated deployment templates
  auto-push pre-deploy snapshots when configured.
- Historical validation: 178 tests passed, 0 failed. This is not a fresh test run.
- Historical production release: `8a3ac074df89`; checkpoint:
  `/root/niral-remote-snapshot-checkpoints/20260808-160318`.
- At that snapshot release, npm launchers were not republished because launcher
  code had not changed; fresh installs fetched GitHub main. npm authentication and
  cache ownership had caused `ENEEDAUTH` / `EPERM`. Do not publish or use sudo
  without the appropriate explicit authorization.
- The newer local HEAD is `7cc0e03`, a launcher scaffold fix. Its publication and
  runtime status were not re-evaluated during the move.
- Recent preceding commits also cover runtime GitHub changelog sync with cached
  fallback (`344d19f`), out-of-order await streaming (`c8ff705`), and generated
  changelog docs (`a6e39f5`). Consult the actual history before modifying them.

## Scope Boundary

The ZyoraByte Niral Club onboarding and classroom handouts belong to ZyoraByte,
not this framework repository. They were intentionally left in their original
workspace. Global user preferences remain global; Niral-specific memory is now
stored here so it does not depend on the old workspace's assistant memory store.