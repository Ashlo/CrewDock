# CrewDock

<p align="center">
  A desktop workspace switcher for developers who want real shell sessions,
  fast tabbed context switching, and multi-pane terminal layouts without
  rebuilding their setup every time.
</p>

<p align="center">
  <img src="./docs/images/workspace-explorer-editor.png" alt="CrewDock workspace with docked file explorer, built-in editor, and live terminal" width="100%" />
</p>

<p align="center">
  <img src="./docs/images/appicon.png" alt="CrewDock app icon" width="112" />
</p>

CrewDock is a Tauri app that binds each workspace tab to a real local project
folder, boots PTY-backed shell panes inside that workspace, and keeps the rest
of the working context close: Git, a docked file explorer, a lightweight text
editor, workspace-scoped tasks, and Codex session restore. It is built for the
moment when you are juggling multiple repos, multiple shell layouts, and
multiple contexts, but you still want everything to feel immediate.

## Why CrewDock

- Folder-backed workspace tabs instead of disposable terminal tabs
- Real shell sessions spawned by Rust with `portable-pty`
- Multi-pane grids powered by `xterm.js`
- Fast workspace switching without tearing down the current app-run sessions
- Docked file explorer per workspace with lazy directory loading
- Built-in text editor for workspace files with save, reload, conflict handling, and recovery drafts
- Workspace-scoped task list for next steps and reminders
- Quick switching, activity tracking, and attention badges across workspaces
- Codex session resume with context-aware titles and pane-level restore bindings
- Built-in source control for changes, branches, commit history, and sync
- Built-in launcher commands with path completion for opening and navigating folders quickly
- Themeable desktop chrome plus adjustable interface and terminal sizing
- Local persistence for tabs, layouts, active workspace, theme, sizing, and AI settings

## Latest Workflow

The current build already supports the core loop inside one workspace:

- browse the repo from the docked explorer
- open and edit text files without leaving the terminal workspace
- recover unsaved drafts after restart
- jump from source control directly into the editor or reveal the file in the explorer
- resume Codex sessions back into the right pane after relaunch

## Product Tour

<table>
  <tr>
    <td width="50%">
      <img src="./docs/images/light-theme-empty-state.png" alt="CrewDock empty state and launcher" width="100%" />
      <p><strong>Launcher</strong><br/>Start from a folder picker or use the command bar to navigate and open a workspace.</p>
    </td>
    <td width="50%">
      <img src="./docs/images/light-theme-create-modal.png" alt="CrewDock workspace creation modal" width="100%" />
      <p><strong>Workspace Builder</strong><br/>Choose how many terminals to boot up front, from a single shell to a dense grid.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./docs/images/light-theme-terminal-fixed.png" alt="CrewDock workspace with terminal panes" width="100%" />
      <p><strong>Live Terminal Grid</strong><br/>Work inside real shell panes, split them directionally, and keep the layout tied to that workspace.</p>
    </td>
    <td width="50%">
      <img src="./docs/images/light-theme-settings.png" alt="CrewDock theme settings" width="100%" />
      <p><strong>Theme Switcher</strong><br/>Swap the whole application chrome between built-in themes without losing workspace state.</p>
    </td>
  </tr>
</table>

<p align="center">
  <img src="./docs/images/dark-default.png" alt="CrewDock dark theme workspace view" width="100%" />
</p>

## Workflow

```mermaid
flowchart LR
    A[Choose or navigate to a folder] --> B[Create workspace]
    B --> C[Boot 1 to 16 shell panes]
    C --> D[Split, close, and arrange panes]
    D --> E[Switch between workspace tabs]
    E --> F[Restore tabs and theme on relaunch]
```

## Architecture

```mermaid
flowchart TD
    UI[Static frontend in src-web] --> XTerm[xterm.js terminals]
    UI --> Bridge[Tauri invoke bridge]
    Bridge --> Rust[Rust application runtime]
    Rust --> PTY[portable-pty shell sessions]
    Rust --> Persist[JSON persistence]
    Persist --> Relaunch[Restore workspaces on next launch]
```

## Current Capabilities

- Top workspace strip with folder-backed tabs, rename actions, git state, unread activity badges, and unsaved editor draft indicators
- Inline workspace rename in the tab bar
- Workspace creation flow with launcher-based navigation, path completion, and 1 to 16 starting terminals
- Real directional pane splitting, pane maximize / restore, and pane close actions
- Per-pane shell input, resize wiring, and file-drop path insertion
- Docked file explorer with lazy folder expansion and per-workspace state
- Built-in text editor with save, reload, conflict detection, and recovery drafts
- Workspace task list with open / completed tracking
- Codex session picker with context-derived titles and pane-level auto-restore
- Source control drawer with staged / modified / untracked / conflicted sections, diff preview, commit entry, branch actions, commit graph history, and direct open-in-editor / reveal-in-explorer actions
- Git actions for stage, unstage, discard, commit, commit-all, fetch, pull, push, publish, upstream wiring, and branch management
- AI-assisted commit message generation using a saved key or `OPENAI_API_KEY`
- Quick switcher and activity rail for moving between busy workspaces
- Settings for theme, interface text scale, terminal font size, and OpenAI API key storage
- Local persistence across app relaunches for workspaces, pane layouts, active workspace, settings, recent activity, workspace tasks, file recovery drafts, and Codex restore bindings
- Six built-in themes

## Getting Started

### Prerequisites

- Node.js and npm
- Rust toolchain
- macOS system dependencies required by Tauri/WebKit

### Run locally

```sh
npm install
npm run check
npm run dev
```

`npm install` syncs the vendored `xterm.js` assets into `src-web/vendor`.
`npm run dev` then launches the native Tauri app.

## Using CrewDock

1. Launch the app.
2. Click `Open workspace` or use the launcher command bar.
3. Pick a folder and choose the starting terminal count.
4. Switch workspaces from the top strip as you move between repos.
5. Rename a workspace directly from the top bar when the default folder name is not enough.
6. Open `Files` to browse the repo tree, then open a text file into the built-in editor.
7. Use the pane context menu or keyboard shortcuts to split, maximize, or close panes.
8. Open source control with the footer action or `Cmd/Ctrl+Shift+G` to review diffs, branches, commit history, or jump directly into the editor.
9. Use `Tasks` to keep workspace-specific next steps visible.
10. Use `Codex` to resume the right session back into the right pane.
11. Use `Cmd/Ctrl+K` to quick-switch workspaces and `Cmd/Ctrl+Shift+A` to review unread activity.
12. Open settings with the gear icon or `Cmd/Ctrl+,` to switch themes, adjust sizing, and manage the local OpenAI key used for AI commit messages.

## Launcher Commands

| Command | What it does |
| --- | --- |
| `help` | Show supported launcher commands |
| `pwd` | Print the current launcher base path |
| `ls` | List the current folder |
| `ls ../another-folder` | List a different folder without switching into it |
| `cd ..` | Move the launcher base path |
| `open .` | Create a workspace from the current launcher path |
| `clear` | Clear launcher output and command history from the current session |

`Tab` completion is supported in the launcher for path-aware commands such as
`ls`, `cd`, and `open`.

## Keyboard Shortcuts

| Shortcut | What it does |
| --- | --- |
| `Cmd/Ctrl+,` | Open settings |
| `Cmd/Ctrl+K` | Open the quick switcher |
| `Cmd/Ctrl+Shift+G` | Open source control for the active workspace |
| `Cmd/Ctrl+Shift+A` | Toggle the activity rail |
| `Tab` | Complete launcher paths |
| `Cmd/Ctrl+D` | Split the active pane to the right |
| `Cmd/Ctrl+Shift+D` | Split the active pane downward |
| `Cmd/Ctrl+Shift+Enter` | Maximize or restore the active pane |
| `Cmd/Ctrl+W` | Close the active pane |
| `Esc` | Dismiss overlays, drawers, and inline rename state |

## Source Control

CrewDock's source control drawer is deeper than a simple status badge. The
current implementation includes:

- Change lists grouped by staged, modified, untracked, and conflicted files
- Read-only diff previews for working tree and staged states
- Open-in-editor and reveal-in-explorer actions for changed files
- Commit entry with `Commit`, `Commit All`, and AI-assisted message generation
- Branch search plus create, checkout, rename, delete, publish, and upstream actions
- Commit graph browsing with detail inspection, ref labels, and branch-from-commit actions
- Fetch, pull, and push controls that run through PTY-backed Git tasks

## Editing and Recovery

CrewDock now ships with a lightweight built-in editor for workspace files. V1
is intentionally narrow and terminal-friendly:

- text-file editing only
- explicit save / reload actions plus `Cmd/Ctrl+S`
- external-change conflict detection before overwrite
- recovery drafts persisted per workspace so unsaved work can come back after relaunch
- explorer and source control handoff so navigation and editing stay in one workspace surface

## Project Layout

```text
src-web/    Frontend UI, layout rendering, workspace strip, themes, xterm mounting
src-tauri/  Rust backend, PTY lifecycle, persistence, Tauri commands
```

## Developer Docs

If you are new to the codebase, start here:

- [`docs/developer-guide.md`](./docs/developer-guide.md) for architecture, state
  flow, persistence, PTY lifecycle, and the main places to edit when adding
  features
- [`docs/codex-plan.md`](./docs/codex-plan.md) for the current refactor and
  product direction notes

## Status

CrewDock is still early-stage, but the core interaction model is already in
place: open folder, create workspace, split panes, switch contexts, and come
back to the same setup later.

Current areas to push next:

1. Tighten native QA and polish around the editor / explorer / source control workflow.
2. Restore scrollback and session metadata more gracefully across relaunches.
3. Add richer editor ergonomics without turning CrewDock into a full IDE shell.
4. Expand workspace reordering, keyboard shortcuts, and external-app handoff.

## Open Source

CrewDock is being shaped as an open source developer tool. Issues, design
feedback, and pull requests are all useful, especially around terminal UX,
workspace management, and persistence behavior.
