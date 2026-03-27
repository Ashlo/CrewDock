# CrewDock Working Reference

This document is a practical, end-to-end explanation of how CrewDock works
today. It is meant to complement `README.md` and `docs/developer-guide.md`
with a single place that explains:

- what CrewDock does from the user point of view
- how the app behaves at startup, during normal use, and at shutdown
- how the frontend and backend cooperate
- how terminals, workspaces, persistence, Git, Codex, todos, activity, and
  settings are implemented

The wording below uses two frames:

- Outer working: what a user sees and how the product behaves
- Internal working: how the codebase and runtime make that behavior happen

## 1. What CrewDock Is

CrewDock is a desktop developer workspace switcher built with:

- a static web frontend in `src-web/`
- a Tauri/Rust backend in `src-tauri/`
- `portable-pty` for real shell sessions
- `xterm.js` for pane terminals

The app model is:

1. A workspace is a real local folder.
2. A workspace owns one or more panes.
3. Each pane maps to a real shell session once the workspace is launched.
4. The frontend renders the active workspace and streams PTY output into the
   correct `xterm.js` instance.
5. The backend persists workspace metadata and settings so the app can restore
   state on relaunch.

## 2. Outer Working

### 2.1 First Launch and Empty State

On first launch, if there is no restored active workspace, CrewDock shows the
launcher/empty state instead of a terminal grid.

The launcher is not a general shell. It is a folder navigation and workspace
opening surface. The user can:

- click `Open workspace` to open a directory picker
- type launcher commands such as `pwd`, `ls`, `cd`, `open`, and `clear`
- use path completion on launcher input

The launcher always operates relative to a current base path. On a fresh
install with no persisted workspaces, that base path comes from the app
process current working directory first, then `HOME`, then `/`.

### 2.2 Creating a Workspace

When a user chooses a directory:

1. CrewDock stores a pending workspace draft in the frontend.
2. A workspace builder / layout picker opens.
3. The user chooses how many panes to start with.
4. The frontend calls `create_workspace`.
5. The backend validates the folder, creates workspace and pane records, marks
   the workspace active, persists it, and prepares pane launch jobs.
6. PTY-backed shell sessions are spawned for the new panes.

The result is a live workspace tied to a real folder.

### 2.3 Workspace Strip

The top strip is the main context switcher. It shows:

- one tab per workspace
- the active workspace
- workspace name and folder identity
- git summary dots
- attention badges for unread lifecycle activity
- inline rename controls
- close controls
- drag-to-reorder behavior

Switching a tab changes the active workspace. Closing a tab removes the
workspace from the app and terminates its live sessions. Reordering changes the
workspace order and persists it.

### 2.4 Live Workspace Screen

Once a workspace is active, the stage renders:

- a pane layout tree
- one shell pane per pane record
- terminal content streamed from the backend
- per-pane chrome such as labels and state

Users can:

- type into panes
- split panes right or down
- maximize or restore a pane
- close a pane
- drag files into panes so the path is inserted
- resize the app and have terminals refit

The current hard cap is 16 panes per workspace.

### 2.5 Launcher While Working

The launcher remains part of the product even after workspaces exist. Its
purpose is still narrow:

- navigate folders relative to the current launcher base path
- list directories
- open new workspaces quickly

It does not allow arbitrary shell execution. It is intentionally constrained to
directory-oriented commands.

### 2.6 Source Control Surface

CrewDock has a built-in source control drawer for the active workspace.

From the user point of view it supports:

- Git summary and status in the chrome
- change lists grouped by file state
- diff viewing
- staged vs working-tree inspection
- commit entry
- AI commit message generation
- branch browsing and search
- branch create, rename, checkout, delete
- fetch, pull, push
- publish branch and set upstream
- commit graph browsing and commit detail inspection
- task output for long-running Git commands

This drawer is workspace-scoped and reflects the repository rooted at or above
the workspace path.

### 2.7 Workspace Todos

Each workspace can store lightweight todos. Users can:

- add a todo
- edit a todo
- mark it done or undone
- delete it
- collapse completed items

Todos are persisted with the workspace rather than being transient UI state.

### 2.8 Codex Integration

CrewDock includes Codex CLI management and session resumption.

From the user view:

- settings can select or override the Codex CLI binary
- the status bar exposes Codex availability
- a Codex modal can list saved sessions associated with the workspace
- a user can choose a target pane
- a saved session can be resumed inside that pane
- a new session can be started inside a ready pane

CrewDock sends shell commands into a live PTY-backed pane; it does not embed
Codex directly inside the frontend.

### 2.9 Activity Rail

CrewDock records pane lifecycle activity and exposes it as a dedicated activity
rail. It shows:

- recent events across workspaces
- unread counts
- workspace attention summaries
- current-workspace filtering
- jump-back actions to the related workspace

The activity model is centered on pane ready, pane closed, and pane failed
events.

### 2.10 Quick Switcher

The quick switcher is an overlay for fast workspace navigation. It lets the
user:

- search across workspaces
- see path and pane-count context
- jump directly to a match

This is a secondary workspace navigation surface in addition to the top strip.

### 2.11 System Health

CrewDock includes a lightweight system health surface powered by `sysinfo`.
It is used for:

- CPU/memory/disk snapshot display
- idle or panel-open refresh loops
- desktop status visibility without opening another tool

### 2.12 Settings and Themes

Settings allow the user to configure:

- app theme
- interface text scale
- terminal font size
- OpenAI API key for commit-message generation
- Codex CLI binary selection

Themes affect both the app chrome and the terminal theme used by `xterm.js`.

### 2.13 Persistence and Relaunch

On relaunch, CrewDock restores:

- workspace list
- workspace names
- pane counts and pane layout trees
- active workspace selection
- todos
- recent activity
- theme and sizing settings
- saved Codex session ids

CrewDock does not restore the original shell processes themselves. It restores
workspace metadata and launches fresh PTY sessions for the active workspace.

## 3. Typical User Flows

### 3.1 Fresh User Flow

1. App opens to the launcher.
2. User chooses a folder.
3. User chooses pane count.
4. Backend creates workspace metadata and launches PTYs.
5. Workspace becomes active and the stage mounts terminals.

### 3.2 Existing User Flow

1. App starts.
2. Backend loads `workspaces.json`.
3. Active workspace is restored from persisted metadata.
4. Pane jobs are prepared for that active workspace.
5. PTY shells are launched.
6. Frontend renders the restored workspace.

### 3.3 Workspace Switching Flow

1. User clicks a workspace tab or quick-switch result.
2. Frontend invokes `switch_workspace`.
3. Backend updates active workspace id and launcher base path.
4. If the workspace was not yet started, PTY jobs are prepared and spawned.
5. Frontend remounts the workspace screen and associated terminals.

### 3.4 Git Task Flow

1. User triggers a Git action from the source control drawer.
2. Frontend invokes a Git command.
3. Backend starts a PTY-backed Git task for the repo root.
4. Runtime task snapshots stream back through runtime events.
5. Frontend updates the drawer task tray.
6. When the task completes, Git state is refreshed and reflected in the next
   source-control snapshot.

## 4. Internal Working

## 4.1 High-Level Architecture

CrewDock has three main runtime layers:

- Frontend UI layer
- Backend state and command layer
- PTY and Git execution layer

The frontend is responsible for view state, rendering, and `xterm.js`
instances. The backend is responsible for authoritative app state, persistence,
Git inspection, and PTY lifecycle. Real shell bytes and Git task output are
streamed through custom Tauri events.

## 4.2 Frontend Working

### Main Frontend Files

- `src-web/index.html`
  Static shell that loads `styles.css` and `app.js`.
- `src-web/app.js`
  Main runtime, event handling, rendering, terminal mount/dispose logic,
  launcher behavior, overlay behavior, status bar, workspace stage, source
  control drawer, todos, Codex modal, system health, quick switcher, activity,
  and render scheduling.
- `src-web/bridge.js`
  Boundary between frontend and backend. It wraps Tauri invocations and also
  provides a browser/mock mode.
- `src-web/store.js`
  Defines two stores: `uiState` and `runtimeStore`.
- `src-web/launcher.js`
  Launcher and layout-picker helpers.
- `src-web/workspace-strip.js`
  Strip/tab rendering helpers.
- `src-web/activity-rail.js`
  Activity rail rendering helpers.
- `src-web/styles.css`
  Global app styling, themes, launcher visuals, strip chrome, overlays, and
  panel styling.

### Frontend State Model

`uiState` holds view-level state such as:

- current snapshot from backend
- modal visibility
- settings draft
- launcher state
- source control local state
- todo panel state
- Codex modal state
- quick switcher state
- system health state
- workspace tab rename and drag state
- runtime activity and unread attention maps

`runtimeStore` holds imperative or mounted runtime objects such as:

- mounted `xterm.js` instances
- buffered terminal output for remounting
- cached workspace screen DOM
- terminal viewport restore positions
- Git/system health timers
- masked render scheduling state and render metrics

### Region-Based Renderer

The frontend mounts a fixed frame with six named regions:

- strip
- stage
- status
- activity
- context
- modal

`render()` does not blindly repaint everything. It uses render masks so that
only the affected regions are flushed when possible. This makes UI-heavy flows
such as todo updates, Codex modal updates, or source-control changes cheaper
than a full redraw.

### Frontend Terminal Handling

The backend never owns frontend `xterm.js` objects. Instead:

- backend sends snapshots and terminal bytes
- frontend mounts `xterm.js` per visible pane
- bytes are appended to the matching terminal
- bytes are also buffered locally so the terminal can remount cleanly after a
  workspace switch
- resize events call back into Rust so the PTY master resizes too

This gives CrewDock a snapshot-driven app model while still preserving terminal
output through frontend remounts.

## 4.3 Backend Working

### Main Backend Files

- `src-tauri/src/main.rs`
  Minimal binary entrypoint.
- `src-tauri/src/lib.rs`
  Main Tauri runtime, app state, serializable snapshots, theme/settings
  helpers, launcher execution, command handlers, layout helpers, system health,
  Git integration wiring, and tests.
- `src-tauri/src/workspace_manager.rs`
  Workspace mutations.
- `src-tauri/src/session_manager.rs`
  PTY creation, shell spawn, output streaming, and pane status transitions.
- `src-tauri/src/persistence.rs`
  `workspaces.json` serialization/restoration and activity persistence.
- `src-tauri/src/source_control.rs`
  Git inspection, diffs, branches, graph loading, AI commit-message prompt
  building, and PTY-backed Git task execution.
- `src-tauri/src/events.rs`
  Custom event names and emit helpers.

### RuntimeState

`RuntimeState` is the backend source of truth. It owns:

- shell path
- launcher snapshot and current base path
- settings
- Codex CLI catalog/selection state
- workspace list
- active workspace id
- persisted activity history
- live PTY sessions keyed by pane id
- live Git tasks keyed by workspace id
- persistence path

The frontend sees a serializable `AppSnapshot`, not the raw runtime structs.

### Tauri Command Surface

The Tauri command layer exposes product behavior to the frontend. Key command
groups are:

- snapshot and startup support
- settings and theme updates
- workspace lifecycle and todos
- launcher command execution and completion
- pane input and resize
- source control reads and writes
- Codex session inspection and resume/start
- system health loading

The frontend talks only to `bridge.js`; `bridge.js` invokes these commands.

## 4.4 Startup Working

Startup happens in this order:

1. `main.rs` calls `run()`.
2. `run()` builds the Tauri app, registers plugins, and installs app state.
3. During `.setup()`, CrewDock resolves the persistence path and loads
   `workspaces.json`.
4. Persisted settings and workspace metadata are restored.
5. If an active workspace exists, `prepare_workspace_launch()` creates pane
   jobs for it.
6. `spawn_pane_jobs()` starts PTY-backed shells for those jobs.
7. Frontend `init()` fetches the current snapshot and subscribes to:
   - `crewdock://state-changed`
   - `crewdock://terminal-data`
   - `crewdock://runtime-event`
8. Frontend renders either launcher or active workspace UI.

The launcher base path on a fresh runtime is seeded from:

1. `env::current_dir()`
2. `HOME`
3. `/`

During restore, if a persisted active workspace exists, the launcher base path
is overwritten with that workspace path.

## 4.5 Workspace Lifecycle Internals

### Workspace Creation

`create_workspace_in_runtime()`:

- canonicalizes and validates the path
- creates a new workspace id
- creates pane records based on the chosen layout preset
- creates or restores a pane layout tree
- pushes the workspace into runtime
- marks it active
- updates launcher base path
- persists the new state
- returns pane jobs to launch

### Workspace Switching

`switch_workspace_in_runtime()`:

- validates the workspace id
- updates `active_workspace_id`
- updates launcher base path to the active workspace path
- prepares PTY jobs if the workspace has not started
- persists the state

### Workspace Closing

Closing a workspace:

- removes it from `runtime.workspaces`
- chooses a fallback active workspace if needed
- kills live pane sessions
- updates launcher base path to the remaining active workspace when possible
- persists the new state

### Workspace Reordering

Workspace reordering is implemented as vector reordering in the backend and is
persisted immediately. The frontend provides drag interaction and previews, but
the backend remains the source of truth for final order.

## 4.6 Pane Layout and Pane Lifecycle Internals

Pane layout is represented as a recursive layout tree rather than a flat grid.
This allows:

- balanced initial layouts
- directional splits
- pane removal with layout repair
- persisted layout restoration

Live pane lifecycle:

1. Backend marks panes booting during `prepare_workspace_launch()`.
2. PTY opens.
3. Login shell is spawned with the workspace path as `cwd`.
4. Pane status becomes ready.
5. Session writer/master are stored in `runtime.sessions`.
6. Output is streamed over terminal-data events.
7. When the shell exits or fails, pane status changes to closed or failed.
8. Activity is recorded and a runtime event is emitted.

Environment variables injected into shells include:

- `TERM=xterm-256color`
- `COLORTERM=truecolor`
- `CREWDOCK_LAYOUT`
- `CREWDOCK_PANE_LABEL`

Tooling-related `npm_*` environment variables are stripped before spawn.

## 4.7 Snapshot and Event Working

CrewDock uses three event channels:

- `crewdock://state-changed`
  Full app snapshot updates
- `crewdock://terminal-data`
  PTY byte stream payloads for a specific pane
- `crewdock://runtime-event`
  Discrete events such as pane ready/closed/failed and Git task snapshots

This split matters:

- snapshots are the durable app state
- terminal bytes are high-frequency stream data
- runtime events are lightweight notifications for attention/activity/task UIs

## 4.8 Persistence Working

Persistence is JSON-based and stored in the Tauri app data directory under
`workspaces.json`.

Persisted data includes:

- theme and UI sizing settings
- stored OpenAI API key
- Codex CLI configured path
- workspace list and names
- workspace paths
- pane counts
- pane layout trees
- workspace todos
- saved Codex session ids
- active workspace selection
- recent runtime activity limited to persisted workspaces

Not persisted:

- live PTY processes
- live PTY output buffers
- mounted terminals
- in-progress frontend-only overlay state

## 4.9 Launcher Working

The launcher command executor lives in the backend. Supported commands are:

- `help`
- `pwd`
- `ls`
- `cd`
- `open`
- `clear`

Behavioral rules:

- blank input is rejected
- only directory navigation is allowed
- shell chaining/injection-like tokens are blocked
- `open` returns an `openPath` so the frontend can turn it into a workspace
  draft
- successful navigation updates `runtime.launcher.base_path`

Completion is also backend-driven. The frontend only displays the result.

## 4.10 Source Control Working

Source control is backend-owned. The backend:

- detects repo root
- runs Git commands
- parses branch, upstream, ahead/behind, file states, diffs, commit graph, and
  commit detail
- returns serializable snapshots

Mutating Git flows come in two categories:

- fast direct helpers such as stage/unstage/discard
- long-running PTY-backed tasks such as commit, fetch, pull, push, publish,
  and branch operations

Git task snapshots carry:

- task title and command
- running/succeeded/failed state
- streamed output
- optional stdin support
- optional recovery metadata

This is what allows the UI to show an interactive task tray instead of firing
blind background commands.

## 4.11 AI Commit Message Working

AI commit message generation is built in `source_control.rs`.

The request flow is:

1. Inspect current repo and workspace scope.
2. Decide whether to summarize staged changes or all pending changes.
3. Collect scoped file list.
4. Generate diff stat and patch excerpt.
5. Build a structured prompt.
6. Use the saved OpenAI API key or `OPENAI_API_KEY`.
7. Call the OpenAI Responses API.
8. Parse a JSON payload containing a single `message` key.

This flow is intentionally prompt-shaped for short imperative Git commit
subjects, with optional short body bullets only when warranted.

## 4.12 Codex Working

CrewDock does not run Codex as a backend-managed subprocess pool. Instead it:

- discovers available Codex CLI binaries
- stores a configured or auto-selected effective binary
- remembers workspace-specific Codex session ids
- injects Codex commands into ready terminal panes

Two main user flows exist:

- resume a remembered session with `codex resume <session> -C <workspace>`
- start a new session with `codex -C <workspace>`

The frontend controls which ready pane receives the command.

## 4.13 System Health Working

System health is backed by a separate `SystemHealthState` that wraps `sysinfo`.
The frontend polls it on two cadences:

- faster when the panel is open
- slower for idle status display

This keeps the footer badge current without forcing constant heavy refreshes.

## 4.14 Browser / Mock Mode Working

If Tauri APIs are not available, `bridge.js` creates a mock bridge instead of
the real invoke bridge.

Mock mode simulates:

- workspace creation
- pane lifecycle
- launcher command behavior
- theme/settings updates
- Git snapshots
- terminal echoing

This is useful for frontend iteration but it is not authoritative for PTY or
true Git behavior.

## 5. Important Code Paths by Concern

### App Shell and Rendering

- `src-web/app.js`
- `src-web/workspace-strip.js`
- `src-web/activity-rail.js`
- `src-web/launcher.js`
- `src-web/styles.css`

### Frontend State and Runtime Objects

- `src-web/store.js`

### Frontend/Backend Boundary

- `src-web/bridge.js`

### Authoritative Backend State and Commands

- `src-tauri/src/lib.rs`

### Workspace Lifecycle

- `src-tauri/src/workspace_manager.rs`

### PTY Sessions

- `src-tauri/src/session_manager.rs`

### Persistence

- `src-tauri/src/persistence.rs`

### Git and AI Commit Generation

- `src-tauri/src/source_control.rs`

### Event Emission

- `src-tauri/src/events.rs`

## 6. Current Constraints and Boundaries

The current implementation is intentionally practical rather than highly
modular. Important constraints:

- `src-web/app.js` still owns many concerns
- `src-tauri/src/lib.rs` still mixes commands, helpers, and tests
- PTY sessions are recreated on relaunch
- launcher is directory-only, not a full shell
- `show_in_finder` currently uses macOS `open`
- Git refresh is frontend-driven and polling-based
- browser/mock mode is useful but not equivalent to desktop runtime behavior

## 7. How To Read the Repo Quickly

If someone needs to understand CrewDock fast, this is the best reading order:

1. `README.md`
2. `docs/developer-guide.md`
3. `docs/crewdock-working-reference.md`
4. `src-tauri/src/lib.rs`
5. `src-tauri/src/session_manager.rs`
6. `src-tauri/src/source_control.rs`
7. `src-web/bridge.js`
8. `src-web/store.js`
9. `src-web/app.js`

## 8. Summary

CrewDock is a folder-backed desktop workspace manager for developers. Its outer
working is a fast workflow for opening folders, booting real shell grids,
switching contexts, staying close to Git, and keeping small productivity
surfaces such as todos, Codex session control, activity, and system health
within the same app shell.

Its internal working is a snapshot-driven Tauri architecture where Rust owns
the authoritative app state, `portable-pty` owns real shell execution, Git is
resolved in the backend, and the frontend focuses on rendering, local view
state, and `xterm.js` mounting.
