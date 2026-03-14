use crate::config::{write_config_to_disk, AppConfigState};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{command, AppHandle, State};

const FILE_TREE_MAX_DEPTH: usize = 5;
const FILE_TREE_MAX_FILES: usize = 2000;

#[derive(Debug, Clone, Serialize)]
pub struct ProjectStackResult {
    pub path: String,
    pub stacks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineRecommendation {
    pub engine_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileChange {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectSetResult {
    pub path: String,
    pub stacks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileTreeNode>,
}

fn detect_stack(path: &Path) -> Vec<String> {
    let mut stacks = Vec::new();
    if path.join("package.json").exists() {
        stacks.push("node".to_string());
    }
    if path.join("pnpm-lock.yaml").exists() || path.join("yarn.lock").exists() {
        stacks.push("frontend".to_string());
    }
    if path.join("Cargo.toml").exists() {
        stacks.push("rust".to_string());
    }
    if path.join("go.mod").exists() {
        stacks.push("go".to_string());
    }
    if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
        stacks.push("python".to_string());
    }
    if path.join("composer.json").exists() {
        stacks.push("php".to_string());
    }
    if path.join(".cursor").exists() {
        stacks.push("cursor".to_string());
    }
    if path.join("CLAUDE.md").exists() {
        stacks.push("claude".to_string());
    }
    stacks
}

fn ensure_git_repo(project_path: &str) -> Result<(), String> {
    let path = PathBuf::from(project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("project path invalid: {project_path}"));
    }

    if path.join(".git").exists() {
        return Ok(());
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(project_path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map_err(|e| format!("execute git failed: {e}"))?;

    let is_work_tree = output.status.success()
        && String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("true");
    if is_work_tree {
        Ok(())
    } else {
        Err("不是 git 仓库".to_string())
    }
}

fn normalize_status(code: &str) -> String {
    let trimmed = code.trim();
    if trimmed.contains('U') {
        return "conflict".to_string();
    }
    if trimmed.contains('A') || trimmed.contains('?') {
        return "added".to_string();
    }
    if trimmed.contains('D') {
        return "deleted".to_string();
    }
    if trimmed.contains('R') {
        return "renamed".to_string();
    }
    if trimmed.contains('M') {
        return "modified".to_string();
    }
    if trimmed.contains('!') {
        return "ignored".to_string();
    }
    "unknown".to_string()
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "dist" | "build" | "target" | ".next" | "out" | ".cache"
    )
}

fn normalize_rel_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn list_files_via_git(project_path: &str) -> Result<Vec<String>, String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(project_path)
        .arg("ls-files")
        .arg("--cached")
        .arg("--others")
        .arg("--exclude-standard")
        .output()
        .await
        .map_err(|e| format!("execute git ls-files failed: {e}"))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files: Vec<String> = stdout
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
        
    files.sort();
    files.dedup();
    if files.len() > FILE_TREE_MAX_FILES {
        files.truncate(FILE_TREE_MAX_FILES);
    }
    Ok(files)
}

async fn collect_files_fallback(
    root: &Path,
    current: &Path,
    depth: usize,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if out.len() >= FILE_TREE_MAX_FILES || depth > FILE_TREE_MAX_DEPTH {
        return Ok(());
    }
    let mut entries = tokio::fs::read_dir(current).await.map_err(|e| format!("read dir failed: {e}"))?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| format!("read dir entry failed: {e}"))? {
        if out.len() >= FILE_TREE_MAX_FILES {
            break;
        }
        let path = entry.path();
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy();
        
        let metadata = entry.metadata().await.map_err(|e| format!("get metadata failed: {e}"))?;
        if metadata.is_dir() {
            if should_skip_dir(&name) || depth >= FILE_TREE_MAX_DEPTH {
                continue;
            }
            // Use Box::pin for recursion in async if needed, but here we can just await
            Box::pin(collect_files_fallback(root, &path, depth + 1, out)).await?;
        } else if metadata.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(normalize_rel_path(rel));
            }
        }
    }
    Ok(())
}

fn find_or_insert_dir<'a>(
    nodes: &'a mut Vec<FileTreeNode>,
    name: &str,
    path: String,
) -> &'a mut FileTreeNode {
    if let Some(pos) = nodes.iter().position(|n| n.is_dir && n.name == name) {
        return &mut nodes[pos];
    }
    nodes.push(FileTreeNode {
        name: name.to_string(),
        path,
        is_dir: true,
        children: Vec::new(),
    });
    let idx = nodes.len() - 1;
    &mut nodes[idx]
}

fn insert_tree_path(nodes: &mut Vec<FileTreeNode>, parts: &[&str], prefix: &str) {
    if parts.is_empty() {
        return;
    }
    let name = parts[0];
    let next_path = if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    };
    if parts.len() == 1 {
        if nodes.iter().any(|n| !n.is_dir && n.name == name) {
            return;
        }
        nodes.push(FileTreeNode {
            name: name.to_string(),
            path: next_path,
            is_dir: false,
            children: Vec::new(),
        });
        return;
    }
    let dir_node = find_or_insert_dir(nodes, name, next_path.clone());
    insert_tree_path(&mut dir_node.children, &parts[1..], &next_path);
}

fn sort_tree(nodes: &mut Vec<FileTreeNode>) {
    for node in nodes.iter_mut() {
        if node.is_dir {
            sort_tree(&mut node.children);
        }
    }
    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
}

fn build_file_tree(files: Vec<String>) -> Vec<FileTreeNode> {
    let mut roots = Vec::new();
    for file in files {
        let parts = file.split('/').filter(|p| !p.is_empty()).collect::<Vec<_>>();
        if parts.is_empty() {
            continue;
        }
        insert_tree_path(&mut roots, &parts, "");
    }
    sort_tree(&mut roots);
    roots
}

fn resolve_project_file_path(project_root: &Path, relative_or_abs: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(relative_or_abs);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        project_root.join(requested)
    };
    let canonical_root = project_root
        .canonicalize()
        .map_err(|e| format!("canonicalize project root failed: {e}"))?;
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("canonicalize file path failed: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("file path is outside current project".to_string());
    }
    Ok(canonical)
}

#[command]
pub fn project_detect_stack(project_path: String) -> Result<ProjectStackResult, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("project path invalid: {project_path}"));
    }
    Ok(ProjectStackResult {
        path: project_path,
        stacks: detect_stack(&path),
    })
}

#[command]
pub fn project_set_current(
    app: AppHandle,
    project_path: String,
    state: State<'_, AppConfigState>,
) -> Result<ProjectSetResult, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("project path invalid: {project_path}"));
    }
    let stacks = detect_stack(&path);
    let mut config = state.get();
    config.project.path = project_path.clone();
    config.project.detected_stack = stacks.clone();
    write_config_to_disk(&app, &config)?;
    state.set(config);
    Ok(ProjectSetResult {
        path: project_path,
        stacks,
    })
}

#[command]
pub async fn project_list_files(project_path: String) -> Result<Vec<FileTreeNode>, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("project path invalid: {project_path}"));
    }

    let files = match list_files_via_git(&project_path).await {
        Ok(files) if !files.is_empty() => files,
        _ => {
            let mut fallback = Vec::new();
            collect_files_fallback(&path, &path, 0, &mut fallback).await?;
            fallback.sort();
            fallback.dedup();
            if fallback.len() > FILE_TREE_MAX_FILES {
                fallback.truncate(FILE_TREE_MAX_FILES);
            }
            fallback
        }
    };

    Ok(build_file_tree(files))
}

#[command]
pub fn project_read_file(
    project_path: String,
    file_path: String,
    max_chars: Option<usize>,
) -> Result<String, String> {
    let root = PathBuf::from(&project_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("project path invalid: {project_path}"));
    }
    if file_path.trim().is_empty() {
        return Err("file path is empty".to_string());
    }
    let canonical = resolve_project_file_path(&root, &file_path)?;
    if !canonical.is_file() {
        return Err("target is not a file".to_string());
    }

    let max = max_chars.unwrap_or(20_000).clamp(1_000, 200_000);
    
    // Efficiency: Use Metadata to check size before reading
    let metadata = fs::metadata(&canonical).map_err(|e| format!("get metadata failed: {e}"))?;
    let file_size = metadata.len();
    
    // Only read fully if it's reasonably small, otherwise stream-read
    if file_size < (max * 4) as u64 {
        let text = fs::read_to_string(&canonical).map_err(|e| format!("read file failed: {e}"))?;
        if text.chars().count() <= max {
            return Ok(text);
        }
        let mut out: String = text.chars().take(max).collect();
        out.push_str("\n\n...[file truncated]");
        Ok(out)
    } else {
        use std::io::{BufRead, BufReader};
        let file = fs::File::open(&canonical).map_err(|e| format!("open file failed: {e}"))?;
        let reader = BufReader::new(file);
        let mut out = String::new();
        let mut count = 0;
        
        for line in reader.lines() {
            let line = line.map_err(|e| format!("read line failed: {e}"))?;
            let line_chars = line.chars().count();
            if count + line_chars > max {
                let remaining = max - count;
                out.push_str(&line.chars().take(remaining).collect::<String>());
                out.push_str("\n\n...[file truncated]");
                return Ok(out);
            }
            out.push_str(&line);
            out.push('\n');
            count += line_chars + 1;
            if count >= max {
                out.push_str("\n\n...[file truncated]");
                return Ok(out);
            }
        }
        Ok(out)
    }
}

#[command]
pub fn project_recommend_engine(
    project_path: String,
    state: State<'_, AppConfigState>,
) -> Result<EngineRecommendation, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("project path invalid: {project_path}"));
    }

    let stacks = detect_stack(&path);
    let cfg = state.get();

    if stacks.iter().any(|s| s == "rust") && cfg.engines.contains_key("codex") {
        return Ok(EngineRecommendation {
            engine_id: "codex".to_string(),
            reason: "检测到 Rust 项目，推荐使用对系统级语言表现稳定的引擎".to_string(),
        });
    }
    if stacks.iter().any(|s| s == "node") && cfg.engines.contains_key("cursor") {
        return Ok(EngineRecommendation {
            engine_id: "cursor".to_string(),
            reason: "检测到 Node/前端项目，推荐 Cursor Agent 默认配置".to_string(),
        });
    }
    if stacks.iter().any(|s| s == "python") && cfg.engines.contains_key("gemini") {
        return Ok(EngineRecommendation {
            engine_id: "gemini".to_string(),
            reason: "检测到 Python 项目，推荐通用推理能力较强的引擎".to_string(),
        });
    }

    let first = cfg
        .engines
        .keys()
        .next()
        .cloned()
        .ok_or("no engines configured")?;
    Ok(EngineRecommendation {
        engine_id: first,
        reason: "回退到第一个可用引擎".to_string(),
    })
}

#[command]
pub async fn project_git_status(project_path: String) -> Result<Vec<FileChange>, String> {
    ensure_git_repo(&project_path)?;
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&project_path)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output()
        .await
        .map_err(|e| format!("execute git status failed: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes = Vec::new();
    for raw_line in stdout.lines() {
        if raw_line.len() < 3 {
            continue;
        }
        let code = &raw_line[0..2];
        let mut path = raw_line[3..].trim().to_string();
        if let Some((_, right)) = path.split_once(" -> ") {
            path = right.trim().to_string();
        }
        if path.is_empty() {
            continue;
        }
        changes.push(FileChange {
            status: normalize_status(code),
            path,
        });
    }
    Ok(changes)
}

#[command]
pub async fn project_git_diff(project_path: String, file_path: Option<String>) -> Result<String, String> {
    ensure_git_repo(&project_path)?;
    let mut command = tokio::process::Command::new("git");
    command.arg("-C").arg(&project_path).arg("diff");
    if let Some(path) = file_path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        command.arg("--").arg(path);
    }

    let output = command
        .output()
        .await
        .map_err(|e| format!("execute git diff failed: {e}"))?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let max_chars = 300_000usize;
    if text.chars().count() > max_chars {
        let mut out: String = text.chars().take(max_chars).collect();
        out.push_str("\n\n...[diff truncated for performance]");
        Ok(out)
    } else {
        Ok(text)
    }
}
