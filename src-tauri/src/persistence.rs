use std::{collections::HashSet, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{PersistedPaneLayout, RuntimeState, SettingsRecord, ThemeId};

const PERSISTENCE_FILE: &str = "workspaces.json";
const MAX_PERSISTED_ACTIVITY_EVENTS: usize = 80;

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
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedWorkspace {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) pane_count: Option<u8>,
    #[serde(default)]
    pub(crate) layout_id: Option<String>,
    #[serde(default)]
    pub(crate) pane_layout: Option<PersistedPaneLayout>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ActivityEventKind {
    PaneReady,
    PaneClosed,
    PaneFailed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityEventRecord {
    pub(crate) kind: ActivityEventKind,
    pub(crate) workspace_path: String,
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
        },
        workspaces: runtime
            .workspaces
            .iter()
            .map(|workspace| PersistedWorkspace {
                path: workspace.path.clone(),
                name: Some(workspace.name.clone()),
                pane_count: Some(workspace.layout.pane_count),
                layout_id: None,
                pane_layout: crate::persist_pane_layout(workspace),
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
                    pane_id: String::new(),
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
    kind: ActivityEventKind,
    label: &str,
    error: Option<&str>,
) {
    let Some(workspace_path) = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .map(|workspace| workspace.path.clone())
    else {
        return;
    };

    runtime.activity_history.insert(
        0,
        ActivityEventRecord {
            kind,
            workspace_path,
            label: label.to_string(),
            error: error.unwrap_or_default().to_string(),
            at: now_timestamp_ms(),
        },
    );

    if runtime.activity_history.len() > MAX_PERSISTED_ACTIVITY_EVENTS {
        runtime
            .activity_history
            .truncate(MAX_PERSISTED_ACTIVITY_EVENTS);
    }
}

pub(crate) fn persist_to_disk(runtime: &RuntimeState) -> Result<(), String> {
    let Some(path) = runtime.persistence_path.as_ref() else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
    }

    let payload = serde_json::to_vec_pretty(&runtime.persisted_state())
        .map_err(|error| format!("failed to serialize workspace state: {error}"))?;
    fs::write(path, payload).map_err(|error| format!("failed to persist workspace state: {error}"))
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
