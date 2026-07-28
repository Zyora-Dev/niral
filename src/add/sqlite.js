/**
 * niral add sqlite — scaffolds a working database-backed route.
 *
 * Nothing to download: SQLite is in Python's standard library (and Node's,
 * on modern versions). This recipe drops in a complete notes app backed by
 * a real database at data/app.db — the data/ directory is private by
 * convention (never served in dev, never shipped in builds) and lives
 * OUTSIDE releases, so it survives every atomic deploy.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROUTE = `<server lang="python">
import os, sqlite3

os.makedirs("data", exist_ok=True)
db = sqlite3.connect("data/app.db")
db.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP)")
db.commit()

def _all():
    rows = db.execute("SELECT id, text, created FROM notes ORDER BY id DESC LIMIT 100").fetchall()
    return {"notes": [{"id": r[0], "text": r[1], "created": r[2]} for r in rows]}

def load(params):
    return _all()

def add_note(text):
    clean = str(text).strip()[:200]
    if not clean:
        raise ValueError("Write something first")
    db.execute("INSERT INTO notes (text) VALUES (?)", (clean,))
    db.commit()
    return _all()

def delete_note(note_id):
    db.execute("DELETE FROM notes WHERE id = ?", (int(note_id),))
    db.commit()
    return _all()
</server>

<script>
  let { notes } = $props
  let items = $state(notes ?? [])
  let draft = $state("")
  let error = $state("")

  async function add() {
    error = ""
    try {
      const r = await add_note(draft)
      items = r.notes
      draft = ""
    } catch (e) {
      error = e.message
    }
  }

  async function remove(id) {
    const r = await delete_note(id)
    items = r.notes
  }
</script>

<style>
  .note { display: flex; gap: .6rem; align-items: center; padding: .4rem 0; border-bottom: 1px solid #222; }
  .note small { color: #777; margin-left: auto; }
  .err { color: #f87171; }
</style>

<h1>Notes</h1>
<p>Stored in <b>SQLite</b> (data/app.db) by a <b>Python</b> server block — survives restarts and deploys.</p>

<input id="draft" bind:value={draft} placeholder="Write a note…" />
<button id="add" on:click={() => add()}>Save</button>
{#if error !== ""}<p id="err" class="err">{error}</p>{/if}

{#for n of items key n.id}
  <div class="note">
    <button on:click={() => remove(n.id)}>×</button>
    <span>{n.text}</span>
    <small>{n.created}</small>
  </div>
{/for}
`;

export async function addSqlite({ root = "." } = {}) {
  const dir = resolve(root);
  const routeAbs = join(dir, "routes", "notes.niral");
  if (existsSync(routeAbs)) {
    console.log("niral · routes/notes.niral already exists — leaving it untouched");
  } else {
    mkdirSync(dirname(routeAbs), { recursive: true });
    writeFileSync(routeAbs, ROUTE);
  }

  // keep databases out of version control
  const gi = join(dir, ".gitignore");
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!current.includes("data/")) {
    writeFileSync(gi, current + (current.endsWith("\n") || current === "" ? "" : "\n") + "data/\ndist/\n.niral/bin/\n");
  }

  console.log("niral · sqlite notes app ready at /notes (data lives in data/app.db — private, deploy-proof)");
  return { route: "routes/notes.niral", database: "data/app.db" };
}
