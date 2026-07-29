/**
 * niral create --template <name>
 *
 * Small, well-commented STARTER templates that teach the core patterns by
 * example. Not huge apps — just enough to show how a real niral project is
 * shaped. `minimal` is the default (handled in create.js); this file adds the
 * others. Each template is a map of { relativePath: fileContents }.
 *
 * blog       — server load(), dynamic [slug] routes, a tiny data module
 * dashboard  — a _layout with a sidebar, stat cards, a live-refresh RPC
 */

/* ── blog ──────────────────────────────────────────────────────── */

const BLOG_POSTS = `// lib/posts.js — a tiny in-memory "database".
// When you outgrow it, run \`niral add sqlite\` and swap these functions for
// real queries — the routes won't have to change.
const POSTS = [
  {
    slug: "hello-niral",
    title: "Hello, Niral",
    date: "2026-07-29",
    excerpt: "Why this whole blog is just a handful of .niral files.",
    body: "This blog has no database server, no CMS, no build step you wait on. Each post is an object in lib/posts.js, listed by a server load() and shown on a dynamic route. When it grows up, 'niral add sqlite' turns these functions into real queries and nothing else changes.",
  },
  {
    slug: "one-file",
    title: "One file, whole feature",
    date: "2026-07-28",
    excerpt: "Server code, styles and markup live in a single .niral file.",
    body: "Open routes/post/[slug].niral: the <server> block loads the post on the server, the markup renders it, the <style> is scoped to just this page. One file, front to back.",
  },
];

/** List view data — omit the full body. */
export function listPosts() {
  return POSTS.map(({ body, ...rest }) => rest);
}

/** One post by slug, or null. */
export function getPost(slug) {
  return POSTS.find((p) => p.slug === slug) ?? null;
}
`;

const BLOG_INDEX = `<server>
// runs on the server — the posts array never ships to the browser.
// projectImport() loads a project module from inside a <server> block.
export async function load() {
  const { listPosts } = await projectImport("lib/posts.js")
  return { posts: listPosts() }
}
</server>

<script>
  let { posts } = $props
</script>

<head><title>My Blog · built with niral</title></head>

<main>
  <header>
    <span class="mark">நி</span>
    <h1>My Blog</h1>
    <p class="sub">A tiny blog — server-rendered, zero dependencies.</p>
  </header>

  {#for p of posts key p.slug}
    <a class="post" href={"/post/" + p.slug}>
      <p class="date">{p.date}</p>
      <h2>{p.title}</h2>
      <p class="excerpt">{p.excerpt}</p>
    </a>
  {/for}
</main>

<style>
  :global(body) { margin: 0; background: #0b0d10; color: #e8eaed; }
  main { max-width: 680px; margin: 0 auto; padding: 3.5rem 1.4rem; font-family: "Inter", ui-sans-serif, system-ui, sans-serif; }
  header { margin-bottom: 2.5rem; }
  .mark { display: inline-grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: 11px; background: linear-gradient(135deg, #34d399, #0ea5e9); color: #04120b; font-weight: 700; margin-bottom: 1rem; }
  h1 { margin: 0; letter-spacing: -.02em; }
  .sub { color: #9aa3ad; }
  .post { display: block; text-decoration: none; color: inherit; background: #11151a; border: 1px solid #232930; border-radius: 14px; padding: 1.2rem 1.4rem; margin-bottom: 1rem; transition: border-color .15s, transform .15s; }
  .post:hover { border-color: #34d399; transform: translateY(-2px); }
  .date { color: #5f6b76; font-size: .82rem; margin: 0 0 .3rem; }
  .post h2 { margin: 0 0 .4rem; font-size: 1.25rem; }
  .excerpt { color: #9aa3ad; margin: 0; font-size: .95rem; }
</style>
`;

const BLOG_POST = `<server>
// dynamic route: [slug] → params.slug. The post loads on the server per request.
export async function load({ params }) {
  const { getPost } = await projectImport("lib/posts.js")
  return { post: getPost(params.slug) }
}
</server>

<script>
  let { post } = $props
</script>

<head><title>{post ? post.title : "Not found"}</title></head>

<main>
  <a class="back" href="/">← all posts</a>
  {#if post}
    <p class="date">{post.date}</p>
    <h1>{post.title}</h1>
    <p class="body">{post.body}</p>
  {:else}
    <h1>Post not found</h1>
    <p class="body">No post matches that link.</p>
  {/if}
</main>

<style>
  :global(body) { margin: 0; background: #0b0d10; color: #e8eaed; }
  main { max-width: 680px; margin: 0 auto; padding: 3.5rem 1.4rem; font-family: "Inter", ui-sans-serif, system-ui, sans-serif; line-height: 1.7; }
  .back { color: #34d399; text-decoration: none; font-size: .9rem; }
  .date { color: #5f6b76; font-size: .85rem; margin: 1.5rem 0 .2rem; }
  h1 { margin: 0 0 1rem; letter-spacing: -.02em; }
  .body { color: #cdd3da; }
</style>
`;

/* ── dashboard ─────────────────────────────────────────────────── */

const DASH_LAYOUT = `<script>
  // A layout wraps every page under this folder. <slot/> is where the page goes.
</script>

<div class="shell">
  <aside>
    <span class="mark">நி</span>
    <nav>
      <a href="/">Overview</a>
      <a href="/reports">Reports</a>
      <a href="/settings">Settings</a>
    </nav>
    <p class="foot">built with niral</p>
  </aside>
  <main><slot /></main>
</div>

<style>
  :global(body) { margin: 0; background: #0b0d10; color: #e8eaed; font-family: "Inter", ui-sans-serif, system-ui, sans-serif; }
  .shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
  aside { border-right: 1px solid #1b2027; padding: 1.4rem 1.1rem; display: flex; flex-direction: column; }
  .mark { display: inline-grid; place-items: center; width: 2.2rem; height: 2.2rem; border-radius: 10px; background: linear-gradient(135deg, #34d399, #0ea5e9); color: #04120b; font-weight: 700; margin-bottom: 1.6rem; }
  nav { display: flex; flex-direction: column; gap: .3rem; }
  nav a { color: #9aa3ad; text-decoration: none; padding: .5rem .7rem; border-radius: 8px; font-size: .92rem; }
  nav a:hover { background: #11151a; color: #e8eaed; }
  .foot { margin-top: auto; color: #5f6b76; font-size: .78rem; }
  main { padding: 2.2rem 2rem; }
  @media (max-width: 640px) { .shell { grid-template-columns: 1fr; } aside { flex-direction: row; align-items: center; gap: 1rem; } .foot { display: none; } }
</style>
`;

const DASH_INDEX = `<server>
// load() runs on the server; refresh() is a type-safe RPC the button calls.
export async function load() {
  return { stats: sample() }
}
export async function refresh() {
  return sample()
}
function sample() {
  const jitter = (n) => n + Math.floor(Math.random() * n * 0.08)
  return { users: jitter(1280), revenue: jitter(8420), active: jitter(342) }
}
</server>

<script>
  let { stats } = $props
  let live = $state(stats)
  let loading = $state(false)
  async function reload() {
    loading = true
    live = await refresh()   // a POST under the hood — compiled for you
    loading = false
  }
</script>

<head><title>Dashboard · niral</title></head>

<header>
  <div>
    <h1>Overview</h1>
    <p class="sub">Server-loaded on first paint, refreshed by an RPC.</p>
  </div>
  <button on:click={reload} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
</header>

<section class="cards">
  <div class="card"><p class="label">Users</p><b>{live.users}</b></div>
  <div class="card"><p class="label">Revenue</p><b>\${live.revenue}</b></div>
  <div class="card"><p class="label">Active now</p><b>{live.active}</b></div>
</section>

<style>
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.8rem; }
  h1 { margin: 0; letter-spacing: -.02em; }
  .sub { color: #9aa3ad; margin: .2rem 0 0; font-size: .92rem; }
  button { background: #34d399; color: #04120b; border: 0; padding: .55rem 1.1rem; border-radius: 9px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
  .card { background: #11151a; border: 1px solid #232930; border-radius: 14px; padding: 1.3rem 1.4rem; }
  .label { color: #9aa3ad; font-size: .82rem; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 .5rem; }
  .card b { font-size: 2rem; color: #34d399; }
</style>
`;

const BLOG_TEST = `test("blog lists posts and a post page renders", async () => {
  const app = await startApp()
  const home = await (await fetch(app.url + "/")).text()
  ok(home.includes("My Blog"), "home renders")
  ok(home.includes("Hello, Niral"), "a post is listed")
  const post = await (await fetch(app.url + "/post/hello-niral")).text()
  ok(post.includes("Hello, Niral"), "post page renders by slug")
})
`;

const DASH_TEST = `test("dashboard renders stats through the layout", async () => {
  const app = await startApp()
  const html = await (await fetch(app.url + "/")).text()
  ok(html.includes("Overview"), "page renders")
  ok(html.includes("Users"), "a stat card renders")
  ok(html.includes("Refresh"), "the RPC button is there")
})
`;

export const TEMPLATES = {
  blog: {
    hint: "routes/index.niral lists posts, routes/post/[slug].niral shows one — data in lib/posts.js.",
    files: {
      "lib/posts.js": BLOG_POSTS,
      "routes/index.niral": BLOG_INDEX,
      "routes/post/[slug].niral": BLOG_POST,
      "tests/app.test.js": BLOG_TEST,
    },
  },
  dashboard: {
    hint: "routes/_layout.niral is the sidebar shell; routes/index.niral loads stats + refreshes via an RPC.",
    files: {
      "routes/_layout.niral": DASH_LAYOUT,
      "routes/index.niral": DASH_INDEX,
      "tests/app.test.js": DASH_TEST,
    },
  },
};

export const TEMPLATE_NAMES = ["minimal", ...Object.keys(TEMPLATES)];
