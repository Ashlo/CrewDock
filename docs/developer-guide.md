# CrewDock Developer Guide

This document is for a developer who is opening the repository for the first
time and needs to understand how CrewDock is implemented today.

## What CrewDock Is

CrewDock is a desktop workspace switcher built with:

- A static frontend in `src-web/`
- A Tauri desktop shell in `src-tauri/`
- PTY-backed shell sessions spawned from Rust via `portable-pty`
- `xterm.js` terminals mounted in the frontend

The app model is simple:

1. A workspace is a local folder.
2. A workspace owns one or more panes.
3. Each pane maps to a real shell session once the workspace is started.
4. The frontend renders the active workspace and streams PTY output into
   `xterm.js`.
5. The backend persists workspace metadata so the app can restore state on the
   next launch.

## Repository Layout

```text
src-web/
  app.js              Main frontend runtime and render loop
  activity-rail.js    Activity rail rendering helpers
  bridge.js           Tauri bridge plus browser/mock fallback
  launcher.js         Launcher helpers and layout-picker rendering
  store.js            UI and runtime store factories
  workspace-strip.js  Workspace tab strip rendering helpers
  styles.css          Global app styling
  index.html          Static app shell
  vendor/             Vendored xterm.js assets copied at npm install time

src-tauri/
  src/main.rs         Thin binary entrypoint
  src/lib.rs          Main Tauri runtime, state, commands, helpers, and tests
  src/events.rs       Event names and emit helpers
  src/persistence.rs  Snapshot persistence and runtime activity helpers
  src/session_manager.rs
                      PTY spawn, stream, close, and failure handling
  src/source_control.rs
                      Git status, diffs, branches, graph loading, and Git task helpers
  src/workspace_manager.rs
                      Workspace lifecycle helpers for create, switch, rename, split, and close
  Cargo.toml          Rust dependencies and crate metadata
  tauri.conf.json     Tauri app configuration

docs/
  developer-guide.md  This document
  codex-plan.md       Product and refactor direction notes
```

## Runtime Architecture

### Frontend

The frontend is intentionally lightweight in terms of tooling. There is no
framework build step right now. `src-web/index.html` loads `src-web/app.js`
directly as an ES module.

The key pieces are:

- `app.js`
  Owns app bootstrap, global event handlers, render orchestration, theme
  application, workspace rendering, pane rendering, `xterm.js` lifecycle,
  source control panel rendering, quick switcher behavior, activity rail
  behavior, launcher behavior, drag-and-drop handling, and various
  frontend-only helpers.
- `activity-rail.js`
  Renders the activity feed shown in the footer-driven rail. `app.js` owns the
  surrounding state and interactions.
- `bridge.js`
  Wraps Tauri `invoke` calls and event listeners when running inside the real
  desktop app. It also exposes a mock bridge when the Tauri APIs are missing,
  which is useful for browser-only iteration and fallback behavior.
- `launcher.js`
  Keeps launcher-specific logic out of `app.js`: pane count clamping, derived
  grid sizes, completion display formatting, and the empty-state / workspace
  creation modal markup.
- `store.js`
  Defines two in-memory stores:
  `uiState` for view state and `runtimeStore` for mounted terminal instances,
  buffered output, and timers.
- `workspace-strip.js`
  Renders the workspace tab rail, including rename UI, activity badges, git
  indicators, and the strip controls.

### Backend

The Tauri backend is stateful and command-driven.

- `main.rs`
  Calls `crewdock_lib::run()`.
- `lib.rs`
  Defines the app state, serializable snapshots, Tauri command handlers,
  launcher command execution, pane layout helpers, persistence, git inspection,
  and the `run()` function that wires everything together.
- `persistence.rs`
  Owns JSON serialization, restore logic, and activity event persistence.
- `session_manager.rs`
  Creates PTYs, spawns shells, stores pane writers and masters, streams shell
  output back to the frontend, and marks panes as ready, closed, or failed.
- `source_control.rs`
  Owns repository inspection, diff loading, commit graph and branch listing,
  stage / unstage / discard helpers, AI commit message request building, and
  PTY-backed Git task orchestration.
- `workspace_manager.rs`
  Keeps workspace lifecycle mutations out of `lib.rs`.
- `events.rs`
  Defines the custom Tauri event channels used by the frontend:
  `crewdock://state-changed`, `crewdock://terminal-data`, and
  `crewdock://runtime-event`.

## Startup Flow

On application startup:

1. `src-tauri/src/main.rs` calls `crewdock_lib::run()`.
2. `run()` creates the Tauri builder, registers the dialog plugin, and
   installs `AppState`.
3. During `.setup()`, the backend resolves the persistence path, loads
   `workspaces.json`, restores saved workspaces, and prepares pane launch jobs
   for the active workspace.
4. The backend spawns PTY jobs for that active workspace if one exists.
5. `src-web/app.js` calls `bridge.getAppSnapshot()` inside `init()`.
6. The frontend subscribes to state, terminal-data, and runtime-event streams.
7. `render()` chooses between:
   - the launcher / empty state
   - the active workspace grid
   - modal layers such as settings, the source control drawer, layout picker,
     or quick switcher
   - footer-driven activity views and attention badges

Two important details:

- The frontend treats the backend snapshot as the source of truth for
  workspaces, panes, theme, and active workspace selection.
- The frontend keeps `xterm.js` instances and buffered terminal output in local
  memory so it can remount panes cleanly when the active workspace changes.

## State Model

### Backend State

`RuntimeState` in `src-tauri/src/lib.rs` owns:

- `next_id` for workspace and pane identifiers
- `shell` resolved per platform: PowerShell or `cmd.exe` on Windows, `SHELL`
  or `/bin/zsh` elsewhere
- `launcher` state including layout presets and current base path
- `settings` including theme, interface text scale, terminal font size, and an
  optional stored OpenAI API key
- `workspaces`
- `active_workspace_id`
- `activity_history`
- `sessions` which map pane ids to live PTY session handles
- `git_tasks` for long-running Git commands routed through PTYs
- `persistence_path`

The backend exposes state to the frontend as an `AppSnapshot`.

### Frontend State

`createUiState()` in `src-web/store.js` tracks view-only concerns such as:

- Whether the launcher, settings, git panel, or quick switcher is visible
- Which settings section and source control tab are active
- Pending workspace creation state
- Rename state for workspace tabs
- Runtime activity and attention badges
- Which workspace and layout are currently mounted
- Context menu and maximized pane state

`createRuntimeStore()` tracks imperative runtime objects:

- Mounted `xterm.js` terminals
- Buffered terminal output for remounts
- Pane ids per workspace
- Terminal viewport restore positions
- Launcher and git refresh timers

## Data Flow

The primary data flow is:

1. The user interacts with the frontend.
2. `app.js` calls a method on `bridge.js`.
3. `bridge.js` invokes a Tauri command.
4. The backend mutates `RuntimeState`.
5. The backend emits an updated snapshot.
6. The frontend receives the snapshot and re-renders.

Terminal output is separate from snapshot updates:

1. A PTY session emits shell bytes.
2. `session_manager.rs` sends those bytes over the terminal-data event.
3. `app.js` appends the bytes to the matching `xterm.js` instance and also
   stores them in an in-memory buffer.

Pane lifecycle events are also separate:

1. A pane becomes ready, closes, or fails.
2. The backend emits a runtime event.
3. The frontend records it in runtime activity and workspace attention state.

## Tauri Command Surface

These commands are the main frontend-backend boundary today:

- App and settings:
  `get_app_snapshot`, `reset_to_launcher`, `set_theme`, `set_settings`,
  `set_interface_text_scale`, `set_terminal_font_size`, `set_openai_api_key`
- Workspace and panes:
  `create_workspace`, `rename_workspace`, `switch_workspace`,
  `close_workspace`, `split_pane`, `close_pane`
- Launcher and shell plumbing:
  `run_launcher_command`, `complete_launcher_input`, `write_to_pane`,
  `resize_pane`, `show_in_file_manager`
- Source control:
  `refresh_workspace_git_status`, `load_workspace_source_control`,
  `load_workspace_git_diff`, `load_workspace_git_commit_detail`,
  `git_stage_paths`, `git_unstage_paths`, `git_discard_paths`,
  `generate_git_commit_message`, `git_commit`, `git_checkout_branch`,
  `git_create_branch`, `git_rename_branch`, `git_delete_branch`, `git_fetch`,
  `git_pull`, `git_push`, `git_publish_branch`, `git_set_upstream`,
  `git_task_write_stdin`

If you are adding a feature that changes persisted or runtime state, this is
usually where the implementation starts on the backend.

## Workspace Lifecycle

### Creating a Workspace

1. The user opens the launcher and picks a directory.
2. The frontend stores a pending workspace draft and shows the layout picker.
3. `create_workspace` validates the path and pane count.
4. The backend creates a `WorkspaceRecord` and pane records.
5. `prepare_workspace_launch()` marks the workspace live and all panes as
   booting.
6. `spawn_pane_jobs()` starts one PTY-backed shell per pane.
7. Each pane transitions to `ready` once its shell is attached.

### Switching Workspaces

1. The frontend invokes `switch_workspace`.
2. The backend updates `active_workspace_id`.
3. If the target workspace has not started yet, its panes are prepared and
   launched.
4. The frontend disposes terminals from the old workspace and mounts terminals
   for the new active workspace.

### Splitting and Closing Panes

Pane splits and closes are modeled in both data and UI:

- The backend updates `workspace.panes`.
- The backend updates the recursive `PaneLayout` tree.
- The frontend re-renders the workspace stage from that layout tree.
- If a new pane is added to a live workspace, the backend spawns its PTY
  session immediately.

The current hard cap is 16 panes per workspace.

## Persistence

Workspace persistence is file-based JSON.

- File name: `workspaces.json`
- Resolved via Tauri `app_data_dir()`
- Written from `RuntimeState::persist_to_disk()`
- Restored in `RuntimeState::load_persisted_from_disk()`

Persisted data includes:

- Theme id
- Interface text scale
- Terminal font size
- Stored OpenAI API key
- Workspace path
- Workspace name
- Pane count
- Pane layout tree
- Active workspace selection
- Recent runtime activity associated with persisted workspaces

Live PTY sessions are not persisted. On relaunch, CrewDock restores workspace
metadata and starts fresh shell sessions for the active workspace.

## Terminal Session Management

`src-tauri/src/session_manager.rs` is the critical file for shell behavior.

For each pane launch job it:

- Opens a PTY
- Spawns the configured shell as a login shell
- Sets the working directory to the workspace path
- Injects a few environment variables:
  `TERM`, `COLORTERM`, `CREWDOCK_LAYOUT`, `CREWDOCK_PANE_LABEL`
- Stores the pane writer and master so the frontend can send input and resize
  events
- Streams shell output back to the frontend
- Emits pane-ready, pane-closed, or pane-failed events

The frontend side of that contract lives mostly in:

- `mountWorkspaceTerminals()`
- `appendTerminalData()`
- `fitTerminal()`
- `disposeTerminal()`

all in `src-web/app.js`.

## Launcher Implementation

The launcher is intentionally constrained. It is not a shell. It only supports
directory navigation and workspace opening.

Supported commands:

- `help`
- `pwd`
- `ls`
- `cd`
- `open`
- `clear`

Implementation details:

- Backend command execution lives in `execute_launcher_command()`
- Backend completion lives in `complete_launcher_input_for_base()`
- The backend blocks shell-like chaining and command injection tokens
- Frontend rendering helpers live in `src-web/launcher.js`
- Frontend mock completion and mock navigation logic exist in `app.js` so the
  browser fallback can behave similarly

## Source Control Implementation

Source control is resolved in the backend, not in the frontend.

The flow is:

1. The frontend asks for a refresh via `refresh_workspace_git_status` or a full
   drawer snapshot via `load_workspace_source_control`.
2. `src-tauri/src/source_control.rs` runs Git commands such as:
   - `git rev-parse --show-toplevel`
   - `git status --porcelain=v2 --branch`
   - `git diff`
   - `git for-each-ref`
   - `git log --graph`
   - `git show`
3. The backend parses branch metadata, ahead/behind counts, changed files,
   diff text, branch lists, and graph history into serializable snapshots.
4. The frontend renders:
   - workspace strip git dots
   - footer git summary
   - the detailed source control drawer with Changes, Branches, and Graph tabs

Two extra details matter here:

- Mutating actions such as stage, unstage, discard, commit, fetch, pull, push,
  branch publish, and upstream wiring all go through backend helpers so the
  frontend never shells out directly.
- Long-running Git actions run through PTY-backed Git tasks so the UI can show
  streamed output and prompt for stdin when Git requires it.

The refresh loop is frontend-driven and currently polls the active workspace
every few seconds.

## Themes

Themes are defined in `THEME_REGISTRY` in `src-web/app.js`.

Each theme contains:

- App CSS variable values
- An `xterm.js` terminal theme
- Optional `colorScheme` metadata for light mode behavior

Theme selection is persisted by the backend and re-applied on launch.

Settings currently also persist interface text scale, terminal font size, and a
locally stored OpenAI API key used for AI commit message generation.

## Browser / Mock Mode

`src-web/bridge.js` falls back to a mock implementation when Tauri APIs are not
available.

That mode:

- Simulates workspace creation
- Simulates pane readiness
- Echoes typed terminal input back into the pane
- Supplies mock git data

This is useful when iterating on frontend behavior without running the full
desktop app, but it is not a perfect substitute for real PTY behavior.

## Running the Project

Prerequisites:

- Node.js and npm
- Rust toolchain
- Tauri desktop prerequisites for the local OS

Common commands:

```sh
npm install
npm run check
npm run fmt
npm run dev
```

Notes:

- `npm install` copies `xterm.js` assets into `src-web/vendor/`.
- `npm run dev` runs `cargo tauri dev`.
- There is no separate frontend bundler or dev server at the moment.

## Tests

There are Rust unit tests in `src-tauri/src/lib.rs`.

They currently cover areas such as:

- launcher behavior
- layout derivation
- persistence restoration
- theme parsing
- git status parsing
- Git task flows such as branch rename / delete, publish / fetch / pull, and
  stdin-backed commands
- AI commit message request shaping and OpenAI response extraction

There is not yet a dedicated integration harness for end-to-end UI and PTY
behavior.

## How To Change the App Safely

### If You Are Adding a New Backend Capability

1. Add or extend a Tauri command in `src-tauri/src/lib.rs`.
2. Update `tauri::generate_handler!` in `run()` if needed.
3. Add a bridge method in `src-web/bridge.js`.
4. Call that bridge method from `src-web/app.js`.
5. Decide whether the result belongs in the snapshot, terminal event stream, or
   runtime event stream.
6. Add a Rust test if the behavior is deterministic enough to cover.

### If You Are Adding a New Frontend Surface

1. Decide whether the feature is view-only state or backend-owned state.
2. Add UI-only state in `createUiState()` when it should not be persisted or
   shared with Rust.
3. Keep terminal object management inside `runtimeStore`, not in snapshot data.
4. Reuse the existing render pattern:
   - derive everything from `uiState.snapshot`
   - render into a region
   - remount terminals only when workspace identity or layout changes

### If You Are Changing Pane Layout Behavior

You will likely need to touch both:

- Backend layout helpers in `src-tauri/src/lib.rs`
- Frontend layout helpers in `src-web/app.js`

There is duplicated layout logic because the mock bridge and frontend fallback
still need to construct layouts without Rust.

## Current Technical Constraints

A new contributor should know these constraints up front:

- `src-web/app.js` is still a very large file and owns many concerns.
- `src-tauri/src/lib.rs` is also broad and mixes commands, helpers, git
  parsing, persistence, and tests.
- The launcher only supports directory navigation, not general shell commands.
- Persistence restores metadata, not existing PTY process state.
- `show_in_file_manager` uses the platform file-manager launcher (`open`,
  `explorer`, or `xdg-open`), so behavior still varies a bit by OS.
- Git refresh is polling-based.

These are not accidental. The repo is still in an early-stage, working-spike
shape, and `docs/codex-plan.md` outlines the intended modularization path.

## First Places To Read

If you only have 20 minutes, read these in order:

1. `README.md`
2. `src-tauri/src/lib.rs`
3. `src-tauri/src/session_manager.rs`
4. `src-web/bridge.js`
5. `src-web/app.js`
6. `docs/codex-plan.md`

That sequence will give you the current architecture, the command boundary, the
PTY lifecycle, the frontend integration pattern, and the likely refactor
direction.
