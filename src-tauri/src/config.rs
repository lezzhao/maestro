use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{command, AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSection {
    pub language: String,
    pub theme: String,
    pub default_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectSection {
    pub path: String,
    pub detected_stack: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineProfile {
    pub id: String,
    pub display_name: String,
    pub command: String,
    #[serde(default)]
    pub model: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub supports_headless: bool,
    pub headless_args: Vec<String>,
    pub ready_signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub profiles: BTreeMap<String, EngineProfile>,
    #[serde(default)]
    pub active_profile_id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub exit_command: String,
    pub exit_timeout_ms: u64,
    #[serde(default)]
    pub supports_headless: bool,
    #[serde(default)]
    pub headless_args: Vec<String>,
    #[serde(default)]
    pub ready_signal: Option<String>,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSection {
    pub enabled: bool,
    pub active_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecProviderBmad {
    pub display_name: String,
    pub version: String,
    pub source_path: String,
    pub install_mode: String,
    pub target_ide: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecProviderCustom {
    pub display_name: String,
    pub source_path: String,
    pub rules_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecProviders {
    pub bmad: SpecProviderBmad,
    pub custom: SpecProviderCustom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowConfig {
    pub name: String,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowStep {
    pub engine: String,
    pub prompt: String,
    pub completion_signal: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub app: AppSection,
    pub project: ProjectSection,
    pub engines: BTreeMap<String, EngineConfig>,
    pub spec: SpecSection,
    pub providers: SpecProviders,
    pub workflows: Vec<WorkflowConfig>,
}

impl Default for AppSection {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            theme: "dark".to_string(),
            default_mode: "manual".to_string(),
        }
    }
}

impl Default for SpecSection {
    fn default() -> Self {
        Self {
            enabled: false,
            active_provider: String::new(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut engines = BTreeMap::new();
        engines.insert(
            "cursor".to_string(),
            EngineConfig {
                id: "cursor".to_string(),
                display_name: "Cursor Agent".to_string(),
                profiles: {
                    let mut m = BTreeMap::new();
                    m.insert(
                        "default".to_string(),
                        EngineProfile {
                            id: "default".to_string(),
                            display_name: "Default".to_string(),
                            command: "cursor".to_string(),
                            model: String::new(),
                            args: vec!["agent".to_string()],
                            env: BTreeMap::new(),
                            supports_headless: true,
                            headless_args: vec!["agent".to_string(), "--print".to_string()],
                            ready_signal: Some(">".to_string()),
                        },
                    );
                    m
                },
                active_profile_id: "default".to_string(),
                command: "cursor".to_string(),
                args: vec!["agent".to_string()],
                env: BTreeMap::new(),
                exit_command: "ctrl-c".to_string(),
                exit_timeout_ms: 3000,
                supports_headless: true,
                headless_args: vec!["agent".to_string(), "--print".to_string()],
                ready_signal: Some(">".to_string()),
                icon: "terminal-square".to_string(),
            },
        );
        engines.insert(
            "claude".to_string(),
            EngineConfig {
                id: "claude".to_string(),
                display_name: "Claude Code".to_string(),
                profiles: {
                    let mut m = BTreeMap::new();
                    m.insert(
                        "default".to_string(),
                        EngineProfile {
                            id: "default".to_string(),
                            display_name: "Default".to_string(),
                            command: "claude".to_string(),
                            model: String::new(),
                            args: vec![],
                            env: BTreeMap::new(),
                            supports_headless: true,
                            headless_args: vec!["-p".to_string()],
                            ready_signal: Some(">".to_string()),
                        },
                    );
                    m
                },
                active_profile_id: "default".to_string(),
                command: "claude".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                exit_command: "/exit".to_string(),
                exit_timeout_ms: 3000,
                supports_headless: true,
                headless_args: vec!["-p".to_string()],
                ready_signal: Some(">".to_string()),
                icon: "bot".to_string(),
            },
        );
        engines.insert(
            "gemini".to_string(),
            EngineConfig {
                id: "gemini".to_string(),
                display_name: "Gemini CLI".to_string(),
                profiles: {
                    let mut m = BTreeMap::new();
                    m.insert(
                        "default".to_string(),
                        EngineProfile {
                            id: "default".to_string(),
                            display_name: "Default".to_string(),
                            command: "gemini".to_string(),
                            model: String::new(),
                            args: vec![],
                            env: BTreeMap::new(),
                            supports_headless: false,
                            headless_args: vec![],
                            ready_signal: Some(">".to_string()),
                        },
                    );
                    m
                },
                active_profile_id: "default".to_string(),
                command: "gemini".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                exit_command: "/exit".to_string(),
                exit_timeout_ms: 3000,
                supports_headless: false,
                headless_args: vec![],
                ready_signal: Some(">".to_string()),
                icon: "sparkles".to_string(),
            },
        );
        engines.insert(
            "opencode".to_string(),
            EngineConfig {
                id: "opencode".to_string(),
                display_name: "OpenCode".to_string(),
                profiles: {
                    let mut m = BTreeMap::new();
                    m.insert(
                        "default".to_string(),
                        EngineProfile {
                            id: "default".to_string(),
                            display_name: "Default".to_string(),
                            command: "opencode".to_string(),
                            model: String::new(),
                            args: vec![],
                            env: BTreeMap::new(),
                            supports_headless: false,
                            headless_args: vec![],
                            ready_signal: Some(">".to_string()),
                        },
                    );
                    m
                },
                active_profile_id: "default".to_string(),
                command: "opencode".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                exit_command: "ctrl-c".to_string(),
                exit_timeout_ms: 3000,
                supports_headless: false,
                headless_args: vec![],
                ready_signal: Some(">".to_string()),
                icon: "code".to_string(),
            },
        );
        engines.insert(
            "codex".to_string(),
            EngineConfig {
                id: "codex".to_string(),
                display_name: "Codex".to_string(),
                profiles: {
                    let mut m = BTreeMap::new();
                    m.insert(
                        "default".to_string(),
                        EngineProfile {
                            id: "default".to_string(),
                            display_name: "Default".to_string(),
                            command: "codex".to_string(),
                            model: String::new(),
                            args: vec![],
                            env: BTreeMap::new(),
                            supports_headless: false,
                            headless_args: vec![],
                            ready_signal: Some(">".to_string()),
                        },
                    );
                    m
                },
                active_profile_id: "default".to_string(),
                command: "codex".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                exit_command: "/exit".to_string(),
                exit_timeout_ms: 3000,
                supports_headless: false,
                headless_args: vec![],
                ready_signal: Some(">".to_string()),
                icon: "zap".to_string(),
            },
        );

        Self {
            app: AppSection::default(),
            project: ProjectSection::default(),
            engines,
            spec: SpecSection::default(),
            providers: SpecProviders {
                bmad: SpecProviderBmad {
                    display_name: "BMAD".to_string(),
                    version: "6.0.4".to_string(),
                    source_path: String::new(),
                    install_mode: "rules_only".to_string(),
                    target_ide: "cursor".to_string(),
                },
                custom: SpecProviderCustom {
                    display_name: "自定义规范".to_string(),
                    source_path: String::new(),
                    rules_content: String::new(),
                },
            },
            workflows: vec![],
        }
    }
}

#[derive(Default)]
pub struct AppConfigState {
    inner: RwLock<AppConfig>,
}

impl AppConfigState {
    pub fn new(config: AppConfig) -> Self {
        Self {
            inner: RwLock::new(config),
        }
    }

    pub fn get(&self) -> AppConfig {
        self.inner.read().expect("config read lock poisoned").clone()
    }

    pub fn set(&self, next: AppConfig) {
        *self.inner.write().expect("config write lock poisoned") = next;
    }
}

impl EngineConfig {
    pub fn active_profile(&self) -> EngineProfile {
        if let Some(profile) = self.profiles.get(&self.active_profile_id) {
            return profile.clone();
        }
        if let Some((_id, profile)) = self.profiles.iter().next() {
            return profile.clone();
        }
        EngineProfile {
            id: "default".to_string(),
            display_name: "Default".to_string(),
            command: self.command.clone(),
            model: String::new(),
            args: self.args.clone(),
            env: self.env.clone(),
            supports_headless: self.supports_headless,
            headless_args: self.headless_args.clone(),
            ready_signal: self.ready_signal.clone(),
        }
    }
}

fn migrate_engine_profiles(config: &mut AppConfig) {
    for engine in config.engines.values_mut() {
        if engine.profiles.is_empty() {
            let profile_id = "default".to_string();
            engine.profiles.insert(
                profile_id.clone(),
                EngineProfile {
                    id: profile_id.clone(),
                    display_name: "Default".to_string(),
                    command: engine.command.clone(),
                    model: String::new(),
                    args: engine.args.clone(),
                    env: engine.env.clone(),
                    supports_headless: engine.supports_headless,
                    headless_args: engine.headless_args.clone(),
                    ready_signal: engine.ready_signal.clone(),
                },
            );
            engine.active_profile_id = profile_id;
        }
        if engine.active_profile_id.trim().is_empty()
            || !engine.profiles.contains_key(&engine.active_profile_id)
        {
            if let Some(first_key) = engine.profiles.keys().next().cloned() {
                engine.active_profile_id = first_key;
            }
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config dir: {e}"))?;
    Ok(dir.join("config.toml"))
}

pub fn write_config_to_disk(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let content =
        toml::to_string_pretty(config).map_err(|e| format!("toml serialize failed: {e}"))?;
    fs::write(path, content).map_err(|e| format!("failed to save config: {e}"))?;
    Ok(())
}

#[command]
pub fn load_or_create_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("failed to read config: {e}"))?;
        let mut config =
            toml::from_str::<AppConfig>(&raw).map_err(|e| format!("failed to parse config.toml: {e}"))?;
        migrate_engine_profiles(&mut config);
        Ok(config)
    } else {
        let default = AppConfig::default();
        let content =
            toml::to_string_pretty(&default).map_err(|e| format!("toml serialize failed: {e}"))?;
        fs::write(path, content).map_err(|e| format!("failed to write default config: {e}"))?;
        Ok(default)
    }
}

#[command]
pub fn save_config(app: AppHandle, config: AppConfig, state: tauri::State<'_, AppConfigState>) -> Result<(), String> {
    let mut config = config;
    migrate_engine_profiles(&mut config);
    write_config_to_disk(&app, &config)?;
    state.set(config);
    Ok(())
}
