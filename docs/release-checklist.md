# CrewDock Release Checklist

Use this checklist for every public GitHub Release.

## Preflight

- Confirm the worktree is clean with `git status --short`.
- Confirm `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` all carry the same version.
- Decide whether the release is public source or source-available and add a `LICENSE` file before calling it open source.
- Confirm the README matches the shipped product and screenshots.
- Confirm the release notes markdown for the target version exists in `docs/releases/`.

## Validation

- Run `npm run check`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- Launch the app once in dev or release mode and smoke-test:
  - workspace creation
  - pane split / maximize / close
  - file explorer
  - built-in editor save flow
  - source control drawer
  - Codex session resume

## Build

- Build the macOS artifact with `npm run build:mac`.
- Verify the generated DMG exists under `src-tauri/target/release/bundle/dmg/`.
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
  - the DMG asset
  - the checksum file
  - the release notes from `docs/releases/v<version>.md`

```sh
gh release create v<version> \
  src-tauri/target/release/bundle/dmg/CrewDock_<version>_<arch>.dmg \
  src-tauri/target/release/bundle/dmg/CrewDock_<version>_<arch>.dmg.sha256 \
  --title "CrewDock v<version>" \
  --notes-file docs/releases/v<version>.md
```

## Post-release

- Update the landing page download button to point to the latest release asset or `releases/latest`.
- Post the launch announcement with the same screenshot/video set used on the landing page.
- Keep the first update path manual through GitHub Releases until in-app update notifications are implemented.
