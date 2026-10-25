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
