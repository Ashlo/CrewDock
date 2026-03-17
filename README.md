# CrewDock

CrewDock is a Tauri-based desktop app that launches real shell sessions into
workspace tabs, with each workspace bound to a local project folder and its own
multi-pane terminal grid.

The current implementation includes:

- A top workspace strip with folder-backed tabs
- A gear-driven settings sheet with six built-in whole-app themes
- An empty-state launcher with both `Open workspace` and a small command bar
- A workspace builder that defaults to `1` terminal and can start with any count from `1` to `16`
- PTY-backed shell sessions created by Rust with `portable-pty`
- `xterm.js` rendering in each pane
- Input and resize wiring between the frontend panes and the backend PTY sessions
- Real directional pane splitting so `split right` and `split down` only affect the selected pane
- Launcher command support for `help`, `pwd`, `ls`, `cd`, relative folders, absolute paths, `~`, and `open`
- Local workspace persistence across app relaunches

## Run

Prerequisites:

- Node.js / npm
- Rust toolchain
- macOS system dependencies required by Tauri/WebKit

Commands:

```sh
npm install
npm run check
npm run dev
```

`npm install` is required once to sync the vendored `xterm.js` files into the
static frontend directory. `npm run dev` then launches the native Tauri app.

## Usage

1. Launch the app.
2. Click `Open workspace` or use the launcher command bar.
3. Open settings from the gear button or `Cmd+,` to switch between built-in themes.
4. Create a workspace, then split panes from the context menu as needed.
5. Switch between workspace tabs without tearing down live sessions in the
   current app run.

Useful launcher commands:

- `help`
- `pwd`
- `ls`
- `ls ../another-folder`
- `cd ..`
- `open .`

When the app restarts, CrewDock restores the workspace tab list and active tab.
Only the active restored workspace is started immediately; inactive restored
tabs stay dormant until selected.

## Next steps

1. Tighten PTY lifecycle handling when workspaces are closed or recreated rapidly.
2. Restore scrollback and session metadata more gracefully across relaunches.
3. Add richer workspace controls such as rename, reorder, and keyboard shortcuts.
4. Introduce agent orchestration once the terminal substrate is stable.
