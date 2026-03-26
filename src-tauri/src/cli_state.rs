use crate::core::MaestroCore;
use crate::core::execution::{Execution, ExecutionStatus};
use crate::run_persistence::{read_run_records, rewrite_run_records};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::{command, State};



#[derive(Debug, Clone, Serialize)]
pub struct CliSessionListItem {
    pub session_id: String,
    pub engine_id: String,
    pub task_id: String,
    pub source: String,
    pub status: String,
    pub mode: String,
    pub command: String,
    pub cwd: String,
    pub model: String,
    pub run_count: i64,
    pub send_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub log_size: u64,
    pub is_last: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliPruneResult {
    pub deleted_sessions: usize,
    pub deleted_logs: usize,
}

fn resolve_workspace_io(core: &MaestroCore) -> Result<crate::workspace_io::WorkspaceIo, String> {
    core.workspace_io().map_err(|e| e.to_string())
}

fn cli_log_dir(io: &crate::workspace_io::WorkspaceIo) -> PathBuf {
    io.resolve(".maestro-cli/logs").unwrap_or_else(|_| PathBuf::from(".maestro-cli/logs"))
}

fn session_log_path(log_dir: &std::path::Path, session_id: &str) -> PathBuf {
    let normalized: String = session_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    log_dir.join(format!("{normalized}.log"))
}

fn map_run_records(
    records: &[Execution],
    log_dir: &std::path::Path,
    engine_filter: Option<&str>,
) -> Vec<CliSessionListItem> {
    let mut items: Vec<CliSessionListItem> = records
        .iter()
        .filter(|record| {
            engine_filter
                .map(|id| id == record.engine_id)
                .unwrap_or(true)
        })
        .map(|record| {
            let log_path = session_log_path(log_dir, &record.id);
            let log_size = fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
            CliSessionListItem {
                session_id: record.id.clone(),
                engine_id: record.engine_id.clone(),
                task_id: record.task_id.clone(),
                source: record.source.clone(),
                status: record.status.as_str().to_string(),
                mode: record.mode.as_str().to_string(),
                command: record.command.clone(),
                cwd: record.cwd.clone(),
                model: record.model.clone(),
                run_count: 1,
                send_count: 0,
                created_at: record.created_at,
                updated_at: record.updated_at,
                log_size,
                is_last: false,
            }
        })
        .collect();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut last_by_engine: BTreeMap<String, String> = BTreeMap::new();
    for item in &items {
        last_by_engine
            .entry(item.engine_id.clone())
            .or_insert_with(|| item.session_id.clone());
    }
    for item in &mut items {
        item.is_last = last_by_engine
            .get(&item.engine_id)
            .map(|id| id == &item.session_id)
            .unwrap_or(false);
    }
    items
}

#[command]
pub fn cli_list_sessions(
    engine_id: Option<String>,
    core_state: State<'_, MaestroCore>,
) -> Result<Vec<CliSessionListItem>, String> {
    let io = resolve_workspace_io(core_state.inner())?;
    let log_dir = cli_log_dir(&io);
    let run_records = read_run_records(&io).unwrap_or_default();
    Ok(map_run_records(
        &run_records,
        &log_dir,
        engine_id.as_deref(),
    ))
}

#[command]
pub fn cli_read_session_logs(
    engine_id: String,
    session_id: Option<String>,
    _limit: Option<usize>,
    core_state: State<'_, MaestroCore>,
) -> Result<String, String> {
    let io = resolve_workspace_io(core_state.inner())?;
    let run_records = read_run_records(&io).unwrap_or_default();
    
    let target = if let Some(id) = session_id {
        id
    } else {
        let filtered = run_records
            .iter()
            .filter(|item| item.engine_id == engine_id)
            .max_by_key(|item| item.updated_at);
        filtered
            .map(|item| item.id.clone())
            .ok_or_else(|| format!("no run record for engine: {engine_id}"))?
    };
    let matched = run_records.iter().find(|item| item.id == target);
    if let Some(item) = matched {
        if !item.output_preview.trim().is_empty() {
            return Ok(item.output_preview.clone());
        }
        return Ok(format!(
            "run_id: {}\nengine: {}\nstatus: {}\nmode: {}\n暂无日志预览。",
            item.id, item.engine_id, item.status.as_str(), item.mode.as_str()
        ));
    }
    
    Err(format!("log file not found for session: {target}"))
}

#[command]
pub fn cli_prune_sessions(
    engine_id: Option<String>,
    status: Option<String>,
    older_than_hours: Option<u64>,
    core_state: State<'_, MaestroCore>,
) -> Result<CliPruneResult, String> {
    let io = resolve_workspace_io(core_state.inner())?;
    let log_dir = cli_log_dir(&io);
    let run_records = read_run_records(&io).unwrap_or_default();
    
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("read system time failed: {e}"))?
        .as_millis() as i64;
    let threshold_ms = older_than_hours
        .map(|hours| now_ms - (hours as i64) * 60 * 60 * 1000)
        .unwrap_or(i64::MIN);
    let mut keep = Vec::new();
    let mut remove = Vec::new();
    for item in run_records {
        let pass_engine = engine_id
            .as_deref()
            .map(|filter| filter == item.engine_id.as_str())
            .unwrap_or(true);
        let pass_status = status
            .as_deref()
            .map(|filter| filter == item.status.as_str())
            .unwrap_or(true);
        let pass_time = item.updated_at < threshold_ms;
        if pass_engine && pass_status && pass_time {
            remove.push(item);
        } else {
            keep.push(item);
        }
    }
    rewrite_run_records(&io, &keep)?;
    let mut deleted_logs = 0usize;
    for record in &remove {
        let log_path = session_log_path(&log_dir, &record.id);
        if log_path.exists() && fs::remove_file(log_path).is_ok() {
            deleted_logs += 1;
        }
    }
    Ok(CliPruneResult {
        deleted_sessions: remove.len(),
        deleted_logs,
    })
}

#[command]
pub fn cli_reconcile_active_sessions(
    core_state: State<'_, MaestroCore>,
) -> Result<usize, String> {
    let io = resolve_workspace_io(core_state.inner())?;
    let mut reconciled = 0;

    let run_records = read_run_records(&io).unwrap_or_default();
    if !run_records.is_empty() {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("read system time failed: {e}"))?
            .as_millis() as i64;
        let mut updated = Vec::new();
        for mut item in run_records {
            if item.status == ExecutionStatus::Running && now_ms - item.updated_at > 12 * 60 * 60 * 1000 {
                item.status = ExecutionStatus::Failed;
                item.updated_at = now_ms;
                reconciled += 1;
            }
            updated.push(item);
        }
        if reconciled > 0 {
            rewrite_run_records(&io, &updated)?;
        }
    }

    Ok(reconciled)
}

