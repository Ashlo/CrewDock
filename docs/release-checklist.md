# CrewDock Release Checklist

Use this checklist for every public GitHub Release.

## Preflight

- Confirm the worktree is clean with `git status --short`.
- Confirm `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
  all carry the same version.
- Confirm the release notes markdown for the target version exists in
  `docs/releases/`.
- Confirm the README and screenshots match the shipped product.
- Decide which platforms ship in this release: macOS, Windows, or both.
- If shipping macOS, confirm a valid `Developer ID Application` signing identity
  is available:

```sh
security find-identity -v -p codesigning
```

- If shipping macOS, confirm the notarization keychain profile is available:

```sh
xcrun notarytool history --keychain-profile "crewdock-notary"
```

- If shipping Windows, confirm the Authenticode certificate and timestamping
  plan are available before building.

## Validation

- Run `npm run check`.
- Run `env CARGO_TARGET_DIR=/tmp/crewdock-cargo-target cargo test --manifest-path src-tauri/Cargo.toml`.
- Smoke-test the app on each target OS before release:
  - workspace creation
  - pane split / maximize / close
  - file explorer
  - built-in editor save flow
  - source control drawer
  - Codex session start / resume
  - in-app update prompt opens the correct platform asset
- For Windows, confirm the install target either already has WebView2 or has
  outbound network access because the installer is configured to use the
  WebView2 `downloadBootstrapper`.

## Build

### Windows

- Preferred: run the GitHub Actions workflow at
  `.github/workflows/windows-build.yml` and download the uploaded NSIS artifact.
- Local Windows build:

```powershell
npm install
npm run build:windows:nsis
```

- Experimental macOS/Linux cross-build for NSIS only:

```sh
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm run build:windows:nsis:xwin
```

- Verify the installer exists under
  `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.
- Sign the installer with your Windows certificate before upload.
- Verify the signature:

```powershell
Get-AuthenticodeSignature .\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\CrewDock_<version>_x64-setup.exe
```

- Generate a SHA-256 checksum:

```powershell
CertUtil -hashfile .\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\CrewDock_<version>_x64-setup.exe SHA256
```

- Save the checksum into a file named
  `CrewDock_<version>_x64-setup.exe.sha256`.

### macOS

- Build the macOS artifact with `npm run build:mac`.
- The release build signs with the local `Developer ID Application`
  certificate, notarizes the app and DMG, and staples both tickets.
- To use a non-default setup, override:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
APPLE_NOTARY_PROFILE="crewdock-notary" \
npm run build:mac
```

- Verify the generated DMG exists under `src-tauri/target/release/bundle/dmg/`.
- Verify notarization on the finished artifact:

```sh
spctl -a -vv -t open src-tauri/target/release/bundle/dmg/CrewDock_<version>_<arch>.dmg
```

- Generate a SHA-256 checksum:

```sh
shasum -a 256 src-tauri/target/release/bundle/dmg/CrewDock_<version>_<arch>.dmg
```

- Save the checksum into a file named `CrewDock_<version>_<arch>.dmg.sha256`.

## Release

- Commit release-prep changes.
- Tag the release:

```sh
git tag v<version>
git push origin <branch>
git push origin v<version>
```

- Create the GitHub Release with:
  - the Windows `-setup.exe` asset and checksum when shipping Windows
  - the macOS DMG asset and checksum when shipping macOS
  - the release notes from `docs/releases/v<version>.md`
- Example:

```sh
gh release create v<version> \
  src-tauri/target/release/bundle/dmg/CrewDock_<version>_<arch>.dmg \
  src-tauri/target/release/bundle/dmg/CrewDock_<version>_<arch>.dmg.sha256 \
  src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/CrewDock_<version>_x64-setup.exe \
  src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/CrewDock_<version>_x64-setup.exe.sha256 \
  --title "CrewDock v<version>" \
  --notes-file docs/releases/v<version>.md
```

## Post-release

- Smoke-test the in-app update prompt from an older macOS build.
- Smoke-test the in-app update prompt from an older Windows build.
- Confirm the GitHub Release exposes a DMG for macOS and a `-setup.exe` for
  Windows so the in-app download picker resolves correctly.
- Verify the signed Windows installer does not trip avoidable SmartScreen or
  signature warnings.
- Update the landing page download button to point to `releases/latest` or the
  current release asset set.
