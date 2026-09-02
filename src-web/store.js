export function reconcileSourceControlTask(task, previousTask = null) {
  if (!task || !previousTask) {
    return task || previousTask || null;
  }

  if (task.id !== previousTask.id) {
    return Number(task.startedAt || 0) < Number(previousTask.startedAt || 0)
      ? previousTask
      : task;
  }

  if (Number(task.revision || 0) < Number(previousTask.revision || 0)) {
    return previousTask;
  }

  return previousTask.status !== "running" && task.status === "running"
    ? previousTask
    : task;
}

export const TASK_BOARD_STATUSES = Object.freeze(["todo", "in-progress", "done"]);
export const TERMINAL_VIEWPORT_PINNED_TO_BOTTOM = -1;

export function resolveTerminalFitViewportLine(rememberedLine, pendingLine, capturedLine) {
  if (Number.isFinite(pendingLine)) {
    return pendingLine;
  }
  return rememberedLine === TERMINAL_VIEWPORT_PINNED_TO_BOTTOM
    ? TERMINAL_VIEWPORT_PINNED_TO_BOTTOM
    : capturedLine;
}

export function normalizeTaskBoardTasks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set();
  return value.slice(0, 500).flatMap((task, index) => {
    const text = String(task?.text || "").trim().slice(0, 160);
    if (!text) {
      return [];
    }

    let id = String(task?.id || `task-${index + 1}`).trim().slice(0, 120);
    while (seenIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    seenIds.add(id);

    return [{
      id,
      text,
      status: TASK_BOARD_STATUSES.includes(task?.status) ? task.status : "todo",
      createdAtMs: Math.max(0, Number(task?.createdAtMs || 0)),
      updatedAtMs: Math.max(0, Number(task?.updatedAtMs || 0)),
    }];
  });
}

export function moveTaskBoardTask(tasks, taskId, status) {
  if (!TASK_BOARD_STATUSES.includes(status)) {
    return tasks;
  }
  return tasks.map((task) => task.id === taskId ? { ...task, status } : task);
}

export function reconcileCodexPanePresentation(current, update) {
  if (update?.kind === "start") {
    return {
      workspaceId: String(update.workspaceId || ""),
      sessionId: String(update.sessionId || ""),
      previousSessionId: String(update.previousSessionId || ""),
      startedAtMs: Number(update.startedAtMs || 0),
      selectLatest: Boolean(update.selectLatest),
      title: String(update.title || "Codex session"),
      resolved: Boolean(update.resolved),
    };
  }

  if (!current) {
    return null;
  }

  if (update?.kind === "bound") {
    return {
      ...current,
      sessionId: String(update.sessionId || current.sessionId || ""),
      title: String(update.title || current.title || "Codex session"),
      resolved: Boolean(update.resolved),
    };
  }

  return current;
}

export function createUiState() {
  return {
    snapshot: null,
    mountedWorkspaceId: null,
    mountedLayoutSignature: null,
    appliedThemeId: null,
    appliedInterfaceTextScale: null,
    appliedTerminalFontSize: null,
    settingsDraft: null,
    launcherVisible: false,
    settingsVisible: false,
    settingsSection: "workbench",
    appUpdate: {
      snapshot: null,
      checking: false,
      error: "",
      checkedThisSession: false,
    },
    activePaneId: null,
    dragHoverPaneId: null,
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
    todoPanelVisible: false,
    workspaceTodos: {
      draft: "",
      editTodoId: "",
      editDraft: "",
      completedCollapsed: true,
      shouldFocusCreate: false,
      shouldFocusEditTodoId: "",
      submitting: false,
    },
    sourceControl: {
      snapshot: null,
      activeTab: "changes",
      activeRowMenuKey: "",
      selectedPath: "",
      selectedDiffMode: "working-tree",
      diff: null,
      diffLoading: false,
      selectedCommitOid: "",
      commitDetail: null,
      commitDetailLoading: false,
      graphLoadingMore: false,
      createBranchName: "",
      createBranchStartPoint: "",
      pendingCreateBranch: null,
      pendingCommit: null,
      commitMessage: "",
      generatingCommitMessage: false,
      branchSearch: "",
      taskInput: "",
      taskTrayExpanded: false,
      publishModalVisible: false,
      publishModalBranchName: "",
      publishModalRemotes: [],
      publishModalSelectedRemote: "",
      publishModalShouldFocus: false,
      submitting: false,
      lastLoadedWorkspaceId: "",
    },
    quickSwitcherVisible: false,
    quickSwitcherQuery: "",
    quickSwitcherCursor: 0,
    quickSwitcherShouldFocus: false,
    systemHealthPanelVisible: false,
    systemHealthSnapshot: null,
    systemHealthLoading: false,
    systemHealthError: "",
    codexModalVisible: false,
    codexSessionsSnapshot: null,
    codexSessionsLoading: false,
    codexSessionsError: "",
    codexSelectedSessionId: "",
    codexTargetPaneId: null,
    codexSubmitting: false,
    codexShouldFocus: false,
    workspaceOpenMenuVisible: false,
    workspaceGitMenuVisible: false,
    workspaceOpenTargets: [],
    workspaceOpenTargetsLoading: false,
    workspaceOpenTargetsError: "",
    workspaceLastOpenTargetId: "",
    workspaceFileEditorWidth: 0,
    browser: {
      visible: false,
      placement: "panel",
      paneId: "",
      input: "",
      url: "",
      loading: false,
      error: "",
    },
    timeBlock: {
      popoverVisible: false,
      taskDraft: "",
      durationMinutes: 50,
      current: null,
    },
    taskBoard: {
      visible: false,
      tasks: [],
      draft: "",
      shouldFocus: false,
      editingTaskId: "",
      editDraft: "",
      editShouldFocus: false,
    },
    activityRailVisible: false,
    activityRailScope: "all",
    dispatchToasts: [],
    paneAttentionById: new Map(),
    workspaceFileExplorer: new Map(),
    workspaceFileEditor: new Map(),
    workspaceSidebarCollapsed: false,
    workspaceCompanionId: "sailor-tanuki",
    workspaceCompanionState: "sleeping",
    workspaceRenameDraft: null,
    workspaceRenameShouldFocus: false,
    workspaceRenameSaving: false,
    workspaceTabDrag: null,
    workspaceTabSuppressClickUntil: 0,
    workspaceTabSuppressClickWorkspaceId: "",
    workspaceTabsScrollLeft: 0,
    workspaceTabsLastActiveWorkspaceId: null,
    workspaceTabsLastCount: 0,
    runtimeActivity: [],
    runtimeAttentionByWorkspace: new Map(),
    codexRestoreByPane: new Map(),
    codexPanePresentationById: new Map(),
  };
}

export function createRuntimeStore() {
  return {
    paneTerminals: new Map(),
    pendingTerminalData: new Map(),
    workspacePaneIds: new Map(),
    workspaceScreens: new Map(),
    terminalViewportLines: new Map(),
    visibleTerminalRefreshFrame: 0,
    browserHandledDropPaneId: null,
    browserHandledDropAt: 0,
    workspaceTabAutoScrollFrame: 0,
    workspaceFileEditorResizeDrag: null,
    taskBoardPointerDrag: null,
    launcherCardTransitionTimer: 0,
    launcherCardAnimationFrame: 0,
    launcherParticles: null,
    sourceControlModalSyncFrame: 0,
    sourceControlTaskRefreshTimer: 0,
    sourceControlTaskRefreshInFlight: null,
    codexPaneRefreshTimers: new Map(),
    codexPaneRefreshInFlight: new Map(),
    codexPaneProcessTimers: new Map(),
    codexPaneProcessInFlight: new Map(),
    gitRefreshInFlight: null,
    gitRefreshQueuedWorkspaceId: null,
    systemHealthRefreshTimer: 0,
    systemHealthRefreshMode: "",
    systemHealthRefreshInFlight: null,
    workspaceOpenTargetsRequest: null,
    dispatchToastTimer: 0,
    dispatchToastDeadline: 0,
    paneAttentionTimers: new Map(),
    workspaceFileDraftPersistTimers: new Map(),
    workspaceCodeEditors: new Map(),
    codeMirrorModulePromise: null,
    timeBlockTickTimer: 0,
    timeBlockBombExplodedId: "",
    timeBlockBombExplodedAtMs: 0,
    workspaceCompanionTimer: 0,
    browserBoundsFrame: 0,
    browserBoundsSignature: "",
    appUpdateCheckInFlight: null,
    pendingRenderMask: 0,
    pendingRenderFrame: 0,
    renderMetrics: {
      flushCount: 0,
      lastMask: 0,
      regionFlushCounts: {
        strip: 0,
        stage: 0,
        status: 0,
        activity: 0,
        explorer: 0,
        modal: 0,
        context: 0,
        terminals: 0,
      },
    },
  };
}
