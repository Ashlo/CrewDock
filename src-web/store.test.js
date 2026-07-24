import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSourceControlTask } from "./store.js";

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
