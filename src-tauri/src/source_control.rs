use std::{
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Command as ProcessCommand,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    collect_git_detail,
    events::{emit_runtime_event, emit_snapshot, RuntimeEvent},
    run_git_command, validate_git_cli_arg, AppSnapshot, GitFileSnapshot, GitState,
    GitSummarySnapshot, RuntimeState,
};

const GRAPH_PAGE_SIZE: usize = 120;
const MAX_GIT_TASK_OUTPUT_BYTES: usize = 96 * 1024;
const MAX_GIT_DIFF_BYTES: usize = 256 * 1024;
const MAX_COMMIT_MESSAGE_CONTEXT_BYTES: usize = 48 * 1024;
const DEFAULT_OPENAI_MODEL: &str = "gpt-5-mini";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";

pub(crate) struct CommitMessageGenerationRequest {
    api_key: String,
    model: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct GeneratedCommitMessagePayload {
    message: String,
}

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
    pub(crate) remotes: Vec<GitRemoteSnapshot>,
    pub(crate) default_remote: Option<String>,
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRemoteSnapshot {
    pub(crate) name: String,
    pub(crate) is_default: bool,
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
    pub(crate) recovery: Option<GitTaskRecoverySnapshot>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitTaskStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitTaskRecoverySnapshot {
    pub(crate) kind: GitTaskRecoveryKind,
    pub(crate) branch_name: String,
    pub(crate) remotes: Vec<GitRemoteSnapshot>,
    pub(crate) default_remote: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitTaskRecoveryKind {
    PublishBranch,
}

pub(crate) struct GitTaskRecord {
    pub(crate) snapshot: GitTaskSnapshot,
    pub(crate) writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    pub(crate) args: Vec<String>,
    pub(crate) repo_root: PathBuf,
}

struct SpawnedGitTaskProcess {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
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

    let (remotes, default_remote, local_branches, remote_branches, graph) =
        if let Some(repo_root) = detail.repo_root.as_deref() {
            let repo_root = PathBuf::from(repo_root);
            let remotes = load_git_remotes(&repo_root).unwrap_or_default();
            (
                remotes.clone(),
                select_default_git_remote(&remotes),
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
                None,
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
        remotes,
        default_remote,
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
        .ok_or_else(|| {
            detail
                .summary
                .message
                .unwrap_or_else(|| "repository not found".to_string())
        })?;
    let file = detail
        .files
        .iter()
        .find(|file| file.path == path)
        .cloned()
        .ok_or_else(|| "file is not part of the current git status".to_string())?;
    let original_path = file.original_path.clone();

    let text = match mode {
        GitDiffMode::Staged => {
            run_git_capture(&repo_root, &["diff", "--cached", "--", &file.path])?
        }
        GitDiffMode::WorkingTree => {
            let diff = run_git_capture(&repo_root, &["diff", "--", &file.path])?;
            if diff.is_empty() {
                load_untracked_diff(&repo_root, &file.path)?
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
    let oid = validate_git_cli_arg(oid.to_string(), "commit id")?;
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
        .ok_or_else(|| {
            detail
                .summary
                .message
                .unwrap_or_else(|| "repository not found".to_string())
        })?;

    let output = run_git_capture(
        &repo_root,
        &[
            "show",
            "-z",
            "--format=%H%x00%h%x00%an%x00%ae%x00%ar%x00%s%x00%b%x00%P%x00%D%x00",
            "--name-status",
            "--no-color",
            &oid,
        ],
    )?;
    parse_commit_detail(&output)
}

pub(crate) fn build_commit_message_generation_request(
    runtime: &RuntimeState,
    workspace_id: &str,
) -> Result<CommitMessageGenerationRequest, String> {
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
        .ok_or_else(|| {
            detail
                .summary
                .message
                .unwrap_or_else(|| "repository not found".to_string())
        })?;

    let use_staged_scope = detail.summary.counts.staged > 0;
    let scoped_files: Vec<GitFileSnapshot> = detail
        .files
        .iter()
        .filter(|file| file_matches_commit_generation_scope(file, use_staged_scope))
        .cloned()
        .collect();

    if scoped_files.is_empty() {
        return Err(
            "No Git changes are available to summarize. Stage files first or make working tree changes."
                .to_string(),
        );
    }

    let file_summary = scoped_files
        .iter()
        .map(format_commit_generation_file_line)
        .collect::<Vec<_>>()
        .join("\n");
    let diff_stat = build_commit_generation_diff_stat(&repo_root, &scoped_files, use_staged_scope)?;
    let diff_patch = build_commit_generation_patch(&repo_root, &scoped_files, use_staged_scope)?;
    let (diff_patch, _) = truncate_git_output(&diff_patch, MAX_COMMIT_MESSAGE_CONTEXT_BYTES);
    let scope_label = if use_staged_scope {
        "staged changes only"
    } else {
        "all pending changes"
    };
    let branch = detail.summary.branch.as_deref().unwrap_or("(detached)");
    let upstream = detail.summary.upstream.as_deref().unwrap_or("none");
    let workspace_relative_path = detail.workspace_relative_path.as_deref().unwrap_or(".");

    let prompt = format!(
        concat!(
            "Generate a concise Git commit message for this repository state.\n\n",
            "Respond with a JSON object containing exactly one key named \"message\".\n\n",
            "Repository path: {repo_root}\n",
            "Workspace scope: {workspace_relative_path}\n",
            "Branch: {branch}\n",
            "Upstream: {upstream}\n",
            "Commit scope: {scope_label}\n\n",
            "Changed files:\n{file_summary}\n\n",
            "Diff stat:\n{diff_stat}\n\n",
            "Patch excerpt:\n{diff_patch}\n"
        ),
        repo_root = repo_root.display(),
        workspace_relative_path = workspace_relative_path,
        branch = branch,
        upstream = upstream,
        scope_label = scope_label,
        file_summary = file_summary,
        diff_stat = if diff_stat.trim().is_empty() {
            "(no diff stat available)"
        } else {
            diff_stat.trim()
        },
        diff_patch = if diff_patch.trim().is_empty() {
            "(no patch available)"
        } else {
            diff_patch.trim()
        },
    );

    Ok(CommitMessageGenerationRequest {
        api_key: runtime
            .settings
            .openai_api_key
            .clone()
            .or_else(|| {
                env::var("OPENAI_API_KEY")
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
            .ok_or_else(|| {
                "Set an OpenAI API key in Settings or via OPENAI_API_KEY to enable AI commit message generation."
                    .to_string()
            })?,
        model: env::var("CREWDOCK_OPENAI_MODEL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string()),
        prompt,
    })
}

pub(crate) async fn generate_commit_message_with_openai(
    request: CommitMessageGenerationRequest,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut builder = client
        .post(OPENAI_RESPONSES_URL)
        .bearer_auth(&request.api_key)
        .header("Content-Type", "application/json");

    if let Ok(project) = env::var("OPENAI_PROJECT").map(|value| value.trim().to_string()) {
        if !project.is_empty() {
            builder = builder.header("OpenAI-Project", project);
        }
    }

    if let Ok(organization) = env::var("OPENAI_ORGANIZATION").map(|value| value.trim().to_string())
    {
        if !organization.is_empty() {
            builder = builder.header("OpenAI-Organization", organization);
        }
    }

    let response = builder
        .json(&serde_json::json!({
            "model": request.model,
            "instructions": concat!(
                "You write Git commit messages for a desktop developer tool. ",
                "Return JSON with exactly one key named \"message\". ",
                "Use imperative mood. Prefer a single subject line under 72 characters. ",
                "Only include a blank line and up to two body bullet lines if the diff clearly spans multiple concerns. ",
                "Do not use markdown fences, quotes, or commentary outside the JSON object."
            ),
            "text": {
                "format": {
                    "type": "json_object"
                }
            },
            "input": request.prompt
        }))
        .send()
        .await
        .map_err(|error| format!("failed to reach OpenAI: {error}"))?;

    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("failed to decode OpenAI response: {error}"))?;

    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("OpenAI request failed with status {status}"));
        return Err(message);
    }

    let raw_text = extract_openai_response_text(&payload)
        .ok_or_else(|| "OpenAI did not return commit message text.".to_string())?;
    let parsed: GeneratedCommitMessagePayload = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("failed to parse AI commit message payload: {error}"))?;
    let message = parsed.message.trim();
    if message.is_empty() {
        return Err("OpenAI returned an empty commit message.".to_string());
    }

    Ok(message.to_string())
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
        let target = resolve_repo_relative_existing_path(&repo_root, &path)?;
        if target.is_dir() {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("failed to remove {path}: {error}"))?;
        } else if target.exists() {
            fs::remove_file(&target)
                .map_err(|error| format!("failed to remove {path}: {error}"))?;
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
    let spawned = spawn_git_task_process(&repo_root, &args)?;
    let mut child = spawned.child;
    let reader = spawned.reader;
    let writer = Arc::new(Mutex::new(spawned.writer));

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
            recovery: None,
        };
        runtime.git_tasks.insert(
            workspace_id.clone(),
            GitTaskRecord {
                snapshot: task_snapshot.clone(),
                writer: Some(writer.clone()),
                args: args.clone(),
                repo_root: repo_root.clone(),
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

fn spawn_git_task_process(
    repo_root: &Path,
    args: &[String],
) -> Result<SpawnedGitTaskProcess, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open git task PTY: {error}"))?;
    let mut command = CommandBuilder::new("git");
    for arg in args {
        command.arg(arg);
    }
    command.cwd(repo_root);
    strip_tooling_env(&mut command);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
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

    Ok(SpawnedGitTaskProcess {
        child,
        reader,
        writer,
    })
}

#[cfg(test)]
fn run_git_task_blocking(
    repo_root: &Path,
    title: &str,
    args: &[String],
    stdin: Option<&str>,
) -> Result<GitTaskSnapshot, String> {
    let started_at = now_timestamp_ms();
    let mut spawned = spawn_git_task_process(repo_root, args)?;
    if let Some(stdin) = stdin {
        spawned
            .writer
            .write_all(stdin.as_bytes())
            .map_err(|error| format!("failed to write git task input: {error}"))?;
        spawned
            .writer
            .flush()
            .map_err(|error| format!("failed to flush git task input: {error}"))?;
    }
    drop(spawned.writer);

    let mut raw_output = Vec::new();
    spawned
        .reader
        .read_to_end(&mut raw_output)
        .map_err(|error| format!("failed to read git task output: {error}"))?;
    let mut output = String::from_utf8_lossy(&raw_output).into_owned();
    trim_task_output(&mut output);

    let status = spawned
        .child
        .wait()
        .map_err(|error| format!("failed to wait for git task: {error}"))?;
    let exit_code = i32::try_from(status.exit_code()).ok();
    let task_status = if exit_code == Some(0) {
        GitTaskStatus::Succeeded
    } else {
        GitTaskStatus::Failed
    };

    Ok(GitTaskSnapshot {
        id: "test-task".to_string(),
        title: title.to_string(),
        command: format!("git {}", args.join(" ")),
        status: task_status,
        output,
        can_write_input: false,
        started_at,
        finished_at: Some(now_timestamp_ms()),
        exit_code,
        recovery: classify_git_task_recovery(repo_root, args, task_status),
    })
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
                if let Ok(task) =
                    finish_git_task(&shared, &workspace_id, Some(error.to_string()), None)
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
            finish_git_task(&shared, &workspace_id, None, exit_code)
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
    let (repo_root, args, status) = {
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
        task.snapshot.recovery = None;
        task.writer = None;
        (
            task.repo_root.clone(),
            task.args.clone(),
            task.snapshot.status,
        )
    };

    let recovery = classify_git_task_recovery(&repo_root, &args, status);

    let mut runtime = shared
        .lock()
        .map_err(|_| "failed to acquire application state".to_string())?;
    let task = runtime
        .git_tasks
        .get_mut(workspace_id)
        .ok_or_else(|| "git task not found".to_string())?;
    task.snapshot.recovery = recovery;
    Ok(task.snapshot.clone())
}

fn classify_git_task_recovery(
    repo_root: &Path,
    args: &[String],
    status: GitTaskStatus,
) -> Option<GitTaskRecoverySnapshot> {
    if status != GitTaskStatus::Failed || args.len() != 1 || args[0] != "push" {
        return None;
    }

    let detail = collect_git_detail(repo_root);
    if detail.summary.state == GitState::Detached || detail.summary.upstream.is_some() {
        return None;
    }

    let branch_name = detail.summary.branch?.trim().to_string();
    if branch_name.is_empty() {
        return None;
    }

    let remotes = load_git_remotes(repo_root).unwrap_or_default();
    Some(GitTaskRecoverySnapshot {
        kind: GitTaskRecoveryKind::PublishBranch,
        branch_name,
        default_remote: select_default_git_remote(&remotes),
        remotes,
    })
}

fn load_untracked_diff(repo_root: &Path, path: &str) -> Result<String, String> {
    let absolute = resolve_repo_relative_existing_path(repo_root, path)?;
    if !absolute.exists() {
        return Ok(String::new());
    }
    let output = ProcessCommand::new("git")
        .args(["diff", "--no-index", "--", "/dev/null"])
        .arg(path)
        .current_dir(repo_root)
        .output()
        .map_err(|error| format!("failed to run git diff --no-index: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

fn load_branches(repo_root: &Path, remotes: bool) -> Result<Vec<GitBranchSnapshot>, String> {
    let refs = if remotes {
        "refs/remotes"
    } else {
        "refs/heads"
    };
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

pub(crate) fn load_git_remotes(repo_root: &Path) -> Result<Vec<GitRemoteSnapshot>, String> {
    let output = run_git_command("git", repo_root, &["remote"]).map_err(|error| error.message)?;
    let remote_names = output
        .lines()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let default_remote = remote_names
        .iter()
        .find(|name| name.as_str() == "origin")
        .cloned()
        .or_else(|| remote_names.first().cloned());

    Ok(remote_names
        .into_iter()
        .map(|name| GitRemoteSnapshot {
            is_default: default_remote.as_deref() == Some(name.as_str()),
            name,
        })
        .collect())
}

pub(crate) fn select_default_git_remote(remotes: &[GitRemoteSnapshot]) -> Option<String> {
    remotes
        .iter()
        .find(|remote| remote.is_default)
        .or_else(|| remotes.first())
        .map(|remote| remote.name.clone())
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

    Ok(GitGraphSnapshot {
        commits,
        next_cursor,
    })
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
    let refs = parts.next().map(parse_git_refs).unwrap_or_default();

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
    let mut parts = output.split('\0');
    let oid = parts
        .next()
        .ok_or_else(|| "missing commit detail header".to_string())?;
    let short_oid = parts
        .next()
        .ok_or_else(|| "missing commit short oid".to_string())?;
    let author = parts
        .next()
        .ok_or_else(|| "missing commit author".to_string())?;
    let email = parts
        .next()
        .ok_or_else(|| "missing commit email".to_string())?;
    let relative_date = parts
        .next()
        .ok_or_else(|| "missing commit relative date".to_string())?;
    let subject = parts
        .next()
        .ok_or_else(|| "missing commit subject".to_string())?;
    let body = parts
        .next()
        .ok_or_else(|| "missing commit body".to_string())?;
    let parents = parts
        .next()
        .ok_or_else(|| "missing commit parents".to_string())?;
    let refs = parts
        .next()
        .ok_or_else(|| "missing commit refs".to_string())?;

    if oid.is_empty() || short_oid.is_empty() {
        return Err("invalid commit detail payload".to_string());
    }

    let file_tokens = parts.collect::<Vec<_>>();
    let files = parse_commit_files(&file_tokens)?;

    Ok(GitCommitDetailSnapshot {
        oid: oid.to_string(),
        short_oid: short_oid.to_string(),
        author: author.to_string(),
        email: email.to_string(),
        relative_date: relative_date.to_string(),
        subject: subject.to_string(),
        body: body.trim().to_string(),
        parents: parents
            .split_whitespace()
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
            .collect(),
        refs: parse_git_refs(refs),
        files,
    })
}

fn parse_commit_files(tokens: &[&str]) -> Result<Vec<GitCommitFileSnapshot>, String> {
    let mut files = Vec::new();
    let mut index = 0;

    while index < tokens.len() {
        let status = tokens[index].trim();
        if status.is_empty() {
            index += 1;
            continue;
        }

        if status.starts_with('R') || status.starts_with('C') {
            let original_path = tokens
                .get(index + 1)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("missing original path for commit status {status}"))?;
            let path = tokens
                .get(index + 2)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("missing path for commit status {status}"))?;
            files.push(GitCommitFileSnapshot {
                status: status.to_string(),
                path: path.to_string(),
                original_path: Some(original_path.to_string()),
            });
            index += 3;
            continue;
        }

        let path = tokens
            .get(index + 1)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("missing path for commit status {status}"))?;
        files.push(GitCommitFileSnapshot {
            status: status.to_string(),
            path: path.to_string(),
            original_path: None,
        });
        index += 2;
    }

    Ok(files)
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
        .ok_or_else(|| {
            detail
                .summary
                .message
                .unwrap_or_else(|| "repository not found".to_string())
        })
}

fn resolve_repo_relative_existing_path(repo_root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    if relative.is_absolute() {
        return Err("invalid file path".to_string());
    }
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("invalid file path".to_string());
    }

    let absolute = repo_root.join(relative);
    let repo_root = repo_root
        .canonicalize()
        .map_err(|error| format!("failed to resolve repository root: {error}"))?;
    let absolute = absolute
        .canonicalize()
        .map_err(|error| format!("failed to resolve file path: {error}"))?;

    if !absolute.starts_with(&repo_root) {
        return Err("invalid file path".to_string());
    }

    Ok(absolute)
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

fn file_matches_commit_generation_scope(file: &GitFileSnapshot, use_staged_scope: bool) -> bool {
    if use_staged_scope {
        file.index_status.is_some()
    } else {
        true
    }
}

fn build_commit_generation_diff_stat(
    repo_root: &Path,
    files: &[GitFileSnapshot],
    use_staged_scope: bool,
) -> Result<String, String> {
    let tracked_paths = files
        .iter()
        .filter(|file| file.kind != crate::GitFileKind::Untracked)
        .map(|file| file.path.as_str())
        .collect::<Vec<_>>();
    if tracked_paths.is_empty() {
        return Ok(String::new());
    }

    let mut args = vec!["diff"];
    if use_staged_scope {
        args.push("--cached");
    }
    args.push("--stat=160,120");
    args.push("--no-color");
    args.push("--");
    args.extend(tracked_paths.iter().copied());

    run_git_capture(repo_root, &args)
}

fn build_commit_generation_patch(
    repo_root: &Path,
    files: &[GitFileSnapshot],
    use_staged_scope: bool,
) -> Result<String, String> {
    let tracked_paths = files
        .iter()
        .filter(|file| file.kind != crate::GitFileKind::Untracked)
        .map(|file| file.path.as_str())
        .collect::<Vec<_>>();
    let mut sections = Vec::new();

    if !tracked_paths.is_empty() {
        let mut args = vec!["diff"];
        if use_staged_scope {
            args.push("--cached");
        }
        args.push("--no-color");
        args.push("--");
        args.extend(tracked_paths.iter().copied());
        let diff = run_git_capture(repo_root, &args)?;
        if !diff.trim().is_empty() {
            sections.push(diff);
        }
    }

    if !use_staged_scope {
        for file in files
            .iter()
            .filter(|file| file.kind == crate::GitFileKind::Untracked)
        {
            let diff = load_untracked_diff(repo_root, &file.path)?;
            if !diff.trim().is_empty() {
                sections.push(diff);
            }
        }
    }

    Ok(sections.join("\n\n"))
}

fn format_commit_generation_file_line(file: &GitFileSnapshot) -> String {
    let mut details = Vec::new();
    if let Some(index_status) = file.index_status {
        details.push(format!("index {}", git_file_status_label(index_status)));
    }
    if let Some(worktree_status) = file.worktree_status {
        details.push(format!(
            "worktree {}",
            git_file_status_label(worktree_status)
        ));
    }

    let suffix = if details.is_empty() {
        String::new()
    } else {
        format!(" ({})", details.join(", "))
    };

    match file.original_path.as_deref() {
        Some(original_path) => format!("- {} -> {}{}", original_path, file.path, suffix),
        None => format!("- {}{}", file.path, suffix),
    }
}

fn git_file_status_label(status: crate::GitFileStatus) -> &'static str {
    match status {
        crate::GitFileStatus::Added => "added",
        crate::GitFileStatus::Modified => "modified",
        crate::GitFileStatus::Deleted => "deleted",
        crate::GitFileStatus::Renamed => "renamed",
        crate::GitFileStatus::Copied => "copied",
        crate::GitFileStatus::TypeChanged => "type changed",
        crate::GitFileStatus::Unmerged => "unmerged",
    }
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
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!(
                "git {} failed with status {}",
                args.join(" "),
                output.status
            ))
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

fn extract_openai_response_text(payload: &serde_json::Value) -> Option<String> {
    if let Some(output_text) = payload
        .get("output_text")
        .and_then(serde_json::Value::as_str)
    {
        let trimmed = output_text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    payload
        .get("output")
        .and_then(serde_json::Value::as_array)
        .and_then(|items| {
            let mut parts = Vec::new();
            for item in items {
                let Some(content) = item.get("content").and_then(serde_json::Value::as_array)
                else {
                    continue;
                };
                for chunk in content {
                    let Some(text) = chunk.get("text").and_then(serde_json::Value::as_str) else {
                        continue;
                    };
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        parts.push(trimmed.to_string());
                    }
                }
            }

            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        build_commit_message_generation_request, extract_openai_response_text, load_git_remotes,
        parse_commit_detail, resolve_repo_relative_existing_path, run_git_task_blocking,
        select_default_git_remote, GitTaskRecoveryKind, GitTaskStatus,
    };

    #[test]
    fn parse_commit_detail_supports_multiline_body_and_renames() {
        let payload = concat!(
            "0123456789abcdef0123456789abcdef01234567\0",
            "0123456\0",
            "Ash\0",
            "ash@example.com\0",
            "2 hours ago\0",
            "Refine source control\0",
            "body line 1\nbody line 2\n\0",
            "parent-a parent-b\0",
            "HEAD -> main, origin/main\0",
            "\0",
            "M\0",
            "src-tauri/src/lib.rs\0",
            "R100\0",
            "src/old-name.rs\0",
            "src/new-name.rs\0",
        );

        let snapshot = parse_commit_detail(payload).expect("commit detail should parse");
        assert_eq!(snapshot.subject, "Refine source control");
        assert_eq!(snapshot.body, "body line 1\nbody line 2");
        assert_eq!(snapshot.parents, vec!["parent-a", "parent-b"]);
        assert_eq!(snapshot.refs.len(), 3);
        assert_eq!(snapshot.files.len(), 2);
        assert_eq!(snapshot.files[0].status, "M");
        assert_eq!(snapshot.files[0].path, "src-tauri/src/lib.rs");
        assert_eq!(snapshot.files[1].status, "R100");
        assert_eq!(snapshot.files[1].path, "src/new-name.rs");
        assert_eq!(
            snapshot.files[1].original_path.as_deref(),
            Some("src/old-name.rs")
        );
    }

    #[test]
    fn resolve_repo_relative_existing_path_rejects_escape_attempts() {
        let root = unique_temp_dir("path-validation");
        let nested = root.join("src");
        let inside = nested.join("tracked.txt");
        let outside = root
            .parent()
            .expect("temp dir should have a parent")
            .join("outside-secret.txt");

        fs::create_dir_all(&nested).expect("nested repo dir should exist");
        fs::write(&inside, "tracked").expect("inside file should be written");
        fs::write(&outside, "secret").expect("outside file should be written");

        let resolved = resolve_repo_relative_existing_path(&root, "src/tracked.txt")
            .expect("repo file should resolve");
        assert_eq!(resolved, inside.canonicalize().unwrap());
        assert!(resolve_repo_relative_existing_path(&root, "../outside-secret.txt").is_err());
        assert!(resolve_repo_relative_existing_path(&root, outside.to_str().unwrap()).is_err());

        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn git_task_blocking_supports_branch_rename_and_delete() {
        let repo = init_test_repo("branch-flow");

        let checkout = run_git_task_blocking(
            &repo,
            "Checkout",
            &[
                "checkout".to_string(),
                "-b".to_string(),
                "feature/one".to_string(),
            ],
            None,
        )
        .expect("branch create should run");
        assert_eq!(checkout.status, GitTaskStatus::Succeeded);

        fs::write(repo.join("feature.txt"), "feature branch work\n")
            .expect("branch file should be written");
        run_git(&repo, &["add", "feature.txt"]);
        run_git(&repo, &["commit", "-m", "feature work"]);

        let rename = run_git_task_blocking(
            &repo,
            "Rename",
            &[
                "branch".to_string(),
                "-m".to_string(),
                "feature/one".to_string(),
                "feature/two".to_string(),
            ],
            None,
        )
        .expect("branch rename should run");
        assert_eq!(rename.status, GitTaskStatus::Succeeded);

        let checkout_main = run_git_task_blocking(
            &repo,
            "Checkout main",
            &["checkout".to_string(), "main".to_string()],
            None,
        )
        .expect("checkout main should run");
        assert_eq!(checkout_main.status, GitTaskStatus::Succeeded);

        run_git(&repo, &["merge", "--ff-only", "feature/two"]);

        let delete = run_git_task_blocking(
            &repo,
            "Delete",
            &[
                "branch".to_string(),
                "-d".to_string(),
                "feature/two".to_string(),
            ],
            None,
        )
        .expect("branch delete should run");
        assert_eq!(delete.status, GitTaskStatus::Succeeded);

        let branches = git_output(&repo, &["branch"]);
        assert!(branches.contains("main"));
        assert!(!branches.contains("feature/two"));

        let _ = fs::remove_dir_all(repo.parent().unwrap());
    }

    #[test]
    fn git_task_blocking_supports_publish_fetch_and_pull() {
        let root = unique_temp_dir("sync-flow");
        let remote = root.join("remote.git");
        let primary = root.join("primary");
        let secondary = root.join("secondary");

        let init_remote = Command::new("git")
            .args([
                "init",
                "--bare",
                "--initial-branch=main",
                remote.to_str().expect("remote path should be utf-8"),
            ])
            .current_dir(&root)
            .output()
            .expect("bare remote should start");
        assert!(
            init_remote.status.success(),
            "git init --bare failed: {}",
            String::from_utf8_lossy(&init_remote.stderr)
        );

        fs::create_dir_all(&primary).expect("primary repo dir should exist");
        configure_repo(&primary);
        fs::write(primary.join("README.md"), "initial\n").expect("initial file should be written");
        run_git(&primary, &["add", "README.md"]);
        run_git(&primary, &["commit", "-m", "initial"]);
        run_git(
            &primary,
            &[
                "remote",
                "add",
                "origin",
                remote.to_str().expect("remote path should be utf-8"),
            ],
        );
        run_git(&primary, &["push", "-u", "origin", "main"]);

        let clone = Command::new("git")
            .args([
                "clone",
                remote.to_str().expect("remote path should be utf-8"),
                secondary.to_str().expect("secondary path should be utf-8"),
            ])
            .current_dir(&root)
            .output()
            .expect("clone should start");
        assert!(
            clone.status.success(),
            "git clone failed: {}",
            String::from_utf8_lossy(&clone.stderr)
        );
        run_git(&secondary, &["config", "user.name", "CrewDock Test"]);
        run_git(&secondary, &["config", "user.email", "test@crewdock.dev"]);

        let checkout = run_git_task_blocking(
            &secondary,
            "Checkout feature",
            &[
                "checkout".to_string(),
                "-b".to_string(),
                "feature/sync".to_string(),
            ],
            None,
        )
        .expect("feature checkout should run");
        assert_eq!(checkout.status, GitTaskStatus::Succeeded);

        fs::write(secondary.join("feature.txt"), "secondary feature\n")
            .expect("feature file should be written");
        run_git(&secondary, &["add", "feature.txt"]);
        run_git(&secondary, &["commit", "-m", "feature commit"]);

        let publish = run_git_task_blocking(
            &secondary,
            "Publish",
            &[
                "push".to_string(),
                "--set-upstream".to_string(),
                "origin".to_string(),
                "feature/sync".to_string(),
            ],
            None,
        )
        .expect("feature publish should run");
        assert_eq!(publish.status, GitTaskStatus::Succeeded);

        let fetch = run_git_task_blocking(
            &primary,
            "Fetch",
            &[
                "fetch".to_string(),
                "--all".to_string(),
                "--prune".to_string(),
            ],
            None,
        )
        .expect("fetch should run");
        assert_eq!(fetch.status, GitTaskStatus::Succeeded);
        let remote_branches = git_output(&primary, &["branch", "-r"]);
        assert!(remote_branches.contains("origin/feature/sync"));

        fs::write(primary.join("README.md"), "updated on main\n")
            .expect("updated main file should be written");
        run_git(&primary, &["add", "README.md"]);
        run_git(&primary, &["commit", "-m", "main update"]);
        run_git(&primary, &["push"]);

        let checkout_main = run_git_task_blocking(
            &secondary,
            "Checkout main",
            &["checkout".to_string(), "main".to_string()],
            None,
        )
        .expect("checkout main should run");
        assert_eq!(checkout_main.status, GitTaskStatus::Succeeded);

        let pull = run_git_task_blocking(&secondary, "Pull", &["pull".to_string()], None)
            .expect("pull should run");
        assert_eq!(pull.status, GitTaskStatus::Succeeded);
        assert_eq!(
            fs::read_to_string(secondary.join("README.md")).expect("pulled file should exist"),
            "updated on main\n"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn load_git_remotes_marks_origin_as_default() {
        let repo = init_test_repo("remote-list");
        run_git(
            &repo,
            &[
                "remote",
                "add",
                "upstream",
                "https://example.com/upstream.git",
            ],
        );
        run_git(
            &repo,
            &["remote", "add", "origin", "https://example.com/origin.git"],
        );

        let remotes = load_git_remotes(&repo).expect("git remotes should load");
        assert_eq!(remotes.len(), 2);
        assert_eq!(
            select_default_git_remote(&remotes).as_deref(),
            Some("origin")
        );
        assert!(remotes
            .iter()
            .any(|remote| remote.name == "origin" && remote.is_default));

        let _ = fs::remove_dir_all(repo.parent().unwrap());
    }

    #[test]
    fn git_task_blocking_adds_publish_recovery_for_unpublished_pushes() {
        let root = unique_temp_dir("publish-recovery");
        let remote = root.join("remote.git");
        let repo = root.join("repo");

        let init_remote = Command::new("git")
            .args([
                "init",
                "--bare",
                "--initial-branch=main",
                remote.to_str().expect("remote path should be utf-8"),
            ])
            .current_dir(&root)
            .output()
            .expect("bare remote should start");
        assert!(
            init_remote.status.success(),
            "git init --bare failed: {}",
            String::from_utf8_lossy(&init_remote.stderr)
        );

        fs::create_dir_all(&repo).expect("repo dir should exist");
        configure_repo(&repo);
        fs::write(repo.join("README.md"), "initial\n").expect("initial file should be written");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);
        run_git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                remote.to_str().expect("remote path should be utf-8"),
            ],
        );
        run_git(&repo, &["push", "-u", "origin", "main"]);
        run_git(&repo, &["checkout", "-b", "feature/publish-me"]);
        fs::write(repo.join("feature.txt"), "publish me\n").expect("feature file should exist");
        run_git(&repo, &["add", "feature.txt"]);
        run_git(&repo, &["commit", "-m", "feature work"]);

        let push = run_git_task_blocking(&repo, "Push", &["push".to_string()], None)
            .expect("push should run");
        assert_eq!(push.status, GitTaskStatus::Failed);

        let recovery = push
            .recovery
            .as_ref()
            .expect("failed unpublished push should offer recovery");
        assert_eq!(recovery.kind, GitTaskRecoveryKind::PublishBranch);
        assert_eq!(recovery.branch_name, "feature/publish-me");
        assert_eq!(recovery.default_remote.as_deref(), Some("origin"));
        assert!(recovery
            .remotes
            .iter()
            .any(|remote| remote.name == "origin" && remote.is_default));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn git_task_blocking_skips_publish_recovery_for_tracked_branch_push_failures() {
        let root = unique_temp_dir("tracked-push-failure");
        let remote = root.join("remote.git");
        let missing_remote = root.join("missing.git");
        let repo = root.join("repo");

        let init_remote = Command::new("git")
            .args([
                "init",
                "--bare",
                "--initial-branch=main",
                remote.to_str().expect("remote path should be utf-8"),
            ])
            .current_dir(&root)
            .output()
            .expect("bare remote should start");
        assert!(
            init_remote.status.success(),
            "git init --bare failed: {}",
            String::from_utf8_lossy(&init_remote.stderr)
        );

        fs::create_dir_all(&repo).expect("repo dir should exist");
        configure_repo(&repo);
        fs::write(repo.join("README.md"), "initial\n").expect("initial file should be written");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);
        run_git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                remote.to_str().expect("remote path should be utf-8"),
            ],
        );
        run_git(&repo, &["push", "-u", "origin", "main"]);
        run_git(&repo, &["checkout", "-b", "feature/tracked"]);
        fs::write(repo.join("tracked.txt"), "tracked\n").expect("tracked file should exist");
        run_git(&repo, &["add", "tracked.txt"]);
        run_git(&repo, &["commit", "-m", "tracked branch"]);
        run_git(
            &repo,
            &["push", "--set-upstream", "origin", "feature/tracked"],
        );

        fs::write(repo.join("tracked.txt"), "tracked again\n").expect("tracked file should exist");
        run_git(&repo, &["add", "tracked.txt"]);
        run_git(&repo, &["commit", "-m", "tracked branch update"]);
        run_git(
            &repo,
            &[
                "remote",
                "set-url",
                "origin",
                missing_remote
                    .to_str()
                    .expect("missing remote path should be utf-8"),
            ],
        );

        let push = run_git_task_blocking(&repo, "Push", &["push".to_string()], None)
            .expect("push should run");
        assert_eq!(push.status, GitTaskStatus::Failed);
        assert!(push.recovery.is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn git_task_blocking_accepts_stdin() {
        let repo = init_test_repo("stdin-flow");
        let snapshot = run_git_task_blocking(
            &repo,
            "Hash stdin",
            &[
                "hash-object".to_string(),
                "-w".to_string(),
                "--stdin".to_string(),
            ],
            Some("hello from crewdock\n"),
        )
        .expect("stdin-backed git command should run");

        assert_eq!(snapshot.status, GitTaskStatus::Succeeded);
        let oid = snapshot
            .output
            .split(|ch: char| !ch.is_ascii_hexdigit())
            .find(|token| token.len() == 40)
            .expect("git hash-object should emit an object id");
        assert_eq!(oid.len(), 40);
        let object = git_output(&repo, &["cat-file", "-p", oid]);
        assert_eq!(object, "hello from crewdock");

        let _ = fs::remove_dir_all(repo.parent().unwrap());
    }

    #[test]
    fn commit_message_generation_prefers_staged_changes() {
        let repo = init_test_repo("commit-message-staged");
        fs::write(repo.join("src-web-app.js"), "console.log('staged');\n")
            .expect("staged file should be written");
        run_git(&repo, &["add", "src-web-app.js"]);
        fs::write(repo.join("notes.txt"), "draft note\n").expect("note file should be written");

        let runtime = runtime_with_workspace(&repo);
        let request = build_commit_message_generation_request(&runtime, "workspace-1")
            .expect("request should build");

        assert!(request.prompt.contains("Commit scope: staged changes only"));
        assert!(request.prompt.contains("src-web-app.js"));
        assert!(!request.prompt.contains("notes.txt"));

        let _ = fs::remove_dir_all(repo.parent().unwrap());
    }

    #[test]
    fn commit_message_generation_includes_untracked_files_when_no_staged_changes() {
        let repo = init_test_repo("commit-message-untracked");
        fs::create_dir_all(repo.join("docs")).expect("docs dir should exist");
        fs::write(repo.join("docs/guide.md"), "# guide\n\nhello\n")
            .expect("guide file should be written");

        let runtime = runtime_with_workspace(&repo);
        let request = build_commit_message_generation_request(&runtime, "workspace-1")
            .expect("request should build");

        assert!(request.prompt.contains("Commit scope: all pending changes"));
        assert!(request.prompt.contains("docs/guide.md"));
        assert!(request.prompt.contains("+++ b/docs/guide.md"));

        let _ = fs::remove_dir_all(repo.parent().unwrap());
    }

    #[test]
    fn extract_openai_response_text_reads_message_content() {
        let payload = serde_json::json!({
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "{\"message\":\"refine source control ui\"}"
                        }
                    ]
                }
            ]
        });

        assert_eq!(
            extract_openai_response_text(&payload).as_deref(),
            Some("{\"message\":\"refine source control ui\"}")
        );
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("crewdock-{label}-{unique}"));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    fn init_test_repo(label: &str) -> PathBuf {
        let root = unique_temp_dir(label);
        let repo = root.join("repo");
        fs::create_dir_all(&repo).expect("repo dir should exist");
        configure_repo(&repo);
        fs::write(repo.join("README.md"), "hello\n").expect("seed file should be written");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);
        repo
    }

    fn configure_repo(repo: &PathBuf) {
        let init = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(repo)
            .output()
            .expect("git init should start");
        assert!(
            init.status.success(),
            "git init failed: {}",
            String::from_utf8_lossy(&init.stderr)
        );
        run_git(repo, &["config", "user.name", "CrewDock Test"]);
        run_git(repo, &["config", "user.email", "test@crewdock.dev"]);
    }

    fn runtime_with_workspace(repo: &PathBuf) -> crate::RuntimeState {
        let mut runtime = crate::RuntimeState::seeded();
        runtime.settings.openai_api_key = Some("sk-test-123".to_string());
        runtime.workspaces.push(crate::WorkspaceRecord {
            id: "workspace-1".to_string(),
            name: "repo".to_string(),
            path: repo.display().to_string(),
            layout: crate::LayoutPreset::new("count-1", "1 terminal".to_string(), 1, 1, 1),
            panes: Vec::new(),
            pane_layout: crate::PaneLayout::Leaf {
                pane_id: "pane-1".to_string(),
            },
            started: true,
            git: None,
        });
        runtime.active_workspace_id = Some("workspace-1".to_string());
        runtime
    }

    fn run_git(cwd: &PathBuf, args: &[&str]) {
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

    fn git_output(cwd: &PathBuf, args: &[&str]) -> String {
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
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
}
