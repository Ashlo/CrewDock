use std::{
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::AppHandle;

use super::{
    events::{emit_runtime_event, emit_terminal_data, RuntimeEvent, TerminalDataPayload},
    persistence::{self, ActivityEventKind},
    PaneStatus, RuntimeState,
};

#[derive(Debug, Clone)]
pub(crate) struct PaneJob {
    pub(crate) workspace_id: String,
    pub(crate) pane_id: String,
    pub(crate) label: String,
    pub(crate) layout_label: String,
    pub(crate) cwd: String,
}

pub(crate) struct LiveSession {
    pub(crate) workspace_id: String,
    pub(crate) master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub(crate) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(crate) killer: Box<dyn ChildKiller + Send + Sync>,
}

pub(crate) fn prepare_workspace_launch(
    runtime: &mut RuntimeState,
    workspace_id: &str,
) -> Option<Vec<PaneJob>> {
    let workspace = runtime
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)?;

    if workspace.started {
        return None;
    }

    workspace.started = true;
    let workspace_id = workspace.id.clone();
    let layout_label = workspace.layout.label.clone();
    let cwd = workspace.path.clone();
    let jobs = workspace
        .panes
        .iter_mut()
        .map(|pane| {
            pane.status = PaneStatus::Booting;
            PaneJob {
                workspace_id: workspace_id.clone(),
                pane_id: pane.id.clone(),
                label: pane.label.clone(),
                layout_label: layout_label.clone(),
                cwd: cwd.clone(),
            }
        })
        .collect();

    Some(jobs)
}

pub(crate) fn spawn_pane_jobs(
    shared: Arc<Mutex<RuntimeState>>,
    app: AppHandle,
    shell: String,
    jobs: Vec<PaneJob>,
) {
    for job in jobs {
        let shared = shared.clone();
        let app_handle = app.clone();
        let shell = shell.clone();

        std::thread::spawn(move || {
            if let Err(error) = spawn_terminal_session(
                &shared,
                &app_handle,
                job.workspace_id,
                job.pane_id,
                job.label,
                job.layout_label,
                shell,
                job.cwd,
            ) {
                eprintln!("failed to spawn terminal session: {error}");
            }
        });
    }
}

fn spawn_terminal_session(
    shared: &Arc<Mutex<RuntimeState>>,
    app: &AppHandle,
    workspace_id: String,
    pane_id: String,
    label: String,
    layout_label: String,
    shell: String,
    cwd: String,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open PTY: {error}"))?;

    let mut command = CommandBuilder::new(&shell);
    command.arg("-l");
    command.cwd(&cwd);
    strip_tooling_env(&mut command);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("CREWDOCK_LAYOUT", &layout_label);
    command.env("CREWDOCK_PANE_LABEL", &label);

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn shell: {error}"))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to clone PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to open PTY writer: {error}"))?;
    let killer = child.clone_killer();
    let master = Arc::new(Mutex::new(pair.master));
    let writer = Arc::new(Mutex::new(writer));

    let activity_event = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let Some(workspace) = runtime
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id)
        else {
            let _ = killer.clone_killer().kill();
            return Ok(());
        };

        let Some(pane) = workspace.panes.iter_mut().find(|pane| pane.id == pane_id) else {
            let _ = killer.clone_killer().kill();
            return Ok(());
        };

        pane.status = PaneStatus::Ready;
        let activity_event = persistence::record_runtime_activity(
            &mut runtime,
            &workspace_id,
            Some(&pane_id),
            ActivityEventKind::PaneReady,
            &label,
            None,
        );
        runtime.sessions.insert(
            pane_id.clone(),
            LiveSession {
                workspace_id: workspace_id.clone(),
                master: master.clone(),
                writer: writer.clone(),
                killer,
            },
        );
        runtime.persist_to_disk()?;
        activity_event
    };

    emit_runtime_event(
        app,
        &RuntimeEvent::PaneReady {
            workspace_id: workspace_id.clone(),
            pane_id: pane_id.clone(),
            label: label.clone(),
        },
    )?;
    if let Some(activity_event) = activity_event {
        emit_runtime_event(
            app,
            &RuntimeEvent::ActivityRecorded {
                event: activity_event,
            },
        )?;
    }
    if let Err(error) =
        super::maybe_auto_restore_codex_for_ready_pane(shared, app, &workspace_id, &pane_id)
    {
        eprintln!("failed to auto-restore Codex session: {error}");
    }

    let app_handle = app.clone();
    let shared = shared.clone();
    std::thread::spawn(move || {
        stream_terminal_output(shared, app_handle, pane_id, reader, &mut child);
    });

    Ok(())
}

fn strip_tooling_env(command: &mut CommandBuilder) {
    for (key, _) in env::vars_os() {
        let key = key.to_string_lossy();
        if key.starts_with("npm_") || key.starts_with("NPM_") {
            command.env_remove(key.as_ref());
        }
    }
}

fn stream_terminal_output(
    shared: Arc<Mutex<RuntimeState>>,
    app: AppHandle,
    pane_id: String,
    mut reader: Box<dyn Read + Send>,
    child: &mut Box<dyn Child + Send + Sync>,
) {
    let mut buffer = [0u8; 8192];
    let mut pending_utf8 = Vec::new();

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let data = decode_terminal_utf8_chunk(&mut pending_utf8, &buffer[..read]);
                if data.is_empty() {
                    continue;
                }
                let payload = TerminalDataPayload {
                    pane_id: pane_id.clone(),
                    data,
                };
                if let Err(error) = emit_terminal_data(&app, &payload) {
                    eprintln!("failed to emit terminal data: {error}");
                    break;
                }
            }
            Err(error) => {
                if let Err(inner_error) = fail_pane(&shared, &app, &pane_id, error.to_string()) {
                    eprintln!("failed to mark pane error: {inner_error}");
                }
                return;
            }
        }
    }

    let trailing = flush_terminal_utf8_buffer(&mut pending_utf8);
    if !trailing.is_empty() {
        let _ = emit_terminal_data(
            &app,
            &TerminalDataPayload {
                pane_id: pane_id.clone(),
                data: trailing,
            },
        );
    }

    match child.wait() {
        Ok(status) => {
            let message = format!("\r\n[session closed: {status}]\r\n");
            let _ = emit_terminal_data(
                &app,
                &TerminalDataPayload {
                    pane_id: pane_id.clone(),
                    data: message,
                },
            );
            if let Err(error) = mark_pane_closed(&shared, &app, &pane_id) {
                eprintln!("failed to mark pane closed: {error}");
            }
        }
        Err(error) => {
            if let Err(inner_error) = fail_pane(&shared, &app, &pane_id, error.to_string()) {
                eprintln!("failed to mark pane failure: {inner_error}");
            }
        }
    }
}

fn mark_pane_closed(
    shared: &Arc<Mutex<RuntimeState>>,
    app: &AppHandle,
    pane_id: &str,
) -> Result<(), String> {
    let (event, activity_event) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let mut event = None;
        let mut activity_event = None;
        runtime.sessions.remove(pane_id);
        let mut closed_pane = None;
        if let Some(workspace) = runtime
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.panes.iter().any(|pane| pane.id == pane_id))
        {
            if let Some(pane) = workspace.panes.iter_mut().find(|pane| pane.id == pane_id) {
                pane.status = PaneStatus::Closed;
                closed_pane = Some((workspace.id.clone(), pane.label.clone()));
            }
        }

        if let Some((workspace_id, pane_label)) = closed_pane {
            activity_event = persistence::record_runtime_activity(
                &mut runtime,
                &workspace_id,
                Some(pane_id),
                ActivityEventKind::PaneClosed,
                &pane_label,
                None,
            );
            event = Some(RuntimeEvent::PaneClosed {
                workspace_id,
                pane_id: pane_id.to_string(),
                label: pane_label,
            });
        }

        runtime.persist_to_disk()?;

        (event, activity_event)
    };

    if let Some(event) = event {
        emit_runtime_event(app, &event)?;
    }
    if let Some(activity_event) = activity_event {
        emit_runtime_event(
            app,
            &RuntimeEvent::ActivityRecorded {
                event: activity_event,
            },
        )?;
    }
    Ok(())
}

fn fail_pane(
    shared: &Arc<Mutex<RuntimeState>>,
    app: &AppHandle,
    pane_id: &str,
    error: String,
) -> Result<(), String> {
    let (event, activity_event) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let mut event = None;
        let mut activity = None;
        let mut activity_event = None;
        runtime.sessions.remove(pane_id);
        if let Some(workspace) = runtime
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.panes.iter().any(|pane| pane.id == pane_id))
        {
            if let Some(pane) = workspace.panes.iter_mut().find(|pane| pane.id == pane_id) {
                pane.status = PaneStatus::Failed;
                activity = Some((workspace.id.clone(), pane.label.clone(), error.clone()));
                event = Some(RuntimeEvent::PaneFailed {
                    workspace_id: workspace.id.clone(),
                    pane_id: pane_id.to_string(),
                    label: pane.label.clone(),
                    error: error.clone(),
                });
            }
        }

        if let Some((workspace_id, label, failure)) = activity {
            activity_event = persistence::record_runtime_activity(
                &mut runtime,
                &workspace_id,
                Some(pane_id),
                ActivityEventKind::PaneFailed,
                &label,
                Some(failure.as_str()),
            );
            runtime.persist_to_disk()?;
        }

        (event, activity_event)
    };

    if let Some(event) = event {
        emit_runtime_event(app, &event)?;
    }
    if let Some(activity_event) = activity_event {
        emit_runtime_event(
            app,
            &RuntimeEvent::ActivityRecorded {
                event: activity_event,
            },
        )?;
    }
    emit_terminal_data(
        app,
        &TerminalDataPayload {
            pane_id: pane_id.to_string(),
            data: format!("\r\n[session error: {error}]\r\n"),
        },
    )
}

fn decode_terminal_utf8_chunk(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    decode_terminal_utf8_buffer(pending, false)
}

fn flush_terminal_utf8_buffer(pending: &mut Vec<u8>) -> String {
    decode_terminal_utf8_buffer(pending, true)
}

fn decode_terminal_utf8_buffer(buffer: &mut Vec<u8>, flush_incomplete: bool) -> String {
    if buffer.is_empty() {
        return String::new();
    }

    let mut decoded = String::new();
    let mut consumed = 0usize;
    let mut slice = buffer.as_slice();

    while !slice.is_empty() {
        match std::str::from_utf8(slice) {
            Ok(valid) => {
                decoded.push_str(valid);
                consumed = buffer.len();
                break;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    if let Ok(valid) = std::str::from_utf8(&slice[..valid_up_to]) {
                        decoded.push_str(valid);
                    }
                    consumed += valid_up_to;
                    slice = &slice[valid_up_to..];
                }

                match error.error_len() {
                    Some(error_len) => {
                        decoded.push_str(&String::from_utf8_lossy(&slice[..error_len]));
                        consumed += error_len;
                        slice = &slice[error_len..];
                    }
                    None if flush_incomplete => {
                        decoded.push_str(&String::from_utf8_lossy(slice));
                        consumed = buffer.len();
                        break;
                    }
                    None => break,
                }
            }
        }
    }

    if consumed > 0 {
        buffer.drain(..consumed);
    }

    decoded
}

#[cfg(test)]
mod tests {
    use super::{decode_terminal_utf8_chunk, flush_terminal_utf8_buffer};

    #[test]
    fn terminal_utf8_decoder_preserves_split_multibyte_sequences() {
        let mut pending = Vec::new();

        let first = decode_terminal_utf8_chunk(&mut pending, &[0xE2, 0x96]);
        let second = decode_terminal_utf8_chunk(&mut pending, &[0x88, b'\n']);

        assert!(first.is_empty());
        assert_eq!(second, "█\n");
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_utf8_decoder_keeps_valid_text_after_invalid_bytes() {
        let mut pending = Vec::new();

        let decoded = decode_terminal_utf8_chunk(&mut pending, &[0xFF, b'A', 0xC3, 0xA9]);

        assert_eq!(decoded, "\u{FFFD}Aé");
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_utf8_decoder_flushes_trailing_incomplete_sequence_lossily() {
        let mut pending = Vec::new();

        let decoded = decode_terminal_utf8_chunk(&mut pending, &[b'O', b'K', 0xE2, 0x96]);
        let flushed = flush_terminal_utf8_buffer(&mut pending);

        assert_eq!(decoded, "OK");
        assert_eq!(flushed, "\u{FFFD}");
        assert!(pending.is_empty());
    }
}
