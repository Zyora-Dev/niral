/**
 * Niral server — RAG store (zero-dep).
 *
 * Retrieval-augmented generation on the stack we already own: chunks live in
 * data/rag.db (node:sqlite — survives deploys like jobs.db), embeddings come
 * from the ambient `ai.embed()` (any OpenAI-compatible endpoint), retrieval
 * is exact cosine similarity — right answer for the corpus sizes a project
 * database holds.
 *
 * Ambient in every <server> block:
 *   await rag.ingest(text, { source: "handbook.md" })   // chunk + embed + store
 *   const hits = await rag.search(query, { k: 5 })       // [{content, source, score}]
 *   await rag.remove("handbook.md")                      // drop a source
 *   rag.stats()                                          // { chunks, sources }
 */

import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ai } from "./ai.js";

const CHUNK_SIZE = 1200; // chars — paragraph-boundary chunks

let db = null;
let dbFile = null;

function dbPath() {
  // data/ lives at the PROJECT root (set by dev+prod servers) — never cwd-relative
  const root = globalThis.__niralProjectRoot;
  const url = root ? new URL("data/rag.db", root) : new URL(`file://${process.cwd()}/data/rag.db`);
  return fileURLToPath(url);
}

function getDb() {
  const file = dbPath();
  if (db && dbFile === file) return db;
  const { DatabaseSync } = require_sqlite();
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  dbFile = file;
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rag_source ON rag_chunks(source);
  `);
  return db;
}

function require_sqlite() {
  // node:sqlite — stdlib (experimental flag-free since Node 22.5)
  // eslint-disable-next-line no-undef
  return process.getBuiltinModule("node:sqlite");
}

/** Paragraph-boundary chunking — greedy fill up to CHUNK_SIZE. */
export function chunkText(text, size = CHUNK_SIZE) {
  const paras = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > size) {
      if (cur) chunks.push(cur), (cur = "");
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

async function ingest(text, { source = "" } = {}) {
  const chunks = chunkText(text);
  if (!chunks.length) return { chunks: 0, source };
  const vectors = await ai.embed(chunks);
  const d = getDb();
  const ins = d.prepare("INSERT INTO rag_chunks (source, content, embedding) VALUES (?, ?, ?)");
  for (let i = 0; i < chunks.length; i++) ins.run(source, chunks[i], JSON.stringify(vectors[i]));
  return { chunks: chunks.length, source };
}

async function search(query, { k = 5, source = null } = {}) {
  const [qv] = await ai.embed(query);
  const d = getDb();
  const rows = source
    ? d.prepare("SELECT source, content, embedding FROM rag_chunks WHERE source = ?").all(source)
    : d.prepare("SELECT source, content, embedding FROM rag_chunks").all();
  return rows
    .map((r) => ({ source: r.source, content: r.content, score: cosine(qv, JSON.parse(r.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function remove(source) {
  const d = getDb();
  d.prepare("DELETE FROM rag_chunks WHERE source = ?").run(source);
}

function stats() {
  const d = getDb();
  const chunks = d.prepare("SELECT COUNT(*) AS n FROM rag_chunks").get().n;
  const sources = d.prepare("SELECT COUNT(DISTINCT source) AS n FROM rag_chunks").get().n;
  return { chunks, sources };
}

export const rag = { ingest, search, remove, stats };
