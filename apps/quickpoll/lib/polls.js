/**
 * QuickPoll — poll store (node:sqlite, data/polls.db).
 * Loaded from <server> blocks via projectImport("lib/polls.js").
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const file = fileURLToPath(new URL("../data/polls.db", import.meta.url));
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    options TEXT NOT NULL,          -- JSON array of strings
    created_by TEXT NOT NULL,
    is_open INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL,
    voter TEXT NOT NULL,            -- anonymous session id
    option_idx INTEGER NOT NULL,
    voted_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (poll_id, voter)
  );
`);

export function createPoll({ question, options, createdBy }) {
  const id = randomBytes(4).toString("hex");
  db.prepare("INSERT INTO polls (id, question, options, created_by) VALUES (?, ?, ?, ?)")
    .run(id, question, JSON.stringify(options), createdBy);
  return id;
}

export function getPoll(id) {
  const row = db.prepare("SELECT * FROM polls WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, options: JSON.parse(row.options), is_open: !!row.is_open };
}

export function listPollsBy(user) {
  return db
    .prepare("SELECT id, question, options, is_open, created_at FROM polls WHERE created_by = ? ORDER BY created_at DESC")
    .all(user)
    .map((p) => ({ ...p, options: JSON.parse(p.options), is_open: !!p.is_open, total: countVotes(p.id) }));
}

export function results(pollId) {
  const poll = getPoll(pollId);
  if (!poll) return null;
  const counts = poll.options.map(() => 0);
  for (const r of db.prepare("SELECT option_idx, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY option_idx").all(pollId)) {
    if (r.option_idx >= 0 && r.option_idx < counts.length) counts[r.option_idx] = r.n;
  }
  return { counts, total: counts.reduce((a, b) => a + b, 0) };
}

export function countVotes(pollId) {
  return db.prepare("SELECT COUNT(*) AS n FROM votes WHERE poll_id = ?").get(pollId).n;
}

/** One vote per voter per poll — REVOTING moves the vote. Returns the fresh results. */
export function vote(pollId, voter, optionIdx) {
  const poll = getPoll(pollId);
  if (!poll) throw new Error("poll not found");
  if (!poll.is_open) throw new Error("this poll is closed");
  if (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx >= poll.options.length) throw new Error("bad option");
  db.prepare(
    "INSERT INTO votes (poll_id, voter, option_idx) VALUES (?, ?, ?) ON CONFLICT(poll_id, voter) DO UPDATE SET option_idx = excluded.option_idx, voted_at = datetime('now')"
  ).run(pollId, voter, optionIdx);
  return results(pollId);
}

export function myVote(pollId, voter) {
  const r = db.prepare("SELECT option_idx FROM votes WHERE poll_id = ? AND voter = ?").get(pollId, voter);
  return r ? r.option_idx : null;
}

export function setOpen(pollId, user, open) {
  const r = db.prepare("UPDATE polls SET is_open = ? WHERE id = ? AND created_by = ?").run(open ? 1 : 0, pollId, user);
  if (!r.changes) throw new Error("not your poll");
}
