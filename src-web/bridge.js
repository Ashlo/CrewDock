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

  function emitState() {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    const snapshot = {
      launcher,
      settings,
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
