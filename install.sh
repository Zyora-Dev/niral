#!/usr/bin/env bash
# niral installer — https://niral.site
#   curl -fsSL https://niral.site/install.sh | bash
# Installs the framework to ~/.niral (zero dependencies — the download IS the install).

set -euo pipefail
NIRAL_HOME="${NIRAL_HOME:-$HOME/.niral}"
export NIRAL_HOME

# Node 22+ is the only requirement
if ! command -v node >/dev/null 2>&1; then
  echo "✗ niral needs Node 22+ — install it from https://nodejs.org first"
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then
  echo "✗ Node $(node -v) found — niral needs 22+ (node:sqlite). Upgrade at https://nodejs.org"
  exit 1
fi

BOOTSTRAP="$(mktemp -d "${TMPDIR:-/tmp}/niral-bootstrap.XXXXXX")"
trap 'rm -rf "$BOOTSTRAP"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 60 \
  "https://raw.githubusercontent.com/Zyora-Dev/niral/main/installer/niral/index.js" \
  -o "$BOOTSTRAP/index.mjs"
node --input-type=module - "$BOOTSTRAP/index.mjs" <<'NODE'
import { pathToFileURL } from "node:url";
const { ensureFramework, installLauncher } = await import(pathToFileURL(process.argv[2]).href);
await ensureFramework({ update: true });
const result = installLauncher();
console.log(`niral installed: ${result.shim}`);
if (result.added) console.log(`PATH updated in ${result.profile}; open a new terminal.`);
console.log("Run: niral create my-app");
NODE
