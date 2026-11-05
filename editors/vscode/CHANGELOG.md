# Changelog

## 0.2.0

- Snippets for `.niral` and `.nrs` — component scaffolds, `load`, RPCs, runes,
  `{#if}` / `{#for}` / `{#await}`, `state` / `derive` / `input`, classes and contracts.
- Status bar item reporting language server state, with a **Niral** output channel
  carrying the server log. Replaces the warning popup that fired when the CLI
  was missing.
- Commands: **Niral: Restart Language Server**, **Niral: Show Language Server Output**
  and **Niral: Open Documentation**.
- Highlighting, snippets and language configuration now work even when the `niral`
  CLI can't be found; only diagnostics, completions, hover and Go to Definition
  need it.
- Changing any `niral.*` setting restarts the server instead of requiring a window
  reload.
- Declared workspace trust and virtual workspace support, so the server no longer
  spawns in an untrusted workspace.
- The extension activates on `.niral` / `.nrs` files rather than at startup.
- File icons for both languages, and a refreshed marketplace icon.

## 0.1.1

- NiralScript (`.nrs`) highlighting, compiler diagnostics, declared-signature hover,
  keyword and top-level completions, and Go to Definition for local and imported
  names, classes, members and type aliases.
- `niral.niralscriptGlobals` and `niral.niralscriptStrictTypes` settings.

## 0.1.0

- Initial release: `.niral` syntax highlighting with embedded JavaScript, Python,
  Ruby, Go and CSS, plus diagnostics, completions and hover from `niral lsp`.
