#!/bin/sh
set -eu
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
PLUGINS_DIR="$HOME/.config/opencode/plugins"
echo "==> corral install (Rust)"
command -v cargo >/dev/null 2>&1 || { echo "error: Rust/Cargo is required (https://rustup.rs)"; exit 1; }
cd "$REPO_DIR"
if ! cargo build --release --offline 2>/dev/null; then
  cargo build --release
fi
mkdir -p "$BIN_DIR"
cp "$REPO_DIR/target/release/corral" "$BIN_DIR/corral"
chmod +x "$BIN_DIR/corral"
"$BIN_DIR/corral" setup
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"";;
esac
mkdir -p "$PLUGINS_DIR"
echo "==> restarting daemon (kills old, starts new build)"
"$BIN_DIR/corral" restart || true
echo "==> verifying plugin loads daemon on next OpenCode start"
"$BIN_DIR/corral" doctor || true
echo ""
echo "Done. Restart OpenCode (daemon autostarts via the plugin)."
echo "Dashboard: corral d   |   Commands: corral help, corral restart, corral uninstall"
