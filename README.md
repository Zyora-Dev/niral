<div align="center">

# Niral

**The full-stack framework with zero dependencies.**

Compiler-first components · fine-grained reactivity · SSR at Svelte speed —
served 7.5× faster than Next.js. Auth, jobs, realtime, AI and deploys built in.
`node_modules` not required.

[Docs](https://niral.site) · [Benchmarks](https://niral.site/docs/benchmarks) · [CLI reference](https://niral.site/docs/cli) · [VS Code extension](https://marketplace.visualstudio.com/items?itemName=zyoralabs.niral-vscode)

</div>

---

## Quick start

```sh
npx create-niral my-app
cd my-app
npx niral dev                         # → http://localhost:5199
```

No npm? `curl -fsSL https://niral.site/install.sh | bash` — or go direct:

```sh
git clone https://github.com/Zyora-Dev/niral.git
node niral/bin/niral.js create my-app
```

There is nothing to install. The framework is Node 22+ stdlib, end to end:
parser, compiler, reactivity, SSR, WebSockets, sessions, crypto, SQLite.
No account, no cloud, no telemetry — everything runs on your machine.

## CLI Installation And Updates

Use `npx niral <command>` in the current terminal, or open a new terminal after
scaffolding to use the generated `niral` command. For a global npm install, choose
either `npm install -g niral` or `npm install -g create-niral`; both provide the
same executable names. The framework is cached in `~/.niral/framework`, or under
`NIRAL_HOME` when configured. Keep apps outside the framework installation.

```sh
npx create-niral myblog --template blog
npx niral --help
npx niral --version
```

Launcher 0.1.4 provides **explicit framework updates and revision pins**:

```sh
npx niral@latest update
niral update
```

The first form can upgrade an older cached framework without an update command.
Normal commands reuse the cache; fetching the latest npm launcher alone does not refresh it.
Updates follow the official repository's `main` branch by default. Set `NIRAL_REF`
to a reviewed full lowercase 40-character commit SHA or existing `v`-prefixed tag
for an explicit installation/update. The selection persists across plain updates;
use `NIRAL_REF=main npx niral@latest update` to remove it. Tags can move, so use
full SHAs for reproducibility. Framework pins are independent of npm versions.
They do not modify app projects, deploy servers or update global npm packages.

Stop development/build commands before updating. Dirty/unmanaged-branch/custom-origin Git
checkouts are refused; failed Git updates never trigger destructive replacement.
Pin changes and archive replacements are staged, and the previous framework is retained as a backup,
including any local additions (not merged into the new copy). Source checkouts
outside the managed installation should be updated with Git.

See the [launcher release checklist](installer/README.md) and
[package usage](installer/niral/README.md).

## Release Validation

`npm run test:release` runs the framework/compiler, installer recovery, immutable
build, Devtools, docs, Chromium hydration and form/navigation suites, then verifies
both npm packages contain exactly their five allowed files. It requires isolated
TypeScript and Playwright/Chromium tooling; setup is in the
[release checklist](installer/README.md). CI runs Node 22 and 24 with disposable
Postgres and image-transcoding gates. The command never publishes or deploys.

Builds finish in staging before activation. Release identity includes framework
source and generated output; identical releases are verified and reused without
rewriting published files. Failed staging leaves the active release untouched.

## Local Devtools

Run `niral dev` and open the app directly on `localhost`, `127.0.0.1`, or `::1`.
The bottom-right Niral launcher opens a development-only inspector showing route
patterns, layout/module paths, loader timings, RPC dispatch/total durations, HTTP
statuses and failure categories. Filter requests, select details, pause updates,
refresh manually or clear the visible list. Escape closes the focused panel.

The **Errors** tab captures browser errors, unhandled promise rejections,
contained Niral runtime failures and failed RPCs (including caught calls,
network failures and streamed errors). Groups show a safe error class, source,
count and timestamps. Each tab retains up to 100 groups with the latest 20
occurrences per group; grouping uses category, class, source and action type,
not message text. Browser error history is never uploaded to the server.

RPC failures link to their exact server trace using an opaque response ID,
including overlapping requests. Calls started during a click, submit, change
or keydown handler retain that event's type and local sequence number, never
its target, text, key or input values. Calls after an async boundary are marked
unattributed rather than assigned to the most recent interaction. Transport
failures without a response have no server link; expired traces are unavailable.

Verified `.niral` client script lines link to VS Code. Mapping is conservative:
only unique, unchanged script lines are mapped; transformed or duplicate lines,
templates, JSX/TSX and unknown frames may show an unresolved line or source.
This is not a complete source map or a server exception stack. At most 512
loaded component maps are retained. Editor links include the local project file
path; server block source is never sent to the browser.

The server keeps the latest 100 completed traces in memory (up to 32 loader spans
per trace), shared across local tabs. Clear hides request history in the current
panel or empties that tab's browser error buffer, depending on the selected view.
An explicit error-to-request link can reveal a previously cleared request.
Pause stops display updates, not collection. Automatic polling runs only while
the panel is open, visible and unpaused. Numeric request IDs are local to the
server process; opaque correlation IDs also distinguish server restarts.

Only metadata is recorded: no raw request URLs, dynamic parameter values, queries,
headers, cookies, arguments, results, error messages or stacks. The read-only
endpoint requires a loopback connection, matching local Host/port, same-origin
request metadata and an inspector header; forwarded requests are rejected.
Access through LAN addresses or reverse proxies is unsupported. Do not expose a
development server publicly. Production builds do not load the inspector or
provide its endpoints. Icons use the same pinned Lucide CDN as the dev overlays.

Reactive-state inspection and dedicated form-action spans are not included.
Run `node --test tests/devtools.js` for collector, mapping and HTTP security tests;
see [browser tests](tests/browser/README.md) for UI coverage.

## NiralScript Experiment

NiralScript is an opt-in, local compiler prototype, not a stable language release.
Its independent language extension is `.nrs`; `.niral` remains Niral's component
format. Niral is the first target, with other integrations planned. The
[v0.1 design draft](NIRALSCRIPT.md) distinguishes implemented and proposed features.
Use it inside an existing `.niral` component:

```html
<script lang="niralscript">
  state count = 0
  derive doubled = count * 2
  function increment() {
    count += 1
  }
</script>

<button on:click={increment}>Increase</button>
<p>{count} doubled is {doubled}</p>
```

`state` lowers to the existing `$state` declaration and `derive` to `$derived`.
Separate declarations with a newline or semicolon; group multiline expressions
with parentheses, brackets or braces. Existing HTML, CSS, events and bindings
stay unchanged. Both declarations use Niral's existing DOM and SSR codegen.
JavaScript, TypeScript and JSX/TSX support is unchanged.

The compiler separates a source-spanned statement AST and lexical analysis from Niral emission.
Initializers are parsed into expression trees with explicit operator precedence,
collections, calls, members, conditionals and template interpolation. Validated
source is retained for compatible emission; unsupported syntax is rejected.

The independent core lives in the root-level `niralscript/` directory:
[parser](niralscript/parser.js), [expressions](niralscript/expressions.js),
[scope analysis](niralscript/analysis.js), [module linker](niralscript/modules.js), [scanner](niralscript/scanner.js) and
[diagnostics](niralscript/errors.js). It is a private, zero-dependency ES module
package with no imports from the framework. The
[Niral adapter](src/compiler/niralscript.js) emits runtime signal calls directly
from analyzed bindings and translates
language diagnostics into existing Niral errors. Tests remain in the repository's
existing test harness. Niral also loads external `.nrs` instance scripts:

```html
<script lang="niralscript" src="./counter.nrs"></script>
```

Paths must be explicit relative `.nrs` files inside the project, without private
paths or symlinks. Do not mix inline code with `src`. Dev reloads external edits;
SSR caches and production hashes include their contents. Raw sources stay private.

Named imports and aliases (`import { twice as scale } from "./math.nrs"`) can use
library `export const` and `export function` declarations. Modules keep separate
scopes and initialize once per component execution, not as process singletons.
Transitive dependencies participate in semantic checks, SSR invalidation, dev
reloads and build hashes. Libraries cannot declare top-level input/state/derive/let;
default/namespace imports, re-exports and cycles are not supported. Private paths,
including `.server.nrs`, are rejected throughout the graph.

Read-only external inputs use `input name` in inline or external instance scripts:

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

The Niral adapter supplies same-named props, including route parameters and
explicit `load()` results. Parent updates flow to inputs and derived values
without remounting; local state initializers run once per instance. Missing
inputs are `undefined`, not a default value; explicit `null` is preserved.
Declare inputs before eager reads. Inputs and tracked aliases cannot be mutated;
bind editable controls to local state. Defaults, destructuring and input types
are not supported. Only return browser-safe values from loaders. These are
adapter rules; the independent language core has no Niral server or props imports.

The script supports top-level `input`/`state`/`derive`, ordinary `let`/`const`, named
functions and concise/block arrows (including `async`), lexical blocks, braced
`if`/`else`, `for...of`, `try`/`catch`/`finally`, `throw`, calls, assignments and
`return`. `await` is supported inside async bodies, not at top level. Native promise
completion is preserved; async calls and explicit throws are rejected during
derived evaluation. Initialization remains conservative across await; known
awaited aliases and explicitly thrown values retain readonly checks in catches.
Catch sources are conservatively merged across explicit throws in the linked program;
unknown host returns/rejections are not a general readonly guarantee.
Nested object/array patterns work in
ordinary declarations, parameters and loops; arrays/objects support shallow spread.
Niral checks array callbacks (`map`, `filter`, `find`, `findIndex`, `some`, `every`,
`forEach`, `reduce`) and helper callback parameters resolving to one known function.
Patterns have no holes, rest or defaults; call spread, assignment destructuring,
other loops and loop-control statements remain unsupported.
Scope checks reject duplicates, unresolved names, direct use before initialization
and immutable-binding writes. Resolved bindings drive signal reads/writes and
nested renames without intermediate rune discovery or script token rewriting.
The rune-emitting lowering API remains available for compatibility; template
expressions still use the existing compiler. Static checks reject detected derived effects,
cycles, readonly-alias writes and eager captured reads. Approved intrinsics are
target-specific; this is not a general purity proof for arbitrary host values.
External errors retain file/range links in component diagnostics. Gradual type
annotations, optional chaining, nullish coalescing, `typeof` and independent ESM
compilation with source maps are implemented locally. The proposed `view` syntax
and dedicated `.nrs` editor integration are not implemented. Template
handlers remain ordinary Niral/JavaScript. The subset is not a full
JavaScript grammar (regex literals and assignment expressions are rejected). It does
not establish support for arbitrary frontend languages or frameworks.

Run `node --test tests/niralscript.js` for compiler/SSR checks and
`NIRAL_BROWSER_FILTER=NiralScript node tests/browser/run.js` for dev/production
Chromium checks using the existing browser tooling. The reusable
[fixture](tests/fixtures/niralscript.niral) exercises named handlers, shadowing,
state, derived values, server-loaded inputs, local input binding, keyed lists and
RPC. Browser checks also cover parent/child updates and route parameters. These checks are
included in the release gate.

Standalone checking and compilation work from this checkout, without Niral components:

```sh
node niralscript/cli.js --help
node niralscript/cli.js check counter.nrs --root /path/to/project --json
node niralscript/cli.js compile counter.nrs --root /path/to/project --out counter.mjs
```

The `check` command validates entry files and relative module graphs without
executing source or emitting JavaScript. `compile` emits a self-contained ESM
`createInstance(inputs, globals, runtime)` factory and a `.mjs.map` file. Output
parents must exist inside the selected root; existing files are never overwritten.
The default runtime provides isolated state and pull-based cached derived reads;
hosts can inject signal/derived primitives. It does not mount a UI or subscribe.
Both commands report original file/line
diagnostics and exits 0 on success, 1 on source/file errors, or 2 on invalid usage.
It has no implicit host globals; repeat `--global name` to declare them without
asserting purity. Primitive, union, array, structural record and `Promise<T>`
annotations check known initializers, assignments, function arguments and returns.
Unknown host values remain permissive; this is not runtime validation, a fully
sound type system or Niral client/server security validation. The private package
exports `niralscript/check` and `niralscript/compile`; neither requires Niral.
See [standalone checking](NIRALSCRIPT.md#standalone-checking) and
[compilation](NIRALSCRIPT.md#standalone-compilation) for API/runtime contracts.

Run `node bench/niralscript.js` for warm compiler/string-SSR timings and generated
raw/gzip sizes for equivalent NiralScript, JavaScript and annotated TypeScript
components, all using Niral. It asserts language and DOM/string SSR parity, warms
each variant and rotates three-way batches evenly across 12 rounds. TypeScript
compilation here means Niral's type stripping, not `tsc` or type checking.
A separate paired script-backend
measurement compares direct AST emission with lowering through the JavaScript
rewriter, including parsing and analysis in both, excluding component/template
compilation.

- `node bench/niralscript.js browser`: uses the existing Playwright installation
  under tests/browser to measure warm hydration and synchronous click-to-DOM
  updates in headless Chromium. Asserts SSR element reuse, output and cleanup.
  Creates a loopback server on an assigned free port and closes it afterwards;
  no app files or existing preview servers are changed. Module loading, HTML
  parsing, paint and automation transport are outside the timed regions.
- `node bench/niralscript.js types`: uses the existing TypeScript compiler resolved
  by `niral check`, separately measuring fresh strict/noEmit programs with
  skipLibCheck, including standard library reads/parsing. No incremental reuse or
  process startup. Also asserts nine diagnostic probes covering annotated values,
  records, arguments, async returns, optional/nullish access, names and effects.
  Wrong-type insertion into an annotated array is rejected by both NiralScript
  and strict TypeScript; unannotated NiralScript values remain dynamic.
- `node bench/niralscript.js language`: direct JavaScript vs TypeScript vs
  NiralScript with identical function bodies for numeric aggregation, record
  processing, strings and async/await. No components or reactive operations.
  Asserts main/edge/empty outputs and input nonmutation; strict-checks each actual
  TS source. Reports warmed function execution, separate source-transform times
  and complete output sizes. Imports/factory setup/strict checks excluded from
  runtime timings. All execute as JavaScript on the same V8 engine; compiler
  timings differ in checking work, and NRS output includes unused runtime glue.
- GitHub Actions: the `compare-languages` job in Release Checks configures separate
  Ubuntu24.04 jobs on Node22/24 with TypeScript5.7.3 and three sequential `language`
  runs per job. Artifacts contain logs and commit/runtime/hardware metadata for
  30 days. Correctness failures fail CI; timings are informational because hosted
  runners vary. The workflow and all compiler changes must be committed/pushed
  before a GitHub run can test them.
- `node bench/niralscript.js standalone`: independently compiles typed `.nrs` to
  ESM and TypeScript via `transpileModule`, alongside an untransformed JS reference.
  Asserts counter/collection outputs, instance isolation, input updates/reset and
  async success/catch. Reports complete module/map sizes, warm transform times and
  balanced runtime batches (100 writes+reads or 1000 unchanged reads), including
  fresh instance creation. NRS bundles its pull/cached runtime; JS/TS implement
  only the measured interface with direct variables/recomputed reads. Array copies
  and mapping are identical; the standalone host explicitly approves native array
  `map` on literal arrays. Only valid supplied input values are compared. TS
  transpilation is not strict checking; maps and runtime strategies differ, so
  transform/size numbers are not equivalent compiler-work or feature comparisons.

These are local microbenchmarks, not cross-framework or end-user latency rankings.
Recorded results, versions and limitations are in [PROGRESS.md](PROGRESS.md).

## Developer Intelligence

Niral DI runs through the existing CLI, with your exact provider and model:

```sh
niral di setup
niral di status
niral di ask "Explain the routes" --read-only
niral di chat
niral di new myblog "Customize the home page" --template blog
```

Setup offers OpenAI, Claude (Anthropic), Azure OpenAI or Custom. Named providers
set protocol/auth automatically; Custom keeps manual choices. You supply the exact
model and credential variable name, not the key. Bedrock is not yet supported.
Explicit flags remain available through `niral di setup --help`.
Set the named credential variable privately in your terminal. Setup stores no
key; every workspace tool needs interactive approval. Writes check the current
file hash and retain external backups. Use `--no-tools` with `ask` for prompt-only
automation. No shell execution, automatic testing or cloud account requirement.
Read the [DI command and safety guide](src/di/README.md) before granting file access.

## One file, whole feature

```html
<server>
export async function load() {
  return { items: await db.all() }          // SSR data — never ships
}
export async function add(text) {
  publish("todos", { text })                // realtime to every tab
}
</server>

<script>
  let { items } = $props
  let list = $state(items)
  live("todos", (t) => list = [...list, t])
</script>

{#for t of list key t.id}
  <li transition:fade>{t.text}</li>
{/for}
```

`load()` runs on the server per request. `add()` becomes a type-safe RPC —
the compiler splits server and client code, so secrets structurally cannot
reach the browser (reading `process.env` in client code is a **compile error**).

## Measured, not marketed

End-to-end — each framework's own production server, dynamic SSR on every
request, the same 1000-row page, 100 connections × 10 s
([methodology + run it yourself](bench/e2e/)):

| framework | req/s | p50 | p99 | build |
|-----------|------:|----:|----:|------:|
| **niral** | **~2,200** | **40 ms** | ~150 ms | **0.2 s** |
| sveltekit 2 (svelte 5) | ~580 | 128 ms | ~1.6 s | 2.3–3.7 s |
| next 16 (react 19) | ~290 | 310 ms | 2.3–3.2 s | 3.3–5.5 s |

Hydration ties Svelte (6.6 ms / 1000 rows) at 29.7 KB of JS — [bench/hydration/](bench/hydration/).

**Streaming SSR — time to first byte** with a 300 ms slow data source
([run it yourself](bench/streaming/)). Streaming flushes the shell before the
slow value; `total` stays ~300 ms, but the page paints in single-digit ms:

| framework | blocking TTFB | streaming TTFB | streamed data |
|-----------|--------------:|---------------:|---------------|
| **niral** | 304 ms | **2 ms** | server-rendered HTML |
| next 16 | 307 ms | 6 ms | server-rendered HTML |
| sveltekit 2 | 305 ms | 3 ms | client-resolved payload |

## What's in the box

- **Components** — `.niral` single-file components, runes (`$state`, `$props`), keyed lists, transitions, context, slots
- **SSR + hydration** — dual codegen: DOM builder for the client, string renderer for the server, byte-identical output
- **Streaming SSR** — `<script stream>` flushes the shell first, then streams each `{#await}` branch out of order as its promise settles (server-rendered HTML, revealed with zero framework JS). ~2 ms first byte vs ~300 ms blocking — [bench/streaming/](bench/streaming/)
- **Server functions** — `<server>` blocks become RPC with compile-time stubs, streaming (async generators → NDJSON), form actions that work without JS
- **Polyglot** — server blocks in Python, Ruby or Go; same sessions, same RPC
- **Auth** — passkeys, passwords, TOTP 2FA, OAuth, route guards (`niral add auth` — scaffolded code you own)
- **Realtime** — live channels on framework-owned WebSockets, session-aware guards
- **Jobs & cron** — durable SQLite queue that survives deploys; retries, backoff, dead-letters
- **AI-native** — `ai.chat` / `ai.stream` / `ai.embed` against any OpenAI-compatible endpoint, RAG included, fully-local option (`niral add llm`)
- **Data** — SQL migrations that auto-apply at boot; `node:sqlite` everywhere
- **Quality** — `niral test` (boots your real app), `niral check` (the actual TypeScript compiler), `niral doctor`
- **Ship** — content-hashed atomic releases, one-symlink rollback, graceful drains, generated systemd + nginx + Dockerfile deploy kit, CSP nonces and security headers by default
- **Recover off-box** — gzip + scrypt + AES-256-GCM snapshots to any S3-compatible store, native SigV4, remote retention and authenticated restore
- **More** — i18n, SMTP mail, image pipeline, structured logging with request IDs, LSP + VS Code extension

## Editor & AI support

- **VS Code** — install the [Niral extension](https://marketplace.visualstudio.com/items?itemName=zyoralabs.niral-vscode) (`zyoralabs.niral-vscode`) for `.niral` syntax highlighting, diagnostics, completions and hover docs, backed by the built-in language server (`niral lsp`).

  ```sh
  code --install-extension zyoralabs.niral-vscode
  ```
- **AI agents** — every project scaffolds an `AGENTS.md`, so Copilot / Claude / Cursor understand Niral's conventions natively instead of guessing “Svelte-ish.” New apps also drop a `.vscode/extensions.json` that recommends the extension the moment the folder opens. Agents can run `niral check` / `niral test` to verify their own edits against the real compiler.

## Secrets can't escape

1. `process.env` in client code → **compile error**
2. Env files never enter a build
3. Dev and prod servers refuse to serve them
4. Scaffolded `.gitignore` keeps them out of git
5. The deploy script never syncs them — production secrets live only on the server

### Security Boundaries

Use a currently supported, security-patched Node.js release. The
[October 21, 2026 Node advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
lists fixes in 22.23.4, 24.22.1 and 26.12.1; use those or a newer patched release
in a supported line. Framework checks cannot patch Node's DNS, TLS, HTTP or
decompression internals. PHP is not a Niral runtime.

- Private directory/file exclusions are case-insensitive, including nested
  `data/`, dotfiles, environment files and server modules. Public symlinks and
  Windows junctions are not served or traversed by the static build walker.
  Use regular copies for intentionally public assets.
- Raw `.niral`, `.jsx` and `.tsx` component sources are never copied into static
  build output. Dev requests with noncanonical component-extension case are
  rejected instead of returning uncompiled source.
- Decoded paths containing backslashes, colons, control characters, dot segments,
  or segments ending in a dot or space return 400, including dynamic route paths.
- RPC still requires `x-niral-rpc: 1` and now shares form-origin validation.
  Configure `NIRAL_ORIGIN` to the exact public origin (scheme, hostname and port)
  for strict origin matching behind a TLS-terminating proxy. Without that setting,
  unencrypted connections retain host-and-port matching for proxy compatibility.
  Requests without Origin remain allowed unless Fetch Metadata says cross-site;
  this is not authentication or authorization for an application's functions.

Rebuild applications after upgrading: previously generated static files may
already contain copied private data or raw components. Keep development servers
private, enforce application authorization, and protect release directories from
untrusted writes. These checks do not sandbox server code or protect against
malicious local filesystem races/hard links, runtime CVEs or volumetric DDoS.

## Repository layout

```
bin/niral.js        the CLI — create · dev · check · test · migrate · build · start · deploy · doctor · snapshot/restore
src/compiler/       parser, codegen (DOM + string-SSR), rewriter
src/runtime/        signals, DOM ops, hydration, router, i18n, rpc client
src/server/         dev + prod servers, sessions, auth, jobs, live, ai, rag, migrate
src/add/            recipes: tailwind · sqlite · fonts · image · auth · typescript · chat · llm
apps/docs/          the documentation site — a niral app (dogfood)
apps/quickpoll/     realtime polling app (dogfood)
bench/              reproducible benchmarks — e2e throughput + streaming TTFB, vs Next.js, SvelteKit, SolidStart, Astro
tests/              161 tests — npm test
editors/vscode/     syntax highlighting + LSP client
```

## Philosophy

- **Compiler, not runtime.** The work happens once, at build time.
- **Zero dependencies, forever.** No supply chain, no audits, no upstream breakage. Every line that runs is a line you can read.
- **Honest measurement.** Every benchmark in this repo is reproducible. We'd rather you check.

---

<div align="center">

நிரல் — "program" in Tamil · Built in India · Powered by [ZyoraLabs](https://zyoralabs.com)

</div>
