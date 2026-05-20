#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "error: do not run CrewDock dev with sudo." >&2
  echo "Run 'npm run dev' as your normal user so Cargo, Tauri, and build artifacts stay in your user environment." >&2
  exit 1
fi

if cargo tauri --help >/dev/null 2>&1; then
  cd "$ROOT_DIR"
  exec cargo tauri dev "$@"
fi

if [[ -x "$ROOT_DIR/node_modules/.bin/tauri" ]]; then
  cd "$ROOT_DIR"
  exec "$ROOT_DIR/node_modules/.bin/tauri" dev "$@"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "warning: Tauri CLI is not installed; falling back to the macOS wrapper dev app flow." >&2
  echo "Install 'tauri-cli' later if you want the full 'cargo tauri dev' workflow." >&2
  export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/crewdock-dev-target}"
  exec bash "$ROOT_DIR/scripts/run-macos-dev-app.sh" "$@"
fi

echo "error: Tauri CLI is not installed." >&2
echo "Install one of the following and retry:" >&2
echo "  cargo install tauri-cli --version '^2'" >&2
echo "  npm install --save-dev @tauri-apps/cli@latest" >&2
exit 1
