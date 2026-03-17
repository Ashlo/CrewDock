use std::{
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::AppHandle;

use super::{
    events::{
        emit_runtime_event, emit_snapshot, emit_terminal_data, RuntimeEvent, TerminalDataPayload,
    },
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

    let snapshot = {
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
        runtime.sessions.insert(
            pane_id.clone(),
            LiveSession {
                workspace_id: workspace_id.clone(),
                master: master.clone(),
                writer: writer.clone(),
                killer,
            },
        );
        runtime.build_snapshot()
    };

    emit_snapshot(app, &snapshot)?;
    emit_runtime_event(
        app,
        &RuntimeEvent::PaneReady {
            workspace_id: workspace_id.clone(),
            pane_id: pane_id.clone(),
            label: label.clone(),
        },
    )?;

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

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let payload = TerminalDataPayload {
                    pane_id: pane_id.clone(),
                    data: String::from_utf8_lossy(&buffer[..read]).into_owned(),
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
    let (snapshot, event) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let mut event = None;
        runtime.sessions.remove(pane_id);
        if let Some(workspace) = runtime
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.panes.iter().any(|pane| pane.id == pane_id))
        {
            if let Some(pane) = workspace.panes.iter_mut().find(|pane| pane.id == pane_id) {
                pane.status = PaneStatus::Closed;
                event = Some(RuntimeEvent::PaneClosed {
                    workspace_id: workspace.id.clone(),
                    pane_id: pane_id.to_string(),
                    label: pane.label.clone(),
                });
            }
        }

        (runtime.build_snapshot(), event)
    };

    emit_snapshot(app, &snapshot)?;
    if let Some(event) = event {
        emit_runtime_event(app, &event)?;
    }
    Ok(())
}

fn fail_pane(
    shared: &Arc<Mutex<RuntimeState>>,
    app: &AppHandle,
    pane_id: &str,
    error: String,
) -> Result<(), String> {
    let (snapshot, event) = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;

        let mut event = None;
        runtime.sessions.remove(pane_id);
        if let Some(workspace) = runtime
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.panes.iter().any(|pane| pane.id == pane_id))
        {
            if let Some(pane) = workspace.panes.iter_mut().find(|pane| pane.id == pane_id) {
                pane.status = PaneStatus::Failed;
                event = Some(RuntimeEvent::PaneFailed {
                    workspace_id: workspace.id.clone(),
                    pane_id: pane_id.to_string(),
                    label: pane.label.clone(),
                    error: error.clone(),
                });
            }
        }

        (runtime.build_snapshot(), event)
    };

    emit_snapshot(app, &snapshot)?;
    if let Some(event) = event {
        emit_runtime_event(app, &event)?;
    }
    emit_terminal_data(
        app,
        &TerminalDataPayload {
            pane_id: pane_id.to_string(),
            data: format!("\r\n[session error: {error}]\r\n"),
        },
    )
}
