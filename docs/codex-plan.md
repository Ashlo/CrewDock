# CrewDock Codex Plan

Status: Draft  
Date: March 17, 2026  
Owner: Product + Engineering  

## Intent

This plan assumes CrewDock is not trying to become a full ADE or IDE
replacement in the near term. The product direction from here is narrower and
stronger: CrewDock should become a workspace-native terminal workbench for
developers who manage multiple local repos, services, and shell contexts at
once.

The core idea is simple:

- terminal-first
- workspace-first
- local-first
- automation-ready

## Scope

### In

- multi-workspace terminal management
- terminal lifecycle quality and reliability
- workspace attention and activity visibility
- richer metadata and restore behavior
- keyboard-first operation
- local automation surfaces

### Out

- Kanban board
- built-in code editor
- enterprise governance features
- multi-agent swarm UX
- terminal engine replacement as a default assumption

## Product Position

CrewDock should feel like the best desktop app for:

- opening several dev workspaces quickly
- seeing which workspace needs attention
- restoring local work reliably
- running repeatable workspace workflows
- moving between repos and services without losing context

It should not try to win by becoming a broad all-in-one platform too early.

## Guiding Principles

1. Terminal infrastructure is part of the product, not background plumbing.
2. Structured metadata should exist alongside raw terminal text.
3. Workspace attention is more valuable than more decorative chrome.
4. Local automation is a better near-term differentiator than task-board UI.
5. Refactor before adding wide feature surface area.

## Phase 1: Substrate and Modularity

Duration: 2 to 4 weeks

### Goals

- reduce coupling in the current monolithic runtime files
- harden PTY lifecycle and restore behavior
- introduce typed events alongside snapshot updates
- add integration coverage around terminal state transitions

### Work

- Split `src-web/app.js` into domain modules such as `bridge`, `store`,
  `terminal`, `workspace`, `launcher`, and `settings`.
- Split `src-tauri/src/lib.rs` into modules such as `app_state`,
  `workspace_manager`, `session_manager`, `persistence`, `launcher_commands`,
  and `events`.
- Introduce a typed event model for pane and workspace state.
- Add a session supervisor responsible for spawn, track, teardown, restart
  policy, and failure classification.
- Add integration tests for split/close churn, switching workspaces during pane
  startup, restore under partial failure, and theme changes on live panes.

### Deliverables

- smaller runtime files with clearer ownership boundaries
- typed backend event definitions
- lifecycle-safe session manager
- first integration test harness for terminal behavior

### Exit Criteria

- pane startup and teardown are measurably more reliable
- new UI features no longer require editing one giant frontend file
- the app exposes enough structured state to build attention features cleanly

## Phase 2: Attention and Operator UX

Duration: 3 to 5 weeks

### Goals

- make concurrent workspace management easier
- make hidden work visible without opening every tab
- improve high-frequency keyboard usage

### Work

- Add workspace attention badges for states such as running, failed, unread
  output, port open, and needs input.
- Add an activity rail or feed with recent pane and workspace events.
- Add pane titles and roles so workspaces can carry semantic meaning beyond
  `Shell 01`.
- Add keyboard shortcuts for pane focus movement, workspace switching, quick
  rename, and command palette actions.
- Add port detection and browser-open actions for local services.
- Expand persistence to include pane titles, roles, lightweight recent
  activity, and selected restore metadata.

### Deliverables

- visible attention system in the workspace strip
- recent activity surface
- richer workspace metadata
- stronger keyboard-first workflow

### Exit Criteria

- users can tell which workspace needs attention at a glance
- restored workspaces feel like ongoing sessions, not just reopened tabs
- CrewDock starts to feel distinct from a plain pane manager

## Phase 3: Automation-Ready Workspaces

Duration: 3 to 5 weeks

### Goals

- make workspaces repeatable
- support programmable workflows without adding heavy orchestration UI
- turn CrewDock into a reliable local operator surface

### Work

- Add workspace profiles such as frontend app, backend API, full-stack repo, or
  custom runbook.
- Add startup actions for panes, including named commands and roles.
- Add a local control API for opening workspaces, splitting panes, sending
  commands, focusing panes, and opening detected URLs.
- Add structured session metadata such as cwd, last command, last active time,
  and startup command status.
- Add command history and run status per pane where feasible.

### Deliverables

- reusable workspace templates
- local automation endpoint
- metadata-rich pane model
- better launch and restore consistency

### Exit Criteria

- a workspace can be opened with useful intent, not only as an empty shell grid
- external tooling can drive CrewDock without scraping UI state
- repeatable local dev workflows become a clear product advantage

## Phase 4: Differentiators

Duration: 4 to 6 weeks

### Goals

- deepen the workbench without broadening it into a full platform
- ship features that compound the value of the first three phases

### Work

- Add command-block awareness or command segmentation where shell integration
  makes that practical.
- Add smarter restore with recent output summaries and last-known activity.
- Add Git-aware metadata such as branch, dirty state, and recent repo context at
  the workspace level.
- Add review-oriented states such as success, failure, and requires-input at the
  session and workspace level.
- Add a lightweight command palette for workspace actions, profiles, and recent
  operations.

### Deliverables

- stronger workspace summaries
- higher quality restore experience
- Git context in the shell workbench
- more actionable command surfaces

### Exit Criteria

- CrewDock is clearly a workspace operating console, not just a shell launcher
- the product has a durable identity without needing a board or IDE surface

## Phase 5: Optional Strategic Extensions

Duration: variable

This phase should start only if the earlier phases are working well.

### Possible Extensions

- lightweight agent launch profiles on top of the local control API
- shared session annotations
- richer audit logs for local history
- terminal engine evaluation if `xterm.js` becomes the real bottleneck

### Rule

Do not start this phase until reliability, metadata, and attention features are
already strong.

## Immediate Next Sprint

1. Create the module boundaries for frontend and backend runtime code.
2. Add a typed event schema for pane lifecycle and workspace attention.
3. Introduce the session supervisor and move PTY lifecycle logic behind it.
4. Add integration tests for pane churn and restore behavior.
5. Ship one visible attention feature in the top workspace strip.

## Success Metrics

- less work lands in giant shared runtime files
- pane lifecycle regressions drop
- workspace switching remains fast under load
- restored workspaces carry more useful context
- users can identify the next workspace needing attention in one glance

## Risks

- Refactoring too slowly and continuing to add features into the current
  monoliths.
- Overbuilding terminal internals before proving workbench UX value.
- Adding heavy orchestration concepts before the attention and automation layers
  are credible.
- Expanding persistence without defining a clear metadata model first.

## Open Questions

- Which workspace states matter most for attention badges in v1:
  unread output, failed process, open port, or needs input?
- How much recent output should be persisted locally without making restore
  heavy or fragile?
- Should the first automation surface be a local HTTP API, a socket, or a CLI
  wrapper over Tauri commands?
