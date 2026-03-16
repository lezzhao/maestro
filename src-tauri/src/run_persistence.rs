use crate::core::execution::Execution;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static RUN_RECORDS_LOCK: Mutex<()> = Mutex::new(());

pub fn current_time_ms() -> Result<i64, String> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("read system time failed: {e}"))?
        .as_millis() as i64)
}

pub fn resolve_root_dir_from_project_path(project_path: &str) -> Result<PathBuf, String> {
    let configured = project_path.trim();
    if !configured.is_empty() {
        return Ok(PathBuf::from(configured));
    }
    std::env::current_dir().map_err(|e| format!("resolve current dir failed: {e}"))
}

pub fn run_records_path(root: &PathBuf) -> PathBuf {
    root.join(".maestro-cli").join("run-records.jsonl")
}

pub fn append_run_record(root: &PathBuf, record: &Execution) -> Result<(), String> {
    let _guard = RUN_RECORDS_LOCK
        .lock()
        .map_err(|_| "lock run records failed".to_string())?;
    let path = run_records_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create run record dir failed: {e}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open run record file failed: {e}"))?;
    let text =
        serde_json::to_string(record).map_err(|e| format!("serialize run record failed: {e}"))?;
    file.write_all(format!("{text}\n").as_bytes())
        .map_err(|e| format!("write run record failed: {e}"))?;
    Ok(())
}

pub fn read_run_records(root: &PathBuf) -> Result<Vec<Execution>, String> {
    let _guard = RUN_RECORDS_LOCK
        .lock()
        .map_err(|_| "lock run records failed".to_string())?;
    let path = run_records_path(root);
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

pub fn rewrite_run_records(root: &PathBuf, records: &[Execution]) -> Result<(), String> {
    let _guard = RUN_RECORDS_LOCK
        .lock()
        .map_err(|_| "lock run records failed".to_string())?;
    let path = run_records_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create run record dir failed: {e}"))?;
    }
    let content = records
        .iter()
        .map(|item| serde_json::to_string(item).unwrap_or_default())
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
