# AGENTS.md — working in the Niral framework

Niral is a **zero-dependency, compiler-first full-stack web framework** (Node ≥ 22,
stdlib only). This file tells AI agents and contributors how the project is
structured and how to write correct Niral code. Read it before editing.

## Hard rules

- **Zero dependencies.** The framework's `package.json` MUST stay `"dependencies": {}`.
  Never `npm install` a runtime dep. Use Node built-ins (`node:*`) only. (Dev/bench
  tooling in isolated folders is the only exception.)
- **`<server>` code never reaches the browser.** Anything in a `<server>` block runs
  only on the server. Put secrets, DB access, and business logic there.
- **Client code cannot read `process.env`** — it's a compile error (secrets can't leak).
  Env vars are server-only.
- **`data/` is private** — never served in dev, never shipped in a build. SQLite files,
  jobs, sessions live there and survive deploys (it sits outside releases).
- Prefer editing existing files; match the surrounding style. No new abstractions for
  one-off needs.

## `.niral` components (single-file, Svelte-inspired — NOT Svelte)

A `.niral` file can contain these top-level blocks:

```html
<server>
  // runs ONLY on the server. Exports become SSR loaders + typed RPC.
  export async function load({ params, locals }) {   // SSR data for this page
    return { posts: await sql.query("select * from posts where id = $1", [params.id]) }
  }
  export async function add(text) {                  // an RPC — called from the client by name
    publish("todos", { text })                       // realtime fan-out
    return true
  }
</server>

<script>
  let { posts } = $props                 // props = route params + load() data
  let list = $state(posts)               // reactive state
  let done = $derived(list.length)       // derived value
  live("todos", (t) => list = [...list, t])   // subscribe to a realtime channel
  async function submit() { await add("hi") } // call the server RPC directly
</script>

<h1>{done} items</h1>
<button on:click={submit}>add</button>
<input bind:value={draft} />
{#if posts.length}
  <ul>{#for p of list key p.id}<li transition:fade>{p.text}</li>{/for}</ul>
{/if}

<style>
  h1 { color: #34d399; }   /* scoped to this component */
</style>
```

- Reactivity is **fine-grained** (no virtual DOM). Runes: `$state`, `$props`, `$derived`.
- Control flow: `{#if}` / `{:else}`, `{#for x of list key x.id}`. Events: `on:click`.
  Binding: `bind:value`. Transitions: `transition:fade`.
- `<head>…</head>` sets the document head. `<script mode="static">` = zero-JS SSR page.
- Server blocks may be other languages: `<server lang="python|ruby|go">` (same `load`/RPC/sessions).

## Routing (file-based, in `routes/`)

- `routes/index.niral` → `/`, `routes/about.niral` → `/about`.
- `routes/post/[slug].niral` → dynamic; read `params.slug` in `load`.
- `routes/_layout.niral` → wraps every page in its folder; render children with `<slot/>`.
- `routes/_404.niral`, `routes/_error.niral` → custom error pages.

## Server-side ambients (available in JS `<server>` blocks — no import)

- `load({ params, locals })` — SSR data loader (export it).
- Any other exported function = a **typed RPC**, called from the client by its name.
- `session` — `session.get(key)` / `session.set(key, val)` (signed cookie by default).
- `user()` — the signed-in user (or `null`).
- `publish(channel, data)` — realtime; clients subscribe with `live(channel, cb)`.
- `enqueue(name, data, { delay, maxAttempts })` — durable background job (see `jobs.js`).
- `sql.query(text, params)` — Postgres, when `NIRAL_DATABASE_URL` is set. **Always** pass
  values as `$1, $2` params (SQLi-safe) — never string-concatenate.
- `ai.chat / ai.stream / ai.embed`, `mail({ to, subject, text, html })`, validation helpers.
- Form actions: `<form method="post" action="?/save">` → calls `save(fields)` on the server
  (works without JS).

## Project files

- `hooks.js` (root) — `export function handle(event)` middleware (auth guards, redirects,
  `event.locals`), `liveAuth({ channel, user })`, and required `export const env = [...]`.
- `jobs.js` (root) — `export const jobs = { name(data){…} }` + `export const schedules = [{ cron, job }]`.
- **Database:** SQLite is the default (`node:sqlite`, `data/app.db`) — scaffold one with
  `niral add sqlite`, or open `new DatabaseSync("data/app.db")` in a `<server>` block.
  Postgres is opt-in via `NIRAL_DATABASE_URL` + the ambient `sql`. There is **no** `@niral/db` import.

## CLI — the ground-truth feedback loop

Run these to verify changes (don't guess — the compiler is the source of truth):

- `niral dev` — dev server with HMR.
- `niral check` — runs the real TypeScript compiler; diagnostics map to `.niral` lines.
- `niral build` — hashed production release into `dist/`.
- `niral test` — boots the real app and runs `tests/`.
- `niral create <name> [--template minimal|blog|dashboard]` — scaffold an app.
- `niral deploy` — generate systemd + nginx + atomic-release deploy kit.
- `niral doctor` — diagnose project health. `niral lsp` — the language server VS Code uses.

## Scaling (opt-in, still zero-dep)

- One `$5` box with SQLite is the default and the finish line for most apps.
- Add Postgres (`NIRAL_DATABASE_URL`), then go multi-server with `NIRAL_CLUSTER=1`
  (realtime fans out via Postgres LISTEN/NOTIFY; jobs share one queue with `NIRAL_JOBS_STORE=pg`).

## Framework internals (for contributors)

- `src/compiler/` — parser → AST → codegen. `src/runtime/` — signals + DOM.
- `src/server/` — prod server, sessions, jobs, live channels, postgres, shield/recover.
- `src/lsp/` + `editors/vscode/` — editor tooling. `bin/niral.js` — the CLI.
- Tests: `tests/run.js` (`npm test`), zero-dep harness. Keep everything green.
