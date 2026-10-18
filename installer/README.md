# Launcher Release Checklist

The two npm packages are self-contained launchers, not the framework runtime.
They download `Zyora-Dev/niral` from `main`; the website deployment is independent.
Both package manifests are prepared as 0.1.3. The registry still reports 0.1.2
as of 2026-10-18; publication is pending npm authentication (whoami returned 401).
Do not treat a local version bump or a website deployment as npm publication.

## Validate Locally

From the repository root:

```sh
node tests/cli.js
node tests/di.js
node tests/di-cli.js
NIRAL_TSC="$PWD/.niral/lib/typescript/typescript.js" npm test
npm pack ./installer/niral --dry-run --ignore-scripts --json
npm pack ./installer/create-niral --dry-run --ignore-scripts --json
```

The full-suite command uses this workspace's existing TypeScript cache; configure
`NIRAL_TSC` appropriately in another checkout. The CLI suite uses isolated homes
and mocked Git/HTTPS responses, plus real archive extraction and template creation.
It checks argument forwarding, exit codes, source-checkout protection, failed
updates, backup retention and byte-identical shared launcher files. It also checks
that every dispatcher command and recipe appears in the CLI documentation.

Each package must contain only `package.json`, `README.md`, `index.js` and the two
bin scripts. Never include framework data, keys, environment files or local caches.
Both packages retain zero runtime dependencies. Keep their shared implementations
identical; tests enforce this until packaging is generated from a single source.

## Release Later, With Approval

1. Review the diff and run validation. Test Windows separately; local verification
   is on macOS, and POSIX shell/symlink tests do not establish Windows support.
2. Commit/push the approved framework and launcher changes to `main` before npm
   publication. Confirm the remote commit includes the commands and installer
   modules: first-time downloads always fetch remote source, never local edits.
3. Check the registry's current versions, choose unused versions for both packages,
   and update the package manifests. Do not assume the checked-in version is unused.
4. Remove the source-preview notices when releasing the commands. Re-run pack
   inspection and test packed launchers with a disposable `HOME`/`NIRAL_HOME`.
5. Publish each package from its own directory only after explicit approval. Never
   publish the repository root as the `niral` launcher. Handle npm credentials/OTP
   directly in the terminal, not in chat or tracked files.
6. Verify registry installs in fresh disposable homes: create a project, inspect
   help/version, build/test it, update, then verify a second invocation uses cache.
   Also verify `npx niral@latest update` upgrades an older cached framework.
7. Deploy the documentation site separately after approval and record the actual
   package versions, source revision, checks and release/deployment results.

No automatic background updater is provided. Users choose when to refresh their
framework. `niral update` does not upgrade the npm launcher or deploy applications.
The framework's prerelease version label can stay the same across source commits;
Git updates print the resulting revision as well as the previous revision.