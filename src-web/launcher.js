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
    mode: "interactive-home",
    commandValue: launcherState?.launcherCommandValue || "",
    currentEntry: serializeLauncherEntry(launcherState?.launcherLatestCard?.current || null),
    previousEntry: serializeLauncherEntry(launcherState?.launcherLatestCard?.previous || null),
    phase: launcherState?.launcherLatestCard?.phase || "idle",
  });
}

function serializeLauncherEntry(entry) {
  if (!entry) {
    return null;
  }

  return {
    input: String(entry.input || ""),
    output: Array.isArray(entry.output) ? entry.output.map((line) => String(line || "")) : [],
    tone: entry.tone === "error" ? "error" : "normal",
  };
}

export function renderEmptyState({
  basePath = "",
  commandValue = "",
  latestEntry = null,
  escapeHtml = (value) => String(value ?? ""),
} = {}) {
  return `
    <div class="workspace-empty">
      <div class="workspace-empty-panel">
        <p class="workspace-empty-mark">CrewDock</p>
        <h1>Open a folder to start a workspace.</h1>
        <p class="workspace-empty-copy">Each workspace becomes a focused dock for your files, tools, and crew.</p>
        <button class="workspace-empty-action" data-action="open-workspace">Open workspace</button>
        <div class="workspace-launch-shell">
          ${renderLauncherShell({
            basePath,
            commandValue,
            latestEntry,
            escapeHtml,
          })}
        </div>
      </div>
    </div>
  `;
}

function renderLauncherShell({
  basePath,
  commandValue,
  latestEntry,
  escapeHtml,
}) {
  return `
    <div class="workspace-launch-terminal">
      <div class="workspace-launch-terminal-screen">
        ${
          latestEntry
            ? renderLauncherLatestEntry(latestEntry, escapeHtml)
            : renderLauncherCommandHints(basePath, escapeHtml)
        }
        <form class="workspace-launch-command" data-action="run-launcher-command" novalidate>
          <span class="workspace-launch-command-prefix">$</span>
          <input
            class="workspace-launch-command-input"
            data-launcher-path-input
            type="text"
            value="${escapeHtml(commandValue)}"
            placeholder="Type a command"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </form>
      </div>
      <div class="workspace-launch-terminal-footer">
        <span class="workspace-launch-terminal-path">${escapeHtml(basePath)}</span>
        <span class="workspace-launch-terminal-tip">Try: <code>pwd</code>, <code>ls</code>, <code>cd ..</code>, <code>open .</code></span>
      </div>
    </div>
  `;
}

function renderLauncherLatestEntry(entry, escapeHtml) {
  const toneClass = entry?.tone === "error" ? "is-error" : "is-normal";
  const output = Array.isArray(entry?.output) && entry.output.length
    ? entry.output
    : ["Command finished with no output."];

  return `
    <div class="workspace-launch-transcript ${toneClass}">
      <div class="workspace-launch-transcript-line is-command">
        <span class="workspace-launch-command-prefix">$</span>
        <span>${escapeHtml(entry?.input || "")}</span>
      </div>
      <div class="workspace-launch-transcript-output">
        ${output.map((line) => `<div class="workspace-launch-transcript-line">${escapeHtml(line)}</div>`).join("")}
      </div>
    </div>
  `;
}

function renderLauncherCommandHints(basePath, escapeHtml) {
  return `
    <div class="workspace-launch-hints">
      <div class="workspace-launch-transcript-line is-command">
        <span class="workspace-launch-command-prefix">$</span>
        <span><strong>open .</strong> opens the current folder as a workspace</span>
      </div>
      <p class="workspace-launch-hints-copy">
        Navigate from <code>${escapeHtml(basePath)}</code>, inspect folders, then open the one you want.
      </p>
      <div class="workspace-launch-command-list">
        <span><code>pwd</code> show current path</span>
        <span><code>ls</code> list folders</span>
        <span><code>cd ..</code> move up</span>
        <span><code>open ./my-folder</code> start a workspace</span>
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
