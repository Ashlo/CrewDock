const MAX_LAUNCHER_COMPLETION_MATCHES = 24;

export function createPendingWorkspaceDraft(path, presets) {
  const defaultCount = presets?.[0]?.paneCount || 1;
  return {
    path,
    paneCount: clampPaneCount(defaultCount),
  };
}

export function clampPaneCount(value) {
  const nextValue = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(16, Math.max(1, nextValue));
}

export function deriveLayoutForPaneCount(paneCount) {
  const count = clampPaneCount(paneCount);
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.min(4, Math.max(1, Math.ceil(count / columns)));
  return {
    id: `count-${count}`,
    label: `${count} terminals`,
    rows,
    columns,
    paneCount: count,
  };
}

export function formatLauncherCompletionMatches(matches) {
  const lines = [];
  const limited = matches.slice(0, MAX_LAUNCHER_COMPLETION_MATCHES);

  for (let index = 0; index < limited.length; index += 3) {
    lines.push(limited.slice(index, index + 3).join("    "));
  }

  return lines;
}

export function launcherStageSignature(basePath, launcherState) {
  return JSON.stringify({
    basePath,
    history: launcherState.launcherHistory,
    latestCard: launcherState.launcherLatestCard,
  });
}

export function renderEmptyState({ basePath, launcherCommandValue, launcherLatestCard, escapeHtml }) {
  return `
    <div class="workspace-empty">
      <div class="workspace-empty-panel">
        <p class="workspace-empty-mark">CrewDock</p>
        <h1>Open a folder to start a workspace.</h1>
        <p class="workspace-empty-copy">Each workspace becomes a live tab with its own terminal grid.</p>
        <button class="workspace-empty-action" data-action="open-workspace">Open workspace</button>
        <div class="workspace-launch-shell" title="${escapeHtml(basePath)}">
          ${renderLauncherLatestStage(launcherLatestCard, escapeHtml)}
          <form class="workspace-launch-form" data-action="run-launcher-command" title="${escapeHtml(basePath)}">
            <span class="workspace-launch-prefix">$</span>
            <input
              class="workspace-launch-input"
              data-launcher-path-input
              type="text"
              value="${escapeHtml(launcherCommandValue)}"
              placeholder="Type a command"
              aria-label="Run launcher command"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </form>
        </div>
      </div>
    </div>
  `;
}

export function renderLayoutPicker({ presets, draft, basename, escapeHtml }) {
  const layout = deriveLayoutForPaneCount(draft.paneCount);
  const previewCells = renderPreviewCells(layout);
  return `
    <div class="workspace-modal-backdrop">
      <div class="workspace-modal">
        <div class="workspace-modal-header">
          <div>
            <p class="workspace-modal-mark">New workspace</p>
            <h2>${escapeHtml(basename(draft.path))}</h2>
            <p class="workspace-modal-path">${escapeHtml(draft.path)}</p>
          </div>
          <button class="workspace-modal-cancel" data-action="cancel-layout-picker">Cancel</button>
        </div>
        <div class="workspace-layout-builder">
          <section class="workspace-layout-controls">
            <p class="workspace-layout-kicker">Terminal count</p>
            <div class="workspace-count-stepper">
              <button class="workspace-count-button" data-action="adjust-terminal-count" data-delta="-1" aria-label="Decrease terminal count">-</button>
              <label class="workspace-count-input-shell">
                <input
                  class="workspace-count-input"
                  data-terminal-count-input
                  type="number"
                  min="1"
                  max="16"
                  value="${draft.paneCount}"
                />
              </label>
              <button class="workspace-count-button" data-action="adjust-terminal-count" data-delta="1" aria-label="Increase terminal count">+</button>
            </div>
            <div class="workspace-count-presets">
              ${presets.map((preset) => renderCountPreset(preset, draft.paneCount)).join("")}
            </div>
            <p class="workspace-layout-note">CrewDock balances the grid automatically so you can choose the count first and worry about layout later.</p>
          </section>
          <section class="workspace-layout-preview-card">
            <div class="workspace-layout-preview-head">
              <p class="workspace-layout-kicker">Preview</p>
              <div class="workspace-layout-meta">
                <span>${layout.rows} rows</span>
                <span>${layout.columns} columns</span>
              </div>
            </div>
            <div class="workspace-layout-preview" style="--rows:${layout.rows}; --columns:${layout.columns};">
              ${previewCells}
            </div>
            <div class="workspace-layout-summary">
              <strong>${draft.paneCount}</strong>
              <span>${draft.paneCount === 1 ? "terminal" : "terminals"} in a ${layout.rows} x ${layout.columns} grid</span>
            </div>
            <button class="workspace-create-button" data-action="create-workspace">Create workspace</button>
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderCountPreset(preset, selectedCount) {
  const isActive = preset.paneCount === selectedCount ? "is-active" : "";
  return `
    <button
      class="workspace-count-preset ${isActive}"
      data-action="set-terminal-count"
      data-pane-count="${preset.paneCount}"
    >
      ${preset.paneCount}
    </button>
  `;
}

function renderPreviewCells(layout) {
  const totalSlots = layout.rows * layout.columns;
  const cells = [];

  for (let index = 0; index < totalSlots; index += 1) {
    const ghostClass = index >= layout.paneCount ? " is-ghost" : "";
    cells.push(`<span class="preset-cell${ghostClass}"></span>`);
  }

  return cells.join("");
}

function renderLauncherLatestStage(launcherLatestCard, escapeHtml) {
  const { current, previous, phase } = launcherLatestCard;
  if (!current && !previous) {
    return "";
  }

  return `
    <div class="workspace-launch-history-stage ${previous ? `is-transitioning is-${phase}` : "is-settled"}">
      ${
        previous
          ? `<div class="workspace-launch-latest-card is-previous is-${phase}">${renderLauncherHistoryEntry(previous, escapeHtml)}</div>`
          : ""
      }
      ${
        current
          ? `<div class="workspace-launch-latest-card is-current is-${phase}">${renderLauncherHistoryEntry(current, escapeHtml)}</div>`
          : ""
      }
    </div>
  `;
}

function renderLauncherHistoryEntry(entry, escapeHtml) {
  const tone = entry.tone === "error" ? "is-error" : "";
  const output = (entry.output || []).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  return `
    <div class="workspace-launch-entry ${tone}">
      ${entry.input ? `<div class="workspace-launch-command">$ ${escapeHtml(entry.input)}</div>` : ""}
      <div class="workspace-launch-output">${output}</div>
    </div>
  `;
}
