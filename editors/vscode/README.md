# Niral for VS Code

Language support for [**Niral**](https://niral.site) — the zero-dependency,
compiler-first full-stack web framework — and for **NiralScript**, its
independent reactive language.

Like the framework it serves, this extension ships **zero dependencies**: a single
file that speaks LSP to `niral lsp` directly.

## Features

### `.niral` single-file components

- **Syntax highlighting** across every block, including embedded highlighting inside
  `<server>` (JavaScript, Python, Ruby, Go), `<script>`, `<style>` and `{ expressions }`.
- **Diagnostics, completions and hover** from the built-in language server — runes
  (`$state`, `$props`, `$derived`), server ambients (`load`, `publish`, `live`,
  `enqueue`, `sql`, `session`, `user`) and routing.
- **Snippets** for component scaffolds, `load` and RPC exports, form actions,
  `{#if}` / `{#for}` / `{#await}`, `<head>`, static and streaming script modes.
- Bracket matching, auto-closing pairs and comment toggling tuned for the format.

### `.nrs` NiralScript files

- Highlighting and compiler diagnostics from the standalone NiralScript compiler.
- **Hover** on declared annotations and signatures.
- **Go to Definition** for local and imported names, classes, members and type
  aliases — including imported generic classes and aliases. Unsaved edits to an
  imported file refresh the diagnostics of files that depend on it.
- Member completions on a receiver, plus keyword and top-level completions.
- Snippets for `state`, `derive`, `input`, functions, classes, interfaces, generic
  type aliases and `contract<Type>(value)`.

### Commands

| Command | What it does |
| --- | --- |
| **Niral: Restart Language Server** | Relaunches `niral lsp`. |
| **Niral: Show Language Server Output** | Opens the **Niral** output channel. |
| **Niral: Open Documentation** | Opens [niral.site](https://niral.site). |

A status bar item shows whether the server is running; click it for the log.

## Requirements

- **Node.js 22+** — Niral is Node standard library, end to end.
- The `niral` CLI, which comes with your project:

```sh
npx create-niral my-app
cd my-app
niral dev
```

Open any `.niral` file and IntelliSense works immediately. The extension finds the
CLI in `node_modules`, in a sibling checkout, or at the project root. If yours lives
somewhere else, point **`niral.serverPath`** at its `bin/niral.js`.

Highlighting and snippets never depend on the CLI — only diagnostics, completions,
hover and Go to Definition do.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `niral.serverPath` | `""` | Path to `bin/niral.js`. Empty means auto-detect. |
| `niral.niralscriptStrictTypes` | `false` | Require narrowing `unknown` and nullable values in standalone `.nrs` checking, matching `nrs check --strict`. |
| `niral.niralscriptGlobals` | `[]` | Explicit host globals for standalone `.nrs` checking — the same contract as `nrs --global`. |
| `niral.showStatusBar` | `true` | Show the status bar item for Niral files. |

Standalone NiralScript has no implicit host globals; add names to
`niral.niralscriptGlobals` only when your host actually supplies them.

## Notes and limits

- Hover reports declared annotations and signatures, not general inferred types.
- Symbol navigation needs a parseable program. An unfinished receiver such as
  `counter.` still recovers member completions; otherwise you get keyword completions.
- Completions cover top-level names rather than every local lexical scope.
- NiralScript imports must be explicit relative `.nrs` paths to existing, non-private
  files inside the project, without symlinks.
- The language server runs your project's own `niral` CLI, so it stays off until the
  workspace is trusted.

## Great with AI agents

Every Niral project scaffolds an `AGENTS.md`, so GitHub Copilot, Claude and Cursor
follow the framework's conventions instead of guessing. New projects recommend this
extension through `.vscode/extensions.json`, and agents can verify their own edits
with `niral check` (the real TypeScript compiler) and `niral test`.

## Links

- **Docs** — https://niral.site
- **GitHub** — https://github.com/Zyora-Dev/niral
- **Issues** — https://github.com/Zyora-Dev/niral/issues
- **Changelog** — [CHANGELOG.md](CHANGELOG.md)

---

Built by ZyoraLabs. The framework is MIT; the NiralScript compiler is Apache-2.0
with a Runtime Library Exception. Zero dependencies, forever.
