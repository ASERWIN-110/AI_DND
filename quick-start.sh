#!/usr/bin/env sh
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$ROOT" || exit 1

NODE_MAJOR_MIN=24
RUNTIME_DIR="$ROOT/.runtime/node"
NODE_BIN=node

is_node_ok() {
  candidate=$1
  major=$("$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge "$NODE_MAJOR_MIN" ]
}

detect_node_platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os:$arch" in
    Darwin:arm64) printf '%s\n' darwin-arm64 ;;
    Darwin:x86_64) printf '%s\n' darwin-x64 ;;
    Linux:aarch64|Linux:arm64) printf '%s\n' linux-arm64 ;;
    Linux:x86_64) printf '%s\n' linux-x64 ;;
    *) return 1 ;;
  esac
}

install_local_node() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "Node.js $NODE_MAJOR_MIN+ is required and curl is not available to download it."
    echo "Install Node.js from https://nodejs.org/ or install curl, then run this launcher again."
    return 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "Node.js $NODE_MAJOR_MIN+ is required and tar is not available to extract it."
    echo "Install Node.js from https://nodejs.org/ or install tar, then run this launcher again."
    return 1
  fi

  platform=$(detect_node_platform) || {
    echo "Unsupported platform for automatic Node.js setup: $(uname -s) $(uname -m)"
    echo "Install Node.js $NODE_MAJOR_MIN+ from https://nodejs.org/ and run this launcher again."
    return 1
  }

  mkdir -p "$ROOT/.runtime/downloads"
  manifest_url="https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"
  echo "Configuring local Node.js $NODE_MAJOR_MIN+ under .runtime/node..."
  file=$(curl -fsSL "$manifest_url" | awk -v platform="$platform" '$2 ~ "^node-v24\\..*-" platform "\\.tar\\.gz$" { print $2; exit }')
  if [ -z "$file" ]; then
    echo "Could not find a Node.js package for $platform in $manifest_url"
    return 1
  fi

  archive="$ROOT/.runtime/downloads/$file"
  tmp_dir="$ROOT/.runtime/node.tmp"
  url="https://nodejs.org/dist/latest-v24.x/$file"
  curl -fL "$url" -o "$archive"
  rm -rf "$tmp_dir" "$RUNTIME_DIR"
  mkdir -p "$tmp_dir"
  tar -xzf "$archive" -C "$tmp_dir" --strip-components=1
  mv "$tmp_dir" "$RUNTIME_DIR"
}

if is_node_ok "$RUNTIME_DIR/bin/node"; then
  NODE_BIN="$RUNTIME_DIR/bin/node"
  PATH="$RUNTIME_DIR/bin:$PATH"
elif is_node_ok node; then
  NODE_BIN=node
else
  install_local_node || exit 1
  NODE_BIN="$RUNTIME_DIR/bin/node"
  PATH="$RUNTIME_DIR/bin:$PATH"
fi

export PATH

"$NODE_BIN" scripts/quick-start.mjs "$@"
status=$?

if [ "${AI_DND_PAUSE_ON_EXIT:-0}" = "1" ]; then
  printf '\nLauncher exited with code %s. Press Return to close...' "$status"
  read -r _unused
fi

exit "$status"
