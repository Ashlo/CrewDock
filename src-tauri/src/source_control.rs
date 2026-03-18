use std::{
    env,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::AppHandle;

use crate::{
    collect_git_detail,
    events::{emit_runtime_event, emit_snapshot, RuntimeEvent},
    run_git_command, AppSnapshot, GitFileSnapshot, GitSummarySnapshot, RuntimeState,
};

const GRAPH_PAGE_SIZE: usize = 120;
const MAX_GIT_TASK_OUTPUT_BYTES: usize = 96 * 1024;
const MAX_GIT_DIFF_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSourceControlSnapshot {
    pub(crate) workspace_id: String,
    pub(crate) workspace_name: String,
    pub(crate) workspace_path: String,
    pub(crate) repo_root: Option<String>,
    pub(crate) workspace_relative_path: Option<String>,
    pub(crate) summary: GitSummarySnapshot,
    pub(crate) changes: Vec<GitFileSnapshot>,
    pub(crate) local_branches: Vec<GitBranchSnapshot>,
    pub(crate) remote_branches: Vec<GitBranchSnapshot>,
    pub(crate) graph: GitGraphSnapshot,
    pub(crate) task: Option<GitTaskSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBranchSnapshot {
    pub(crate) name: String,
    pub(crate) full_name: String,
    pub(crate) upstream: Option<String>,
    pub(crate) short_oid: String,
    pub(crate) subject: String,
    pub(crate) relative_date: String,
    pub(crate) is_current: bool,
    pub(crate) is_remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitGraphSnapshot {
    pub(crate) commits: Vec<GitGraphCommitSnapshot>,
    pub(crate) next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitGraphCommitSnapshot {
    pub(crate) oid: String,
    pub(crate) short_oid: String,
    pub(crate) subject: String,
    pub(crate) author: String,
    pub(crate) relative_date: String,
    pub(crate) graph_prefix: String,
    pub(crate) refs: Vec<GitRefLabelSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRefLabelSnapshot {
    pub(crate) label: String,
    pub(crate) kind: GitRefKind,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitRefKind {
    Head,
    LocalBranch,
    RemoteBranch,
    Tag,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffSnapshot {
    pub(crate) path: String,
    pub(crate) original_path: Option<String>,
    pub(crate) mode: GitDiffMode,
    pub(crate) text: String,
    pub(crate) is_binary: bool,
    pub(crate) is_truncated: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitDiffMode {
    WorkingTree,
    Staged,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCommitDetailSnapshot {
    pub(crate) oid: String,
    pub(crate) short_oid: String,
    pub(crate) subject: String,
    pub(crate) body: String,
    pub(crate) author: String,
    pub(crate) email: String,
    pub(crate) relative_date: String,
    pub(crate) refs: Vec<GitRefLabelSnapshot>,
    pub(crate) parents: Vec<String>,
    pub(crate) files: Vec<GitCommitFileSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCommitFileSnapshot {
    pub(crate) status: String,
    pub(crate) path: String,
    pub(crate) original_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitTaskSnapshot {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) command: String,
    pub(crate) status: GitTaskStatus,
    pub(crate) output: String,
    pub(crate) can_write_input: bool,
    pub(crate) started_at: u64,
    pub(crate) finished_at: Option<u64>,
    pub(crate) exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitTaskStatus {
    Running,
    Succeeded,
    Failed,
}

pub(crate) struct GitTaskRecord {
    pub(crate) snapshot: GitTaskSnapshot,
    pub(crate) writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
}

pub(crate) fn load_workspace_source_control(
    runtime: &RuntimeState,
    workspace_id: &str,
    graph_cursor: Option<String>,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let workspace = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let detail = collect_git_detail(Path::new(&workspace.path));
    let graph_skip = graph_cursor
        .as_deref()
        .and_then(|raw| raw.parse::<usize>().ok())
        .unwrap_or(0);

    let (local_branches, remote_branches, graph) =
        if let Some(repo_root) = detail.repo_root.as_deref() {
            let repo_root = PathBuf::from(repo_root);
            (
                load_branches(&repo_root, false).unwrap_or_default(),
                load_branches(&repo_root, true).unwrap_or_default(),
                load_graph_page(&repo_root, graph_skip).unwrap_or_else(|_| GitGraphSnapshot {
                    commits: Vec::new(),
                    next_cursor: None,
                }),
            )
        } else {
            (
                Vec::new(),
                Vec::new(),
                GitGraphSnapshot {
                    commits: Vec::new(),
                    next_cursor: None,
                },
            )
        };

    Ok(WorkspaceSourceControlSnapshot {
        workspace_id: workspace.id.clone(),
        workspace_name: workspace.name.clone(),
        workspace_path: workspace.path.clone(),
        repo_root: detail.repo_root.clone(),
        workspace_relative_path: detail.workspace_relative_path.clone(),
        summary: detail.summary.clone(),
        changes: detail.files.clone(),
        local_branches,
        remote_branches,
        graph,
        task: runtime
            .git_tasks
            .get(workspace_id)
            .map(|task| task.snapshot.clone()),
    })
}

pub(crate) fn load_workspace_git_diff(
    runtime: &RuntimeState,
    workspace_id: &str,
    path: &str,
    mode: GitDiffMode,
) -> Result<GitDiffSnapshot, String> {
    let workspace = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let detail = collect_git_detail(Path::new(&workspace.path));
    let repo_root = detail
        .repo_root
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| detail.summary.message.unwrap_or_else(|| "repository not found".to_string()))?;
    let file = detail
        .files
        .iter()
        .find(|file| file.path == path)
        .cloned();
    let original_path = file.and_then(|entry| entry.original_path);

    let text = match mode {
        GitDiffMode::Staged => run_git_capture(&repo_root, &["diff", "--cached", "--", path])?,
        GitDiffMode::WorkingTree => {
            let diff = run_git_capture(&repo_root, &["diff", "--", path])?;
            if diff.is_empty() {
                load_untracked_diff(&repo_root, path)?
            } else {
                diff
            }
        }
    };

    let is_binary = text.contains("Binary files") || text.contains("GIT binary patch");
    let (text, is_truncated) = truncate_git_output(&text, MAX_GIT_DIFF_BYTES);

    Ok(GitDiffSnapshot {
        path: path.to_string(),
        original_path,
        mode,
        text,
        is_binary,
        is_truncated,
    })
}

pub(crate) fn load_workspace_git_commit_detail(
    runtime: &RuntimeState,
    workspace_id: &str,
    oid: &str,
) -> Result<GitCommitDetailSnapshot, String> {
    let workspace = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let detail = collect_git_detail(Path::new(&workspace.path));
    let repo_root = detail
        .repo_root
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| detail.summary.message.unwrap_or_else(|| "repository not found".to_string()))?;

    let output = run_git_capture(
        &repo_root,
        &[
            "show",
            "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ar%x1f%s%x1f%b%x1f%P%x1f%D",
            "--name-status",
            "--no-color",
            oid,
        ],
    )?;
    parse_commit_detail(&output)
}

pub(crate) fn stage_paths(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    paths: &[String],
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo_root = workspace_repo_root(runtime, workspace_id)?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    run_git_strings(&repo_root, &args)?;
    refresh_workspace_cache(runtime, workspace_id)
}

pub(crate) fn unstage_paths(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    paths: &[String],
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo_root = workspace_repo_root(runtime, workspace_id)?;
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(paths.iter().cloned());
    run_git_strings(&repo_root, &args)?;
    refresh_workspace_cache(runtime, workspace_id)
}

pub(crate) fn discard_paths(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    paths: &[String],
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo_root = workspace_repo_root(runtime, workspace_id)?;
    let detail = collect_git_detail(&repo_root);

    let tracked = detail
        .files
        .iter()
        .filter(|file| paths.iter().any(|candidate| candidate == &file.path))
        .filter(|file| file.kind != crate::GitFileKind::Untracked)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let untracked = detail
        .files
        .iter()
        .filter(|file| paths.iter().any(|candidate| candidate == &file.path))
        .filter(|file| file.kind == crate::GitFileKind::Untracked)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();

    if !tracked.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--source=HEAD".to_string(),
            "--staged".to_string(),
            "--worktree".to_string(),
            "--".to_string(),
        ];
        args.extend(tracked);
        run_git_strings(&repo_root, &args)?;
    }

    for path in untracked {
        let target = repo_root.join(&path);
        if target.is_dir() {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("failed to remove {path}: {error}"))?;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|error| format!("failed to remove {path}: {error}"))?;
        }
    }

    refresh_workspace_cache(runtime, workspace_id)
}

pub(crate) fn stage_all_changes(
    runtime: &mut RuntimeState,
    workspace_id: &str,
) -> Result<(), String> {
    let repo_root = workspace_repo_root(runtime, workspace_id)?;
    run_git_strings(&repo_root, &["add".to_string(), "-A".to_string()])?;
    refresh_workspace_cache(runtime, workspace_id)
}

pub(crate) fn git_task_write_stdin(
    runtime: &RuntimeState,
    workspace_id: &str,
    data: &str,
) -> Result<(), String> {
    let task = runtime
        .git_tasks
        .get(workspace_id)
        .ok_or_else(|| "no git task for workspace".to_string())?;
    let writer = task
        .writer
        .as_ref()
        .ok_or_else(|| "git task is not accepting input".to_string())?;
    let mut writer = writer
        .lock()
        .map_err(|_| "failed to acquire git task writer".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("failed to write to git task: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush git task input: {error}"))?;
    Ok(())
}

pub(crate) fn start_git_task(
    shared: Arc<Mutex<RuntimeState>>,
    app: AppHandle,
    workspace_id: String,
    title: String,
    args: Vec<String>,
) -> Result<WorkspaceSourceControlSnapshot, String> {
    let repo_root = {
        let runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        workspace_repo_root(&runtime, &workspace_id)?
    };

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open git task PTY: {error}"))?;
    let mut command = CommandBuilder::new("git");
    for arg in &args {
        command.arg(arg);
    }
    command.cwd(&repo_root);
    strip_tooling_env(&mut command);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn git task: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to clone git task reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to open git task writer: {error}"))?;
    let writer = Arc::new(Mutex::new(writer));

    let task_snapshot = {
        let mut runtime = shared
            .lock()
            .map_err(|_| "failed to acquire application state".to_string())?;
        if runtime
            .git_tasks
            .get(&workspace_id)
            .map(|task| task.snapshot.status == GitTaskStatus::Running)
            .unwrap_or(false)
        {
            return Err("a git task is already running for this workspace".to_string());
        }

        let task_snapshot = GitTaskSnapshot {
            id: runtime.next_id("git-task"),
            title: title.clone(),
            command: format!("git {}", args.join(" ")),
            status: GitTaskStatus::Running,
            output: String::new(),
            can_write_input: true,
            started_at: now_timestamp_ms(),
            finished_at: None,
            exit_code: None,
        };
        runtime.git_tasks.insert(
            workspace_id.clone(),
            GitTaskRecord {
                snapshot: task_snapshot.clone(),
                writer: Some(writer.clone()),
            },
        );
        task_snapshot
    };

    let _ = emit_runtime_event(
        &app,
        &RuntimeEvent::GitTaskSnapshot {
            workspace_id: workspace_id.clone(),
            task: task_snapshot,
        },
    );

    let shared_for_thread = shared.clone();
    let app_for_thread = app.clone();
    let thread_workspace_id = workspace_id.clone();
    std::thread::spawn(move || {
        stream_git_task_output(
            shared_for_thread,
            app_for_thread,
            thread_workspace_id,
            reader,
            &mut child,
        );
    });

    let runtime = shared
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    load_workspace_source_control(&runtime, &workspace_id, None)
}

fn stream_git_task_output(
    shared: Arc<Mutex<RuntimeState>>,
    app: AppHandle,
    workspace_id: String,
    mut reader: Box<dyn Read + Send>,
    child: &mut Box<dyn portable_pty::Child + Send + Sync>,
) {
    let mut buffer = [0u8; 4096];

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let chunk = String::from_utf8_lossy(&buffer[..read]).into_owned();
                if let Ok(task) = append_git_task_output(&shared, &workspace_id, &chunk) {
                    let _ = emit_runtime_event(
                        &app,
                        &RuntimeEvent::GitTaskSnapshot {
                            workspace_id: workspace_id.clone(),
                            task,
                        },
                    );
                }
            }
            Err(error) => {
                if let Ok(task) = finish_git_task(&shared, &workspace_id, Some(error.to_string()), None)
                {
                    let _ = emit_runtime_event(
                        &app,
                        &RuntimeEvent::GitTaskSnapshot {
                            workspace_id: workspace_id.clone(),
                            task,
                        },
                    );
                }
                return;
            }
        }
    }

    let outcome = child.wait();
    let task = match outcome {
        Ok(status) => {
            let exit_code = i32::try_from(status.exit_code()).ok();
            finish_git_task(
                &shared,
                &workspace_id,
                None,
                exit_code,
            )
        }
        Err(error) => finish_git_task(&shared, &workspace_id, Some(error.to_string()), None),
    };

    if let Ok(task) = task {
        let _ = emit_runtime_event(
            &app,
            &RuntimeEvent::GitTaskSnapshot {
                workspace_id: workspace_id.clone(),
                task,
            },
        );
    }

    if let Ok(snapshot) = rebuild_app_snapshot(&shared, &workspace_id) {
        let _ = emit_snapshot(&app, &snapshot);
    }
}

fn rebuild_app_snapshot(
    shared: &Arc<Mutex<RuntimeState>>,
    workspace_id: &str,
) -> Result<AppSnapshot, String> {
    let mut runtime = shared
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    refresh_workspace_cache(&mut runtime, workspace_id)?;
    Ok(runtime.build_snapshot())
}

fn append_git_task_output(
    shared: &Arc<Mutex<RuntimeState>>,
    workspace_id: &str,
    chunk: &str,
) -> Result<GitTaskSnapshot, String> {
    let mut runtime = shared
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    let task = runtime
        .git_tasks
        .get_mut(workspace_id)
        .ok_or_else(|| "git task not found".to_string())?;
    task.snapshot.output.push_str(chunk);
    trim_task_output(&mut task.snapshot.output);
    Ok(task.snapshot.clone())
}

fn finish_git_task(
    shared: &Arc<Mutex<RuntimeState>>,
    workspace_id: &str,
    error: Option<String>,
    exit_code: Option<i32>,
) -> Result<GitTaskSnapshot, String> {
    let mut runtime = shared
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    let task = runtime
        .git_tasks
        .get_mut(workspace_id)
        .ok_or_else(|| "git task not found".to_string())?;
    if let Some(error) = error {
        task.snapshot.output.push_str(&format!("\n{error}\n"));
        trim_task_output(&mut task.snapshot.output);
        task.snapshot.status = GitTaskStatus::Failed;
    } else if exit_code.unwrap_or(1) == 0 {
        task.snapshot.status = GitTaskStatus::Succeeded;
    } else {
        task.snapshot.status = GitTaskStatus::Failed;
    }
    task.snapshot.can_write_input = false;
    task.snapshot.exit_code = exit_code;
    task.snapshot.finished_at = Some(now_timestamp_ms());
    task.writer = None;
    Ok(task.snapshot.clone())
}

fn load_untracked_diff(repo_root: &Path, path: &str) -> Result<String, String> {
    let absolute = repo_root.join(path);
    if !absolute.exists() {
        return Ok(String::new());
    }
    let output = ProcessCommand::new("git")
        .args(["diff", "--no-index", "--", "/dev/null"])
        .arg(&absolute)
        .current_dir(repo_root)
        .output()
        .map_err(|error| format!("failed to run git diff --no-index: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

fn load_branches(repo_root: &Path, remotes: bool) -> Result<Vec<GitBranchSnapshot>, String> {
    let refs = if remotes { "refs/remotes" } else { "refs/heads" };
    let output = run_git_capture(
        repo_root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(objectname:short)%00%(subject)%00%(committerdate:relative)%00%(HEAD)",
            refs,
        ],
    )?;

    let mut branches = Vec::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let parts = line.split('\0').collect::<Vec<_>>();
        if parts.len() < 7 {
            continue;
        }
        let full_name = parts[0].to_string();
        let name = parts[1].to_string();
        if remotes && name.ends_with("/HEAD") {
            continue;
        }
        branches.push(GitBranchSnapshot {
            name,
            full_name,
            upstream: normalize_optional_text(parts[2]),
            short_oid: parts[3].to_string(),
            subject: parts[4].to_string(),
            relative_date: parts[5].to_string(),
            is_current: parts[6].trim() == "*",
            is_remote: remotes,
        });
    }

    Ok(branches)
}

fn load_graph_page(repo_root: &Path, skip: usize) -> Result<GitGraphSnapshot, String> {
    let output = run_git_capture(
        repo_root,
        &[
            "log",
            "--graph",
            "--decorate=short",
            "--date=relative",
            "--all",
            &format!("--max-count={GRAPH_PAGE_SIZE}"),
            &format!("--skip={skip}"),
            "--format=format:%x1e%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1f%D",
        ],
    )?;

    let commits = output
        .lines()
        .filter_map(parse_graph_commit_line)
        .collect::<Vec<_>>();

    let next_cursor = if commits.len() >= GRAPH_PAGE_SIZE {
        Some((skip + commits.len()).to_string())
    } else {
        None
    };

    Ok(GitGraphSnapshot { commits, next_cursor })
}

fn parse_graph_commit_line(line: &str) -> Option<GitGraphCommitSnapshot> {
    let marker_index = line.find('\u{001e}')?;
    let graph_prefix = line[..marker_index].to_string();
    let payload = &line[marker_index + 1..];
    let mut parts = payload.splitn(6, '\u{001f}');
    let oid = parts.next()?.to_string();
    let short_oid = parts.next()?.to_string();
    let author = parts.next()?.to_string();
    let relative_date = parts.next()?.to_string();
    let subject = parts.next()?.to_string();
    let refs = parts
        .next()
        .map(parse_git_refs)
        .unwrap_or_default();

    Some(GitGraphCommitSnapshot {
        oid,
        short_oid,
        subject,
        author,
        relative_date,
        graph_prefix,
        refs,
    })
}

fn parse_commit_detail(output: &str) -> Result<GitCommitDetailSnapshot, String> {
    let mut lines = output.lines();
    let header = lines
        .next()
        .ok_or_else(|| "missing commit detail header".to_string())?;
    let parts = header.split('\u{001f}').collect::<Vec<_>>();
    if parts.len() < 9 {
        return Err("invalid commit detail payload".to_string());
    }

    let files = lines
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut status_parts = line.splitn(3, '\t');
            let status = status_parts.next()?.trim().to_string();
            let path = status_parts.next()?.trim().to_string();
            let original_path = status_parts.next().map(|value| value.trim().to_string());
            Some(GitCommitFileSnapshot {
                status,
                path,
                original_path,
            })
        })
        .collect::<Vec<_>>();

    Ok(GitCommitDetailSnapshot {
        oid: parts[0].to_string(),
        short_oid: parts[1].to_string(),
        author: parts[2].to_string(),
        email: parts[3].to_string(),
        relative_date: parts[4].to_string(),
        subject: parts[5].to_string(),
        body: parts[6].trim().to_string(),
        parents: parts[7]
            .split_whitespace()
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
            .collect(),
        refs: parse_git_refs(parts[8]),
        files,
    })
}

fn parse_git_refs(raw: &str) -> Vec<GitRefLabelSnapshot> {
    raw.split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .flat_map(|entry| {
            if let Some(branch) = entry.strip_prefix("HEAD -> ") {
                vec![
                    GitRefLabelSnapshot {
                        label: "HEAD".to_string(),
                        kind: GitRefKind::Head,
                    },
                    GitRefLabelSnapshot {
                        label: branch.to_string(),
                        kind: GitRefKind::LocalBranch,
                    },
                ]
            } else if let Some(tag) = entry.strip_prefix("tag: ") {
                vec![GitRefLabelSnapshot {
                    label: tag.to_string(),
                    kind: GitRefKind::Tag,
                }]
            } else {
                vec![GitRefLabelSnapshot {
                    label: entry.to_string(),
                    kind: classify_ref(entry),
                }]
            }
        })
        .collect()
}

fn classify_ref(raw: &str) -> GitRefKind {
    if raw == "HEAD" {
        GitRefKind::Head
    } else if raw.contains('/') {
        GitRefKind::RemoteBranch
    } else {
        GitRefKind::LocalBranch
    }
}

fn workspace_repo_root(runtime: &RuntimeState, workspace_id: &str) -> Result<PathBuf, String> {
    let workspace = runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let detail = collect_git_detail(Path::new(&workspace.path));
    detail
        .repo_root
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| detail.summary.message.unwrap_or_else(|| "repository not found".to_string()))
}

fn refresh_workspace_cache(runtime: &mut RuntimeState, workspace_id: &str) -> Result<(), String> {
    let workspace_index = runtime
        .workspaces
        .iter()
        .position(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let workspace_path = PathBuf::from(runtime.workspaces[workspace_index].path.clone());
    runtime.workspaces[workspace_index].git = Some(collect_git_detail(&workspace_path));
    Ok(())
}

fn run_git_capture(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    run_git_command("git", repo_root, args).map_err(|error| error.message)
}

fn run_git_strings(repo_root: &Path, args: &[String]) -> Result<String, String> {
    let mut command = ProcessCommand::new("git");
    command.current_dir(repo_root);
    command.args(args);
    let output = command
        .output()
        .map_err(|error| format!("failed to run git {}: {error}", args.join(" ")))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("git {} failed with status {}", args.join(" "), output.status))
        } else {
            Err(stderr)
        }
    }
}

fn strip_tooling_env(command: &mut CommandBuilder) {
    for (key, _) in env::vars_os() {
        let key = key.to_string_lossy();
        if key.starts_with("npm_") || key.starts_with("NPM_") {
            command.env_remove(key.as_ref());
        }
    }
}

fn trim_task_output(output: &mut String) {
    if output.len() <= MAX_GIT_TASK_OUTPUT_BYTES {
        return;
    }

    let target = output.len() - MAX_GIT_TASK_OUTPUT_BYTES;
    let mut cut_index = 0;
    for (index, _) in output.char_indices() {
        if index >= target {
            cut_index = index;
            break;
        }
    }
    output.drain(..cut_index);
}

fn truncate_git_output(output: &str, max_bytes: usize) -> (String, bool) {
    if output.len() <= max_bytes {
        return (output.to_string(), false);
    }

    let mut truncated = String::new();
    for ch in output.chars() {
        if truncated.len() + ch.len_utf8() > max_bytes {
            break;
        }
        truncated.push(ch);
    }
    truncated.push_str("\n\n[diff truncated]");
    (truncated, true)
}

fn now_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_optional_text(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
