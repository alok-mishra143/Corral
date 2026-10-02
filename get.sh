#!/bin/sh
# corral universal installer.
#
#   curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh -s rust
#   curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh -s go
#   curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh -s ts
#
# Rust and Go download the latest prebuilt binary from GitHub Releases for your
# platform (no toolchain needed). TypeScript downloads the prebuilt bundle and
# needs Bun. With no argument it picks a build from your platform/toolchain.
# If there is no release asset for your platform, it falls back to a source build.
set -eu

# Override with:  CORRAL_REPO=owner/name sh get.sh rust
REPO="${CORRAL_REPO:-alok-mishra143/Corral}"
BIN_DIR="$HOME/.local/bin"
LANG="${1:-}"

if [ -z "$LANG" ]; then
  if command -v cargo >/dev/null 2>&1; then LANG=rust
  elif command -v go >/dev/null 2>&1; then LANG=go
  elif command -v bun >/dev/null 2>&1; then LANG=ts
  else
    LANG=rust
  fi
  echo "==> no language given; using -> $LANG"
fi

case "$LANG" in
  ts|typescript) NAME="ts";   BRANCH="main";   TOOL="bun";   PREBUILT=0 ;;
  go|golang)     NAME="go";   BRANCH="Golang"; TOOL="go";    PREBUILT=1 ;;
  rust|rs)       NAME="rust"; BRANCH="Rust";   TOOL="cargo"; PREBUILT=1 ;;
  *) echo "usage: sh -s <ts|go|rust>" >&2; exit 1 ;;
esac

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }

RAW="https://raw.githubusercontent.com/${REPO}"
RELEASES="https://github.com/${REPO}/releases/latest/download"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  amd64) ARCH="x86_64" ;;
esac
PLAT="${OS}-${ARCH}"

finish() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
  echo "Done. Restart OpenCode so it loads the plugin."
}

# Download a .tar.gz release asset and install the `corral` binary it contains.
install_binary_tarball() {
  url="$1"
  tmp="${TMPDIR:-/tmp}/corral.$$"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  if ! curl -fsSL "$url" -o "$tmp/corral.tar.gz" 2>/dev/null; then
    rm -rf "$tmp"
    return 1
  fi
  if ! tar -xzf "$tmp/corral.tar.gz" -C "$tmp" 2>/dev/null; then
    rm -rf "$tmp"
    return 1
  fi
  if [ ! -f "$tmp/corral" ]; then
    rm -rf "$tmp"
    return 1
  fi
  mkdir -p "$BIN_DIR"
  mv "$tmp/corral" "$BIN_DIR/corral"
  chmod +x "$BIN_DIR/corral"
  rm -rf "$tmp"
  return 0
}

# Download the TypeScript bundle and install a `corral` wrapper that runs it.
install_ts_bundle() {
  url="$1"
  dest="${CORRAL_DIR:-$HOME/.local/share/corral}"
  tmp="${TMPDIR:-/tmp}/corral-ts.$$"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  if ! curl -fsSL "$url" -o "$tmp/corral-ts.tar.gz" 2>/dev/null; then
    rm -rf "$tmp"
    return 1
  fi
  rm -rf "$dest/corral-ts"
  mkdir -p "$dest"
  if ! tar -xzf "$tmp/corral-ts.tar.gz" -C "$dest" 2>/dev/null; then
    rm -rf "$tmp"
    return 1
  fi
  rm -rf "$tmp"
  if [ ! -f "$dest/corral-ts/dist/index.js" ]; then
    return 1
  fi
  mkdir -p "$BIN_DIR"
  printf '#!/bin/sh\nexec bun "%s/dist/index.js" "$@"\n' "$dest/corral-ts" > "$BIN_DIR/corral"
  chmod +x "$BIN_DIR/corral"
  return 0
}

if [ "$PREBUILT" = "1" ]; then
  echo "==> fetching the latest corral ($NAME) release for ${PLAT}"
  if install_binary_tarball "${RELEASES}/corral-${NAME}-${PLAT}.tar.gz"; then
    "$BIN_DIR/corral" setup || true
    "$BIN_DIR/corral" restart || true
    finish
    exit 0
  fi
  echo "==> no release asset for ${PLAT}; trying the branch prebuilt"
  mkdir -p "$BIN_DIR"
  if curl -fsSL "${RAW}/${BRANCH}/prebuilt/corral-${PLAT}" -o "$BIN_DIR/corral.tmp" 2>/dev/null; then
    mv "$BIN_DIR/corral.tmp" "$BIN_DIR/corral"
    chmod +x "$BIN_DIR/corral"
    "$BIN_DIR/corral" setup || true
    "$BIN_DIR/corral" restart || true
    finish
    exit 0
  fi
  echo "==> no prebuilt for ${PLAT}; falling back to a source build"
  command -v "$TOOL" >/dev/null 2>&1 || {
    echo "error: no prebuilt for ${PLAT} and '$TOOL' is not installed." >&2
    echo "Install $TOOL, or use a platform we ship a binary for." >&2
    exit 1
  }
fi

# TypeScript: prefer the prebuilt release bundle, then fall back to source.
if [ "$NAME" = "ts" ]; then
  command -v bun >/dev/null 2>&1 || {
    echo "error: bun is required for the TypeScript build (https://bun.sh)" >&2
    exit 1
  }
  echo "==> fetching the latest corral (ts) release bundle"
  if install_ts_bundle "${RELEASES}/corral-ts.tar.gz"; then
    "$BIN_DIR/corral" setup || true
    "$BIN_DIR/corral" restart || true
    finish
    exit 0
  fi
  echo "==> no release bundle available; falling back to a source build"
fi

command -v "$TOOL" >/dev/null 2>&1 || {
  echo "error: '$TOOL' is required for the $NAME source build" >&2
  exit 1
}
command -v git >/dev/null 2>&1 || { echo "error: git is required for a source build" >&2; exit 1; }

DEST="${CORRAL_DIR:-$HOME/.local/share/corral}"
echo "==> corral ($NAME) from branch '$BRANCH' -> $DEST"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --depth 1 origin "$BRANCH"
  git -C "$DEST" checkout -f -B "$BRANCH" FETCH_HEAD
else
  mkdir -p "$(dirname "$DEST")"
  rm -rf "$DEST"
  git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$DEST"
fi
cd "$DEST"
sh ./install.sh
