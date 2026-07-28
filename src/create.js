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
  let items = $state([{ id: 1, text: "read the code in routes/" }, { id: 2, text: "edit me — HMR keeps state" }])
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
  <h1>It works.</h1>
  <p class="dim">server said hi at {started} · this page is SSR'd, then hydrated</p>

  <section>
    <button on:click={() => count++}>count is {count}</button>
    <button on:click={ping}>call the server</button>
    {#if reply}<p class="dim">{reply}</p>{/if}
  </section>

  <section>
    <form on:submit={(e) => { e.preventDefault(); add() }}>
      <input bind:value={draft} placeholder="add an item…" />
      <button>add</button>
    </form>
    <ul>
      {#for it of items key it.id}
        <li>{it.text}</li>
      {/for}
    </ul>
  </section>

  <p class="dim"><a href="/about">about</a> — a zero-JS static page</p>
</main>

<style>
  main { max-width: 560px; margin: 3rem auto; font-family: system-ui, sans-serif; line-height: 1.6; }
  h1 { font-size: 2.2rem; margin-bottom: 0; }
  .dim { color: #777; font-size: .92rem; }
  section { margin: 1.5rem 0; }
  button { padding: .5rem 1rem; margin-right: .5rem; border: 1px solid #ccc; border-radius: 8px; background: #fafafa; cursor: pointer; }
  input { padding: .5rem .75rem; border: 1px solid #ccc; border-radius: 8px; margin-right: .5rem; }
  li { margin: .25rem 0; }
</style>
`;

const ABOUT = `<script mode="static"></script>

<head>
  <title>about</title>
</head>

<main>
  <h1>Zero JavaScript</h1>
  <p>This page has <code>mode="static"</code> — pure HTML, no hydration, nothing shipped.</p>
  <p><a href="/">← home</a></p>
</main>

<style>
  main { max-width: 560px; margin: 3rem auto; font-family: system-ui, sans-serif; }
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

Built with [niral](https://github.com/zyoralabs/niral) — zero dependencies.

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
