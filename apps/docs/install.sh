#!/usr/bin/env bash
# niral installer — https://niral.zyora.club
#   curl -fsSL https://niral.zyora.club/install.sh | bash
# Installs the framework to ~/.niral (zero dependencies — the download IS the install).

set -euo pipefail
NIRAL_HOME="${NIRAL_HOME:-$HOME/.niral}"
REPO="https://github.com/Zyora-Dev/niral"

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

echo "niral · installing to $NIRAL_HOME …"
mkdir -p "$NIRAL_HOME"

if command -v git >/dev/null 2>&1; then
  if [ -d "$NIRAL_HOME/framework/.git" ]; then
    git -C "$NIRAL_HOME/framework" pull -q
  else
    rm -rf "$NIRAL_HOME/framework"
    git clone -q --depth 1 "$REPO.git" "$NIRAL_HOME/framework"
  fi
else
  curl -fsSL "https://codeload.github.com/Zyora-Dev/niral/tar.gz/refs/heads/main" -o "$NIRAL_HOME/niral.tgz"
  rm -rf "$NIRAL_HOME/framework"
  mkdir -p "$NIRAL_HOME/framework"
  tar -xzf "$NIRAL_HOME/niral.tgz" -C "$NIRAL_HOME/framework" --strip-components=1
  rm "$NIRAL_HOME/niral.tgz"
fi

# the `niral` command
mkdir -p "$NIRAL_HOME/bin"
cat > "$NIRAL_HOME/bin/niral" <<SHIM
#!/usr/bin/env bash
exec node "$NIRAL_HOME/framework/bin/niral.js" "\$@"
SHIM
chmod +x "$NIRAL_HOME/bin/niral"

# PATH (zsh/bash — appended once, with a marker)
PROFILE=""
case "${SHELL:-}" in
  */zsh)  PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bashrc" ;;
esac
if [ -n "$PROFILE" ] && ! grep -q '\.niral/bin' "$PROFILE" 2>/dev/null; then
  printf '\n# niral\nexport PATH="$HOME/.niral/bin:$PATH"\n' >> "$PROFILE"
  echo "→ added ~/.niral/bin to PATH in $PROFILE"
fi

echo ""
echo "✓ niral installed — open a new terminal (or: export PATH=\"\$HOME/.niral/bin:\$PATH\") and run:"
echo ""
echo "    niral create my-app"
echo ""
