use super::types::*;
use super::util::sanitize_file_stem;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle};

pub(crate) fn save_archive(
    request: &WorkflowRunRequest,
    result: &WorkflowRunResult,
) -> Result<String, String> {
    #[derive(Serialize)]
    struct ArchivePayload<'a> {
        request: &'a WorkflowRunRequest,
        result: &'a WorkflowRunResult,
    }

    let dir = archive_dir()?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_millis();
    let stem = sanitize_file_stem(&request.name);
    let random_suffix = format!("{:06}", now % 1_000_000);
    let path = dir.join(format!("{stem}-{now}-{random_suffix}.json"));
    let mut payload_result = result.clone();
    payload_result.archive_path = path.display().to_string();
    let payload = ArchivePayload {
        request,
        result: &payload_result,
    };
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize archive payload failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("write archive file failed: {e}"))?;
    Ok(path.display().to_string())
}

fn archive_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    let mut dir = home;
    dir.push(".maestro");
    dir.push("workflow-archives");
    fs::create_dir_all(&dir).map_err(|e| format!("create archive dir failed: {e}"))?;
    Ok(dir)
}

fn resolve_archive_path(archive_path: &str) -> Result<PathBuf, String> {
    let base = archive_dir()?
        .canonicalize()
        .map_err(|e| format!("canonicalize archive dir failed: {e}"))?;
    let requested = PathBuf::from(archive_path);
    let canonical = requested
        .canonicalize()
        .map_err(|e| format!("canonicalize archive path failed: {e}"))?;
    if !canonical.starts_with(&base) {
        return Err("archive path is outside workflow-archives".to_string());
    }
    Ok(canonical)
}

#[command]
pub async fn workflow_list_archives(_app: AppHandle) -> Result<Vec<WorkflowArchiveEntry>, String> {
    let dir = archive_dir()?;
    let mut read_dir = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| format!("read archive dir failed: {e}"))?;
    let mut tasks = Vec::new();

    while let Some(item) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("read archive item failed: {e}"))?
    {
        let path = item.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        tasks.push(tokio::spawn(async move {
            let metadata = tokio::fs::metadata(&path).await.ok()?;
            let modified_ts = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let json_data = tokio::fs::read_to_string(&path)
                .await
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());

            let (completed, workflow_name, failed_count) = if let Some(json) = json_data {
                let res = json.get("result");
                let completed = res
                    .and_then(|r| r.get("completed"))
                    .and_then(|c| c.as_bool())
                    .unwrap_or(false);
                let name = res
                    .and_then(|r| r.get("workflow_name"))
                    .and_then(|n| n.as_str())
                    .or_else(|| {
                        json.get("request")
                            .and_then(|r| r.get("name"))
                            .and_then(|n| n.as_str())
                    })
                    .unwrap_or_default()
                    .to_string();
                let fc = res
                    .and_then(|r| r.get("step_results"))
                    .and_then(|x| x.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter(|step| {
                                let ok = step
                                    .get("success")
                                    .and_then(|x| x.as_bool())
                                    .unwrap_or(false);
                                let matched = step
                                    .get("completion_matched")
                                    .and_then(|x| x.as_bool())
                                    .unwrap_or(false);
                                !(ok && matched)
                            })
                            .count()
                    })
                    .unwrap_or(0);
                (completed, name, fc)
            } else {
                (false, String::new(), 0)
            };

            Some(WorkflowArchiveEntry {
                name: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string(),
                path: path.display().to_string(),
                modified_ts,
                completed,
                workflow_name,
                failed_count,
            })
        }));
    }

    let results = futures::future::join_all(tasks).await;
    let mut entries: Vec<WorkflowArchiveEntry> = results
        .into_iter()
        .filter_map(
            |r: Result<Option<WorkflowArchiveEntry>, tokio::task::JoinError>| r.ok().flatten(),
        )
        .collect();

    entries.sort_by(|a, b| b.modified_ts.cmp(&a.modified_ts));
    Ok(entries)
}

#[command]
pub async fn workflow_get_archive(
    _app: AppHandle,
    archive_path: String,
) -> Result<WorkflowArchiveDetail, String> {
    let canonical = resolve_archive_path(&archive_path)?;
    let text = tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| format!("read archive failed: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse archive json failed: {e}"))?;
    let result = v
        .get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let step_count = result
        .get("step_results")
        .and_then(|x| x.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);
    let failed_count = result
        .get("step_results")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|step| {
                    let success = step
                        .get("success")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    let matched = step
                        .get("completion_matched")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    !(success && matched)
                })
                .count()
        })
        .unwrap_or(0);
    let failed_steps = result
        .get("step_results")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .enumerate()
                .filter_map(|(index, step)| {
                    let success = step
                        .get("success")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    let matched = step
                        .get("completion_matched")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    if success && matched {
                        return None;
                    }
                    let status = if success && !matched {
                        "not-matched".to_string()
                    } else {
                        "failed".to_string()
                    };
                    let reason = step
                        .get("failure_reason")
                        .and_then(|x| x.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| {
                            if success && !matched {
                                "not-matched".to_string()
                            } else {
                                "failed".to_string()
                            }
                        });
                    Some(WorkflowArchiveFailedStep {
                        index,
                        engine: step
                            .get("engine")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        mode: step
                            .get("mode")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        status,
                        reason,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let metadata = fs::metadata(&canonical).map_err(|e| format!("archive metadata failed: {e}"))?;
    let modified_ts = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(WorkflowArchiveDetail {
        name: canonical
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        path: canonical.display().to_string(),
        modified_ts,
        workflow_name: result
            .get("workflow_name")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("request")?.get("name")?.as_str())
            .unwrap_or_default()
            .to_string(),
        completed: result
            .get("completed")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
        used_fallback: result
            .get("used_fallback")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
        step_count,
        failed_count,
        failed_steps,
        verification: result
            .get("verification")
            .and_then(|x| serde_json::from_value::<VerificationSummary>(x.clone()).ok()),
    })
}

#[command]
pub async fn workflow_get_full_archive(
    _app: AppHandle,
    archive_path: String,
) -> Result<serde_json::Value, String> {
    let canonical = resolve_archive_path(&archive_path)?;
    let text = fs::read_to_string(&canonical).map_err(|e| format!("read archive failed: {e}"))?;
    serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|e| format!("parse archive json failed: {e}"))
}

#[command]
pub async fn workflow_export_archives(
    _app: AppHandle,
    entries: Vec<WorkflowArchiveEntry>,
) -> Result<WorkflowArchiveExportResult, String> {
    let count = entries.len();
    let mut dir = archive_dir()?;
    dir.push("exports");
    fs::create_dir_all(&dir).map_err(|e| format!("create export dir failed: {e}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs();
    let path = dir.join(format!("archive-list-{ts}.json"));
    let payload = serde_json::json!({
        "exported_at": ts,
        "count": count,
        "entries": entries,
    });
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize export payload failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("write export file failed: {e}"))?;
    Ok(WorkflowArchiveExportResult {
        path: path.display().to_string(),
        count,
    })
}
