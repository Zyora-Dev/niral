/**
 * niral create <name> — a new project, zero to running in one command.
 *
 * Scaffolds the smallest REAL app that shows the model: a hydrated page with
 * state + a keyed list, a zero-JS static page, and a <server> block with
 * load() + an RPC function. No dependencies to install — `niral dev` runs it.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { TEMPLATES, TEMPLATE_NAMES } from "./templates.js";

const INDEX = `<server>
// runs on the server only — never ships to the browser
export async function load() {
  return { started: new Date().toLocaleTimeString() }
}

export async function hello(name) {
  return \`hello \${name} — from the server at \${new Date().toLocaleTimeString()}\`
}
</server>

<script>
  const icons = "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/"
  let { started } = $props
  let count = $state(0)
  let items = $state([{ id: 1, text: "read the code in routes/index.niral" }, { id: 2, text: "edit me — HMR keeps state" }])
  let draft = $state("")
  let reply = $state("")
  let pending = $state(false)

  function add() {
    if (!draft.trim()) return
    items = [...items, { id: Date.now(), text: draft.trim() }]
    draft = ""
  }
  async function ping() {
    pending = true
    try {
      reply = await hello("niral")
    } catch (error) {
      reply = error.message || "The request failed. Try again."
    } finally {
      pending = false
    }
  }
</script>

<head>
  <title>Your new app | Niral</title>
  <meta name="description" content="Your new Niral application." />
</head>

<div class="shell">
  <aside class="project">
    <a class="brand" href="/" aria-label="Niral home"><img src="/niral-logo.svg" alt="Niral" width="112" height="36" /></a>
    <section class="welcome" aria-labelledby="welcome-title">
      <p class="eyebrow"><span class="status-dot"></span> YOUR APP IS RUNNING</p>
      <h1 id="welcome-title">It works.</h1>
      <dl class="build-info">
        <div><dt>ENTRY POINT</dt><dd><code>routes/index.niral</code></dd></div>
        <div><dt>SERVER RENDERED AT</dt><dd>{started}</dd></div>
        <div><dt>RUNTIME DEPENDENCIES</dt><dd>0</dd></div>
      </dl>
    </section>
    <nav class="resources" aria-label="Resources">
      <a href="https://niral.site/docs/getting-started"><img class="icon" src={icons + "book-open.svg"} alt="" width="18" height="18" /><span>Read the docs</span><img class="icon link-arrow" src={icons + "arrow-up-right.svg"} alt="" width="16" height="16" /></a>
      <a href="/about"><img class="icon" src={icons + "file-code-2.svg"} alt="" width="18" height="18" /><span>The static page</span><img class="icon link-arrow" src={icons + "arrow-right.svg"} alt="" width="16" height="16" /></a>
      <a href="https://github.com/Zyora-Dev/niral"><img class="icon" src={icons + "github.svg"} alt="" width="18" height="18" /><span>Explore the source</span><img class="icon link-arrow" src={icons + "arrow-up-right.svg"} alt="" width="16" height="16" /></a>
    </nav>
    <footer>Built at <a href="https://zyoralabs.com">ZyoraLabs <img class="icon" src={icons + "arrow-up-right.svg"} alt="" width="14" height="14" /></a></footer>
  </aside>
  <main>
    <header class="topbar"><span>Niral / Starter</span><span class="environment"><span class="status-dot"></span> Local development</span></header>
    <section class="playground" aria-labelledby="playground-title">
      <div class="section-heading"><h2 id="playground-title">The playground</h2><span>READY</span></div>
      <div class="demo">
        <section class="experiment counter" aria-labelledby="counter-title">
          <div class="experiment-heading"><p class="panel-index"><img class="icon" src={icons + "activity.svg"} alt="" width="18" height="18" />01 / STATE</p><h3 id="counter-title">Make it count.</h3></div>
          <div class="counter-body">
            <output class="count" aria-live="polite">{count}</output>
          <div class="counter-controls">
            <button class="icon-button" on:click={() => count--} aria-label="Decrease count" title="Decrease count"><img class="icon" src={icons + "minus.svg"} alt="" width="20" height="20" /></button>
            <button class="icon-button reset" on:click={() => count = 0} aria-label="Reset" title="Reset count"><img class="icon" src={icons + "rotate-ccw.svg"} alt="" width="18" height="18" /></button>
            <button class="icon-button primary" on:click={() => count++} aria-label="Increase count" title="Increase count"><img class="icon" src={icons + "plus.svg"} alt="" width="20" height="20" /></button>
          </div>
          </div>
        </section>
        <section class="experiment server" aria-labelledby="server-title">
          <div class="experiment-heading"><p class="panel-index"><img class="icon" src={icons + "terminal.svg"} alt="" width="18" height="18" />02 / SERVER</p><h3 id="server-title">Say hello.</h3></div>
          <div class="server-body">
          <div class="terminal" role="status"><span class="prompt">$ hello("niral")</span><p>{reply || "Awaiting your first request."}</p></div>
          <button class="server-button" on:click={ping} disabled={pending}>{pending ? "Calling…" : "Call server"}<img class="icon" src={icons + "arrow-up-right.svg"} alt="" width="18" height="18" /></button>
          </div>
        </section>
        <section class="experiment list" aria-labelledby="list-title">
          <div class="experiment-heading"><p class="panel-index"><img class="icon" src={icons + "list-todo.svg"} alt="" width="18" height="18" />03 / COLLECTIONS</p><h3 id="list-title">What's next?</h3></div>
          <div class="list-body">
          <form on:submit={(event) => { event.preventDefault(); add() }}>
            <label class="sr-only" for="new-item">New item</label>
            <input id="new-item" bind:value={draft} placeholder="Add something to build…" />
            <button class="icon-button primary" aria-label="Add item" title="Add item" disabled={!draft.trim()}><img class="icon" src={icons + "plus.svg"} alt="" width="20" height="20" /></button>
          </form>
          <ul>{#for item of items key item.id}<li><span class="item-dot"></span>{item.text}</li>{/for}</ul>
          </div>
        </section>
      </div>
    </section>
  </main>
</div>

<style>
  :global(body) { margin: 0; background: #171719; color: #fafaf8; }
  .shell { --accent: #f2b544; --line: #48484c; display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100svh; font-family: "Avenir Next", "Trebuchet MS", sans-serif; line-height: 1.6; letter-spacing: 0; }
  .shell * { box-sizing: border-box; }
  a { color: inherit; text-decoration: none; }
  a:hover { color: var(--accent); }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 5px; }
  .project { background: #101012; color: #fafaf8; border-right: 1px solid var(--line); padding: 36px 28px 24px; display: flex; flex-direction: column; }
  .brand { position: relative; display: inline-flex; align-self: flex-start; } .brand img { object-fit: contain; filter: brightness(0) invert(1); }
  .brand::after { content: ""; position: absolute; inset: 0; background: var(--accent); mask: url("/niral-logo.svg") center / contain no-repeat; clip-path: inset(0 65% 0 0); pointer-events: none; }
  .icon { display: block; flex-shrink: 0; object-fit: contain; filter: invert(78%) sepia(80%) saturate(450%) hue-rotate(342deg); }
  main { min-width: 0; padding: 0 48px 40px; background-image: radial-gradient(#39393c 0.6px, transparent 0.6px); background-size: 20px 20px; }
  .topbar { min-height: 92px; display: flex; justify-content: space-between; align-items: center; gap: 20px; border-bottom: 1px solid var(--line); font-size: 14px; }
  .environment, .eyebrow, .panel-index, dt, .section-heading > span { font: 12px/1.6 "SFMono-Regular", Consolas, monospace; }
  .environment, .eyebrow { display: flex; align-items: center; gap: 8px; }
  .welcome { padding: 52px 0 32px; }
  .eyebrow { margin: 0 0 12px; font-size: 11px; }
  .status-dot { width: 6px; height: 6px; flex-shrink: 0; background: var(--accent); border-radius: 50%; }
  h1 { font-size: 40px; font-weight: 500; line-height: 1.15; margin: 0 0 36px; }
  .build-info { margin: 0; }
  .build-info > div + div { margin-top: 22px; } dt { margin-bottom: 4px; } dd { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
  code { font: 13px/1.6 "SFMono-Regular", Consolas, monospace; }
  .playground { max-width: 960px; margin: 0 auto; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 32px 0 24px; }
  .section-heading > span { color: var(--accent); }
  h2 { font-size: 26px; font-weight: 500; margin: 0; }
  .demo { background: #171719; }
  .experiment { display: grid; grid-template-columns: minmax(140px, .65fr) minmax(0, 1fr); gap: 28px; padding: 28px 0; min-width: 0; border-top: 1px solid var(--line); }
  .experiment-heading { padding-top: 4px; }
  .panel-index { display: flex; align-items: center; gap: 10px; color: var(--accent); margin: 0 0 12px; } h3 { margin: 0; font-size: 20px; font-weight: 500; }
  .counter-body { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; min-height: 92px; }
  .count { display: block; font: 48px/1.5 "SFMono-Regular", Consolas, monospace; width: 100px; height: 72px; overflow: auto; }
  .counter-controls { display: flex; align-items: center; gap: 12px; }
  button { border: 1px solid var(--line); background: #242427; color: #fafaf8; border-radius: 4px; cursor: pointer; font: inherit; min-height: 44px; padding: 8px 16px; }
  button:hover:not(:disabled) { border-color: var(--accent); background: #313134; } button:disabled { cursor: not-allowed; background: #313134; border-color: #626267; }
  .icon-button { display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; flex-shrink: 0; }
  .primary { background: var(--accent); border-color: var(--accent); color: #171719; } .primary:hover:not(:disabled) { background: #ffca65; }
  .primary .icon { filter: none; } .primary:disabled .icon { filter: invert(1); }
  .reset { background: transparent; }
  .terminal { background: #101012; border: 1px solid var(--line); color: #fafaf8; border-radius: 4px; font: 13px/1.7 "SFMono-Regular", Consolas, monospace; min-height: 120px; padding: 20px; overflow-wrap: anywhere; }
  .prompt { color: var(--accent); } .terminal p { margin: 12px 0 0; }
  .server-button { display: flex; gap: 24px; justify-content: space-between; align-items: center; font-size: 14px; margin-top: 12px; }
  form { display: flex; gap: 8px; margin: 0 0 14px; }
  input { width: 100%; min-width: 0; border: 1px solid #626267; border-radius: 4px; background: #101012; color: #fafaf8; padding: 10px 12px; font: inherit; font-size: 13px; }
  input::placeholder { color: #b5b5bc; }
  ul { list-style: none; padding: 0; margin: 0; } li { display: flex; align-items: baseline; gap: 10px; padding: 10px 0; font-size: 13px; overflow-wrap: anywhere; }
  li + li { border-top: 1px solid var(--line); } .item-dot { width: 5px; height: 5px; background: var(--accent); flex-shrink: 0; border-radius: 50%; }
  .resources { border-top: 1px solid var(--line); padding: 14px 0 32px; }
  .resources a { display: flex; align-items: center; gap: 12px; font-size: 14px; padding: 10px 0; } .resources .link-arrow { margin-left: auto; }
  footer { margin-top: auto; font-size: 12px; } footer a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (min-width: 1400px) { main { padding-left: 72px; padding-right: 72px; } }
  @media (max-width: 1100px) { main { padding: 0 28px 32px; } .experiment { grid-template-columns: 1fr; gap: 20px; } .counter-body { justify-content: flex-start; gap: 32px; } }
  @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .project { padding: 24px; } .brand img { width: 96px; height: 30px; } .welcome { padding: 24px 0 20px; } h1 { font-size: 32px; margin-bottom: 24px; } .build-info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .build-info > div + div { margin-top: 0; } .build-info > div:last-child { display: none; } .resources { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 12px 0 0; } .resources a { padding: 4px 0; gap: 8px; font-size: 13px; } footer { display: none; } main { padding: 0 24px 24px; } .topbar { min-height: 64px; font-size: 13px; } .environment { font-size: 11px; } .section-heading { padding: 24px 0 20px; } h2 { font-size: 24px; } .experiment { padding: 24px 0; } }
  @media (prefers-reduced-motion: no-preference) { .playground { animation: arrive 300ms ease-out both; } @keyframes arrive { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } } }
</style>
`;

const ABOUT = `<script mode="static"></script>

<head>
  <title>The static page | Niral</title>
</head>

<main>
  <a class="brand" href="/" aria-label="Niral home"><img src="/niral-logo.svg" alt="Niral" width="112" height="36" /></a>
  <p class="eyebrow">NIRAL / STATIC</p>
  <h1>Just the essentials<span>.</span></h1>
  <p class="lead">Zero JavaScript. Pure HTML.</p>
  <dl><div><dt>Route</dt><dd>/about</dd></div><div><dt>Rendering</dt><dd>Static</dd></div><div><dt>Client JavaScript</dt><dd>0 bytes</dd></div></dl>
  <a class="back" href="/">← Back to your app</a>
</main>

<style>
  :global(body) { margin: 0; background: #171719; color: #fafaf8; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 24px; font-family: "Avenir Next", "Trebuchet MS", sans-serif; line-height: 1.6; letter-spacing: 0; }
  .brand { display: inline-flex; margin-bottom: 72px; } img { object-fit: contain; }
  .eyebrow { font: 12px/1.6 "SFMono-Regular", Consolas, monospace; color: #f2b544; margin: 0 0 24px; }
  h1 { font-size: 64px; line-height: 1.1; font-weight: 500; margin: 0 0 24px; } h1 span { color: #f2b544; }
  .lead { font-size: 21px; margin: 0 0 40px; }
  dl { margin: 0 0 40px; } dl > div { display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid #48484c; padding: 18px 0; } dd { margin: 0; }
  a { color: #f2b544; text-decoration: none; } .back { display: inline-block; padding: 12px 0; border-bottom: 1px solid #f2b544; }
  a:focus-visible { outline: 2px solid #f2b544; outline-offset: 5px; }
  @media (max-width: 600px) { main { padding: 32px 20px; } .brand { margin-bottom: 48px; } h1 { font-size: 44px; } }
</style>
`;

const GITIGNORE = `dist/
data/
.niral/
node_modules/
# secrets NEVER enter git — the server's env is managed on the server
.env
*.env
app.env
`;

const README = (name) => `# ${name}

Built with [niral](https://github.com/Zyora-Dev/niral) — zero dependencies.
Docs: https://niral.site

\`\`\`sh
niral dev        # develop — HMR, error overlays, http://localhost:5199
niral check      # real TypeScript checking (after: niral add typescript)
niral build      # content-hashed release with atomic activation
niral start      # production server for dist/current
niral export     # static site (when no server features are used)
\`\`\`

Add capabilities as you need them:

\`\`\`sh
niral add auth        # passkeys + passwords + 2FA + guarded routes
niral add tailwind    # standalone Tailwind (no npm)
niral add chat        # streaming AI chat (set NIRAL_AI_URL)
niral add sqlite      # a database-backed route
\`\`\`
`;

const SAMPLE_TEST = `// niral test — ambient helpers, no imports, no packages
test("home renders and the server answers", async () => {
  const app = await startApp()
  const html = await (await fetch(app.url + "/")).text()
  ok(html.includes("It works."), "page rendered")
})
`;

// Recommends the Niral VS Code extension — VS Code prompts to install it on open,
// giving .niral syntax highlighting + the language server (diagnostics, completions).
const VSCODE_EXTENSIONS = `{
  "recommendations": ["zyoralabs.niral-vscode"]
}
`;

// App-level guide so AI agents (Copilot, Claude, …) understand this is a Niral app.
const APP_AGENTS = `# AGENTS.md — this is a Niral app

Built with **Niral** (https://niral.site) — a zero-dependency, compiler-first
full-stack framework (Node ≥ 22). Guidance for AI agents editing this project.

## Rules
- **\`<server>\` blocks run only on the server** and never ship to the browser — put
  secrets, DB access and business logic there.
- **Client code cannot read \`process.env\`** (it's a compile error). Env is server-only.
- **\`data/\` is private** — SQLite / jobs / sessions live there, never served or shipped.
- Zero runtime dependencies — use Node built-ins; don't \`npm install\` app deps.

## \`.niral\` components (one file: \`<server>\`, \`<script>\`, \`<style>\`, markup)
- Reactivity runes: \`$state\`, \`$props\`, \`$derived\` (fine-grained, no virtual DOM).
- Control flow: \`{#if}\` / \`{:else}\`, \`{#for x of list key x.id}\`. Events \`on:click\`,
  binding \`bind:value\`, transitions \`transition:fade\`.
- \`<script mode="static">\` = a zero-JS SSR page.

## \`<server>\` block
- \`export async function load({ params, locals }) {}\` — SSR data for the page.
- Any other exported function is a typed RPC — the client calls it by name.
- Ambients (no import): \`session\` (.get/.set), \`user()\`, \`publish(channel, data)\`
  (client subscribes with \`live(channel, cb)\`), \`enqueue(name, data, opts)\`,
  \`sql.query(text, params)\` (Postgres when \`NIRAL_DATABASE_URL\` is set — ALWAYS pass
  values as \`$1, $2\` params, never string-concatenate), \`ai.*\`, \`mail(...)\`.
- Form actions: \`<form method="post" action="?/save">\` → server \`save(fields)\` (works without JS).

## Routing — files in \`routes/\`
- \`index.niral\` → \`/\`, \`post/[slug].niral\` → dynamic (\`params.slug\`), \`_layout.niral\`
  wraps pages (render children with \`<slot/>\`), \`_404.niral\` / \`_error.niral\` for errors.

## Verify with the CLI (the source of truth — don't guess)
\`niral dev\` · \`niral check\` (runs the real TypeScript compiler) · \`niral build\` · \`niral test\`.
Add features: \`niral add auth|tailwind|sqlite|chat\`.
`;

export function createApp({ name, dir, template = "minimal" }) {
  const root = resolve(dir ?? name);
  const appName = !name || name === "." ? basename(root) : name;
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${root} exists and is not empty — pick a new directory`);
  }
  if (!TEMPLATE_NAMES.includes(template)) {
    throw new Error(`unknown template "${template}" — available: ${TEMPLATE_NAMES.join(", ")}`);
  }
  mkdirSync(root, { recursive: true });

  // every project gets these
  writeFileSync(join(root, ".gitignore"), GITIGNORE);
  writeFileSync(join(root, "README.md"), README(appName));
  writeFileSync(join(root, "AGENTS.md"), APP_AGENTS);
  mkdirSync(join(root, ".vscode"), { recursive: true });
  writeFileSync(join(root, ".vscode", "extensions.json"), VSCODE_EXTENSIONS);

  if (template === "minimal") {
    mkdirSync(join(root, "routes"), { recursive: true });
    mkdirSync(join(root, "tests"), { recursive: true });
    copyFileSync(new URL("../assets/niral-logo.svg", import.meta.url), join(root, "niral-logo.svg"));
    writeFileSync(join(root, "routes", "index.niral"), INDEX);
    writeFileSync(join(root, "routes", "about.niral"), ABOUT);
    writeFileSync(join(root, "tests", "app.test.js"), SAMPLE_TEST);
    console.log(`niral · created ${appName}/`);
    console.log(`\n  cd ${appName}`);
    console.log("  niral dev\n");
    console.log("routes/index.niral has SSR + state + a keyed list + a server RPC — start there. `niral test` runs tests/.");
    return root;
  }

  // a named starter template
  const tpl = TEMPLATES[template];
  for (const [rel, content] of Object.entries(tpl.files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  console.log(`niral · created ${appName}/ (${template} template)`);
  console.log(`\n  cd ${appName}`);
  console.log("  niral dev\n");
  console.log(tpl.hint + " `niral test` runs tests/.");
  return root;
}
