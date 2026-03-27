export function renderWorkspaceStrip({
  windowSummary,
  workspaces,
  activeWorkspaceId,
  workspaceRenameDraft,
  getWorkspaceAttention,
  escapeHtml,
  getGitTone,
  formatGitBadgeTitle,
}) {
  const tabLabels = buildWorkspaceTabLabels(workspaces);
  return `
    <div class="workspace-strip-track" data-tauri-drag-region>
      <div class="workspace-strip-leading" data-tauri-drag-region aria-hidden="true"></div>
      ${renderWindowSummary(windowSummary, workspaces.length, escapeHtml)}
      <div class="workspace-tabs-shell" data-workspace-tabs-shell data-tauri-drag-region>
        <button
          class="workspace-tabs-scroll workspace-tabs-scroll-left"
          type="button"
          data-tauri-drag-region="false"
          data-action="scroll-workspaces-left"
          aria-label="Scroll workspaces left"
          title="Scroll workspaces left"
          disabled
        >
          ${renderChevronIcon("left")}
        </button>
        <div class="workspace-tabs-viewport" data-workspace-tabs-viewport data-tauri-drag-region>
          <div class="workspace-tabs" data-workspace-tabs data-tauri-drag-region>
            ${
              workspaces.length
                ? renderWorkspaceTabs({
                    workspaces,
                    activeWorkspaceId,
                    workspaceRenameDraft,
                    tabLabels,
                    getWorkspaceAttention,
                    escapeHtml,
                    getGitTone,
                    formatGitBadgeTitle,
                  })
                : '<span class="workspace-tabs-empty" data-tauri-drag-region="true">No workspaces open</span>'
            }
            <div class="workspace-tab-drop-indicator" data-workspace-tab-drop-indicator aria-hidden="true"></div>
          </div>
        </div>
        <button
          class="workspace-tabs-scroll workspace-tabs-scroll-right"
          type="button"
          data-tauri-drag-region="false"
          data-action="scroll-workspaces-right"
          aria-label="Scroll workspaces right"
          title="Scroll workspaces right"
          disabled
        >
          ${renderChevronIcon("right")}
        </button>
      </div>
      <div class="workspace-strip-actions">
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

function renderWorkspaceTabs({
  workspaces,
  activeWorkspaceId,
  workspaceRenameDraft,
  tabLabels,
  getWorkspaceAttention,
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
  const tabTitle = buildWorkspaceTabTitle(workspace, attention);

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
        title="${escapeHtml(tabTitle)}"
      >
        <span class="workspace-tab-status ${liveClass}" aria-hidden="true"></span>
        <span class="workspace-tab-name">${escapeHtml(label)}</span>
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

function buildWorkspaceTabTitle(workspace, attention) {
  if (!attention?.unreadCount || !attention.lastEvent?.message) {
    return workspace.path;
  }

  return `${workspace.path}\n${attention.lastEvent.message}`;
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
      <path d="M10.3 2.8h3.4l.5 2.2c.5.1.9.3 1.4.6l2-1.1 2.4 2.4-1.1 2c.3.4.5.9.6 1.4l2.2.5v3.4l-2.2.5c-.1.5-.3.9-.6 1.4l1.1 2-2.4 2.4-2-1.1c-.4.3-.9.5-1.4.6l-.5 2.2h-3.4l-.5-2.2c-.5-.1-.9-.3-1.4-.6l-2 1.1-2.4-2.4 1.1-2c-.3-.4-.5-.9-.6-1.4l-2.2-.5v-3.4l2.2-.5c.1-.5.3-.9.6-1.4l-1.1-2 2.4-2.4 2 1.1c.4-.3.9-.5 1.4-.6l.5-2.2Zm1.7 5.2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderPlusIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" fill="currentColor"></path>
    </svg>
  `;
}

function renderChevronIcon(direction) {
  const rotation = direction === "left" ? " style=\"transform: rotate(180deg)\"" : "";
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${rotation}>
      <path d="m9.2 6.7 5.3 5.3-5.3 5.3-1.4-1.4 3.9-3.9-3.9-3.9Z" fill="currentColor"></path>
    </svg>
  `;
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
