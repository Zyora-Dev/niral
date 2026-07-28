/**
 * niral create <name> — a new project, zero to running in one command.
 *
 * Scaffolds the smallest REAL app that shows the model: a hydrated page with
 * state + a keyed list, a zero-JS static page, and a <server> block with
 * load() + an RPC function. No dependencies to install — `niral dev` runs it.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

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
  let { started } = $props
  let count = $state(0)
  let items = $state([{ id: 1, text: "read the code in routes/index.niral" }, { id: 2, text: "edit me — HMR keeps state" }])
  let draft = $state("")
  let reply = $state("")

  function add() {
    if (!draft.trim()) return
    items = [...items, { id: Date.now(), text: draft.trim() }]
    draft = ""
  }
  async function ping() {
    reply = await hello("niral")   // compile-time RPC stub — a POST under the hood
  }
</script>

<head>
  <title>நிரல் · new app</title>
</head>

<main>
  <div class="glow"></div>

  <header>
    <span class="mark">நி</span>
    <span class="badge">SSR'd on the server, hydrated in your browser</span>
  </header>

  <h1>It works.</h1>
  <p class="lead">Your நிரல் app is running — zero dependencies, nothing installed.<br />
  <span class="dim">server said hi at {started}</span></p>

  <section class="demo">
    <div class="panel">
      <p class="panel-title">Fine-grained reactivity</p>
      <button class="primary" on:click={() => count++}>count is {count}</button>
      <p class="hint">only this text updates — no virtual DOM, no re-render</p>
    </div>

    <div class="panel">
      <p class="panel-title">Talk to the server</p>
      <button on:click={ping}>call hello()</button>
      {#if reply}<p class="reply">{reply}</p>{/if}
      <p class="hint">a typed RPC — the function body never ships to the browser</p>
    </div>

    <div class="panel wide">
      <p class="panel-title">Keyed lists + two-way binding</p>
      <form on:submit={(e) => { e.preventDefault(); add() }}>
        <input bind:value={draft} placeholder="add an item…" />
        <button>add</button>
      </form>
      <ul>
        {#for it of items key it.id}
          <li>{it.text}</li>
        {/for}
      </ul>
    </div>
  </section>

  <nav class="links">
    <a class="link" href="https://niral.zyora.club/docs/getting-started"><b>Docs →</b><span>components, server functions, auth, realtime, deploys</span></a>
    <a class="link" href="https://github.com/Zyora-Dev/niral"><b>GitHub →</b><span>every line readable — the framework is the repo</span></a>
    <a class="link" href="/about"><b>Zero-JS page →</b><span>/about ships pure HTML — nothing hydrates</span></a>
  </nav>

  <footer>
    <span>நிரல் · start in <code>routes/index.niral</code> · powered by <a href="https://zyoralabs.com">ZyoraLabs</a></span>
  </footer>
</main>

<style>
  :global(body) { margin: 0; background: #0b0d10; color: #e8eaed; }
  main { max-width: 720px; margin: 0 auto; padding: 4.5rem 1.4rem 3rem; font-family: "Inter", ui-sans-serif, system-ui, sans-serif; line-height: 1.6; position: relative; }
  .glow { position: absolute; inset: -6rem 0 auto; height: 20rem; background: radial-gradient(ellipse 65% 60% at 50% 15%, rgba(52, 211, 153, .12), transparent 70%); pointer-events: none; }
  header { display: flex; align-items: center; gap: .8rem; margin-bottom: 1.6rem; }
  .mark { display: inline-grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: 11px; background: linear-gradient(135deg, #34d399, #0ea5e9); color: #04120b; font-weight: 700; }
  .badge { background: #11151a; border: 1px solid #232930; border-radius: 999px; padding: .28rem .9rem; font-size: .78rem; color: #9aa3ad; }
  h1 { font-size: 2.6rem; margin: 0 0 .4rem; letter-spacing: -.02em; }
  .lead { color: #cdd3da; margin: 0 0 2rem; }
  .dim { color: #5f6b76; font-size: .88rem; }
  .demo { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .panel { background: #11151a; border: 1px solid #232930; border-radius: 14px; padding: 1.15rem 1.2rem; }
  .panel.wide { grid-column: 1 / -1; }
  .panel-title { margin: 0 0 .7rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .07em; color: #5f6b76; }
  .hint { color: #5f6b76; font-size: .8rem; margin: .7rem 0 0; }
  .reply { color: #7ee2b8; font-size: .88rem; margin: .7rem 0 0; }
  button { padding: .52rem 1.05rem; border: 1px solid #262c33; border-radius: 9px; background: #14181d; color: #e8eaed; cursor: pointer; font-size: .9rem; transition: border-color .15s; }
  button:hover { border-color: #34d399; }
  button.primary { background: #34d399; border-color: #34d399; color: #04120b; font-weight: 600; }
  input { padding: .52rem .8rem; border: 1px solid #262c33; border-radius: 9px; background: #0e1115; color: #e8eaed; margin-right: .5rem; font-size: .9rem; }
  input::placeholder { color: #5f6b76; }
  input:focus { outline: none; border-color: #34d399; }
  ul { margin: .8rem 0 0; padding-left: 1.2rem; }
  li { margin: .25rem 0; color: #cdd3da; }
  .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
  .link { background: #11151a; border: 1px solid #232930; border-radius: 14px; padding: 1rem 1.15rem; text-decoration: none; color: inherit; transition: border-color .15s, transform .15s; }
  .link:hover { border-color: #34d399; transform: translateY(-2px); }
  .link b { display: block; color: #7ee2b8; margin-bottom: .2rem; font-size: .95rem; }
  .link span { color: #9aa3ad; font-size: .8rem; }
  footer { margin-top: 2.4rem; text-align: center; color: #5f6b76; font-size: .82rem; }
  footer code { color: #7ee2b8; background: #11151a; padding: .1rem .4rem; border-radius: 6px; }
  footer a { color: #34d399; text-decoration: none; }
  @media (max-width: 560px) { .demo { grid-template-columns: 1fr; } h1 { font-size: 2.1rem; } }
</style>
`;

const ABOUT = `<script mode="static"></script>

<head>
  <title>about · zero JavaScript</title>
</head>

<main>
  <span class="mark">நி</span>
  <h1>Zero JavaScript</h1>
  <p>This page has <code>mode="static"</code> — pure HTML, no hydration, nothing shipped.<br />
  View source: there is no script tag. That's the whole trick.</p>
  <p><a href="/">← home</a></p>
</main>

<style>
  :global(body) { margin: 0; background: #0b0d10; color: #e8eaed; }
  main { max-width: 560px; margin: 0 auto; padding: 5rem 1.4rem; font-family: "Inter", ui-sans-serif, system-ui, sans-serif; line-height: 1.7; }
  .mark { display: inline-grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: 11px; background: linear-gradient(135deg, #34d399, #0ea5e9); color: #04120b; font-weight: 700; margin-bottom: 1rem; }
  h1 { letter-spacing: -.02em; margin: 0 0 .6rem; }
  p { color: #9aa3ad; }
  code { color: #7ee2b8; background: #11151a; padding: .1rem .45rem; border-radius: 6px; }
  a { color: #34d399; text-decoration: none; }
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
Docs: https://niral.zyora.club

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

export function createApp({ name, dir }) {
  const root = resolve(dir ?? name);
  const appName = name ?? basename(root);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${root} exists and is not empty — pick a new directory`);
  }
  mkdirSync(join(root, "routes"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "routes", "index.niral"), INDEX);
  writeFileSync(join(root, "routes", "about.niral"), ABOUT);
  writeFileSync(join(root, "tests", "app.test.js"), SAMPLE_TEST);
  writeFileSync(join(root, ".gitignore"), GITIGNORE);
  writeFileSync(join(root, "README.md"), README(appName));
  console.log(`niral · created ${appName}/`);
  console.log(`\n  cd ${appName}`);
  console.log("  niral dev\n");
  console.log("routes/index.niral has SSR + state + a keyed list + a server RPC — start there. `niral test` runs tests/.");
  return root;
}
