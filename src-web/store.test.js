import assert from "node:assert/strict";
import test from "node:test";

import {
  moveTaskBoardTask,
  normalizeTaskBoardTasks,
  reconcileCodexPanePresentation,
  reconcileSourceControlTask,
  resolveTerminalFitViewportLine,
  TERMINAL_VIEWPORT_PINNED_TO_BOTTOM,
} from "./store.js";

test("source-control tasks cannot regress or replace a newer task", () => {
  const running = { id: "task-1", revision: 1, status: "running", startedAt: 10 };
  const progressed = { ...running, revision: 2, output: "new output" };
  const complete = { ...progressed, revision: 3, status: "succeeded", finishedAt: 20 };
  const older = { id: "task-0", status: "running", startedAt: 5 };

  assert.equal(reconcileSourceControlTask(running, complete), complete);
  assert.equal(reconcileSourceControlTask(running, progressed), progressed);
  assert.equal(reconcileSourceControlTask(older, complete), complete);
  assert.equal(reconcileSourceControlTask(complete, running), complete);
});

test("Codex pane presentation binds a detected process to its session title", () => {
  const started = reconcileCodexPanePresentation(null, {
    kind: "start",
    workspaceId: "workspace-1",
    startedAtMs: 100,
    selectLatest: true,
  });
  const bound = reconcileCodexPanePresentation(started, {
    kind: "bound",
    sessionId: "session-1",
    title: "crewdock: restructure the API",
    resolved: true,
  });

  assert.equal(started.startedAtMs, 100);
  assert.equal(started.selectLatest, true);
  assert.equal(bound.sessionId, "session-1");
  assert.equal(bound.title, "crewdock: restructure the API");
  assert.equal(bound.resolved, true);
});

test("task board normalizes stored tasks and constrains status moves", () => {
  const tasks = normalizeTaskBoardTasks([
    { id: "task-1", text: "  Ship Windows build  ", status: "in-progress" },
    { id: "task-1", text: "Write release notes", status: "unknown" },
    { text: "   ", status: "done" },
  ]);

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].text, "Ship Windows build");
  assert.equal(tasks[1].status, "todo");
  assert.notEqual(tasks[0].id, tasks[1].id);
  assert.equal(moveTaskBoardTask(tasks, tasks[0].id, "done")[0].status, "done");
  assert.equal(moveTaskBoardTask(tasks, tasks[0].id, "invalid"), tasks);
});

test("terminal fitting preserves its original viewport target across resize events", () => {
  assert.equal(
    resolveTerminalFitViewportLine(TERMINAL_VIEWPORT_PINNED_TO_BOTTOM, null, 120),
    TERMINAL_VIEWPORT_PINNED_TO_BOTTOM,
  );
  assert.equal(resolveTerminalFitViewportLine(90, 64, 120), 64);
  assert.equal(resolveTerminalFitViewportLine(90, null, 120), 120);
});
