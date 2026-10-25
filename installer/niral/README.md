# Niral CLI

Zero-dependency launcher for the Niral full-stack framework. Requires Node.js 22+.

## Use

```sh
npx niral create myapp
cd myapp
npx niral dev
```

Or install one global launcher:

```sh
npm install -g niral
niral create myapp --template blog
niral dev myapp
```

Both `niral` and `create-niral` packages provide the same two executable names.
Install only one globally to avoid bin conflicts. Templates: `minimal` (default),
`blog`, `dashboard`. Create refuses to overwrite a nonempty project directory.

The first project command downloads the framework from the official
[repository](https://github.com/Zyora-Dev/niral) into `~/.niral/framework`.
Set `NIRAL_HOME` to choose another install directory. Normal commands reuse the
cached framework without checking the network. Keep projects outside that directory.

## Commands

```sh
npx niral --help
npx niral --version
npx niral check myapp
npx niral test myapp
npx niral build myapp
npx niral start myapp
npx niral add api myapp
```

All framework commands and arguments are forwarded, with the framework's exit
status preserved. See the [complete CLI reference](https://niral.site/docs/cli).
`--version` reports this launcher and, when installed, the framework version.
The generated direct `niral` shim reports the framework version only.

## Update

Launcher 0.1.4 supports explicit framework updates and persisted revision pins:

```sh
npx niral@latest update
```

This explicitly updates `NIRAL_HOME/framework`, even when the cached framework
has no `update` command. The default is the repository's `main` branch. Updating
also refreshes an existing generated shell shim so its updater remains independent
of older pinned framework code. Updating the npm launcher alone does not refresh
the framework; update a globally installed launcher separately with
`npm install -g niral@latest`.

Set `APPROVED_FRAMEWORK_SHA` to a reviewed full 40-character lowercase commit SHA:

```sh
NIRAL_REF="$APPROVED_FRAMEWORK_SHA" npx niral@latest update
niral update
NIRAL_REF=main npx niral@latest update
```

The selection is saved in `NIRAL_HOME/.framework-ref`; plain updates retain it.
Existing `v`-prefixed version tags are also accepted, but tags can move: use a
full commit SHA for reproducibility. `NIRAL_REF=main` explicitly removes the pin.
Fresh installations accept the same variable; switching a cached install requires
an explicit update. npm versions and framework revisions are independent.

Git installs must be clean, on `main` or a managed detached pin, and use the
official HTTPS origin. `main` updates
are fast-forward only; a Git failure never replaces the checkout with an archive.
Pin changes and non-Git replacements are staged and syntax-checked first; the complete previous
directory is retained at the printed `framework-backup-*/framework` path. Local
files in that backup are not merged into the new framework. No backups are pruned.

Stop active development/build commands before updating. Concurrent installers are
refused. If interrupted, inspect other installer processes before manually removing
a stale `NIRAL_HOME/.framework-install-lock` directory. Symlinked installs and
updates invoked from unmanaged source checkouts are refused; maintain those with
Git. An update does not migrate apps, publish packages or deploy/restart servers.

## Developer Intelligence

```sh
npx niral di setup
npx niral di status
npx niral di ask "Explain this project" --root ./myapp --read-only
npx niral di chat --root ./myapp
npx niral di new myblog "Customize the home page" --template blog
```

`npx niral di setup` offers OpenAI, Claude (Anthropic), Azure OpenAI or Custom.
Named providers set protocol/auth automatically; Custom keeps manual choices.
Enter your exact model/deployment and credential variable name. Azure also asks
for its resource URL or `/openai/v1` base. Bedrock is not yet supported.
Use `npx niral di setup --help` for noninteractive flags.
Credentials stay in a named environment variable, not config or project files.
File reads/edits require a terminal and per-tool approval; writes retain backups
and reject stale hashes. `ask <prompt> --no-tools` permits prompt-only automation.
No unrestricted shell, automatic tests, transcript persistence or Niral Cloud
requirement. See the [DI commands and safeguards](https://niral.site/docs/cli).
Existing cached frameworks need `npx niral@latest update` to acquire DI commands.