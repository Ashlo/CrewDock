export function renderActivityRail({
  visible,
  scope,
  hasActiveWorkspace,
  totalUnreadCount,
  unreadWorkspaceCount,
  workspaceSummaries,
  items,
  escapeHtml,
}) {
  if (!visible) {
    return "";
  }

  const summaryCopy = totalUnreadCount > 0
    ? `${totalUnreadCount} unread ${totalUnreadCount === 1 ? "update" : "updates"} across ${unreadWorkspaceCount} ${unreadWorkspaceCount === 1 ? "workspace" : "workspaces"}`
    : items.length > 0
      ? `${items.length} recent ${items.length === 1 ? "event" : "events"} across your workspaces`
      : "No recent terminal lifecycle changes yet";

  return `
    <aside class="workspace-activity-rail" role="complementary" aria-label="Workspace activity">
      <header class="workspace-activity-header">
        <div class="workspace-activity-header-copy">
          <p class="workspace-activity-mark">Activity</p>
          <h2>Live workspace feed</h2>
          <p>${escapeHtml(summaryCopy)}</p>
        </div>
        <div class="workspace-activity-header-actions">
          ${
            totalUnreadCount > 0
              ? `
                <button
                  class="workspace-activity-action"
                  type="button"
                  data-action="mark-all-activity-seen"
                >
                  Mark all seen
                </button>
              `
              : ""
          }
          <button
            class="workspace-activity-close"
            type="button"
            data-action="close-activity-rail"
            aria-label="Close activity rail"
            title="Close activity rail"
          >
            ${renderCloseIcon()}
          </button>
        </div>
      </header>
      <div class="workspace-activity-filters">
        <button
          class="workspace-activity-filter ${scope === "all" ? "is-active" : ""}"
          type="button"
          data-action="set-activity-scope"
          data-activity-scope="all"
          aria-pressed="${scope === "all" ? "true" : "false"}"
        >
          All workspaces
        </button>
        <button
          class="workspace-activity-filter ${scope === "current" ? "is-active" : ""}"
          type="button"
          data-action="set-activity-scope"
          data-activity-scope="current"
          aria-pressed="${scope === "current" ? "true" : "false"}"
          ${hasActiveWorkspace ? "" : "disabled"}
        >
          Current workspace
        </button>
      </div>
      ${
        workspaceSummaries.length
          ? `
            <section class="workspace-activity-summary-list" aria-label="Workspace attention">
              ${workspaceSummaries.map((summary) => renderWorkspaceSummary(summary, escapeHtml)).join("")}
            </section>
          `
          : ""
      }
      <section class="workspace-activity-feed" aria-label="Recent activity">
        <div class="workspace-activity-feed-header">
          <strong>Recent events</strong>
          <span>${items.length} ${items.length === 1 ? "item" : "items"}</span>
        </div>
        ${
          items.length
            ? items.map((item) => renderActivityItem(item, escapeHtml)).join("")
            : `
              <div class="workspace-activity-empty">
                <strong>No activity yet</strong>
                <span>Pane launches, exits, and failures will appear here.</span>
              </div>
            `
        }
      </section>
    </aside>
  `;
}

function renderWorkspaceSummary(summary, escapeHtml) {
  return `
    <button
      class="workspace-activity-summary is-${escapeHtml(summary.tone)} ${summary.isActive ? "is-active" : ""}"
      type="button"
      data-action="jump-to-activity-workspace"
      data-workspace-id="${escapeHtml(summary.workspaceId)}"
      title="${escapeHtml(summary.path)}"
    >
      <span class="workspace-activity-summary-top">
        <strong>${escapeHtml(summary.label)}</strong>
        ${
          summary.unreadCount > 0
            ? `<span class="workspace-activity-summary-badge">${escapeHtml(summary.unreadCount > 99 ? "99+" : String(summary.unreadCount))}</span>`
            : summary.isActive
              ? '<span class="workspace-activity-summary-tag">Current</span>'
              : ""
        }
      </span>
      <span class="workspace-activity-summary-meta">${escapeHtml(summary.meta)}</span>
    </button>
  `;
}

function renderActivityItem(item, escapeHtml) {
  const meta = [item.pathLabel];
  if (item.isActiveWorkspace) {
    meta.push("Current");
  }
  if (item.isUnread) {
    meta.push("Unread");
  }

  return `
    <button
      class="workspace-activity-item is-${escapeHtml(item.tone)} ${item.isUnread ? "is-unread" : ""}"
      type="button"
      data-action="jump-to-activity-workspace"
      data-workspace-id="${escapeHtml(item.workspaceId)}"
      title="${escapeHtml(item.path)}"
    >
      <span class="workspace-activity-item-dot" aria-hidden="true"></span>
      <span class="workspace-activity-item-copy">
        <span class="workspace-activity-item-top">
          <strong>${escapeHtml(item.workspaceLabel)}</strong>
          <span>${escapeHtml(formatRelativeTime(item.at))}</span>
        </span>
        <span class="workspace-activity-item-message">${escapeHtml(item.message)}</span>
        <span class="workspace-activity-item-meta">${escapeHtml(meta.join(" • "))}</span>
      </span>
    </button>
  `;
}

function formatRelativeTime(timestamp) {
  const elapsedMs = Math.max(0, Date.now() - Number(timestamp || 0));
  if (elapsedMs < 45_000) {
    return "just now";
  }
  if (elapsedMs < 60 * 60_000) {
    return `${Math.round(elapsedMs / 60_000)}m ago`;
  }
  if (elapsedMs < 24 * 60 * 60_000) {
    return `${Math.round(elapsedMs / (60 * 60_000))}h ago`;
  }
  return `${Math.round(elapsedMs / (24 * 60 * 60_000))}d ago`;
}

function renderCloseIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z" fill="currentColor"></path>
    </svg>
  `;
}
