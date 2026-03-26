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
      setSettings: (themeId, interfaceTextScale, terminalFontSize) =>
        tauriApi.core.invoke("set_settings", {
          themeId,
          interfaceTextScale,
          terminalFontSize,
        }),
      setInterfaceTextScale: (interfaceTextScale) =>
        tauriApi.core.invoke("set_interface_text_scale", { interfaceTextScale }),
      setTerminalFontSize: (terminalFontSize) =>
        tauriApi.core.invoke("set_terminal_font_size", { terminalFontSize }),
      setOpenAiApiKey: (openaiApiKey) =>
        tauriApi.core.invoke("set_openai_api_key", { openaiApiKey }),
      setCodexCliPath: (codexCliPath) =>
        tauriApi.core.invoke("set_codex_cli_path", { codexCliPath }),
      refreshCodexCliCatalog: () =>
        tauriApi.core.invoke("refresh_codex_cli_catalog"),
      loadWorkspaceCodexSessions: (workspaceId) =>
        tauriApi.core.invoke("load_workspace_codex_sessions", { workspaceId }),
      resumeWorkspaceCodexSession: (workspaceId, paneId, sessionId) =>
        tauriApi.core.invoke("resume_workspace_codex_session", { workspaceId, paneId, sessionId }),
      startWorkspaceCodexSession: (workspaceId, paneId) =>
        tauriApi.core.invoke("start_workspace_codex_session", { workspaceId, paneId }),
      loadSystemHealthSnapshot: () =>
        tauriApi.core.invoke("load_system_health_snapshot"),
      createWorkspace: (path, paneCount) =>
        tauriApi.core.invoke("create_workspace", { path, paneCount }),
      renameWorkspace: (workspaceId, name) =>
        tauriApi.core.invoke("rename_workspace", { workspaceId, name }),
      addWorkspaceTodo: (workspaceId, text) =>
        tauriApi.core.invoke("add_workspace_todo", { workspaceId, text }),
      updateWorkspaceTodo: (workspaceId, todoId, text) =>
        tauriApi.core.invoke("update_workspace_todo", { workspaceId, todoId, text }),
      setWorkspaceTodoDone: (workspaceId, todoId, done) =>
        tauriApi.core.invoke("set_workspace_todo_done", { workspaceId, todoId, done }),
      deleteWorkspaceTodo: (workspaceId, todoId) =>
        tauriApi.core.invoke("delete_workspace_todo", { workspaceId, todoId }),
      reorderWorkspace: (workspaceId, targetIndex) =>
        tauriApi.core.invoke("reorder_workspace", { workspaceId, targetIndex }),
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
      generateGitCommitMessage: (workspaceId) =>
        tauriApi.core.invoke("generate_git_commit_message", { workspaceId }),
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
      gitPublishBranch: (workspaceId, branchName, remoteName = null) =>
        tauriApi.core.invoke("git_publish_branch", { workspaceId, branchName, remoteName }),
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
    interfaceTextScale: 1,
    terminalFontSize: 13.5,
    hasStoredOpenAiApiKey: false,
    hasEnvironmentOpenAiApiKey: false,
    codexCli: {
      status: "ready",
      selectionMode: "auto",
      configuredPath: null,
      effectivePath: "/usr/local/bin/codex",
      effectiveVersion: "0.116.0",
      message: "Using the newest detected Codex CLI on PATH.",
      candidates: [
        {
          path: "/usr/local/bin/codex",
          version: "0.116.0",
          source: "npmGlobal",
          isSelected: true,
        },
        {
          path: "/opt/homebrew/bin/codex",
          version: "0.42.0",
          source: "homebrew",
          isSelected: false,
        },
      ],
    },
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
            todos: activeWorkspace.todos.map((todo) => ({ ...todo })),
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

  function normalizeMockTodoText(text) {
    const normalized = String(text || "").trim();
    if (!normalized) {
      throw new Error("workspace task cannot be empty");
    }

    return normalized;
  }

  function buildMockTodoId() {
    return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function insertOpenMockTodo(workspace, todo) {
    const insertionIndex = workspace.todos.findIndex((entry) => entry.done);
    if (insertionIndex === -1) {
      workspace.todos.push(todo);
      return;
    }

    workspace.todos.splice(insertionIndex, 0, todo);
  }

  function buildMockGitDetail(path, { branch = "main", upstream } = {}) {
    const resolvedUpstream = upstream === undefined ? `origin/${branch}` : upstream;
    return {
      summary: {
        state: "clean",
        branch,
        upstream: resolvedUpstream,
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

  function syncMockGitDetail(workspace, updates = {}) {
    if (!workspace) {
      return null;
    }

    const detail = workspace.gitDetail || buildMockGitDetail(workspace.path);
    const branch = updates.branch ?? detail.summary?.branch ?? "main";
    const hasExplicitUpstream = Object.prototype.hasOwnProperty.call(updates, "upstream");
    const upstream = hasExplicitUpstream ? updates.upstream : detail.summary?.upstream;
    workspace.gitDetail = buildMockGitDetail(workspace.path, { branch, upstream });
    return workspace.gitDetail;
  }

  function buildMockRemotes() {
    return [
      {
        name: "origin",
        isDefault: true,
      },
    ];
  }

  function buildMockBranches(workspace) {
    const currentBranch = workspace?.gitDetail?.summary?.branch || "main";
    const currentUpstream = workspace?.gitDetail?.summary?.upstream ?? null;
    return {
      local: [
        {
          name: currentBranch,
          fullName: `refs/heads/${currentBranch}`,
          upstream: currentUpstream,
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
          name: currentUpstream || "origin/main",
          fullName: `refs/remotes/${currentUpstream || "origin/main"}`,
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
    const currentBranch = workspace.gitDetail?.summary?.branch || "main";
    const currentUpstream = workspace.gitDetail?.summary?.upstream || null;
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
          { label: currentBranch, kind: "local-branch" },
          ...(currentUpstream ? [{ label: currentUpstream, kind: "remote-branch" }] : []),
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

  function buildMockCodexSessionsSnapshot(workspace) {
    const rememberedSessionId = workspace?.codexSessionId || null;
    const sessions = Array.from({ length: 2 }, (_, index) => ({
      id: `session-${workspace.id}-${index + 1}`,
      cwd: workspace.path,
      displayTitle: `${workspace.name}: ${index === 0 ? "Resume recent CrewDock work" : "Review workspace follow-ups"}`,
      cliVersion: settings.codexCli.effectiveVersion || "0.116.0",
      source: "cli",
      originator: "codex_cli_rs",
      lastActiveAtMs: Date.now() - index * 1000 * 60 * 14,
      isRemembered: false,
    })).map((session) => ({
      ...session,
      isRemembered: session.id === rememberedSessionId,
    }));

    return {
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      cliStatus: settings.codexCli.status,
      cliMessage: settings.codexCli.message,
      effectiveCliPath: settings.codexCli.effectivePath,
      effectiveCliVersion: settings.codexCli.effectiveVersion,
      rememberedSessionId,
      rememberedSessionMissing: Boolean(rememberedSessionId)
        && !sessions.some((session) => session.id === rememberedSessionId),
      sessions,
    };
  }

  function buildMockSourceControl(workspace, graphCursor = null) {
    const detail = workspace?.gitDetail || buildMockGitDetail(workspace?.path || "");
    const branches = buildMockBranches(workspace);
    const remotes = buildMockRemotes();
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      repoRoot: detail.repoRoot,
      workspaceRelativePath: detail.workspaceRelativePath,
      summary: detail.summary,
      changes: detail.files || [],
      remotes,
      defaultRemote: remotes.find((remote) => remote.isDefault)?.name || remotes[0]?.name || null,
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

  function generateMockCommitMessage(workspace) {
    const files = workspace?.gitDetail?.files || [];
    if (!files.length) {
      return "chore: refresh workspace state";
    }

    const primary = files[0]?.path?.split("/").pop() || "workspace";
    const touchesUi = files.some((file) => file.path?.startsWith("src-web/"));
    const touchesCore = files.some((file) => file.path?.startsWith("src-tauri/"));

    if (touchesUi && touchesCore) {
      return `refine source control across ui and backend`;
    }

    if (touchesUi) {
      return `polish ${primary.replace(/\.[^.]+$/, "")} source control ui`;
    }

    if (touchesCore) {
      return `update ${primary.replace(/\.[^.]+$/, "")} git integration`;
    }

    return `update ${primary.replace(/\.[^.]+$/, "")}`;
  }

  function buildMockSystemHealthSnapshot() {
    const now = Date.now();
    const tick = Math.floor(now / 1000);
    const cpuPercent = 18 + (tick % 17);
    const memoryPercent = 46 + ((tick * 3) % 22);
    const memoryTotalBytes = 32 * 1024 * 1024 * 1024;
    const memoryUsedBytes = Math.round(memoryTotalBytes * (memoryPercent / 100));
    const diskPercent = 61;
    const diskTotalBytes = 512 * 1024 * 1024 * 1024;
    const diskUsedBytes = Math.round(diskTotalBytes * (diskPercent / 100));
    const batteryPercent = 84;

    return {
      availability: "ready",
      cpuPercent,
      memoryUsedBytes,
      memoryTotalBytes,
      memoryPercent,
      diskUsedBytes,
      diskTotalBytes,
      diskPercent,
      batteryPercent,
      batteryState: "charging",
      lastRefreshedAtMs: now,
      errorMessage: null,
    };
  }

  return {
    getAppSnapshot: async () => emitState(),
    loadSystemHealthSnapshot: async () => buildMockSystemHealthSnapshot(),
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
    setSettings: async (themeId, interfaceTextScale, terminalFontSize) => {
      if (!themeRegistry[themeId]) {
        throw new Error("theme not found");
      }

      settings.themeId = themeId;
      settings.interfaceTextScale = Number(interfaceTextScale) || 1;
      settings.terminalFontSize = Number(terminalFontSize) || 13.5;
      return emitState();
    },
    setInterfaceTextScale: async (interfaceTextScale) => {
      settings.interfaceTextScale = Number(interfaceTextScale) || 1;
      return emitState();
    },
    setTerminalFontSize: async (terminalFontSize) => {
      settings.terminalFontSize = Number(terminalFontSize) || 13.5;
      return emitState();
    },
    setOpenAiApiKey: async (openaiApiKey) => {
      settings.hasStoredOpenAiApiKey = Boolean(String(openaiApiKey || "").trim());
      return emitState();
    },
    setCodexCliPath: async (codexCliPath) => {
      const normalized = typeof codexCliPath === "string" ? codexCliPath.trim() : "";
      settings.codexCli.configuredPath = normalized || null;
      settings.codexCli.selectionMode = settings.codexCli.configuredPath ? "custom" : "auto";
      settings.codexCli.message = settings.codexCli.configuredPath
        ? "Using the configured Codex CLI path."
        : "Using the newest detected Codex CLI on PATH.";
      const selectedPath = settings.codexCli.configuredPath || settings.codexCli.candidates[0]?.path || null;
      const selectedCandidate = settings.codexCli.candidates.find((candidate) => candidate.path === selectedPath)
        || settings.codexCli.candidates[0]
        || null;
      settings.codexCli.effectivePath = selectedCandidate?.path || normalized || null;
      settings.codexCli.effectiveVersion = selectedCandidate?.version || null;
      settings.codexCli.candidates = settings.codexCli.candidates.map((candidate) => ({
        ...candidate,
        isSelected: candidate.path === settings.codexCli.effectivePath,
      }));
      return emitState();
    },
    refreshCodexCliCatalog: async () => emitState(),
    loadWorkspaceCodexSessions: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }

      return buildMockCodexSessionsSnapshot(workspace);
    },
    resumeWorkspaceCodexSession: async (workspaceId, paneId, sessionId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }
      const pane = workspace.panes.find((entry) => entry.id === paneId);
      if (!pane) {
        throw new Error("pane does not belong to the workspace");
      }

      workspace.codexSessionId = String(sessionId || "").trim() || null;
      emitTerminal({
        paneId,
        data:
          `\r\n$ ${settings.codexCli.effectivePath || "codex"} resume ${workspace.codexSessionId} -C ${workspace.path}\r\n`
          + `Resuming Codex session for ${workspace.name} in the mock bridge.\r\n$ `,
      });
      return emitState();
    },
    startWorkspaceCodexSession: async (workspaceId, paneId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }
      const pane = workspace.panes.find((entry) => entry.id === paneId);
      if (!pane) {
        throw new Error("pane does not belong to the workspace");
      }

      emitTerminal({
        paneId,
        data:
          `\r\n$ ${settings.codexCli.effectivePath || "codex"} -C ${workspace.path}\r\n`
          + `Starting a fresh Codex session for ${workspace.name} in the mock bridge.\r\n$ `,
      });
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
        codexSessionId: null,
        todos: [],
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
    addWorkspaceTodo: async (workspaceId, text) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }

      insertOpenMockTodo(workspace, {
        id: buildMockTodoId(),
        text: normalizeMockTodoText(text),
        done: false,
      });
      return emitState();
    },
    updateWorkspaceTodo: async (workspaceId, todoId, text) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }

      const todo = workspace.todos.find((entry) => entry.id === todoId);
      if (!todo) {
        throw new Error("workspace task not found");
      }

      todo.text = normalizeMockTodoText(text);
      return emitState();
    },
    setWorkspaceTodoDone: async (workspaceId, todoId, done) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }

      const todoIndex = workspace.todos.findIndex((entry) => entry.id === todoId);
      if (todoIndex === -1) {
        throw new Error("workspace task not found");
      }

      const [todo] = workspace.todos.splice(todoIndex, 1);
      todo.done = Boolean(done);
      if (todo.done) {
        workspace.todos.push(todo);
      } else {
        insertOpenMockTodo(workspace, todo);
      }

      return emitState();
    },
    deleteWorkspaceTodo: async (workspaceId, todoId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }

      const todoIndex = workspace.todos.findIndex((entry) => entry.id === todoId);
      if (todoIndex === -1) {
        throw new Error("workspace task not found");
      }

      workspace.todos.splice(todoIndex, 1);
      return emitState();
    },
    reorderWorkspace: async (workspaceId, targetIndex) => {
      const sourceIndex = workspaces.findIndex((entry) => entry.id === workspaceId);
      if (sourceIndex === -1) {
        return emitState();
      }

      const [workspace] = workspaces.splice(sourceIndex, 1);
      const insertionIndex = Math.max(0, Math.min(Number(targetIndex) || 0, workspaces.length));
      workspaces.splice(insertionIndex, 0, workspace);
      return emitState();
    },
    refreshWorkspaceGitStatus: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        syncMockGitDetail(workspace);
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
    generateGitCommitMessage: async (workspaceId) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        throw new Error("workspace not found");
      }
      return generateMockCommitMessage(workspace);
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
        recovery: null,
      };
      syncMockGitDetail(workspace);
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
      if (workspace) {
        syncMockGitDetail(workspace, {
          branch: branchName,
          upstream: branchName === "main" ? "origin/main" : null,
        });
      }
      return buildMockSourceControl(workspace);
    },
    gitCreateBranch: async (workspaceId, branchName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        syncMockGitDetail(workspace, { branch: branchName, upstream: null });
      }
      return buildMockSourceControl(workspace);
    },
    gitRenameBranch: async (workspaceId, currentName, nextName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.summary?.branch === currentName) {
        const upstream = workspace.gitDetail.summary.upstream
          ? workspace.gitDetail.summary.upstream.replace(`/${currentName}`, `/${nextName}`)
          : null;
        syncMockGitDetail(workspace, { branch: nextName, upstream });
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
    gitPublishBranch: async (workspaceId, branchName, remoteName = null) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        const remote = remoteName || "origin";
        syncMockGitDetail(workspace, {
          branch: branchName,
          upstream: `${remote}/${branchName}`,
        });
      }
      return buildMockSourceControl(workspace);
    },
    gitSetUpstream: async (workspaceId, branchName, upstreamName) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (workspace?.gitDetail?.summary?.branch === branchName) {
        syncMockGitDetail(workspace, { branch: branchName, upstream: upstreamName });
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
