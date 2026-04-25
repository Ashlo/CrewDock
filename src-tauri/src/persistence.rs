use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    CodexPaneRestoreBindingRecord, CodexRestoreBindingKind, PersistedPaneLayout, RuntimeState,
    SettingsRecord, ThemeId, WorkspaceFileDraftRecord, WorkspaceTodoRecord,
};

const PERSISTENCE_FILE: &str = "workspaces.json";
const MAX_PERSISTED_ACTIVITY_EVENTS: usize = 120;

pub(crate) struct PersistenceCoordinator {
    sender: mpsc::Sender<PersistenceMessage>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

struct PersistedWriteRequest {
    path: PathBuf,
    state: PersistedWorkspaceState,
}

enum PersistenceMessage {
    Persist(PersistedWriteRequest),
    Flush(mpsc::Sender<()>),
    Shutdown,
}

impl Default for PersistenceCoordinator {
    fn default() -> Self {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::spawn(move || run_persistence_worker(receiver));
        Self {
            sender,
            worker: Mutex::new(Some(worker)),
        }
    }
}

impl PersistenceCoordinator {
    pub(crate) fn schedule(
        &self,
        path: PathBuf,
        state: PersistedWorkspaceState,
        flush_immediately: bool,
    ) -> Result<(), String> {
        self.sender
            .send(PersistenceMessage::Persist(PersistedWriteRequest {
                path,
                state,
            }))
            .map_err(|_| "failed to queue workspace persistence".to_string())?;

        if flush_immediately {
            self.flush()?;
        }

        Ok(())
    }

    pub(crate) fn flush(&self) -> Result<(), String> {
        let (sender, receiver) = mpsc::channel();
        self.sender
            .send(PersistenceMessage::Flush(sender))
            .map_err(|_| "failed to flush workspace persistence".to_string())?;
        receiver
            .recv()
            .map_err(|_| "failed to await workspace persistence flush".to_string())
    }
}

impl Drop for PersistenceCoordinator {
    fn drop(&mut self) {
        let _ = self.sender.send(PersistenceMessage::Shutdown);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedWorkspaceState {
    #[serde(default)]
    pub(crate) settings: PersistedSettings,
    #[serde(default)]
    pub(crate) workspaces: Vec<PersistedWorkspace>,
    #[serde(default)]
    pub(crate) recent_activity: Vec<ActivityEventRecord>,
    #[serde(default)]
    pub(crate) active_workspace_index: Option<usize>,
    #[serde(default)]
    pub(crate) active_workspace_path: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedSettings {
    #[serde(default)]
    pub(crate) theme_id: Option<String>,
    #[serde(default)]
    pub(crate) interface_text_scale: Option<f64>,
    #[serde(default)]
    pub(crate) terminal_font_size: Option<f64>,
    #[serde(default)]
    #[serde(rename = "openAiApiKey")]
    pub(crate) openai_api_key: Option<String>,
    #[serde(default)]
    pub(crate) codex_cli_path: Option<String>,
    #[serde(default)]
    pub(crate) telemetry_enabled: Option<bool>,
    #[serde(default)]
    pub(crate) telemetry_install_id: Option<String>,
    #[serde(default)]
    pub(crate) telemetry_host: Option<String>,
    #[serde(default)]
    pub(crate) posthog_project_api_key: Option<String>,
    #[serde(default)]
    pub(crate) dismissed_app_update_version: Option<String>,
    #[serde(default)]
    pub(crate) app_update_last_checked_at_ms: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedWorkspace {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) codex_session_id: Option<String>,
    #[serde(default)]
    pub(crate) pane_restore_bindings: Vec<PersistedWorkspacePaneRestoreBinding>,
    #[serde(default)]
    pub(crate) pane_count: Option<u8>,
    #[serde(default)]
    pub(crate) layout_id: Option<String>,
    #[serde(default)]
    pub(crate) pane_layout: Option<PersistedPaneLayout>,
    #[serde(default)]
    pub(crate) todos: Vec<PersistedWorkspaceTodo>,
    #[serde(default)]
    pub(crate) file_draft: Option<PersistedWorkspaceFileDraft>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedWorkspaceTodo {
    #[serde(default)]
    pub(crate) id: Option<String>,
    #[serde(default)]
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) done: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedWorkspaceFileDraft {
    pub(crate) relative_path: String,
    #[serde(default)]
    pub(crate) draft: String,
    #[serde(default)]
    pub(crate) base_version_token: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PersistedWorkspacePaneRestoreKind {
    Codex,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedWorkspacePaneRestoreBinding {
    pub(crate) slot_index: usize,
    pub(crate) kind: PersistedWorkspacePaneRestoreKind,
    pub(crate) session_id: String,
    pub(crate) cwd: String,
    #[serde(default)]
    pub(crate) last_bound_at_ms: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ActivityEventKind {
    PaneReady,
    PaneClosed,
    PaneFailed,
    GitTaskSucceeded,
    GitTaskFailed,
    GitTaskNeedsInput,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityEventRecord {
    pub(crate) kind: ActivityEventKind,
    pub(crate) workspace_path: String,
    #[serde(default)]
    pub(crate) pane_id: String,
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) error: String,
    pub(crate) at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivitySnapshot {
    pub(crate) recent_events: Vec<ActivityEventSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityEventSnapshot {
    pub(crate) kind: ActivityEventKind,
    pub(crate) workspace_id: String,
    pub(crate) pane_id: String,
    pub(crate) label: String,
    pub(crate) error: String,
    pub(crate) at: u64,
}

pub(crate) fn build_persisted_state(runtime: &RuntimeState) -> PersistedWorkspaceState {
    let workspace_paths: HashSet<&str> = runtime
        .workspaces
        .iter()
        .map(|workspace| workspace.path.as_str())
        .collect();

    PersistedWorkspaceState {
        settings: PersistedSettings {
            theme_id: Some(runtime.settings.theme_id.as_str().to_string()),
            interface_text_scale: Some(runtime.settings.interface_text_scale),
            terminal_font_size: Some(runtime.settings.terminal_font_size),
            openai_api_key: runtime.settings.openai_api_key.clone(),
            codex_cli_path: runtime.settings.codex_cli_path.clone(),
            telemetry_enabled: Some(runtime.settings.telemetry_enabled),
            telemetry_install_id: Some(runtime.settings.telemetry_install_id.clone()),
            telemetry_host: Some(runtime.settings.telemetry_host.clone()),
            posthog_project_api_key: runtime.settings.posthog_project_api_key.clone(),
            dismissed_app_update_version: runtime.settings.dismissed_app_update_version.clone(),
            app_update_last_checked_at_ms: runtime.settings.app_update_last_checked_at_ms,
        },
        workspaces: runtime
            .workspaces
            .iter()
            .map(|workspace| PersistedWorkspace {
                path: workspace.path.clone(),
                name: Some(workspace.name.clone()),
                codex_session_id: workspace.codex_session_id.clone(),
                pane_restore_bindings: workspace
                    .codex_restore_bindings
                    .iter()
                    .map(|binding| PersistedWorkspacePaneRestoreBinding {
                        slot_index: binding.slot_index,
                        kind: PersistedWorkspacePaneRestoreKind::Codex,
                        session_id: binding.session_id.clone(),
                        cwd: binding.cwd.clone(),
                        last_bound_at_ms: binding.last_bound_at_ms,
                    })
                    .collect(),
                pane_count: Some(workspace.layout.pane_count),
                layout_id: None,
                pane_layout: crate::persist_pane_layout(workspace),
                todos: workspace
                    .todos
                    .iter()
                    .map(|todo| PersistedWorkspaceTodo {
                        id: Some(todo.id.clone()),
                        text: todo.text.clone(),
                        done: todo.done,
                    })
                    .collect(),
                file_draft: workspace.file_draft.as_ref().map(|draft| {
                    PersistedWorkspaceFileDraft {
                        relative_path: draft.relative_path.clone(),
                        draft: draft.draft.clone(),
                        base_version_token: draft.base_version_token.clone(),
                    }
                }),
            })
            .collect(),
        recent_activity: runtime
            .activity_history
            .iter()
            .filter(|event| workspace_paths.contains(event.workspace_path.as_str()))
            .cloned()
            .collect(),
        active_workspace_index: runtime.active_workspace_index(),
        active_workspace_path: runtime.active_workspace_path(),
    }
}

pub(crate) fn build_activity_snapshot(runtime: &RuntimeState) -> ActivitySnapshot {
    ActivitySnapshot {
        recent_events: runtime
            .activity_history
            .iter()
            .filter_map(|event| {
                let workspace_id = runtime
                    .workspaces
                    .iter()
                    .find(|workspace| workspace.path == event.workspace_path)
                    .map(|workspace| workspace.id.clone())?;

                Some(ActivityEventSnapshot {
                    kind: event.kind,
                    workspace_id,
                    pane_id: event.pane_id.clone(),
                    label: event.label.clone(),
                    error: event.error.clone(),
                    at: event.at,
                })
            })
            .collect(),
    }
}

pub(crate) fn record_runtime_activity(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    pane_id: Option<&str>,
    kind: ActivityEventKind,
    label: &str,
    error: Option<&str>,
) -> Option<ActivityEventSnapshot> {
    let Some(workspace_path) = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .map(|workspace| workspace.path.clone())
    else {
        return None;
    };

    let event = ActivityEventRecord {
        kind,
        workspace_path,
        pane_id: pane_id.unwrap_or_default().to_string(),
        label: label.to_string(),
        error: error.unwrap_or_default().to_string(),
        at: now_timestamp_ms(),
    };
    let snapshot = ActivityEventSnapshot {
        kind: event.kind,
        workspace_id: workspace_id.to_string(),
        pane_id: event.pane_id.clone(),
        label: event.label.clone(),
        error: event.error.clone(),
        at: event.at,
    };

    runtime.activity_history.insert(0, event);

    if runtime.activity_history.len() > MAX_PERSISTED_ACTIVITY_EVENTS {
        runtime
            .activity_history
            .truncate(MAX_PERSISTED_ACTIVITY_EVENTS);
    }

    Some(snapshot)
}

fn run_persistence_worker(receiver: mpsc::Receiver<PersistenceMessage>) {
    let mut shutdown_requested = false;

    loop {
        let message = match receiver.recv() {
            Ok(message) => message,
            Err(_) => break,
        };

        match message {
            PersistenceMessage::Persist(request) => {
                let mut latest = request;
                let mut flush_waiters = Vec::new();

                loop {
                    match receiver.try_recv() {
                        Ok(PersistenceMessage::Persist(next)) => latest = next,
                        Ok(PersistenceMessage::Flush(waiter)) => flush_waiters.push(waiter),
                        Ok(PersistenceMessage::Shutdown) => {
                            shutdown_requested = true;
                            break;
                        }
                        Err(mpsc::TryRecvError::Empty) => break,
                        Err(mpsc::TryRecvError::Disconnected) => {
                            shutdown_requested = true;
                            break;
                        }
                    }
                }

                if let Err(error) = write_persisted_request(latest) {
                    eprintln!("{error}");
                }

                for waiter in flush_waiters {
                    let _ = waiter.send(());
                }

                if shutdown_requested {
                    break;
                }
            }
            PersistenceMessage::Flush(waiter) => {
                let _ = waiter.send(());
            }
            PersistenceMessage::Shutdown => break,
        }
    }
}

fn write_persisted_request(request: PersistedWriteRequest) -> Result<(), String> {
    if let Some(parent) = request.path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
    }

    let payload = serde_json::to_vec(&request.state)
        .map_err(|error| format!("failed to serialize workspace state: {error}"))?;
    fs::write(&request.path, payload)
        .map_err(|error| format!("failed to persist workspace state: {error}"))
}

pub(crate) fn persist_to_disk(runtime: &RuntimeState) -> Result<(), String> {
    let Some(path) = runtime.persistence_path.as_ref() else {
        return Ok(());
    };

    runtime
        .persistence
        .schedule(path.clone(), runtime.persisted_state(), cfg!(test))
}

pub(crate) fn load_persisted_from_disk(
    runtime: &mut RuntimeState,
    path: PathBuf,
) -> Result<(), String> {
    runtime.persistence_path = Some(path.clone());

    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!("failed to read persisted workspaces: {error}"));
        }
    };

    let persisted: PersistedWorkspaceState = serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse persisted workspaces: {error}"))?;

    runtime.workspaces.clear();
    runtime.active_workspace_id = None;
    runtime.settings = SettingsRecord::default();
    runtime.activity_history.clear();
    runtime.sessions.clear();
    runtime.pending_codex_starts.clear();

    if let Some(theme_id) = persisted
        .settings
        .theme_id
        .as_deref()
        .and_then(ThemeId::parse)
    {
        runtime.settings.theme_id = theme_id;
    }

    if let Some(interface_text_scale) = persisted.settings.interface_text_scale {
        runtime.settings.interface_text_scale =
            crate::normalize_interface_text_scale(interface_text_scale);
    }

    if let Some(terminal_font_size) = persisted.settings.terminal_font_size {
        runtime.settings.terminal_font_size =
            crate::normalize_terminal_font_size(terminal_font_size);
    }
    runtime.settings.codex_cli_path =
        crate::normalize_optional_codex_cli_path(persisted.settings.codex_cli_path);

    runtime.settings.openai_api_key =
        crate::normalize_optional_openai_api_key(persisted.settings.openai_api_key);
    runtime.settings.telemetry_enabled = persisted.settings.telemetry_enabled.unwrap_or(false);
    runtime.settings.telemetry_install_id =
        crate::telemetry::normalize_telemetry_install_id(persisted.settings.telemetry_install_id);
    runtime.settings.telemetry_host =
        crate::telemetry::normalize_posthog_host(persisted.settings.telemetry_host);
    runtime.settings.posthog_project_api_key =
        crate::telemetry::normalize_optional_posthog_project_api_key(
            persisted.settings.posthog_project_api_key,
        );
    runtime.settings.dismissed_app_update_version = persisted
        .settings
        .dismissed_app_update_version
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    runtime.settings.app_update_last_checked_at_ms =
        persisted.settings.app_update_last_checked_at_ms;

    let active_index = persisted.active_workspace_index;
    let active_path = persisted.active_workspace_path;
    for (index, persisted_workspace) in persisted.workspaces.into_iter().enumerate() {
        let Ok(path) = crate::normalize_workspace_path(&persisted_workspace.path) else {
            continue;
        };

        let Some(pane_count) = persisted_workspace.pane_count.or_else(|| {
            persisted_workspace
                .layout_id
                .as_deref()
                .and_then(crate::pane_count_from_legacy_layout_id)
        }) else {
            continue;
        };

        let workspace = match runtime.build_workspace_record(
            &path,
            pane_count,
            persisted_workspace.pane_layout.as_ref(),
        ) {
            Ok(mut workspace) => {
                if let Some(name) = persisted_workspace
                    .name
                    .as_deref()
                    .and_then(|raw| crate::normalize_workspace_name(raw).ok())
                {
                    workspace.name = name;
                }
                workspace.codex_session_id = crate::normalize_optional_codex_session_id(
                    persisted_workspace.codex_session_id,
                );
                workspace.codex_restore_bindings = normalize_persisted_codex_restore_bindings(
                    persisted_workspace.pane_restore_bindings,
                    &workspace.path,
                    workspace.panes.len(),
                );
                if workspace.codex_restore_bindings.is_empty() && pane_count == 1 {
                    if let Some(session_id) = workspace.codex_session_id.clone() {
                        workspace
                            .codex_restore_bindings
                            .push(CodexPaneRestoreBindingRecord {
                                slot_index: 0,
                                kind: CodexRestoreBindingKind::Codex,
                                session_id,
                                cwd: workspace.path.clone(),
                                last_bound_at_ms: now_timestamp_ms(),
                            });
                    }
                }
                workspace.todos =
                    normalize_persisted_workspace_todos(runtime, persisted_workspace.todos);
                workspace.file_draft =
                    normalize_persisted_workspace_file_draft(persisted_workspace.file_draft);
                workspace
            }
            Err(_) => continue,
        };
        if active_index == Some(index)
            || (active_index.is_none() && active_path.as_deref() == Some(workspace.path.as_str()))
        {
            runtime.active_workspace_id = Some(workspace.id.clone());
        }
        runtime.workspaces.push(workspace);
    }

    if runtime.active_workspace_id.is_none() {
        runtime.active_workspace_id = runtime
            .workspaces
            .first()
            .map(|workspace| workspace.id.clone());
    }

    if let Some(path) = runtime.active_workspace_path().or_else(|| {
        runtime
            .workspaces
            .first()
            .map(|workspace| workspace.path.clone())
    }) {
        runtime.launcher.base_path = path;
    }

    let workspace_paths: HashSet<&str> = runtime
        .workspaces
        .iter()
        .map(|workspace| workspace.path.as_str())
        .collect();
    runtime.activity_history = persisted
        .recent_activity
        .into_iter()
        .filter_map(|mut event| {
            let normalized_path = crate::normalize_workspace_path(&event.workspace_path).ok()?;
            event.workspace_path = normalized_path.display().to_string();
            workspace_paths
                .contains(event.workspace_path.as_str())
                .then_some(event)
        })
        .take(MAX_PERSISTED_ACTIVITY_EVENTS)
        .collect();

    Ok(())
}

pub(crate) fn resolve_persistence_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    Ok(base_dir.join(PERSISTENCE_FILE))
}

fn now_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_persisted_workspace_todos(
    runtime: &mut RuntimeState,
    todos: Vec<PersistedWorkspaceTodo>,
) -> Vec<WorkspaceTodoRecord> {
    let mut seen_ids = HashSet::new();
    let mut open_todos = Vec::new();
    let mut completed_todos = Vec::new();

    for todo in todos {
        let Ok(text) = crate::normalize_workspace_todo_text(&todo.text) else {
            continue;
        };

        let mut todo_id = todo
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| runtime.next_id("todo"));

        while !seen_ids.insert(todo_id.clone()) {
            todo_id = runtime.next_id("todo");
        }

        let record = WorkspaceTodoRecord {
            id: todo_id,
            text,
            done: todo.done,
        };

        if record.done {
            completed_todos.push(record);
        } else {
            open_todos.push(record);
        }
    }

    open_todos.extend(completed_todos);
    open_todos
}

fn normalize_persisted_codex_restore_bindings(
    bindings: Vec<PersistedWorkspacePaneRestoreBinding>,
    workspace_path: &str,
    pane_count: usize,
) -> Vec<CodexPaneRestoreBindingRecord> {
    let mut normalized = Vec::new();
    let mut seen_slots = HashSet::new();

    for binding in bindings {
        if binding.kind != PersistedWorkspacePaneRestoreKind::Codex {
            continue;
        }
        if binding.slot_index >= pane_count || !seen_slots.insert(binding.slot_index) {
            continue;
        }
        let Some(session_id) = crate::normalize_optional_codex_session_id(Some(binding.session_id))
        else {
            continue;
        };
        let cwd = if binding.cwd.trim().is_empty() {
            workspace_path.to_string()
        } else {
            binding.cwd.trim().to_string()
        };

        normalized.push(CodexPaneRestoreBindingRecord {
            slot_index: binding.slot_index,
            kind: CodexRestoreBindingKind::Codex,
            session_id,
            cwd,
            last_bound_at_ms: binding.last_bound_at_ms,
        });
    }

    normalized.sort_by(|left, right| left.slot_index.cmp(&right.slot_index));
    normalized
}

fn normalize_persisted_workspace_file_draft(
    draft: Option<PersistedWorkspaceFileDraft>,
) -> Option<WorkspaceFileDraftRecord> {
    let draft = draft?;
    let relative_path = crate::normalize_workspace_relative_path(&draft.relative_path).ok()?;
    if relative_path.is_empty() {
        return None;
    }

    let base_version_token = draft.base_version_token.trim().to_string();
    if base_version_token.is_empty() {
        return None;
    }

    Some(WorkspaceFileDraftRecord {
        relative_path,
        draft: draft.draft,
        base_version_token,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        PersistedSettings, PersistedWorkspace, PersistedWorkspaceState, PersistenceCoordinator,
    };
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_test_path() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("crewdock-persistence-test-{}", std::process::id()))
            .join(format!("{timestamp}.json"))
    }

    fn build_persisted_state(name: &str) -> PersistedWorkspaceState {
        PersistedWorkspaceState {
            settings: PersistedSettings::default(),
            workspaces: vec![PersistedWorkspace {
                path: format!("/tmp/{name}"),
                name: Some(name.to_string()),
                codex_session_id: None,
                pane_restore_bindings: Vec::new(),
                pane_count: Some(1),
                layout_id: None,
                pane_layout: None,
                todos: Vec::new(),
                file_draft: None,
            }],
            recent_activity: Vec::new(),
            active_workspace_index: Some(0),
            active_workspace_path: Some(format!("/tmp/{name}")),
        }
    }

    #[test]
    fn persistence_coordinator_flushes_latest_scheduled_state() {
        let path = unique_test_path();
        let coordinator = PersistenceCoordinator::default();

        coordinator
            .schedule(path.clone(), build_persisted_state("first"), false)
            .expect("first state should queue");
        coordinator
            .schedule(path.clone(), build_persisted_state("second"), false)
            .expect("second state should queue");
        coordinator.flush().expect("flush should succeed");

        let payload = fs::read_to_string(&path).expect("state file should exist");
        assert!(payload.contains("second"));
        assert!(!payload.contains("first"));

        if let Some(parent) = path.parent() {
            let _ = fs::remove_file(&path);
            let _ = fs::remove_dir(parent);
        }
    }
}
