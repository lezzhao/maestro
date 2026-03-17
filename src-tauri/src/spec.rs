use crate::config::SpecProviderBmad;
use crate::project::validate_project_scope;
use crate::workspace_io::WorkspaceIo;
use serde::Serialize;
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
        let workspace_io = WorkspaceIo::new(project_path)?;
        match mode {
            "full" => {
                let src = self.conf.source_path.trim();
                if src.is_empty() {
                    return Err(
                        "bmad full install requires providers.bmad.source_path to be set"
                            .to_string(),
                    );
                }
                workspace_io.copy_dir_from(Path::new(src), "_bmad")?;
            }
            _ => {
                let content = BMAD_RULES_TEMPLATE;
                let rel_path = match target_ide {
                    "cursor" => ".cursor/rules/bmad.mdc",
                    "claude" => "CLAUDE.md",
                    "gemini" => "GEMINI.md",
                    _ => "AGENTS.md",
                };
                workspace_io.write_text(rel_path, content)?;
            }
        }
        Ok(())
    }

    fn remove(&self, project_path: &Path) -> Result<(), String> {
        let workspace_io = WorkspaceIo::new(project_path)?;
        let maybe_paths = ["_bmad", ".cursor/rules/bmad.mdc", "CLAUDE.md", "GEMINI.md", "AGENTS.md"];
        for p in maybe_paths {
            let _ = workspace_io.remove_path(p);
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
        let workspace_io = WorkspaceIo::new(project_path)?;
        let content = if self.conf.rules_content.trim().is_empty() {
            CUSTOM_RULES_TEMPLATE
        } else {
            &self.conf.rules_content
        };
        let rel_path = match target_ide {
            "cursor" => ".cursor/rules/custom.mdc",
            "claude" => "CLAUDE.md",
            "gemini" => "GEMINI.md",
            _ => "AGENTS.md",
        };
        workspace_io.write_text(rel_path, content)
    }

    fn remove(&self, project_path: &Path) -> Result<(), String> {
        let workspace_io = WorkspaceIo::new(project_path)?;
        let maybe_paths = [".cursor/rules/custom.mdc", "CLAUDE.md", "GEMINI.md", "AGENTS.md"];
        for p in maybe_paths {
            let _ = workspace_io.remove_path(p);
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

pub fn spec_descriptors(cfg: &crate::config::AppConfig) -> Vec<SpecDescriptor> {
    vec![
        SpecDescriptor {
            id: "none".to_string(),
            display_name: "无规范".to_string(),
            modes: vec![],
        },
        SpecDescriptor {
            id: "bmad".to_string(),
            display_name: cfg.providers.bmad.display_name.clone(),
            modes: vec!["full".to_string(), "rules_only".to_string()],
        },
        SpecDescriptor {
            id: "custom".to_string(),
            display_name: cfg.providers.custom.display_name.clone(),
            modes: vec!["rules_only".to_string()],
        },
    ]
}

pub fn spec_inject_core(
    cfg: &crate::config::AppConfig,
    provider: String,
    project_path: String,
    mode: String,
    target_ide: String,
) -> Result<(), String> {
    if provider == "none" {
        return Ok(());
    }
    let allowed = cfg.project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
    let registry = SpecProviderRegistry::new(cfg);
    let p = registry.get(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let project = PathBuf::from(project_path);
    p.inject(&project, &mode, &target_ide)
}

pub fn spec_remove_core(
    cfg: &crate::config::AppConfig,
    provider: String,
    project_path: String,
) -> Result<(), String> {
    if provider == "none" {
        return Ok(());
    }
    let allowed = cfg.project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
    let registry = SpecProviderRegistry::new(cfg);
    let p = registry.get(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let project = PathBuf::from(project_path);
    p.remove(&project)
}

pub fn spec_detect_core(cfg: &crate::config::AppConfig, project_path: String) -> Vec<SpecDetectResult> {
    let project = PathBuf::from(project_path);
    let registry = SpecProviderRegistry::new(cfg);
    registry
        .all()
        .map(|p| SpecDetectResult {
            provider: p.id().to_string(),
            detected: p.detect(&project),
        })
        .collect()
}

pub fn spec_preview_core(
    cfg: &crate::config::AppConfig,
    provider: String,
    mode: String,
    target_ide: String,
) -> Result<Vec<SpecPreviewResult>, String> {
    if provider == "none" {
        return Ok(Vec::new());
    }
    let registry = SpecProviderRegistry::new(cfg);
    let p = registry.get(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    p.preview(&mode, &target_ide)
}

pub fn spec_backup_core(
    cfg: &crate::config::AppConfig,
    project_path: String,
) -> Result<Vec<String>, String> {
    let allowed = cfg.project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
    let project = PathBuf::from(project_path);
    let workspace_io = WorkspaceIo::new(&project)?;
    let mut backed_up = Vec::new();
    let paths_to_backup = [".cursor/rules/bmad.mdc", ".cursor/rules/custom.mdc", "CLAUDE.md", "GEMINI.md", "AGENTS.md"];
    for p in paths_to_backup {
        if let Some(src) = workspace_io.backup_file_if_exists(p)? {
            backed_up.push(src.to_string_lossy().to_string());
        }
    }
    Ok(backed_up)
}

pub fn spec_restore_core(
    cfg: &crate::config::AppConfig,
    project_path: String,
) -> Result<Vec<String>, String> {
    let allowed = cfg.project.path.clone();
    if !allowed.is_empty() {
        validate_project_scope(&project_path, &allowed)?;
    }
    let project = PathBuf::from(project_path);
    let workspace_io = WorkspaceIo::new(&project)?;
    let mut restored = Vec::new();
    let paths_to_restore = [".cursor/rules/bmad.mdc", ".cursor/rules/custom.mdc", "CLAUDE.md", "GEMINI.md", "AGENTS.md"];
    for p in paths_to_restore {
        if let Some(dst) = workspace_io.restore_file_if_exists(p)? {
            restored.push(dst.to_string_lossy().to_string());
        }
    }
    Ok(restored)
}

#[command]
pub fn spec_list(core_state: tauri::State<'_, crate::core::MaestroCore>) -> Vec<SpecDescriptor> {
    core_state.inner().spec_list()
}

#[command]
pub fn spec_inject(
    provider: String,
    project_path: String,
    mode: String,
    target_ide: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    core_state
        .inner()
        .spec_inject(provider, project_path, mode, target_ide)
}

#[command]
pub fn spec_remove(
    provider: String,
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    core_state.inner().spec_remove(provider, project_path)
}

#[command]
pub fn spec_detect(
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Vec<SpecDetectResult> {
    core_state.inner().spec_detect(project_path)
}

#[command]
pub fn spec_preview(
    provider: String,
    mode: String,
    target_ide: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<Vec<SpecPreviewResult>, String> {
    core_state.inner().spec_preview(provider, mode, target_ide)
}

#[command]
pub fn spec_backup(
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<Vec<String>, String> {
    core_state.inner().spec_backup(project_path)
}

#[command]
pub fn spec_restore(
    project_path: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<Vec<String>, String> {
    core_state.inner().spec_restore(project_path)
}
