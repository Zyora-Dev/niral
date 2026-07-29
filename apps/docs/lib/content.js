/**
 * Docs content — every page as markdown. Grouped for the sidebar.
 */

export const GROUPS = [
  { name: "Start", slugs: ["getting-started", "components", "reactivity"] },
  { name: "Build", slugs: ["routing", "styling", "typescript"] },
  { name: "Server", slugs: ["server", "database", "auth", "validation", "realtime"] },
  { name: "Capabilities", slugs: ["ai", "jobs", "utilities", "images"] },
  { name: "Ship", slugs: ["deployment", "scaling", "security", "cli", "benchmarks"] },
];

export const PAGES = {
  /* ── START ─────────────────────────────────────────────────── */
  "getting-started": {
    title: "Getting started",
    body: `
நிரல் (Niral, Tamil for "program") is a full-stack web framework with **zero dependencies** —
compiler, signals runtime, router, SSR, WebSockets, auth, jobs, mail and AI helpers are all
built on the Node standard library. Node 22+ is the only requirement.

## Install

The fastest way — one command, like you'd expect:

\`\`\`sh
npx create-niral my-app
\`\`\`

That downloads the framework once to \`~/.niral\` (about 1 MB — it has zero
dependencies) and installs a \`niral\` command. No npm? Use the installer:

\`\`\`sh
curl -fsSL https://niral.zyora.club/install.sh | bash
\`\`\`

Or go direct — a git clone IS the framework:

\`\`\`sh
git clone https://github.com/Zyora-Dev/niral.git
alias niral="node $PWD/niral/bin/niral.js"   # add to your shell profile
\`\`\`

Either way, nothing runs on anyone else's servers — no account, no cloud,
no telemetry. Your app is yours.

## Create an app

\`\`\`sh
niral create my-app
cd my-app
niral dev            # http://localhost:5199 — HMR, error overlays
\`\`\`

The scaffold is a real working app: a server-rendered page with reactive state,
a keyed list, and a server function called over RPC.

## Starter templates

Prefer to learn from a fuller example? Pass \`--template\`:

\`\`\`sh
niral create my-blog --template blog        # posts + dynamic [slug] routes + a data module
niral create my-app  --template dashboard   # a sidebar layout, stat cards, a live-refresh RPC
niral create my-app  --template minimal     # the default — SSR + state + RPC
\`\`\`

Each is small and heavily commented — they teach the core patterns by example,
not a giant app to wade through.

## One file, whole feature

A route is a single \`.niral\` file. Server code, client logic, markup and styles
live together — the compiler splits them:

\`\`\`html
<server>
export async function load() {
  return { greeting: "வணக்கம்" }        // runs on the SERVER, SSR'd into props
}
export async function save(text) {      // callable from the client — RPC stub
  return { ok: true }
}
</server>

<script>
  let { greeting } = $props
  let count = $state(0)
</script>

<h1>{greeting} — {count}</h1>
<button on:click={() => count++}>+1</button>

<style>
  h1 { color: rebeccapurple; }          /* scoped to this component */
</style>
\`\`\`

Server code **never ships to the browser** — \`save\` becomes a typed fetch stub,
and reading \`process.env\` in client code is a compile error.

## Commands you'll use daily

| Command | What it does |
|---------|--------------|
| \`niral dev\` | dev server — compile on demand, HMR with state preservation |
| \`niral check\` | real TypeScript checking (after \`niral add typescript\`) |
| \`niral build\` | content-hashed release, atomically activated |
| \`niral start\` | production server for \`dist/current\` |
| \`niral export\` | prerender to static files |
| \`niral add <recipe>\` | tailwind, auth, chat, sqlite, image, llm … |
`,
  },

  components: {
    title: "Components",
    body: `
Components are \`.niral\` files — or \`.jsx\` / \`.tsx\` if you prefer JSX. Same compiler,
same runtime, no React.

## Blocks

\`\`\`html
<server>   … server-only code (any language) … </server>
<script>   … client logic with runes …         </script>
<head>     <title>{title}</title>              </head>
<style>    … scoped CSS …                      </style>
… template …
\`\`\`

## Template syntax

\`\`\`html
<p>{expression}</p>

{#if user}
  <b>Hi {user.name}</b>
{:else if pending}
  <span>loading…</span>
{:else}
  <a href="/auth/login">sign in</a>
{/if}

{#for item, i of items key item.id}
  <li>{i}: {item.text}</li>
{/for}

{#await promise}
  <p>loading…</p>
{:then value}
  <p>{value}</p>
{:catch err}
  <p>{err.message}</p>
{/await}

{@html trustedHtml}
\`\`\`

Keyed \`{#for}\` does real reconciliation — DOM nodes, input state and effects
survive reorders, and \`animate:flip\` makes rows glide.

## Directives

| Directive | Purpose |
|-----------|---------|
| \`on:click={fn}\` | events (any DOM event) |
| \`bind:value={name}\` | two-way input binding — paths work too: \`bind:value={todo.text}\` |
| \`class:active={cond}\` | toggle one class |
| \`style:color={c}\` | one reactive style property |
| \`transition:fade\` | enter/leave animation (\`slide\`, \`scale\` too) |
| \`animate:flip\` | FLIP animation on keyed rows |
| \`use:action\` | run a function with the element (client-only) |

## Composition

\`\`\`html
<script>
  import Card from "../components/Card.niral"
  let n = $state(0)
</script>

<Card title="Stats" tone="accent" on:save={() => n++}>
  clicked {n} times          <!-- slot content -->
</Card>
\`\`\`

Inside \`Card.niral\`, \`<slot/>\` renders the children and \`on:save\` arrives as an
\`onSave\` prop. Props update **fine-grained** — the child keeps its local state.

## JSX / TSX

\`\`\`jsx
export default function Todo({ items }) {
  let draft = $state("")
  return (
    <ul>
      {items.map((t) => <li key={t.id}>{t.text}</li>)}
    </ul>
  )
}
\`\`\`

\`.tsx\` files are type-stripped at compile time and checked by \`niral check\`.
`,
  },

  reactivity: {
    title: "Reactivity",
    body: `
Niral compiles runes to **fine-grained signals** — no virtual DOM, no re-renders.
When state changes, exactly the text nodes and attributes that depend on it update.

## Runes

\`\`\`js
let count = $state(0)                   // reactive state
let double = $derived(count * 2)        // recomputes when count changes
let { title, limit = 10 } = $props      // component props (with defaults)
\`\`\`

Assignments just work — \`count++\`, \`count += n\`, \`items = [...items, x]\` all
compile to signal updates. Mutating an object inside a signal? Reassign it
(\`items = [...items]\`) or produce a new row object so keyed lists repaint.

## Effects and batching

\`\`\`js
import { effect, batch, untrack } from "niral/runtime"

effect(() => console.log("count is", count))   // re-runs on change
batch(() => { a = 1; b = 2 })                  // one flush for many writes
untrack(() => read(count))                     // read without subscribing
\`\`\`

## Context — no prop drilling

\`\`\`js
// provider (any ancestor)
setContext("theme", "dark")

// any descendant component, however deep
const theme = getContext("theme", "light")
\`\`\`

## Props are live views

A child never rebuilds when props change — each prop is a reactive view into the
parent. Local \`$state\`, focus, and input contents all survive updates. Props are
read-only; writing one throws with a hint.
`,
  },

  /* ── BUILD ─────────────────────────────────────────────────── */
  routing: {
    title: "Routing",
    body: `
File-based routing under \`routes/\`:

| File | URL |
|------|-----|
| \`routes/index.niral\` | \`/\` |
| \`routes/about.niral\` | \`/about\` |
| \`routes/blog/[slug].niral\` | \`/blog/:slug\` — \`params.slug\` |
| \`routes/docs/[...path].niral\` | catch-all — \`params.path = "a/b/c"\` |
| \`routes/_404.niral\`, \`routes/_error.niral\` | custom error pages |

## Layouts

\`routes/_layout.niral\` wraps every route in its directory and below. Layouts nest,
each has a \`<slot/>\`, and each can have its own \`<server>\` block with \`load()\` —
layout data merges into every page's props.

## Page modes

\`\`\`html
<script mode="static">  <!-- zero JS shipped — pure HTML -->
<script>                <!-- default: SSR + hydration -->
<script stream>         <!-- streaming SSR: head flushes BEFORE load() runs -->
\`\`\`

## Navigation

Same-origin links become client-side navigations automatically — \`load()\` runs on
the server per navigation, JSON comes back, the page swaps without a reload.
Links prefetch on hover. Non-JS visitors get normal full-page navigation.

## Head and shell

\`\`\`html
<head>
  <title>{post.title}</title>   <!-- props interpolate, HTML-escaped -->
</head>
\`\`\`

Customize the document with \`routes/_shell.html\` — put fonts, meta tags and the
\`<!--niral:head-->\` / \`<!--niral:outlet-->\` markers where you want them.
`,
  },

  styling: {
    title: "Styling",
    body: `
## Scoped styles

\`<style>\` blocks are scoped to their component — selectors are rewritten with a
content-derived class so components never leak into each other. \`body\`, \`html\`
and \`:root\` stay global; escape a selector with \`:global(.selector)\`; opt a whole
block out with \`<style global>\`.

## Tailwind — no npm

\`\`\`sh
niral add tailwind
\`\`\`

Downloads the standalone Tailwind binary (one time), wires \`styles/tw.css\` into
your shell, watches during \`niral dev\`, and minifies during \`niral build\`.

## Transitions

\`\`\`html
<p transition:fade>appears and disappears smoothly</p>
<li transition:slide={{ duration: 300 }}>…</li>

{#for row of rows key row.id}
  <tr animate:flip>…</tr>     <!-- rows glide on reorder -->
{/for}
\`\`\`

Enter plays on insert, leave plays before removal, FLIP animates reorders.
All powered by the Web Animations API — SSR and hydration never flash.
`,
  },

  typescript: {
    title: "TypeScript",
    body: `
Write \`<script lang="ts">\`, \`.ts\` modules, or \`.tsx\` components. Types are
stripped at compile time; **checking** uses the real TypeScript compiler:

\`\`\`sh
niral add typescript    # downloads tsc once into .niral/ (no npm needed)
niral check             # strict by default; your tsconfig.json is respected
\`\`\`

\`niral check\` understands \`.niral\` files:

- \`<script lang="ts">\` and \`<server lang="ts">\` blocks are checked in place —
  diagnostics point at the **original line** in your .niral file
- runes (\`$state\`, \`$props\` …) and server ambients (\`session\`, \`log\`, \`v\` …) are
  pre-declared — no setup
- server exports become typed RPC stubs automatically

\`\`\`html
<script lang="ts">
  let count = $state(0)
  const label: string = count   // niral check: TS2322, right here
</script>
\`\`\`

If the project already has \`node_modules/typescript\`, that install is used.
`,
  },

  /* ── SERVER ────────────────────────────────────────────────── */
  server: {
    title: "Server functions",
    body: `
The \`<server>\` block is your backend. Exports become **RPC endpoints** with
compile-time client stubs; \`load()\` runs during SSR and feeds \`$props\`.

\`\`\`html
<server>
export async function load({ params }) {
  return { post: await findPost(params.slug) }
}
export async function like(postId) {
  session.set("liked", true)
  return { count: 42 }
}
</server>

<script>
  let { post } = $props
  // like("id") — just call it; it's a POST under the hood
</script>
\`\`\`

## Ambient helpers

Every JS server block gets these without imports:

| Ambient | Purpose |
|---------|---------|
| \`session\` | get/set/delete/clear — signed cookie (or DB store) |
| \`user()\`, \`auth.*\` | the signed-in user, login/logout, passkeys, TOTP, OAuth |
| \`v\`, \`validate\`, \`withSchema\` | input validation |
| \`ai\`, \`rag\` | AI chat/stream/embed + retrieval |
| \`mail()\` | send email over SMTP |
| \`enqueue()\` | queue a background job |
| \`publish()\` | push to a live channel |
| \`log\` | structured logging |
| \`env()\` | environment variables |
| \`projectImport()\` | import project files (lib/db.js …) |

## Streaming responses

An \`async function*\` streams — perfect for AI tokens and progress:

\`\`\`js
// server
export async function* ask(prompt) {
  for await (const chunk of ai.stream(prompt)) yield chunk
}
// client
const stream = await ask("explain closures")
for await (const chunk of stream) text += chunk
\`\`\`

## Form actions — works without JS

\`\`\`html
<form method="post" action="?/save">
  <input name="title" />
  <button>Save</button>
</form>
\`\`\`

\`save(fields)\` runs on the server. With JS the page updates in place; without JS
the browser does a classic POST and re-render. Multipart uploads arrive as
\`{ filename, type, size, data }\` buffers, capped and sanitized.

## Python, Ruby, Go backends

\`\`\`html
<server lang="python">
import statistics
def stats(xs):
    return { "mean": statistics.mean(xs) }
</server>
\`\`\`

Same RPC, same sessions, same \`load()\` — the code runs in a persistent worker
speaking a newline-JSON protocol. Go is compiled once at first use.

## Middleware — hooks.js

\`\`\`js
// hooks.js at the project root
export async function handle(event) {
  if (event.path.startsWith("/admin") && !event.session.get("user")) {
    return event.redirect("/auth/login")
  }
  event.locals.tenant = lookupTenant(event.headers.host)
  return null // continue
}
\`\`\`

## Sessions at scale

Sessions live in a signed HttpOnly cookie by default. Set
\`NIRAL_SESSION_STORE=db\` and the data moves into \`data/sessions.db\` — the
cookie shrinks to a signed id, and the 4KB limit disappears.

## Databases

SQLite is built in and is the **default** — one file, zero setup, survives
deploys. Outgrowing one box? Niral ships its own **pure-Node Postgres** driver
(no \`pg\`, TLS included) — set \`NIRAL_DATABASE_URL\` and use the ambient \`sql\`
in any \`<server>\` block:

\`\`\`html
<server>
export async function load() {
  const { rows } = await sql.query("select * from posts where author = $1", [id])
  return { posts: rows }
}
</server>
\`\`\`

Full guide: [Databases — SQLite & Postgres](/docs/database).
`,
  },

  database: {
    title: "Databases",
    body: `
Niral has a database in the box. **SQLite is the default** — and for most
apps, the finish line. When you outgrow one machine, the **same code** talks to
Postgres instead. No ORM to learn, no driver to install.

## SQLite — the default

\`node:sqlite\` ships with Node, so there's nothing to set up. Your data lives in
\`data/app.db\`, which sits **outside** the release folder — so it survives every
deploy — and \`niral snapshot\` backs it up.

The fastest start is a recipe — it scaffolds a complete, working database-backed
route you own:

\`\`\`sh
niral add sqlite
\`\`\`

Or open a database yourself in any \`<server>\` block with Node's built-in driver:

\`\`\`html
<server>
import { DatabaseSync } from "node:sqlite"
const db = new DatabaseSync("data/app.db")
db.exec("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT)")

export async function load() {
  return { posts: db.prepare("SELECT * FROM posts ORDER BY id DESC").all() }
}
export async function add(title) {
  db.prepare("INSERT INTO posts (title) VALUES (?)").run(title)
}
</server>
\`\`\`

One file, one process, zero services — a \$5 box runs the whole thing. Most
products never need more.

## Postgres — when you need it

Heavy concurrent writes, multiple servers, or big data? Point at Postgres. Niral
speaks the Postgres wire protocol **directly** — SCRAM-SHA-256 auth, TLS,
parameterized queries and a connection pool — with its **own pure-Node driver.
No \`pg\`, no npm, still zero dependencies.**

You don't install Postgres either: use a **managed database** (Neon, Supabase,
AWS RDS, GCP Cloud SQL, Railway, …). They hand you a URL — set one env var:

\`\`\`sh
# managed — install nothing, TLS is built in
NIRAL_DATABASE_URL=postgres://user:pass@ep-cool-name.neon.tech/db?sslmode=require

# or your own box on a private network
NIRAL_DATABASE_URL=postgres://user:pass@localhost:5432/mydb
\`\`\`

Now the ambient \`sql\` works in any \`<server>\` block:

\`\`\`html
<server>
export async function load({ params }) {
  // $1, $2 params are SQLi-safe — the value is data, never SQL
  const { rows } = await sql.query(
    "select id, title from posts where author = $1 order by created_at desc",
    [params.author]
  )
  return { posts: rows }
}

export async function publish(title, body) {
  const { rows } = await sql.query(
    "insert into posts (title, body) values ($1, $2) returning id",
    [title, body]
  )
  return rows[0].id
}
</server>
\`\`\`

\`sql.query(text, params)\` returns \`{ rows, fields }\`. Types come back decoded —
\`int → number\`, \`bool → boolean\`, \`json/jsonb → object\`. A pool is managed for
you; just \`await sql.query(...)\`.

## TLS modes

TLS follows libpq semantics via the connection string:

| \`sslmode\` | behaviour |
| --- | --- |
| *(none)* / \`disable\` | plaintext — localhost or a private network |
| \`require\` | encrypt the connection (managed providers) |
| \`verify-full\` | encrypt **and** validate the server certificate |

## Safety

Always pass values as **parameters** (\`$1\`, \`?\`), never string-concatenate
them into SQL. Parameters are sent separately from the query text, so an
injection payload arrives as plain data — it can never become SQL. This is the
same rule for SQLite and Postgres.

## Scaling out

Running Postgres across **multiple servers**? See [Scaling to many
servers](/docs/scaling) — the same database also powers Niral's realtime
backplane and its shared background-job queue, so a whole cluster coordinates
through one Postgres with no extra moving parts.
`,
  },

  auth: {
    title: "Authentication",
    body: `
\`\`\`sh
niral add auth
\`\`\`

Scaffolds working pages into **your** project (you own the code):
\`/auth/register\`, \`/auth/login\`, \`/auth/account\` and an OAuth callback route —
with passwords (scrypt), **passkeys** (WebAuthn), **TOTP 2FA**, login rate
limiting, and session rotation. Zero dependencies — Niral implements WebAuthn,
CBOR and TOTP itself.

## Guarding routes

\`\`\`html
<server auth>            <!-- signed-in users only -->
<server auth="admin">    <!-- role required -->
\`\`\`

Guards run **before any user code** — pages redirect to login (with \`?next=\`),
RPC and form actions return 401/403. Layout guards protect whole sections.

## The user, everywhere

\`props.user\` is available on every page; \`user()\` in every server block.

\`\`\`js
export async function load() {
  return { orders: await ordersFor(user().email) }
}
\`\`\`

## OAuth

Set \`NIRAL_OAUTH_GOOGLE_ID\` / \`_SECRET\` (also github, microsoft, linkedin) and
"Continue with Google" appears on the scaffolded login page. PKCE + state on
every provider.
`,
  },

  validation: {
    title: "Validation",
    body: `
Built-in coercing schemas — form strings become typed values, errors become
field messages. No Zod needed.

\`\`\`js
export const signup = withSchema(
  {
    email: v.email(),
    age: v.int({ min: 13 }),
    tags: v.array(v.string({ min: 1 }), { min: 1, max: 5 }),
    bio: v.optional(v.string({ max: 500 })),
  },
  async ({ email, age, tags, bio }) => {
    // values are validated AND coerced ("42" → 42, "on" → true)
    return { ok: true }
  }
)
\`\`\`

- **RPC callers** get a 400 with \`{ errors: { field: message } }\` — the thrown
  client error carries \`.errors\` for form UIs
- **Form actions** surface it as \`form.errors.field\` in props
- \`v.file()\` validates uploads (size, types — \`image/*\` wildcards work)

Rules: \`string\`, \`email\`, \`int\`, \`number\`, \`bool\`, \`oneOf\`, \`array\`, \`file\`,
\`object\`, \`optional\`.
`,
  },

  realtime: {
    title: "Realtime",
    body: `
Live channels over framework-owned WebSockets — no socket.io.

\`\`\`html
<server>
export async function notify(text) {
  publish("alerts", { text })          // reaches every subscribed browser
  return true
}
</server>

<script>
  let feed = $state([])
  live("alerts", (msg) => feed = [...feed, msg])
</script>
\`\`\`

\`live(channel, cb)\` subscribes (auto-reconnect included) and returns
\`{ send, close }\` — \`send\` fans out to the channel's other members.
\`publish()\` works from **any** server language, jobs included.

## Guarding channels

\`\`\`js
// hooks.js
export function liveAuth({ channel, user }) {
  if (channel.startsWith("private:")) return !!user
  return true
}
\`\`\`

Denied joins get \`{ type: "denied" }\` — and a crashing guard denies, never
fails open.

> Running on more than one server? Turn on the [cluster backplane](/docs/scaling)
> and \`publish()\` reaches subscribers on **every** node, not just the one that
> ran the code.
`,
  },

  scaling: {
    title: "Scaling to many servers",
    body: `
Niral is built to run beautifully on **one small box** — a ₹300/month VPS, a
free tier, a shared laptop. Most apps never need more. But when you outgrow a
single server, Niral scales horizontally without changing your code.

## The shape of a cluster

Run the **same app on N servers** behind a load balancer. Three things make
that just work:

- **Stateless requests.** Sessions live in a signed cookie by default, so any
  server can serve any request — no sticky sessions, no shared session store.
- **Shared database.** Point every node at the same [Postgres](/docs/server)
  (\`NIRAL_DATABASE_URL\`) — managed (Neon / Supabase / RDS) or your own.
- **A real-time backplane.** So \`publish()\` on one node reaches clients
  connected to *another* node.

## Turn on the backplane

Set two env vars and real-time channels fan out across every server using
**Postgres LISTEN/NOTIFY** — no Redis, no extra dependency, just the pg driver
Niral already ships:

\`\`\`sh
NIRAL_CLUSTER=1
NIRAL_DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
\`\`\`

Nothing else changes. \`publish("alerts", msg)\` and client \`send()\` now reach
subscribers on **any** node — behaviour is identical whether you run 1 server
or 50. Off by default: Niral stays a single fast process until you ask for more.

## Load balancer

\`niral deploy\` writes a ready \`deploy/nginx-cluster.conf\` — an nginx upstream
that spreads requests across your instances (no stickiness needed):

\`\`\`nginx
upstream app_cluster {
    least_conn;
    server 127.0.0.1:8201;
    server 127.0.0.1:8202;
    server 127.0.0.1:8203;
    keepalive 32;
}
server {
    location / {
        proxy_pass http://app_cluster;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # WebSocket live channels
        proxy_set_header Connection "upgrade";
    }
}
\`\`\`

Start the instances with the templated systemd unit (\`deploy/niral-cluster@.service\`):

\`\`\`sh
sudo systemctl enable --now app@8201 app@8202 app@8203
\`\`\`

Add more ports (or more boxes) to scale out — every instance is stateless, so
there is nothing to coordinate.

## Background jobs

Two options across a cluster:

- **Shared Postgres queue (symmetric).** Set \`NIRAL_JOBS_STORE=pg\` on every
  node — any node enqueues, any node works the queue (claimed with \`FOR UPDATE
  SKIP LOCKED\`), and cron fires once via a Postgres advisory-lock leader. No
  special box. See [Jobs](/docs/jobs).
- **Dedicated worker.** Or run the queue + cron on **one** \`niral jobs\` process
  and set \`NIRAL_JOBS=off\` on the web instances.

## Health checks

Every instance exposes \`GET /@niral/health\` (release + uptime, no secrets) —
point your balancer's health check at it so a bad node is pulled automatically.
`,
  },

  /* ── CAPABILITIES ──────────────────────────────────────────── */
  ai: {
    title: "AI",
    body: `
Niral speaks the OpenAI-compatible wire format — point it at OpenAI, Azure,
Ollama, vLLM, llama.cpp or your own model:

\`\`\`sh
NIRAL_AI_URL=http://localhost:11434/v1   # e.g. Ollama
NIRAL_AI_MODEL=llama3.2
NIRAL_AI_KEY=…                           # cloud providers
\`\`\`

## The ambient ai

\`\`\`js
const text = await ai.chat("explain closures", { system: "be brief" })
const data = await ai.chat(prompt, { json: true })        // parsed JSON output
const [vec] = await ai.embed(["some text"])               // embeddings

export async function* ask(messages) {                     // token streaming
  for await (const chunk of ai.stream(messages)) yield chunk
}
\`\`\`

Streaming server functions pair with streaming RPC — the client consumes tokens
with \`for await\`. \`niral add chat\` scaffolds a complete streaming chat page.

## RAG — retrieval built in

\`\`\`js
await rag.ingest(handbookText, { source: "handbook.md" })
const hits = await rag.search("refund policy", { k: 5 })
const answer = await ai.chat(
  "Answer from the context:\\n" + hits.map((h) => h.content).join("\\n---\\n") +
  "\\n\\nQuestion: " + q
)
\`\`\`

Chunks and embeddings live in \`data/rag.db\` — they survive deploys.

## Fully local

\`\`\`sh
niral add llm          # official llama.cpp server binary, one download
\`\`\`

Run a GGUF model on localhost, point \`NIRAL_AI_URL\` at it — every AI feature
works offline, no keys, no cloud.
`,
  },

  jobs: {
    title: "Jobs & cron",
    body: `
A durable background queue — in the framework, not a Redis cluster.

\`\`\`js
// jobs.js at the project root
export const jobs = {
  sendWelcome: async ({ email }) => {
    await mail({ to: email, subject: "Welcome!", text: "…" })
  },
}

export const schedules = [
  { cron: "0 9 * * 1", job: "weeklyDigest" },   // Mondays 9:00
]
\`\`\`

\`\`\`js
// any server block
await enqueue("sendWelcome", { email }, { delay: 5000, maxAttempts: 5 })
\`\`\`

- Jobs persist in \`data/jobs.db\` — they **survive restarts and deploys**
- Failures retry with exponential backoff; exhausted jobs land in a dead-letter
  list you can inspect
- One sleeping timer — zero cost on the request path
- Scale out with \`niral jobs\` as a dedicated worker process (\`NIRAL_JOBS=off\`
  on the web servers)

## Shared queue across servers

SQLite is the default (one box). Running a [cluster](/docs/scaling)? Set
\`NIRAL_JOBS_STORE=pg\` (+ \`NIRAL_DATABASE_URL\`) and the queue moves into
**Postgres** — the same zero-dep driver, no Redis:

\`\`\`sh
NIRAL_JOBS_STORE=pg
NIRAL_DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
\`\`\`

Now **any** node can \`enqueue()\` and **any** worker picks the job up — claimed
atomically with \`SELECT … FOR UPDATE SKIP LOCKED\` so a job never runs twice.
Cron fires **once** across the whole cluster (one node wins a Postgres advisory
lock and owns the schedule; if it dies, another takes over). A job abandoned by
a crashed worker is reclaimed automatically. Same \`jobs.js\`, same \`enqueue()\` —
just a bigger queue. Tip: \`await enqueue(...)\` so the row is committed before
your response returns.
`,
  },

  utilities: {
    title: "Mail, i18n & observability",
    body: `
## Mail — own SMTP client

\`\`\`sh
NIRAL_SMTP_URL=smtp://user:pass@smtp.provider.com:587
NIRAL_MAIL_FROM="App <noreply@app.dev>"
\`\`\`

\`\`\`js
await mail({ to, subject: "Reset your password", text, html })
\`\`\`

STARTTLS, AUTH, MIME multipart, unicode subjects, header-injection rejection —
works with SES, Mailgun, Postmark, Gmail.

## i18n

Put catalogs in \`i18n/\` — \`en.json\`, \`ta.json\` … (nested keys flatten):

\`\`\`html
<h1>{t("nav.home")}</h1>
<p>{t("greet", { name })}</p>
\`\`\`

The locale is negotiated per request — \`niral_locale\` cookie (your language
switcher sets it) → Accept-Language → default. SSR and client render from the
same catalog, so there's no flash. \`props.locale\` is on every page.

## Observability

Production logs are structured JSON lines with request correlation:

\`\`\`json
{"t":"…","level":"info","msg":"request","req":"a1b2c3d4","method":"GET","path":"/","status":200,"ms":3.1}
\`\`\`

- 4xx and slow requests (\`NIRAL_SLOW_MS\`) escalate to warn, 5xx to error
- \`log.info("payment ok", { orderId })\` — ambient in server blocks
- \`GET /@niral/health\` → release hash, uptime, pid (for load balancers)
- \`NIRAL_LOG=pretty\` for humans, \`=off\` for silence
`,
  },

  images: {
    title: "Images",
    body: `
\`\`\`sh
niral add image              # a best-practice <Img> component (yours to edit)
niral add image --transcode  # + official cwebp — builds emit .webp variants
\`\`\`

\`<Img>\` ships lazy loading, async decode, explicit dimensions (zero layout
shift) and \`priority\` for hero images.

With transcoding, \`niral build\` turns every raster image into responsive WebP:

\`\`\`text
hero.jpg (1800px)  →  hero.webp
                      hero-480.webp   480w
                      hero-960.webp   960w
                      hero-1600.webp  1600w    (never upscaled)
\`\`\`

\`\`\`html
<Img src="/hero.webp" width={1800} height={1200}
     srcset="/hero-480.webp 480w, /hero-960.webp 960w, /hero-1600.webp 1600w"
     sizes="(max-width: 600px) 100vw, 600px" priority={true} />
\`\`\`

Results are content-hash cached — rebuilds are free.
`,
  },

  /* ── SHIP ──────────────────────────────────────────────────── */
  deployment: {
    title: "Deployment",
    body: `
## Atomic releases

\`\`\`sh
niral build     # dist/releases/<hash>/ — then dist/current flips atomically
niral start     # serves dist/current
niral deploy    # generates deploy/ — setup.sh (one-time Linux provisioning:
                # node 22, systemd, nginx, generated NIRAL_SECRET), deploy.sh
                # (rsync → build ON the server → restart → health check),
                # systemd unit, nginx conf, Dockerfile. Templates you own.
\`\`\`

- A **failed build never touches production** — the flip only happens on success
- The last 5 releases stay on disk: rollback = repoint one symlink
- Assets are served under versioned paths with \`immutable\` caching; stale
  hashes from mid-deploy sessions redirect to the current release
- \`data/\` lives outside releases — SQLite databases survive every deploy

## Graceful shutdown

\`niral start\` drains on \`SIGTERM\`/\`SIGINT\` (what \`systemctl restart\` sends):
it stops accepting, lets in-flight requests finish, sends live WebSockets a
proper close frame so clients reconnect to the new process, stops jobs and
workers — then exits. A deploy never drops work mid-request.

## Required environment

Declare what the app cannot run without in \`hooks.js\`:

\`\`\`js
export const env = ["STRIPE_KEY", "SMTP_PASS"]
\`\`\`

Production **refuses to boot** when any are missing — the failure happens at
deploy time with a message naming them, not at 3am mid-request. Dev warns.

## Security defaults

Every production response ships CSP with per-request nonces, \`nosniff\`,
frame denial and referrer policy. Sessions are HttpOnly + SameSite (+ \`Secure\`
with \`NIRAL_SECURE=1\`). RPC requires a CSRF header and is rate limited.
Page caching: \`<script cache="120">\` sets \`stale-while-revalidate\` headers.

## Static export

\`\`\`sh
niral export    # prerenders every parameterless route to out/
\`\`\`

Pretty URLs, hashed assets, custom 404 — host it anywhere. Client pages still
hydrate; server features (RPC, actions) need \`niral start\`.

## Environment

| Variable | Purpose |
|----------|---------|
| \`NIRAL_SECRET\` | session signing key (set it in production!) |
| \`NIRAL_SECURE=1\` | Secure cookies behind HTTPS |
| \`NIRAL_SESSION_STORE=db\` | server-side session data |
| \`NIRAL_LOG\`, \`NIRAL_ACCESS_LOG\`, \`NIRAL_SLOW_MS\` | logging |
| \`NIRAL_AI_URL/KEY/MODEL\` | AI endpoint |
| \`NIRAL_SMTP_URL\`, \`NIRAL_MAIL_FROM\` | mail |
| \`NIRAL_WORKERS\` | polyglot worker pool size |
`,
  },

  security: {
    title: "Security & Shield",
    body: `
Niral is **hardened by default** — and with the **Shield**, a niral app also
watches itself, evicts attackers, and detects tampering. All in-process, no
external service, no second machine.

> Honest scope: this protects your app and narrows an attacker's options on the
> box. It cannot stop a volumetric DDoS (that needs network-edge capacity) or
> someone who already has root. Niral is *self-healing under attack* — never
> *unhackable*, and we will never claim otherwise.

## Hardened by default

Every production response and request already carries:

- **CSP with per-request nonces**, \`X-Frame-Options: DENY\`, \`nosniff\`, referrer policy
- **Signed, HttpOnly, SameSite** sessions (+ \`Secure\` with \`NIRAL_SECURE=1\`)
- **CSRF blocked structurally** — RPC is JSON-only and requires an \`x-niral-rpc\` header
- **XSS** — templates auto-escape; **SQLi** — \`node:sqlite\` is parameterized
- **Rate limiting**, body/upload/argument caps, path-traversal blocks, private-file 404s
- Secrets that **cannot reach the browser** (reading \`process.env\` in client code is a compile error)

## The Shield

The Shield inspects every request *before routing* and responds in-process:

- **Scanner bans** — a request for something a niral app never has (\`/wp-admin\`,
  \`.php\`, \`/.env\`, \`/.git\`) is a scanner. A few of those and the IP is banned.
- **Brute-force & flood detection** — repeated 401/403/404s from one IP raise
  strikes; past the threshold, a temporary ban (fail2ban-style, in memory).
- **Injection heuristics** — traversal, reflected-XSS and SQLi shapes in the URL
  are blocked and counted.
- **Lockdown** — a *sustained* attack freezes writes: POST/PUT/PATCH/DELETE get
  \`503\`, the site stays up **read-only**, the attack surface closes.
- **Tamper-evident audit log** — every event is hash-chained in
  \`data/shield.log.jsonl\`; altering a past entry breaks the chain (\`niral shield verify\`).
- **Owner alerts** — with \`NIRAL_SMTP_URL\` + \`NIRAL_ALERT_TO\` set, the first ban,
  lockdown, and any tampering mail you (throttled — an attack can't flood your inbox).

The Shield is on by default. Tune or disable it:

\`\`\`sh
NIRAL_SHIELD=off              # disable entirely
NIRAL_SHIELD_STRIKES=6        # strikes before a ban (probes weigh 3)
NIRAL_SHIELD_BAN_MS=900000    # ban duration (15 min)
NIRAL_SHIELD_LOCKDOWN=8       # distinct bans in 5 min → lockdown
NIRAL_TRUST_PROXY=1           # read client IP from X-Forwarded-For (behind nginx)
\`\`\`

## Release integrity — tamper detection

A niral release is content-hashed, so tamper detection is nearly free. \`niral build\`
writes \`integrity.json\` — a sha256 of every file in the release. The running
server re-hashes itself on a timer; if a served file changed on disk (a defaced
page, an injected script, a swapped server module), it's logged and mailed.

\`\`\`sh
niral shield integrity        # re-hash the current release vs its build manifest
niral shield verify           # confirm the audit log's hash chain is unbroken
niral shield log              # recent bans, probes and lockdowns
\`\`\`

Because deploys are atomic and the last releases are kept, recovering from a
tampered release is a one-symlink rollback.

## Recover — snapshots, restore, rollback, eviction

Detection is half the story. Niral also **revives** — all on the same box:

\`\`\`sh
niral snapshot                # back up every data/*.db right now
niral snapshot list           # what's available (newest first)
niral restore latest          # roll databases back to a snapshot (undoable —
                              # the live state is snapshotted first)
niral rollback                # flip dist/current to the previous release
niral rollback --to <hash>    # …or a specific one
niral rotate-secret           # new NIRAL_SECRET — every session dies at once
\`\`\`

**Snapshots are automatic** at the moments data is most at risk: hourly, before
every migration, and before every deploy (the generated \`deploy.sh\` snapshots
first). They use SQLite's \`VACUUM INTO\` — a consistent copy even while the app
is writing. The newest 24 are kept; older ones prune.

**Auto-rollback**: set \`NIRAL_AUTO_ROLLBACK=1\` and a tampered release reverts to
the previous good one and restarts itself — the site heals without you awake.

**Session eviction**: \`niral rotate-secret\` writes a fresh signing key, so every
existing cookie stops verifying instantly — an attacker who stole a session is
kicked out on the next request.

## The watchdog — an independent guardian

The Shield runs inside the app. But an app can't report its own death, and a
compromised app could silence its own checks. So Niral also ships a **watchdog**
— a SEPARATE process (its own systemd unit) that guards the app from outside:

- **probes \`/@niral/health\`** — down repeatedly → alerts you (and catches a
  crash-loop systemd can't)
- **re-hashes the release independently** — catches tampering even if the app's
  own integrity check was disabled or the app process was compromised
- **verifies the audit chain** from outside the app
- with \`NIRAL_AUTO_ROLLBACK=1\`, **rolls back a tampered release and restarts** the
  app unit

If an attacker kills the app, the watchdog survives to act; if they kill the
watchdog, systemd brings it back. The two processes guard each other and share
no memory — only the files on disk. \`niral deploy\` generates the watchdog unit
and \`setup.sh\` enables it automatically.

> On-box backups protect against bad deploys, corruption and malicious writes.
> They do NOT survive the machine being lost or root-wiped — push snapshots
> off-box for that (roadmap: \`niral snapshot --remote\`).

## Audit your setup

\`\`\`sh
niral doctor --security       # is the Shield on? proxy IP trusted? cookies
                              # Secure? alerts wired? integrity + audit intact?
\`\`\`

## What no other framework ships

Every serious framework hardens your app. Niral is the first that also **watches
it, evicts attackers, restores it, and heals itself** — because it's the only
one that owns the server, the deploy, and the database in one zero-dependency
codebase.
`,
  },

  cli: {
    title: "CLI reference",
    body: `
\`\`\`text
niral create <name>              new project
niral dev [dir] [-p port]        dev server (HMR, overlays)      default 5199
niral doctor [dir]               diagnose "why won't it start" problems
niral check [dir]                TypeScript checking
niral test [dir]                 run the project's tests/
niral migrate [dir] [--db path]  apply pending migrations/ (auto-runs at boot)
niral build [dir] [-o dist]      production release
niral start [dir] [-p port]      production server               default 8199
niral deploy [dir]               generate deploy/ — systemd, nginx, Dockerfile
niral export [dir] [-o out]      static site
niral jobs [dir]                 standalone job/cron worker
niral compile <file> [-o out]    compile one component
niral lsp                        language server (stdio)
\`\`\`

## Testing — niral test

Drop \`tests/*.test.js\` in the project. Helpers are ambient — no imports:

\`\`\`js
test("home renders and the server answers", async () => {
  const app = await startApp()          // boots THIS app on a random port
  const html = await (await fetch(app.url + "/")).text()
  ok(html.includes("<h1>"), "rendered")
})
\`\`\`

\`test\` \`ok\` \`eq\` \`startApp\` \`renderRoute\` — exits 1 on failure, CI-ready.

## Doctor — niral doctor

One command that checks the things that actually go wrong: Node version,
broken \`hooks.js\`/\`jobs.js\` (a syntax error there breaks every request),
missing declared env vars, \`.gitignore\` covering env files, \`NIRAL_SECRET\`,
\`data/\` writability, pending migrations, and whether a production release
exists. ✓ / ! / ✗ lines — exits 1 only on hard failures.

## Migrations — niral migrate

Numbered SQL files in \`migrations/\` run once each, in order, in transactions:

\`\`\`text
migrations/001-create-users.sql
migrations/002-add-votes.sql       → applied to data/app.db, tracked in _migrations
\`\`\`

They auto-apply when the server boots — a deploy that adds a migration ships
its own schema change. A failing file rolls back and stops the boot loudly.

## Recipes — niral add

Recipes either scaffold code you own, or download one official binary. Never npm.

| Recipe | What you get |
|--------|--------------|
| \`auth\` | register/login/account pages — passkeys, 2FA, OAuth, guards |
| \`tailwind\` | standalone Tailwind binary, wired and watched |
| \`chat\` | streaming AI chat page |
| \`llm [--model url]\` | local llama.cpp server — offline AI |
| \`typescript\` | the real TS compiler for \`niral check\` |
| \`image [--transcode]\` | \`<Img>\` component (+ cwebp WebP pipeline) |
| \`sqlite\` | a database-backed route (Python + sqlite3) |
| \`fonts [--family N]\` | self-hosted Google Fonts |

## Editor support

The \`editors/vscode\` extension gives syntax highlighting, diagnostics with
teaching hints, completions and hover docs — driven by \`niral lsp\`, which any
LSP-capable editor can use.
`,
  },

  benchmarks: {
    title: "Benchmarks",
    body: `
Identical 1000-row SSR'd apps per framework, same machine, alternating-order
runs, medians reported. Full methodology lives in the repo under
\`bench/hydration/\` and \`bench/e2e/\` — run them yourself.

## End-to-end — real production servers

The whole request path: each framework's own production server, dynamic SSR on
every request, no caching, 100 connections for 10 seconds. Zero errors for
every framework.

| Framework | req/s | p50 | p99 | build |
|-----------|------:|----:|----:|------:|
| **niral** | **~2,374** | **39 ms** | **81 ms** | **0.2 s** |
| solidstart 1 | ~1,885 | 43 ms | 151 ms | 4.9 s |
| astro 5 | ~698 | 140 ms | 338 ms | 1.3 s |
| sveltekit 2 | ~599 | 137 ms | ~1.1 s | 2.9 s |
| next 16 | ~303 | 305 ms | ~2.3 s | 3.9 s |

niral leads every JS meta-framework on throughput — ~1.3× SolidStart (the
closest rival), ~3.4× Astro, ~4× SvelteKit, ~7.8× Next.js — with the **best tail
latency** (p99 81 ms while every other exceeds 150 ms) and the lowest memory.

## Hydration (parse start → interactive)

| Framework | median | p90 | JS shipped |
|-----------|-------:|----:|-----------:|
| **niral** | **6.6 ms** | **9.1 ms** | **29.7 KB** |
| svelte 5 | 6.4 ms | 15.8 ms | 51.1 KB (min) |
| react 19 | 20.3 ms | 22.5 ms | 189.0 KB (min) |

## Server rendering (renders/second, same page)

| Framework | ms/render | renders/sec |
|-----------|----------:|------------:|
| svelte 5 | 0.18 | ~5,600 |
| **niral** | **0.18–0.24** | **~4,200–5,500** |
| react 19 | 2.5 | ~395 |

Niral compiles a second, string-concatenation renderer per component — server
output is byte-identical to what hydration expects, with none of the tree cost.

Numbers vary with hardware and load; compare within one session and prefer
medians. The bench is deliberately reproducible — we'd rather you check.
`,
  },
};
