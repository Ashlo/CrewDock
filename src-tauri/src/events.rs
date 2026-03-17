use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::AppSnapshot;

const STATE_EVENT: &str = "crewdock://state-changed";
const TERMINAL_DATA_EVENT: &str = "crewdock://terminal-data";
const RUNTIME_EVENT: &str = "crewdock://runtime-event";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalDataPayload {
    pub(crate) pane_id: String,
    pub(crate) data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum RuntimeEvent {
    PaneReady {
        workspace_id: String,
        pane_id: String,
        label: String,
    },
    PaneClosed {
        workspace_id: String,
        pane_id: String,
        label: String,
    },
    PaneFailed {
        workspace_id: String,
        pane_id: String,
        label: String,
        error: String,
    },
}

pub(crate) fn emit_snapshot(app: &AppHandle, snapshot: &AppSnapshot) -> Result<(), String> {
    app.emit(STATE_EVENT, snapshot)
        .map_err(|error| error.to_string())
}

pub(crate) fn emit_terminal_data(
    app: &AppHandle,
    payload: &TerminalDataPayload,
) -> Result<(), String> {
    app.emit(TERMINAL_DATA_EVENT, payload)
        .map_err(|error| error.to_string())
}

pub(crate) fn emit_runtime_event(app: &AppHandle, event: &RuntimeEvent) -> Result<(), String> {
    app.emit(RUNTIME_EVENT, event)
        .map_err(|error| error.to_string())
}
