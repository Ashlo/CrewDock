# CrewDock Strategic Analysis and Planning Document

Status: Draft  
Date: March 17, 2026  
Scope: Product strategy, architecture direction, and execution planning for CrewDock

## Purpose

This document consolidates the current findings from reviewing CrewDock alongside two strong reference repos:

- `cmux`: <https://github.com/manaflow-ai/cmux>
- `ghostty`: <https://github.com/ghostty-org/ghostty>

The goal is not to copy either product. The goal is to identify what CrewDock should learn from each one, where the current implementation falls short of the PRD, and what sequence of work will move CrewDock toward a credible agentic development environment.

## Executive Summary

CrewDock is currently a good terminal-workspace MVP, but it is still much closer to a multi-pane shell launcher than to the PRD vision of an agentic development environment.

The comparison is useful in two different ways:

- `cmux` is the better product reference. It treats the terminal as a control surface for agents, metadata, notifications, browser integration, and automation.
- `ghostty` is the better infrastructure reference. It treats terminal quality, performance, correctness, and native behavior as core product value rather than incidental plumbing.

The main conclusion is straightforward:

- CrewDock should stop optimizing primarily for more chrome and small UI additions.
- CrewDock should first build a stronger terminal and orchestration substrate.
- Once that substrate exists, task board, agent swarm, audit trail, and richer workflow features become much easier to ship cleanly.

## Current State Snapshot

### What CrewDock already does well

- Native desktop shell with Tauri.
- Real PTY-backed shell sessions via Rust.
- Multi-workspace tabs with per-workspace folder binding.
- Multi-pane terminal layouts with directional splits.
- Local persistence of workspace list, active workspace, theme, pane count, and pane layout.
- Consistent theme application across app chrome and terminal colors.
- Basic launcher command model for path navigation and workspace opening.

### What the current implementation looks like

CrewDock is implemented as a very small codebase with a small number of large files:

- Frontend runtime: `src-web/app.js`
- Frontend styling: `src-web/styles.css`
- Backend runtime and commands: `src-tauri/src/lib.rs`

This is appropriate for an MVP spike, but it creates scaling pressure quickly. New features now tend to land inside already-large files, which increases coupling across state management, rendering, terminal lifecycle, persistence, and UI behavior.

### Verification status

- `npm run check` passes.
- Rust unit tests exist for selected backend logic.
- There is very limited frontend or end-to-end verification coverage.

## PRD Alignment

The PRD positions CrewDock as a native agentic development environment combining:

- Multi-pane workspaces
- AI agent orchestration
- Task and project management
- Local-first and enterprise-safe operation

The current product substantially covers only the first pillar. The other pillars are mostly still planned rather than implemented.

### PRD capabilities not yet represented strongly in the product

- Agent auto-launch
- Multi-agent swarm behavior
- Inter-agent coordination
- Live swarm activity feed
- Context and prompt injection
- Integrated Kanban board
- Task-to-agent assignment
- Task history and audit log
- Git-linked task execution
- Enterprise auditability and governance

This is the core strategic gap: the PRD is describing an orchestration product, but the current implementation is still mostly a terminal container.

## What CrewDock Should Learn From `cmux`

`cmux` is useful as a reference for product shape and workflow ambition.

### Key lessons

- The terminal should be treated as a control plane, not just a viewport.
- Sessions need metadata, attention states, and automation hooks.
- Browser and local service integration matter in modern AI-assisted development workflows.
- Notifications and status surfaces are first-class, not secondary polish.
- Agent-heavy workflows need structured state, not only raw terminal text.

### What this means for CrewDock

CrewDock should introduce explicit concepts such as:

- agent session
- task run
- workspace attention state
- port opened
- review ready
- requires input
- success or failure outcome

Right now, most of those states would only appear indirectly as terminal output. That is too weak for the product CrewDock wants to become.

### Product-level takeaways

- Add workspace badges and unseen activity indicators.
- Add an activity feed for shells and agents.
- Add port and browser awareness.
- Add local automation endpoints so external tools or internal features can trigger actions without scraping UI state.
- Treat session metadata as durable application state.

## What CrewDock Should Learn From `ghostty`

`ghostty` is useful as a reference for terminal seriousness.

### Key lessons

- Terminal correctness and responsiveness are a product moat.
- Native-platform quality matters.
- Clear architectural boundaries matter.
- Performance discipline matters before the feature surface becomes large.
- A terminal core should be robust enough to embed into richer products.

### What this means for CrewDock

CrewDock currently uses a workable stack:

- Rust
- `portable-pty`
- `xterm.js`
- Tauri event bridge

That is enough for the current MVP, but not enough on its own for a terminal-first ADE unless the surrounding runtime becomes more disciplined.

CrewDock needs:

- stronger PTY lifecycle supervision
- better output handling and buffering
- more structured terminal event capture
- clearer boundaries between terminal engine, session management, and product workflow logic

Longer term, CrewDock should decide whether it wants to:

- remain a Tauri + xterm product with a stronger orchestration layer, or
- embed a more capable terminal core and focus CrewDock on orchestration and workflow

That decision does not need to be made immediately, but the evaluation should be planned.

## Current Gaps

### 1. Product Gap

CrewDock does not yet express its differentiator in the product itself.

Current state:

- Multi-pane shells
- Workspace tabs
- Theme system
- Launcher

Missing differentiator:

- agent-native workflow
- structured task execution
- review surfaces
- orchestration visibility
- auditability

Result:

CrewDock risks feeling like "a nicer terminal multiplexer" instead of "an agentic development environment."

### 2. Architecture Gap

The codebase is still heavily concentrated in a few files.

Current pressure points:

- frontend rendering, state management, keyboard handling, bridge integration, terminal mounting, and launcher logic all live in `src-web/app.js`
- backend commands, state model, persistence, terminal spawning, and utility logic all live in `src-tauri/src/lib.rs`

Result:

- feature work will become slower
- regressions will become harder to isolate
- test coverage will remain coarse
- multiple future contributors will collide in the same files

### 3. Terminal Substrate Gap

CrewDock currently forwards terminal output as string payloads and manages pane sessions directly inside the app state runtime.

What is missing:

- typed session events
- command boundary awareness
- structured notifications
- backpressure strategy
- richer session restart and supervision behavior
- stable metadata model per pane or per agent

Result:

Features like Warp-style command blocks, activity feed, task lifecycle, and audit trail will be awkward and fragile if built on top of raw text alone.

### 4. Persistence Gap

CrewDock persists only minimal workspace state.

Persisted today:

- theme
- workspace path
- pane count
- pane layout
- active workspace selection

Not persisted today:

- scrollback
- session history
- pane titles or roles
- task runs
- agent metadata
- activity history
- audit events

Result:

The current restore behavior is reasonable for an MVP, but not sufficient for a true workbench or ADE.

### 5. Interaction Gap

CrewDock already has a clean interface, but the interaction model is still shallow for high-frequency usage.

Examples of missing or thin areas:

- broad keyboard-first workflow
- command palette depth
- pane focus movement shortcuts
- workspace rename and reorder
- unread activity states
- quick task execution actions
- browser or port actions
- session-level contextual actions beyond pane split and close

Result:

The UI is pleasant, but it does not yet accelerate complex workflows in the way strong terminal products do.

### 6. Quality and Verification Gap

CrewDock has backend unit tests, but it lacks the integration coverage needed for a stateful terminal application.

Missing coverage areas:

- rapid split and close churn
- switching workspaces during pane startup
- restore behavior under partial failure
- output buffering under multi-pane load
- theme switching on live panes
- agent lifecycle orchestration
- task and audit workflows

Result:

As product complexity grows, regressions in lifecycle and state synchronization will become a major risk.

### 7. Enterprise and Governance Gap

The PRD explicitly includes enterprise and security positioning, but the current product has almost none of that foundation in place yet.

Missing groundwork:

- immutable audit trail
- command and file action logging
- permissions model
- team-oriented activity visibility
- governance boundaries

Result:

Enterprise readiness is not a later UI concern. It requires early decisions about event models, persistence, identity boundaries, and what the product records locally.

## Strategic Principles

These principles should guide future planning and implementation:

### 1. Terminal infrastructure is product infrastructure

Do not treat PTY, output streaming, buffering, and lifecycle management as hidden plumbing. They are part of the product’s value.

### 2. Structured events should exist alongside terminal text

Terminal text is necessary, but not sufficient. CrewDock needs explicit application events for agent, task, review, notification, and system-level activity.

### 3. Build orchestration before building a full task board

A task board without strong orchestration and agent visibility will be superficial. A good activity model and control plane should come first.

### 4. Preserve local-first guarantees

CrewDock’s local-first positioning is valuable. Auditability and automation should reinforce that, not weaken it.

### 5. Refactor before feature explosion

If the codebase remains structurally flat while product scope expands, every major feature will become slower and riskier to ship.

## Recommended Initiatives

### Priority 0: Foundation Refactor

Break the monolith into explicit modules.

Suggested frontend boundaries:

- `bridge`
- `store`
- `terminal`
- `workspace`
- `launcher`
- `settings`
- `activity`
- `components`

Suggested backend boundaries:

- `app_state`
- `workspace_manager`
- `session_manager`
- `pty`
- `persistence`
- `launcher_commands`
- `events`
- `testing`

Outcome:

- safer iteration
- easier testing
- clearer ownership

### Priority 0: Typed Event Bus

Introduce structured events emitted by the backend and consumed by the frontend.

Examples:

- `pane.booting`
- `pane.ready`
- `pane.closed`
- `pane.failed`
- `task.started`
- `task.completed`
- `task.failed`
- `agent.waiting_for_input`
- `workspace.attention_changed`
- `port.detected`

Outcome:

- better observability
- foundation for activity feed
- foundation for audit trail
- foundation for task and agent UX

### Priority 0: Session Supervisor

Create a dedicated backend layer for terminal session lifecycle.

Responsibilities:

- spawn
- track
- restart policy
- teardown
- failure classification
- backpressure handling
- richer metadata per session

Outcome:

- fewer lifecycle races
- better failure handling
- cleaner future agent integration

### Priority 1: Attention and Activity Layer

Add product surfaces that make concurrent work manageable.

Examples:

- unread activity badges per workspace
- per-pane or per-agent status chips
- live activity feed
- browser or port detected notifications
- “needs review” and “needs input” states

Outcome:

- moves CrewDock closer to an orchestration product
- improves usability for multi-agent or multi-pane work

### Priority 1: Rich Persistence

Expand persistence beyond layout and tabs.

Examples:

- pane roles
- pane titles
- lightweight scrollback snapshots
- last command metadata
- task history
- activity history

Outcome:

- restarts feel like restoring a workspace, not reopening tabs

### Priority 1: Local Control API

Expose a local automation surface for internal product features and external tooling.

Potential uses:

- run task with context
- open browser for detected local service
- launch an agent role into a pane
- send structured messages to sessions
- trigger review workflows

Outcome:

- cleaner extensibility
- easier future board and agent integration

### Priority 2: Agent-Native Workflow

After the foundation exists, implement the product differentiators from the PRD.

Examples:

- agent launch profiles
- role templates
- context injection
- structured task execution
- mailbox or coordination primitives
- review workflow states

Outcome:

- CrewDock starts behaving like an ADE instead of only a terminal shell

### Priority 2: Task Board Integration

Build the Kanban board only after orchestration and event modeling are credible.

Why:

- otherwise the board becomes a disconnected CRUD layer
- a board is only valuable if it can launch, observe, and audit real work

### Priority 3: Terminal Engine Evaluation

Once the orchestration shell is stronger, evaluate the terminal engine path deliberately.

Questions:

- Is `xterm.js` sufficient once improved with better event modeling and lifecycle handling?
- Is there a strategic advantage in embedding a stronger native terminal core?
- Would such a change actually improve the product more than faster ADE-layer work?

This should be an explicit technical investigation, not a background assumption.

## Proposed Phased Roadmap

### Phase 1: Substrate and Modularity

Duration: 2 to 4 weeks

Goals:

- refactor monolithic frontend and backend files
- add typed event bus
- introduce session supervisor
- strengthen restore and session lifecycle behavior
- add initial integration testing harness

Success criteria:

- codebase split into clear domains
- pane lifecycle coverage improved
- no regressions in current workspace and theming behavior

### Phase 2: Activity and Operator UX

Duration: 3 to 5 weeks

Goals:

- add activity feed
- add workspace attention states
- add richer keyboard workflow
- persist more workspace metadata
- add browser and port awareness

Success criteria:

- concurrent work becomes easier to monitor
- CrewDock feels meaningfully different from a simple pane manager

### Phase 3: Agent and Task Foundation

Duration: 4 to 6 weeks

Goals:

- add agent launch profiles
- add context injection
- add task run model
- add local control API
- add initial task-to-session linkage

Success criteria:

- task execution and agent workflows become first-class product concepts

### Phase 4: PRD Differentiators

Duration: variable

Goals:

- add task board
- add audit trail
- add git-linked task history
- add team or enterprise foundations where appropriate

Success criteria:

- CrewDock clearly expresses its ADE positioning

## 30 / 60 / 90 Day Plan

### 30 Days

- complete architecture refactor
- define event schema
- implement session supervisor
- add integration tests for pane lifecycle and restore

### 60 Days

- ship activity feed and attention model
- ship richer persistence
- improve keyboard workflow
- add browser and port awareness

### 90 Days

- ship agent launch profiles
- ship task run model
- add local control API
- begin task board integration on top of real orchestration state

## Open Decisions

These should be resolved explicitly rather than implicitly through ad hoc implementation:

- Is CrewDock primarily a terminal product with agent features, or an ADE that happens to include a terminal?
- Should the next major investment be on orchestration or on terminal engine sophistication?
- What is the minimum viable audit model needed before agent workflows are broadly introduced?
- How much session history should be persisted locally?
- What local API surface should be considered stable and productized?
- When should enterprise constraints start shaping the event and persistence model?

## Risks

### Risk 1: Feature Accretion Without Architectural Separation

If CrewDock adds task board, agents, and audit features without refactoring the current monoliths, development speed will drop and bug frequency will rise.

### Risk 2: Overbuilding the Terminal Before Proving ADE Value

CrewDock should learn from `ghostty`, but not become distracted by terminal-engine ambition before the orchestration layer is credible.

### Risk 3: Building a Board Before Building Real Workflow State

A task board without strong session, agent, and event models will not deliver the product’s promise.

### Risk 4: Underinvesting in Lifecycle Correctness

Terminal churn, restore, and multi-pane synchronization issues become much more painful once agents are layered on top.

## Success Metrics for This Planning Cycle

These are suggested internal delivery metrics for the next planning window:

- reduce core file concentration by splitting runtime logic into explicit modules
- add integration coverage for pane and workspace lifecycle
- introduce a typed event model with at least pane, task, and system events
- ship at least one visible activity or attention surface
- persist enough metadata that a restored workspace feels durable

## Recommended Immediate Next Step

The most valuable next step is to execute Phase 1 rather than adding more surface features.

Immediate recommendation:

1. Refactor the runtime into domain modules.
2. Introduce a typed event bus.
3. Add a session supervisor and lifecycle tests.
4. Only then begin implementing activity feed, agent launch profiles, and task execution features.

That sequence keeps CrewDock aligned with the PRD while avoiding premature complexity in the wrong layer.

## Source Notes

External references:

- `cmux`: <https://github.com/manaflow-ai/cmux>
- `ghostty`: <https://github.com/ghostty-org/ghostty>
- `ghostty` development documentation: <https://github.com/ghostty-org/ghostty/blob/main/HACKING.md>

Local references:

- PRD: `CrewDock_PRD_v1.0.docx`
- README: `README.md`
- Frontend runtime: `src-web/app.js`
- Frontend styles: `src-web/styles.css`
- Backend runtime: `src-tauri/src/lib.rs`
