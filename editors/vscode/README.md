# Niral for VS Code

Language support for [**Niral**](https://niral.zyora.club) — the zero-dependency,
compiler-first full-stack web framework. Rich editing for `.niral` single-file
components.

## Features

- **Syntax highlighting** for `.niral` files — including embedded highlighting inside
  `<server>` blocks (JavaScript, **Python**, **Ruby**, **Go**), `<script>`, `<style>` (CSS)
  and `{ expressions }`.
- **Completions, diagnostics and hover docs** via the built-in Niral language server
  (`niral lsp`) — runes (`$state`, `$props`, `$derived`), server ambients
  (`load`, `publish`, `live`, `enqueue`, `sql`, `session`, `user`) and routing.
- **Bracket matching, auto-closing pairs and comment toggling** tuned for `.niral`.

## Getting started

```sh
npx create-niral my-app
cd my-app
niral dev
```

Open any `.niral` file — highlighting and IntelliSense work immediately.

## Great with AI agents

Every Niral project scaffolds an `AGENTS.md`, so GitHub Copilot, Claude and Cursor
understand the framework's conventions natively instead of guessing. New projects
also recommend this extension automatically via `.vscode/extensions.json`, and agents
can verify their own edits with `niral check` (the real TypeScript compiler) and `niral test`.

## Requirements

- **Node.js 22+** — Niral is Node standard library, end to end.
- The `niral` CLI — installed with your project (`npx create-niral`) or globally.
  If the extension can't find it, set **`niral.serverPath`** to `bin/niral.js`.

## Links

- **Docs** — https://niral.zyora.club
- **GitHub** — https://github.com/Zyora-Dev/niral
- **Issues** — https://github.com/Zyora-Dev/niral/issues

---

Built by [ZyoraLabs](https://zyoralabs.com). Zero dependencies, forever.
