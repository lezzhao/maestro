use crate::core::execution::Execution;
use crate::redact;
use crate::workspace_io::WorkspaceIo;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::Mutex;

static RUN_RECORDS_LOCK: Mutex<()> = Mutex::new(());

fn redact_execution(record: &Execution) -> Execution {
    let mut r = record.clone();
    r.output_preview = redact::redact_sensitive(&r.output_preview);
    if let Some(ref e) = r.error {
        r.error = Some(redact::redact_sensitive(e));
    }
    if let Some(ref res) = r.result {
        r.result = Some(redact::redact_sensitive(res));
    }
    r
}

pub fn current_time_ms() -> Result<i64, String> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("read system time failed: {e}"))?
        .as_millis() as i64)
}

pub fn append_run_record(workspace_io: &WorkspaceIo, record: &Execution) -> Result<(), String> {
    let _guard = RUN_RECORDS_LOCK
        .lock()
        .map_err(|_| "lock run records failed".to_string())?;
    let path = workspace_io.resolve(".maestro-cli/run-records.jsonl")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create run record dir failed: {e}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open run record file failed: {e}"))?;
    let redacted = redact_execution(record);
    let text = serde_json::to_string(&redacted)
        .map_err(|e| format!("serialize run record failed: {e}"))?;
    file.write_all(format!("{text}\n").as_bytes())
        .map_err(|e| format!("write run record failed: {e}"))?;
    Ok(())
}

pub fn read_run_records(workspace_io: &WorkspaceIo) -> Result<Vec<Execution>, String> {
    let _guard = RUN_RECORDS_LOCK
        .lock()
        .map_err(|_| "lock run records failed".to_string())?;
    let path = workspace_io.resolve(".maestro-cli/run-records.jsonl")?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read run record file failed: {e}"))?;
    let mut records = Vec::new();
    let mut bad_line_count = 0usize;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(item) = serde_json::from_str::<Execution>(trimmed) {
            records.push(item);
        } else {
            bad_line_count += 1;
        }
    }
    if bad_line_count > 0 {
        eprintln!(
            "run-records warning: ignored {} invalid lines in {}",
            bad_line_count,
            path.display()
        );
    }
    Ok(records)
}

pub fn rewrite_run_records(
    workspace_io: &WorkspaceIo,
    records: &[Execution],
) -> Result<(), String> {
    let _guard = RUN_RECORDS_LOCK
        .lock()
        .map_err(|_| "lock run records failed".to_string())?;
    let path = workspace_io.resolve(".maestro-cli/run-records.jsonl")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create run record dir failed: {e}"))?;
    }
    let content = records
        .iter()
        .map(|item| serde_json::to_string(&redact_execution(item)).unwrap_or_default())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let tmp_path = path.with_extension("jsonl.tmp");
    if content.is_empty() {
        fs::write(&tmp_path, "").map_err(|e| format!("rewrite run records failed: {e}"))?;
    } else {
        fs::write(&tmp_path, format!("{content}\n"))
            .map_err(|e| format!("rewrite run records failed: {e}"))?;
    }
    fs::rename(&tmp_path, &path).map_err(|e| format!("replace run records failed: {e}"))?;
    Ok(())
}

pub fn remove_records_by_task_id(
    workspace_io: &WorkspaceIo,
    task_id: &str,
) -> Result<usize, String> {
    if task_id.trim().is_empty() {
        return Ok(0);
    }
    let mut records = read_run_records(workspace_io)?;
    let before = records.len();
    records.retain(|item| item.task_id != task_id);
    if records.len() == before {
        return Ok(0);
    }
    rewrite_run_records(workspace_io, &records)?;
    Ok(before.saturating_sub(records.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::execution::{Execution, ExecutionMode, ExecutionStatus};

    fn mock_execution(id: &str, task_id: &str) -> Execution {
        Execution {
            id: id.to_string(),
            engine_id: "cursor".to_string(),
            task_id: task_id.to_string(),
            source: "test".to_string(),
            mode: ExecutionMode::Cli,
            status: ExecutionStatus::Completed,
            command: "echo".to_string(),
            cwd: String::new(),
            model: "gpt-5".to_string(),
            created_at: 1,
            updated_at: 1,
            log_path: None,
            output_preview: String::new(),
            verification: None,
            error: None,
            result: None,
            native_ref: None,
        }
    }

    #[test]
    fn remove_records_by_task_id_keeps_other_tasks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_path_buf();
        let io = WorkspaceIo::new(&root).expect("io");
        append_run_record(&io, &mock_execution("r1", "t1")).expect("append r1");
        append_run_record(&io, &mock_execution("r2", "t2")).expect("append r2");

        let removed = remove_records_by_task_id(&io, "t1").expect("remove t1");
        assert_eq!(removed, 1);

        let remaining = read_run_records(&io).expect("read records");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "r2");
        assert_eq!(remaining[0].task_id, "t2");
    }
}
