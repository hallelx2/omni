#!/usr/bin/env bash
# Omni installer — curl -fsSL https://raw.githubusercontent.com/hallelx2/omni/main/install.sh | bash
#
# Downloads the latest prebuilt omni binary for your platform from GitHub
# releases, installs it to ~/.omni/bin, and wires PATH. Override the
# version with OMNI_VERSION=v0.1.0, or the install dir with OMNI_BIN_DIR.
set -euo pipefail

REPO="hallelx2/omni"
BIN_DIR="${OMNI_BIN_DIR:-$HOME/.omni/bin}"
VERSION="${OMNI_VERSION:-latest}"

c_dim()   { printf '\033[2m%s\033[0m\n' "$1"; }
c_green() { printf '\033[32m%s\033[0m\n' "$1"; }
c_cyan()  { printf '\033[36m%s\033[0m\n' "$1"; }
c_err()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }

printf '\n\033[1m  ◆ omni installer\033[0m\n\n'

# ─── Detect platform ─────────────────────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  plat="linux" ;;
  Darwin) plat="darwin" ;;
  *) c_err "  unsupported OS: $os (use install.ps1 on Windows)"; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) cpu="x64" ;;
  arm64|aarch64) cpu="arm64" ;;
  *) c_err "  unsupported arch: $arch"; exit 1 ;;
esac
asset="omni-${plat}-${cpu}"
c_dim "  platform: ${plat}-${cpu}"

# ─── Resolve download URL ────────────────────────────────────────────────────
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

# ─── Download ────────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
target="${BIN_DIR}/omni"
c_dim "  downloading ${asset}…"
if command -v curl >/dev/null 2>&1; then
  curl -fSL "$url" -o "$target"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$target" "$url"
else
  c_err "  need curl or wget"; exit 1
fi
chmod +x "$target"
c_green "  ✓ installed → ${target}"

# ─── Wire PATH ───────────────────────────────────────────────────────────────
add_path_line='export PATH="'"$BIN_DIR"':$PATH"'
marker="# omni installer"
profile=""
case "${SHELL:-}" in
  *zsh)  profile="$HOME/.zshrc" ;;
  *bash) profile="$HOME/.bashrc" ;;
  *)     profile="$HOME/.profile" ;;
esac
if [ -n "$profile" ]; then
  if grep -qF "$marker" "$profile" 2>/dev/null || grep -qF "$BIN_DIR" "$profile" 2>/dev/null; then
    c_dim "  · PATH already wired in $profile"
  else
    printf '\n%s\n%s\n' "$marker" "$add_path_line" >> "$profile"
    c_green "  ✓ PATH → appended to $profile"
    c_dim "    run: source $profile  (or open a new terminal)"
  fi
fi

printf '\n\033[1m  done.\033[0m\n\n'
c_cyan "  omni"
c_dim  "  put MIMO_API_KEY in ~/.omni/.env to use your Xiaomi grant"
c_dim  "  plain REPL: omni --plain"
printf '\n'
