pub mod keyring;
pub mod migration;
pub mod roles;
pub mod verify;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{command, AppHandle};

pub use roles::get_builtin_roles;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ApiKeyConfig {
    pub api_key: String,
    pub key_prefix: Option<String>,
    #[serde(default)]
    pub is_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AwsBedrockConfig {
    pub region: String,
    pub profile: Option<String>,
    pub access_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AzureFoundryConfig {
    pub endpoint: String,
    pub deployment: String,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "config")]
#[derive(Default)]
pub enum AuthScheme {
    #[serde(rename = "api_key")]
    ApiKey(ApiKeyConfig),
    #[serde(rename = "aws_bedrock")]
    AwsBedrock(AwsBedrockConfig),
    #[serde(rename = "azure_foundry")]
    AzureFoundry(AzureFoundryConfig),
    #[serde(rename = "none")]
    #[default]
    None,
}


#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderMetadata {
    pub provider_id: String, // e.g., "openai", "anthropic"
    pub logo_key: Option<String>,
    pub help_url: Option<String>,
    pub category: Option<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EngineProfile {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub exit_command: Option<String>,
    #[serde(default)]
    pub exit_timeout_ms: Option<u64>,
    #[serde(default)]
    pub supports_headless: bool,
    #[serde(default)]
    pub headless_args: Vec<String>,
    #[serde(default)]
    pub ready_signal: Option<String>,
    #[serde(default)]
    pub execution_mode: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_provider: Option<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub auth: Option<AuthScheme>,
    #[serde(default)]
    pub metadata: Option<ProviderMetadata>,
}

impl EngineProfile {
    pub fn api_key(&self) -> Option<String> {
        if let Some(AuthScheme::ApiKey(config)) = &self.auth {
            return Some(config.api_key.clone());
        }
        self.api_key.clone()
    }

    pub fn effective_auth(&self) -> Option<AuthScheme> {
        if let Some(auth) = &self.auth {
            return Some(auth.clone());
        }
        // Fallback to legacy fields converted to AuthScheme::ApiKey
        if let Some(key) = &self.api_key {
            return Some(AuthScheme::ApiKey(ApiKeyConfig {
                api_key: key.clone(),
                key_prefix: None, // We don't have this in legacy
                is_secret: true,
            }));
        }
        None
    }

    pub fn command(&self) -> String {
        self.command.clone()
    }
    pub fn args(&self) -> Vec<String> {
        self.args.clone()
    }
    pub fn env(&self) -> BTreeMap<String, String> {
        self.env.clone()
    }
    pub fn model(&self) -> String {
        self.model.clone().unwrap_or_default()
    }
    pub fn supports_headless(&self) -> bool {
        self.supports_headless
    }
    pub fn headless_args(&self) -> Vec<String> {
        self.headless_args.clone()
    }
    pub fn ready_signal(&self) -> Option<String> {
        self.ready_signal.clone()
    }
    pub fn api_provider(&self) -> Option<String> {
        self.api_provider.clone()
    }
    pub fn api_base_url(&self) -> Option<String> {
        self.api_base_url.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub id: String,
    #[serde(default = "default_plugin_type")]
    pub plugin_type: String,
    pub display_name: String,
    pub icon: String,
    #[serde(default)]
    pub profiles: BTreeMap<String, EngineProfile>,
    #[serde(default)]
    pub active_profile_id: String,
    #[serde(default)]
    pub category: Option<String>, // 'cloud', 'local', 'proxy'
    #[serde(flatten, skip_serializing)]
    pub legacy_profile: EngineProfile,
}

impl EngineConfig {
    pub fn active_profile(&self) -> EngineProfile {
        if let Some(profile) = self.profiles.get(&self.active_profile_id) {
            return profile.clone();
        }
        if let Some((_id, profile)) = self.profiles.iter().next() {
            return profile.clone();
        }
        self.legacy_profile.clone()
    }

    pub fn exit_command(&self) -> String {
        self.active_profile()
            .exit_command
            .clone()
            .unwrap_or_else(|| "ctrl-c".to_string())
    }

    pub fn exit_timeout_ms(&self) -> u64 {
        self.active_profile()
            .exit_timeout_ms
            .unwrap_or(crate::constants::DEFAULT_EXIT_TIMEOUT_MS)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecSection {
    pub enabled: bool,
    pub active_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecProviderMaestro {
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
    pub maestro: SpecProviderMaestro,
    pub custom: SpecProviderCustom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowConfig {
    pub name: String,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowStep {
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServerConfig {
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub app: AppSection,
    #[serde(default)]
    pub project: ProjectSection,
    #[serde(default)]
    pub engines: BTreeMap<String, EngineConfig>,
    #[serde(default)]
    pub spec: SpecSection,
    #[serde(default)]
    pub providers: SpecProviders,
    #[serde(default)]
    pub workflows: Vec<WorkflowConfig>,
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    #[serde(default = "default_config_version")]
    pub version: String,
    #[serde(default = "default_max_concurrent_tasks")]
    pub max_concurrent_tasks: usize,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl AppConfig {
    pub fn i18n(&self) -> crate::i18n::I18n {
        crate::i18n::I18n::new(&self.app.language)
    }
}

fn default_config_version() -> String {
    "3.0".to_string()
}

fn default_max_concurrent_tasks() -> usize {
    3
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

fn default_plugin_type() -> String {
    "cli".to_string()
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
        plugin_type: &str,
        override_args: Vec<String>,
        category: Option<String>,
    ) -> Self {
        let profile = EngineProfile {
            id: "default".to_string(),
            display_name: "Default".to_string(),
            command: command.to_string(),
            args: override_args,
            env: BTreeMap::new(),
            exit_command: Some(exit_command.to_string()),
            exit_timeout_ms: Some(crate::constants::DEFAULT_EXIT_TIMEOUT_MS),
            supports_headless,
            headless_args,
            ready_signal: Some(ready_signal.to_string()),
            execution_mode: Some("cli".to_string()),
            ..Default::default()
        };

        let mut profiles = BTreeMap::new();
        profiles.insert("default".to_string(), profile.clone());

        Self {
            id: id.to_string(),
            plugin_type: plugin_type.to_string(),
            display_name: display_name.to_string(),
            icon: icon.to_string(),
            profiles,
            active_profile_id: "default".to_string(),
            category,
            legacy_profile: profile,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut engines = BTreeMap::new();

        engines.insert(
            crate::constants::DEFAULT_ENGINE_ID.to_string(),
            EngineConfig::new(
                crate::constants::DEFAULT_ENGINE_ID,
                "Cursor Agent",
                crate::constants::DEFAULT_ENGINE_ID,
                "ctrl-c",
                true,
                vec![
                    "agent".to_string(),
                    "--yolo".to_string(),
                    "--print".to_string(),
                    "--output-format".to_string(),
                    "stream-json".to_string(),
                    "--stream-partial-output".to_string(),
                ],
                ">",
                "terminal-square",
                "cli",
                vec!["agent".to_string(), "--yolo".to_string()],
                Some("llm".to_string()),
            ),
        );

        engines.insert(
            "claude".to_string(),
            EngineConfig::new(
                "claude",
                "Claude Code",
                "claude",
                "/exit",
                true,
                vec!["-p".to_string()],
                ">",
                "bot",
                "cli",
                vec![],
                Some("llm".to_string()),
            ),
        );

        engines.insert(
            "gemini".to_string(),
            EngineConfig::new(
                "gemini",
                "Gemini CLI",
                "gemini",
                "/exit",
                true,
                vec!["-p".to_string()],
                ">",
                "sparkles",
                "cli",
                vec![],
                Some("llm".to_string()),
            ),
        );

        engines.insert(
            "opencode".to_string(),
            EngineConfig::new(
                "opencode",
                "OpenCode",
                "opencode",
                "ctrl-c",
                true,
                vec!["run".to_string()],
                ">",
                "code",
                "cli",
                vec![],
                Some("llm".to_string()),
            ),
        );

        engines.insert(
            "codex".to_string(),
            EngineConfig::new(
                "codex",
                "Codex",
                "codex",
                "/exit",
                true,
                vec!["exec".to_string()],
                ">",
                "zap",
                "cli",
                vec![],
                Some("llm".to_string()),
            ),
        );

        Self {
            app: AppSection::default(),
            project: ProjectSection::default(),
            engines,
            spec: SpecSection::default(),
            providers: SpecProviders {
                maestro: SpecProviderMaestro {
                    display_name: "MAESTRO".to_string(),
                    version: "6.0.4".to_string(),
                    source_path: String::new(),
                    install_mode: "rules_only".to_string(),
                    target_ide: crate::constants::DEFAULT_TARGET_IDE.to_string(),
                },
                custom: SpecProviderCustom {
                    display_name: "自定义规范".to_string(),
                    source_path: String::new(),
                    rules_content: String::new(),
                },
            },
            workflows: vec![],
            mcp_servers: BTreeMap::new(),
            version: default_config_version(),
            max_concurrent_tasks: default_max_concurrent_tasks(),
            extra: BTreeMap::new(),
        }
    }
}

impl AppConfig {
    pub fn validate(&self) -> Vec<String> {
        let mut warnings = Vec::new();
        if self.engines.is_empty() {
            warnings.push(self.i18n().t("preflight_no_engines"));
        }
        warnings
    }
}

#[derive(Default)]
pub struct AppConfigState {
    inner: RwLock<Arc<AppConfig>>,
}

impl AppConfigState {
    pub fn new(config: AppConfig) -> Self {
        Self {
            inner: RwLock::new(Arc::new(config)),
        }
    }

    /// Get an Arc to the current config.
    /// Clones Arc pointer (O(1)) instead of the whole AppConfig.
    pub fn get(&self) -> Arc<AppConfig> {
        self.inner
            .read()
            .unwrap_or_else(|e| {
                tracing::warn!("config read lock was poisoned, recovering");
                e.into_inner()
            })
            .clone()
    }

    pub fn set(&self, next: AppConfig) {
        *self.inner.write().unwrap_or_else(|e| {
            tracing::warn!("config write lock was poisoned, recovering");
            e.into_inner()
        }) = Arc::new(next);
    }
}

fn config_path_core() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    let dir = home.join(".maestro");
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create config dir: {}", e))?;
    Ok(dir.join("config.toml"))
}

fn config_path(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    config_path_core()
}

/// Internal: load or create config from the given path.
fn load_or_create_config_from_path(path: &PathBuf) -> Result<AppConfig, String> {
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|e| format!("failed to read config: {}", e))?;
        
        // Phase 6 Optimization: Physical rename bmad -> maestro
        let (raw_migrated, modified) = migration::migrate_config_content(raw);
        if modified {
            let _ = fs::write(path, &raw_migrated);
        }

        let mut config = toml::from_str::<AppConfig>(&raw_migrated)
            .map_err(|e| format!("failed to parse config.toml: {}", e))?;
        migration::migrate_engine_profiles(&mut config);
        keyring::load_api_keys_from_keyring(&mut config);
        Ok(config)
    } else {
        let mut default = AppConfig::default();
        migration::migrate_engine_profiles(&mut default);
        keyring::load_api_keys_from_keyring(&mut default);
        let mut safe_default = default.clone();
        for engine in safe_default.engines.values_mut() {
            engine.legacy_profile.api_key = None;
            for profile in engine.profiles.values_mut() {
                profile.api_key = None;
            }
        }
        let content = toml::to_string_pretty(&safe_default)
            .map_err(|e| format!("toml serialize failed: {}", e))?;
        fs::write(path, content).map_err(|e| format!("failed to write default config: {}", e))?;
        Ok(default)
    }
}

pub fn load_or_create_config_headless() -> Result<AppConfig, String> {
    let path = config_path_core()?;
    load_or_create_config_from_path(&path)
}

pub fn write_config_to_disk_core(config: &AppConfig) -> Result<(), String> {
    let path = config_path_core()?;
    keyring::sync_api_keys_to_keyring(config);
    let mut safe_config = config.clone();
    for engine in safe_config.engines.values_mut() {
        engine.legacy_profile.api_key = None;
        for profile in engine.profiles.values_mut() {
            profile.api_key = None;
        }
    }
    let content = toml::to_string_pretty(&safe_config)
        .map_err(|e| format!("toml serialize failed: {}", e))?;

    // Atomic save using a temp file
    let tmp_path = path.with_extension("toml.tmp");
    fs::write(&tmp_path, content).map_err(|e| format!("failed to write temp config: {}", e))?;
    fs::rename(tmp_path, path).map_err(|e| format!("failed to rename temp config: {}", e))?;
    Ok(())
}

pub fn write_config_to_disk(_app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    write_config_to_disk_core(config)
}

#[command]
pub fn load_or_create_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    load_or_create_config_from_path(&path)
}

#[command]
pub fn save_config(
    app: AppHandle,
    config: AppConfig,
    core_state: tauri::State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), String> {
    let mut config = config;
    migration::migrate_engine_profiles(&mut config);
    // 1. Update memory FIRST for immediate consistency
    core_state.inner().config.set(config.clone());
    core_state.run_queue.update_limit(config.max_concurrent_tasks);
    // 2. Write to disk LATER (atomically)
    write_config_to_disk(&app, &config)?;
    Ok(())
}

#[command]
pub fn update_max_concurrent_tasks(
    app: AppHandle,
    count: usize,
    core_state: tauri::State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), String> {
    let mut config = (*core_state.inner().config.get()).clone();
    config.max_concurrent_tasks = count;
    
    // Update memory and queue
    core_state.inner().config.set(config.clone());
    core_state.run_queue.update_limit(count);
    
    // Save to disk
    write_config_to_disk(&app, &config)?;
    Ok(())
}
