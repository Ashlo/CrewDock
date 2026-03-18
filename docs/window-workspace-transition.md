# Window and Workspace Transition

Status: In progress  
Date: March 18, 2026

## Intent

CrewDock currently behaves like:

`app window = workspace strip = workspace identity`

That is too flat. The product should move toward:

`app -> window -> workspace session -> panes`

This keeps the current single-window app stable while giving us a clean path to
real multi-window support later.

## Scope

- In:
  - introduce an explicit window model in the app snapshot
  - make workspace identity visible inside the stage, not only in the top strip
  - separate window-level chrome from workspace-level session UI
  - keep commands, persistence, and restore behavior stable for now
- Out:
  - true native multi-window creation and routing
  - moving workspaces between native windows
  - per-window persistence files
  - deep pane/workspace automation changes

## Phase 1

### Goal

Create a visible and structural distinction between `window` and `workspace`
without changing the current one-window runtime behavior.

### Deliverables

- `AppSnapshot.window` on the backend and mock bridge
- a window summary in the top chrome
- a workspace session header above the terminal grid
- copy updates that stop flattening everything into “tabs”

## Phase 2

### Goal

Move more operator surfaces to the correct level.

### Deliverables

- workspace-scoped activity, git, and metadata panels
- window-scoped navigation and overview surfaces
- workspace-level keyboard flows that do not depend on the strip alone

## Phase 3

### Goal

Introduce real native multi-window support when the model is already stable.

### Deliverables

- create/open workspace in a new native window
- move or duplicate a workspace into another window
- per-window restore and active workspace tracking

## First Implementation Slice

1. Add a `window` snapshot to the backend.
2. Pass that model through the frontend bridge unchanged.
3. Render a window summary in the top strip.
4. Render a workspace session header inside the workspace stage.
5. Validate that launcher, switching, rename, activity, and pane actions keep working.

## Exit Criteria for This Slice

- the UI has an explicit place for window identity
- the active workspace reads like its own session, not just a selected tab
- current persistence and command behavior remain unchanged
