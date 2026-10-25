# Launcher Release Checklist

The two npm packages are self-contained launchers, not the framework runtime.
They download `Zyora-Dev/niral` from `main` by default; `NIRAL_REF` selects a
persisted full commit SHA or existing version tag. The website is independent.
Both version 0.1.4 publications are registry-verified on 2026-10-25, with both
latest tags at 0.1.4. Initial discovery found versions 0.1.0 through 0.1.3. The previous
0.1.3 publication and deployment records are historical. Windows Node 22/24
release gates are now verified against source `5d75a73`; npm remains at 0.1.4.
Do not treat a local version bump or a website deployment as npm publication.

Local 0.1.4 validation passed, including actual tarball installs and isolated
scaffold/build/test against current source. User completed terminal login on
2026-10-25; npm authentication verifies `zyoralabs`. Source commit
`825256b57262da6e326fc6219950b54d60472100` is pushed to main and remote-verified.
Both five-file published tarball checksums match local validation:
- niral: `68beefcd85c902a7429c341f2f2c0c75ec8bdb20`
- create-niral: `965bda2d83ca7e336c37d3e50db5af3aff982c0a`

Fresh public registry installs of both packages passed allowlist/zero-dependency
checks, help/version without downloading, remote scaffold/build/test, offline
cache reuse, immutable rebuilds, main updates, exact source pins, persisted shim
updates and explicit unpinning. An older-revision shim upgrade and actual
`npx niral@latest update` of an older archive cache passed, preserving private-data
fixtures in the backup. Disposable homes were removed. No production deployment.

[Source CI](https://github.com/Zyora-Dev/niral/actions/runs/40190853399) and
[checkpoint CI](https://github.com/Zyora-Dev/niral/actions/runs/40191032126) passed.
Node 22 and 24 Linux jobs passed the extended Postgres/image release gates.

[Windows portability CI](https://github.com/Zyora-Dev/niral/actions/runs/40195078246)
passed all four Windows/Linux Node 22/24 jobs: framework/focused tests, Chromium,
forms and packed-launcher scaffold/build/test. Postgres/image checks run on Linux
only. Windows release activation uses guarded junction replacement with error
restoration, not crash-atomic replacement; interrupted activation may need manual
link/lock recovery. POSIX mode tests do not verify Windows ACL privacy.

## Validate Locally

From the repository root:

```sh
npm run test:release
```

The gate requires Node 22+, TypeScript (`NIRAL_TSC`, defaulting to this workspace's
`.niral/lib/typescript/typescript.js`) and Playwright/Chromium installed under
`tests/browser`. Missing prerequisites fail, not silently skip. In a fresh checkout:

```sh
npm install --prefix tests/browser --no-package-lock --ignore-scripts
npm exec --prefix tests/browser -- playwright install chromium
npm install --prefix tests/browser --no-save --no-package-lock --ignore-scripts typescript@5.7.3
NIRAL_TSC="$PWD/tests/browser/node_modules/typescript/lib/typescript.js" npm run test:release
```

The gate runs the framework/CLI/DI suite, immutable build regressions, Devtools,
docs contact/SEO with browsers enabled, Chromium smoke and form/navigation suites,
then package allowlist checks. `NIRAL_BROWSER_FILTER` is cleared for release runs.
Postgres/image gates are reported as unconfigured locally unless
`NIRAL_TEST_PG_URL` and `NIRAL_CWEBP` are provided. Only use a disposable test
database. `NIRAL_RELEASE_EXTENDED=1` requires both; checked-in Node 22/24 Linux CI
provides them along with isolated tooling. CI never publishes or deploys.

The CLI suite uses isolated homes
and mocked Git/HTTPS responses, plus real archive extraction and template creation.
It checks argument forwarding, exit codes, source-checkout protection, failed
updates, pin persistence/unpinning, shell entry-point recovery, backup retention
and byte-identical shared launcher files and shell installer mirrors. It also checks
that every dispatcher command and recipe appears in the CLI documentation.

Each package must contain only `package.json`, `README.md`, `index.js` and the two
bin scripts. Never include framework data, keys, environment files or local caches.
Both packages retain zero runtime dependencies. Keep their shared implementations
identical; tests enforce this until packaging is generated from a single source.

## Release Procedure

1. Review the diff and run validation. Require green Windows and Linux Node 22/24
   CI gates; local macOS tests alone do not establish Windows support.
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