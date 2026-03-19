mod events;
mod persistence;
mod session_manager;
mod source_control;
mod workspace_manager;

use std::{
    collections::HashMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
    sync::{Arc, Mutex},
};

use portable_pty::{ChildKiller, PtySize};
use serde::{Deserialize, Serialize};
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

use events::emit_snapshot;
use persistence::resolve_persistence_path;
use session_manager::{prepare_workspace_launch, spawn_pane_jobs, LiveSession, PaneJob};
use source_control::{
    discard_paths, git_task_write_stdin as write_git_task_input,
    load_workspace_git_commit_detail as build_workspace_git_commit_detail,
    load_workspace_git_diff as build_workspace_git_diff,
    load_workspace_source_control as build_workspace_source_control, stage_paths, start_git_task,
    unstage_paths, GitCommitDetailSnapshot, GitDiffMode, GitDiffSnapshot, GitTaskRecord,
    WorkspaceSourceControlSnapshot,
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

struct RuntimeState {
    next_id: u64,
    shell: String,
    launcher: LauncherSnapshot,
    settings: SettingsRecord,
    workspaces: Vec<WorkspaceRecord>,
    active_workspace_id: Option<String>,
    activity_history: Vec<persistence::ActivityEventRecord>,
    sessions: HashMap<String, LiveSession>,
    git_tasks: HashMap<String, GitTaskRecord>,
    persistence_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct WorkspaceRecord {
    id: String,
    name: String,
    path: String,
    layout: LayoutPreset,
    panes: Vec<PaneRecord>,
    pane_layout: PaneLayout,
    started: bool,
    git: Option<GitDetailSnapshot>,
}

#[derive(Debug, Clone)]
struct SettingsRecord {
    theme_id: ThemeId,
    interface_text_scale: f64,
    terminal_font_size: f64,
}

impl Default for SettingsRecord {
    fn default() -> Self {
        Self {
            theme_id: ThemeId::default(),
            interface_text_scale: DEFAULT_INTERFACE_TEXT_SCALE,
            terminal_font_size: DEFAULT_TERMINAL_FONT_SIZE,
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
            workspaces: Vec::new(),
            active_workspace_id: None,
            activity_history: Vec::new(),
            sessions: HashMap::new(),
            git_tasks: HashMap::new(),
            persistence_path: None,
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
            git_detail: workspace.git.clone(),
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

    fn refresh_workspace_git(&mut self, workspace_id: &str) -> Result<(), String> {
        workspace_manager::refresh_workspace_git(self, workspace_id)
    }

    fn active_workspace_path(&self) -> Option<String> {
        workspace_manager::active_workspace_path(self)
    }

    fn active_workspace_index(&self) -> Option<usize> {
        workspace_manager::active_workspace_index(self)
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
struct WorkspaceTabSnapshot {
    id: String,
    name: String,
    path: String,
    layout: LayoutPreset,
    is_live: bool,
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
    git_detail: Option<GitDetailSnapshot>,
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
fn reset_to_launcher(state: State<'_, AppState>, app: AppHandle) -> Result<AppSnapshot, String> {
    let (snapshot, killers) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        let killers = runtime.drain_all_killers();
        runtime.workspaces.clear();
        runtime.active_workspace_id = None;
        runtime.persist_to_disk()?;
        (runtime.build_snapshot(), killers)
    };

    terminate_sessions(killers);
    emit_snapshot(&app, &snapshot)?;
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

    emit_snapshot(&app, &snapshot)?;
    spawn_pane_jobs(shared, app.clone(), shell, pane_jobs);
    Ok(snapshot)
}

#[tauri::command]
fn rename_workspace(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        workspace_manager::rename_workspace_in_runtime(&mut runtime, &workspace_id, &name)?;
        runtime.build_snapshot()
    };

    emit_snapshot(&app, &snapshot)?;
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

    emit_snapshot(&app, &snapshot)?;
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
    emit_snapshot(&app, &snapshot)?;
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

    emit_snapshot(&app, &snapshot)?;
    spawn_pane_jobs(shared, app.clone(), shell, pane_jobs);
    Ok(snapshot)
}

#[tauri::command]
fn close_pane(
    pane_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
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
    emit_snapshot(&app, &snapshot)?;
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
fn set_theme(
    theme_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
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

    emit_snapshot(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
fn set_interface_text_scale(
    interface_text_scale: f64,
    state: State<'_, AppState>,
    app: AppHandle,
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

    emit_snapshot(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
fn set_terminal_font_size(
    terminal_font_size: f64,
    state: State<'_, AppState>,
    app: AppHandle,
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

    emit_snapshot(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
fn refresh_workspace_git_status(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSnapshot, String> {
    let snapshot = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        runtime.refresh_workspace_git(&workspace_id)?;
        runtime.build_snapshot()
    };

    emit_snapshot(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
fn load_workspace_source_control(
    workspace_id: String,
    graph_cursor: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    build_workspace_source_control(&runtime, &workspace_id, graph_cursor)
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

    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    build_workspace_git_diff(&runtime, &workspace_id, &path, mode)
}

#[tauri::command]
fn load_workspace_git_commit_detail(
    workspace_id: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<GitCommitDetailSnapshot, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    build_workspace_git_commit_detail(&runtime, &workspace_id, &oid)
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
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let (snapshot, source_control) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        stage_paths(&mut runtime, &workspace_id, &paths)?;
        let source_control = build_workspace_source_control(&runtime, &workspace_id, None)?;
        (runtime.build_snapshot(), source_control)
    };

    emit_snapshot(&app, &snapshot)?;
    Ok(source_control)
}

#[tauri::command]
fn git_unstage_paths(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let (snapshot, source_control) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        unstage_paths(&mut runtime, &workspace_id, &paths)?;
        let source_control = build_workspace_source_control(&runtime, &workspace_id, None)?;
        (runtime.build_snapshot(), source_control)
    };

    emit_snapshot(&app, &snapshot)?;
    Ok(source_control)
}

#[tauri::command]
fn git_discard_paths(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let (snapshot, source_control) = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        discard_paths(&mut runtime, &workspace_id, &paths)?;
        let source_control = build_workspace_source_control(&runtime, &workspace_id, None)?;
        (runtime.build_snapshot(), source_control)
    };

    emit_snapshot(&app, &snapshot)?;
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
        let snapshot = {
            let mut runtime = state
                .inner
                .lock()
                .map_err(|_| "failed to acquire application state".to_string())?;
            source_control::stage_all_changes(&mut runtime, &workspace_id)?;
            runtime.build_snapshot()
        };
        emit_snapshot(&app, &snapshot)?;
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
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let branch_name = validate_git_cli_arg(branch_name, "branch name")?;
    let remote = resolve_default_git_remote(&state.inner, &workspace_id)?;
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
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    write_git_task_input(&runtime, &workspace_id, &data)
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
    let output = run_git_command("git", Path::new(&workspace.path), &["remote"])
        .map_err(|error| error.message)?;
    let remotes = output
        .lines()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    if remotes.is_empty() {
        return Err("no git remote configured for this repository".to_string());
    }

    Ok(remotes
        .iter()
        .find(|remote| remote.as_str() == "origin")
        .cloned()
        .unwrap_or_else(|| remotes[0].clone()))
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
        &["status", "--porcelain=v2", "--branch", "-z"],
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
    env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "home directory is not available".to_string())
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
            reset_to_launcher,
            create_workspace,
            rename_workspace,
            complete_launcher_input,
            set_theme,
            set_interface_text_scale,
            set_terminal_font_size,
            refresh_workspace_git_status,
            load_workspace_source_control,
            load_workspace_git_diff,
            load_workspace_git_commit_detail,
            git_stage_paths,
            git_unstage_paths,
            git_discard_paths,
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
        env, fs,
        path::{Path, PathBuf},
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        collect_git_detail, collect_git_detail_with_binary, complete_launcher_input_for_base,
        default_launcher_path, execute_launcher_command, extract_navigation_target,
        layout_for_pane_count, layout_presets, normalize_workspace_path,
        parse_git_status_porcelain, persistence::ActivityEventKind, prepare_workspace_launch,
        resolve_navigation_path, validate_git_cli_arg, GitFileKind, GitState, RuntimeState,
        ThemeId, DEFAULT_INTERFACE_TEXT_SCALE, DEFAULT_TERMINAL_FONT_SIZE,
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
