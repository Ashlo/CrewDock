mod events;
mod persistence;
mod session_manager;
mod source_control;
mod workspace_manager;

#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    env,
    ffi::{OsStr, OsString},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use portable_pty::{ChildKiller, PtySize};
use serde::{Deserialize, Serialize};
use sysinfo::{CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};
use tauri::{AppHandle, Manager, State};

const MAX_LAUNCHER_COMPLETION_MATCHES: usize = 24;
const LAUNCHER_COMMANDS: [&str; 6] = ["help", "pwd", "ls", "cd", "open", "clear"];
const PATH_AWARE_LAUNCHER_COMMANDS: [&str; 3] = ["ls", "cd", "open"];
const DEFAULT_INTERFACE_TEXT_SCALE: f64 = 1.0;
const MIN_INTERFACE_TEXT_SCALE: f64 = 0.85;
const MAX_INTERFACE_TEXT_SCALE: f64 = 1.2;
const DEFAULT_TERMINAL_FONT_SIZE: f64 = 13.5;
const MIN_TERMINAL_FONT_SIZE: f64 = 11.0;
const MAX_TERMINAL_FONT_SIZE: f64 = 18.0;
const MAX_CODEX_SESSION_SCAN_LINES: usize = 80;
const MAX_CODEX_SESSION_TITLE_CHARS: usize = 72;
const CODEX_PENDING_START_DISCOVERY_ATTEMPTS: usize = 20;
const CODEX_PENDING_START_DISCOVERY_INTERVAL_MS: u64 = 750;
const MAX_WORKSPACE_TEXT_FILE_BYTES: u64 = 1024 * 1024;
const FILE_EXPLORER_HIDDEN_NAMES: [&str; 14] = [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "coverage",
    "target",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
];
const LOGIN_SHELL_PATH_START_MARKER: &[u8] = b"__CREWDOCK_PATH_START__";
const LOGIN_SHELL_PATH_END_MARKER: &[u8] = b"__CREWDOCK_PATH_END__";

use events::emit_runtime_event;
use persistence::resolve_persistence_path;
use session_manager::{prepare_workspace_launch, spawn_pane_jobs, LiveSession, PaneJob};
use source_control::{
    build_commit_message_generation_request, discard_paths, generate_commit_message_with_openai,
    git_task_write_stdin as write_git_task_input, load_git_remotes,
    load_workspace_source_control as build_workspace_source_control,
    load_workspace_source_control_from_context as build_workspace_source_control_from_context,
    select_default_git_remote, stage_paths, start_git_task, unstage_paths,
    workspace_source_control_context, GitCommitDetailSnapshot, GitDiffMode, GitDiffSnapshot,
    GitTaskRecord, WorkspaceSourceControlSnapshot,
};

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<RuntimeState>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeState::seeded())),
        }
    }
}

#[derive(Clone)]
struct SystemHealthState {
    inner: Arc<Mutex<SystemHealthMonitor>>,
}

impl Default for SystemHealthState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SystemHealthMonitor::new())),
        }
    }
}

struct RuntimeState {
    next_id: u64,
    shell: String,
    launcher: LauncherSnapshot,
    settings: SettingsRecord,
    codex_cli: CodexCliSnapshot,
    workspaces: Vec<WorkspaceRecord>,
    active_workspace_id: Option<String>,
    activity_history: Vec<persistence::ActivityEventRecord>,
    sessions: HashMap<String, LiveSession>,
    git_tasks: HashMap<String, GitTaskRecord>,
    pending_codex_starts: Vec<PendingCodexStartRecord>,
    persistence_path: Option<PathBuf>,
    persistence: persistence::PersistenceCoordinator,
}

struct SystemHealthMonitor {
    system: System,
    disks: Disks,
}

#[derive(Debug, Clone)]
struct WorkspaceRecord {
    id: String,
    name: String,
    path: String,
    layout: LayoutPreset,
    panes: Vec<PaneRecord>,
    pane_layout: PaneLayout,
    todos: Vec<WorkspaceTodoRecord>,
    started: bool,
    git: Option<GitDetailSnapshot>,
    codex_session_id: Option<String>,
    codex_restore_bindings: Vec<CodexPaneRestoreBindingRecord>,
    file_draft: Option<WorkspaceFileDraftRecord>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CodexRestoreBindingKind {
    Codex,
}

#[derive(Debug, Clone)]
struct CodexPaneRestoreBindingRecord {
    slot_index: usize,
    kind: CodexRestoreBindingKind,
    session_id: String,
    cwd: String,
    last_bound_at_ms: u64,
}

#[derive(Debug, Clone)]
struct PendingCodexStartRecord {
    workspace_id: String,
    pane_id: String,
    pane_slot_index: usize,
    cwd: String,
    started_at_ms: u64,
    known_session_ids: HashSet<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTodoRecord {
    id: String,
    text: String,
    done: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileDraftRecord {
    relative_path: String,
    draft: String,
    base_version_token: String,
}

#[derive(Debug, Clone)]
struct SettingsRecord {
    theme_id: ThemeId,
    interface_text_scale: f64,
    terminal_font_size: f64,
    openai_api_key: Option<String>,
    codex_cli_path: Option<String>,
}

impl Default for SettingsRecord {
    fn default() -> Self {
        Self {
            theme_id: ThemeId::default(),
            interface_text_scale: DEFAULT_INTERFACE_TEXT_SCALE,
            terminal_font_size: DEFAULT_TERMINAL_FONT_SIZE,
            openai_api_key: None,
            codex_cli_path: None,
        }
    }
}

impl RuntimeState {
    fn seeded() -> Self {
        Self {
            next_id: 0,
            shell: env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()),
            launcher: LauncherSnapshot {
                presets: layout_presets(),
                base_path: default_launcher_path(),
            },
            settings: SettingsRecord::default(),
            codex_cli: CodexCliSnapshot::unavailable("CrewDock has not scanned for Codex CLI yet."),
            workspaces: Vec::new(),
            active_workspace_id: None,
            activity_history: Vec::new(),
            sessions: HashMap::new(),
            git_tasks: HashMap::new(),
            pending_codex_starts: Vec::new(),
            persistence_path: None,
            persistence: persistence::PersistenceCoordinator::default(),
        }
    }

    fn next_id(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}-{}", self.next_id)
    }

    fn build_snapshot(&self) -> AppSnapshot {
        let active_workspace_record = self.active_workspace_id.as_ref().and_then(|workspace_id| {
            self.workspaces
                .iter()
                .find(|workspace| workspace.id == *workspace_id)
        });
        let active_workspace = active_workspace_record.map(|workspace| WorkspaceSnapshot {
            id: workspace.id.clone(),
            name: workspace.name.clone(),
            path: workspace.path.clone(),
            layout: workspace.layout.clone(),
            panes: workspace.panes.clone(),
            pane_layout: workspace.pane_layout.clone(),
            todos: workspace.todos.clone(),
            git_detail: workspace.git.clone(),
            file_draft: workspace.file_draft.clone(),
        });
        let active_workspace_name = active_workspace_record.map(|workspace| workspace.name.clone());
        let window_title = active_workspace_name
            .as_ref()
            .map(|name| format!("{name} · CrewDock"))
            .unwrap_or_else(|| "CrewDock".to_string());

        AppSnapshot {
            window: AppWindowSnapshot {
                id: "window-main".to_string(),
                label: "Primary".to_string(),
                title: window_title,
                workspace_count: self.workspaces.len(),
                active_workspace_id: self.active_workspace_id.clone(),
                active_workspace_name,
            },
            launcher: self.launcher.clone(),
            settings: SettingsSnapshot {
                theme_id: self.settings.theme_id,
                interface_text_scale: self.settings.interface_text_scale,
                terminal_font_size: self.settings.terminal_font_size,
                has_stored_openai_api_key: self.settings.openai_api_key.is_some(),
                has_environment_openai_api_key: has_openai_api_key_in_environment(),
                codex_cli: self.codex_cli.clone(),
            },
            activity: persistence::build_activity_snapshot(self),
            workspaces: self
                .workspaces
                .iter()
                .map(|workspace| WorkspaceTabSnapshot {
                    id: workspace.id.clone(),
                    name: workspace.name.clone(),
                    path: workspace.path.clone(),
                    layout: workspace.layout.clone(),
                    is_live: workspace.started,
                    has_file_draft: workspace.file_draft.is_some(),
                    git_summary: workspace.git.as_ref().map(|git| git.summary.clone()),
                })
                .collect(),
            active_workspace_id: self.active_workspace_id.clone(),
            active_workspace,
        }
    }

    fn build_workspace_record(
        &mut self,
        path: &Path,
        pane_count: u8,
        persisted_layout: Option<&PersistedPaneLayout>,
    ) -> Result<WorkspaceRecord, String> {
        workspace_manager::build_workspace_record(self, path, pane_count, persisted_layout)
    }

    fn active_workspace_path(&self) -> Option<String> {
        workspace_manager::active_workspace_path(self)
    }

    fn active_workspace_index(&self) -> Option<usize> {
        workspace_manager::active_workspace_index(self)
    }

    fn refresh_codex_cli(&mut self) {
        sync_process_path_with_login_shell(&self.shell);
        self.codex_cli = detect_codex_cli_snapshot(self.settings.codex_cli_path.as_deref());
    }

    fn persisted_state(&self) -> persistence::PersistedWorkspaceState {
        persistence::build_persisted_state(self)
    }

    fn persist_to_disk(&self) -> Result<(), String> {
        persistence::persist_to_disk(self)
    }

    fn load_persisted_from_disk(&mut self, path: PathBuf) -> Result<(), String> {
        persistence::load_persisted_from_disk(self, path)
    }

    fn drain_all_killers(&mut self) -> Vec<Box<dyn ChildKiller + Send + Sync>> {
        self.sessions
            .drain()
            .map(|(_, session)| session.killer)
            .collect()
    }

    fn drain_workspace_killers(
        &mut self,
        workspace_id: &str,
    ) -> Vec<Box<dyn ChildKiller + Send + Sync>> {
        let pane_ids: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|(pane_id, session)| {
                if session.workspace_id == workspace_id {
                    Some(pane_id.clone())
                } else {
                    None
                }
            })
            .collect();

        pane_ids
            .into_iter()
            .filter_map(|pane_id| self.sessions.remove(&pane_id).map(|session| session.killer))
            .collect()
    }

    fn clear_pending_codex_starts_for_workspace(&mut self, workspace_id: &str) {
        self.pending_codex_starts
            .retain(|pending| pending.workspace_id != workspace_id);
    }

    fn clear_pending_codex_start_for_pane(&mut self, pane_id: &str) {
        self.pending_codex_starts
            .retain(|pending| pending.pane_id != pane_id);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSnapshot {
    window: AppWindowSnapshot,
    launcher: LauncherSnapshot,
    settings: SettingsSnapshot,
    activity: persistence::ActivitySnapshot,
    workspaces: Vec<WorkspaceTabSnapshot>,
    active_workspace_id: Option<String>,
    active_workspace: Option<WorkspaceSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppWindowSnapshot {
    id: String,
    label: String,
    title: String,
    workspace_count: usize,
    active_workspace_id: Option<String>,
    active_workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSnapshot {
    presets: Vec<LayoutPreset>,
    base_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSnapshot {
    theme_id: ThemeId,
    interface_text_scale: f64,
    terminal_font_size: f64,
    #[serde(rename = "hasStoredOpenAiApiKey")]
    has_stored_openai_api_key: bool,
    #[serde(rename = "hasEnvironmentOpenAiApiKey")]
    has_environment_openai_api_key: bool,
    codex_cli: CodexCliSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexCliSnapshot {
    status: CodexCliStatus,
    selection_mode: CodexCliSelectionMode,
    configured_path: Option<String>,
    effective_path: Option<String>,
    effective_version: Option<String>,
    message: Option<String>,
    candidates: Vec<CodexCliCandidateSnapshot>,
}

impl CodexCliSnapshot {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: CodexCliStatus::Unavailable,
            selection_mode: CodexCliSelectionMode::Auto,
            configured_path: None,
            effective_path: None,
            effective_version: None,
            message: Some(message.into()),
            candidates: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexCliCandidateSnapshot {
    path: String,
    version: String,
    source: CodexCliSource,
    is_selected: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CodexCliStatus {
    Ready,
    Unavailable,
    InvalidSelection,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CodexCliSelectionMode {
    Auto,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CodexCliSource {
    Homebrew,
    NpmGlobal,
    Nvm,
    Volta,
    Path,
    Custom,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCodexSessionsSnapshot {
    workspace_id: String,
    workspace_path: String,
    cli_status: CodexCliStatus,
    cli_message: Option<String>,
    effective_cli_path: Option<String>,
    effective_cli_version: Option<String>,
    remembered_session_id: Option<String>,
    remembered_session_missing: bool,
    sessions: Vec<CodexSessionMatchSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexSessionMatchSnapshot {
    id: String,
    cwd: String,
    display_title: String,
    cli_version: Option<String>,
    source: Option<String>,
    originator: Option<String>,
    last_active_at_ms: u64,
    is_remembered: bool,
}

#[derive(Debug, Deserialize)]
struct CodexSessionJsonLine {
    #[serde(rename = "type")]
    line_type: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
struct CodexSessionMetaPayload {
    id: String,
    cwd: String,
    #[serde(default)]
    cli_version: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    originator: Option<String>,
}

#[derive(Debug)]
struct CodexSessionFileSummary {
    meta: CodexSessionMetaPayload,
    first_user_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemHealthSnapshot {
    availability: SystemHealthAvailability,
    cpu_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    memory_percent: f64,
    disk_used_bytes: u64,
    disk_total_bytes: u64,
    disk_percent: f64,
    battery_percent: Option<f64>,
    battery_state: Option<BatteryState>,
    last_refreshed_at_ms: u64,
    error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum SystemHealthAvailability {
    Ready,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum BatteryState {
    Charging,
    Discharging,
    Full,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherCommandResult {
    base_path: String,
    output: Vec<String>,
    open_path: Option<String>,
    clear_output: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherCompletionResult {
    completed_input: String,
    matches: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileExplorerDirectorySnapshot {
    workspace_id: String,
    relative_path: String,
    entries: Vec<WorkspaceFileExplorerEntrySnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTextFileSnapshot {
    workspace_id: String,
    relative_path: String,
    content: String,
    size_bytes: u64,
    newline_style: WorkspaceTextFileNewlineStyle,
    has_trailing_newline: bool,
    version_token: String,
    read_only: bool,
    reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum WorkspaceTextFileNewlineStyle {
    Lf,
    CrLf,
    Cr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileExplorerEntrySnapshot {
    name: String,
    relative_path: String,
    kind: WorkspaceFileExplorerEntryKind,
    expandable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum WorkspaceFileExplorerEntryKind {
    Directory,
    File,
    Symlink,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTabSnapshot {
    id: String,
    name: String,
    path: String,
    layout: LayoutPreset,
    is_live: bool,
    has_file_draft: bool,
    git_summary: Option<GitSummarySnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    id: String,
    name: String,
    path: String,
    layout: LayoutPreset,
    panes: Vec<PaneRecord>,
    pane_layout: PaneLayout,
    todos: Vec<WorkspaceTodoRecord>,
    git_detail: Option<GitDetailSnapshot>,
    file_draft: Option<WorkspaceFileDraftRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitSummaryUpdateSnapshot {
    workspace_id: String,
    summary: GitSummarySnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitSummarySnapshot {
    state: GitState,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    counts: GitCountsSnapshot,
    is_dirty: bool,
    has_conflicts: bool,
    message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCountsSnapshot {
    staged: u32,
    modified: u32,
    deleted: u32,
    renamed: u32,
    untracked: u32,
    conflicted: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitDetailSnapshot {
    summary: GitSummarySnapshot,
    repo_root: Option<String>,
    workspace_relative_path: Option<String>,
    files: Vec<GitFileSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitFileSnapshot {
    path: String,
    original_path: Option<String>,
    kind: GitFileKind,
    index_status: Option<GitFileStatus>,
    worktree_status: Option<GitFileStatus>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GitState {
    Clean,
    Dirty,
    Conflicted,
    Detached,
    NotRepo,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GitFileKind {
    Staged,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GitFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LayoutPreset {
    id: String,
    label: String,
    rows: u8,
    columns: u8,
    pane_count: u8,
}

impl LayoutPreset {
    fn new(id: &str, label: String, rows: u8, columns: u8, pane_count: u8) -> Self {
        Self {
            id: id.into(),
            label,
            rows,
            columns,
            pane_count,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneRecord {
    id: String,
    label: String,
    status: PaneStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PaneLayout {
    Leaf {
        pane_id: String,
    },
    Split {
        axis: SplitAxis,
        first: Box<PaneLayout>,
        second: Box<PaneLayout>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SplitAxis {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PaneStatus {
    Booting,
    Ready,
    Closed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ThemeId {
    OneDark,
    TokyoNight,
    GruvboxMaterialDark,
    Dracula,
    CatppuccinMocha,
    CatppuccinLatte,
}

impl Default for ThemeId {
    fn default() -> Self {
        Self::OneDark
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ExternalWorkspaceTargetKind {
    Editor,
    System,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ExternalWorkspaceTargetSnapshot {
    id: String,
    label: String,
    kind: ExternalWorkspaceTargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExternalWorkspaceTargetSpec {
    id: &'static str,
    label: &'static str,
    kind: ExternalWorkspaceTargetKind,
    app_name: Option<&'static str>,
}

const EXTERNAL_WORKSPACE_TARGET_SPECS: [ExternalWorkspaceTargetSpec; 11] = [
    ExternalWorkspaceTargetSpec {
        id: "cursor",
        label: "Cursor",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Cursor"),
    },
    ExternalWorkspaceTargetSpec {
        id: "antigravity",
        label: "Antigravity",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Antigravity"),
    },
    ExternalWorkspaceTargetSpec {
        id: "vscode",
        label: "VS Code",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Visual Studio Code"),
    },
    ExternalWorkspaceTargetSpec {
        id: "windsurf",
        label: "Windsurf",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Windsurf"),
    },
    ExternalWorkspaceTargetSpec {
        id: "zed",
        label: "Zed",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Zed"),
    },
    ExternalWorkspaceTargetSpec {
        id: "xcode",
        label: "Xcode",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Xcode"),
    },
    ExternalWorkspaceTargetSpec {
        id: "android-studio",
        label: "Android Studio",
        kind: ExternalWorkspaceTargetKind::Editor,
        app_name: Some("Android Studio"),
    },
    ExternalWorkspaceTargetSpec {
        id: "finder",
        label: "Finder",
        kind: ExternalWorkspaceTargetKind::System,
        app_name: None,
    },
    ExternalWorkspaceTargetSpec {
        id: "terminal",
        label: "Terminal",
        kind: ExternalWorkspaceTargetKind::System,
        app_name: Some("Terminal"),
    },
    ExternalWorkspaceTargetSpec {
        id: "iterm2",
        label: "iTerm2",
        kind: ExternalWorkspaceTargetKind::System,
        app_name: Some("iTerm"),
    },
    ExternalWorkspaceTargetSpec {
        id: "warp",
        label: "Warp",
        kind: ExternalWorkspaceTargetKind::System,
        app_name: Some("Warp"),
    },
];

impl ThemeId {
    fn as_str(self) -> &'static str {
        match self {
            Self::OneDark => "one-dark",
            Self::TokyoNight => "tokyo-night",
            Self::GruvboxMaterialDark => "gruvbox-material-dark",
            Self::Dracula => "dracula",
            Self::CatppuccinMocha => "catppuccin-mocha",
            Self::CatppuccinLatte => "catppuccin-latte",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "one-dark" => Some(Self::OneDark),
            "tokyo-night" => Some(Self::TokyoNight),
            "gruvbox-material-dark" => Some(Self::GruvboxMaterialDark),
            "dracula" => Some(Self::Dracula),
            "catppuccin-mocha" => Some(Self::CatppuccinMocha),
            "catppuccin-latte" => Some(Self::CatppuccinLatte),
            _ => None,
        }
    }
}

fn normalize_interface_text_scale(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_INTERFACE_TEXT_SCALE;
    }

    value.clamp(MIN_INTERFACE_TEXT_SCALE, MAX_INTERFACE_TEXT_SCALE)
}

fn normalize_terminal_font_size(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_TERMINAL_FONT_SIZE;
    }

    value.clamp(MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE)
}

fn normalize_optional_openai_api_key(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn has_openai_api_key_in_environment() -> bool {
    env::var("OPENAI_API_KEY")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn normalize_optional_codex_cli_path(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_optional_codex_session_id(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn now_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn workspace_pane_slot_index(workspace: &WorkspaceRecord, pane_id: &str) -> Option<usize> {
    workspace.panes.iter().position(|pane| pane.id == pane_id)
}

fn binding_for_workspace_pane_slot(
    workspace: &WorkspaceRecord,
    slot_index: usize,
) -> Option<&CodexPaneRestoreBindingRecord> {
    workspace
        .codex_restore_bindings
        .iter()
        .find(|binding| binding.slot_index == slot_index)
}

fn upsert_workspace_codex_restore_binding(
    workspace: &mut WorkspaceRecord,
    slot_index: usize,
    session_id: String,
    cwd: String,
    at: u64,
) {
    if let Some(binding) = workspace
        .codex_restore_bindings
        .iter_mut()
        .find(|binding| binding.slot_index == slot_index)
    {
        binding.kind = CodexRestoreBindingKind::Codex;
        binding.session_id = session_id;
        binding.cwd = cwd;
        binding.last_bound_at_ms = at;
    } else {
        workspace
            .codex_restore_bindings
            .push(CodexPaneRestoreBindingRecord {
                slot_index,
                kind: CodexRestoreBindingKind::Codex,
                session_id,
                cwd,
                last_bound_at_ms: at,
            });
    }

    workspace
        .codex_restore_bindings
        .sort_by(|left, right| left.slot_index.cmp(&right.slot_index));
}

fn remove_workspace_codex_restore_binding(workspace: &mut WorkspaceRecord, slot_index: usize) {
    workspace
        .codex_restore_bindings
        .retain(|binding| binding.slot_index != slot_index);
}

fn shift_workspace_codex_restore_bindings_for_insert(
    workspace: &mut WorkspaceRecord,
    insertion_index: usize,
) {
    for binding in &mut workspace.codex_restore_bindings {
        if binding.slot_index >= insertion_index {
            binding.slot_index += 1;
        }
    }
}

fn shift_workspace_codex_restore_bindings_for_remove(
    workspace: &mut WorkspaceRecord,
    removed_index: usize,
) {
    workspace
        .codex_restore_bindings
        .retain(|binding| binding.slot_index != removed_index);
    for binding in &mut workspace.codex_restore_bindings {
        if binding.slot_index > removed_index {
            binding.slot_index -= 1;
        }
    }
}

fn shift_pending_codex_starts_for_insert(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    insertion_index: usize,
) {
    for pending in &mut runtime.pending_codex_starts {
        if pending.workspace_id == workspace_id && pending.pane_slot_index >= insertion_index {
            pending.pane_slot_index += 1;
        }
    }
}

fn shift_pending_codex_starts_for_remove(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    removed_index: usize,
    removed_pane_id: &str,
) {
    runtime.pending_codex_starts.retain(|pending| {
        !(pending.workspace_id == workspace_id && pending.pane_id == removed_pane_id)
    });

    for pending in &mut runtime.pending_codex_starts {
        if pending.workspace_id == workspace_id && pending.pane_slot_index > removed_index {
            pending.pane_slot_index -= 1;
        }
    }
}

fn detect_codex_cli_snapshot(configured_path: Option<&str>) -> CodexCliSnapshot {
    let configured_path = configured_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let candidates = discover_codex_cli_candidates();
    let mut configured_candidate = None;
    let mut configured_error = None;

    if let Some(path) = configured_path.as_deref() {
        match probe_codex_cli_candidate(Path::new(path), CodexCliSource::Custom) {
            Ok(candidate) => configured_candidate = Some(candidate),
            Err(error) => configured_error = Some(error),
        }
    }

    build_codex_cli_snapshot(
        configured_path,
        candidates,
        configured_candidate,
        configured_error,
    )
}

fn sync_process_path_with_login_shell(shell: &str) {
    let current_path = env::var_os("PATH");
    let Some(login_shell_path) = read_login_shell_path(shell) else {
        return;
    };
    let Some(merged_path) =
        merge_path_values(Some(login_shell_path.as_os_str()), current_path.as_deref())
    else {
        return;
    };

    if current_path.as_deref() == Some(merged_path.as_os_str()) {
        return;
    }

    env::set_var("PATH", merged_path);
}

fn read_login_shell_path(shell: &str) -> Option<OsString> {
    let shell = shell.trim();
    if shell.is_empty() {
        return None;
    }

    let output = ProcessCommand::new(shell)
        .arg("-l")
        .arg("-c")
        .arg("printf '__CREWDOCK_PATH_START__%s__CREWDOCK_PATH_END__' \"$PATH\"")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    extract_login_shell_path(&output.stdout)
}

fn extract_login_shell_path(output: &[u8]) -> Option<OsString> {
    let start = find_subslice(output, LOGIN_SHELL_PATH_START_MARKER)?;
    let start = start + LOGIN_SHELL_PATH_START_MARKER.len();
    let end = find_subslice(&output[start..], LOGIN_SHELL_PATH_END_MARKER)?;
    let path_bytes = &output[start..start + end];
    if path_bytes.is_empty() {
        return None;
    }

    #[cfg(unix)]
    {
        Some(OsString::from_vec(path_bytes.to_vec()))
    }

    #[cfg(not(unix))]
    {
        Some(OsString::from(
            String::from_utf8_lossy(path_bytes).into_owned(),
        ))
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }

    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn merge_path_values(preferred: Option<&OsStr>, fallback: Option<&OsStr>) -> Option<OsString> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();

    for raw_path in [preferred, fallback].into_iter().flatten() {
        for path in env::split_paths(raw_path) {
            if path.as_os_str().is_empty() {
                continue;
            }

            let key = path.as_os_str().to_os_string();
            if seen.insert(key) {
                merged.push(path);
            }
        }
    }

    if merged.is_empty() {
        return None;
    }

    env::join_paths(merged).ok()
}

fn build_codex_cli_snapshot(
    configured_path: Option<String>,
    mut candidates: Vec<CodexCliCandidateSnapshot>,
    configured_candidate: Option<CodexCliCandidateSnapshot>,
    configured_error: Option<String>,
) -> CodexCliSnapshot {
    if let Some(candidate) = configured_candidate {
        merge_codex_cli_candidate(&mut candidates, candidate);
    }

    sort_codex_cli_candidates(&mut candidates);

    let selection_mode = if configured_path.is_some() {
        CodexCliSelectionMode::Custom
    } else {
        CodexCliSelectionMode::Auto
    };

    let effective_path = configured_path
        .as_ref()
        .and_then(|path| {
            let configured_key = canonical_codex_path_key(Path::new(path));
            candidates
                .iter()
                .find(|candidate| {
                    canonical_codex_path_key(Path::new(&candidate.path)) == configured_key
                })
                .map(|candidate| candidate.path.clone())
        })
        .or_else(|| candidates.first().map(|candidate| candidate.path.clone()));

    let effective_version = effective_path.as_ref().and_then(|selected_path| {
        candidates
            .iter()
            .find(|candidate| candidate.path == *selected_path)
            .map(|candidate| candidate.version.clone())
    });

    for candidate in &mut candidates {
        candidate.is_selected = effective_path
            .as_ref()
            .map(|selected_path| selected_path == &candidate.path)
            .unwrap_or(false);
    }

    let (status, message) = match (
        configured_path.as_ref(),
        configured_error.as_ref(),
        effective_path.as_ref(),
    ) {
        (Some(_), Some(error), Some(_)) => (
            CodexCliStatus::InvalidSelection,
            Some(format!(
                "{error} CrewDock fell back to the newest detected Codex CLI."
            )),
        ),
        (Some(_), Some(error), None) => (CodexCliStatus::InvalidSelection, Some(error.clone())),
        (Some(_), None, Some(_)) => (
            CodexCliStatus::Ready,
            Some("Using the configured Codex CLI path.".to_string()),
        ),
        (Some(_), None, None) => (
            CodexCliStatus::InvalidSelection,
            Some("CrewDock could not resolve the configured Codex CLI path.".to_string()),
        ),
        (None, _, Some(_)) => (
            CodexCliStatus::Ready,
            if candidates.len() > 1 {
                Some("Using the newest detected Codex CLI on PATH.".to_string())
            } else {
                Some("Using the detected Codex CLI on PATH.".to_string())
            },
        ),
        (None, _, None) => (
            CodexCliStatus::Unavailable,
            Some("No Codex CLI installation was detected on PATH.".to_string()),
        ),
    };

    CodexCliSnapshot {
        status,
        selection_mode,
        configured_path,
        effective_path,
        effective_version,
        message,
        candidates,
    }
}

fn discover_codex_cli_candidates() -> Vec<CodexCliCandidateSnapshot> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for path in discover_codex_cli_candidate_paths() {
        let key = canonical_codex_path_key(&path);
        if !seen.insert(key) {
            continue;
        }

        if let Ok(candidate) = probe_codex_cli_candidate(&path, infer_codex_cli_source(&path)) {
            candidates.push(candidate);
        }
    }

    candidates
}

fn discover_codex_cli_candidate_paths() -> Vec<PathBuf> {
    let mut results = Vec::new();
    let Some(raw_path) = env::var_os("PATH") else {
        return results;
    };

    let executable_names: &[&str] = if cfg!(target_os = "windows") {
        &["codex.exe", "codex.cmd", "codex.bat", "codex"]
    } else {
        &["codex"]
    };

    for directory in env::split_paths(&raw_path) {
        for executable_name in executable_names {
            let candidate = directory.join(executable_name);
            if candidate.is_file() {
                results.push(candidate);
            }
        }
    }

    results
}

fn probe_codex_cli_candidate(
    path: &Path,
    source: CodexCliSource,
) -> Result<CodexCliCandidateSnapshot, String> {
    if !path.is_absolute() {
        return Err("Enter an absolute path to the Codex CLI binary.".to_string());
    }

    if !path.is_file() {
        return Err(format!("Codex CLI was not found at {}.", path.display()));
    }

    let output = ProcessCommand::new(path)
        .arg("--version")
        .output()
        .map_err(|error| format!("Failed to run {}: {error}", path.display()))?;
    let combined_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if !output.status.success() {
        let reason = combined_output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("Codex CLI exited with an error.");
        return Err(format!(
            "Configured Codex CLI path is not usable: {}",
            reason
        ));
    }

    let version = parse_codex_cli_version(&combined_output).ok_or_else(|| {
        format!(
            "CrewDock could not parse a Codex CLI version from {}.",
            path.display()
        )
    })?;

    Ok(CodexCliCandidateSnapshot {
        path: path.display().to_string(),
        version,
        source,
        is_selected: false,
    })
}

fn parse_codex_cli_version(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        while let Some(part) = parts.next() {
            if part == "codex-cli" {
                return parts.next().map(str::to_string);
            }
        }
        None
    })
}

fn infer_codex_cli_source(path: &Path) -> CodexCliSource {
    let display = path.display().to_string().to_lowercase();
    if display.contains("/.volta/") {
        CodexCliSource::Volta
    } else if display.contains("/.nvm/") {
        CodexCliSource::Nvm
    } else if display.contains("/cellar/") || display.contains("/linuxbrew/") {
        CodexCliSource::Homebrew
    } else if display.contains("node_modules") {
        CodexCliSource::NpmGlobal
    } else {
        CodexCliSource::Path
    }
}

fn merge_codex_cli_candidate(
    candidates: &mut Vec<CodexCliCandidateSnapshot>,
    incoming: CodexCliCandidateSnapshot,
) {
    let incoming_key = canonical_codex_path_key(Path::new(&incoming.path));
    if let Some(existing) = candidates
        .iter_mut()
        .find(|candidate| canonical_codex_path_key(Path::new(&candidate.path)) == incoming_key)
    {
        if compare_codex_cli_versions(&incoming.version, &existing.version).is_gt() {
            existing.version = incoming.version;
        }
        if incoming.source == CodexCliSource::Custom {
            existing.source = CodexCliSource::Custom;
        }
        return;
    }

    candidates.push(incoming);
}

fn sort_codex_cli_candidates(candidates: &mut [CodexCliCandidateSnapshot]) {
    candidates.sort_by(|left, right| {
        compare_codex_cli_versions(&right.version, &left.version)
            .then_with(|| left.path.cmp(&right.path))
    });
}

fn compare_codex_cli_versions(left: &str, right: &str) -> Ordering {
    let left_parts = parse_codex_cli_version_parts(left);
    let right_parts = parse_codex_cli_version_parts(right);
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        let left_value = *left_parts.get(index).unwrap_or(&0);
        let right_value = *right_parts.get(index).unwrap_or(&0);
        match left_value.cmp(&right_value) {
            Ordering::Equal => continue,
            ordering => return ordering,
        }
    }

    Ordering::Equal
}

fn parse_codex_cli_version_parts(version: &str) -> Vec<u64> {
    version
        .split('.')
        .filter_map(|part| {
            let digits = part
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>();
            if digits.is_empty() {
                None
            } else {
                digits.parse::<u64>().ok()
            }
        })
        .collect()
}

fn canonical_codex_path_key(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .display()
        .to_string()
}

fn load_workspace_codex_sessions_snapshot(
    workspace_id: &str,
    workspace_path: &str,
    remembered_session_id: Option<&str>,
    codex_cli: &CodexCliSnapshot,
) -> WorkspaceCodexSessionsSnapshot {
    let remembered_session_id = remembered_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let sessions =
        discover_codex_sessions_for_workspace(workspace_path, remembered_session_id.as_deref());
    let remembered_session_missing = remembered_session_id
        .as_ref()
        .map(|session_id| !sessions.iter().any(|session| session.id == *session_id))
        .unwrap_or(false);

    WorkspaceCodexSessionsSnapshot {
        workspace_id: workspace_id.to_string(),
        workspace_path: workspace_path.to_string(),
        cli_status: codex_cli.status,
        cli_message: codex_cli.message.clone(),
        effective_cli_path: codex_cli.effective_path.clone(),
        effective_cli_version: codex_cli.effective_version.clone(),
        remembered_session_id,
        remembered_session_missing,
        sessions,
    }
}

fn discover_codex_sessions_for_workspace(
    workspace_path: &str,
    remembered_session_id: Option<&str>,
) -> Vec<CodexSessionMatchSnapshot> {
    let Some(root) = codex_sessions_root() else {
        return Vec::new();
    };
    if !root.is_dir() {
        return Vec::new();
    }

    let workspace_key = normalize_path_for_comparison(workspace_path);
    let mut matches = Vec::new();

    for session_file in collect_codex_session_files(&root) {
        let Some(summary) = read_codex_session_summary(&session_file) else {
            continue;
        };
        if normalize_path_for_comparison(&summary.meta.cwd) != workspace_key {
            continue;
        }

        let last_active_at_ms = fs::metadata(&session_file)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);

        matches.push(CodexSessionMatchSnapshot {
            id: summary.meta.id.clone(),
            cwd: summary.meta.cwd.clone(),
            display_title: build_codex_session_display_title(
                &summary.meta.cwd,
                summary.first_user_prompt.as_deref(),
            ),
            cli_version: summary.meta.cli_version,
            source: summary.meta.source,
            originator: summary.meta.originator,
            last_active_at_ms,
            is_remembered: remembered_session_id
                .map(|session_id| session_id == summary.meta.id.as_str())
                .unwrap_or(false),
        });
    }

    matches.sort_by(|left, right| {
        right
            .last_active_at_ms
            .cmp(&left.last_active_at_ms)
            .then_with(|| left.id.cmp(&right.id))
    });
    matches
}

fn discover_codex_session_metas_for_workspace(
    workspace_path: &str,
) -> Vec<CodexSessionMetaPayload> {
    let Some(root) = codex_sessions_root() else {
        return Vec::new();
    };
    if !root.is_dir() {
        return Vec::new();
    }

    let workspace_key = normalize_path_for_comparison(workspace_path);
    let mut matches = Vec::new();

    for session_file in collect_codex_session_files(&root) {
        let Some(summary) = read_codex_session_summary(&session_file) else {
            continue;
        };
        if normalize_path_for_comparison(&summary.meta.cwd) != workspace_key {
            continue;
        }
        matches.push(summary.meta);
    }

    matches
}

fn discover_codex_session_ids_for_workspace(workspace_path: &str) -> HashSet<String> {
    discover_codex_session_metas_for_workspace(workspace_path)
        .into_iter()
        .map(|meta| meta.id)
        .collect()
}

fn find_codex_session_meta_for_workspace(
    workspace_path: &str,
    session_id: &str,
) -> Option<CodexSessionMetaPayload> {
    discover_codex_session_metas_for_workspace(workspace_path)
        .into_iter()
        .find(|meta| meta.id == session_id)
}

fn maybe_auto_restore_codex_for_ready_pane(
    shared: &Arc<Mutex<RuntimeState>>,
    app: &AppHandle,
    workspace_id: &str,
    pane_id: &str,
) -> Result<(), String> {
    let outcome: (
        Option<Arc<Mutex<Box<dyn Write + Send>>>>,
        Option<String>,
        Option<events::RuntimeEvent>,
        Option<events::RuntimeEvent>,
        Option<events::RuntimeEvent>,
    ) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let Some(workspace_index) = runtime
            .workspaces
            .iter()
            .position(|workspace| workspace.id == workspace_id)
        else {
            return Ok(());
        };
        let Some(slot_index) =
            workspace_pane_slot_index(&runtime.workspaces[workspace_index], pane_id)
        else {
            return Ok(());
        };
        let Some(binding) =
            binding_for_workspace_pane_slot(&runtime.workspaces[workspace_index], slot_index)
                .cloned()
        else {
            return Ok(());
        };

        let Some(writer) = runtime.sessions.get(pane_id).and_then(|session| {
            (session.workspace_id == workspace_id).then_some(session.writer.clone())
        }) else {
            return Ok(());
        };

        if runtime.codex_cli.effective_path.is_none() {
            let error = runtime
                .codex_cli
                .message
                .clone()
                .unwrap_or_else(|| "No Codex CLI is configured.".to_string());
            (
                None,
                None,
                None,
                None,
                Some(events::RuntimeEvent::CodexRestoreFailed {
                    workspace_id: workspace_id.to_string(),
                    pane_id: pane_id.to_string(),
                    session_id: Some(binding.session_id.clone()),
                    error,
                }),
            )
        } else if find_codex_session_meta_for_workspace(&binding.cwd, &binding.session_id).is_none()
        {
            remove_workspace_codex_restore_binding(
                &mut runtime.workspaces[workspace_index],
                slot_index,
            );
            runtime.persist_to_disk()?;
            (
                None,
                None,
                None,
                None,
                Some(events::RuntimeEvent::CodexRestoreFailed {
                    workspace_id: workspace_id.to_string(),
                    pane_id: pane_id.to_string(),
                    session_id: Some(binding.session_id.clone()),
                    error: "Saved Codex session is no longer present in local history.".to_string(),
                }),
            )
        } else {
            let codex_binary = runtime.codex_cli.effective_path.clone().unwrap_or_default();
            let command = format!(
                "{} resume {} -C {}\n",
                shell_escape(&codex_binary),
                shell_escape(&binding.session_id),
                shell_escape(&binding.cwd),
            );
            (
                Some(writer),
                Some(command),
                Some(events::RuntimeEvent::CodexRestoreStarted {
                    workspace_id: workspace_id.to_string(),
                    pane_id: pane_id.to_string(),
                    session_id: binding.session_id.clone(),
                }),
                Some(events::RuntimeEvent::CodexRestoreSucceeded {
                    workspace_id: workspace_id.to_string(),
                    pane_id: pane_id.to_string(),
                    session_id: binding.session_id.clone(),
                }),
                None,
            )
        }
    };
    let (writer, command, start_event, success_event, failure_event) = outcome;
    if let Some(event) = failure_event.as_ref() {
        emit_runtime_event(app, event)?;
        return Ok(());
    }

    let Some(writer) = writer else {
        return Ok(());
    };
    let Some(command) = command else {
        return Ok(());
    };

    if let Some(event) = start_event.as_ref() {
        emit_runtime_event(app, event)?;
    }

    if let Err(error) = write_shell_command(&writer, &command) {
        let session_id = match start_event.as_ref() {
            Some(events::RuntimeEvent::CodexRestoreStarted { session_id, .. }) => {
                Some(session_id.clone())
            }
            _ => None,
        };
        emit_runtime_event(
            app,
            &events::RuntimeEvent::CodexRestoreFailed {
                workspace_id: workspace_id.to_string(),
                pane_id: pane_id.to_string(),
                session_id,
                error,
            },
        )?;
        return Ok(());
    }

    if let Some(event) = success_event.as_ref() {
        emit_runtime_event(app, event)?;
    }
    Ok(())
}

fn spawn_pending_codex_start_discovery(
    shared: Arc<Mutex<RuntimeState>>,
    _app: AppHandle,
    workspace_id: String,
) {
    std::thread::spawn(move || {
        for _ in 0..CODEX_PENDING_START_DISCOVERY_ATTEMPTS {
            match try_bind_pending_codex_start(&shared, &workspace_id) {
                Ok(true) => return,
                Ok(false) => {
                    std::thread::sleep(std::time::Duration::from_millis(
                        CODEX_PENDING_START_DISCOVERY_INTERVAL_MS,
                    ));
                }
                Err(error) => {
                    eprintln!("failed to bind fresh Codex session: {error}");
                    return;
                }
            }
        }
    });
}

fn try_bind_pending_codex_start(
    shared: &Arc<Mutex<RuntimeState>>,
    workspace_id: &str,
) -> Result<bool, String> {
    let pending = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let Some(workspace) = runtime
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
        else {
            runtime.clear_pending_codex_starts_for_workspace(workspace_id);
            return Ok(true);
        };

        let pending_for_workspace = runtime
            .pending_codex_starts
            .iter()
            .filter(|pending| pending.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        if pending_for_workspace.is_empty() {
            return Ok(true);
        }
        if pending_for_workspace.len() > 1 {
            runtime.clear_pending_codex_starts_for_workspace(workspace_id);
            return Ok(true);
        }

        let pending = pending_for_workspace[0].clone();
        if workspace_pane_slot_index(workspace, &pending.pane_id).is_none() {
            runtime.clear_pending_codex_start_for_pane(&pending.pane_id);
            return Ok(true);
        }
        pending
    };

    let session_metas = discover_codex_session_metas_for_workspace(&pending.cwd);
    let new_sessions = session_metas
        .into_iter()
        .filter(|meta| !pending.known_session_ids.contains(meta.id.as_str()))
        .collect::<Vec<_>>();
    if new_sessions.is_empty() {
        return Ok(false);
    }

    if new_sessions.len() > 1 {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        runtime.clear_pending_codex_starts_for_workspace(workspace_id);
        return Ok(true);
    }

    let discovered = new_sessions[0].clone();
    {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let Some(workspace_index) = runtime
            .workspaces
            .iter()
            .position(|workspace| workspace.id == workspace_id)
        else {
            runtime.clear_pending_codex_starts_for_workspace(workspace_id);
            return Ok(true);
        };
        let pending_count = runtime
            .pending_codex_starts
            .iter()
            .filter(|entry| entry.workspace_id == workspace_id)
            .count();
        if pending_count != 1 {
            runtime.clear_pending_codex_starts_for_workspace(workspace_id);
            return Ok(true);
        }
        let Some(current_pending) = runtime
            .pending_codex_starts
            .iter()
            .find(|entry| entry.workspace_id == workspace_id)
            .cloned()
        else {
            return Ok(true);
        };
        if current_pending.pane_id != pending.pane_id
            || current_pending.started_at_ms != pending.started_at_ms
        {
            return Ok(true);
        }

        upsert_workspace_codex_restore_binding(
            &mut runtime.workspaces[workspace_index],
            pending.pane_slot_index,
            discovered.id.clone(),
            discovered.cwd.clone(),
            now_timestamp_ms(),
        );
        runtime.workspaces[workspace_index].codex_session_id = Some(discovered.id.clone());
        runtime.clear_pending_codex_start_for_pane(&pending.pane_id);
        runtime.persist_to_disk()?;
    };

    Ok(true)
}

fn codex_sessions_root() -> Option<PathBuf> {
    home_dir()
        .ok()
        .map(|path| path.join(".codex").join("sessions"))
}

fn collect_codex_session_files(root: &Path) -> Vec<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(directory) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("jsonl"))
                .unwrap_or(false)
            {
                files.push(path);
            }
        }
    }

    files
}

fn read_codex_session_summary(path: &Path) -> Option<CodexSessionFileSummary> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut meta = None;
    let mut first_user_prompt = None;
    let mut scanned_records = 0usize;

    for line in reader.lines() {
        if scanned_records >= MAX_CODEX_SESSION_SCAN_LINES {
            break;
        }

        let Ok(line) = line else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        scanned_records += 1;

        let Ok(record) = serde_json::from_str::<CodexSessionJsonLine>(trimmed) else {
            continue;
        };

        if meta.is_none() && record.line_type == "session_meta" {
            meta = serde_json::from_value(record.payload.clone()).ok();
        }

        if first_user_prompt.is_none() {
            if let Some(candidate) = extract_codex_user_prompt_from_record(&record) {
                if normalize_codex_prompt_for_title(&candidate).is_some() {
                    first_user_prompt = Some(candidate);
                }
            }
        }

        if meta.is_some() && first_user_prompt.is_some() {
            break;
        }
    }

    meta.map(|meta| CodexSessionFileSummary {
        meta,
        first_user_prompt,
    })
}

fn extract_codex_user_prompt_from_record(record: &CodexSessionJsonLine) -> Option<String> {
    match record.line_type.as_str() {
        "event_msg" => extract_codex_event_user_message(&record.payload),
        "response_item" => extract_codex_response_item_user_message(&record.payload),
        _ => None,
    }
}

fn extract_codex_event_user_message(payload: &serde_json::Value) -> Option<String> {
    if payload.get("type").and_then(|value| value.as_str()) != Some("user_message") {
        return None;
    }

    payload
        .get("message")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn extract_codex_response_item_user_message(payload: &serde_json::Value) -> Option<String> {
    if payload.get("type").and_then(|value| value.as_str()) != Some("message") {
        return None;
    }
    if payload.get("role").and_then(|value| value.as_str()) != Some("user") {
        return None;
    }

    let content = payload.get("content")?.as_array()?;
    let text = content
        .iter()
        .filter_map(|entry| entry.get("text").and_then(|value| value.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn build_codex_session_display_title(cwd: &str, first_user_prompt: Option<&str>) -> String {
    let context_label = codex_session_context_label(cwd);
    let Some(summary) = first_user_prompt.and_then(normalize_codex_prompt_for_title) else {
        return format!("{context_label} session");
    };

    format!("{context_label}: {summary}")
}

fn codex_session_context_label(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Workspace".to_string())
}

fn normalize_codex_prompt_for_title(prompt: &str) -> Option<String> {
    let stripped = strip_codex_wrapper_blocks(prompt);
    let without_instruction_headers = strip_codex_instruction_headers(&stripped);
    let without_images = strip_codex_image_placeholders(&without_instruction_headers);
    let without_urls = strip_leading_codex_urls(&collapse_whitespace(&without_images));
    let trimmed = trim_codex_title_leading_phrase(without_urls.trim());
    if !is_meaningful_codex_prompt(trimmed) {
        return None;
    }

    let summary = summarize_codex_prompt(trimmed);
    if summary.is_empty() {
        None
    } else {
        Some(summary)
    }
}

fn strip_codex_wrapper_blocks(prompt: &str) -> String {
    [
        "image",
        "environment_context",
        "proposed_plan",
        "INSTRUCTIONS",
    ]
    .into_iter()
    .fold(prompt.to_string(), |value, tag| {
        remove_tag_block(&value, tag)
    })
}

fn strip_codex_instruction_headers(value: &str) -> String {
    let mut output = Vec::new();

    for line in value.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# AGENTS.md instructions for ") {
            continue;
        }
        output.push(line);
    }

    output.join("\n")
}

fn remove_tag_block(input: &str, tag: &str) -> String {
    let open_marker = format!("<{tag}");
    let close_marker = format!("</{tag}>");
    let mut output = input.to_string();

    loop {
        let Some(start) = output.find(&open_marker) else {
            break;
        };
        let Some(end_offset) = output[start..].find(&close_marker) else {
            break;
        };
        let end = start + end_offset + close_marker.len();
        output.replace_range(start..end, " ");
    }

    output
}

fn strip_codex_image_placeholders(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(start) = rest.find("[Image #") {
        output.push_str(&rest[..start]);
        let placeholder = &rest[start..];
        let Some(end) = placeholder.find(']') else {
            rest = &rest[start..];
            break;
        };
        rest = &placeholder[end + 1..];
    }

    output.push_str(rest);
    output
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_leading_codex_urls(value: &str) -> String {
    let mut tokens = value.split_whitespace().collect::<Vec<_>>();
    while tokens.len() > 1
        && tokens
            .first()
            .map(|token| token.starts_with("http://") || token.starts_with("https://"))
            .unwrap_or(false)
    {
        tokens.remove(0);
    }
    tokens.join(" ")
}

fn trim_codex_title_leading_phrase(value: &str) -> &str {
    let prefixes = [
        "can you please ",
        "could you please ",
        "can you ",
        "could you ",
        "would you ",
        "will you ",
        "please ",
        "i want you to ",
        "i need you to ",
        "help me ",
    ];
    let mut trimmed = value.trim();

    loop {
        let lower = trimmed.to_ascii_lowercase();
        let Some(prefix) = prefixes.iter().find(|prefix| lower.starts_with(**prefix)) else {
            break;
        };
        let next = trimmed[prefix.len()..].trim_start();
        if next.is_empty() {
            break;
        }
        trimmed = next;
    }

    trimmed
}

fn is_meaningful_codex_prompt(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 6 {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    !lower.starts_with("<environment_context>")
}

fn summarize_codex_prompt(value: &str) -> String {
    let boundary = value
        .char_indices()
        .find_map(|(index, character)| match character {
            '.' | '!' | '?' | ';' if index >= 24 => Some(index),
            _ => None,
        })
        .unwrap_or(value.len());
    let summary = value[..boundary]
        .trim()
        .trim_end_matches(|character: char| ".!?,;:".contains(character))
        .trim();

    truncate_chars(summary, MAX_CODEX_SESSION_TITLE_CHARS)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut characters = value.chars();
    let truncated = characters.by_ref().take(max_chars).collect::<String>();
    if characters.next().is_some() {
        let mut shortened = truncated.trim_end().to_string();
        shortened.push_str("...");
        shortened
    } else {
        truncated
    }
}

fn normalize_path_for_comparison(path: &str) -> String {
    normalize_workspace_path(path)
        .unwrap_or_else(|_| PathBuf::from(path))
        .display()
        .to_string()
}

fn resolve_workspace_root(
    runtime: &RuntimeState,
    workspace_id: &str,
) -> Result<(String, PathBuf), String> {
    let workspace = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;

    Ok((
        workspace.id.clone(),
        normalize_workspace_path(&workspace.path)?,
    ))
}

#[cfg(test)]
fn load_workspace_file_explorer_directory_snapshot(
    runtime: &RuntimeState,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceFileExplorerDirectorySnapshot, String> {
    let (workspace_id, workspace_root) = resolve_workspace_root(runtime, workspace_id)?;
    load_workspace_file_explorer_directory_snapshot_for_root(
        &workspace_id,
        &workspace_root,
        relative_path,
    )
}

fn load_workspace_file_explorer_directory_snapshot_for_root(
    workspace_id: &str,
    workspace_root: &Path,
    relative_path: &str,
) -> Result<WorkspaceFileExplorerDirectorySnapshot, String> {
    let normalized_relative_path = normalize_workspace_relative_path(relative_path)?;
    let target = resolve_workspace_file_explorer_target(workspace_root, &normalized_relative_path)?;
    let entries =
        list_workspace_file_explorer_entries(workspace_root, &normalized_relative_path, &target)?;

    Ok(WorkspaceFileExplorerDirectorySnapshot {
        workspace_id: workspace_id.to_string(),
        relative_path: normalized_relative_path,
        entries,
    })
}

fn normalize_workspace_relative_path(raw: &str) -> Result<String, String> {
    if Path::new(raw.trim()).is_absolute() {
        return Err("path must be workspace-relative".to_string());
    }

    let normalized = raw.replace('\\', "/");
    let mut parts = Vec::new();

    for part in normalized.split('/') {
        let segment = part.trim();
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err("path traversal outside the workspace is not allowed".to_string());
        }
        if segment.contains('\0') {
            return Err("invalid workspace-relative path".to_string());
        }
        parts.push(segment);
    }

    Ok(parts.join("/"))
}

fn resolve_workspace_file_explorer_target(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let target = if relative_path.is_empty() {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(relative_path)
    };

    let metadata = fs::symlink_metadata(&target)
        .map_err(|error| format!("failed to access directory: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("symlinked directories cannot be expanded".to_string());
    }

    let resolved = fs::canonicalize(&target)
        .map_err(|error| format!("failed to access directory: {error}"))?;
    if !resolved.starts_with(workspace_root) {
        return Err("path escapes the workspace root".to_string());
    }
    if !resolved.is_dir() {
        return Err("path must be a directory".to_string());
    }

    Ok(resolved)
}

struct ResolvedWorkspaceTextFileTarget {
    workspace_id: String,
    relative_path: String,
    target_path: PathBuf,
    metadata: fs::Metadata,
    is_symlink: bool,
}

fn resolve_workspace_text_file_target_for_root(
    workspace_id: &str,
    workspace_root: &Path,
    relative_path: &str,
) -> Result<ResolvedWorkspaceTextFileTarget, String> {
    let normalized_relative_path = normalize_workspace_relative_path(relative_path)?;
    if normalized_relative_path.is_empty() {
        return Err("path must be workspace-relative".to_string());
    }

    let target_path = workspace_root.join(&normalized_relative_path);
    let metadata = fs::symlink_metadata(&target_path)
        .map_err(|error| format!("failed to access file: {error}"))?;
    let is_symlink = metadata.file_type().is_symlink();
    if !is_symlink {
        let resolved = fs::canonicalize(&target_path)
            .map_err(|error| format!("failed to access file: {error}"))?;
        if !resolved.starts_with(&workspace_root) {
            return Err("path escapes the workspace root".to_string());
        }
        if !resolved.is_file() {
            return Err("path must be a file".to_string());
        }
    }

    Ok(ResolvedWorkspaceTextFileTarget {
        workspace_id: workspace_id.to_string(),
        relative_path: normalized_relative_path,
        target_path,
        metadata,
        is_symlink,
    })
}

fn workspace_text_file_metadata_version_token(metadata: &fs::Metadata) -> String {
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}:{modified_ns}", metadata.len())
}

fn workspace_text_file_content_version_token(bytes: &[u8]) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    format!("{}:{hash:016x}", bytes.len())
}

fn detect_workspace_text_file_newline_style(
    content: &str,
) -> Result<WorkspaceTextFileNewlineStyle, String> {
    let bytes = content.as_bytes();
    let mut saw_lf = false;
    let mut saw_crlf = false;
    let mut saw_cr = false;
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                if bytes.get(index + 1) == Some(&b'\n') {
                    saw_crlf = true;
                    index += 2;
                } else {
                    saw_cr = true;
                    index += 1;
                }
            }
            b'\n' => {
                saw_lf = true;
                index += 1;
            }
            _ => {
                index += 1;
            }
        }
    }

    let newline_variant_count = usize::from(saw_lf) + usize::from(saw_crlf) + usize::from(saw_cr);
    if newline_variant_count > 1 {
        return Err("CrewDock only edits files with a single newline style.".to_string());
    }

    Ok(if saw_crlf {
        WorkspaceTextFileNewlineStyle::CrLf
    } else if saw_cr {
        WorkspaceTextFileNewlineStyle::Cr
    } else {
        WorkspaceTextFileNewlineStyle::Lf
    })
}

#[cfg(test)]
fn load_workspace_text_file_snapshot(
    runtime: &RuntimeState,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceTextFileSnapshot, String> {
    let (workspace_id, workspace_root) = resolve_workspace_root(runtime, workspace_id)?;
    load_workspace_text_file_snapshot_for_root(&workspace_id, &workspace_root, relative_path)
}

fn load_workspace_text_file_snapshot_for_root(
    workspace_id: &str,
    workspace_root: &Path,
    relative_path: &str,
) -> Result<WorkspaceTextFileSnapshot, String> {
    let resolved =
        resolve_workspace_text_file_target_for_root(workspace_id, workspace_root, relative_path)?;
    let metadata_version_token = workspace_text_file_metadata_version_token(&resolved.metadata);

    if resolved.is_symlink {
        return Ok(WorkspaceTextFileSnapshot {
            workspace_id: resolved.workspace_id,
            relative_path: resolved.relative_path,
            content: String::new(),
            size_bytes: resolved.metadata.len(),
            newline_style: WorkspaceTextFileNewlineStyle::Lf,
            has_trailing_newline: false,
            version_token: metadata_version_token,
            read_only: true,
            reason: Some("Symlinked files are not editable in CrewDock yet.".to_string()),
        });
    }

    if resolved.metadata.len() > MAX_WORKSPACE_TEXT_FILE_BYTES {
        return Ok(WorkspaceTextFileSnapshot {
            workspace_id: resolved.workspace_id,
            relative_path: resolved.relative_path,
            content: String::new(),
            size_bytes: resolved.metadata.len(),
            newline_style: WorkspaceTextFileNewlineStyle::Lf,
            has_trailing_newline: false,
            version_token: metadata_version_token,
            read_only: true,
            reason: Some(format!(
                "CrewDock only edits files up to {} KB in this view.",
                MAX_WORKSPACE_TEXT_FILE_BYTES / 1024
            )),
        });
    }

    let bytes =
        fs::read(&resolved.target_path).map_err(|error| format!("failed to read file: {error}"))?;
    let version_token = workspace_text_file_content_version_token(&bytes);
    if bytes.contains(&0) {
        return Ok(WorkspaceTextFileSnapshot {
            workspace_id: resolved.workspace_id,
            relative_path: resolved.relative_path,
            content: String::new(),
            size_bytes: resolved.metadata.len(),
            newline_style: WorkspaceTextFileNewlineStyle::Lf,
            has_trailing_newline: false,
            version_token,
            read_only: true,
            reason: Some("Binary files are not editable in CrewDock yet.".to_string()),
        });
    }

    let content = match String::from_utf8(bytes) {
        Ok(content) => content,
        Err(_) => {
            return Ok(WorkspaceTextFileSnapshot {
                workspace_id: resolved.workspace_id,
                relative_path: resolved.relative_path,
                content: String::new(),
                size_bytes: resolved.metadata.len(),
                newline_style: WorkspaceTextFileNewlineStyle::Lf,
                has_trailing_newline: false,
                version_token,
                read_only: true,
                reason: Some("CrewDock only edits UTF-8 text files in this view.".to_string()),
            });
        }
    };
    let newline_style = match detect_workspace_text_file_newline_style(&content) {
        Ok(style) => style,
        Err(reason) => {
            return Ok(WorkspaceTextFileSnapshot {
                workspace_id: resolved.workspace_id,
                relative_path: resolved.relative_path,
                content,
                size_bytes: resolved.metadata.len(),
                newline_style: WorkspaceTextFileNewlineStyle::Lf,
                has_trailing_newline: false,
                version_token,
                read_only: true,
                reason: Some(reason),
            });
        }
    };
    let has_trailing_newline = content.ends_with('\n') || content.ends_with('\r');
    let read_only = resolved.metadata.permissions().readonly();
    let reason = read_only.then(|| "This file is read-only on disk.".to_string());

    Ok(WorkspaceTextFileSnapshot {
        workspace_id: resolved.workspace_id,
        relative_path: resolved.relative_path,
        content,
        size_bytes: resolved.metadata.len(),
        newline_style,
        has_trailing_newline,
        version_token,
        read_only,
        reason,
    })
}

#[cfg(test)]
fn save_workspace_text_file_snapshot(
    runtime: &RuntimeState,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    expected_version_token: &str,
) -> Result<WorkspaceTextFileSnapshot, String> {
    let (workspace_id, workspace_root) = resolve_workspace_root(runtime, workspace_id)?;
    save_workspace_text_file_snapshot_for_root(
        &workspace_id,
        &workspace_root,
        relative_path,
        content,
        expected_version_token,
    )
}

fn save_workspace_text_file_snapshot_for_root(
    workspace_id: &str,
    workspace_root: &Path,
    relative_path: &str,
    content: &str,
    expected_version_token: &str,
) -> Result<WorkspaceTextFileSnapshot, String> {
    let resolved =
        resolve_workspace_text_file_target_for_root(workspace_id, workspace_root, relative_path)?;
    if resolved.is_symlink {
        return Err("symlinked files are not editable in CrewDock yet.".to_string());
    }
    if resolved.metadata.permissions().readonly() {
        return Err("file is read-only on disk.".to_string());
    }

    let current_version_token = if resolved.metadata.len() <= MAX_WORKSPACE_TEXT_FILE_BYTES {
        let current_bytes = fs::read(&resolved.target_path)
            .map_err(|error| format!("failed to read file: {error}"))?;
        workspace_text_file_content_version_token(&current_bytes)
    } else {
        workspace_text_file_metadata_version_token(&resolved.metadata)
    };
    if current_version_token != expected_version_token.trim() {
        return Err("save conflict: file changed on disk.".to_string());
    }

    if content.len() as u64 > MAX_WORKSPACE_TEXT_FILE_BYTES {
        return Err(format!(
            "CrewDock only edits files up to {} KB in this view.",
            MAX_WORKSPACE_TEXT_FILE_BYTES / 1024
        ));
    }

    fs::write(&resolved.target_path, content.as_bytes())
        .map_err(|error| format!("failed to save file: {error}"))?;
    load_workspace_text_file_snapshot_for_root(workspace_id, workspace_root, relative_path)
}

fn persist_workspace_file_draft_record(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    relative_path: &str,
    draft: String,
    base_version_token: &str,
) -> Result<(), String> {
    let workspace = runtime
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let normalized_relative_path = normalize_workspace_relative_path(relative_path)?;
    if normalized_relative_path.is_empty() {
        return Err("path must be workspace-relative".to_string());
    }

    let normalized_base_version_token = base_version_token.trim().to_string();
    if normalized_base_version_token.is_empty() {
        return Err("base version token is required".to_string());
    }

    workspace.file_draft = Some(WorkspaceFileDraftRecord {
        relative_path: normalized_relative_path,
        draft,
        base_version_token: normalized_base_version_token,
    });
    runtime.persist_to_disk()
}

fn clear_workspace_file_draft_record(
    runtime: &mut RuntimeState,
    workspace_id: &str,
) -> Result<(), String> {
    let workspace = runtime
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    if workspace.file_draft.is_none() {
        return Ok(());
    }

    workspace.file_draft = None;
    runtime.persist_to_disk()
}

fn list_workspace_file_explorer_entries(
    workspace_root: &Path,
    relative_path: &str,
    directory: &Path,
) -> Result<Vec<WorkspaceFileExplorerEntrySnapshot>, String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("failed to read directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.is_empty() || should_hide_workspace_file_explorer_entry(&name) {
                return None;
            }

            let file_type = entry.file_type().ok()?;
            let kind = if file_type.is_symlink() {
                WorkspaceFileExplorerEntryKind::Symlink
            } else if file_type.is_dir() {
                WorkspaceFileExplorerEntryKind::Directory
            } else {
                WorkspaceFileExplorerEntryKind::File
            };
            let relative_path = join_workspace_relative_path(relative_path, &name);
            let full_path = workspace_root.join(&relative_path);
            let expandable = kind == WorkspaceFileExplorerEntryKind::Directory
                && fs::symlink_metadata(&full_path)
                    .ok()
                    .map(|metadata| !metadata.file_type().is_symlink())
                    .unwrap_or(false);

            Some(WorkspaceFileExplorerEntrySnapshot {
                name,
                relative_path,
                kind,
                expandable,
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(compare_workspace_file_explorer_entries);
    Ok(entries)
}

fn should_hide_workspace_file_explorer_entry(name: &str) -> bool {
    FILE_EXPLORER_HIDDEN_NAMES
        .iter()
        .any(|hidden| name.eq_ignore_ascii_case(hidden))
}

fn join_workspace_relative_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn compare_workspace_file_explorer_entries(
    left: &WorkspaceFileExplorerEntrySnapshot,
    right: &WorkspaceFileExplorerEntrySnapshot,
) -> Ordering {
    workspace_file_explorer_sort_bucket(left.kind)
        .cmp(&workspace_file_explorer_sort_bucket(right.kind))
        .then_with(|| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        })
        .then_with(|| left.name.cmp(&right.name))
}

fn workspace_file_explorer_sort_bucket(kind: WorkspaceFileExplorerEntryKind) -> u8 {
    match kind {
        WorkspaceFileExplorerEntryKind::Directory => 0,
        WorkspaceFileExplorerEntryKind::File => 1,
        WorkspaceFileExplorerEntryKind::Symlink => 2,
    }
}

fn shell_escape(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

impl SystemHealthSnapshot {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            availability: SystemHealthAvailability::Unavailable,
            cpu_percent: 0.0,
            memory_used_bytes: 0,
            memory_total_bytes: 0,
            memory_percent: 0.0,
            disk_used_bytes: 0,
            disk_total_bytes: 0,
            disk_percent: 0.0,
            battery_percent: None,
            battery_state: None,
            last_refreshed_at_ms: current_timestamp_ms(),
            error_message: Some(message.into()),
        }
    }

    fn error(message: impl Into<String>) -> Self {
        Self {
            availability: SystemHealthAvailability::Error,
            cpu_percent: 0.0,
            memory_used_bytes: 0,
            memory_total_bytes: 0,
            memory_percent: 0.0,
            disk_used_bytes: 0,
            disk_total_bytes: 0,
            disk_percent: 0.0,
            battery_percent: None,
            battery_state: None,
            last_refreshed_at_ms: current_timestamp_ms(),
            error_message: Some(message.into()),
        }
    }
}

impl SystemHealthMonitor {
    fn new() -> Self {
        let mut system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        system.refresh_cpu_usage();
        system.refresh_memory();

        Self {
            system,
            disks: Disks::new_with_refreshed_list_specifics(DiskRefreshKind::everything()),
        }
    }

    fn collect_snapshot(&mut self) -> Result<SystemHealthSnapshot, String> {
        if !cfg!(target_os = "macos") {
            return Ok(SystemHealthSnapshot::unavailable(
                "System monitoring is available on macOS only.",
            ));
        }

        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.disks.refresh(true);

        let cpu_percent = round_percentage(self.system.global_cpu_usage() as f64);
        let memory_total_bytes = self.system.total_memory();
        let memory_used_bytes = self.system.used_memory();
        let memory_percent = percentage(memory_used_bytes, memory_total_bytes);
        let (disk_used_bytes, disk_total_bytes) = primary_disk_usage(&self.disks).unwrap_or((0, 0));
        let disk_percent = percentage(disk_used_bytes, disk_total_bytes);
        let (battery_percent, battery_state) = collect_battery_snapshot();

        Ok(SystemHealthSnapshot {
            availability: SystemHealthAvailability::Ready,
            cpu_percent,
            memory_used_bytes,
            memory_total_bytes,
            memory_percent,
            disk_used_bytes,
            disk_total_bytes,
            disk_percent,
            battery_percent,
            battery_state,
            last_refreshed_at_ms: current_timestamp_ms(),
            error_message: None,
        })
    }
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn round_percentage(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }

    ((value * 10.0).round() / 10.0).clamp(0.0, 100.0)
}

fn percentage(value: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }

    round_percentage((value as f64 / total as f64) * 100.0)
}

fn primary_disk_usage(disks: &Disks) -> Option<(u64, u64)> {
    let current_dir = env::current_dir().ok();
    let disk = current_dir
        .as_ref()
        .and_then(|path| {
            disks
                .list()
                .iter()
                .filter(|disk| path.starts_with(disk.mount_point()))
                .max_by_key(|disk| disk.mount_point().as_os_str().len())
        })
        .or_else(|| {
            disks
                .list()
                .iter()
                .find(|disk| disk.mount_point() == Path::new("/"))
        })
        .or_else(|| disks.list().iter().next())?;

    let total = disk.total_space();
    let available = disk.available_space();
    Some((total.saturating_sub(available), total))
}

fn collect_battery_snapshot() -> (Option<f64>, Option<BatteryState>) {
    #[cfg(target_os = "macos")]
    {
        let output = ProcessCommand::new("pmset")
            .args(["-g", "batt"])
            .output()
            .ok();

        let Some(output) = output else {
            return (None, None);
        };

        if !output.status.success() {
            return (None, None);
        }

        return parse_battery_snapshot(&String::from_utf8_lossy(&output.stdout));
    }

    #[cfg(not(target_os = "macos"))]
    {
        (None, None)
    }
}

fn parse_battery_snapshot(output: &str) -> (Option<f64>, Option<BatteryState>) {
    for line in output.lines() {
        let Some(percent_index) = line.find('%') else {
            continue;
        };

        let percent_digits = line[..percent_index]
            .chars()
            .rev()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();

        let battery_percent = percent_digits.parse::<f64>().ok().map(round_percentage);
        let state_fragment = line[percent_index + 1..]
            .split(';')
            .nth(1)
            .map(str::trim)
            .unwrap_or("");
        let normalized_state = state_fragment.to_ascii_lowercase();
        let battery_state = if normalized_state.contains("discharging") {
            Some(BatteryState::Discharging)
        } else if normalized_state.contains("charging") {
            Some(BatteryState::Charging)
        } else if normalized_state.contains("charged")
            || normalized_state.contains("finishing charge")
        {
            Some(BatteryState::Full)
        } else if battery_percent.is_some() {
            Some(BatteryState::Unknown)
        } else {
            None
        };

        if battery_percent.is_some() || battery_state.is_some() {
            return (battery_percent, battery_state);
        }
    }

    (None, None)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PersistedPaneLayout {
    Leaf {
        index: usize,
    },
    Split {
        axis: SplitAxis,
        first: Box<PersistedPaneLayout>,
        second: Box<PersistedPaneLayout>,
    },
}

#[tauri::command]
fn get_app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    Ok(runtime.build_snapshot())
}

#[tauri::command]
fn load_system_health_snapshot(
    state: State<'_, SystemHealthState>,
) -> Result<SystemHealthSnapshot, String> {
    let mut monitor = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire system monitor state".to_string())?;

    monitor.collect_snapshot().or_else(|error| {
        if cfg!(target_os = "macos") {
            Ok(SystemHealthSnapshot::error(error))
        } else {
            Ok(SystemHealthSnapshot::unavailable(error))
        }
    })
}

#[tauri::command]
fn reset_to_launcher(state: State<'_, AppState>, _app: AppHandle) -> Result<AppSnapshot, String> {
    let (snapshot, killers) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let killers = runtime.drain_all_killers();
        runtime.workspaces.clear();
        runtime.active_workspace_id = None;
        runtime.pending_codex_starts.clear();
        runtime.persist_to_disk()?;
        (runtime.build_snapshot(), killers)
    };

    terminate_sessions(killers);
    Ok(snapshot)
}

#[tauri::command]
fn create_workspace(
    pane_count: u8,
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSnapshot, String> {
    let workspace_path = normalize_workspace_path(&path)?;
    let workspace_path = workspace_path.display().to_string();
    let shared = state.inner.clone();

    let (snapshot, shell, pane_jobs) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let pane_jobs = workspace_manager::create_workspace_in_runtime(
            &mut runtime,
            pane_count,
            Path::new(&workspace_path),
        )?;

        (runtime.build_snapshot(), runtime.shell.clone(), pane_jobs)
    };

    spawn_pane_jobs(shared, app.clone(), shell, pane_jobs);
    Ok(snapshot)
}

#[tauri::command]
fn rename_workspace(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::rename_workspace_in_runtime(&mut runtime, &workspace_id, &name)?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn add_workspace_todo(
    workspace_id: String,
    text: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::add_workspace_todo_in_runtime(&mut runtime, &workspace_id, &text)?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn update_workspace_todo(
    workspace_id: String,
    todo_id: String,
    text: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::update_workspace_todo_in_runtime(
            &mut runtime,
            &workspace_id,
            &todo_id,
            &text,
        )?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn set_workspace_todo_done(
    workspace_id: String,
    todo_id: String,
    done: bool,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::set_workspace_todo_done_in_runtime(
            &mut runtime,
            &workspace_id,
            &todo_id,
            done,
        )?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn delete_workspace_todo(
    workspace_id: String,
    todo_id: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::delete_workspace_todo_in_runtime(&mut runtime, &workspace_id, &todo_id)?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn reorder_workspace(
    workspace_id: String,
    target_index: usize,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::reorder_workspace_in_runtime(&mut runtime, &workspace_id, target_index)?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn switch_workspace(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSnapshot, String> {
    let shared = state.inner.clone();
    let (snapshot, shell, pane_jobs) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let pane_jobs =
            workspace_manager::switch_workspace_in_runtime(&mut runtime, &workspace_id)?;

        (runtime.build_snapshot(), runtime.shell.clone(), pane_jobs)
    };

    spawn_pane_jobs(shared, app.clone(), shell, pane_jobs);
    Ok(snapshot)
}

#[tauri::command]
fn close_workspace(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSnapshot, String> {
    let shared = state.inner.clone();
    let (snapshot, shell, pane_jobs, killers) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let (pane_jobs, killers) =
            workspace_manager::close_workspace_in_runtime(&mut runtime, &workspace_id)?;

        (
            runtime.build_snapshot(),
            runtime.shell.clone(),
            pane_jobs,
            killers,
        )
    };

    terminate_sessions(killers);
    spawn_pane_jobs(shared, app.clone(), shell, pane_jobs);
    Ok(snapshot)
}

#[tauri::command]
fn split_pane(
    pane_id: String,
    direction: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSnapshot, String> {
    let shared = state.inner.clone();

    let (snapshot, shell, pane_jobs) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let pane_jobs =
            workspace_manager::split_pane_in_runtime(&mut runtime, &pane_id, &direction)?;

        (runtime.build_snapshot(), runtime.shell.clone(), pane_jobs)
    };

    spawn_pane_jobs(shared, app.clone(), shell, pane_jobs);
    Ok(snapshot)
}

#[tauri::command]
fn close_pane(
    pane_id: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let (snapshot, killers) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let killers = workspace_manager::close_pane_in_runtime(&mut runtime, &pane_id)?;
        (runtime.build_snapshot(), killers)
    };

    terminate_sessions(killers);
    Ok(snapshot)
}

#[tauri::command]
fn show_in_finder(path: String) -> Result<(), String> {
    let target = normalize_workspace_path(&path)?;
    std::process::Command::new("open")
        .arg(target)
        .spawn()
        .map_err(|error| format!("failed to open Finder: {error}"))?;
    Ok(())
}

fn external_workspace_target_spec(target_id: &str) -> Option<ExternalWorkspaceTargetSpec> {
    EXTERNAL_WORKSPACE_TARGET_SPECS
        .iter()
        .copied()
        .find(|spec| spec.id == target_id)
}

#[cfg(target_os = "macos")]
fn common_macos_app_search_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];

    if let Ok(home) = env::var("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }

    roots
}

#[cfg(target_os = "macos")]
fn external_workspace_target_app_path(spec: ExternalWorkspaceTargetSpec) -> Option<PathBuf> {
    let app_name = match spec.id {
        "finder" => return Some(PathBuf::from("/System/Library/CoreServices/Finder.app")),
        _ => spec.app_name?,
    };

    let bundle_name = format!("{app_name}.app");
    common_macos_app_search_roots()
        .into_iter()
        .map(|root| root.join(&bundle_name))
        .find(|candidate| candidate.is_dir())
}

#[cfg(not(target_os = "macos"))]
fn external_workspace_target_app_path(_spec: ExternalWorkspaceTargetSpec) -> Option<PathBuf> {
    None
}

#[cfg(target_os = "macos")]
fn bundle_info_value(path: &Path, key: &str) -> Option<String> {
    let output = ProcessCommand::new("plutil")
        .arg("-convert")
        .arg("json")
        .arg("-o")
        .arg("-")
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let value = serde_json::from_slice::<serde_json::Value>(&output.stdout).ok()?;
    value
        .get(key)
        .and_then(|entry| entry.as_str())
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

#[cfg(target_os = "macos")]
fn workspace_target_icon_candidates(
    app_path: &Path,
    spec: ExternalWorkspaceTargetSpec,
) -> Vec<PathBuf> {
    let resources_dir = app_path.join("Contents").join("Resources");
    if !resources_dir.is_dir() {
        return Vec::new();
    }

    let info_plist = app_path.join("Contents").join("Info.plist");
    let mut raw_candidates = Vec::new();
    if info_plist.is_file() {
        if let Some(icon_file) = bundle_info_value(&info_plist, "CFBundleIconFile") {
            raw_candidates.push(icon_file);
        }
        if let Some(icon_name) = bundle_info_value(&info_plist, "CFBundleIconName") {
            raw_candidates.push(icon_name);
        }
    }
    raw_candidates.push(spec.label.to_string());
    if let Some(app_name) = spec.app_name {
        raw_candidates.push(app_name.to_string());
    }
    if let Some(bundle_name) = app_path.file_stem().and_then(|name| name.to_str()) {
        raw_candidates.push(bundle_name.to_string());
    }

    let mut candidates = Vec::new();
    for raw in raw_candidates {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }

        let direct = resources_dir.join(trimmed);
        if direct.extension().is_some() {
            candidates.push(direct);
        } else {
            candidates.push(resources_dir.join(format!("{trimmed}.icns")));
            candidates.push(resources_dir.join(format!("{trimmed}.png")));
        }
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for candidate in candidates {
        let key = candidate.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped.push(candidate);
        }
    }
    deduped
}

#[cfg(target_os = "macos")]
fn external_workspace_target_icon_path(
    app_path: &Path,
    spec: ExternalWorkspaceTargetSpec,
) -> Option<PathBuf> {
    workspace_target_icon_candidates(app_path, spec)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn convert_workspace_target_icon_to_png_bytes(
    icon_path: &Path,
    target_id: &str,
) -> Option<Vec<u8>> {
    let temp_path = env::temp_dir().join(format!(
        "crewdock-target-icon-{}-{}-{}.png",
        std::process::id(),
        target_id,
        now_timestamp_ms()
    ));
    let output = ProcessCommand::new("sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(icon_path)
        .arg("--resampleHeightWidth")
        .arg("64")
        .arg("64")
        .arg("--out")
        .arg(&temp_path)
        .output()
        .ok()?;

    if !output.status.success() {
        let _ = fs::remove_file(&temp_path);
        return None;
    }

    let bytes = fs::read(&temp_path).ok()?;
    let _ = fs::remove_file(&temp_path);
    Some(bytes)
}

#[cfg(target_os = "macos")]
fn load_external_workspace_target_icon_data_url(
    app_path: &Path,
    spec: ExternalWorkspaceTargetSpec,
) -> Option<String> {
    let icon_path = external_workspace_target_icon_path(app_path, spec)?;
    let icon_bytes = convert_workspace_target_icon_to_png_bytes(&icon_path, spec.id)?;
    Some(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(icon_bytes)
    ))
}

#[cfg(not(target_os = "macos"))]
fn load_external_workspace_target_icon_data_url(
    _app_path: &Path,
    _spec: ExternalWorkspaceTargetSpec,
) -> Option<String> {
    None
}

fn build_external_workspace_target_snapshot(
    spec: ExternalWorkspaceTargetSpec,
    icon_data_url: Option<String>,
) -> ExternalWorkspaceTargetSnapshot {
    ExternalWorkspaceTargetSnapshot {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        kind: spec.kind,
        icon_data_url,
    }
}

#[tauri::command]
fn list_external_workspace_targets() -> Result<Vec<ExternalWorkspaceTargetSnapshot>, String> {
    Ok(EXTERNAL_WORKSPACE_TARGET_SPECS
        .iter()
        .copied()
        .filter_map(|spec| {
            let app_path = external_workspace_target_app_path(spec)?;
            Some(build_external_workspace_target_snapshot(
                spec,
                load_external_workspace_target_icon_data_url(&app_path, spec),
            ))
        })
        .collect())
}

#[tauri::command]
fn open_workspace_in_target(path: String, target_id: String) -> Result<(), String> {
    let target_path = normalize_workspace_path(&path)?;
    let spec = external_workspace_target_spec(target_id.trim())
        .ok_or_else(|| format!("unsupported workspace target: {}", target_id.trim()))?;

    let Some(app_path) = external_workspace_target_app_path(spec) else {
        return Err(format!("{} is not available on this system", spec.label));
    };

    #[cfg(target_os = "macos")]
    {
        let mut command = ProcessCommand::new("open");
        command.arg("-a").arg(app_path);
        command
            .arg(target_path)
            .spawn()
            .map_err(|error| format!("failed to open {}: {error}", spec.label))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = target_path;
        Err("Opening workspaces in external apps is not supported on this platform yet".to_string())
    }
}

#[tauri::command]
fn run_launcher_command(
    input: String,
    state: State<'_, AppState>,
) -> Result<LauncherCommandResult, String> {
    let result = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let current_path = PathBuf::from(runtime.launcher.base_path.clone());
        let result = execute_launcher_command(&current_path, &input)?;
        runtime.launcher.base_path = result.base_path.clone();
        result
    };

    Ok(result)
}

#[tauri::command]
fn complete_launcher_input(
    input: String,
    state: State<'_, AppState>,
) -> Result<LauncherCompletionResult, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    let current_path = PathBuf::from(runtime.launcher.base_path.clone());
    complete_launcher_input_for_base(&current_path, &input)
}

#[tauri::command]
fn set_settings(
    theme_id: String,
    interface_text_scale: f64,
    terminal_font_size: f64,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let theme_id = ThemeId::parse(&theme_id).ok_or_else(|| "theme not found".to_string())?;
        runtime.settings.theme_id = theme_id;
        runtime.settings.interface_text_scale =
            normalize_interface_text_scale(interface_text_scale);
        runtime.settings.terminal_font_size = normalize_terminal_font_size(terminal_font_size);
        runtime.persist_to_disk()?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn set_theme(
    theme_id: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let theme_id = ThemeId::parse(&theme_id).ok_or_else(|| "theme not found".to_string())?;
        runtime.settings.theme_id = theme_id;
        runtime.persist_to_disk()?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn set_interface_text_scale(
    interface_text_scale: f64,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime.settings.interface_text_scale =
            normalize_interface_text_scale(interface_text_scale);
        runtime.persist_to_disk()?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn set_terminal_font_size(
    terminal_font_size: f64,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime.settings.terminal_font_size = normalize_terminal_font_size(terminal_font_size);
        runtime.persist_to_disk()?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn set_openai_api_key(
    openai_api_key: Option<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime.settings.openai_api_key = normalize_optional_openai_api_key(openai_api_key);
        runtime.persist_to_disk()?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn set_codex_cli_path(
    codex_cli_path: Option<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let normalized = normalize_optional_codex_cli_path(codex_cli_path);
        if let Some(path) = normalized.as_deref() {
            let path = Path::new(path);
            probe_codex_cli_candidate(path, CodexCliSource::Custom)?;
        }

        runtime.settings.codex_cli_path = normalized;
        runtime.refresh_codex_cli();
        runtime.persist_to_disk()?;
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn refresh_codex_cli_catalog(
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime.refresh_codex_cli();
        runtime.build_snapshot()
    };
    Ok(snapshot)
}

#[tauri::command]
fn load_workspace_codex_sessions(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceCodexSessionsSnapshot, String> {
    let (workspace_path, remembered_session_id, codex_cli) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let workspace = runtime
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;

        (
            workspace.path.clone(),
            workspace.codex_session_id.clone(),
            runtime.codex_cli.clone(),
        )
    };

    Ok(load_workspace_codex_sessions_snapshot(
        &workspace_id,
        &workspace_path,
        remembered_session_id.as_deref(),
        &codex_cli,
    ))
}

#[tauri::command]
fn resume_workspace_codex_session(
    workspace_id: String,
    pane_id: String,
    session_id: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AppSnapshot, String> {
    let session_id = normalize_optional_codex_session_id(Some(session_id))
        .ok_or_else(|| "session id is required".to_string())?;
    let (snapshot, writer, command) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let workspace_index = runtime
            .workspaces
            .iter()
            .position(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let Some(slot_index) =
            workspace_pane_slot_index(&runtime.workspaces[workspace_index], &pane_id)
        else {
            return Err("pane does not belong to the workspace".to_string());
        };

        let writer = runtime
            .sessions
            .get(&pane_id)
            .ok_or_else(|| "pane session not ready".to_string())
            .and_then(|session| {
                if session.workspace_id != workspace_id {
                    Err("pane does not belong to the workspace".to_string())
                } else {
                    Ok(session.writer.clone())
                }
            })?;
        let codex_binary = runtime.codex_cli.effective_path.clone().ok_or_else(|| {
            runtime
                .codex_cli
                .message
                .clone()
                .unwrap_or_else(|| "No Codex CLI is configured.".to_string())
        })?;
        let workspace_path = runtime.workspaces[workspace_index].path.clone();
        runtime.workspaces[workspace_index].codex_session_id = Some(session_id.clone());
        upsert_workspace_codex_restore_binding(
            &mut runtime.workspaces[workspace_index],
            slot_index,
            session_id.clone(),
            workspace_path.clone(),
            now_timestamp_ms(),
        );
        runtime.clear_pending_codex_start_for_pane(&pane_id);
        runtime.persist_to_disk()?;
        let command = format!(
            "{} resume {} -C {}\n",
            shell_escape(&codex_binary),
            shell_escape(&session_id),
            shell_escape(&workspace_path),
        );
        (runtime.build_snapshot(), writer, command)
    };

    write_shell_command(&writer, &command)?;
    Ok(snapshot)
}

#[tauri::command]
fn start_workspace_codex_session(
    workspace_id: String,
    pane_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let shared = state.inner.clone();
    let (writer, command, workspace_path) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let workspace = runtime
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        if !workspace.panes.iter().any(|pane| pane.id == pane_id) {
            return Err("pane does not belong to the workspace".to_string());
        }

        let writer = runtime
            .sessions
            .get(&pane_id)
            .ok_or_else(|| "pane session not ready".to_string())
            .and_then(|session| {
                if session.workspace_id != workspace_id {
                    Err("pane does not belong to the workspace".to_string())
                } else {
                    Ok(session.writer.clone())
                }
            })?;
        let codex_binary = runtime.codex_cli.effective_path.clone().ok_or_else(|| {
            runtime
                .codex_cli
                .message
                .clone()
                .unwrap_or_else(|| "No Codex CLI is configured.".to_string())
        })?;
        let command = format!(
            "{} -C {}\n",
            shell_escape(&codex_binary),
            shell_escape(&workspace.path),
        );
        (writer, command, workspace.path.clone())
    };

    write_shell_command(&writer, &command)?;
    let known_session_ids = discover_codex_session_ids_for_workspace(&workspace_path);
    let should_spawn_discovery = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let Some(workspace_index) = runtime
            .workspaces
            .iter()
            .position(|workspace| workspace.id == workspace_id)
        else {
            return Ok(());
        };
        let Some(slot_index) =
            workspace_pane_slot_index(&runtime.workspaces[workspace_index], &pane_id)
        else {
            return Ok(());
        };

        runtime.clear_pending_codex_start_for_pane(&pane_id);
        runtime.pending_codex_starts.push(PendingCodexStartRecord {
            workspace_id: workspace_id.clone(),
            pane_id: pane_id.clone(),
            pane_slot_index: slot_index,
            cwd: workspace_path.clone(),
            started_at_ms: now_timestamp_ms(),
            known_session_ids,
        });

        let workspace_pending_count = runtime
            .pending_codex_starts
            .iter()
            .filter(|pending| pending.workspace_id == workspace_id)
            .count();
        if workspace_pending_count > 1 {
            runtime.clear_pending_codex_starts_for_workspace(&workspace_id);
            false
        } else {
            true
        }
    };
    if should_spawn_discovery {
        spawn_pending_codex_start_discovery(shared, app, workspace_id);
    }
    Ok(())
}

#[tauri::command]
fn refresh_workspace_git_status(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceGitSummaryUpdateSnapshot, String> {
    let workspace_path = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        source_control::workspace_path(&runtime, &workspace_id)?
    };
    let detail = collect_git_detail(Path::new(&workspace_path));
    let summary = detail.summary.clone();

    {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let workspace = runtime
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        workspace.git = Some(detail);
    }

    emit_runtime_event(
        &app,
        &events::RuntimeEvent::WorkspaceGitSummaryUpdated {
            workspace_id: workspace_id.clone(),
            summary: summary.clone(),
        },
    )?;

    Ok(WorkspaceGitSummaryUpdateSnapshot {
        workspace_id,
        summary,
    })
}

#[tauri::command]
fn load_workspace_source_control(
    workspace_id: String,
    graph_cursor: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let context = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        workspace_source_control_context(&runtime, &workspace_id)?
    };
    build_workspace_source_control_from_context(&context, graph_cursor)
}

#[tauri::command]
fn load_workspace_file_explorer_directory(
    workspace_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceFileExplorerDirectorySnapshot, String> {
    let (workspace_id, workspace_root) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        resolve_workspace_root(&runtime, &workspace_id)?
    };
    load_workspace_file_explorer_directory_snapshot_for_root(
        &workspace_id,
        &workspace_root,
        &relative_path,
    )
}

#[tauri::command]
fn load_workspace_text_file(
    workspace_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceTextFileSnapshot, String> {
    let (workspace_id, workspace_root) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        resolve_workspace_root(&runtime, &workspace_id)?
    };
    load_workspace_text_file_snapshot_for_root(&workspace_id, &workspace_root, &relative_path)
}

#[tauri::command]
fn save_workspace_text_file(
    workspace_id: String,
    relative_path: String,
    content: String,
    expected_version_token: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceTextFileSnapshot, String> {
    let (workspace_id, workspace_root) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        resolve_workspace_root(&runtime, &workspace_id)?
    };
    save_workspace_text_file_snapshot_for_root(
        &workspace_id,
        &workspace_root,
        &relative_path,
        &content,
        &expected_version_token,
    )
}

#[tauri::command]
fn persist_workspace_file_draft(
    workspace_id: String,
    relative_path: String,
    draft: String,
    base_version_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    persist_workspace_file_draft_record(
        &mut runtime,
        &workspace_id,
        &relative_path,
        draft,
        &base_version_token,
    )
}

#[tauri::command]
fn clear_workspace_file_draft(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    clear_workspace_file_draft_record(&mut runtime, &workspace_id)
}

#[tauri::command]
fn load_workspace_git_diff(
    workspace_id: String,
    path: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<GitDiffSnapshot, String> {
    let mode = match mode.as_str() {
        "staged" => GitDiffMode::Staged,
        _ => GitDiffMode::WorkingTree,
    };

    let workspace_path = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        source_control::workspace_path(&runtime, &workspace_id)?
    };
    source_control::load_workspace_git_diff_for_path(&workspace_path, &path, mode)
}

#[tauri::command]
fn load_workspace_git_commit_detail(
    workspace_id: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<GitCommitDetailSnapshot, String> {
    let workspace_path = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        source_control::workspace_path(&runtime, &workspace_id)?
    };
    source_control::load_workspace_git_commit_detail_for_path(&workspace_path, &oid)
}

fn validate_git_cli_arg(value: String, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required."));
    }
    if trimmed.starts_with('-') || trimmed.contains(['\0', '\n', '\r']) {
        return Err(format!("invalid {label}."));
    }
    Ok(trimmed.to_string())
}

fn validate_optional_git_cli_arg(
    value: Option<String>,
    label: &str,
) -> Result<Option<String>, String> {
    match value {
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) => validate_git_cli_arg(raw, label).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
fn git_stage_paths(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let source_control = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        stage_paths(&mut runtime, &workspace_id, &paths)?;
        build_workspace_source_control(&runtime, &workspace_id, None)?
    };
    Ok(source_control)
}

#[tauri::command]
fn git_unstage_paths(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let source_control = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        unstage_paths(&mut runtime, &workspace_id, &paths)?;
        build_workspace_source_control(&runtime, &workspace_id, None)?
    };
    Ok(source_control)
}

#[tauri::command]
fn git_discard_paths(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let source_control = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        discard_paths(&mut runtime, &workspace_id, &paths)?;
        build_workspace_source_control(&runtime, &workspace_id, None)?
    };
    Ok(source_control)
}

#[tauri::command]
fn git_commit(
    workspace_id: String,
    message: String,
    commit_all: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message cannot be empty".to_string());
    }

    if commit_all.unwrap_or(false) {
        {
            let mut runtime = state
                .inner
                .lock()
                .map_err(|_| "failed to acquire application state".to_string())?;
            source_control::stage_all_changes(&mut runtime, &workspace_id)?;
        }
    }

    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        "Commit".to_string(),
        vec!["commit".to_string(), "-m".to_string(), message],
    )
}

#[tauri::command]
async fn generate_git_commit_message(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let request = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        build_commit_message_generation_request(&runtime, &workspace_id)?
    };

    generate_commit_message_with_openai(request).await
}

#[tauri::command]
fn git_checkout_branch(
    workspace_id: String,
    branch_name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let branch_name = validate_git_cli_arg(branch_name, "branch name")?;
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        format!("Checkout {}", branch_name.trim()),
        vec!["checkout".to_string(), branch_name],
    )
}

#[tauri::command]
fn git_create_branch(
    workspace_id: String,
    branch_name: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let branch_name = validate_git_cli_arg(branch_name, "branch name")?;
    let start_point = validate_optional_git_cli_arg(start_point, "start point")?;
    let mut args = vec![
        "checkout".to_string(),
        "-b".to_string(),
        branch_name.clone(),
    ];
    if let Some(start_point) = start_point.filter(|value| !value.trim().is_empty()) {
        args.push(start_point);
    }

    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        format!("Create branch {}", branch_name.trim()),
        args,
    )
}

#[tauri::command]
fn git_rename_branch(
    workspace_id: String,
    current_name: String,
    next_name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let current_name = validate_git_cli_arg(current_name, "current branch name")?;
    let next_name = validate_git_cli_arg(next_name, "next branch name")?;
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        format!("Rename branch {}", current_name.trim()),
        vec![
            "branch".to_string(),
            "-m".to_string(),
            current_name,
            next_name,
        ],
    )
}

#[tauri::command]
fn git_delete_branch(
    workspace_id: String,
    branch_name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let branch_name = validate_git_cli_arg(branch_name, "branch name")?;
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        format!("Delete branch {}", branch_name.trim()),
        vec!["branch".to_string(), "-d".to_string(), branch_name],
    )
}

#[tauri::command]
fn git_fetch(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        "Fetch".to_string(),
        vec![
            "fetch".to_string(),
            "--all".to_string(),
            "--prune".to_string(),
        ],
    )
}

#[tauri::command]
fn git_pull(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        "Pull".to_string(),
        vec!["pull".to_string()],
    )
}

#[tauri::command]
fn git_push(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        "Push".to_string(),
        vec!["push".to_string()],
    )
}

#[tauri::command]
fn git_publish_branch(
    workspace_id: String,
    branch_name: String,
    remote_name: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let branch_name = validate_git_cli_arg(branch_name, "branch name")?;
    let remote = validate_optional_git_cli_arg(remote_name, "remote name")?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(resolve_default_git_remote(&state.inner, &workspace_id)?);
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        format!("Publish {}", branch_name.trim()),
        vec![
            "push".to_string(),
            "--set-upstream".to_string(),
            remote,
            branch_name,
        ],
    )
}

#[tauri::command]
fn git_set_upstream(
    workspace_id: String,
    branch_name: String,
    upstream_name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let branch_name = validate_git_cli_arg(branch_name, "branch name")?;
    let upstream_name = validate_git_cli_arg(upstream_name, "upstream name")?;
    start_git_task(
        state.inner.clone(),
        app,
        workspace_id,
        format!("Set upstream for {}", branch_name.trim()),
        vec![
            "branch".to_string(),
            "--set-upstream-to".to_string(),
            upstream_name,
            branch_name,
        ],
    )
}

#[tauri::command]
fn git_task_write_stdin(
    workspace_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    write_git_task_input(&mut runtime, &workspace_id, &data)
}

#[tauri::command]
fn write_to_pane(pane_id: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let writer = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime
            .sessions
            .get(&pane_id)
            .map(|session| session.writer.clone())
            .ok_or_else(|| "pane session not found".to_string())?
    };

    write_shell_command(&writer, &data)
}

#[tauri::command]
fn resize_pane(
    pane_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if cols == 0 || rows == 0 {
        return Ok(());
    }

    let master = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime
            .sessions
            .get(&pane_id)
            .map(|session| session.master.clone())
            .ok_or_else(|| "pane session not found".to_string())?
    };

    let master = master
        .lock()
        .map_err(|_| "failed to acquire pane master".to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize pane: {error}"))?;
    Ok(())
}

fn default_launcher_path() -> String {
    env::current_dir()
        .ok()
        .and_then(|path| fs::canonicalize(&path).ok().or(Some(path)))
        .or_else(|| {
            env::var("HOME")
                .ok()
                .and_then(|home| fs::canonicalize(&home).ok().or(Some(PathBuf::from(home))))
        })
        .unwrap_or_else(|| PathBuf::from("/"))
        .display()
        .to_string()
}

fn normalize_workspace_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workspace path is empty".to_string());
    }

    let resolved = fs::canonicalize(trimmed)
        .map_err(|error| format!("failed to access workspace folder: {error}"))?;
    if !resolved.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    Ok(resolved)
}

fn resolve_default_git_remote(
    shared: &Arc<Mutex<RuntimeState>>,
    workspace_id: &str,
) -> Result<String, String> {
    let runtime = shared
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    let workspace = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let remotes = load_git_remotes(Path::new(&workspace.path))?;
    if remotes.is_empty() {
        return Err("no git remote configured for this repository".to_string());
    }

    select_default_git_remote(&remotes)
        .ok_or_else(|| "no git remote configured for this repository".to_string())
}

fn execute_launcher_command(
    base_path: &Path,
    raw_input: &str,
) -> Result<LauncherCommandResult, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("enter a command. Try help.".to_string());
    }

    if trimmed.eq_ignore_ascii_case("help") {
        return Ok(LauncherCommandResult {
            base_path: base_path.display().to_string(),
            output: vec![
                "Commands: help, pwd, ls [path], cd <path>, open [path], clear".to_string(),
            ],
            open_path: None,
            clear_output: false,
        });
    }

    if trimmed.eq_ignore_ascii_case("pwd") {
        return Ok(LauncherCommandResult {
            base_path: base_path.display().to_string(),
            output: vec![base_path.display().to_string()],
            open_path: None,
            clear_output: false,
        });
    }

    if trimmed.eq_ignore_ascii_case("clear") {
        return Ok(LauncherCommandResult {
            base_path: base_path.display().to_string(),
            output: Vec::new(),
            open_path: None,
            clear_output: true,
        });
    }

    if trimmed.eq_ignore_ascii_case("ls") || trimmed.starts_with("ls ") {
        let target_path = if trimmed.eq_ignore_ascii_case("ls") {
            base_path.to_path_buf()
        } else {
            resolve_navigation_path(base_path, trimmed[3..].trim())?
        };
        let target_display = target_path.display().to_string();
        let mut output = vec![target_display.clone()];
        output.push(list_directory_entries(&target_path)?.join("  "));
        return Ok(LauncherCommandResult {
            base_path: base_path.display().to_string(),
            output,
            open_path: None,
            clear_output: false,
        });
    }

    if trimmed.eq_ignore_ascii_case("open") || trimmed.starts_with("open ") {
        let target_path = if trimmed.eq_ignore_ascii_case("open") {
            base_path.to_path_buf()
        } else {
            resolve_navigation_path(base_path, trimmed[5..].trim())?
        };
        let target_display = target_path.display().to_string();
        return Ok(LauncherCommandResult {
            base_path: target_display.clone(),
            output: vec![format!("Opening workspace at {target_display}")],
            open_path: Some(target_display),
            clear_output: false,
        });
    }

    let target_path = resolve_navigation_path(base_path, trimmed)?;
    let target_display = target_path.display().to_string();
    Ok(LauncherCommandResult {
        base_path: target_display.clone(),
        output: vec![format!("cwd -> {target_display}")],
        open_path: None,
        clear_output: false,
    })
}

fn complete_launcher_input_for_base(
    base_path: &Path,
    raw_input: &str,
) -> Result<LauncherCompletionResult, String> {
    if raw_input.trim().is_empty() {
        return Ok(empty_launcher_completion(raw_input));
    }

    if contains_forbidden_navigation_tokens(raw_input) {
        return Err("only directory navigation is supported".to_string());
    }

    if let Some(result) = complete_launcher_command_name(raw_input) {
        return Ok(result);
    }

    if starts_with_non_path_launcher_command(raw_input) {
        return Ok(empty_launcher_completion(raw_input));
    }

    complete_launcher_path_input(base_path, raw_input)
}

fn empty_launcher_completion(raw_input: &str) -> LauncherCompletionResult {
    LauncherCompletionResult {
        completed_input: raw_input.to_string(),
        matches: Vec::new(),
    }
}

fn complete_launcher_command_name(raw_input: &str) -> Option<LauncherCompletionResult> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty()
        || trimmed.contains(char::is_whitespace)
        || trimmed.starts_with('/')
        || trimmed.starts_with('.')
        || trimmed.starts_with('~')
        || trimmed.contains('/')
    {
        return None;
    }

    let matches = LAUNCHER_COMMANDS
        .into_iter()
        .filter(|command| command.starts_with(trimmed))
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return None;
    }

    let completed_input = if matches.len() == 1 {
        let command = matches[0];
        if PATH_AWARE_LAUNCHER_COMMANDS.contains(&command) {
            format!("{command} ")
        } else {
            command.to_string()
        }
    } else {
        longest_common_prefix(&matches)
    };

    Some(LauncherCompletionResult {
        completed_input,
        matches: matches.into_iter().map(str::to_string).collect(),
    })
}

fn starts_with_non_path_launcher_command(raw_input: &str) -> bool {
    let trimmed = raw_input.trim_start();
    ["help", "pwd", "clear"].into_iter().any(|command| {
        trimmed
            .strip_prefix(command)
            .and_then(|rest| rest.chars().next())
            .map(|character| character.is_whitespace())
            .unwrap_or(false)
    })
}

fn complete_launcher_path_input(
    base_path: &Path,
    raw_input: &str,
) -> Result<LauncherCompletionResult, String> {
    let (command_prefix, raw_target) = split_launcher_completion_input(raw_input);
    let target = raw_target.trim_start();
    let (quote_prefix, unquoted_target) = match target.as_bytes().first().copied() {
        Some(b'"') => ("\"", &target[1..]),
        Some(b'\'') => ("'", &target[1..]),
        _ => ("", target),
    };

    let (container_raw, typed_path_prefix, fragment) =
        split_launcher_completion_target(unquoted_target);
    let scan_dir = match resolve_completion_scan_dir(base_path, container_raw) {
        Ok(path) => path,
        Err(_) => return Ok(empty_launcher_completion(raw_input)),
    };

    let fragment_lower = fragment.to_lowercase();
    let mut matches = fs::read_dir(&scan_dir)
        .map_err(|error| format!("failed to read directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let is_dir = entry.file_type().ok()?.is_dir();
            if !is_dir {
                return None;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if !fragment_lower.is_empty() && !name.to_lowercase().starts_with(&fragment_lower) {
                return None;
            }

            Some(name)
        })
        .collect::<Vec<_>>();

    matches.sort_unstable();
    if matches.is_empty() {
        return Ok(empty_launcher_completion(raw_input));
    }

    let completed_fragment = if matches.len() == 1 {
        format!("{}/", matches[0])
    } else {
        let shared_prefix = longest_common_prefix(&matches);
        if shared_prefix.len() > fragment.len() {
            shared_prefix
        } else {
            fragment.to_string()
        }
    };

    let completed_input =
        format!("{command_prefix}{quote_prefix}{typed_path_prefix}{completed_fragment}");
    let match_display = summarize_completion_matches(
        matches
            .into_iter()
            .map(|name| format!("{quote_prefix}{typed_path_prefix}{name}/"))
            .collect(),
    );

    Ok(LauncherCompletionResult {
        completed_input,
        matches: match_display,
    })
}

fn split_launcher_completion_input(raw_input: &str) -> (String, &str) {
    let trimmed = raw_input.trim_start();

    for command in PATH_AWARE_LAUNCHER_COMMANDS {
        if let Some(rest) = trimmed.strip_prefix(command) {
            if rest
                .chars()
                .next()
                .map(|character| character.is_whitespace())
                .unwrap_or(false)
            {
                return (format!("{command} "), rest.trim_start());
            }
        }
    }

    (String::new(), trimmed)
}

fn split_launcher_completion_target(value: &str) -> (&str, &str, &str) {
    match value.rfind('/') {
        Some(index) => (&value[..index], &value[..index + 1], &value[index + 1..]),
        None => ("", "", value),
    }
}

fn resolve_completion_scan_dir(base_path: &Path, container_raw: &str) -> Result<PathBuf, String> {
    if container_raw.is_empty() {
        return Ok(base_path.to_path_buf());
    }

    let target = expand_navigation_target(container_raw)?;
    let target = if target.is_absolute() {
        target
    } else {
        base_path.join(target)
    };

    let resolved = fs::canonicalize(&target)
        .map_err(|error| format!("failed to access workspace folder: {error}"))?;
    if !resolved.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    Ok(resolved)
}

fn summarize_completion_matches(mut matches: Vec<String>) -> Vec<String> {
    if matches.len() > MAX_LAUNCHER_COMPLETION_MATCHES {
        let remaining = matches.len() - MAX_LAUNCHER_COMPLETION_MATCHES;
        matches.truncate(MAX_LAUNCHER_COMPLETION_MATCHES);
        matches.push(format!("... {remaining} more"));
    }

    matches
}

fn longest_common_prefix<T: AsRef<str>>(values: &[T]) -> String {
    let Some(first) = values.first() else {
        return String::new();
    };

    let mut prefix = first.as_ref().to_string();
    for value in values.iter().skip(1) {
        let mut matched_bytes = 0;
        for (left, right) in prefix.chars().zip(value.as_ref().chars()) {
            if left != right {
                break;
            }

            matched_bytes += left.len_utf8();
        }
        prefix.truncate(matched_bytes);
        if prefix.is_empty() {
            break;
        }
    }

    prefix
}

fn resolve_navigation_path(base_path: &Path, raw: &str) -> Result<PathBuf, String> {
    let target = extract_navigation_target(raw)?;
    let target = expand_navigation_target(target)?;
    let target = if target.is_absolute() {
        target
    } else {
        base_path.join(target)
    };

    let resolved = fs::canonicalize(&target)
        .map_err(|error| format!("failed to access workspace folder: {error}"))?;
    if !resolved.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    Ok(resolved)
}

fn extract_navigation_target(raw: &str) -> Result<&str, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("enter a folder path".to_string());
    }

    if contains_forbidden_navigation_tokens(trimmed) {
        return Err("only directory navigation is supported".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("cd") {
        let Some(first) = rest.chars().next() else {
            return Ok("~");
        };

        if first.is_whitespace() {
            let target = rest.trim();
            return if target.is_empty() {
                Ok("~")
            } else {
                Ok(target)
            };
        }
    }

    Ok(trimmed)
}

fn expand_navigation_target(raw: &str) -> Result<PathBuf, String> {
    let value = strip_wrapping_quotes(raw.trim());
    if value == "~" {
        return home_dir();
    }

    if let Some(rest) = value.strip_prefix("~/") {
        return Ok(home_dir()?.join(rest));
    }

    if value.starts_with('~') {
        return Err("only the current home directory shortcut (~) is supported".to_string());
    }

    Ok(PathBuf::from(value))
}

fn strip_wrapping_quotes(raw: &str) -> &str {
    if raw.len() >= 2 {
        let first = raw.as_bytes()[0];
        let last = raw.as_bytes()[raw.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &raw[1..raw.len() - 1];
        }
    }

    raw
}

#[derive(Debug)]
enum GitCommandErrorKind {
    NotRepo,
    MissingBinary,
    Failed,
}

#[derive(Debug)]
struct GitCommandError {
    kind: GitCommandErrorKind,
    message: String,
}

#[derive(Debug, Default)]
struct ParsedGitStatus {
    head: Option<String>,
    oid: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<GitFileSnapshot>,
}

fn collect_git_detail(workspace_path: &Path) -> GitDetailSnapshot {
    collect_git_detail_with_binary("git", workspace_path)
}

fn collect_git_detail_with_binary(git_binary: &str, workspace_path: &Path) -> GitDetailSnapshot {
    let repo_root = match run_git_command(
        git_binary,
        workspace_path,
        &["rev-parse", "--show-toplevel"],
    ) {
        Ok(output) => PathBuf::from(output.trim()),
        Err(error) => {
            return match error.kind {
                GitCommandErrorKind::NotRepo => GitDetailSnapshot {
                    summary: GitSummarySnapshot {
                        state: GitState::NotRepo,
                        branch: None,
                        upstream: None,
                        ahead: 0,
                        behind: 0,
                        counts: GitCountsSnapshot::default(),
                        is_dirty: false,
                        has_conflicts: false,
                        message: Some("This workspace is not inside a Git repository.".to_string()),
                    },
                    repo_root: None,
                    workspace_relative_path: None,
                    files: Vec::new(),
                },
                GitCommandErrorKind::MissingBinary | GitCommandErrorKind::Failed => {
                    GitDetailSnapshot {
                        summary: GitSummarySnapshot {
                            state: GitState::Error,
                            branch: None,
                            upstream: None,
                            ahead: 0,
                            behind: 0,
                            counts: GitCountsSnapshot::default(),
                            is_dirty: false,
                            has_conflicts: false,
                            message: Some(error.message),
                        },
                        repo_root: None,
                        workspace_relative_path: None,
                        files: Vec::new(),
                    }
                }
            };
        }
    };

    let status_output = match run_git_command(
        git_binary,
        workspace_path,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    ) {
        Ok(output) => output,
        Err(error) => {
            return GitDetailSnapshot {
                summary: GitSummarySnapshot {
                    state: GitState::Error,
                    branch: None,
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    counts: GitCountsSnapshot::default(),
                    is_dirty: false,
                    has_conflicts: false,
                    message: Some(error.message),
                },
                repo_root: Some(repo_root.display().to_string()),
                workspace_relative_path: workspace_relative_repo_path(&repo_root, workspace_path),
                files: Vec::new(),
            };
        }
    };

    let parsed = match parse_git_status_porcelain(&status_output) {
        Ok(parsed) => parsed,
        Err(error) => {
            return GitDetailSnapshot {
                summary: GitSummarySnapshot {
                    state: GitState::Error,
                    branch: None,
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    counts: GitCountsSnapshot::default(),
                    is_dirty: false,
                    has_conflicts: false,
                    message: Some(error),
                },
                repo_root: Some(repo_root.display().to_string()),
                workspace_relative_path: workspace_relative_repo_path(&repo_root, workspace_path),
                files: Vec::new(),
            };
        }
    };

    let counts = build_git_counts(&parsed.files);
    let has_conflicts = counts.conflicted > 0;
    let is_dirty = counts.staged > 0
        || counts.modified > 0
        || counts.deleted > 0
        || counts.renamed > 0
        || counts.untracked > 0
        || has_conflicts;
    let detached = parsed
        .head
        .as_deref()
        .map(|head| head.starts_with("(detached"))
        .unwrap_or(false);
    let branch = if detached {
        parsed.oid.as_deref().map(short_git_oid).map(str::to_string)
    } else {
        parsed.head.clone()
    };

    GitDetailSnapshot {
        summary: GitSummarySnapshot {
            state: if has_conflicts {
                GitState::Conflicted
            } else if detached {
                GitState::Detached
            } else if is_dirty {
                GitState::Dirty
            } else {
                GitState::Clean
            },
            branch,
            upstream: parsed.upstream,
            ahead: parsed.ahead,
            behind: parsed.behind,
            counts,
            is_dirty,
            has_conflicts,
            message: None,
        },
        repo_root: Some(repo_root.display().to_string()),
        workspace_relative_path: workspace_relative_repo_path(&repo_root, workspace_path),
        files: parsed.files,
    }
}

fn run_git_command(git_binary: &str, cwd: &Path, args: &[&str]) -> Result<String, GitCommandError> {
    let output = ProcessCommand::new(git_binary)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| {
            let kind = if error.kind() == std::io::ErrorKind::NotFound {
                GitCommandErrorKind::MissingBinary
            } else {
                GitCommandErrorKind::Failed
            };
            let message = if matches!(kind, GitCommandErrorKind::MissingBinary) {
                "Git is not installed or not available in PATH.".to_string()
            } else {
                format!("failed to run git {}: {error}", args.join(" "))
            };
            GitCommandError { kind, message }
        })?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = if stdout.is_empty() {
        stderr.clone()
    } else if stderr.is_empty() {
        stdout.clone()
    } else {
        format!("{stderr}\n{stdout}")
    };
    if combined
        .to_ascii_lowercase()
        .contains("not a git repository")
    {
        return Err(GitCommandError {
            kind: GitCommandErrorKind::NotRepo,
            message: "This workspace is not inside a Git repository.".to_string(),
        });
    }

    let message = if stderr.is_empty() {
        format!(
            "git {} failed with status {}",
            args.join(" "),
            output.status
        )
    } else {
        stderr
    };
    Err(GitCommandError {
        kind: GitCommandErrorKind::Failed,
        message,
    })
}

fn parse_git_status_porcelain(raw: &str) -> Result<ParsedGitStatus, String> {
    if raw.contains('\0') {
        return parse_git_status_porcelain_z(raw);
    }

    parse_git_status_porcelain_lines(raw)
}

fn parse_git_status_porcelain_z(raw: &str) -> Result<ParsedGitStatus, String> {
    let mut parsed = ParsedGitStatus::default();
    let records = raw
        .split('\0')
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let mut index = 0;

    while index < records.len() {
        let record = records[index];
        if let Some(head) = record.strip_prefix("# branch.head ") {
            parsed.head = Some(head.to_string());
            index += 1;
            continue;
        }

        if let Some(oid) = record.strip_prefix("# branch.oid ") {
            if oid != "(initial)" {
                parsed.oid = Some(oid.to_string());
            }
            index += 1;
            continue;
        }

        if let Some(upstream) = record.strip_prefix("# branch.upstream ") {
            parsed.upstream = Some(upstream.to_string());
            index += 1;
            continue;
        }

        if let Some(ab) = record.strip_prefix("# branch.ab ") {
            for value in ab.split_whitespace() {
                if let Some(ahead) = value.strip_prefix('+') {
                    parsed.ahead = ahead.parse::<u32>().unwrap_or(0);
                } else if let Some(behind) = value.strip_prefix('-') {
                    parsed.behind = behind.parse::<u32>().unwrap_or(0);
                }
            }
            index += 1;
            continue;
        }

        match record.as_bytes().first().copied() {
            Some(b'1') => {
                parsed.files.push(parse_git_changed_file(record)?);
                index += 1;
            }
            Some(b'2') => {
                let original_path = records.get(index + 1).ok_or_else(|| {
                    format!("missing original path in git rename record: {record}")
                })?;
                parsed
                    .files
                    .push(parse_git_renamed_file_z(record, original_path)?);
                index += 2;
            }
            Some(b'u') => {
                parsed.files.push(parse_git_conflicted_file(record)?);
                index += 1;
            }
            Some(b'?') => {
                parsed.files.push(parse_git_untracked_file(record)?);
                index += 1;
            }
            Some(b'!') => {
                index += 1;
            }
            _ => return Err(format!("unsupported git status record: {record}")),
        }
    }

    Ok(parsed)
}

fn parse_git_status_porcelain_lines(raw: &str) -> Result<ParsedGitStatus, String> {
    let mut parsed = ParsedGitStatus::default();

    for line in raw.lines().filter(|line| !line.is_empty()) {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            parsed.head = Some(head.to_string());
            continue;
        }

        if let Some(oid) = line.strip_prefix("# branch.oid ") {
            if oid != "(initial)" {
                parsed.oid = Some(oid.to_string());
            }
            continue;
        }

        if let Some(upstream) = line.strip_prefix("# branch.upstream ") {
            parsed.upstream = Some(upstream.to_string());
            continue;
        }

        if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for value in ab.split_whitespace() {
                if let Some(ahead) = value.strip_prefix('+') {
                    parsed.ahead = ahead.parse::<u32>().unwrap_or(0);
                } else if let Some(behind) = value.strip_prefix('-') {
                    parsed.behind = behind.parse::<u32>().unwrap_or(0);
                }
            }
            continue;
        }

        match line.as_bytes().first().copied() {
            Some(b'1') => parsed.files.push(parse_git_changed_file(line)?),
            Some(b'2') => parsed.files.push(parse_git_renamed_file(line)?),
            Some(b'u') => parsed.files.push(parse_git_conflicted_file(line)?),
            Some(b'?') => parsed.files.push(parse_git_untracked_file(line)?),
            Some(b'!') => {}
            _ => return Err(format!("unsupported git status line: {line}")),
        }
    }

    Ok(parsed)
}

fn parse_git_changed_file(line: &str) -> Result<GitFileSnapshot, String> {
    let remainder = line
        .strip_prefix("1 ")
        .ok_or_else(|| format!("invalid git changed-file line: {line}"))?;
    let mut parts = remainder.splitn(8, ' ');
    let xy = parts
        .next()
        .ok_or_else(|| format!("missing XY status in git line: {line}"))?;
    for _ in 0..6 {
        parts.next();
    }
    let path = parts
        .next()
        .ok_or_else(|| format!("missing file path in git line: {line}"))?;
    let (index_status, worktree_status) = parse_xy_statuses(xy)?;

    Ok(GitFileSnapshot {
        path: path.to_string(),
        original_path: None,
        kind: classify_git_file_kind(index_status, worktree_status),
        index_status,
        worktree_status,
    })
}

fn parse_git_renamed_file(line: &str) -> Result<GitFileSnapshot, String> {
    let remainder = line
        .strip_prefix("2 ")
        .ok_or_else(|| format!("invalid git renamed-file line: {line}"))?;
    let mut parts = remainder.splitn(9, ' ');
    let xy = parts
        .next()
        .ok_or_else(|| format!("missing XY status in git line: {line}"))?;
    for _ in 0..7 {
        parts.next();
    }
    let paths = parts
        .next()
        .ok_or_else(|| format!("missing rename paths in git line: {line}"))?;
    let (path, original_path) = paths
        .split_once('\t')
        .ok_or_else(|| format!("missing original path in rename line: {line}"))?;
    let (index_status, worktree_status) = parse_xy_statuses(xy)?;

    Ok(GitFileSnapshot {
        path: path.to_string(),
        original_path: Some(original_path.to_string()),
        kind: GitFileKind::Renamed,
        index_status,
        worktree_status,
    })
}

fn parse_git_renamed_file_z(record: &str, original_path: &str) -> Result<GitFileSnapshot, String> {
    let remainder = record
        .strip_prefix("2 ")
        .ok_or_else(|| format!("invalid git renamed-file record: {record}"))?;
    let mut parts = remainder.splitn(9, ' ');
    let xy = parts
        .next()
        .ok_or_else(|| format!("missing XY status in git record: {record}"))?;
    for _ in 0..7 {
        parts.next();
    }
    let path = parts
        .next()
        .ok_or_else(|| format!("missing rename path in git record: {record}"))?;
    let (index_status, worktree_status) = parse_xy_statuses(xy)?;

    Ok(GitFileSnapshot {
        path: path.to_string(),
        original_path: Some(original_path.to_string()),
        kind: GitFileKind::Renamed,
        index_status,
        worktree_status,
    })
}

fn parse_git_conflicted_file(line: &str) -> Result<GitFileSnapshot, String> {
    let remainder = line
        .strip_prefix("u ")
        .ok_or_else(|| format!("invalid git conflicted-file line: {line}"))?;
    let mut parts = remainder.splitn(10, ' ');
    let xy = parts
        .next()
        .ok_or_else(|| format!("missing XY status in git line: {line}"))?;
    for _ in 0..8 {
        parts.next();
    }
    let path = parts
        .next()
        .ok_or_else(|| format!("missing conflicted path in git line: {line}"))?;
    let (index_status, worktree_status) = parse_xy_statuses(xy)?;

    Ok(GitFileSnapshot {
        path: path.to_string(),
        original_path: None,
        kind: GitFileKind::Conflicted,
        index_status: index_status.or(Some(GitFileStatus::Unmerged)),
        worktree_status: worktree_status.or(Some(GitFileStatus::Unmerged)),
    })
}

fn parse_git_untracked_file(line: &str) -> Result<GitFileSnapshot, String> {
    let path = line
        .strip_prefix("? ")
        .ok_or_else(|| format!("invalid git untracked-file line: {line}"))?;
    Ok(GitFileSnapshot {
        path: path.to_string(),
        original_path: None,
        kind: GitFileKind::Untracked,
        index_status: None,
        worktree_status: None,
    })
}

fn parse_xy_statuses(xy: &str) -> Result<(Option<GitFileStatus>, Option<GitFileStatus>), String> {
    let mut chars = xy.chars();
    let index = chars
        .next()
        .ok_or_else(|| format!("missing index status in git XY marker: {xy}"))?;
    let worktree = chars
        .next()
        .ok_or_else(|| format!("missing worktree status in git XY marker: {xy}"))?;
    Ok((
        parse_git_file_status(index),
        parse_git_file_status(worktree),
    ))
}

fn parse_git_file_status(character: char) -> Option<GitFileStatus> {
    match character {
        '.' => None,
        'A' => Some(GitFileStatus::Added),
        'M' => Some(GitFileStatus::Modified),
        'D' => Some(GitFileStatus::Deleted),
        'R' => Some(GitFileStatus::Renamed),
        'C' => Some(GitFileStatus::Copied),
        'T' => Some(GitFileStatus::TypeChanged),
        'U' => Some(GitFileStatus::Unmerged),
        _ => Some(GitFileStatus::Modified),
    }
}

fn classify_git_file_kind(
    index_status: Option<GitFileStatus>,
    worktree_status: Option<GitFileStatus>,
) -> GitFileKind {
    if matches!(index_status, Some(GitFileStatus::Unmerged))
        || matches!(worktree_status, Some(GitFileStatus::Unmerged))
    {
        GitFileKind::Conflicted
    } else if matches!(
        index_status,
        Some(GitFileStatus::Renamed | GitFileStatus::Copied)
    ) || matches!(
        worktree_status,
        Some(GitFileStatus::Renamed | GitFileStatus::Copied)
    ) {
        GitFileKind::Renamed
    } else if matches!(index_status, Some(GitFileStatus::Deleted))
        || matches!(worktree_status, Some(GitFileStatus::Deleted))
    {
        GitFileKind::Deleted
    } else if index_status.is_some() {
        GitFileKind::Staged
    } else {
        GitFileKind::Modified
    }
}

fn build_git_counts(files: &[GitFileSnapshot]) -> GitCountsSnapshot {
    let mut counts = GitCountsSnapshot::default();

    for file in files {
        if matches!(file.kind, GitFileKind::Untracked) {
            counts.untracked += 1;
            continue;
        }

        if matches!(file.kind, GitFileKind::Conflicted) {
            counts.conflicted += 1;
            continue;
        }

        if matches!(
            file.index_status,
            Some(
                GitFileStatus::Added
                    | GitFileStatus::Modified
                    | GitFileStatus::Deleted
                    | GitFileStatus::Renamed
                    | GitFileStatus::Copied
                    | GitFileStatus::TypeChanged
            )
        ) {
            counts.staged += 1;
        }

        if matches!(
            file.worktree_status,
            Some(GitFileStatus::Modified | GitFileStatus::TypeChanged)
        ) {
            counts.modified += 1;
        }

        if matches!(file.index_status, Some(GitFileStatus::Deleted))
            || matches!(file.worktree_status, Some(GitFileStatus::Deleted))
        {
            counts.deleted += 1;
        }

        if matches!(
            file.index_status,
            Some(GitFileStatus::Renamed | GitFileStatus::Copied)
        ) || matches!(
            file.worktree_status,
            Some(GitFileStatus::Renamed | GitFileStatus::Copied)
        ) {
            counts.renamed += 1;
        }
    }

    counts
}

fn workspace_relative_repo_path(repo_root: &Path, workspace_path: &Path) -> Option<String> {
    let canonical_repo_root = fs::canonicalize(repo_root)
        .ok()
        .unwrap_or_else(|| repo_root.to_path_buf());
    let canonical_workspace_path = fs::canonicalize(workspace_path)
        .ok()
        .unwrap_or_else(|| workspace_path.to_path_buf());

    canonical_workspace_path
        .strip_prefix(&canonical_repo_root)
        .ok()
        .and_then(|relative| {
            if relative.as_os_str().is_empty() {
                None
            } else {
                Some(relative.display().to_string())
            }
        })
}

fn short_git_oid(oid: &str) -> &str {
    let end = oid.len().min(7);
    &oid[..end]
}

fn home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(
            || match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
                (Some(drive), Some(path)) => {
                    let mut combined = PathBuf::from(drive);
                    combined.push(path);
                    Some(combined)
                }
                _ => None,
            },
        )
        .ok_or_else(|| "home directory is not available".to_string())
}

fn contains_forbidden_navigation_tokens(value: &str) -> bool {
    ["&&", "||", ";", "|", "`", "$(", "\n", "\r"]
        .iter()
        .any(|token| value.contains(token))
}

fn workspace_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| path.display().to_string())
}

fn normalize_workspace_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workspace name cannot be empty".to_string());
    }

    Ok(trimmed.to_string())
}

fn normalize_workspace_todo_text(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workspace task cannot be empty".to_string());
    }

    Ok(trimmed.to_string())
}

fn relabel_panes(panes: &mut [PaneRecord]) {
    for (index, pane) in panes.iter_mut().enumerate() {
        pane.label = format!("Shell {:02}", index + 1);
    }
}

fn build_balanced_pane_layout(pane_ids: &[String], prefer_horizontal: bool) -> PaneLayout {
    if pane_ids.len() == 1 {
        return PaneLayout::Leaf {
            pane_id: pane_ids[0].clone(),
        };
    }

    let midpoint = pane_ids.len().div_ceil(2);
    let axis = if prefer_horizontal {
        SplitAxis::Horizontal
    } else {
        SplitAxis::Vertical
    };

    PaneLayout::Split {
        axis,
        first: Box::new(build_balanced_pane_layout(
            &pane_ids[..midpoint],
            !prefer_horizontal,
        )),
        second: Box::new(build_balanced_pane_layout(
            &pane_ids[midpoint..],
            !prefer_horizontal,
        )),
    }
}

fn split_pane_layout(
    layout: &mut PaneLayout,
    pane_id: &str,
    axis: SplitAxis,
    new_pane_first: bool,
    new_pane_id: &str,
) -> bool {
    match layout {
        PaneLayout::Leaf { pane_id: existing } if existing == pane_id => {
            let current_leaf = PaneLayout::Leaf {
                pane_id: existing.clone(),
            };
            let new_leaf = PaneLayout::Leaf {
                pane_id: new_pane_id.to_string(),
            };
            *layout = if new_pane_first {
                PaneLayout::Split {
                    axis,
                    first: Box::new(new_leaf),
                    second: Box::new(current_leaf),
                }
            } else {
                PaneLayout::Split {
                    axis,
                    first: Box::new(current_leaf),
                    second: Box::new(new_leaf),
                }
            };
            true
        }
        PaneLayout::Split { first, second, .. } => {
            split_pane_layout(first, pane_id, axis, new_pane_first, new_pane_id)
                || split_pane_layout(second, pane_id, axis, new_pane_first, new_pane_id)
        }
        PaneLayout::Leaf { .. } => false,
    }
}

fn remove_pane_from_layout(layout: PaneLayout, pane_id: &str) -> Option<PaneLayout> {
    match layout {
        PaneLayout::Leaf { pane_id: existing } => {
            if existing == pane_id {
                None
            } else {
                Some(PaneLayout::Leaf { pane_id: existing })
            }
        }
        PaneLayout::Split {
            axis,
            first,
            second,
        } => {
            let first = remove_pane_from_layout(*first, pane_id);
            let second = remove_pane_from_layout(*second, pane_id);
            match (first, second) {
                (Some(first), Some(second)) => Some(PaneLayout::Split {
                    axis,
                    first: Box::new(first),
                    second: Box::new(second),
                }),
                (Some(node), None) | (None, Some(node)) => Some(node),
                (None, None) => None,
            }
        }
    }
}

fn persist_pane_layout(workspace: &WorkspaceRecord) -> Option<PersistedPaneLayout> {
    let pane_index_by_id = workspace
        .panes
        .iter()
        .enumerate()
        .map(|(index, pane)| (pane.id.clone(), index))
        .collect::<HashMap<_, _>>();
    persist_pane_layout_node(&workspace.pane_layout, &pane_index_by_id)
}

fn persist_pane_layout_node(
    layout: &PaneLayout,
    pane_index_by_id: &HashMap<String, usize>,
) -> Option<PersistedPaneLayout> {
    match layout {
        PaneLayout::Leaf { pane_id } => pane_index_by_id
            .get(pane_id)
            .copied()
            .map(|index| PersistedPaneLayout::Leaf { index }),
        PaneLayout::Split {
            axis,
            first,
            second,
        } => Some(PersistedPaneLayout::Split {
            axis: *axis,
            first: Box::new(persist_pane_layout_node(first, pane_index_by_id)?),
            second: Box::new(persist_pane_layout_node(second, pane_index_by_id)?),
        }),
    }
}

fn restore_pane_layout(layout: &PersistedPaneLayout, pane_ids: &[String]) -> Option<PaneLayout> {
    match layout {
        PersistedPaneLayout::Leaf { index } => pane_ids
            .get(*index)
            .cloned()
            .map(|pane_id| PaneLayout::Leaf { pane_id }),
        PersistedPaneLayout::Split {
            axis,
            first,
            second,
        } => Some(PaneLayout::Split {
            axis: *axis,
            first: Box::new(restore_pane_layout(first, pane_ids)?),
            second: Box::new(restore_pane_layout(second, pane_ids)?),
        }),
    }
}

fn list_directory_entries(path: &Path) -> Result<Vec<String>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("failed to read directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| {
            let file_type = entry.file_type().ok();
            let name = entry.file_name().to_string_lossy().to_string();
            if file_type.map(|kind| kind.is_dir()).unwrap_or(false) {
                format!("{name}/")
            } else {
                name
            }
        })
        .collect::<Vec<_>>();

    entries.sort_unstable();
    if entries.is_empty() {
        return Ok(vec!["(empty)".to_string()]);
    }

    if entries.len() > 24 {
        let remaining = entries.len() - 24;
        entries.truncate(24);
        entries.push(format!("... {remaining} more"));
    }

    Ok(entries)
}

fn layout_for_pane_count(pane_count: u8) -> Result<LayoutPreset, String> {
    if !(1..=16).contains(&pane_count) {
        return Err("terminal count must be between 1 and 16".to_string());
    }

    let columns = ((pane_count as f32).sqrt().ceil() as u8).clamp(1, 4);
    let rows = ((pane_count + columns - 1) / columns).clamp(1, 4);
    Ok(LayoutPreset::new(
        &format!("count-{pane_count}"),
        format!("{pane_count} terminals"),
        rows,
        columns,
        pane_count,
    ))
}

fn layout_presets() -> Vec<LayoutPreset> {
    [1, 2, 4, 8, 12, 16]
        .into_iter()
        .filter_map(|pane_count| layout_for_pane_count(pane_count).ok())
        .collect()
}

fn pane_count_from_legacy_layout_id(layout_id: &str) -> Option<u8> {
    match layout_id {
        "2x2" => Some(4),
        "3x4" => Some(12),
        "4x4" => Some(16),
        _ => None,
    }
}

fn terminate_sessions(killers: Vec<Box<dyn ChildKiller + Send + Sync>>) {
    for mut killer in killers {
        let _ = killer.kill();
    }
}

fn write_shell_command(
    writer: &Arc<Mutex<Box<dyn Write + Send>>>,
    command: &str,
) -> Result<(), String> {
    let mut writer = writer
        .lock()
        .map_err(|_| "failed to acquire pane writer".to_string())?;
    writer
        .write_all(command.as_bytes())
        .map_err(|error| format!("failed to write to pane: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush pane writer: {error}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(SystemHealthState::default())
        .setup(|app| {
            let shared = app.state::<AppState>().inner.clone();
            let restore = (|| -> Result<(Vec<PaneJob>, String), String> {
                let persistence_path = resolve_persistence_path(app.handle())?;
                let mut runtime = shared
                    .lock()
                    .map_err(|_| "failed to acquire application state".to_string())?;

                if let Err(error) = runtime.load_persisted_from_disk(persistence_path) {
                    eprintln!("{error}");
                }

                runtime.refresh_codex_cli();

                let pane_jobs = runtime
                    .active_workspace_id
                    .clone()
                    .and_then(|workspace_id| prepare_workspace_launch(&mut runtime, &workspace_id))
                    .unwrap_or_default();

                Ok((pane_jobs, runtime.shell.clone()))
            })();

            match restore {
                Ok((pane_jobs, shell)) => {
                    spawn_pane_jobs(shared, app.handle().clone(), shell, pane_jobs);
                }
                Err(error) => eprintln!("{error}"),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_snapshot,
            load_system_health_snapshot,
            reset_to_launcher,
            create_workspace,
            rename_workspace,
            add_workspace_todo,
            update_workspace_todo,
            set_workspace_todo_done,
            delete_workspace_todo,
            reorder_workspace,
            complete_launcher_input,
            set_settings,
            set_theme,
            set_interface_text_scale,
            set_terminal_font_size,
            set_openai_api_key,
            set_codex_cli_path,
            refresh_codex_cli_catalog,
            load_workspace_codex_sessions,
            resume_workspace_codex_session,
            start_workspace_codex_session,
            refresh_workspace_git_status,
            load_workspace_source_control,
            load_workspace_file_explorer_directory,
            load_workspace_text_file,
            save_workspace_text_file,
            persist_workspace_file_draft,
            clear_workspace_file_draft,
            load_workspace_git_diff,
            load_workspace_git_commit_detail,
            git_stage_paths,
            git_unstage_paths,
            git_discard_paths,
            generate_git_commit_message,
            git_commit,
            git_checkout_branch,
            git_create_branch,
            git_rename_branch,
            git_delete_branch,
            git_fetch,
            git_pull,
            git_push,
            git_publish_branch,
            git_set_upstream,
            git_task_write_stdin,
            switch_workspace,
            close_workspace,
            split_pane,
            close_pane,
            show_in_finder,
            list_external_workspace_targets,
            open_workspace_in_target,
            run_launcher_command,
            write_to_pane,
            resize_pane
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrewDock");
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        env,
        ffi::{OsStr, OsString},
        fs,
        path::{Path, PathBuf},
        process::Command,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    use super::{
        build_codex_cli_snapshot, build_codex_session_display_title,
        build_external_workspace_target_snapshot, collect_git_detail,
        collect_git_detail_with_binary, compare_codex_cli_versions,
        complete_launcher_input_for_base, default_launcher_path, execute_launcher_command,
        external_workspace_target_spec, extract_login_shell_path, extract_navigation_target,
        layout_for_pane_count, layout_presets, load_workspace_file_explorer_directory_snapshot,
        load_workspace_text_file_snapshot, merge_path_values, normalize_workspace_path,
        parse_battery_snapshot, parse_codex_cli_version, parse_git_status_porcelain,
        persistence::ActivityEventKind, prepare_workspace_launch, read_codex_session_summary,
        resolve_navigation_path, save_workspace_text_file_snapshot,
        upsert_workspace_codex_restore_binding, validate_git_cli_arg, BatteryState,
        CodexCliCandidateSnapshot, CodexCliSelectionMode, CodexCliSource, CodexCliStatus,
        ExternalWorkspaceTargetKind, GitFileKind, GitState, PendingCodexStartRecord, RuntimeState,
        ThemeId, WorkspaceFileDraftRecord, WorkspaceFileExplorerEntryKind,
        WorkspaceTextFileNewlineStyle, WorkspaceTodoRecord, DEFAULT_INTERFACE_TEXT_SCALE,
        DEFAULT_TERMINAL_FONT_SIZE,
    };

    #[test]
    fn launcher_starts_without_any_workspaces() {
        let runtime = RuntimeState::seeded();
        assert!(runtime.workspaces.is_empty());
        assert!(runtime.active_workspace_id.is_none());
        assert_eq!(runtime.launcher.presets.len(), 6);
        assert_eq!(runtime.settings.theme_id, ThemeId::OneDark);
        assert_eq!(
            runtime.settings.interface_text_scale,
            DEFAULT_INTERFACE_TEXT_SCALE
        );
        assert_eq!(
            runtime.settings.terminal_font_size,
            DEFAULT_TERMINAL_FONT_SIZE
        );
    }

    #[test]
    fn external_workspace_targets_include_antigravity_cursor_and_finder() {
        let antigravity =
            external_workspace_target_spec("antigravity").expect("antigravity target should exist");
        let cursor = external_workspace_target_spec("cursor").expect("cursor target should exist");
        let finder = external_workspace_target_spec("finder").expect("finder target should exist");

        assert_eq!(antigravity.label, "Antigravity");
        assert_eq!(antigravity.kind, ExternalWorkspaceTargetKind::Editor);
        assert_eq!(cursor.label, "Cursor");
        assert_eq!(cursor.kind, ExternalWorkspaceTargetKind::Editor);
        assert_eq!(finder.kind, ExternalWorkspaceTargetKind::System);
        assert!(external_workspace_target_spec("unknown-target").is_none());
    }

    #[test]
    fn external_workspace_target_snapshot_preserves_kind_metadata() {
        let snapshot = build_external_workspace_target_snapshot(
            external_workspace_target_spec("vscode").expect("vs code target should exist"),
            Some("data:image/png;base64,ZmFrZQ==".to_string()),
        );

        assert_eq!(snapshot.id, "vscode");
        assert_eq!(snapshot.label, "VS Code");
        assert_eq!(snapshot.kind, ExternalWorkspaceTargetKind::Editor);
        assert_eq!(
            snapshot.icon_data_url.as_deref(),
            Some("data:image/png;base64,ZmFrZQ==")
        );
    }

    #[test]
    fn preset_counts_match_grid_size() {
        let presets = layout_presets();
        assert_eq!(presets[0].pane_count, 1);
        assert_eq!(presets[1].pane_count, 2);
        assert_eq!(presets[2].pane_count, 4);
        assert_eq!(presets[3].pane_count, 8);
        assert_eq!(presets[4].pane_count, 12);
        assert_eq!(presets[5].pane_count, 16);
    }

    #[test]
    fn battery_snapshot_is_parsed_from_pmset_output() {
        let output =
            "Now drawing from 'AC Power'\n -InternalBattery-0 (id=22216803)\t100%; charged; 0:00 remaining present: true\n";
        let (battery_percent, battery_state) = parse_battery_snapshot(output);

        assert_eq!(battery_percent, Some(100.0));
        assert!(matches!(battery_state, Some(BatteryState::Full)));
    }

    #[test]
    fn codex_session_title_uses_cleaned_first_prompt() {
        let title = build_codex_session_display_title(
            "/tmp/crewdock",
            Some(
                "<image name=[Image #1]>preview</image> [Image #1] Can you please fix terminal right-click menu clipping so it stays on-screen?",
            ),
        );

        assert_eq!(
            title,
            "crewdock: fix terminal right-click menu clipping so it stays on-screen"
        );
    }

    #[test]
    fn codex_session_title_drops_leading_urls() {
        let title = build_codex_session_display_title(
            "/tmp/crewdock",
            Some("https://chatgpt.com/codex?foo=1 Could you review the render scheduler change in CrewDock?"),
        );

        assert_eq!(
            title,
            "crewdock: review the render scheduler change in CrewDock"
        );
    }

    #[test]
    fn codex_session_title_falls_back_when_no_prompt_exists() {
        let title = build_codex_session_display_title("/tmp/crewdock", None);
        assert_eq!(title, "crewdock session");
    }

    #[test]
    fn codex_session_title_strips_instruction_wrapper_but_keeps_real_ask() {
        let title = build_codex_session_display_title(
            "/tmp/fastapi-backends",
            Some(
                "# AGENTS.md instructions for /tmp/fastapi-backends\n\n<INSTRUCTIONS>\ninternal guidance\n</INSTRUCTIONS>\nCan you inspect the auth flow and explain what is missing?",
            ),
        );

        assert_eq!(
            title,
            "fastapi-backends: inspect the auth flow and explain what is missing"
        );
    }

    #[test]
    fn codex_session_summary_reads_event_user_message() {
        let workspace = TestWorkspace::new();
        let session_file = workspace.root_dir().join("codex-event.jsonl");
        fs::write(
            &session_file,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-1\",\"cwd\":\"/tmp/crewdock\",\"originator\":\"codex_cli_rs\",\"cli_version\":\"0.116.0\",\"source\":\"cli\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Can you inspect the right click menu clipping?\"}}\n",
            ),
        )
        .unwrap();

        let summary =
            read_codex_session_summary(&session_file).expect("session summary should load");

        assert_eq!(summary.meta.id, "session-1");
        assert_eq!(
            summary.first_user_prompt.as_deref(),
            Some("Can you inspect the right click menu clipping?")
        );
    }

    #[test]
    fn codex_session_summary_skips_environment_context_and_uses_real_ask() {
        let workspace = TestWorkspace::new();
        let session_file = workspace.root_dir().join("codex-environment-context.jsonl");
        fs::write(
            &session_file,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-ctx\",\"cwd\":\"/tmp/fastapi-backends\",\"originator\":\"codex_cli_rs\",\"cli_version\":\"0.116.0\",\"source\":\"cli\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"<environment_context>\\n  <cwd>/tmp/fastapi-backends</cwd>\\n</environment_context>\"}]}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Can you map the auth endpoints for this backend?\"}}\n",
            ),
        )
        .unwrap();

        let summary =
            read_codex_session_summary(&session_file).expect("session summary should load");

        assert_eq!(
            summary.first_user_prompt.as_deref(),
            Some("Can you map the auth endpoints for this backend?")
        );
    }

    #[test]
    fn codex_session_summary_skips_agents_instructions_blob() {
        let workspace = TestWorkspace::new();
        let session_file = workspace.root_dir().join("codex-agents-instructions.jsonl");
        fs::write(
            &session_file,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-3\",\"cwd\":\"/tmp/fastapi-backends\",\"originator\":\"codex_cli_rs\",\"cli_version\":\"0.116.0\",\"source\":\"cli\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"# AGENTS.md instructions for /tmp/fastapi-backends\\n\\n<INSTRUCTIONS>\\ninternal guidance\\n</INSTRUCTIONS>\"}]}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Could you explain the current backend structure and what is left to build?\"}]}}\n",
            ),
        )
        .unwrap();

        let summary =
            read_codex_session_summary(&session_file).expect("session summary should load");

        assert_eq!(
            summary.first_user_prompt.as_deref(),
            Some("Could you explain the current backend structure and what is left to build?")
        );
    }

    #[test]
    fn codex_session_summary_falls_back_to_response_item_user_message() {
        let workspace = TestWorkspace::new();
        let session_file = workspace.root_dir().join("codex-response-item.jsonl");
        fs::write(
            &session_file,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-2\",\"cwd\":\"/tmp/crewdock\",\"originator\":\"codex_cli_rs\",\"cli_version\":\"0.116.0\",\"source\":\"cli\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"developer\",\"content\":[{\"type\":\"input_text\",\"text\":\"skip\"}]}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_image\"},{\"type\":\"input_text\",\"text\":\"Please audit the render path for perf pitfalls.\"}]}}\n",
            ),
        )
        .unwrap();

        let summary =
            read_codex_session_summary(&session_file).expect("session summary should load");

        assert_eq!(summary.meta.id, "session-2");
        assert_eq!(
            summary.first_user_prompt.as_deref(),
            Some("Please audit the render path for perf pitfalls.")
        );
    }

    #[test]
    fn dynamic_layouts_balance_the_grid() {
        let five = layout_for_pane_count(5).unwrap();
        assert_eq!(five.rows, 2);
        assert_eq!(five.columns, 3);

        let eleven = layout_for_pane_count(11).unwrap();
        assert_eq!(eleven.rows, 3);
        assert_eq!(eleven.columns, 4);

        assert!(layout_for_pane_count(0).is_err());
        assert!(layout_for_pane_count(17).is_err());
    }

    #[test]
    fn starting_a_workspace_marks_it_live_and_booting() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");
        let workspace = runtime
            .build_workspace_record(&cwd, runtime.launcher.presets[0].pane_count, None)
            .unwrap();
        let workspace_id = workspace.id.clone();
        runtime.workspaces.push(workspace);

        let jobs = prepare_workspace_launch(&mut runtime, &workspace_id)
            .expect("workspace should produce pane jobs");

        assert_eq!(jobs.len(), 1);
        assert!(runtime.workspaces[0].started);
        assert!(runtime.workspaces[0]
            .panes
            .iter()
            .all(|pane| pane.status == super::PaneStatus::Booting));
    }

    #[test]
    fn same_folder_can_back_multiple_workspace_sessions() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");

        let first = runtime.build_workspace_record(&cwd, 2, None).unwrap();
        let second = runtime.build_workspace_record(&cwd, 4, None).unwrap();

        runtime.active_workspace_id = Some(second.id.clone());
        runtime.workspaces.push(first.clone());
        runtime.workspaces.push(second.clone());

        let persisted = runtime.persisted_state();
        assert_eq!(runtime.workspaces.len(), 2);
        assert_eq!(runtime.workspaces[0].path, runtime.workspaces[1].path);
        assert_eq!(persisted.active_workspace_index, Some(1));
        assert_eq!(
            persisted.workspaces[0].name.as_deref(),
            Some(runtime.workspaces[0].name.as_str())
        );
        assert_eq!(
            persisted.workspaces[1].name.as_deref(),
            Some(runtime.workspaces[1].name.as_str())
        );
        assert_eq!(persisted.workspaces[0].pane_count, Some(2));
        assert_eq!(persisted.workspaces[1].pane_count, Some(4));
        assert_eq!(persisted.settings.theme_id.as_deref(), Some("one-dark"));
        assert_eq!(persisted.settings.interface_text_scale, Some(1.0));
        assert_eq!(persisted.settings.terminal_font_size, Some(13.5));
        assert_eq!(persisted.settings.openai_api_key, None);
    }

    #[test]
    fn reordering_workspaces_updates_persisted_order_and_active_index() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");

        let mut first = runtime.build_workspace_record(&cwd, 1, None).unwrap();
        first.name = "Alpha".to_string();
        let mut second = runtime.build_workspace_record(&cwd, 2, None).unwrap();
        second.name = "Beta".to_string();
        let mut third = runtime.build_workspace_record(&cwd, 4, None).unwrap();
        third.name = "Gamma".to_string();

        runtime.active_workspace_id = Some(second.id.clone());
        runtime.workspaces.push(first.clone());
        runtime.workspaces.push(second.clone());
        runtime.workspaces.push(third.clone());

        super::workspace_manager::reorder_workspace_in_runtime(&mut runtime, &first.id, 2)
            .expect("workspace reorder should succeed");

        assert_eq!(
            runtime
                .workspaces
                .iter()
                .map(|workspace| workspace.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Beta", "Gamma", "Alpha"]
        );
        assert_eq!(
            runtime.active_workspace_id.as_deref(),
            Some(second.id.as_str())
        );

        let persisted = runtime.persisted_state();
        assert_eq!(persisted.active_workspace_index, Some(0));
        assert_eq!(
            persisted
                .workspaces
                .iter()
                .map(|workspace| workspace.name.as_deref().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["Beta", "Gamma", "Alpha"]
        );
    }

    #[test]
    fn reordering_workspace_to_end_uses_post_removal_insertion_index() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");

        let mut first = runtime.build_workspace_record(&cwd, 1, None).unwrap();
        first.name = "Alpha".to_string();
        let mut second = runtime.build_workspace_record(&cwd, 2, None).unwrap();
        second.name = "Beta".to_string();
        let mut third = runtime.build_workspace_record(&cwd, 4, None).unwrap();
        third.name = "Gamma".to_string();

        runtime.workspaces.push(first.clone());
        runtime.workspaces.push(second.clone());
        runtime.workspaces.push(third.clone());

        super::workspace_manager::reorder_workspace_in_runtime(&mut runtime, &first.id, 2)
            .expect("workspace reorder should allow end insertion");

        assert_eq!(
            runtime
                .workspaces
                .iter()
                .map(|workspace| workspace.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Beta", "Gamma", "Alpha"]
        );
    }

    #[test]
    fn closing_active_workspace_after_reorder_uses_new_neighbor_order() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");

        let mut first = runtime.build_workspace_record(&cwd, 1, None).unwrap();
        first.name = "Alpha".to_string();
        let mut second = runtime.build_workspace_record(&cwd, 2, None).unwrap();
        second.name = "Beta".to_string();
        let mut third = runtime.build_workspace_record(&cwd, 4, None).unwrap();
        third.name = "Gamma".to_string();

        runtime.active_workspace_id = Some(second.id.clone());
        runtime.workspaces.push(first.clone());
        runtime.workspaces.push(second.clone());
        runtime.workspaces.push(third.clone());

        super::workspace_manager::reorder_workspace_in_runtime(&mut runtime, &first.id, 2)
            .expect("workspace reorder should succeed");

        let _ = super::workspace_manager::close_workspace_in_runtime(&mut runtime, &second.id)
            .expect("closing the reordered active workspace should succeed");

        assert_eq!(
            runtime.active_workspace_id.as_deref(),
            Some(third.id.as_str())
        );
        assert_eq!(
            runtime
                .workspaces
                .iter()
                .map(|workspace| workspace.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Gamma", "Alpha"]
        );
    }

    #[test]
    fn workspace_todos_preserve_open_and_completed_ordering() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");
        let workspace = runtime.build_workspace_record(&cwd, 1, None).unwrap();
        let workspace_id = workspace.id.clone();
        runtime.workspaces.push(workspace);

        super::workspace_manager::add_workspace_todo_in_runtime(
            &mut runtime,
            &workspace_id,
            "Draft changelog",
        )
        .expect("should add first todo");
        super::workspace_manager::add_workspace_todo_in_runtime(
            &mut runtime,
            &workspace_id,
            "Review PR",
        )
        .expect("should add second todo");

        let first_todo_id = runtime.workspaces[0].todos[0].id.clone();
        let second_todo_id = runtime.workspaces[0].todos[1].id.clone();

        super::workspace_manager::set_workspace_todo_done_in_runtime(
            &mut runtime,
            &workspace_id,
            &first_todo_id,
            true,
        )
        .expect("should complete first todo");
        super::workspace_manager::update_workspace_todo_in_runtime(
            &mut runtime,
            &workspace_id,
            &second_todo_id,
            "Review PR thoroughly",
        )
        .expect("should rename second todo");
        super::workspace_manager::set_workspace_todo_done_in_runtime(
            &mut runtime,
            &workspace_id,
            &first_todo_id,
            false,
        )
        .expect("should reopen first todo");
        super::workspace_manager::delete_workspace_todo_in_runtime(
            &mut runtime,
            &workspace_id,
            &second_todo_id,
        )
        .expect("should delete second todo");

        assert_eq!(
            runtime.workspaces[0]
                .todos
                .iter()
                .map(|todo| (todo.text.as_str(), todo.done))
                .collect::<Vec<_>>(),
            vec![("Draft changelog", false)]
        );
        assert!(super::workspace_manager::add_workspace_todo_in_runtime(
            &mut runtime,
            &workspace_id,
            "   "
        )
        .is_err());
    }

    #[test]
    fn theme_parser_accepts_only_supported_theme_ids() {
        assert_eq!(ThemeId::parse("one-dark"), Some(ThemeId::OneDark));
        assert_eq!(ThemeId::parse("tokyo-night"), Some(ThemeId::TokyoNight));
        assert_eq!(
            ThemeId::parse("gruvbox-material-dark"),
            Some(ThemeId::GruvboxMaterialDark)
        );
        assert_eq!(ThemeId::parse("dracula"), Some(ThemeId::Dracula));
        assert_eq!(
            ThemeId::parse("catppuccin-mocha"),
            Some(ThemeId::CatppuccinMocha)
        );
        assert_eq!(
            ThemeId::parse("catppuccin-latte"),
            Some(ThemeId::CatppuccinLatte)
        );
        assert_eq!(ThemeId::parse("nord"), None);
    }

    #[test]
    fn persisted_theme_is_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        fs::write(
            &persistence_path,
            r#"{"settings":{"themeId":"tokyo-night"},"workspaces":[]}"#,
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(runtime.settings.theme_id, ThemeId::TokyoNight);
    }

    #[test]
    fn persisted_text_settings_are_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        fs::write(
            &persistence_path,
            r#"{"settings":{"interfaceTextScale":1.08,"terminalFontSize":15.25},"workspaces":[]}"#,
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(runtime.settings.interface_text_scale, 1.08);
        assert_eq!(runtime.settings.terminal_font_size, 15.25);
    }

    #[test]
    fn persisted_openai_api_key_is_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        fs::write(
            &persistence_path,
            r#"{"settings":{"openAiApiKey":"sk-test-123"},"workspaces":[]}"#,
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(
            runtime.settings.openai_api_key.as_deref(),
            Some("sk-test-123")
        );
        assert!(runtime.build_snapshot().settings.has_stored_openai_api_key);
    }

    #[test]
    fn persisted_codex_cli_path_is_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        fs::write(
            &persistence_path,
            r#"{"settings":{"codexCliPath":"/usr/local/bin/codex"},"workspaces":[]}"#,
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(
            runtime.settings.codex_cli_path.as_deref(),
            Some("/usr/local/bin/codex")
        );
    }

    #[test]
    fn persisted_workspace_name_is_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{workspace_path}","name":"Sprint Board","paneCount":1}}]}}"#
            ),
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(runtime.workspaces.len(), 1);
        assert_eq!(runtime.workspaces[0].name, "Sprint Board");
    }

    #[test]
    fn codex_restore_bindings_round_trip_through_persistence() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let mut runtime = RuntimeState::seeded();
        let workspace = runtime
            .build_workspace_record(fixture.project_dir(), 2, None)
            .expect("workspace should build");
        let workspace_id = workspace.id.clone();
        runtime.active_workspace_id = Some(workspace_id);
        runtime.workspaces.push(workspace);
        let workspace_path = runtime.workspaces[0].path.clone();

        upsert_workspace_codex_restore_binding(
            &mut runtime.workspaces[0],
            0,
            "session-alpha".to_string(),
            workspace_path.clone(),
            100,
        );
        upsert_workspace_codex_restore_binding(
            &mut runtime.workspaces[0],
            1,
            "session-beta".to_string(),
            workspace_path.clone(),
            200,
        );
        runtime.workspaces[0].codex_session_id = Some("session-beta".to_string());

        fs::write(
            &persistence_path,
            serde_json::to_vec_pretty(&runtime.persisted_state()).expect("state should serialize"),
        )
        .expect("persisted state should write");

        let mut restored = RuntimeState::seeded();
        restored
            .load_persisted_from_disk(persistence_path)
            .expect("state should reload");

        assert_eq!(restored.workspaces.len(), 1);
        assert_eq!(
            restored.workspaces[0].codex_session_id.as_deref(),
            Some("session-beta")
        );
        assert_eq!(
            restored.workspaces[0]
                .codex_restore_bindings
                .iter()
                .map(|binding| (binding.slot_index, binding.session_id.as_str()))
                .collect::<Vec<_>>(),
            vec![(0, "session-alpha"), (1, "session-beta")]
        );
    }

    #[test]
    fn legacy_single_pane_codex_session_migrates_to_slot_zero_restore_binding() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{workspace_path}","paneCount":1,"codexSessionId":"session-123"}}]}}"#
            ),
        )
        .expect("legacy state should write");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("legacy state should load");

        assert_eq!(runtime.workspaces.len(), 1);
        assert_eq!(
            runtime.workspaces[0].codex_session_id.as_deref(),
            Some("session-123")
        );
        assert_eq!(
            runtime.workspaces[0]
                .codex_restore_bindings
                .iter()
                .map(|binding| (binding.slot_index, binding.session_id.as_str()))
                .collect::<Vec<_>>(),
            vec![(0, "session-123")]
        );
    }

    #[test]
    fn legacy_multi_pane_codex_session_does_not_auto_bind_ambiguously() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{workspace_path}","paneCount":2,"codexSessionId":"session-123"}}]}}"#
            ),
        )
        .expect("legacy state should write");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("legacy state should load");

        assert_eq!(runtime.workspaces.len(), 1);
        assert_eq!(
            runtime.workspaces[0].codex_session_id.as_deref(),
            Some("session-123")
        );
        assert!(runtime.workspaces[0].codex_restore_bindings.is_empty());
    }

    #[test]
    fn codex_restore_bindings_follow_pane_slot_reindexing() {
        let mut runtime = RuntimeState::seeded();
        let workspace = runtime
            .build_workspace_record(
                &normalize_workspace_path(".").expect("cwd should resolve"),
                2,
                None,
            )
            .expect("workspace should build");
        let workspace_id = workspace.id.clone();
        let first_pane_id = workspace.panes[0].id.clone();
        let second_pane_id = workspace.panes[1].id.clone();
        runtime.workspaces.push(workspace);
        let workspace_path = runtime.workspaces[0].path.clone();

        upsert_workspace_codex_restore_binding(
            &mut runtime.workspaces[0],
            0,
            "session-first".to_string(),
            workspace_path.clone(),
            100,
        );
        upsert_workspace_codex_restore_binding(
            &mut runtime.workspaces[0],
            1,
            "session-second".to_string(),
            workspace_path.clone(),
            200,
        );
        runtime.pending_codex_starts.push(PendingCodexStartRecord {
            workspace_id: workspace_id.clone(),
            pane_id: second_pane_id.clone(),
            pane_slot_index: 1,
            cwd: workspace_path,
            started_at_ms: 300,
            known_session_ids: HashSet::new(),
        });

        super::workspace_manager::split_pane_in_runtime(&mut runtime, &first_pane_id, "left")
            .expect("split should succeed");
        assert_eq!(
            runtime.workspaces[0]
                .codex_restore_bindings
                .iter()
                .map(|binding| binding.slot_index)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(runtime.pending_codex_starts[0].pane_slot_index, 2);

        let inserted_pane_id = runtime.workspaces[0].panes[0].id.clone();
        super::workspace_manager::close_pane_in_runtime(&mut runtime, &inserted_pane_id)
            .expect("closing inserted pane should succeed");
        assert_eq!(
            runtime.workspaces[0]
                .codex_restore_bindings
                .iter()
                .map(|binding| (binding.slot_index, binding.session_id.as_str()))
                .collect::<Vec<_>>(),
            vec![(0, "session-first"), (1, "session-second")]
        );
        assert_eq!(runtime.pending_codex_starts[0].pane_slot_index, 1);

        super::workspace_manager::close_pane_in_runtime(&mut runtime, &first_pane_id)
            .expect("closing bound pane should succeed");
        assert_eq!(
            runtime.workspaces[0]
                .codex_restore_bindings
                .iter()
                .map(|binding| (binding.slot_index, binding.session_id.as_str()))
                .collect::<Vec<_>>(),
            vec![(0, "session-second")]
        );
    }

    #[test]
    fn persisted_state_keeps_workspace_todos_scoped_per_workspace() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");

        let first = runtime.build_workspace_record(&cwd, 1, None).unwrap();
        let second = runtime.build_workspace_record(&cwd, 2, None).unwrap();

        runtime.active_workspace_id = Some(first.id.clone());
        runtime.workspaces.push(first.clone());
        runtime.workspaces.push(second.clone());

        runtime.workspaces[0].todos = vec![
            WorkspaceTodoRecord {
                id: "todo-1".to_string(),
                text: "Check logs".to_string(),
                done: false,
            },
            WorkspaceTodoRecord {
                id: "todo-2".to_string(),
                text: "Archive notes".to_string(),
                done: true,
            },
        ];

        let persisted = runtime.persisted_state();
        assert_eq!(persisted.workspaces[0].todos.len(), 2);
        assert!(persisted.workspaces[1].todos.is_empty());

        let snapshot = runtime.build_snapshot();
        assert_eq!(
            snapshot
                .active_workspace
                .expect("active workspace should exist")
                .todos
                .iter()
                .map(|todo| todo.text.as_str())
                .collect::<Vec<_>>(),
            vec!["Check logs", "Archive notes"]
        );
    }

    #[test]
    fn persisted_state_keeps_workspace_file_draft_scoped_per_workspace() {
        let mut runtime = RuntimeState::seeded();
        let cwd = normalize_workspace_path(".").expect("cwd should resolve");

        let first = runtime.build_workspace_record(&cwd, 1, None).unwrap();
        let second = runtime.build_workspace_record(&cwd, 2, None).unwrap();

        runtime.active_workspace_id = Some(first.id.clone());
        runtime.workspaces.push(first);
        runtime.workspaces.push(second);

        runtime.workspaces[0].file_draft = Some(WorkspaceFileDraftRecord {
            relative_path: "src-web/app.js".to_string(),
            draft: "console.log('draft');\n".to_string(),
            base_version_token: "21:deadbeef".to_string(),
        });

        let persisted = runtime.persisted_state();
        assert!(persisted.workspaces[0].file_draft.is_some());
        assert!(persisted.workspaces[1].file_draft.is_none());

        let snapshot = runtime.build_snapshot();
        let active_workspace = snapshot
            .active_workspace
            .expect("active workspace should exist");
        let file_draft = active_workspace
            .file_draft
            .expect("file draft should be present");
        assert_eq!(file_draft.relative_path, "src-web/app.js");
        assert_eq!(file_draft.base_version_token, "21:deadbeef");
    }

    #[test]
    fn persisted_workspace_todos_are_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{workspace_path}","paneCount":1,"todos":[{{"id":"todo-1","text":"Ship release","done":true}},{{"id":"todo-1","text":"Review launch notes","done":false}},{{"text":"  "}},{{"text":"Prep demo","done":false}}]}}]}}"#
            ),
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(runtime.workspaces.len(), 1);
        assert_eq!(
            runtime.workspaces[0]
                .todos
                .iter()
                .map(|todo| (todo.text.as_str(), todo.done))
                .collect::<Vec<_>>(),
            vec![
                ("Review launch notes", false),
                ("Prep demo", false),
                ("Ship release", true),
            ]
        );
        assert_ne!(
            runtime.workspaces[0].todos[1].id,
            runtime.workspaces[0].todos[2].id
        );
    }

    #[test]
    fn persisted_workspace_file_draft_is_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{workspace_path}","paneCount":1,"fileDraft":{{"relativePath":"src-web/app.js","draft":"let draft = true;\n","baseVersionToken":"18:cafebabe"}}}}]}}"#
            ),
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        let file_draft = runtime.workspaces[0]
            .file_draft
            .clone()
            .expect("file draft should restore");
        assert_eq!(file_draft.relative_path, "src-web/app.js");
        assert_eq!(file_draft.draft, "let draft = true;\n");
        assert_eq!(file_draft.base_version_token, "18:cafebabe");
    }

    #[test]
    fn persisted_activity_history_is_restored_from_disk() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{}","paneCount":1}}],"recentActivity":[{{"kind":"paneReady","workspacePath":"{}","label":"Shell 01","at":1710000000000}}]}}"#,
                workspace_path,
                workspace_path
            ),
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(
            runtime.workspaces[0].path,
            canonical_path(fixture.project_dir()).display().to_string()
        );
        assert_eq!(runtime.activity_history.len(), 1);
        let snapshot = runtime.build_snapshot();
        assert_eq!(snapshot.activity.recent_events.len(), 1);
        assert_eq!(
            snapshot.activity.recent_events[0].kind,
            ActivityEventKind::PaneReady
        );
        assert_eq!(
            snapshot.activity.recent_events[0].workspace_id,
            runtime.workspaces[0].id
        );
        assert_eq!(snapshot.activity.recent_events[0].label, "Shell 01");
        assert_eq!(snapshot.activity.recent_events[0].at, 1_710_000_000_000);
    }

    #[test]
    fn persisted_activity_history_restores_git_task_kinds_and_pane_ids() {
        let fixture = TestWorkspace::new();
        let persistence_path = fixture.root_dir().join("workspaces.json");
        let workspace_path = fixture.project_dir().display().to_string();
        fs::write(
            &persistence_path,
            format!(
                r#"{{"workspaces":[{{"path":"{}","paneCount":1}}],"recentActivity":[{{"kind":"gitTaskFailed","workspacePath":"{}","label":"Push main","error":"fatal: the current branch main has no upstream branch","at":1710000000200}},{{"kind":"paneFailed","workspacePath":"{}","paneId":"pane-7","label":"Shell 02","error":"spawn failed","at":1710000000100}}]}}"#,
                workspace_path,
                workspace_path,
                workspace_path
            ),
        )
        .expect("should write persisted state");

        let mut runtime = RuntimeState::seeded();
        runtime
            .load_persisted_from_disk(persistence_path)
            .expect("should load persisted state");

        assert_eq!(runtime.activity_history.len(), 2);
        let snapshot = runtime.build_snapshot();
        assert_eq!(snapshot.activity.recent_events.len(), 2);

        assert_eq!(
            snapshot.activity.recent_events[0].kind,
            ActivityEventKind::GitTaskFailed
        );
        assert_eq!(
            snapshot.activity.recent_events[0].workspace_id,
            runtime.workspaces[0].id
        );
        assert_eq!(snapshot.activity.recent_events[0].pane_id, "");
        assert_eq!(snapshot.activity.recent_events[0].label, "Push main");
        assert_eq!(
            snapshot.activity.recent_events[0].error,
            "fatal: the current branch main has no upstream branch"
        );
        assert_eq!(snapshot.activity.recent_events[0].at, 1_710_000_000_200);

        assert_eq!(
            snapshot.activity.recent_events[1].kind,
            ActivityEventKind::PaneFailed
        );
        assert_eq!(snapshot.activity.recent_events[1].pane_id, "pane-7");
        assert_eq!(snapshot.activity.recent_events[1].label, "Shell 02");
        assert_eq!(snapshot.activity.recent_events[1].error, "spawn failed");
        assert_eq!(snapshot.activity.recent_events[1].at, 1_710_000_000_100);
    }

    #[test]
    fn workspace_file_explorer_lists_root_entries_with_filters_and_sorting() {
        let fixture = TestWorkspace::new();
        fs::create_dir_all(fixture.project_dir().join("Frontend")).unwrap();
        fs::create_dir_all(fixture.project_dir().join("node_modules")).unwrap();
        fs::create_dir_all(fixture.project_dir().join(".git")).unwrap();
        fs::write(fixture.project_dir().join("README.md"), "hello\n").unwrap();
        fs::write(fixture.project_dir().join("zeta.txt"), "zeta\n").unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let snapshot = load_workspace_file_explorer_directory_snapshot(&runtime, &workspace_id, "")
            .expect("root listing should load");

        assert_eq!(snapshot.relative_path, "");
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|entry| (entry.name.as_str(), entry.kind))
                .collect::<Vec<_>>(),
            vec![
                ("backend", WorkspaceFileExplorerEntryKind::Directory),
                ("Frontend", WorkspaceFileExplorerEntryKind::Directory),
                ("README.md", WorkspaceFileExplorerEntryKind::File),
                ("zeta.txt", WorkspaceFileExplorerEntryKind::File),
            ]
        );
    }

    #[test]
    fn workspace_file_explorer_loads_nested_relative_directory() {
        let fixture = TestWorkspace::new();
        fs::write(fixture.api_dir().join("routes.py"), "print('ok')\n").unwrap();
        fs::create_dir_all(fixture.api_dir().join("handlers")).unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let snapshot =
            load_workspace_file_explorer_directory_snapshot(&runtime, &workspace_id, "backend/api")
                .expect("nested listing should load");

        assert_eq!(snapshot.relative_path, "backend/api");
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|entry| (
                    entry.name.as_str(),
                    entry.relative_path.as_str(),
                    entry.kind
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    "handlers",
                    "backend/api/handlers",
                    WorkspaceFileExplorerEntryKind::Directory,
                ),
                (
                    "routes.py",
                    "backend/api/routes.py",
                    WorkspaceFileExplorerEntryKind::File,
                ),
            ]
        );
    }

    #[test]
    fn workspace_file_explorer_rejects_path_traversal() {
        let fixture = TestWorkspace::new();
        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());

        let error = load_workspace_file_explorer_directory_snapshot(&runtime, &workspace_id, "../")
            .expect_err("path traversal should be rejected");

        assert!(error.contains("path traversal"));
    }

    #[cfg(unix)]
    #[test]
    fn workspace_file_explorer_marks_symlink_directories_as_non_expandable() {
        let fixture = TestWorkspace::new();
        let target = fixture.root_dir().join("shared");
        fs::create_dir_all(&target).unwrap();
        let link = fixture.project_dir().join("linked-shared");
        symlink(&target, &link).unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let snapshot = load_workspace_file_explorer_directory_snapshot(&runtime, &workspace_id, "")
            .expect("root listing should load");
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.name == "linked-shared")
            .expect("symlink entry should be present");

        assert_eq!(entry.kind, WorkspaceFileExplorerEntryKind::Symlink);
        assert!(!entry.expandable);
        assert!(load_workspace_file_explorer_directory_snapshot(
            &runtime,
            &workspace_id,
            "linked-shared"
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn workspace_file_explorer_returns_error_for_unreadable_directory() {
        let fixture = TestWorkspace::new();
        let private_dir = fixture.project_dir().join("private");
        fs::create_dir_all(&private_dir).unwrap();
        let original_permissions = fs::metadata(&private_dir).unwrap().permissions();
        let mut unreadable_permissions = original_permissions.clone();
        unreadable_permissions.set_mode(0o000);
        fs::set_permissions(&private_dir, unreadable_permissions).unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let error =
            load_workspace_file_explorer_directory_snapshot(&runtime, &workspace_id, "private")
                .expect_err("unreadable directories should surface an error");

        fs::set_permissions(&private_dir, original_permissions).unwrap();

        assert!(
            error.contains("failed to read directory")
                || error.contains("failed to access directory"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn workspace_text_file_loads_utf8_text_and_preserves_newline_metadata() {
        let fixture = TestWorkspace::new();
        fs::write(
            fixture.project_dir().join("notes.txt"),
            "first line\r\nsecond line\r\n",
        )
        .unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let snapshot = load_workspace_text_file_snapshot(&runtime, &workspace_id, "notes.txt")
            .expect("text file should load");

        assert_eq!(snapshot.relative_path, "notes.txt");
        assert_eq!(snapshot.content, "first line\r\nsecond line\r\n");
        assert_eq!(snapshot.newline_style, WorkspaceTextFileNewlineStyle::CrLf);
        assert!(snapshot.has_trailing_newline);
        assert!(!snapshot.read_only);
        assert!(snapshot.reason.is_none());
        assert!(!snapshot.version_token.is_empty());
    }

    #[test]
    fn workspace_text_file_rejects_path_traversal() {
        let fixture = TestWorkspace::new();
        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());

        let error = load_workspace_text_file_snapshot(&runtime, &workspace_id, "../secret.txt")
            .expect_err("path traversal should be rejected");

        assert!(error.contains("path traversal"));
    }

    #[test]
    fn workspace_text_file_blocks_binary_files() {
        let fixture = TestWorkspace::new();
        fs::write(
            fixture.project_dir().join("image.bin"),
            [0_u8, 159, 146, 150],
        )
        .unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let snapshot = load_workspace_text_file_snapshot(&runtime, &workspace_id, "image.bin")
            .expect("binary snapshot should load as read-only");

        assert!(snapshot.read_only);
        assert_eq!(snapshot.content, "");
        assert_eq!(
            snapshot.reason.as_deref(),
            Some("Binary files are not editable in CrewDock yet.")
        );
    }

    #[cfg(unix)]
    #[test]
    fn workspace_text_file_blocks_symlink_targets() {
        let fixture = TestWorkspace::new();
        let shared_file = fixture.root_dir().join("shared.txt");
        fs::write(&shared_file, "shared\n").unwrap();
        let link = fixture.project_dir().join("shared-link.txt");
        symlink(&shared_file, &link).unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let snapshot =
            load_workspace_text_file_snapshot(&runtime, &workspace_id, "shared-link.txt")
                .expect("symlink snapshot should load");

        assert!(snapshot.read_only);
        assert_eq!(
            snapshot.reason.as_deref(),
            Some("Symlinked files are not editable in CrewDock yet.")
        );
        assert_eq!(snapshot.content, "");
    }

    #[test]
    fn workspace_text_file_save_preserves_content_and_refreshes_version_token() {
        let fixture = TestWorkspace::new();
        fs::write(fixture.project_dir().join("draft.md"), "hello\n").unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let original = load_workspace_text_file_snapshot(&runtime, &workspace_id, "draft.md")
            .expect("draft should load");
        thread::sleep(Duration::from_millis(5));

        let saved = save_workspace_text_file_snapshot(
            &runtime,
            &workspace_id,
            "draft.md",
            "updated\ncontent\n",
            &original.version_token,
        )
        .expect("save should succeed");

        assert_eq!(saved.content, "updated\ncontent\n");
        assert_ne!(saved.version_token, original.version_token);
        assert_eq!(
            fs::read_to_string(fixture.project_dir().join("draft.md")).unwrap(),
            "updated\ncontent\n"
        );
    }

    #[test]
    fn workspace_text_file_save_rejects_stale_version_tokens() {
        let fixture = TestWorkspace::new();
        let file_path = fixture.project_dir().join("draft.md");
        fs::write(&file_path, "hello\n").unwrap();

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let original = load_workspace_text_file_snapshot(&runtime, &workspace_id, "draft.md")
            .expect("draft should load");
        thread::sleep(Duration::from_millis(5));
        fs::write(&file_path, "changed elsewhere\n").unwrap();

        let error = save_workspace_text_file_snapshot(
            &runtime,
            &workspace_id,
            "draft.md",
            "my local draft\n",
            &original.version_token,
        )
        .expect_err("stale save should fail");

        assert!(error.contains("save conflict"));
        assert_eq!(
            fs::read_to_string(&file_path).unwrap(),
            "changed elsewhere\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn workspace_text_file_save_detects_same_size_changes_even_when_mtime_is_restored() {
        let fixture = TestWorkspace::new();
        let file_path = fixture.project_dir().join("draft.md");
        let reference_path = fixture.project_dir().join("reference.md");
        fs::write(&file_path, "alpha\n").unwrap();
        fs::write(&reference_path, "alpha\n").unwrap();
        assert!(Command::new("touch")
            .arg("-r")
            .arg(&file_path)
            .arg(&reference_path)
            .status()
            .unwrap()
            .success());

        let (runtime, workspace_id) = runtime_with_workspace(fixture.project_dir());
        let original = load_workspace_text_file_snapshot(&runtime, &workspace_id, "draft.md")
            .expect("draft should load");

        fs::write(&file_path, "omega\n").unwrap();
        assert!(Command::new("touch")
            .arg("-r")
            .arg(&reference_path)
            .arg(&file_path)
            .status()
            .unwrap()
            .success());

        let error = save_workspace_text_file_snapshot(
            &runtime,
            &workspace_id,
            "draft.md",
            "local\n",
            &original.version_token,
        )
        .expect_err("same-size disk changes should still fail save");

        assert!(error.contains("save conflict"));
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "omega\n");
    }

    #[test]
    fn navigation_input_supports_cd_and_plain_paths() {
        assert_eq!(extract_navigation_target("cd ..").unwrap(), "..");
        assert_eq!(extract_navigation_target("src/api").unwrap(), "src/api");
        assert_eq!(extract_navigation_target("cd").unwrap(), "~");
        assert!(extract_navigation_target("cd foo && pwd").is_err());
    }

    #[test]
    fn resolve_navigation_path_handles_relative_and_home_targets() {
        let fixture = TestWorkspace::new();
        let original_home = env::var_os("HOME");

        // Point HOME at a temp tree so ~ resolution is deterministic.
        unsafe {
            env::set_var("HOME", fixture.home_root());
        }

        let parent = resolve_navigation_path(fixture.project_dir(), "cd ..").unwrap();
        assert_eq!(parent, canonical_path(fixture.root_dir()));

        let nested = resolve_navigation_path(fixture.project_dir(), "backend/api").unwrap();
        assert_eq!(nested, canonical_path(fixture.api_dir()));

        let home = resolve_navigation_path(fixture.project_dir(), "~").unwrap();
        assert_eq!(home, canonical_path(fixture.home_root()));

        match original_home {
            Some(value) => unsafe { env::set_var("HOME", value) },
            None => unsafe { env::remove_var("HOME") },
        }
    }

    #[test]
    fn default_launcher_path_prefers_existing_directory() {
        let fixture = TestWorkspace::new();
        let original_dir = env::current_dir().ok();

        env::set_current_dir(fixture.project_dir()).unwrap();
        let resolved = default_launcher_path();
        assert_eq!(
            resolved,
            canonical_path(fixture.project_dir()).display().to_string()
        );

        if let Some(path) = original_dir {
            env::set_current_dir(path).unwrap();
        }
    }

    #[test]
    fn launcher_commands_support_shell_like_flow() {
        let fixture = TestWorkspace::new();
        let project = canonical_path(fixture.project_dir());
        let backend = canonical_path(fixture.project_dir().join("backend").as_path());
        let api = canonical_path(fixture.api_dir());

        let help = execute_launcher_command(&project, "help").unwrap();
        assert!(help.output[0].contains("Commands:"));
        assert_eq!(help.base_path, project.display().to_string());

        let list = execute_launcher_command(&project, "ls backend").unwrap();
        assert_eq!(list.base_path, project.display().to_string());
        assert_eq!(list.output[0], backend.display().to_string());

        let open = execute_launcher_command(&project, "open backend/api").unwrap();
        assert_eq!(open.open_path, Some(api.display().to_string()));

        let clear = execute_launcher_command(&project, "clear").unwrap();
        assert!(clear.clear_output);
        assert!(execute_launcher_command(&project, "pwd && ls").is_err());
    }

    #[test]
    fn launcher_completion_supports_commands_and_paths() {
        let fixture = TestWorkspace::new();
        let project = canonical_path(fixture.project_dir());

        let commands = complete_launcher_input_for_base(&project, "c").unwrap();
        assert_eq!(commands.completed_input, "c");
        assert_eq!(
            commands.matches,
            vec!["cd".to_string(), "clear".to_string()]
        );

        let command = complete_launcher_input_for_base(&project, "cd").unwrap();
        assert_eq!(command.completed_input, "cd ");

        let path = complete_launcher_input_for_base(&project, "cd back").unwrap();
        assert_eq!(path.completed_input, "cd backend/");
        assert_eq!(path.matches, vec!["backend/".to_string()]);
    }

    #[test]
    fn parse_git_status_handles_clean_branch_headers() {
        let parsed = parse_git_status_porcelain(
            "\
# branch.oid 1c39cf9988972dbe28a656018d3fb0c270742433\n\
# branch.head main\n\
# branch.upstream origin/main\n\
# branch.ab +2 -1\n",
        )
        .expect("git status should parse");

        assert_eq!(parsed.head.as_deref(), Some("main"));
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert!(parsed.files.is_empty());
    }

    #[test]
    fn codex_cli_version_parser_handles_noisy_output() {
        let version =
            parse_codex_cli_version("WARNING: could not update PATH\ncodex-cli 0.116.0\n");

        assert_eq!(version.as_deref(), Some("0.116.0"));
    }

    #[test]
    fn codex_cli_version_sort_prefers_newer_release() {
        assert!(compare_codex_cli_versions("0.116.0", "0.42.0").is_gt());
        assert!(compare_codex_cli_versions("0.116.0", "0.116.0").is_eq());
        assert!(compare_codex_cli_versions("0.98.0", "0.116.0").is_lt());
    }

    #[test]
    fn login_shell_path_extraction_ignores_shell_noise() {
        let output = b"shell startup noise\n__CREWDOCK_PATH_START__/usr/local/bin:/opt/homebrew/bin__CREWDOCK_PATH_END__";

        assert_eq!(
            extract_login_shell_path(output),
            Some(OsString::from("/usr/local/bin:/opt/homebrew/bin"))
        );
    }

    #[test]
    fn merge_path_values_prefers_login_shell_entries_without_duplicates() {
        let merged = merge_path_values(
            Some(OsStr::new("/usr/local/bin:/opt/homebrew/bin")),
            Some(OsStr::new("/usr/bin:/usr/local/bin")),
        )
        .expect("merged PATH should be available");

        let merged_entries = env::split_paths(&merged)
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            merged_entries,
            vec!["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]
        );
    }

    #[test]
    fn codex_cli_snapshot_falls_back_when_custom_path_is_invalid() {
        let snapshot = build_codex_cli_snapshot(
            Some("/custom/bin/codex".to_string()),
            vec![
                CodexCliCandidateSnapshot {
                    path: "/usr/local/bin/codex".to_string(),
                    version: "0.116.0".to_string(),
                    source: CodexCliSource::NpmGlobal,
                    is_selected: false,
                },
                CodexCliCandidateSnapshot {
                    path: "/opt/homebrew/bin/codex".to_string(),
                    version: "0.42.0".to_string(),
                    source: CodexCliSource::Homebrew,
                    is_selected: false,
                },
            ],
            None,
            Some("Configured Codex CLI path is not usable.".to_string()),
        );

        assert_eq!(snapshot.status, CodexCliStatus::InvalidSelection);
        assert_eq!(snapshot.selection_mode, CodexCliSelectionMode::Custom);
        assert_eq!(
            snapshot.effective_path.as_deref(),
            Some("/usr/local/bin/codex")
        );
        assert_eq!(snapshot.effective_version.as_deref(), Some("0.116.0"));
        assert!(snapshot
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("fell back"));
    }

    #[test]
    fn parse_git_status_tracks_changed_files() {
        let parsed = parse_git_status_porcelain(
            "\
# branch.oid 1c39cf9988972dbe28a656018d3fb0c270742433\n\
# branch.head feature/git\n\
1 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 1111111111111111111111111111111111111111 src/app.js\n\
2 R. N... 100644 100644 100644 2222222222222222222222222222222222222222 2222222222222222222222222222222222222222 R100 src/new-name.rs\tsrc/old-name.rs\n\
u UU N... 100644 100644 100644 100644 3333333333333333333333333333333333333333 3333333333333333333333333333333333333333 3333333333333333333333333333333333333333 src/conflicted.rs\n\
? src/new-file.ts\n",
        )
        .expect("git status should parse");

        assert_eq!(parsed.files.len(), 4);
        assert_eq!(parsed.files[0].kind, GitFileKind::Staged);
        assert_eq!(parsed.files[1].kind, GitFileKind::Renamed);
        assert_eq!(
            parsed.files[1].original_path.as_deref(),
            Some("src/old-name.rs")
        );
        assert_eq!(parsed.files[2].kind, GitFileKind::Conflicted);
        assert_eq!(parsed.files[3].kind, GitFileKind::Untracked);
    }

    #[test]
    fn parse_git_status_handles_null_delimited_records() {
        let parsed = parse_git_status_porcelain(
            "\
# branch.oid 1c39cf9988972dbe28a656018d3fb0c270742433\0\
# branch.head feature/git\0\
# branch.upstream origin/feature/git\0\
2 R. N... 100644 100644 100644 2222222222222222222222222222222222222222 2222222222222222222222222222222222222222 R100 src/new name.rs\0\
src/old name.rs\0\
1 AM N... 000000 100644 100644 0000000000000000000000000000000000000000 3333333333333333333333333333333333333333 tracked file.txt\0\
? src/extra file.ts\0",
        )
        .expect("git status should parse");

        assert_eq!(parsed.head.as_deref(), Some("feature/git"));
        assert_eq!(parsed.upstream.as_deref(), Some("origin/feature/git"));
        assert_eq!(parsed.files.len(), 3);
        assert_eq!(parsed.files[0].kind, GitFileKind::Renamed);
        assert_eq!(parsed.files[0].path, "src/new name.rs");
        assert_eq!(
            parsed.files[0].original_path.as_deref(),
            Some("src/old name.rs")
        );
        assert_eq!(parsed.files[1].path, "tracked file.txt");
        assert_eq!(parsed.files[2].path, "src/extra file.ts");
    }

    #[test]
    fn validate_git_cli_arg_rejects_option_like_values() {
        assert!(validate_git_cli_arg("-danger".to_string(), "branch name").is_err());
        assert!(validate_git_cli_arg("line\nbreak".to_string(), "branch name").is_err());
        assert_eq!(
            validate_git_cli_arg(" feature/demo ".to_string(), "branch name").unwrap(),
            "feature/demo"
        );
    }

    #[test]
    fn collect_git_detail_reports_non_repo_workspaces() {
        let fixture = TestWorkspace::new();
        let detail = collect_git_detail(fixture.project_dir());

        assert_eq!(detail.summary.state, GitState::NotRepo);
        assert!(detail.repo_root.is_none());
        assert!(detail.files.is_empty());
    }

    #[test]
    fn collect_git_detail_reports_missing_git_binary() {
        let fixture = TestWorkspace::new();
        let detail = collect_git_detail_with_binary(
            "git-command-that-does-not-exist",
            fixture.project_dir(),
        );

        assert_eq!(detail.summary.state, GitState::Error);
        assert!(detail.summary.message.is_some());
    }

    #[test]
    fn collect_git_detail_detects_detached_head_and_nested_workspace() {
        let repo = TestGitRepo::new();
        let detail = collect_git_detail(repo.nested_workspace_dir());
        let repo_root = canonical_path(repo.repo_dir()).display().to_string();

        assert_eq!(detail.summary.state, GitState::Detached);
        assert_eq!(detail.summary.branch.as_ref().map(String::len), Some(7));
        assert_eq!(
            detail.workspace_relative_path.as_deref(),
            Some("apps/client")
        );
        assert_eq!(detail.repo_root.as_deref(), Some(repo_root.as_str()));
    }

    struct TestWorkspace {
        root: PathBuf,
        project: PathBuf,
        api: PathBuf,
        home: PathBuf,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be monotonic")
                .as_nanos();
            let root = env::temp_dir().join(format!("crewdock-nav-{unique}"));
            let project = root.join("project");
            let api = project.join("backend").join("api");
            let home = root.join("home");

            fs::create_dir_all(&api).unwrap();
            fs::create_dir_all(&home).unwrap();

            Self {
                root,
                project,
                api,
                home,
            }
        }

        fn root_dir(&self) -> &Path {
            &self.root
        }

        fn project_dir(&self) -> &Path {
            &self.project
        }

        fn api_dir(&self) -> &Path {
            &self.api
        }

        fn home_root(&self) -> &Path {
            &self.home
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    struct TestGitRepo {
        root: PathBuf,
        repo: PathBuf,
        nested_workspace: PathBuf,
    }

    impl TestGitRepo {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be monotonic")
                .as_nanos();
            let root = env::temp_dir().join(format!("crewdock-git-{unique}"));
            let repo = root.join("repo");
            let nested_workspace = repo.join("apps").join("client");

            fs::create_dir_all(&nested_workspace).unwrap();
            run_git(&repo, &["init", "--initial-branch=main"]);
            run_git(&repo, &["config", "user.name", "CrewDock Test"]);
            run_git(&repo, &["config", "user.email", "test@crewdock.dev"]);
            fs::write(repo.join("README.md"), "hello\n").unwrap();
            run_git(&repo, &["add", "README.md"]);
            run_git(&repo, &["commit", "-m", "initial"]);
            run_git(&repo, &["checkout", "--detach"]);

            Self {
                root,
                repo,
                nested_workspace,
            }
        }

        fn repo_dir(&self) -> &Path {
            &self.repo
        }

        fn nested_workspace_dir(&self) -> &Path {
            &self.nested_workspace
        }
    }

    impl Drop for TestGitRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn canonical_path(path: &Path) -> PathBuf {
        fs::canonicalize(path).expect("fixture path should be canonicalizable")
    }

    fn runtime_with_workspace(path: &Path) -> (RuntimeState, String) {
        let mut runtime = RuntimeState::seeded();
        let normalized_path = normalize_workspace_path(path.to_str().unwrap()).unwrap();
        let workspace = runtime
            .build_workspace_record(&normalized_path, 1, None)
            .expect("workspace should build");
        let workspace_id = workspace.id.clone();
        runtime.active_workspace_id = Some(workspace_id.clone());
        runtime.workspaces.push(workspace);
        (runtime, workspace_id)
    }

    fn run_git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git command should start");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
