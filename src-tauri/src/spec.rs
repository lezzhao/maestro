use crate::config::{AppConfigState, SpecProviderBmad};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

const BMAD_RULES_TEMPLATE: &str = r#"# BMAD Rules

Use BMAD process: Brief -> Model -> Action -> Done.
"#;

const CUSTOM_RULES_TEMPLATE: &str = "# Custom rules\n";

#[allow(dead_code)]
pub trait SpecProvider: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn inject(&self, project_path: &Path, mode: &str, target_ide: &str) -> Result<(), String>;
    fn remove(&self, project_path: &Path) -> Result<(), String>;
    fn detect(&self, project_path: &Path) -> bool;
}

#[derive(Clone)]
pub struct BmadProvider {
    conf: SpecProviderBmad,
}

impl BmadProvider {
    pub fn new(conf: SpecProviderBmad) -> Self {
        Self { conf }
    }
}

impl SpecProvider for BmadProvider {
    fn id(&self) -> &str {
        "bmad"
    }

    fn display_name(&self) -> &str {
        &self.conf.display_name
    }

    fn inject(&self, project_path: &Path, mode: &str, target_ide: &str) -> Result<(), String> {
        match mode {
            "full" => {
                let src = self.conf.source_path.trim();
                if src.is_empty() {
                    return Err(
                        "bmad full install requires providers.bmad.source_path to be set"
                            .to_string(),
                    );
                }
                copy_dir_all(Path::new(src), &project_path.join("_bmad"))?;
            }
            _ => {
                let content = BMAD_RULES_TEMPLATE;
                match target_ide {
                    "cursor" => {
                        let file = project_path.join(".cursor/rules/bmad.mdc");
                        ensure_parent(&file)?;
                        fs::write(file, content)
                            .map_err(|e| format!("write cursor bmad rule failed: {e}"))?;
                    }
                    "claude" => {
                        fs::write(project_path.join("CLAUDE.md"), content)
                            .map_err(|e| format!("write CLAUDE.md failed: {e}"))?;
                    }
                    "gemini" => {
                        fs::write(project_path.join("GEMINI.md"), content)
                            .map_err(|e| format!("write GEMINI.md failed: {e}"))?;
                    }
                    _ => {
                        fs::write(project_path.join("AGENTS.md"), content)
                            .map_err(|e| format!("write AGENTS.md failed: {e}"))?;
                    }
                }
            }
        }
        Ok(())
    }

    fn remove(&self, project_path: &Path) -> Result<(), String> {
        let maybe_paths = [
            project_path.join("_bmad"),
            project_path.join(".cursor/rules/bmad.mdc"),
            project_path.join("CLAUDE.md"),
            project_path.join("GEMINI.md"),
            project_path.join("AGENTS.md"),
        ];
        for p in maybe_paths {
            if p.is_dir() {
                let _ = fs::remove_dir_all(&p);
            } else if p.exists() {
                let _ = fs::remove_file(&p);
            }
        }
        Ok(())
    }

    fn detect(&self, project_path: &Path) -> bool {
        project_path.join("_bmad").exists()
            || project_path.join(".cursor/rules/bmad.mdc").exists()
            || project_path.join("CLAUDE.md").exists()
            || project_path.join("GEMINI.md").exists()
    }
}

#[derive(Debug, Serialize)]
pub struct SpecDescriptor {
    pub id: String,
    pub display_name: String,
    pub modes: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SpecDetectResult {
    pub provider: String,
    pub detected: bool,
}

#[derive(Debug, Serialize)]
pub struct SpecPreviewResult {
    pub file_path: String,
    pub content: String,
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Err(format!("source path does not exist: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("create dir failed: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir failed: {e}"))? {
        let entry = entry.map_err(|e| format!("dir entry failed: {e}"))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("file_type failed: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy failed {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

fn ensure_parent(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent failed: {e}"))?;
    }
    Ok(())
}

#[command]
pub fn spec_list(state: tauri::State<'_, AppConfigState>) -> Vec<SpecDescriptor> {
    let cfg = state.get();
    vec![
        SpecDescriptor {
            id: "none".to_string(),
            display_name: "无规范".to_string(),
            modes: vec![],
        },
        SpecDescriptor {
            id: "bmad".to_string(),
            display_name: cfg.providers.bmad.display_name,
            modes: vec!["full".to_string(), "rules_only".to_string()],
        },
        SpecDescriptor {
            id: "custom".to_string(),
            display_name: cfg.providers.custom.display_name,
            modes: vec!["rules_only".to_string()],
        },
    ]
}

#[command]
pub fn spec_inject(
    provider: String,
    project_path: String,
    mode: String,
    target_ide: String,
    state: tauri::State<'_, AppConfigState>,
) -> Result<(), String> {
    let cfg = state.get();
    let project = PathBuf::from(project_path);
    match provider.as_str() {
        "none" => Ok(()),
        "bmad" => BmadProvider::new(cfg.providers.bmad).inject(&project, &mode, &target_ide),
        "custom" => {
            let custom = cfg.providers.custom;
            let content = if custom.rules_content.trim().is_empty() {
                CUSTOM_RULES_TEMPLATE
            } else {
                &custom.rules_content
            };
            let file = match target_ide.as_str() {
                "cursor" => project.join(".cursor/rules/custom.mdc"),
                "claude" => project.join("CLAUDE.md"),
                "gemini" => project.join("GEMINI.md"),
                _ => project.join("AGENTS.md"),
            };
            ensure_parent(&file)?;
            fs::write(file, content).map_err(|e| format!("write custom rules failed: {e}"))
        }
        other => Err(format!("unsupported provider: {other}")),
    }
}

#[command]
pub fn spec_remove(
    provider: String,
    project_path: String,
    state: tauri::State<'_, AppConfigState>,
) -> Result<(), String> {
    let cfg = state.get();
    let project = PathBuf::from(project_path);
    match provider.as_str() {
        "bmad" => BmadProvider::new(cfg.providers.bmad).remove(&project),
        "custom" => {
            let maybe_paths = [
                project.join(".cursor/rules/custom.mdc"),
                project.join("CLAUDE.md"),
                project.join("GEMINI.md"),
                project.join("AGENTS.md"),
            ];
            for p in maybe_paths {
                if p.exists() {
                    let _ = fs::remove_file(p);
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[command]
pub fn spec_detect(
    project_path: String,
    state: tauri::State<'_, AppConfigState>,
) -> Vec<SpecDetectResult> {
    let cfg = state.get();
    let project = PathBuf::from(project_path);
    let bmad = BmadProvider::new(cfg.providers.bmad);
    vec![
        SpecDetectResult {
            provider: "bmad".to_string(),
            detected: bmad.detect(&project),
        },
        SpecDetectResult {
            provider: "custom".to_string(),
            detected: project.join(".cursor/rules/custom.mdc").exists()
                || project.join("CLAUDE.md").exists()
                || project.join("GEMINI.md").exists()
                || project.join("AGENTS.md").exists(),
        },
    ]
}

#[command]
pub fn spec_preview(
    provider: String,
    mode: String,
    target_ide: String,
    state: tauri::State<'_, AppConfigState>,
) -> Result<Vec<SpecPreviewResult>, String> {
    let cfg = state.get();
    let mut results = Vec::new();

    if provider == "none" {
        return Ok(results);
    }

    if provider == "bmad" {
        if mode == "full" {
            let src = cfg.providers.bmad.source_path.trim().to_string();
            if src.is_empty() {
                return Err("bmad full install requires providers.bmad.source_path to be set".to_string());
            }
            results.push(SpecPreviewResult {
                file_path: "_bmad/".to_string(),
                content: format!("Will copy directory from: {src}"),
            });
        } else {
            let path = match target_ide.as_str() {
                "cursor" => ".cursor/rules/bmad.mdc",
                "claude" => "CLAUDE.md",
                "gemini" => "GEMINI.md",
                _ => "AGENTS.md",
            };
            results.push(SpecPreviewResult {
                file_path: path.to_string(),
                content: BMAD_RULES_TEMPLATE.to_string(),
            });
        }
    } else if provider == "custom" {
        let custom = cfg.providers.custom;
        let content = if custom.rules_content.trim().is_empty() {
            CUSTOM_RULES_TEMPLATE
        } else {
            &custom.rules_content
        };
        let path = match target_ide.as_str() {
            "cursor" => ".cursor/rules/custom.mdc",
            "claude" => "CLAUDE.md",
            "gemini" => "GEMINI.md",
            _ => "AGENTS.md",
        };
        results.push(SpecPreviewResult {
            file_path: path.to_string(),
            content: content.to_string(),
        });
    } else {
        return Err(format!("unsupported provider: {provider}"));
    }

    Ok(results)
}

#[command]
pub fn spec_backup(project_path: String) -> Result<Vec<String>, String> {
    let project = PathBuf::from(project_path);
    let mut backed_up = Vec::new();

    let paths_to_backup = [
        project.join(".cursor/rules/bmad.mdc"),
        project.join(".cursor/rules/custom.mdc"),
        project.join("CLAUDE.md"),
        project.join("GEMINI.md"),
        project.join("AGENTS.md"),
    ];

    for p in paths_to_backup {
        if p.exists() && p.is_file() {
            let mut backup_path = p.clone().into_os_string();
            backup_path.push(".bmad-bak");
            let backup_p = PathBuf::from(backup_path);
            if fs::copy(&p, &backup_p).is_ok() {
                backed_up.push(p.to_string_lossy().to_string());
            }
        }
    }

    Ok(backed_up)
}

#[command]
pub fn spec_restore(project_path: String) -> Result<Vec<String>, String> {
    let project = PathBuf::from(project_path);
    let mut restored = Vec::new();

    let paths_to_restore = [
        project.join(".cursor/rules/bmad.mdc"),
        project.join(".cursor/rules/custom.mdc"),
        project.join("CLAUDE.md"),
        project.join("GEMINI.md"),
        project.join("AGENTS.md"),
    ];

    for p in paths_to_restore {
        let mut backup_path = p.clone().into_os_string();
        backup_path.push(".bmad-bak");
        let backup_p = PathBuf::from(backup_path);
        
        if backup_p.exists() && backup_p.is_file() {
            if fs::copy(&backup_p, &p).is_ok() {
                let _ = fs::remove_file(&backup_p);
                restored.push(p.to_string_lossy().to_string());
            }
        }
    }

    Ok(restored)
}
