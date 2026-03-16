use crate::config::SpecProviderBmad;
use crate::project::validate_project_scope;
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
    fn preview(&self, mode: &str, target_ide: &str) -> Result<Vec<SpecPreviewResult>, String>;
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

    fn preview(&self, mode: &str, target_ide: &str) -> Result<Vec<SpecPreviewResult>, String> {
        let mut results = Vec::new();
        if mode == "full" {
            let src = self.conf.source_path.trim().to_string();
            if src.is_empty() {
                return Err("bmad full install requires providers.bmad.source_path to be set".to_string());
            }
            results.push(SpecPreviewResult {
                file_path: "_bmad/".to_string(),
                content: format!("Will copy directory from: {src}"),
            });
        } else {
            let path = match target_ide {
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
        Ok(results)
    }
}

pub struct CustomProvider {
    conf: crate::config::SpecProviderCustom,
}

impl CustomProvider {
    pub fn new(conf: crate::config::SpecProviderCustom) -> Self {
        Self { conf }
    }
}

impl SpecProvider for CustomProvider {
    fn id(&self) -> &str {
        "custom"
    }

    fn display_name(&self) -> &str {
        &self.conf.display_name
    }

    fn inject(&self, project_path: &Path, _mode: &str, target_ide: &str) -> Result<(), String> {
        let content = if self.conf.rules_content.trim().is_empty() {
            CUSTOM_RULES_TEMPLATE
        } else {
            &self.conf.rules_content
        };
        let file = match target_ide {
            "cursor" => project_path.join(".cursor/rules/custom.mdc"),
            "claude" => project_path.join("CLAUDE.md"),
            "gemini" => project_path.join("GEMINI.md"),
            _ => project_path.join("AGENTS.md"),
        };
        ensure_parent(&file)?;
        fs::write(file, content).map_err(|e| format!("write custom rules failed: {e}"))
    }

    fn remove(&self, project_path: &Path) -> Result<(), String> {
        let maybe_paths = [
            project_path.join(".cursor/rules/custom.mdc"),
            project_path.join("CLAUDE.md"),
            project_path.join("GEMINI.md"),
            project_path.join("AGENTS.md"),
        ];
        for p in maybe_paths {
            if p.exists() {
                let _ = fs::remove_file(p);
            }
        }
        Ok(())
    }

    fn detect(&self, project_path: &Path) -> bool {
        project_path.join(".cursor/rules/custom.mdc").exists()
            || project_path.join("CLAUDE.md").exists()
            || project_path.join("GEMINI.md").exists()
            || project_path.join("AGENTS.md").exists()
    }

    fn preview(&self, _mode: &str, target_ide: &str) -> Result<Vec<SpecPreviewResult>, String> {
        let mut results = Vec::new();
        let content = if self.conf.rules_content.trim().is_empty() {
            CUSTOM_RULES_TEMPLATE
        } else {
            &self.conf.rules_content
        };
        let path = match target_ide {
            "cursor" => ".cursor/rules/custom.mdc",
            "claude" => "CLAUDE.md",
            "gemini" => "GEMINI.md",
            _ => "AGENTS.md",
        };
        results.push(SpecPreviewResult {
            file_path: path.to_string(),
            content: content.to_string(),
        });
        Ok(results)
    }
}

pub struct SpecProviderRegistry {
    providers: Vec<Box<dyn SpecProvider>>,
}

impl SpecProviderRegistry {
    pub fn new(cfg: &crate::config::AppConfig) -> Self {
        Self {
            providers: vec![
                Box::new(BmadProvider::new(cfg.providers.bmad.clone())),
                Box::new(CustomProvider::new(cfg.providers.custom.clone())),
            ],
        }
    }

    pub fn get(&self, id: &str) -> Option<&dyn SpecProvider> {
        self.providers.iter().find(|p| p.id() == id).map(|p| p.as_ref())
    }

    pub fn all(&self) -> impl Iterator<Item = &dyn SpecProvider> {
        self.providers.iter().map(|p| p.as_ref())
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
pub fn spec_list(core_state: tauri::State<'_, crate::core::MaestroCore>) -> Vec<SpecDescriptor> {
    let cfg = core_state.inner().config.get();
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
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    if provider == "none" {
        return Ok(());
    }
    let cfg = core_state.inner().config.get();
    let allowed = cfg.project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
    let registry = SpecProviderRegistry::new(&cfg);
    let p = registry.get(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let project = PathBuf::from(project_path);
    p.inject(&project, &mode, &target_ide)
}

#[command]
pub fn spec_remove(
    provider: String,
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    if provider == "none" {
        return Ok(());
    }
    let cfg = core_state.inner().config.get();
    let allowed = cfg.project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
    let registry = SpecProviderRegistry::new(&cfg);
    let p = registry.get(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let project = PathBuf::from(project_path);
    p.remove(&project)
}

#[command]
pub fn spec_detect(
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Vec<SpecDetectResult> {
    let cfg = core_state.inner().config.get();
    let project = PathBuf::from(project_path);
    let registry = SpecProviderRegistry::new(&cfg);
    registry
        .all()
        .map(|p| SpecDetectResult {
            provider: p.id().to_string(),
            detected: p.detect(&project),
        })
        .collect()
}

#[command]
pub fn spec_preview(
    provider: String,
    mode: String,
    target_ide: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<Vec<SpecPreviewResult>, String> {
    if provider == "none" {
        return Ok(Vec::new());
    }
    let cfg = core_state.inner().config.get();
    let registry = SpecProviderRegistry::new(&cfg);
    let p = registry.get(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    p.preview(&mode, &target_ide)
}

#[command]
pub fn spec_backup(
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<Vec<String>, String> {
    let allowed = core_state.inner().config.get().project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
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
pub fn spec_restore(
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<Vec<String>, String> {
    let allowed = core_state.inner().config.get().project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
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
