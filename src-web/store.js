export function createUiState() {
  return {
    snapshot: null,
    mountedWorkspaceId: null,
    mountedLayoutSignature: null,
    appliedThemeId: null,
    launcherVisible: false,
    settingsVisible: false,
    settingsSection: "workbench",
    pendingWorkspaceDraft: null,
    launcherCommandValue: "",
    launcherHistory: [],
    launcherLatestCard: {
      current: null,
      previous: null,
      phase: "idle",
    },
    launcherCommands: [],
    launcherCommandCursor: null,
    contextMenu: null,
    maximizedPaneId: null,
    gitPanelVisible: false,
    quickSwitcherVisible: false,
    quickSwitcherQuery: "",
    quickSwitcherCursor: 0,
    quickSwitcherShouldFocus: false,
    workspaceRenameDraft: null,
    workspaceRenameShouldFocus: false,
    workspaceRenameSaving: false,
    workspaceTabsScrollLeft: 0,
    workspaceTabsLastActiveWorkspaceId: null,
    workspaceTabsLastCount: 0,
    runtimeActivity: [],
    runtimeAttentionByWorkspace: new Map(),
  };
}

export function createRuntimeStore() {
  return {
    paneTerminals: new Map(),
    pendingTerminalData: new Map(),
    workspacePaneIds: new Map(),
    terminalViewportLines: new Map(),
    launcherCardTransitionTimer: 0,
    launcherCardAnimationFrame: 0,
    gitRefreshIntervalTimer: 0,
    gitRefreshInFlight: null,
    gitRefreshQueuedWorkspaceId: null,
  };
}
