#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
CARGO_BUILD_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"
TARGET_DIR="$CARGO_BUILD_DIR/debug"
APP_NAME="CrewDock Dev"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
ICON_HASH="$(shasum "$TAURI_DIR/icons/icon.icns" | cut -c1-10)"
BUNDLE_ID="com.ashlab.crewdock.dev.${ICON_HASH}"
BUNDLE_APP_NAME="${APP_NAME} ${ICON_HASH}"

APP_BUNDLE_DIR="$TARGET_DIR/bundle/macos/${BUNDLE_APP_NAME}.app"
CONTENTS_DIR="$APP_BUNDLE_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

cd "$ROOT_DIR"

cargo build --manifest-path "$TAURI_DIR/Cargo.toml"

rm -rf "$APP_BUNDLE_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$TARGET_DIR/crewdock" "$MACOS_DIR/crewdock"
cp "$TAURI_DIR/icons/icon.icns" "$RESOURCES_DIR/icon.icns"

cat > "$CONTENTS_DIR/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>crewdock</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

chmod 755 "$MACOS_DIR/crewdock"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_BUNDLE_DIR" >/dev/null 2>&1 || true
fi

echo "$APP_BUNDLE_DIR"

if [[ "${1:-}" == "--build-only" ]]; then
  exit 0
fi

open -na "$APP_BUNDLE_DIR"
