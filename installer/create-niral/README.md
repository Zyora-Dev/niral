# Create Niral

Create a zero-dependency Niral app. Requires Node.js 22+.

```sh
npx create-niral myapp
cd myapp
npx niral dev
```

Use `npx niral dev` immediately in the same terminal. The scaffolder also installs
a direct `niral` launcher and adds its directory to your zsh/bash profile; open a
new terminal to use it. Other shells and Windows need the install's `bin` directory
on PATH, or can keep using `npx niral`.

## Templates

```sh
npx create-niral myblog --template blog
npx create-niral dashboard --template dashboard
npx create-niral . --template minimal
npx create-niral --help
npx create-niral --version
```

The target must be new or empty. `minimal` is the default; `blog` and `dashboard`
are the other templates. Unknown arguments and invalid templates fail before
downloading or scaffolding. A failed scaffold does not install a launcher.

## Installation And Updates

The launcher downloads the framework from the official
[repository](https://github.com/Zyora-Dev/niral) into `~/.niral/framework` once.
`NIRAL_HOME` changes the installation directory. Keep projects outside it.
Subsequent commands reuse that framework; `npx create-niral@latest` selects the
latest npm launcher but does not refresh a cached framework.

Use launcher 0.1.4 for explicit framework updates and persisted revision pins:

```sh
npx niral@latest update
```

After the framework update, `niral update` works through the direct launcher too.
Updates follow `main` by default, independently of npm package versions.
Set `NIRAL_REF` to a reviewed full lowercase 40-character commit SHA or existing
`v`-prefixed version tag for an explicit install/update. The selection persists in
`NIRAL_HOME/.framework-ref`; plain updates retain it. Full SHAs are reproducible;
tags can move. Use `NIRAL_REF=main npx niral@latest update` to remove the pin.
Switching an existing cache requires an explicit update. Generated shell launchers
keep their updater outside the framework, including when pinning older revisions.
Updates do not change app source, npm packages or running servers.

Git updates require a clean official-origin `main` checkout or managed detached
pin. `main` updates are fast-forward only. Git failures stop without archive
replacement. Pin changes and archive-based installs are replaced
only after staging and CLI validation; the old directory is retained at the printed
backup path. Local additions remain in that backup, not merged into the new copy.
Stop active Niral development/build commands before updating. Backups are not
automatically deleted. Concurrent installers and symlinked install paths are refused.

For a global npm installation, install **either** `create-niral` **or** `niral`:
both export the same executable names. Update a global `create-niral` launcher with
`npm install -g create-niral@latest`, separately from updating the framework.

[Documentation](https://niral.site/docs/getting-started) |
[All framework commands](https://niral.site/docs/cli)

## Developer Intelligence

This package also installs the `niral` executable, including `niral di`:

```sh
niral di setup
niral di status
niral di ask "Explain this project" --read-only
niral di chat
niral di new myblog "Customize the home page" --template blog
```

`niral di setup` offers OpenAI, Claude (Anthropic), Azure OpenAI or Custom.
Named providers set protocol/auth automatically; Custom keeps manual choices.
Enter your exact model/deployment and credential variable name, not the key.
Azure also asks for its resource URL or `/openai/v1` base. Bedrock is not yet
supported. Explicit flags remain available with `niral di setup --help`.
DI uses your explicit provider/model and an environment-variable credential.
Workspace tools require per-call approval; writes keep external backups and
check current hashes. No shell execution, automatic tests or cloud requirement.
Use `niral di ask <prompt> --no-tools` for noninteractive prompt-only calls.
Read the [CLI guide](https://niral.site/docs/cli) before granting workspace access.
An older cached framework needs `npx niral@latest update` first.