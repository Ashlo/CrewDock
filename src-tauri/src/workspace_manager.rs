use std::path::Path;

use portable_pty::ChildKiller;

use crate::{
    build_balanced_pane_layout, collect_git_detail, layout_for_pane_count,
    normalize_workspace_name, normalize_workspace_todo_text, relabel_panes,
    remove_pane_from_layout, restore_pane_layout,
    session_manager::{prepare_workspace_launch, PaneJob},
    shift_pending_codex_starts_for_insert, shift_pending_codex_starts_for_remove,
    shift_workspace_codex_restore_bindings_for_insert,
    shift_workspace_codex_restore_bindings_for_remove, split_pane_layout, workspace_name,
    PaneRecord, PaneStatus, PersistedPaneLayout, RuntimeState, SplitAxis, WorkspaceRecord,
    WorkspaceTodoRecord,
};

pub(crate) fn build_workspace_record(
    runtime: &mut RuntimeState,
    path: &Path,
    pane_count: u8,
    persisted_layout: Option<&PersistedPaneLayout>,
) -> Result<WorkspaceRecord, String> {
    let workspace_id = runtime.next_id("workspace");
    let path_string = path.display().to_string();
    let name = workspace_name(path);
    let layout = layout_for_pane_count(pane_count)?;
    let panes = (0..layout.pane_count)
        .map(|index| PaneRecord {
            id: runtime.next_id("pane"),
            label: format!("Shell {:02}", index + 1),
            status: PaneStatus::Closed,
        })
        .collect::<Vec<_>>();
    let pane_ids = panes.iter().map(|pane| pane.id.clone()).collect::<Vec<_>>();
    let pane_layout = persisted_layout
        .and_then(|layout| restore_pane_layout(layout, &pane_ids))
        .unwrap_or_else(|| build_balanced_pane_layout(&pane_ids, layout.columns >= layout.rows));

    Ok(WorkspaceRecord {
        id: workspace_id,
        name,
        path: path_string,
        layout,
        panes,
        pane_layout,
        todos: Vec::new(),
        started: false,
        git: None,
        codex_session_id: None,
        codex_restore_bindings: Vec::new(),
        file_draft: None,
    })
}

pub(crate) fn refresh_workspace_git(
    runtime: &mut RuntimeState,
    workspace_id: &str,
) -> Result<(), String> {
    let workspace_index = find_workspace_index_by_id(runtime, workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let workspace_path = std::path::PathBuf::from(runtime.workspaces[workspace_index].path.clone());
    runtime.workspaces[workspace_index].git = Some(collect_git_detail(&workspace_path));
    Ok(())
}

pub(crate) fn find_workspace_index_by_id(
    runtime: &RuntimeState,
    workspace_id: &str,
) -> Option<usize> {
    runtime
        .workspaces
        .iter()
        .position(|workspace| workspace.id == workspace_id)
}

pub(crate) fn active_workspace_path(runtime: &RuntimeState) -> Option<String> {
    let active_id = runtime.active_workspace_id.as_ref()?;
    runtime
        .workspaces
        .iter()
        .find(|workspace| workspace.id == *active_id)
        .map(|workspace| workspace.path.clone())
}

pub(crate) fn active_workspace_index(runtime: &RuntimeState) -> Option<usize> {
    let active_id = runtime.active_workspace_id.as_ref()?;
    runtime
        .workspaces
        .iter()
        .position(|workspace| workspace.id == *active_id)
}

pub(crate) fn create_workspace_in_runtime(
    runtime: &mut RuntimeState,
    pane_count: u8,
    path: &Path,
) -> Result<Vec<PaneJob>, String> {
    let workspace_path = path.display().to_string();
    let workspace = build_workspace_record(runtime, path, pane_count, None)?;
    let workspace_id = workspace.id.clone();
    runtime.workspaces.push(workspace);

    runtime.active_workspace_id = Some(workspace_id.clone());
    runtime.launcher.base_path = workspace_path;
    let pane_jobs = prepare_workspace_launch(runtime, &workspace_id).unwrap_or_default();
    runtime.persist_to_disk()?;

    Ok(pane_jobs)
}

pub(crate) fn rename_workspace_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    name: &str,
) -> Result<(), String> {
    let workspace_index = find_workspace_index_by_id(runtime, workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let next_name = normalize_workspace_name(name)?;
    runtime.workspaces[workspace_index].name = next_name;
    runtime.persist_to_disk()
}

fn insert_open_workspace_todo(workspace: &mut WorkspaceRecord, todo: WorkspaceTodoRecord) {
    let insertion_index = workspace
        .todos
        .iter()
        .position(|entry| entry.done)
        .unwrap_or(workspace.todos.len());
    workspace.todos.insert(insertion_index, todo);
}

pub(crate) fn add_workspace_todo_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    text: &str,
) -> Result<(), String> {
    let workspace_index = find_workspace_index_by_id(runtime, workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let text = normalize_workspace_todo_text(text)?;
    let todo = WorkspaceTodoRecord {
        id: runtime.next_id("todo"),
        text,
        done: false,
    };

    insert_open_workspace_todo(&mut runtime.workspaces[workspace_index], todo);
    runtime.persist_to_disk()
}

pub(crate) fn update_workspace_todo_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    todo_id: &str,
    text: &str,
) -> Result<(), String> {
    let workspace_index = find_workspace_index_by_id(runtime, workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let text = normalize_workspace_todo_text(text)?;
    let todo_index = runtime.workspaces[workspace_index]
        .todos
        .iter()
        .position(|todo| todo.id == todo_id)
        .ok_or_else(|| "workspace task not found".to_string())?;

    runtime.workspaces[workspace_index].todos[todo_index].text = text;
    runtime.persist_to_disk()
}

pub(crate) fn set_workspace_todo_done_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    todo_id: &str,
    done: bool,
) -> Result<(), String> {
    let workspace_index = find_workspace_index_by_id(runtime, workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let todo_index = runtime.workspaces[workspace_index]
        .todos
        .iter()
        .position(|todo| todo.id == todo_id)
        .ok_or_else(|| "workspace task not found".to_string())?;

    let workspace = &mut runtime.workspaces[workspace_index];
    let mut todo = workspace.todos.remove(todo_index);
    todo.done = done;

    if done {
        workspace.todos.push(todo);
    } else {
        insert_open_workspace_todo(workspace, todo);
    }

    runtime.persist_to_disk()
}

pub(crate) fn delete_workspace_todo_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    todo_id: &str,
) -> Result<(), String> {
    let workspace_index = find_workspace_index_by_id(runtime, workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let todo_index = runtime.workspaces[workspace_index]
        .todos
        .iter()
        .position(|todo| todo.id == todo_id)
        .ok_or_else(|| "workspace task not found".to_string())?;

    runtime.workspaces[workspace_index].todos.remove(todo_index);
    runtime.persist_to_disk()
}

pub(crate) fn reorder_workspace_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
    target_index: usize,
) -> Result<(), String> {
    let Some(source_index) = find_workspace_index_by_id(runtime, workspace_id) else {
        return Err("workspace not found".to_string());
    };

    let workspace = runtime.workspaces.remove(source_index);
    let insertion_index = target_index.min(runtime.workspaces.len());
    runtime.workspaces.insert(insertion_index, workspace);
    runtime.persist_to_disk()
}

pub(crate) fn switch_workspace_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
) -> Result<Vec<PaneJob>, String> {
    if find_workspace_index_by_id(runtime, workspace_id).is_none() {
        return Err("workspace not found".to_string());
    }

    runtime.active_workspace_id = Some(workspace_id.to_string());
    if let Some(path) = active_workspace_path(runtime) {
        runtime.launcher.base_path = path;
    }
    let pane_jobs = prepare_workspace_launch(runtime, workspace_id).unwrap_or_default();
    runtime.persist_to_disk()?;

    Ok(pane_jobs)
}

pub(crate) fn close_workspace_in_runtime(
    runtime: &mut RuntimeState,
    workspace_id: &str,
) -> Result<(Vec<PaneJob>, Vec<Box<dyn ChildKiller + Send + Sync>>), String> {
    let Some(index) = find_workspace_index_by_id(runtime, workspace_id) else {
        return Err("workspace not found".to_string());
    };

    let removed_was_active = runtime.active_workspace_id.as_deref() == Some(workspace_id);
    let fallback_active_id = if removed_was_active {
        if index > 0 {
            runtime
                .workspaces
                .get(index - 1)
                .map(|workspace| workspace.id.clone())
        } else {
            runtime
                .workspaces
                .get(index + 1)
                .map(|workspace| workspace.id.clone())
        }
    } else {
        runtime.active_workspace_id.clone()
    };

    let killers = runtime.drain_workspace_killers(workspace_id);
    runtime.clear_pending_codex_starts_for_workspace(workspace_id);
    runtime.workspaces.remove(index);
    runtime.active_workspace_id = fallback_active_id.filter(|active_id| {
        runtime
            .workspaces
            .iter()
            .any(|workspace| workspace.id == *active_id)
    });
    if let Some(path) = active_workspace_path(runtime) {
        runtime.launcher.base_path = path;
    }

    let pane_jobs = runtime
        .active_workspace_id
        .clone()
        .and_then(|active_id| prepare_workspace_launch(runtime, &active_id))
        .unwrap_or_default();

    runtime.persist_to_disk()?;
    Ok((pane_jobs, killers))
}

pub(crate) fn split_pane_in_runtime(
    runtime: &mut RuntimeState,
    pane_id: &str,
    direction: &str,
) -> Result<Vec<PaneJob>, String> {
    let Some(workspace_index) = runtime
        .workspaces
        .iter()
        .position(|workspace| workspace.panes.iter().any(|pane| pane.id == pane_id))
    else {
        return Err("pane not found".to_string());
    };

    let new_pane_id = runtime.next_id("pane");
    let should_spawn = runtime.workspaces[workspace_index].started;
    let pane_total = runtime.workspaces[workspace_index].panes.len() + 1;
    if pane_total > 16 {
        return Err("workspace cannot exceed 16 panes".to_string());
    }

    let layout = layout_for_pane_count(pane_total as u8)?;
    let split_axis = if matches!(direction, "left" | "right") {
        SplitAxis::Horizontal
    } else {
        SplitAxis::Vertical
    };
    let new_pane_first = matches!(direction, "left" | "up");
    let new_pane = PaneRecord {
        id: new_pane_id.clone(),
        label: String::new(),
        status: if should_spawn {
            PaneStatus::Booting
        } else {
            PaneStatus::Closed
        },
    };

    let workspace_id = runtime.workspaces[workspace_index].id.clone();
    let cwd = runtime.workspaces[workspace_index].path.clone();
    let insertion_index = runtime.workspaces[workspace_index]
        .panes
        .iter()
        .position(|pane| pane.id == pane_id)
        .map(|index| if new_pane_first { index } else { index + 1 })
        .ok_or_else(|| "pane not found".to_string())?;
    shift_workspace_codex_restore_bindings_for_insert(
        &mut runtime.workspaces[workspace_index],
        insertion_index,
    );
    shift_pending_codex_starts_for_insert(&mut *runtime, &workspace_id, insertion_index);
    runtime.workspaces[workspace_index]
        .panes
        .insert(insertion_index, new_pane);
    relabel_panes(&mut runtime.workspaces[workspace_index].panes);
    if !split_pane_layout(
        &mut runtime.workspaces[workspace_index].pane_layout,
        pane_id,
        split_axis,
        new_pane_first,
        &new_pane_id,
    ) {
        return Err("pane not found".to_string());
    }
    runtime.workspaces[workspace_index].layout = layout.clone();
    runtime.persist_to_disk()?;

    if should_spawn {
        Ok(vec![PaneJob {
            workspace_id,
            pane_id: new_pane_id.clone(),
            label: runtime.workspaces[workspace_index]
                .panes
                .iter()
                .find(|pane| pane.id == new_pane_id)
                .map(|pane| pane.label.clone())
                .unwrap_or_else(|| format!("Shell {:02}", pane_total)),
            layout_label: layout.label.clone(),
            cwd,
        }])
    } else {
        Ok(Vec::new())
    }
}

pub(crate) fn close_pane_in_runtime(
    runtime: &mut RuntimeState,
    pane_id: &str,
) -> Result<Vec<Box<dyn ChildKiller + Send + Sync>>, String> {
    let Some(workspace_index) = runtime
        .workspaces
        .iter()
        .position(|workspace| workspace.panes.iter().any(|pane| pane.id == pane_id))
    else {
        return Err("pane not found".to_string());
    };

    if runtime.workspaces[workspace_index].panes.len() <= 1 {
        return Err("workspace must keep at least one pane".to_string());
    }

    let pane_index = runtime.workspaces[workspace_index]
        .panes
        .iter()
        .position(|pane| pane.id == pane_id)
        .ok_or_else(|| "pane not found".to_string())?;
    let workspace_id = runtime.workspaces[workspace_index].id.clone();
    shift_workspace_codex_restore_bindings_for_remove(
        &mut runtime.workspaces[workspace_index],
        pane_index,
    );
    shift_pending_codex_starts_for_remove(&mut *runtime, &workspace_id, pane_index, pane_id);

    runtime.workspaces[workspace_index].panes.remove(pane_index);
    runtime.workspaces[workspace_index].pane_layout = remove_pane_from_layout(
        runtime.workspaces[workspace_index].pane_layout.clone(),
        pane_id,
    )
    .ok_or_else(|| "workspace must keep at least one pane".to_string())?;
    relabel_panes(&mut runtime.workspaces[workspace_index].panes);
    runtime.workspaces[workspace_index].layout =
        layout_for_pane_count(runtime.workspaces[workspace_index].panes.len() as u8)?;

    let killers = runtime
        .sessions
        .remove(pane_id)
        .map(|session| vec![session.killer])
        .unwrap_or_default();

    runtime.persist_to_disk()?;
    Ok(killers)
}
