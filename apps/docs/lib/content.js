/**
 * Docs content — every page as markdown. Grouped for the sidebar.
 */

export const GROUPS = [
  { name: "Start", slugs: ["getting-started", "components", "reactivity"] },
  { name: "Build", slugs: ["routing", "styling", "typescript"] },
  { name: "Server", slugs: ["server", "auth", "validation", "realtime"] },
  { name: "Capabilities", slugs: ["ai", "jobs", "utilities", "images"] },
  { name: "Ship", slugs: ["deployment", "cli", "benchmarks"] },
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

There is nothing to install — a git clone IS the framework:

\`\`\`sh
git clone https://github.com/Zyora-Dev/niral.git
alias niral="node $PWD/niral/bin/niral.js"   # add to your shell profile
\`\`\`

## Create an app

\`\`\`sh
niral create my-app
cd my-app
niral dev            # http://localhost:5199 — HMR, error overlays
\`\`\`

The scaffold is a real working app: a server-rendered page with reactive state,
a keyed list, and a server function called over RPC.

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

The whole request path: each framework's own production server (\`niral start\`,
\`next start\`, SvelteKit adapter-node), dynamic SSR on every request, no
caching, 100 connections for 10 seconds. Zero errors for every framework.

| Framework | req/s | p50 | p99 | cold start | build |
|-----------|------:|----:|----:|-----------:|------:|
| **niral** | **~2,200** | **40 ms** | ~150 ms | **~160 ms** | **0.2 s** |
| sveltekit 2 | ~580 | 128 ms | ~1.6 s | ~160 ms | 2.3–3.7 s |
| next 16 | ~290 | 310 ms | ~2.3–3.2 s | ~350 ms | 3.3–5.5 s |

~3.8× SvelteKit and ~7.5× Next.js on dynamic SSR throughput — and p99 stays
near 150 ms while the others exceed 1.5 s under the same load.

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
