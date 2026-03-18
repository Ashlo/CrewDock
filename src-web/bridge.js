const STATE_EVENT = "crewdock://state-changed";
const TERMINAL_DATA_EVENT = "crewdock://terminal-data";
const RUNTIME_EVENT = "crewdock://runtime-event";

export function createBridge({
  defaultThemeId = "one-dark",
  themeRegistry = {},
  normalizeDialogPath = (value) => value,
  deriveLayoutForPaneCount,
  buildBalancedPaneLayout,
  splitPaneLayout,
  removePaneLayout,
  relabelMockPanes,
  completeMockLauncherInput,
  resolveMockNavigationPath,
  mockListDirectory,
} = {}) {
  const tauriApi = window.__TAURI__;

  if (tauriApi?.core?.invoke) {
    return {
      getAppSnapshot: () => tauriApi.core.invoke("get_app_snapshot"),
      setTheme: (themeId) => tauriApi.core.invoke("set_theme", { themeId }),
      createWorkspace: (path, paneCount) =>
        tauriApi.core.invoke("create_workspace", { path, paneCount }),
      renameWorkspace: (workspaceId, name) =>
        tauriApi.core.invoke("rename_workspace", { workspaceId, name }),
      refreshWorkspaceGitStatus: (workspaceId) =>
        tauriApi.core.invoke("refresh_workspace_git_status", { workspaceId }),
      loadWorkspaceSourceControl: (workspaceId, graphCursor = null) =>
        tauriApi.core.invoke("load_workspace_source_control", { workspaceId, graphCursor }),
      loadWorkspaceGitDiff: (workspaceId, path, mode) =>
        tauriApi.core.invoke("load_workspace_git_diff", { workspaceId, path, mode }),
      loadWorkspaceGitCommitDetail: (workspaceId, oid) =>
        tauriApi.core.invoke("load_workspace_git_commit_detail", { workspaceId, oid }),
      gitStagePaths: (workspaceId, paths) =>
        tauriApi.core.invoke("git_stage_paths", { workspaceId, paths }),
      gitUnstagePaths: (workspaceId, paths) =>
        tauriApi.core.invoke("git_unstage_paths", { workspaceId, paths }),
      gitDiscardPaths: (workspaceId, paths) =>
        tauriApi.core.invoke("git_discard_paths", { workspaceId, paths }),
      gitCommit: (workspaceId, message, commitAll = false) =>
        tauriApi.core.invoke("git_commit", { workspaceId, message, commitAll }),
      gitCheckoutBranch: (workspaceId, branchName) =>
        tauriApi.core.invoke("git_checkout_branch", { workspaceId, branchName }),
      gitCreateBranch: (workspaceId, branchName, startPoint = null) =>
        tauriApi.core.invoke("git_create_branch", { workspaceId, branchName, startPoint }),
      gitRenameBranch: (workspaceId, currentName, nextName) =>
        tauriApi.core.invoke("git_rename_branch", { workspaceId, currentName, nextName }),
      gitDeleteBranch: (workspaceId, branchName) =>
        tauriApi.core.invoke("git_delete_branch", { workspaceId, branchName }),
      gitFetch: (workspaceId) =>
        tauriApi.core.invoke("git_fetch", { workspaceId }),
      gitPull: (workspaceId) =>
        tauriApi.core.invoke("git_pull", { workspaceId }),
      gitPush: (workspaceId) =>
        tauriApi.core.invoke("git_push", { workspaceId }),
      gitPublishBranch: (workspaceId, branchName) =>
        tauriApi.core.invoke("git_publish_branch", { workspaceId, branchName }),
      gitSetUpstream: (workspaceId, branchName, upstreamName) =>
        tauriApi.core.invoke("git_set_upstream", { workspaceId, branchName, upstreamName }),
      gitTaskWriteStdin: (workspaceId, data) =>
        tauriApi.core.invoke("git_task_write_stdin", { workspaceId, data }),
      switchWorkspace: (workspaceId) =>
        tauriApi.core.invoke("switch_workspace", { workspaceId }),
      closeWorkspace: (workspaceId) =>
        tauriApi.core.invoke("close_workspace", { workspaceId }),
      splitPane: (paneId, direction) =>
        tauriApi.core.invoke("split_pane", { paneId, direction }),
      closePane: (paneId) =>
        tauriApi.core.invoke("close_pane", { paneId }),
      showInFinder: (path) =>
        tauriApi.core.invoke("show_in_finder", { path }),
      runLauncherCommand: (input) =>
        tauriApi.core.invoke("run_launcher_command", { input }),
      completeLauncherInput: (input) =>
        tauriApi.core.invoke("complete_launcher_input", { input }),
      resetToLauncher: () => tauriApi.core.invoke("reset_to_launcher"),
      startDragging: () => tauriApi.core.invoke("plugin:window|start_dragging"),
      writeToPane: (paneId, data) =>
        tauriApi.core.invoke("write_to_pane", { paneId, data }),
      resizePane: (paneId, cols, rows) =>
        tauriApi.core.invoke("resize_pane", { paneId, cols, rows }),
      openDirectory: async (defaultPath) => {
        const options = {
          title: "Open Workspace Folder",
          directory: true,
          multiple: false,
        };
        if (defaultPath) {
          options.defaultPath = defaultPath;
        }

        const result = await tauriApi.core.invoke("plugin:dialog|open", { options });
        return normalizeDialogPath(result);
      },
      listenState: (handler) =>
        tauriApi.event.listen(STATE_EVENT, (event) => handler(event.payload)),
      listenTerminalData: (handler) =>
        tauriApi.event.listen(TERMINAL_DATA_EVENT, (event) => handler(event.payload)),
      listenRuntimeEvents: (handler) =>
        tauriApi.event.listen(RUNTIME_EVENT, (event) => handler(event.payload)),
      listenDragDrop: (handler) => {
        const currentWebview = tauriApi.webview?.getCurrentWebview?.();
        if (currentWebview?.onDragDropEvent) {
          return currentWebview.onDragDropEvent((event) => handler(event.payload));
        }

        const currentWindow = tauriApi.window?.getCurrentWindow?.();
        if (currentWindow?.onDragDropEvent) {
          return currentWindow.onDragDropEvent((event) => handler(event.payload));
        }

        return Promise.resolve(() => {});
      },
    };
  }

  return createMockBridge({
    defaultThemeId,
    themeRegistry,
    deriveLayoutForPaneCount,
    buildBalancedPaneLayout,
    splitPaneLayout,
    removePaneLayout,
    relabelMockPanes,
    completeMockLauncherInput,
    resolveMockNavigationPath,
    mockListDirectory,
  });
}

function createMockBridge({
  defaultThemeId,
  themeRegistry,
  deriveLayoutForPaneCount,
  buildBalancedPaneLayout,
  splitPaneLayout,
  removePaneLayout,
  relabelMockPanes,
  completeMockLauncherInput,
  resolveMockNavigationPath,
  mockListDirectory,
}) {
  const stateListeners = new Set();
  const terminalListeners = new Set();
  const runtimeListeners = new Set();
  const launcher = {
    basePath: "/Users/ashutoshbele/Desktop/ashlab/crewdock",
    presets: [
      { id: "count-1", label: "1 terminal", rows: 1, columns: 1, paneCount: 1 },
      { id: "count-2", label: "2 terminals", rows: 1, columns: 2, paneCount: 2 },
      { id: "count-4", label: "4 terminals", rows: 2, columns: 2, paneCount: 4 },
      { id: "count-8", label: "8 terminals", rows: 3, columns: 3, paneCount: 8 },
      { id: "count-12", label: "12 terminals", rows: 3, columns: 4, paneCount: 12 },
      { id: "count-16", label: "16 terminals", rows: 4, columns: 4, paneCount: 16 },
    ],
  };
  const settings = {
    themeId: defaultThemeId,
  };

  let workspaceCounter = 0;
  let workspaces = [];
  let activeWorkspaceId = null;
  let activityHistory = [];
  const MAX_ACTIVITY_HISTORY = 80;

  function emitState() {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    const snapshot = {
      window: {
        id: "window-main",
        label: "Primary",
        title: activeWorkspace ? `${activeWorkspace.name} · CrewDock` : "CrewDock",
        workspaceCount: workspaces.length,
        activeWorkspaceId,
        activeWorkspaceName: activeWorkspace?.name || null,
      },
      launcher,
      settings,
      activity: {
        recentEvents: activityHistory
          .filter((event) => workspaces.some((workspace) => workspace.id === event.workspaceId))
          .map((event) => ({ ...event })),
      },
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        layout: workspace.layout,
        isLive: workspace.started,
        gitSummary: workspace.gitDetail?.summary || null,
      })),
      activeWorkspaceId,
      activeWorkspace: activeWorkspace
        ? {
            id: activeWorkspace.id,
            name: activeWorkspace.name,
            path: activeWorkspace.path,
            layout: activeWorkspace.layout,
            panes: activeWorkspace.panes.map((pane) => ({ ...pane })),
            paneLayout: structuredClone(activeWorkspace.paneLayout),
            gitDetail: activeWorkspace.gitDetail ? structuredClone(activeWorkspace.gitDetail) : null,
          }
        : null,
    };

    for (const listener of stateListeners) {
      listener(structuredClone(snapshot));
    }

    return snapshot;
  }

  function emitTerminal(payload) {
    for (const listener of terminalListeners) {
      listener(structuredClone(payload));
    }
  }

  function emitRuntimeEvent(payload) {
    activityHistory.unshift({
      kind: payload.kind,
      workspaceId: payload.workspaceId,
      paneId: payload.paneId || "",
      label: payload.label || "Terminal",
      error: payload.error ? String(payload.error) : "",
      at: Date.now(),
    });
    if (activityHistory.length > MAX_ACTIVITY_HISTORY) {
      activityHistory.length = MAX_ACTIVITY_HISTORY;
    }

    for (const listener of runtimeListeners) {
      listener(structuredClone(payload));
    }
  }

  function startWorkspace(workspace) {
    if (!workspace || workspace.started) {
      return;
    }

    workspace.started = true;
    workspace.panes.forEach((pane, index) => {
      pane.status = "booting";
      window.setTimeout(() => {
        if (!workspaces.some((entry) => entry.id === workspace.id)) {
          return;
        }

        const currentWorkspace = workspaces.find((entry) => entry.id === workspace.id);
        const currentPane = currentWorkspace?.panes.find((entry) => entry.id === pane.id);
        if (!currentPane) {
          return;
        }

        currentPane.status = "ready";
        emitState();
        emitRuntimeEvent({
          kind: "paneReady",
          workspaceId: workspace.id,
          paneId: currentPane.id,
          label: currentPane.label,
        });
        emitTerminal({
          paneId: pane.id,
          data:
            `CrewDock shell session attached\r\n` +
            `Session: ${currentPane.label}\r\n` +
            `Layout: ${workspace.layout.label}\r\n` +
            `Shell: /bin/zsh\r\n` +
            `Directory: ${workspace.path}\r\n\r\n` +
            `This is the mock fallback bridge. Type here and the session will echo.\r\n$ `,
        });
      }, 140 + index * 40);
    });

    emitState();
  }

  function workspaceName(path) {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  function buildMockGitDetail(path) {
    return {
      summary: {
        state: "clean",
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        counts: {
          staged: 0,
          modified: 0,
          deleted: 0,
          renamed: 0,
          untracked: 0,
          conflicted: 0,
        },
        isDirty: false,
        hasConflicts: false,
        message: null,
      },
      repoRoot: path,
      workspaceRelativePath: null,
      files: [],
    };
  }

  function buildMockBranches(workspace) {
    const currentBranch = workspace.gitDetail?.summary?.branch || "main";
    return {
      local: [
        {
          name: currentBranch,
          fullName: `refs/heads/${currentBranch}`,
          upstream: `origin/${currentBranch}`,
          shortOid: "a1b2c3d",
          subject: "Current workspace branch",
          relativeDate: "just now",
          isCurrent: true,
          isRemote: false,
        },
        {
          name: "feature/mock-ui",
          fullName: "refs/heads/feature/mock-ui",
          upstream: "origin/feature/mock-ui",
          shortOid: "d4e5f6a",
          subject: "Mock branch preview",
          relativeDate: "2h ago",
          isCurrent: false,
          isRemote: false,
        },
      ],
      remote: [
        {
          name: `origin/${currentBranch}`,
          fullName: `refs/remotes/origin/${currentBranch}`,
          upstream: null,
          shortOid: "a1b2c3d",
          subject: "Remote tracking branch",
          relativeDate: "just now",
          isCurrent: false,
          isRemote: true,
        },
      ],
    };
  }

  function buildMockGraph(workspace, graphCursor) {
    const skip = Number.parseInt(graphCursor || "0", 10) || 0;
    const base = [
      {
        oid: "a1b2c3d4",
        shortOid: "a1b2c3d",
        subject: "Polish source control chrome",
        author: "CrewDock",
        relativeDate: "10m ago",
        graphPrefix: "*",
        refs: [
          { label: "HEAD", kind: "head" },
          { label: workspace.gitDetail?.summary?.branch || "main", kind: "local-branch" },
          { label: `origin/${workspace.gitDetail?.summary?.branch || "main"}`, kind: "remote-branch" },
        ],
      },
      {
        oid: "d4e5f6a7",
        shortOid: "d4e5f6a",
        subject: "Add quick workspace switcher",
        author: "CrewDock",
        relativeDate: "1h ago",
        graphPrefix: "*",
        refs: [],
      },
      {
        oid: "f7a8b9c0",
        shortOid: "f7a8b9c",
        subject: "Initial mock graph history",
        author: "CrewDock",
        relativeDate: "1d ago",
        graphPrefix: "*",
        refs: [],
      },
    ];
    const commits = base.slice(skip, skip + 50);
    return {
      commits,
      nextCursor: skip + commits.length < base.length ? String(skip + commits.length) : null,
    };
  }

  function buildMockSourceControl(workspace, graphCursor = null) {
    const detail = workspace?.gitDetail || buildMockGitDetail(workspace?.path || "");
    const branches = buildMockBranches(workspace);
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      repoRoot: detail.repoRoot,
      workspaceRelativePath: detail.workspaceRelativePath,
      summary: detail.summary,
      changes: detail.files || [],
      localBranches: branches.local,
      remoteBranches: branches.remote,
      graph: buildMockGraph(workspace, graphCursor),
      task: workspace.gitTask || null,
    };
  }

  function buildMockDiff(path, mode) {
    return {
      path,
      originalPath: null,
      mode,
      text:
        `diff --git a/${path} b/${path}\n` +
        `index 1111111..2222222 100644\n` +
        `--- a/${path}\n` +
        `+++ b/${path}\n` +
        `@@ -1,3 +1,5 @@\n` +
        `-old line\n` +
        `+new line\n` +
        `+mock source control preview\n`,
      isBinary: false,
      isTruncated: false,
    };
  }

  function buildMockCommitDetail(oid) {
    return {
      oid,
      shortOid: oid.slice(0, 7),
      subject: "Mock commit detail",
      body: "This is a mock commit detail payload used in browser mode.",
      author: "CrewDock",
      email: "mock@crewdock.dev",
      relativeDate: "10m ago",
      refs: [],
      parents: [],
      files: [
        {
          status: "M",
          path: "src-web/app.js",
          originalPath: null,
        },
      ],
    };
  }

  return {
    getAppSnapshot: async () => emitState(),
    listenState: async (handler) => {
      stateListeners.add(handler);
      return () => stateListeners.delete(handler);
    },
    listenTerminalData: async (handler) => {
      terminalListeners.add(handler);
      return () => terminalListeners.delete(handler);
    },
    listenRuntimeEvents: async (handler) => {
      runtimeListeners.add(handler);
      return () => runtimeListeners.delete(handler);
    },
    listenDragDrop: async () => () => {},
    startDragging: async () => {},
    setTheme: async (themeId) => {
      if (!themeRegistry[themeId]) {
        throw new Error("theme not found");
      }

      settings.themeId = themeId;
      return emitState();
    },
    openDirectory: async (defaultPath) => {
      const value = window.prompt(
        "Workspace folder",
        defaultPath || "/Users/ashutoshbele/Desktop/ashlab/crewdock",
      );
      return value?.trim() || null;
    },
    resetToLauncher: async () => {
      workspaces = [];
      activeWorkspaceId = null;
      return emitState();
    },
    createWorkspace: async (path, paneCount) => {
      const normalizedPath = path.trim();
      const layout = deriveLayoutForPaneCount(paneCount);
      if (!layout) {
        return emitState();
      }

      workspaceCounter += 1;
      const workspace = {
        id: `workspace-${workspaceCounter}`,
        name: workspaceName(normalizedPath),
        path: normalizedPath,
        layout,
        started: false,
        gitDetail: buildMockGitDetail(normalizedPath),
        panes: Array.from({ length: layout.paneCount }, (_, index) => ({
          id: `pane-${workspaceCounter}-${index + 1}`,
          label: `Shell ${String(index + 1).padStart(2, "0")}`,
          status: "closed",
        })),
      };
      workspace.paneLayout = buildBalancedPaneLayout(
        workspace.panes.map((pane) => pane.id),
        layout.columns >= layout.rows,
      );

      workspaces.push(workspace);
      activeWorkspaceId = workspace.id;
      launcher.basePath = normalizedPath;
      startWorkspace(workspace);
      return emitState();
    },
    renameWorkspace: async (workspaceId, name) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const nextName = String(name || "").trim();
      if (!workspace || !nextName) {
        return emitState();
      }

      workspace.name = nextName;
      return emitState();
    },
    refreshWorkspaceGitStatus: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        workspace.gitDetail = buildMockGitDetail(workspace.path);
      }
      return emitState();
    },
    loadWorkspaceSourceControl: async (workspaceId, graphCursor = null) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }
      return buildMockSourceControl(workspace, graphCursor);
    },
    loadWorkspaceGitDiff: async (_workspaceId, path, mode) => buildMockDiff(path, mode),
    loadWorkspaceGitCommitDetail: async (_workspaceId, oid) => buildMockCommitDetail(oid),
    gitStagePaths: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitUnstagePaths: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitDiscardPaths: async (workspaceId, paths) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.files?.length) {
        workspace.gitDetail.files = workspace.gitDetail.files.filter((file) => !paths.includes(file.path));
      }
      return buildMockSourceControl(workspace);
    },
    gitCommit: async (workspaceId, message) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }
      workspace.gitTask = {
        id: `git-task-${Date.now()}`,
        title: "Commit",
        command: `git commit -m ${JSON.stringify(message)}`,
        status: "succeeded",
        output: "Mock commit completed successfully.\n",
        canWriteInput: false,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        exitCode: 0,
      };
      workspace.gitDetail = buildMockGitDetail(workspace.path);
      emitState();
      emitRuntimeEvent({
        kind: "gitTaskSnapshot",
        workspaceId: workspace.id,
        task: workspace.gitTask,
      });
      return buildMockSourceControl(workspace);
    },
    gitCheckoutBranch: async (workspaceId, branchName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.summary) {
        workspace.gitDetail.summary.branch = branchName;
      }
      return buildMockSourceControl(workspace);
    },
    gitCreateBranch: async (workspaceId, branchName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.summary) {
        workspace.gitDetail.summary.branch = branchName;
      }
      return buildMockSourceControl(workspace);
    },
    gitRenameBranch: async (workspaceId, currentName, nextName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.summary?.branch === currentName) {
        workspace.gitDetail.summary.branch = nextName;
      }
      return buildMockSourceControl(workspace);
    },
    gitDeleteBranch: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitFetch: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitPull: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitPush: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitPublishBranch: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      return buildMockSourceControl(workspace);
    },
    gitSetUpstream: async (workspaceId, branchName, upstreamName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.summary?.branch === branchName) {
        workspace.gitDetail.summary.upstream = upstreamName;
      }
      return buildMockSourceControl(workspace);
    },
    gitTaskWriteStdin: async () => {},
    switchWorkspace: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        return emitState();
      }

      activeWorkspaceId = workspace.id;
      launcher.basePath = workspace.path;
      startWorkspace(workspace);
      return emitState();
    },
    closeWorkspace: async (workspaceId) => {
      const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
      if (index === -1) {
        return emitState();
      }

      const isActive = activeWorkspaceId === workspaceId;
      workspaces.splice(index, 1);

      if (isActive) {
        if (index > 0) {
          activeWorkspaceId = workspaces[index - 1]?.id ?? null;
        } else {
          activeWorkspaceId = workspaces[0]?.id ?? null;
        }
      }

      return emitState();
    },
    splitPane: async (paneId, direction) => {
      const workspace = workspaces.find((entry) => entry.id === activeWorkspaceId);
      const paneIndex = workspace?.panes.findIndex((pane) => pane.id === paneId) ?? -1;
      if (!workspace || paneIndex === -1 || workspace.panes.length >= 16) {
        return emitState();
      }

      const insertAt = direction === "left" || direction === "up" ? paneIndex : paneIndex + 1;
      const nextCount = workspace.panes.length + 1;
      const layout = deriveLayoutForPaneCount(nextCount);
      const pane = {
        id: `pane-${workspace.id}-${Date.now()}`,
        label: "",
        status: workspace.started ? "booting" : "closed",
      };

      workspace.panes.splice(insertAt, 0, pane);
      relabelMockPanes(workspace.panes);
      workspace.layout = layout;
      workspace.paneLayout = splitPaneLayout(
        workspace.paneLayout,
        paneId,
        direction === "left" || direction === "right" ? "horizontal" : "vertical",
        direction === "left" || direction === "up",
        pane.id,
      );
      emitState();

      if (workspace.started) {
        window.setTimeout(() => {
          pane.status = "ready";
          emitState();
          emitRuntimeEvent({
            kind: "paneReady",
            workspaceId: workspace.id,
            paneId: pane.id,
            label: pane.label,
          });
          emitTerminal({
            paneId: pane.id,
            data:
              `CrewDock shell session attached\r\n` +
              `Session: ${pane.label}\r\n` +
              `Layout: ${workspace.layout.label}\r\n` +
              `Shell: /bin/zsh\r\n` +
              `Directory: ${workspace.path}\r\n\r\n$ `,
          });
        }, 120);
      }

      return emitState();
    },
    closePane: async (paneId) => {
      const workspace = workspaces.find((entry) => entry.panes.some((pane) => pane.id === paneId));
      if (!workspace || workspace.panes.length <= 1) {
        return emitState();
      }

      const closedPane = workspace.panes.find((pane) => pane.id === paneId) || null;
      workspaces = workspaces.map((entry) =>
        entry.id === workspace.id
          ? {
              ...entry,
              panes: entry.panes.filter((pane) => pane.id !== paneId),
            }
          : entry,
      );

      const currentWorkspace = workspaces.find((entry) => entry.id === workspace.id);
      if (!currentWorkspace) {
        return emitState();
      }

      relabelMockPanes(currentWorkspace.panes);
      currentWorkspace.layout = deriveLayoutForPaneCount(currentWorkspace.panes.length);
      currentWorkspace.paneLayout = removePaneLayout(currentWorkspace.paneLayout, paneId);
      const snapshot = emitState();
      if (closedPane) {
        emitRuntimeEvent({
          kind: "paneClosed",
          workspaceId: currentWorkspace.id,
          paneId,
          label: closedPane.label,
        });
      }
      return snapshot;
    },
    showInFinder: async () => {},
    runLauncherCommand: async (input) => {
      const command = String(input || "").trim();
      if (!command) {
        throw new Error("enter a command. Try help.");
      }

      if (command === "help") {
        return {
          basePath: launcher.basePath,
          output: ["Commands: help, pwd, ls [path], cd <path>, open [path], clear"],
          openPath: null,
          clearOutput: false,
        };
      }

      if (command === "pwd") {
        return {
          basePath: launcher.basePath,
          output: [launcher.basePath],
          openPath: null,
          clearOutput: false,
        };
      }

      if (command === "clear") {
        return {
          basePath: launcher.basePath,
          output: [],
          openPath: null,
          clearOutput: true,
        };
      }

      if (command === "ls" || command.startsWith("ls ")) {
        const target = command === "ls"
          ? launcher.basePath
          : resolveMockNavigationPath(launcher.basePath, command.slice(3));
        return {
          basePath: launcher.basePath,
          output: mockListDirectory(target),
          openPath: null,
          clearOutput: false,
        };
      }

      if (command === "open" || command.startsWith("open ")) {
        const target = command === "open"
          ? launcher.basePath
          : resolveMockNavigationPath(launcher.basePath, command.slice(5));
        launcher.basePath = target;
        return {
          basePath: launcher.basePath,
          output: [`Opening workspace at ${target}`],
          openPath: target,
          clearOutput: false,
        };
      }

      const nextPath = resolveMockNavigationPath(launcher.basePath, command);
      launcher.basePath = nextPath;
      return {
        basePath: launcher.basePath,
        output: [`cwd -> ${nextPath}`],
        openPath: null,
        clearOutput: false,
      };
    },
    completeLauncherInput: async (input) => completeMockLauncherInput(launcher.basePath, input),
    writeToPane: async (paneId, data) => {
      const output = data === "\r" ? "\r\n$ " : data;
      emitTerminal({ paneId, data: output });
    },
    resizePane: async () => {},
  };
}
