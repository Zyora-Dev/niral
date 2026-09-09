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
- The existing untracked `.kiro/` specifications were preserved unchanged.
- Read `AGENTS.md` for the compiler, runtime, routing, security, CLI and contribution rules.
- The framework must retain zero runtime dependencies. Do not apply the parent
  project's FastAPI/Next.js setup or deployment conventions to Niral.

## Local Development

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