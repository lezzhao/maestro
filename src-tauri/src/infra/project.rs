use crate::infra::scoped_fs::ScopedFS;
use serde::Serialize;
use ignore::WalkBuilder;
use regex::Regex;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{command, AppHandle, State};
use crate::config::write_config_to_disk;

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

fn ensure_git_repo(project_path: &str, i18n: &crate::i18n::I18n) -> Result<(), String> {
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
        && String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true");
    if is_work_tree {
        Ok(())
    } else {
        Err(i18n.t("err_not_git_repo"))
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



fn normalize_rel_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn list_files_via_ignore(scoped: &ScopedFS) -> Vec<String> {
    let mut files = Vec::new();
    let root = scoped.root();
    let walker = WalkBuilder::new(root)
        .standard_filters(true) // respects .gitignore, etc.
        .hidden(true)
        .build();

    for result in walker {
        if let Ok(entry) = result {
            if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                if let Ok(rel) = entry.path().strip_prefix(root) {
                    files.push(normalize_rel_path(rel));
                }
            }
        }
        if files.len() >= FILE_TREE_MAX_FILES {
            break;
        }
    }
    files.sort();
    files
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

fn sort_tree(nodes: &mut [FileTreeNode]) {
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
        let parts = file
            .split('/')
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>();
        if parts.is_empty() {
            continue;
        }
        insert_tree_path(&mut roots, &parts, "");
    }
    sort_tree(&mut roots);
    roots
}

#[command]
pub fn project_detect_stack(project_path: String) -> Result<ProjectStackResult, String> {
    let scoped = ScopedFS::new(&project_path)?;
    let path = scoped.root().to_path_buf();
    Ok(ProjectStackResult {
        path: project_path,
        stacks: detect_stack(&path),
    })
}

#[command]
pub fn project_set_current(
    _app: AppHandle,
    project_path: String,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<ProjectSetResult, String> {
    if project_path.trim().is_empty() {
        let mut config = (*core_state.inner().config.get()).clone();
        config.project.path.clear();
        config.project.detected_stack.clear();
        write_config_to_disk(&config)?;
        core_state.inner().config.set(config);
        return Ok(ProjectSetResult {
            path: String::new(),
            stacks: Vec::new(),
        });
    }

    let scoped = ScopedFS::new(&project_path)?;
    let path = scoped.root().to_path_buf();
    let stacks = detect_stack(&path);
    let mut config = (*core_state.inner().config.get()).clone();
    config.project.path = project_path.clone();
    config.project.detected_stack = stacks.clone();
    write_config_to_disk(&config)?;
    core_state.inner().config.set(config);
    Ok(ProjectSetResult {
        path: project_path,
        stacks,
    })
}


#[command]
pub async fn project_list_files(
    project_path: String,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<FileTreeNode>, String> {
    let allowed_path = core_state.inner().config.get().project.path.clone();
    if allowed_path.is_empty() {
        return Err("no workspace selected; set project first".to_string());
    }
    let scoped = ScopedFS::new(&project_path)?;
    if scoped.root() != std::path::Path::new(&allowed_path).canonicalize().unwrap_or_default() {
         return Err("project path is outside allowed workspace scope".to_string());
    }
    
    let files = list_files_via_ignore(&scoped).await;
    Ok(build_file_tree(files))
}

#[command]
pub async fn project_list_files_deep(
    project_path: String,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<String>, String> {
    let allowed_path = core_state.inner().config.get().project.path.clone();
    if allowed_path.is_empty() {
        return Err("no workspace selected".into());
    }
    let scoped = ScopedFS::new(&project_path)?;
    if scoped.root() != std::path::Path::new(&allowed_path).canonicalize().unwrap_or_default() {
         return Err("project path is outside allowed workspace scope".to_string());
    }

    let mut files = Vec::new();
    let walker = WalkBuilder::new(scoped.root())
        .standard_filters(true)
        .hidden(true)
        .build();

    for result in walker {
        if let Ok(entry) = result {
            if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                if let Ok(rel) = entry.path().strip_prefix(scoped.root()) {
                    files.push(normalize_rel_path(rel));
                }
            }
        }
        // Higher limit for deep scanning (fuzzy search)
        if files.len() >= 10_000 {
            break;
        }
    }
    Ok(files)
}

#[derive(Debug, Clone, Serialize)]
pub struct SymbolMatch {
    pub file: String,
    pub line: usize,
    pub content: String,
}

#[command]
pub async fn project_find_symbols(
    project_path: String,
    query: String,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<SymbolMatch>, String> {
    let allowed_path = core_state.inner().config.get().project.path.clone();
    if allowed_path.is_empty() {
        return Err("no workspace selected".into());
    }
    let scoped = ScopedFS::new(&project_path)?;
    if scoped.root() != std::path::Path::new(&allowed_path).canonicalize().unwrap_or_default() {
         return Err("project path is outside allowed workspace scope".to_string());
    }

    let re = Regex::new(&format!(r"(?i)(?:function|class|export|const|let|var|def|fn|trait|struct|enum|type)\s+[^{{\s]*{}\w*", regex::escape(&query)))
        .map_err(|e| format!("invalid regex: {e}"))?;

    let mut matches = Vec::new();
    let walker = WalkBuilder::new(scoped.root())
        .standard_filters(true)
        .build();

    let semaphore = Arc::new(tokio::sync::Semaphore::new(16));
    let mut futures = Vec::new();

    for result in walker {
        let entry = match result {
            Ok(e) => e,
            _ => continue,
        };
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }

        let path = entry.path().to_path_buf();
        let re_clone = re.clone();
        let sem_clone = semaphore.clone();
        let root_clone = scoped.root().to_path_buf();

        futures.push(tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.map_err(|e| e.to_string())?;
            let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
            let mut file_matches = Vec::new();
            for (idx, line) in content.lines().enumerate() {
                if re_clone.is_match(line) {
                    if let Ok(rel) = path.strip_prefix(&root_clone) {
                        file_matches.push(SymbolMatch {
                            file: normalize_rel_path(rel),
                            line: idx + 1,
                            content: line.trim().to_string(),
                        });
                    }
                }
                if file_matches.len() >= 10 { break; }
            }
            Ok::<Vec<SymbolMatch>, String>(file_matches)
        }));

        if futures.len() >= 1000 { break; } // Max files to scan
    }

    for f in futures {
        if let Ok(Ok(res)) = f.await {
            matches.extend(res);
            if matches.len() >= 100 {
                matches.truncate(100);
                break;
            }
        }
    }

    Ok(matches)
}

#[command]
pub async fn project_read_file(
    project_path: String,
    file_path: String,
    max_chars: Option<usize>,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<String, String> {
    let allowed_path = core_state.inner().config.get().project.path.clone();
    if allowed_path.is_empty() {
        return Err("no workspace selected; set project first".to_string());
    }
    let scoped = ScopedFS::new(&project_path)?;
    if scoped.root() != std::path::Path::new(&allowed_path).canonicalize().unwrap_or_default() {
         return Err("project path is outside allowed workspace scope".to_string());
    }
    if file_path.trim().is_empty() {
        return Err("file path is empty".to_string());
    }
    let canonical = scoped.resolve_in_scope(&file_path)?;
    if !canonical.is_file() {
        return Err("target is not a file".to_string());
    }

    let max = max_chars.unwrap_or(20_000).clamp(1_000, 200_000);

    // Efficiency: Use Metadata to check size before reading
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| format!("get metadata failed: {e}"))?;
    let file_size = metadata.len();

    // Only read fully if it's reasonably small, otherwise stream-read
    if file_size < (max * 4) as u64 {
        let text = tokio::fs::read_to_string(&canonical)
            .await
            .map_err(|e| format!("read file failed: {e}"))?;
        if text.chars().count() <= max {
            return Ok(text);
        }
        let mut out: String = text.chars().take(max).collect();
        out.push_str("\n\n...[file truncated]");
        Ok(out)
    } else {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let file = tokio::fs::File::open(&canonical)
            .await
            .map_err(|e| format!("open file failed: {e}"))?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        let mut out = String::new();
        let mut count = 0;

        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("read line failed: {e}"))?
        {
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
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<EngineRecommendation, String> {
    let scoped = ScopedFS::new(&project_path)?;
    let path = scoped.root().to_path_buf();

    let stacks = detect_stack(&path);
    let cfg = core_state.inner().config.get();

    let i18n = cfg.i18n();
    if stacks.iter().any(|s| s == "rust") && cfg.engines.contains_key("codex") {
        return Ok(EngineRecommendation {
            engine_id: "codex".to_string(),
            reason: i18n.t("recommend_rust"),
        });
    }
    if stacks.iter().any(|s| s == "node") && cfg.engines.contains_key("cursor") {
        return Ok(EngineRecommendation {
            engine_id: "cursor".to_string(),
            reason: i18n.t("recommend_node"),
        });
    }
    if stacks.iter().any(|s| s == "python") && cfg.engines.contains_key("gemini") {
        return Ok(EngineRecommendation {
            engine_id: "gemini".to_string(),
            reason: i18n.t("recommend_python"),
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
        reason: i18n.t("fallback_first_engine"),
    })
}

#[command]
pub async fn project_git_status(
    project_path: String,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<FileChange>, String> {
    let allowed_path = core_state.inner().config.get().project.path.clone();
    if allowed_path.is_empty() {
        return Err("no workspace selected; set project first".to_string());
    }
    let scoped = ScopedFS::new(&project_path)?;
    let i18n = core_state.inner().config.get().i18n();
    if scoped.root() != std::path::Path::new(&allowed_path).canonicalize().unwrap_or_default() {
         return Err("project path is outside allowed workspace scope".to_string());
    }
    ensure_git_repo(&project_path, &i18n)?;
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(scoped.root())
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
pub async fn project_git_diff(
    project_path: String,
    file_path: Option<String>,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<String, String> {
    let allowed_path = core_state.inner().config.get().project.path.clone();
    if allowed_path.is_empty() {
        return Err("no workspace selected; set project first".to_string());
    }
    let scoped = ScopedFS::new(&project_path)?;
    let i18n = core_state.inner().config.get().i18n();
    if scoped.root() != std::path::Path::new(&allowed_path).canonicalize().unwrap_or_default() {
         return Err("project path is outside allowed workspace scope".to_string());
    }
    ensure_git_repo(&project_path, &i18n)?;
    let mut command = tokio::process::Command::new("git");
    command.arg("-C").arg(scoped.root()).arg("diff");
    if let Some(path) = file_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        // Use resolve_in_scope to ensure the diffed file is within project boundaries
        let canonical_file = scoped.resolve_in_scope(path)?;
        command.arg("--").arg(canonical_file);
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
