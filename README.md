<div align="center">

# Niral

**The full-stack framework with zero dependencies.**

Compiler-first components · fine-grained reactivity · SSR at Svelte speed —
served 7.5× faster than Next.js. Auth, jobs, realtime, AI and deploys built in.
`node_modules` not required.

[Docs](https://niral.zyora.club) · [Benchmarks](https://niral.zyora.club/docs/benchmarks) · [CLI reference](https://niral.zyora.club/docs/cli) · [VS Code extension](https://marketplace.visualstudio.com/items?itemName=zyoralabs.niral-vscode)

</div>

---

## Quick start

```sh
npx create-niral my-app
cd my-app
niral dev                             # → http://localhost:5199
```

No npm? `curl -fsSL https://niral.zyora.club/install.sh | bash` — or go direct:

```sh
git clone https://github.com/Zyora-Dev/niral.git
node niral/bin/niral.js create my-app
```

There is nothing to install. The framework is Node 22+ stdlib, end to end:
parser, compiler, reactivity, SSR, WebSockets, sessions, crypto, SQLite.
No account, no cloud, no telemetry — everything runs on your machine.

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

## What's in the box

- **Components** — `.niral` single-file components, runes (`$state`, `$props`), keyed lists, transitions, context, slots
- **SSR + hydration** — dual codegen: DOM builder for the client, string renderer for the server, byte-identical output
- **Server functions** — `<server>` blocks become RPC with compile-time stubs, streaming (async generators → NDJSON), form actions that work without JS
- **Polyglot** — server blocks in Python, Ruby or Go; same sessions, same RPC
- **Auth** — passkeys, passwords, TOTP 2FA, OAuth, route guards (`niral add auth` — scaffolded code you own)
- **Realtime** — live channels on framework-owned WebSockets, session-aware guards
- **Jobs & cron** — durable SQLite queue that survives deploys; retries, backoff, dead-letters
- **AI-native** — `ai.chat` / `ai.stream` / `ai.embed` against any OpenAI-compatible endpoint, RAG included, fully-local option (`niral add llm`)
- **Data** — SQL migrations that auto-apply at boot; `node:sqlite` everywhere
- **Quality** — `niral test` (boots your real app), `niral check` (the actual TypeScript compiler), `niral doctor`
- **Ship** — content-hashed atomic releases, one-symlink rollback, graceful drains, generated systemd + nginx + Dockerfile deploy kit, CSP nonces and security headers by default
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
bin/niral.js        the CLI — create · dev · check · test · migrate · build · start · deploy · doctor
src/compiler/       parser, codegen (DOM + string-SSR), rewriter
src/runtime/        signals, DOM ops, hydration, router, i18n, rpc client
src/server/         dev + prod servers, sessions, auth, jobs, live, ai, rag, migrate
src/add/            recipes: tailwind · sqlite · fonts · image · auth · typescript · chat · llm
apps/docs/          the documentation site — a niral app (dogfood)
apps/quickpoll/     realtime polling app (dogfood)
bench/              reproducible benchmarks vs React, Next.js, Svelte, SvelteKit
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
