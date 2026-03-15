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
    #[serde(default = "default_execution_mode")]
    pub execution_mode: String,
    #[serde(default)]
    pub api_provider: Option<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
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
    #[serde(default = "default_execution_mode")]
    pub execution_mode: String,
    #[serde(default)]
    pub api_provider: Option<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
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

        // Cursor Agent: 有自定义 args 和 headless_args
        let mut cursor = EngineConfig::new(
            "cursor", "Cursor Agent", "cursor", "ctrl-c",
            true, vec!["agent".to_string(), "--print".to_string()], ">", "terminal-square",
        );
        // Cursor 默认 args 不是空的，需要覆盖
        cursor.args = vec!["agent".to_string()];
        if let Some(p) = cursor.profiles.get_mut("default") {
            p.args = vec!["agent".to_string()];
        }
        engines.insert("cursor".to_string(), cursor);

        engines.insert("claude".to_string(), EngineConfig::new(
            "claude", "Claude Code", "claude", "/exit",
            true, vec!["-p".to_string()], ">", "bot",
        ));

        engines.insert("gemini".to_string(), EngineConfig::new(
            "gemini", "Gemini CLI", "gemini", "/exit",
            true, vec!["-p".to_string()], ">", "sparkles",
        ));

        engines.insert("opencode".to_string(), EngineConfig::new(
            "opencode", "OpenCode", "opencode", "ctrl-c",
            true, vec!["run".to_string()], ">", "code",
        ));

        engines.insert("codex".to_string(), EngineConfig::new(
            "codex", "Codex", "codex", "/exit",
            true, vec!["exec".to_string()], ">", "zap",
        ));

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
    pub fn new(
        id: &str,
        display_name: &str,
        command: &str,
        exit_command: &str,
        supports_headless: bool,
        headless_args: Vec<String>,
        ready_signal: &str,
        icon: &str,
    ) -> Self {
        let profile = EngineProfile {
            id: "default".to_string(),
            display_name: "Default".to_string(),
            command: command.to_string(),
            model: String::new(),
            args: vec![],
            env: BTreeMap::new(),
            supports_headless,
            headless_args: headless_args.clone(),
            ready_signal: Some(ready_signal.to_string()),
            execution_mode: default_execution_mode(),
            api_provider: None,
            api_base_url: None,
            api_key: None,
        };
        let mut profiles = BTreeMap::new();
        profiles.insert("default".to_string(), profile);

        Self {
            id: id.to_string(),
            display_name: display_name.to_string(),
            profiles,
            active_profile_id: "default".to_string(),
            command: command.to_string(),
            args: vec![],
            env: BTreeMap::new(),
            exit_command: exit_command.to_string(),
            exit_timeout_ms: 3000,
            supports_headless,
            headless_args,
            ready_signal: Some(ready_signal.to_string()),
            execution_mode: default_execution_mode(),
            api_provider: None,
            api_base_url: None,
            api_key: None,
            icon: icon.to_string(),
        }
    }

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
            execution_mode: self.execution_mode.clone(),
            api_provider: self.api_provider.clone(),
            api_base_url: self.api_base_url.clone(),
            api_key: self.api_key.clone(),
        }
    }
}

fn is_valid_execution_mode(mode: &str) -> bool {
    matches!(mode, "cli" | "api")
}

fn normalize_execution_mode(mode: &str) -> String {
    if is_valid_execution_mode(mode) {
        mode.to_string()
    } else {
        default_execution_mode()
    }
}

fn builtin_headless_defaults(engine_id: &str) -> Option<(bool, Vec<String>)> {
    match engine_id {
        "cursor" => Some((true, vec!["agent".to_string(), "--print".to_string()])),
        "claude" => Some((true, vec!["-p".to_string()])),
        "gemini" => Some((true, vec!["-p".to_string()])),
        "opencode" => Some((true, vec!["run".to_string()])),
        "codex" => Some((true, vec!["exec".to_string()])),
        _ => None,
    }
}

fn migrate_engine_profiles(config: &mut AppConfig) {
    for (engine_id, engine) in config.engines.iter_mut() {
        engine.execution_mode = normalize_execution_mode(&engine.execution_mode);
        if let Some((supports_headless, default_headless_args)) =
            builtin_headless_defaults(engine_id.as_str())
        {
            engine.supports_headless = supports_headless;
            if engine.headless_args.is_empty() {
                engine.headless_args = default_headless_args;
            }
        }
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
                    execution_mode: engine.execution_mode.clone(),
                    api_provider: engine.api_provider.clone(),
                    api_base_url: engine.api_base_url.clone(),
                    api_key: engine.api_key.clone(),
                },
            );
            engine.active_profile_id = profile_id;
        }
        for (profile_id, profile) in engine.profiles.iter_mut() {
            if profile.id.trim().is_empty() {
                profile.id = profile_id.clone();
            }
            if profile.display_name.trim().is_empty() {
                profile.display_name = profile_id.clone();
            }
            if profile.command.trim().is_empty() {
                profile.command = engine.command.clone();
            }
            if profile.args.is_empty() && !engine.args.is_empty() {
                profile.args = engine.args.clone();
            }
            if profile.env.is_empty() && !engine.env.is_empty() {
                profile.env = engine.env.clone();
            }
            if profile.ready_signal.is_none() && engine.ready_signal.is_some() {
                profile.ready_signal = engine.ready_signal.clone();
            }
            profile.execution_mode = normalize_execution_mode(&profile.execution_mode);

            if let Some((supports_headless, default_headless_args)) =
                builtin_headless_defaults(engine_id.as_str())
            {
                profile.supports_headless = supports_headless;
                if profile.headless_args.is_empty() {
                    profile.headless_args = default_headless_args;
                }
            } else if profile.headless_args.is_empty() && !engine.headless_args.is_empty() {
                profile.headless_args = engine.headless_args.clone();
            }
        }
        if engine.active_profile_id.trim().is_empty()
            || !engine.profiles.contains_key(&engine.active_profile_id)
        {
            if let Some(first_key) = engine.profiles.keys().next().cloned() {
                engine.active_profile_id = first_key;
            }
        }
        if let Some(active_profile) = engine.profiles.get(&engine.active_profile_id).cloned() {
            engine.command = active_profile.command;
            engine.args = active_profile.args;
            engine.env = active_profile.env;
            engine.supports_headless = active_profile.supports_headless;
            engine.headless_args = active_profile.headless_args;
            engine.ready_signal = active_profile.ready_signal;
            engine.execution_mode = normalize_execution_mode(&active_profile.execution_mode);
            engine.api_provider = active_profile.api_provider;
            engine.api_base_url = active_profile.api_base_url;
            engine.api_key = active_profile.api_key;
        }
    }
}

fn default_execution_mode() -> String {
    "cli".to_string()
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
