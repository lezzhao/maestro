use super::types::*;
use super::util::{sanitize_file_stem, summarize_output};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle};

async fn history_root_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    let mut dir = home;
    dir.push(".maestro");
    dir.push("engine-history");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create history dir failed: {e}"))?;
    Ok(dir)
}

async fn history_index_dir(engine_id: &str) -> Result<PathBuf, String> {
    let mut dir = history_root_dir().await?;
    dir.push("index");
    dir.push(sanitize_file_stem(engine_id));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create history index dir failed: {e}"))?;
    Ok(dir)
}

async fn history_detail_dir() -> Result<PathBuf, String> {
    let mut dir = history_root_dir().await?;
    dir.push("details");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create history detail dir failed: {e}"))?;
    Ok(dir)
}

async fn resolve_history_detail_path(
    detail_path: &str,
) -> Result<PathBuf, String> {
    let root = history_root_dir().await?;
    let base = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| format!("canonicalize history root failed: {e}"))?;
    let requested = PathBuf::from(detail_path);
    let canonical = tokio::fs::canonicalize(&requested)
        .await
        .map_err(|e| format!("canonicalize history detail failed: {e}"))?;
    if !canonical.starts_with(&base) {
        return Err("history detail path is outside engine-history".to_string());
    }
    Ok(canonical)
}

pub(crate) async fn persist_engine_history(
    engine_id: &str,
    profile_id: &str,
    workflow_name: &str,
    step_index: usize,
    prompt: &str,
    step: &WorkflowStepResult,
) -> Result<(), String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs();
    let unique_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_nanos();
    let id = format!(
        "{}-{}-{}",
        unique_ts,
        sanitize_file_stem(workflow_name),
        sanitize_file_stem(&format!("{engine_id}-{step_index}"))
    );

    let mut detail_path = history_detail_dir().await?;
    detail_path.push(format!("{id}.json"));
    let detail = EngineHistoryDetail {
        id: id.clone(),
        engine_id: engine_id.to_string(),
        profile_id: profile_id.to_string(),
        workflow_name: workflow_name.to_string(),
        step_index,
        mode: step.mode.clone(),
        created_ts: ts,
        prompt: prompt.to_string(),
        output: step.output.clone(),
    };
    let detail_text = serde_json::to_string_pretty(&detail)
        .map_err(|e| format!("serialize history detail failed: {e}"))?;
    tokio::fs::write(&detail_path, detail_text)
        .await
        .map_err(|e| format!("write history detail failed: {e}"))?;

    let mut entry_path = history_index_dir(engine_id).await?;
    entry_path.push(format!("{id}.json"));
    let entry = EngineHistoryEntry {
        id,
        engine_id: engine_id.to_string(),
        profile_id: profile_id.to_string(),
        workflow_name: workflow_name.to_string(),
        step_index,
        mode: step.mode.clone(),
        status: step.status.clone(),
        success: step.success,
        completion_matched: step.completion_matched,
        failure_reason: step.failure_reason.clone(),
        duration_ms: step.duration_ms,
        summary: summarize_output(&step.output, 280),
        created_ts: ts,
        detail_path: detail_path.display().to_string(),
    };
    let entry_text = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("serialize history entry failed: {e}"))?;
    tokio::fs::write(&entry_path, entry_text)
        .await
        .map_err(|e| format!("write history entry failed: {e}"))?;
    Ok(())
}

#[command]
pub async fn workflow_list_engine_history(
    _app: AppHandle,
    engine_id: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<EngineHistoryPage, String> {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(20).clamp(1, 100);
    let mut entries = Vec::new();

    let mut root = history_root_dir().await?;
    root.push("index");
    if !root.exists() {
        return Ok(EngineHistoryPage {
            entries,
            total: 0,
            page,
            page_size,
        });
    }

    let mut engine_dirs = Vec::new();
    if let Some(id) = engine_id {
        let mut dir = root.clone();
        dir.push(sanitize_file_stem(&id));
        if dir.exists() {
            engine_dirs.push(dir);
        }
    } else {
        let mut read_dir = tokio::fs::read_dir(&root)
            .await
            .map_err(|e| format!("read history index root failed: {e}"))?;
        while let Some(item) = read_dir
            .next_entry()
            .await
            .map_err(|e| format!("read history engine dir failed: {e}"))?
        {
            if item.path().is_dir() {
                engine_dirs.push(item.path());
            }
        }
    }

    for dir in engine_dirs {
        let mut read_dir = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| format!("read history index dir failed: {e}"))?;
        while let Some(item) = read_dir
            .next_entry()
            .await
            .map_err(|e| format!("read history index item failed: {e}"))?
        {
            let path = item.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let text = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| format!("read history entry failed: {e}"))?;
            let entry: EngineHistoryEntry = serde_json::from_str(&text)
                .map_err(|e| format!("parse history entry failed: {e}"))?;
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| b.created_ts.cmp(&a.created_ts));
    let total = entries.len();
    let start = (page - 1) * page_size;
    let paged = if start >= total {
        Vec::new()
    } else {
        entries
            .into_iter()
            .skip(start)
            .take(page_size)
            .collect::<Vec<_>>()
    };
    Ok(EngineHistoryPage {
        entries: paged,
        total,
        page,
        page_size,
    })
}

#[command]
pub async fn workflow_get_engine_history_detail(
    _app: AppHandle,
    detail_path: String,
) -> Result<EngineHistoryDetail, String> {
    let canonical = resolve_history_detail_path(&detail_path).await?;
    let text = tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| format!("read history detail failed: {e}"))?;
    serde_json::from_str::<EngineHistoryDetail>(&text)
        .map_err(|e| format!("parse history detail failed: {e}"))
}
