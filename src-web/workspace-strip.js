export function renderWorkspaceStrip({
  windowSummary,
  workspaces,
  activeWorkspaceId,
  workspaceRenameDraft,
  workspaceOpenControlHtml,
  workspaceGitControlHtml,
  timeBlockControlHtml,
  getWorkspaceAttention,
  hasWorkspaceFileDraftIndicator,
  getWorkspaceFileDraftIndicatorTitle,
  escapeHtml,
  getGitTone,
  formatGitBadgeTitle,
}) {
  const tabLabels = buildWorkspaceTabLabels(workspaces);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null;
  return `
    <div class="workspace-strip-track" data-tauri-drag-region>
      <div class="workspace-strip-leading" data-tauri-drag-region aria-hidden="true"></div>
      ${renderWindowSummary(windowSummary, workspaces.length, escapeHtml)}
      ${renderActiveWorkspaceCrumb(activeWorkspace, tabLabels, escapeHtml)}
      <div class="workspace-strip-actions">
        ${timeBlockControlHtml || ""}
        ${workspaceOpenControlHtml || ""}
        ${workspaceGitControlHtml || ""}
        <button
          class="workspace-strip-button workspace-settings-button"
          data-tauri-drag-region="false"
          data-action="show-settings"
          aria-label="Open settings"
          title="Settings"
        >
          ${renderSettingsIcon()}
        </button>
        <button
          class="workspace-add"
          data-tauri-drag-region="false"
          data-action="show-launcher"
          aria-label="New workspace"
          title="New workspace"
        >
          ${renderPlusIcon()}
        </button>
      </div>
    </div>
  `;
}

export function renderWorkspaceSidebar({
  workspaces,
  activeWorkspaceId,
  workspaceRenameDraft,
  collapsed,
  showTimeBlockBomb,
  getWorkspaceAttention,
  hasWorkspaceFileDraftIndicator,
  getWorkspaceFileDraftIndicatorTitle,
  escapeHtml,
  getGitTone,
  formatGitBadgeTitle,
}) {
  const tabLabels = buildWorkspaceTabLabels(workspaces);
  return `
    <nav
      class="workspace-sidebar ${collapsed ? "is-collapsed" : ""}"
      aria-label="Workspaces"
      data-workspace-sidebar
    >
      <div class="workspace-sidebar-header">
        <div class="workspace-sidebar-heading">
          <span>Workspaces</span>
          <strong>${escapeHtml(String(workspaces.length))}</strong>
        </div>
        <button
          class="workspace-sidebar-toggle"
          type="button"
          data-action="toggle-workspace-sidebar"
          aria-label="${collapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}"
          title="${collapsed ? "Expand sidebar" : "Collapse sidebar"}"
          aria-expanded="${collapsed ? "false" : "true"}"
        >
          ${renderSidebarToggleIcon()}
        </button>
      </div>
      <div
        class="workspace-tabs-shell workspace-sidebar-tabs-shell"
        data-workspace-tabs-shell
        data-workspace-tabs-orientation="vertical"
      >
        <div class="workspace-tabs-viewport" data-workspace-tabs-viewport>
          <div
            class="workspace-tabs workspace-sidebar-tabs"
            data-workspace-tabs
            data-workspace-tabs-orientation="vertical"
          >
            ${
              workspaces.length
                ? renderWorkspaceTabs({
                    workspaces,
                    activeWorkspaceId,
                    workspaceRenameDraft,
                    tabLabels,
                    getWorkspaceAttention,
                    hasWorkspaceFileDraftIndicator,
                    getWorkspaceFileDraftIndicatorTitle,
                    escapeHtml,
                    getGitTone,
                    formatGitBadgeTitle,
                  })
                : '<span class="workspace-tabs-empty">No workspaces</span>'
            }
            <div class="workspace-tab-drop-indicator" data-workspace-tab-drop-indicator aria-hidden="true"></div>
          </div>
        </div>
      </div>
      ${showTimeBlockBomb ? renderTimeBlockBomb() : ""}
      <button
        class="workspace-sidebar-new"
        type="button"
        data-action="show-launcher"
        aria-label="New workspace"
        title="New workspace"
      >
        ${renderPlusIcon()}
        <span>New workspace</span>
      </button>
    </nav>
  `;
}

function renderTimeBlockBomb() {
  return `
    <button
      class="workspace-time-block-bomb"
      type="button"
      data-action="toggle-time-block-popover"
      data-time-block-sidebar-bomb
      aria-label="Open Time Block"
      title="Open Time Block"
    >
      <span class="workspace-time-block-bomb-stage" aria-hidden="true">
        <span class="workspace-time-block-bomb-visual">
          <span class="workspace-time-block-bomb-fuse"></span>
          <span class="workspace-time-block-bomb-spark"></span>
          <span class="workspace-time-block-bomb-shell">
            <span class="workspace-time-block-bomb-clock" data-time-block-bomb-clock>0:00</span>
          </span>
        </span>
        <span class="workspace-time-block-bomb-blast">
          <strong>BOOM</strong>
          <i></i><i></i><i></i><i></i><i></i><i></i>
        </span>
      </span>
      <span class="workspace-time-block-bomb-task" data-time-block-bomb-task>Focus block</span>
    </button>
  `;
}

export const WORKSPACE_COMPANIONS = Object.freeze([
  {
    id: "sailor-tanuki",
    label: "Sailor Tanuki",
    copy: "The original CrewDock deckhand.",
  },
  {
    id: "kissa-cat",
    label: "Kissa Cat",
    copy: "A quiet café cat in a work apron.",
  },
  {
    id: "moon-fox",
    label: "Moon Fox",
    copy: "A night fox with a soft indigo scarf.",
  },
  {
    id: "shih-tzu",
    label: "Shih Tzu",
    copy: "A fluffy little dock dog with a bandana.",
  },
  {
    id: "off",
    label: "Off",
    copy: "Keep the terminal stage completely still.",
  },
]);

export function normalizeWorkspaceCompanionId(value) {
  return WORKSPACE_COMPANIONS.some((companion) => companion.id === value)
    ? value
    : "sailor-tanuki";
}

export function getNextWorkspaceCompanionState(currentState, randomValue = Math.random()) {
  const value = Math.max(0, Math.min(0.999, Number(randomValue) || 0));
  if (currentState === "walking") {
    return value < 0.65 ? "sleeping" : "eating";
  }
  if (currentState === "eating") {
    return value < 0.6 ? "sleeping" : "walking";
  }
  return value < 0.45 ? "eating" : "walking";
}

export function renderWorkspaceCompanionScene(companionId = "sailor-tanuki") {
  const normalizedId = normalizeWorkspaceCompanionId(companionId);
  if (normalizedId === "off") {
    return "";
  }

  return `
    <div class="workspace-companion-home" aria-hidden="true">
      <svg viewBox="0 0 112 58" role="presentation">
        <ellipse class="workspace-companion-bed-shadow" cx="56" cy="53" rx="46" ry="3"></ellipse>
        <path class="workspace-companion-bed-frame" d="M9 38c0-7 6-12 13-12h70c7 0 12 5 12 12v13H9z"></path>
        <path class="workspace-companion-bed-cushion" d="M14 35c4-8 12-11 22-10h51c7 0 12 4 13 10z"></path>
        <path class="workspace-companion-bed-pillow" d="M18 29c2-8 15-10 24-3l-2 10H17z"></path>
        <path class="workspace-companion-bed-blanket" d="M42 28h45c8 0 13 5 13 12H39z"></path>
      </svg>
    </div>
    <div class="workspace-companion-bowl" aria-hidden="true">
      <svg viewBox="0 0 42 28" role="presentation">
        <ellipse class="workspace-companion-bowl-shadow" cx="21" cy="25" rx="17" ry="2"></ellipse>
        <path class="workspace-companion-bowl-rim" d="M4 8h34l-4 14H8z"></path>
        <ellipse class="workspace-companion-bowl-food" cx="21" cy="8" rx="15" ry="5"></ellipse>
      </svg>
    </div>
    <span class="workspace-companion-sleep-mark" aria-hidden="true">z z</span>
    ${renderWorkspaceCompanion(normalizedId)}
  `;
}

export function renderWorkspaceCompanion(companionId = "sailor-tanuki") {
  const normalizedId = normalizeWorkspaceCompanionId(companionId);
  if (normalizedId === "off") {
    return "";
  }

  const svg = normalizedId === "kissa-cat"
    ? renderKissaCat()
    : normalizedId === "moon-fox"
      ? renderMoonFox()
      : normalizedId === "shih-tzu"
        ? renderShihTzu()
        : renderSailorTanuki();

  return `
    <div
      class="workspace-companion is-${normalizedId}"
      data-workspace-companion-id="${normalizedId}"
      aria-hidden="true"
    >
      ${svg}
    </div>
  `;
}

function renderSailorTanuki() {
  return `
    <svg viewBox="0 0 96 68" role="presentation">
      <ellipse class="workspace-companion-shadow" cx="48" cy="62" rx="26" ry="3"></ellipse>
      <g class="workspace-companion-tail">
        <path d="M31 47c-15-9-21 1-14 10 5 7 16 4 20-1-8 1-13-2-12-5 1-3 4-3 8-1z"></path>
        <path class="workspace-companion-tail-tip" d="M20 48c-7 2-7 8-1 11 3 1 7 0 10-2-7 0-11-3-9-9z"></path>
      </g>
      <g class="workspace-companion-body">
        ${renderCompanionLegs()}
        <path class="workspace-companion-jacket" d="M34 36c3-6 8-9 14-9s11 3 14 9l3 21H31z"></path>
        <path class="workspace-companion-collar" d="m36 33 12 9 12-9-4-4-8 7-8-7z"></path>
        <path class="workspace-companion-neckerchief" d="m45 38 3 4 3-4 2 12-5 5-5-5z"></path>
        ${renderCompanionArms()}
        <g class="workspace-companion-head">
          <path class="workspace-companion-ear" d="M34 17 37 5l11 10z"></path>
          <path class="workspace-companion-ear" d="m62 17-3-12-11 10z"></path>
          <circle class="workspace-companion-face" cx="49" cy="23" r="17"></circle>
          <path class="workspace-companion-cap" d="M34 12c4-7 25-7 30 0l-3 5c-8-3-16-3-24 0z"></path>
          <path class="workspace-companion-cap-band" d="M36 14c8-3 18-3 26 0l-1 4c-8-3-16-3-24 0z"></path>
          <path class="workspace-companion-cap-brim" d="M33 17c10-3 22-3 32 0-8 4-24 4-32 0z"></path>
          <path class="workspace-companion-mask" d="M47 17c5-5 12-2 15 4-1 5-5 8-10 7-5-1-8-6-5-11z"></path>
          <ellipse class="workspace-companion-muzzle" cx="62" cy="28" rx="9" ry="6"></ellipse>
          ${renderCompanionProfileFace()}
        </g>
      </g>
    </svg>
  `;
}

function renderKissaCat() {
  return `
    <svg viewBox="0 0 96 68" role="presentation">
      <ellipse class="workspace-companion-shadow" cx="48" cy="62" rx="25" ry="3"></ellipse>
      <g class="workspace-companion-tail">
        <path class="workspace-companion-cat-tail" d="M34 52c-16 8-22-2-16-9 4-5 10-3 9 2-1 3-4 3-6 2 2 5 9 6 15 1z"></path>
      </g>
      <g class="workspace-companion-body">
        ${renderCompanionLegs()}
        <path class="workspace-companion-cat-shirt" d="M35 36c3-6 8-9 14-9s11 3 14 9l2 21H32z"></path>
        <path class="workspace-companion-cat-apron" d="M39 35h19l4 22H35z"></path>
        <path class="workspace-companion-cat-pocket" d="M42 47h13v7H42z"></path>
        ${renderCompanionArms()}
        <g class="workspace-companion-head">
          <path class="workspace-companion-cat-ear" d="m34 17 2-14 12 11z"></path>
          <path class="workspace-companion-cat-ear" d="m62 17-3-14-11 11z"></path>
          <circle class="workspace-companion-face" cx="49" cy="23" r="17"></circle>
          <ellipse class="workspace-companion-muzzle" cx="62" cy="28" rx="9" ry="6"></ellipse>
          ${renderCompanionProfileFace()}
          <path class="workspace-companion-whisker" d="m63 27 11-2m-11 5 12 1"></path>
        </g>
      </g>
    </svg>
  `;
}

function renderMoonFox() {
  return `
    <svg viewBox="0 0 96 68" role="presentation">
      <ellipse class="workspace-companion-shadow" cx="48" cy="62" rx="27" ry="3"></ellipse>
      <g class="workspace-companion-tail">
        <path class="workspace-companion-fox-tail" d="M36 51C20 37 5 43 11 55c5 10 18 7 28 1-9 1-15-2-16-6 4 1 8 3 13 1z"></path>
        <path class="workspace-companion-fox-tail-tip" d="M12 53c4 8 13 7 21 4-7 0-11-3-12-7-3 0-6 1-9 3z"></path>
      </g>
      <g class="workspace-companion-body">
        ${renderCompanionLegs()}
        <path class="workspace-companion-fox-coat" d="M35 36c3-6 8-9 14-9s11 3 14 9l2 21H32z"></path>
        <path class="workspace-companion-fox-scarf" d="M35 32c8 5 18 5 27 0l-2 7c-8 3-15 3-23 0z"></path>
        <path class="workspace-companion-fox-scarf-tail" d="m39 37 8 3-6 15-5-3z"></path>
        ${renderCompanionArms()}
        <g class="workspace-companion-head">
          <path class="workspace-companion-fox-ear" d="m33 18 5-16 11 13z"></path>
          <path class="workspace-companion-fox-ear" d="m60 16-1-14-10 13z"></path>
          <circle class="workspace-companion-face" cx="49" cy="23" r="17"></circle>
          <path class="workspace-companion-fox-cheek" d="M38 30c7 5 17 5 23-1l-3 8c-8 5-16 3-20-7z"></path>
          <path class="workspace-companion-fox-muzzle" d="M55 24c8-3 15 0 18 4-4 6-12 7-18 3z"></path>
          ${renderCompanionProfileFace()}
        </g>
      </g>
    </svg>
  `;
}

function renderShihTzu() {
  return `
    <svg viewBox="0 0 96 68" role="presentation">
      <ellipse class="workspace-companion-shadow" cx="48" cy="62" rx="27" ry="3"></ellipse>
      <g class="workspace-companion-tail">
        <path class="workspace-companion-dog-tail" d="M36 51c-13 2-20-5-16-12 3-5 10-4 11 1 1 4-3 6-6 4 2 5 7 7 13 5z"></path>
      </g>
      <g class="workspace-companion-body">
        ${renderCompanionLegs()}
        <path class="workspace-companion-dog-coat" d="M33 37c3-8 9-11 16-10 8 0 14 4 16 12l1 18H31z"></path>
        <path class="workspace-companion-dog-bandana" d="M36 32c8 5 18 5 26 0l-2 8c-8 3-15 3-22 0z"></path>
        <path class="workspace-companion-dog-bandana-tail" d="m42 38 7 3-5 13-5-3z"></path>
        ${renderCompanionArms()}
        <g class="workspace-companion-head">
          <path class="workspace-companion-dog-ear" d="M34 14c-5 5-5 17 2 22l9-17z"></path>
          <circle class="workspace-companion-face" cx="49" cy="23" r="17"></circle>
          <path class="workspace-companion-dog-patch" d="M45 8c8-4 17 2 18 10-3-3-8-4-13-1z"></path>
          <path class="workspace-companion-dog-tuft" d="M38 10c3-8 7-9 10-3 3-7 8-5 8 2-5-2-12-1-18 1z"></path>
          <ellipse class="workspace-companion-dog-muzzle" cx="62" cy="28" rx="10" ry="7"></ellipse>
          ${renderCompanionProfileFace()}
        </g>
      </g>
    </svg>
  `;
}

function renderCompanionLegs() {
  return `
    <path class="workspace-companion-leg is-left" d="M39 52h8v10h-9c-2 0-3-2-2-4z"></path>
    <path class="workspace-companion-leg is-right" d="M51 52h8l3 6c1 2 0 4-2 4h-9z"></path>
  `;
}

function renderCompanionArms() {
  return `
    <g class="workspace-companion-arm is-left">
      <path d="M36 38c-5 1-9 5-10 10-1 3 4 5 6 2l7-8z"></path>
      <circle cx="27" cy="50" r="3"></circle>
    </g>
    <g class="workspace-companion-arm is-right">
      <path d="M60 38c5 1 9 5 10 10 1 3-4 5-6 2l-7-8z"></path>
      <circle cx="69" cy="50" r="3"></circle>
    </g>
  `;
}

function renderCompanionProfileFace() {
  return `
    <circle class="workspace-companion-eye" cx="55" cy="20" r="1.7"></circle>
    <circle class="workspace-companion-nose" cx="69" cy="27" r="2.4"></circle>
    <path class="workspace-companion-smile" d="M61 31c3 2 6 1 8-1"></path>
  `;
}

function renderActiveWorkspaceCrumb(activeWorkspace, tabLabels, escapeHtml) {
  if (!activeWorkspace) {
    return `
      <div class="workspace-strip-current" data-tauri-drag-region>
        <span>No workspace selected</span>
      </div>
    `;
  }

  const label = tabLabels.get(activeWorkspace.id) || activeWorkspace.name;
  return `
    <div class="workspace-strip-current" data-tauri-drag-region title="${escapeHtml(activeWorkspace.path)}">
      <span class="workspace-strip-current-dot ${activeWorkspace.isLive ? "is-live" : "is-idle"}" aria-hidden="true"></span>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(activeWorkspace.path)}</span>
    </div>
  `;
}

function renderWorkspaceTabs({
  workspaces,
  activeWorkspaceId,
  workspaceRenameDraft,
  tabLabels,
  getWorkspaceAttention,
  hasWorkspaceFileDraftIndicator,
  getWorkspaceFileDraftIndicatorTitle,
  escapeHtml,
  getGitTone,
  formatGitBadgeTitle,
}) {
  return workspaces
    .map((workspace, index) =>
      renderWorkspaceTab({
        workspace,
        activeWorkspaceId,
        label: tabLabels.get(workspace.id) || workspace.name,
        workspaceRenameDraft,
        attention: getWorkspaceAttention(workspace.id),
        hasFileDraft: hasWorkspaceFileDraftIndicator(workspace.id, workspace),
        fileDraftTitle: getWorkspaceFileDraftIndicatorTitle(workspace.id, workspace),
        renderIndex: index,
        escapeHtml,
        getGitTone,
        formatGitBadgeTitle,
      }))
    .join("");
}

function renderWindowSummary(windowSummary, workspaceCount, escapeHtml) {
  const label = windowSummary?.label || "Primary";
  const title = windowSummary?.title || "CrewDock";
  const count = typeof windowSummary?.workspaceCount === "number"
    ? windowSummary.workspaceCount
    : workspaceCount;
  const meta = `${count} ${count === 1 ? "workspace" : "workspaces"}`;

  return `
    <div
      class="workspace-window-summary"
      data-tauri-drag-region="true"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(`${label} window with ${meta}`)}"
    >
      <span class="workspace-window-mark">Window</span>
      <div class="workspace-window-copy">
        <strong class="workspace-window-title">${escapeHtml(label)}</strong>
        <span class="workspace-window-count">${escapeHtml(meta)}</span>
      </div>
    </div>
  `;
}

export function buildWorkspaceTabLabels(workspaces) {
  const labelCounts = new Map();
  for (const workspace of workspaces) {
    labelCounts.set(workspace.name, (labelCounts.get(workspace.name) || 0) + 1);
  }

  const seenLabels = new Map();
  const labels = new Map();
  for (const workspace of workspaces) {
    const total = labelCounts.get(workspace.name) || 1;
    const nextIndex = (seenLabels.get(workspace.name) || 0) + 1;
    seenLabels.set(workspace.name, nextIndex);
    labels.set(
      workspace.id,
      total > 1 ? `${workspace.name} ${nextIndex}` : workspace.name,
    );
  }

  return labels;
}

function renderWorkspaceTab({
  workspace,
  activeWorkspaceId,
  label,
  workspaceRenameDraft,
  attention,
  hasFileDraft,
  fileDraftTitle,
  renderIndex,
  escapeHtml,
  getGitTone,
  formatGitBadgeTitle,
}) {
  const activeClass = workspace.id === activeWorkspaceId ? "is-active" : "";
  const liveClass = workspace.isLive ? "is-live" : "is-idle";
  const isRenaming = workspaceRenameDraft?.workspaceId === workspace.id;
  const gitSummary = workspace.gitSummary || null;
  const attentionTone = attention?.unreadCount ? attention.tone : "";
  const tabTitle = buildWorkspaceTabTitle(workspace, attention, hasFileDraft, fileDraftTitle);

  return `
    <div
      class="workspace-tab-shell ${activeClass} ${isRenaming ? "is-renaming" : ""} ${attention?.unreadCount ? "has-attention" : ""}"
      data-tauri-drag-region="false"
      data-workspace-tab-shell
      data-workspace-id="${escapeHtml(workspace.id)}"
      data-workspace-index="${escapeHtml(String(renderIndex ?? 0))}"
      ${attentionTone ? `data-attention-tone="${escapeHtml(attentionTone)}"` : ""}
    >
      ${
        isRenaming
          ? `
      <form
        class="workspace-tab-main workspace-tab-rename-form"
        data-tauri-drag-region="false"
        data-action="rename-workspace"
        data-workspace-rename-form
        data-workspace-id="${escapeHtml(workspace.id)}"
      >
        <span class="workspace-tab-status ${liveClass}" aria-hidden="true"></span>
        <input
          class="workspace-tab-rename-input"
          data-workspace-rename-input
          data-workspace-id="${escapeHtml(workspace.id)}"
          type="text"
          value="${escapeHtml(workspaceRenameDraft.value)}"
          aria-label="Rename ${escapeHtml(workspace.name)}"
          title="${escapeHtml(workspace.path)}"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </form>
      `
          : `
      <button
        class="workspace-tab-main"
        data-tauri-drag-region="false"
        data-action="switch-workspace"
        data-workspace-id="${escapeHtml(workspace.id)}"
        aria-current="${workspace.id === activeWorkspaceId ? "page" : "false"}"
        title="${escapeHtml(tabTitle)}"
      >
        <span class="workspace-tab-status ${liveClass}" aria-hidden="true"></span>
        <span class="workspace-tab-initial" aria-hidden="true">${escapeHtml(getWorkspaceTabInitial(label))}</span>
        <span class="workspace-tab-name">${escapeHtml(label)}</span>
        ${renderWorkspaceFileDraftIndicator(hasFileDraft, fileDraftTitle, escapeHtml)}
        ${renderWorkspaceAttentionBadge(workspace, attention, escapeHtml)}
        ${renderWorkspaceGitIndicator(gitSummary, getGitTone, formatGitBadgeTitle, escapeHtml)}
      </button>
      <button
        class="workspace-tab-action workspace-tab-rename"
        data-tauri-drag-region="false"
        data-action="start-rename-workspace"
        data-workspace-id="${escapeHtml(workspace.id)}"
        aria-label="Rename ${escapeHtml(workspace.name)}"
        title="Rename ${escapeHtml(workspace.name)}"
      >
        ${renderTabRenameIcon()}
      </button>
      <button
        class="workspace-tab-action workspace-tab-close"
        data-tauri-drag-region="false"
        data-action="close-workspace"
        data-workspace-id="${escapeHtml(workspace.id)}"
        aria-label="Close ${escapeHtml(workspace.name)}"
        title="Close ${escapeHtml(workspace.name)}"
      >
        ${renderTabCloseIcon()}
      </button>
      `
      }
    </div>
  `;
}

function getWorkspaceTabInitial(label) {
  const normalized = String(label || "").trim();
  return (normalized[0] || "W").toUpperCase();
}

function renderWorkspaceGitIndicator(summary, getGitTone, formatGitBadgeTitle, escapeHtml) {
  if (!summary || summary.state === "not-repo" || summary.state === "error") {
    return "";
  }

  return `
    <span
      class="workspace-tab-git is-${getGitTone(summary)}"
      aria-hidden="true"
      title="${escapeHtml(formatGitBadgeTitle(summary))}"
    ></span>
  `;
}

function buildWorkspaceTabTitle(workspace, attention, hasFileDraft, fileDraftTitle) {
  if (hasFileDraft && attention?.unreadCount && attention.lastEvent?.message) {
    return `${workspace.path}\n${fileDraftTitle || "Unsaved file draft"}\n${attention.lastEvent.message}`;
  }

  if (hasFileDraft) {
    return `${workspace.path}\n${fileDraftTitle || "Unsaved file draft"}`;
  }

  if (!attention?.unreadCount || !attention.lastEvent?.message) {
    return workspace.path;
  }

  return `${workspace.path}\n${attention.lastEvent.message}`;
}

function renderWorkspaceFileDraftIndicator(hasFileDraft, fileDraftTitle, escapeHtml) {
  if (!hasFileDraft) {
    return "";
  }

  return `
    <span
      class="workspace-tab-draft"
      aria-hidden="true"
      title="${escapeHtml(fileDraftTitle || "Unsaved file draft")}"
    ></span>
  `;
}

function renderWorkspaceAttentionBadge(workspace, attention, escapeHtml) {
  if (!attention?.unreadCount || !attention.lastEvent?.message) {
    return "";
  }

  const count = attention.unreadCount > 9 ? "9+" : String(attention.unreadCount);
  const description = `${workspace.name}: ${attention.lastEvent.message}`;

  return `
    <span
      class="workspace-tab-attention is-${escapeHtml(attention.tone)}"
      aria-label="${escapeHtml(description)}"
      title="${escapeHtml(attention.lastEvent.message)}"
    >
      ${escapeHtml(count)}
    </span>
  `;
}

function renderSettingsIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="currentColor"></path>
      <path fill-rule="evenodd" d="M11.29 2.042a.75.75 0 0 1 1.42 0l.277 1.156c.394.1.766.257 1.107.464l1.04-.543a.75.75 0 0 1 .904.18l1.004 1.004a.75.75 0 0 1 .18.904l-.543 1.04c.207.341.363.713.464 1.107l1.156.277a.75.75 0 0 1 0 1.42l-1.156.277a5.53 5.53 0 0 1-.464 1.107l.543 1.04a.75.75 0 0 1-.18.904l-1.004 1.004a.75.75 0 0 1-.904.18l-1.04-.543a5.523 5.523 0 0 1-1.107.464l-.277 1.156a.75.75 0 0 1-1.42 0l-.277-1.156a5.523 5.523 0 0 1-1.107-.464l-1.04.543a.75.75 0 0 1-.904-.18l-1.004-1.004a.75.75 0 0 1-.18-.904l.543-1.04a5.53 5.53 0 0 1-.464-1.107l-1.156-.277a.75.75 0 0 1 0-1.42l1.156-.277c.1-.394.257-.766.464-1.107l-.543-1.04a.75.75 0 0 1 .18-.904l1.004-1.004a.75.75 0 0 1 .904-.18l1.04.543c.341-.207.713-.363 1.107-.464l.277-1.156ZM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" clip-rule="evenodd" fill="currentColor"></path>
    </svg>
  `;
}

function renderPlusIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5.25a.75.75 0 0 1 .75.75v5.25H18a.75.75 0 0 1 0 1.5h-5.25V18a.75.75 0 0 1-1.5 0v-5.25H6a.75.75 0 0 1 0-1.5h5.25V6a.75.75 0 0 1 .75-.75Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderChevronIcon(direction) {
  const rotation = direction === "left"
    ? " style=\"transform: rotate(180deg)\""
    : direction === "up"
      ? " style=\"transform: rotate(-90deg)\""
      : direction === "down"
        ? " style=\"transform: rotate(90deg)\""
        : "";
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${rotation}>
      <path fill-rule="evenodd" d="M16.28 11.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 0 1 1.06-1.06l7.5 7.5Z" clip-rule="evenodd" fill="currentColor"></path>
    </svg>
  `;
}

function renderSidebarToggleIcon() {
  return renderChevronIcon("right");
}

function renderTabRenameIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m15.1 5.2 3.7 3.7-9.9 9.9-4.4.7.7-4.4 9.9-9.9Zm1.4-1.4 1.1-1.1a1.8 1.8 0 0 1 2.6 0l1.1 1.1a1.8 1.8 0 0 1 0 2.6l-1.1 1.1-3.7-3.7Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderTabCloseIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7.4 6 4.6 4.6L16.6 6 18 7.4 13.4 12 18 16.6 16.6 18 12 13.4 7.4 18 6 16.6 10.6 12 6 7.4Z" fill="currentColor"></path>
    </svg>
  `;
}
