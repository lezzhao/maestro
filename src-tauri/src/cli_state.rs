use crate::config::AppConfigState;
use crate::run_persistence::{read_run_records, rewrite_run_records, UnifiedRunRecord};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::{command, State};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CliStateFile {
    #[serde(default)]
    last_sessions: BTreeMap<String, String>,
    #[serde(default)]
    sessions: BTreeMap<String, CliSessionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliSessionEntry {
    pub session_id: String,
    pub engine_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub run_count: i64,
    #[serde(default)]
    pub send_count: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub native_session_id: Option<String>,
}

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

fn resolve_root_dir(config_state: &AppConfigState) -> Result<PathBuf, String> {
    let cfg = config_state.get();
    let configured = cfg.project.path.trim();
    if !configured.is_empty() {
        return Ok(PathBuf::from(configured));
    }
    std::env::current_dir().map_err(|e| format!("resolve current dir failed: {e}"))
}

fn cli_state_paths(root: &PathBuf) -> (PathBuf, PathBuf) {
    let base = root.join(".bmad-cli");
    (base.join("state.json"), base.join("logs"))
}

fn load_cli_state(state_path: &PathBuf) -> Result<CliStateFile, String> {
    if !state_path.exists() {
        return Ok(CliStateFile::default());
    }
    let raw =
        fs::read_to_string(state_path).map_err(|e| format!("read cli state file failed: {e}"))?;
    serde_json::from_str::<CliStateFile>(&raw)
        .map_err(|e| format!("parse cli state file failed: {e}"))
}

fn save_cli_state(state_path: &PathBuf, state: &CliStateFile) -> Result<(), String> {
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create cli state dir failed: {e}"))?;
    }
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("serialize cli state failed: {e}"))?;
    fs::write(state_path, format!("{content}\n")).map_err(|e| format!("write cli state failed: {e}"))
}

fn session_log_path(log_dir: &PathBuf, session_id: &str) -> PathBuf {
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
    records: &[UnifiedRunRecord],
    log_dir: &PathBuf,
    engine_filter: Option<&str>,
) -> Vec<CliSessionListItem> {
    let mut items: Vec<CliSessionListItem> = records
        .iter()
        .filter(|record| engine_filter.map(|id| id == record.engine_id).unwrap_or(true))
        .map(|record| {
            let log_path = session_log_path(log_dir, &record.run_id);
            let log_size = fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
            CliSessionListItem {
                session_id: record.run_id.clone(),
                engine_id: record.engine_id.clone(),
                task_id: record.task_id.clone(),
                source: record.source.clone(),
                status: record.status.clone(),
                mode: record.mode.clone(),
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
    config_state: State<'_, AppConfigState>,
) -> Result<Vec<CliSessionListItem>, String> {
    let root = resolve_root_dir(&config_state)?;
    let (state_path, log_dir) = cli_state_paths(&root);
    let run_records = read_run_records(&root).unwrap_or_default();
    if !run_records.is_empty() {
        return Ok(map_run_records(&run_records, &log_dir, engine_id.as_deref()));
    }
    let state = load_cli_state(&state_path)?;
    let mut items = Vec::new();
    for session in state.sessions.values() {
        if let Some(filter) = engine_id.as_deref() {
            if session.engine_id != filter {
                continue;
            }
        }
        let log_path = session_log_path(&log_dir, &session.session_id);
        let log_size = fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
        let is_last = state
            .last_sessions
            .get(&session.engine_id)
            .map(|id| id == &session.session_id)
            .unwrap_or(false);
        items.push(CliSessionListItem {
            session_id: session.session_id.clone(),
            engine_id: session.engine_id.clone(),
            task_id: String::new(),
            source: "legacy-cli-state".to_string(),
            status: if session.status.is_empty() {
                "unknown".to_string()
            } else {
                session.status.clone()
            },
            mode: if session.mode.is_empty() {
                "pseudo".to_string()
            } else {
                session.mode.clone()
            },
            command: session.command.clone(),
            cwd: session.cwd.clone(),
            model: session.model.clone(),
            run_count: session.run_count,
            send_count: session.send_count,
            created_at: session.created_at,
            updated_at: session.updated_at,
            log_size,
            is_last,
        });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[command]
pub fn cli_read_session_logs(
    engine_id: String,
    session_id: Option<String>,
    limit: Option<usize>,
    config_state: State<'_, AppConfigState>,
) -> Result<String, String> {
    let root = resolve_root_dir(&config_state)?;
    let (state_path, log_dir) = cli_state_paths(&root);
    let session_id_for_unified = session_id.clone();
    let run_records = read_run_records(&root).unwrap_or_default();
    if !run_records.is_empty() {
        let target = if let Some(id) = session_id_for_unified {
            id
        } else {
            let filtered = run_records
                .iter()
                .filter(|item| item.engine_id == engine_id)
                .max_by_key(|item| item.updated_at);
            filtered
                .map(|item| item.run_id.clone())
                .ok_or_else(|| format!("no run record for engine: {engine_id}"))?
        };
        let matched = run_records.iter().find(|item| item.run_id == target);
        if let Some(item) = matched {
            if !item.output_preview.trim().is_empty() {
                return Ok(item.output_preview.clone());
            }
            return Ok(format!(
                "run_id: {}\nengine: {}\nstatus: {}\nmode: {}\n暂无日志预览。",
                item.run_id, item.engine_id, item.status, item.mode
            ));
        }
    }
    let state = load_cli_state(&state_path)?;
    let target_id = if let Some(id) = session_id {
        id
    } else {
        state
            .last_sessions
            .get(&engine_id)
            .cloned()
            .ok_or_else(|| format!("no session for engine: {engine_id}"))?
    };
    let path = session_log_path(&log_dir, &target_id);
    if !path.exists() {
        return Err(format!("log file not found for session: {target_id}"));
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read session log failed: {e}"))?;
    let max_lines = limit.unwrap_or(200).max(1);
    let lines: Vec<&str> = raw.lines().collect();
    if lines.len() <= max_lines {
        return Ok(raw);
    }
    Ok(lines[lines.len() - max_lines..].join("\n"))
}

#[command]
pub fn cli_prune_sessions(
    engine_id: Option<String>,
    status: Option<String>,
    older_than_hours: Option<u64>,
    config_state: State<'_, AppConfigState>,
) -> Result<CliPruneResult, String> {
    let root = resolve_root_dir(&config_state)?;
    let (state_path, log_dir) = cli_state_paths(&root);
    let run_records = read_run_records(&root).unwrap_or_default();
    if !run_records.is_empty() {
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
        rewrite_run_records(&root, &keep)?;
        let mut deleted_logs = 0usize;
        for record in &remove {
            let log_path = session_log_path(&log_dir, &record.run_id);
            if log_path.exists() && fs::remove_file(log_path).is_ok() {
                deleted_logs += 1;
            }
        }
        return Ok(CliPruneResult {
            deleted_sessions: remove.len(),
            deleted_logs,
        });
    }
    let mut state = load_cli_state(&state_path)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("read system time failed: {e}"))?
        .as_millis() as i64;
    let threshold_ms = older_than_hours
        .map(|hours| now_ms - (hours as i64) * 60 * 60 * 1000)
        .unwrap_or(i64::MIN);

    let mut delete_ids = Vec::new();
    for (id, session) in &state.sessions {
        if let Some(filter_engine) = engine_id.as_deref() {
            if session.engine_id != filter_engine {
                continue;
            }
        }
        if let Some(filter_status) = status.as_deref() {
            if session.status != filter_status {
                continue;
            }
        }
        if session.updated_at >= threshold_ms {
            continue;
        }
        delete_ids.push(id.clone());
    }

    let mut deleted_logs = 0usize;
    for id in &delete_ids {
        if let Some(session) = state.sessions.remove(id) {
            let log_path = session_log_path(&log_dir, &session.session_id);
            if log_path.exists() && fs::remove_file(log_path).is_ok() {
                deleted_logs += 1;
            }
            if state
                .last_sessions
                .get(&session.engine_id)
                .map(|sid| sid == &session.session_id)
                .unwrap_or(false)
            {
                state.last_sessions.remove(&session.engine_id);
            }
        }
    }
    save_cli_state(&state_path, &state)?;
    Ok(CliPruneResult {
        deleted_sessions: delete_ids.len(),
        deleted_logs,
    })
}
