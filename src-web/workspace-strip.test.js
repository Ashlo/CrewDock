import assert from "node:assert/strict";
import test from "node:test";

import { renderWorkspaceSidebar } from "./workspace-strip.js";

function render(showTimeBlockBomb) {
  return renderWorkspaceSidebar({
    workspaces: [],
    activeWorkspaceId: "",
    workspaceRenameDraft: null,
    collapsed: false,
    showTimeBlockBomb,
    escapeHtml: String,
  });
}

test("sidebar only mounts the Time Block bomb while a timer exists", () => {
  assert.match(render(true), /data-time-block-sidebar-bomb/);
  assert.doesNotMatch(render(false), /data-time-block-sidebar-bomb/);
});
