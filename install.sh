#!/bin/sh
set -eu
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
PLUGINS_DIR="$HOME/.config/opencode/plugins"
echo "==> corral install"
command -v bun >/dev/null 2>&1 || { echo "error: bun is required (https://bun.sh)"; exit 1; }
cd "$REPO_DIR"
bun install
bun run build
mkdir -p "$BIN_DIR"
printf '#!/bin/sh\nexec bun "%s/dist/index.js" "$@"\n' "$REPO_DIR" > "$BIN_DIR/corral"
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
