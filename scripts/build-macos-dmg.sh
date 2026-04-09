#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
TARGET_DIR="$TAURI_DIR/target/release"
APP_NAME="CrewDock"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
ARCH="$(uname -m)"
NOTARIZE="${APPLE_NOTARIZE:-1}"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-crewdock-notary}"
KEYCHAIN_PATH="${APPLE_KEYCHAIN_PATH:-$HOME/Library/Keychains/login.keychain-db}"

APP_BUNDLE_DIR="$TARGET_DIR/bundle/macos/${APP_NAME}.app"
CONTENTS_DIR="$APP_BUNDLE_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
DMG_DIR="$TARGET_DIR/bundle/dmg"
NOTARIZE_DIR="$TARGET_DIR/bundle/notarize"
DMG_PATH="$DMG_DIR/${APP_NAME}_${VERSION}_${ARCH}.dmg"
APP_ZIP_PATH="$NOTARIZE_DIR/${APP_NAME}_${VERSION}_${ARCH}.app.zip"

cd "$ROOT_DIR"

detect_signing_identity() {
  security find-identity -v -p codesigning "$KEYCHAIN_PATH" 2>/dev/null \
    | grep 'Developer ID Application:' \
    | sed -E 's/^[[:space:]]*[0-9]+\) [0-9A-F]{40} "([^"]+)"/\1/' \
    | head -n 1
}

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-$(detect_signing_identity)}"

if [[ -z "$SIGNING_IDENTITY" ]]; then
  echo "error: no Developer ID Application signing identity found." >&2
  echo "Set APPLE_SIGNING_IDENTITY or install a Developer ID Application certificate in Keychain Access." >&2
  exit 1
fi

if [[ "$NOTARIZE" == "1" ]] && ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "error: notarytool keychain profile '$NOTARY_PROFILE' is not available." >&2
  echo "Create it with: xcrun notarytool store-credentials \"$NOTARY_PROFILE\" ..." >&2
  exit 1
fi

cargo build --release --manifest-path "$TAURI_DIR/Cargo.toml"

rm -rf "$APP_BUNDLE_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$DMG_DIR" "$NOTARIZE_DIR"

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
  <string>com.ashlab.crewdock</string>
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

codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$MACOS_DIR/crewdock"
codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$APP_BUNDLE_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE_DIR"

if [[ "$NOTARIZE" == "1" ]]; then
  rm -f "$APP_ZIP_PATH"
  ditto -c -k --keepParent "$APP_BUNDLE_DIR" "$APP_ZIP_PATH"
  xcrun notarytool submit "$APP_ZIP_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP_BUNDLE_DIR"
fi

STAGE_DIR="$(mktemp -d "$DMG_DIR/manual-stage.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

ditto "$APP_BUNDLE_DIR" "$STAGE_DIR/${APP_NAME}.app"
ln -s /Applications "$STAGE_DIR/Applications"

rm -f "$DMG_PATH"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null

if [[ "$NOTARIZE" == "1" ]]; then
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
fi

echo "$DMG_PATH"
