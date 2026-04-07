use crate::config::SpecProviderMaestro;
use crate::infra::scoped_fs::ScopedFS;
use crate::infra::workspace_io::WorkspaceIo;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::command;

const MAESTRO_RULES_TEMPLATE: &str = r#"# Maestro Rules

Use Maestro process: Brief -> Model -> Action -> Done.
"#;

const CUSTOM_RULES_TEMPLATE: &str = "# Custom rules\n";

#[allow(dead_code)]
pub trait SpecProvider: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn inject(
        &self,
        workspace_io: &WorkspaceIo,
        mode: &str,
        target_ide: &str,
    ) -> Result<(), String>;
    fn remove(&self, workspace_io: &WorkspaceIo) -> Result<(), String>;
    fn detect(&self, project_path: &Path) -> bool;
    fn preview(&self, mode: &str, target_ide: &str) -> Result<Vec<SpecPreviewResult>, String>;
}

#[derive(Clone)]
pub struct MaestroProvider {
    conf: SpecProviderMaestro,
}

impl MaestroProvider {
    pub fn new(conf: SpecProviderMaestro) -> Self {
        Self { conf }
    }
}

impl SpecProvider for MaestroProvider {
    fn id(&self) -> &str {
        "maestro"
    }

    fn display_name(&self) -> &str {
        &self.conf.display_name
    }

    fn inject(
        &self,
        workspace_io: &WorkspaceIo,
        mode: &str,
        target_ide: &str,
    ) -> Result<(), String> {
        match mode {
            "full" => {
                let src = self.conf.source_path.trim();
                if src.is_empty() {
                    return Err(
                        "maestro full install requires providers.maestro.source_path to be set"
                            .to_string(),
                    );
                }
                workspace_io.copy_dir_from(Path::new(src), "_maestro")?;
            }
            _ => {
                let content = MAESTRO_RULES_TEMPLATE;
                let rel_path = match target_ide {
                    "cursor" => ".cursor/rules/maestro.mdc",
                    "claude" => "CLAUDE.md",
                    "gemini" => "GEMINI.md",
                    _ => "AGENTS.md",
                };
                workspace_io.write_text(rel_path, content)?;
            }
        }
        Ok(())
    }

    fn remove(&self, workspace_io: &WorkspaceIo) -> Result<(), String> {
        let maybe_paths = [
            "_maestro",
            ".cursor/rules/maestro.mdc",
            "CLAUDE.md",
            "GEMINI.md",
            "AGENTS.md",
        ];
        for p in maybe_paths {
            let _ = workspace_io.remove_path(p);
        }
        Ok(())
    }

    fn detect(&self, project_path: &Path) -> bool {
        project_path.join("_maestro").exists()
            || project_path.join(".cursor/rules/maestro.mdc").exists()
            || project_path.join("CLAUDE.md").exists()
            || project_path.join("GEMINI.md").exists()
    }

    fn preview(&self, mode: &str, target_ide: &str) -> Result<Vec<SpecPreviewResult>, String> {
        let mut results = Vec::new();
        if mode == "full" {
            let src = self.conf.source_path.trim().to_string();
            if src.is_empty() {
                return Err(
                    "maestro full install requires providers.maestro.source_path to be set".to_string(),
                );
            }
            results.push(SpecPreviewResult {
                file_path: "_maestro/".to_string(),
                content: format!("Will copy directory from: {src}"),
            });
        } else {
            let path = match target_ide {
                "cursor" => ".cursor/rules/maestro.mdc",
                "claude" => "CLAUDE.md",
                "gemini" => "GEMINI.md",
                _ => "AGENTS.md",
            };
            results.push(SpecPreviewResult {
                file_path: path.to_string(),
                content: MAESTRO_RULES_TEMPLATE.to_string(),
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

    fn inject(
        &self,
        workspace_io: &WorkspaceIo,
        _mode: &str,
        target_ide: &str,
    ) -> Result<(), String> {
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

    fn remove(&self, workspace_io: &WorkspaceIo) -> Result<(), String> {
        let maybe_paths = [
            ".cursor/rules/custom.mdc",
            "CLAUDE.md",
            "GEMINI.md",
            "AGENTS.md",
        ];
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
                Box::new(MaestroProvider::new(cfg.providers.maestro.clone())),
                Box::new(CustomProvider::new(cfg.providers.custom.clone())),
            ],
        }
    }

    pub fn get(&self, id: &str) -> Option<&dyn SpecProvider> {
        self.providers
            .iter()
            .find(|p| p.id() == id)
            .map(|p| p.as_ref())
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
            display_name: cfg.i18n().t("spec_none"),
            modes: vec![],
        },
        SpecDescriptor {
            id: "maestro".to_string(),
            display_name: cfg.providers.maestro.display_name.clone(),
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
    let scoped = ScopedFS::new(&project_path)?;
    if !allowed.is_empty() && scoped.root() != std::path::Path::new(&allowed).canonicalize().unwrap_or_default() {
        return Err("project path is outside allowed workspace scope".to_string());
    }
    let registry = SpecProviderRegistry::new(cfg);
    let p = registry
        .get(&provider)
        .ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let project = PathBuf::from(project_path.clone());
    let workspace_io = WorkspaceIo::new(&project)?;
    p.inject(&workspace_io, &mode, &target_ide)
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
    let scoped = ScopedFS::new(&project_path)?;
    if !allowed.is_empty() && scoped.root() != std::path::Path::new(&allowed).canonicalize().unwrap_or_default() {
        return Err("project path is outside allowed workspace scope".to_string());
    }
    let registry = SpecProviderRegistry::new(cfg);
    let p = registry
        .get(&provider)
        .ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let project = PathBuf::from(project_path.clone());
    let workspace_io = WorkspaceIo::new(&project)?;
    p.remove(&workspace_io)
}

pub fn spec_detect_core(
    cfg: &crate::config::AppConfig,
    project_path: String,
) -> Vec<SpecDetectResult> {
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
    let p = registry
        .get(&provider)
        .ok_or_else(|| format!("unsupported provider: {provider}"))?;
    p.preview(&mode, &target_ide)
}

pub fn spec_backup_core(
    cfg: &crate::config::AppConfig,
    project_path: String,
) -> Result<Vec<String>, String> {
    let allowed = cfg.project.path.clone();
    let scoped = ScopedFS::new(&project_path)?;
    if !allowed.is_empty() && scoped.root() != std::path::Path::new(&allowed).canonicalize().unwrap_or_default() {
        return Err("project path is outside allowed workspace scope".to_string());
    }
    let project = PathBuf::from(project_path);
    let workspace_io = WorkspaceIo::new(&project)?;
    let mut backed_up = Vec::new();
    let paths_to_backup = [
        ".cursor/rules/maestro.mdc",
        ".cursor/rules/custom.mdc",
        "CLAUDE.md",
        "GEMINI.md",
        "AGENTS.md",
    ];
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
    let scoped = ScopedFS::new(&project_path)?;
    if !allowed.is_empty() && scoped.root() != std::path::Path::new(&allowed).canonicalize().unwrap_or_default() {
        return Err("project path is outside allowed workspace scope".to_string());
    }
    let project = PathBuf::from(project_path);
    let workspace_io = WorkspaceIo::new(&project)?;
    let mut restored = Vec::new();
    let paths_to_restore = [
        ".cursor/rules/maestro.mdc",
        ".cursor/rules/custom.mdc",
        "CLAUDE.md",
        "GEMINI.md",
        "AGENTS.md",
    ];
    for p in paths_to_restore {
        if let Some(dst) = workspace_io.restore_file_if_exists(p)? {
            restored.push(dst.to_string_lossy().to_string());
        }
    }
    Ok(restored)
}

#[command]
pub fn spec_list(core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>) -> Vec<SpecDescriptor> {
    core_state.inner().spec_list()
}

#[command]
pub fn spec_inject(
    provider: String,
    project_path: String,
    mode: String,
    target_ide: String,
    core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<(), crate::core::error::CoreError> {
    core_state
        .inner()
        .spec_inject(provider, project_path, mode, target_ide)
}

#[command]
pub fn spec_remove(
    provider: String,
    project_path: String,
    core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<(), crate::core::error::CoreError> {
    core_state.inner().spec_remove(provider, project_path)
}

#[command]
pub fn spec_detect(
    project_path: String,
    core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Vec<SpecDetectResult> {
    core_state.inner().spec_detect(project_path)
}

#[command]
pub fn spec_preview(
    provider: String,
    mode: String,
    target_ide: String,
    core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<SpecPreviewResult>, crate::core::error::CoreError> {
    core_state.inner().spec_preview(provider, mode, target_ide)
}

#[command]
pub fn spec_backup(
    project_path: String,
    core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<String>, crate::core::error::CoreError> {
    core_state.inner().spec_backup(project_path)
}

#[command]
pub fn spec_restore(
    project_path: String,
    core_state: tauri::State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Vec<String>, crate::core::error::CoreError> {
    core_state.inner().spec_restore(project_path)
}
