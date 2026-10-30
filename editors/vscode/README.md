# Niral for VS Code

Language support for [**Niral**](https://niral.site) — the zero-dependency,
compiler-first full-stack web framework. Rich editing for `.niral` single-file
components and dedicated `.nrs` NiralScript files.

## Features

- **Syntax highlighting** for `.niral` files — including embedded highlighting inside
  `<server>` blocks (JavaScript, **Python**, **Ruby**, **Go**), `<script>`, `<style>` (CSS)
  and `{ expressions }`.
- **Completions, diagnostics and hover docs** via the built-in Niral language server
  (`niral lsp`) — runes (`$state`, `$props`, `$derived`), server ambients
  (`load`, `publish`, `live`, `enqueue`, `sql`, `session`, `user`) and routing.
- **Bracket matching, auto-closing pairs and comment toggling** tuned for `.niral`.
- **NiralScript (`.nrs`)** highlighting, compiler diagnostics, declared-signature
  hover, keyword/top-level completions and Go to Definition for local and imported
  names, classes, members and type aliases, including imported generic classes/aliases.
  Receiver member completions include fields and methods. Open, unsaved changes
  to existing imported files refresh dependent diagnostics.
  `contract<Type>(value)` has highlighting, keyword help/completion and compiler
  diagnostics for unsupported runtime schemas. Type aliases inside contracts use
  the same navigation support as ordinary annotations.

## NiralScript Source Extension

These additions are in the repository source extension; an updated Marketplace
package has not been published. Load `editors/vscode` in an Extension Development
Host and set `niral.serverPath` to this checkout's absolute `bin/niral.js` path.
Use Node.js 22 or newer and open the project folder containing your `.nrs` files.
The existing `.niral` language remains registered independently.

Standalone NiralScript has no implicit host globals. Set `niral.niralscriptGlobals`
to an array such as `["print"]` only when your host actually supplies those names,
then reload the window. This matches the standalone CLI's `--global` contract.
Set `niral.niralscriptStrictTypes` to `true` and reload to require unknown/null
narrowing, matching `nrs check --strict`. The default remains gradual checking.

Hover shows declared annotations/signatures, not general inferred types.
Symbol navigation requires a valid program. An unfinished simple receiver such as
`counter.` recovers member completions; other invalid source receives keyword
completions. Completions currently include top-level names, not every
local lexical scope. Imports must be explicit relative `.nrs` paths to existing,
non-private files within the project, without symlinks.

## Extension Host Verification

`tests/vscode-host.cjs` exercises the actual VS Code extension API, including
activation, diagnostics, hover, completions, local/imported definitions and
unsaved dependency updates, generic aliases/calls, defaults/rest, loop control,
type navigation, generic class constructors/member navigation and strict-checking
recovery. It requires an isolated workspace
named `niral-vscode-host-*` and sets `niral.serverPath` and strict checking only
in that workspace. The expanded suite has nine check groups.

From the repository root, set `CODE` to your installed VS Code desktop executable
and run:

```sh
test_workspace=$(mktemp -d /tmp/niral-vscode-host-XXXXXX)
env -u ELECTRON_RUN_AS_NODE -u VSCODE_IPC_HOOK_CLI "$CODE" "$test_workspace" \
  --user-data-dir="$test_workspace/profile" \
  --extensions-dir="$test_workspace/extensions" \
  --extensionDevelopmentPath="$PWD/editors/vscode" \
  --extensionTestsPath="$PWD/tests/vscode-host.cjs" \
  --disable-extensions --disable-workspace-trust --skip-welcome --skip-release-notes
```

This macOS/Linux command uses the installed application, without downloading a
test runner or dependencies. A successful run writes `result.json` inside the
temporary workspace and closes the test host. The suite passed on macOS with
VS Code 1.143.1 (Extension Host Node24.21.0) on 26 October 2026. It does not
publish or install the extension into your normal profile.

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

- **Docs** — https://niral.site
- **GitHub** — https://github.com/Zyora-Dev/niral
- **Issues** — https://github.com/Zyora-Dev/niral/issues

---

Built by [ZyoraLabs](https://zyoralabs.com). Zero dependencies, forever.
