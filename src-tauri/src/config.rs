use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{command, AppHandle};

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
    /// Migration-only fallback when task binding has no profile_id. Task should be runtime owner.
    /// REMOVAL: See docs/MIGRATION_FALLBACK_REMOVAL.md. Delete when: telemetry < 1%, all task_create pass profile_id.
    #[serde(default)]
    pub active_profile_id: String,
    #[serde(flatten, skip_serializing)]
    pub legacy_profile: EngineProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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



fn default_plugin_type() -> String {
    "cli".to_string()
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
                vec!["agent".to_string(), "--yolo".to_string(), "--print".to_string(), "--output-format".to_string(), "stream-json".to_string(), "--stream-partial-output".to_string()],
                ">",
                "terminal-square",
                "cli",
                vec!["agent".to_string(), "--yolo".to_string()],
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
            ),
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
                    target_ide: crate::constants::DEFAULT_TARGET_IDE.to_string(),
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

    /// Get a copy of the current config.
    /// NOTE: This clones the entire AppConfig. If profiling shows this is a bottleneck,
    /// consider wrapping inner with Arc (RwLock<Arc<AppConfig>>) to enable cheap clones.
    pub fn get(&self) -> AppConfig {
        self.inner
            .read()
            .expect("config read lock poisoned")
            .clone()
    }

    pub fn set(&self, next: AppConfig) {
        *self.inner.write().expect("config write lock poisoned") = next;
    }
}

impl EngineConfig {
    #[allow(clippy::too_many_arguments)]
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
            legacy_profile: profile,
        }
    }

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
        self.active_profile().exit_command.clone().unwrap_or_else(|| "ctrl-c".to_string())
    }

    pub fn exit_timeout_ms(&self) -> u64 {
        self.active_profile()
            .exit_timeout_ms
            .unwrap_or(crate::constants::DEFAULT_EXIT_TIMEOUT_MS)
    }
}

impl EngineProfile {
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

    pub fn api_key(&self) -> Option<String> {
        self.api_key.clone()
    }
}

// Minimal migration pass: ensures we have a default profile and execution_mode.
pub(crate) fn migrate_engine_profiles(config: &mut AppConfig) {
    for (_, engine) in config.engines.iter_mut() {
        if engine.profiles.is_empty() {
            let profile_id = "default".to_string();
            let mut profile = engine.legacy_profile.clone();
            profile.id = profile_id.clone();
            profile.display_name = "Default".to_string();
            engine.profiles.insert(profile_id.clone(), profile);
            engine.active_profile_id = profile_id;
        }
        // Migration-only: ensure active_profile_id is valid; task binding is preferred source.
        if engine.active_profile_id.trim().is_empty()
            || !engine.profiles.contains_key(&engine.active_profile_id)
        {
            if let Some(first_key) = engine.profiles.keys().next().cloned() {
                engine.active_profile_id = first_key;
            }
        }
        // Migration: automatically upgrade old `cursor` engine headless_args to enable JSON stream reasoning extraction
        if engine.id == "cursor" {
            let old_args: Vec<String> = vec!["agent".to_string(), "--yolo".to_string(), "--print".to_string()];
            let new_args: Vec<String> = vec![
                "agent".to_string(), "--yolo".to_string(), "--print".to_string(),
                "--output-format".to_string(), "stream-json".to_string(), "--stream-partial-output".to_string()
            ];
            
            if engine.legacy_profile.headless_args == old_args {
                engine.legacy_profile.headless_args = new_args.clone();
            }
            for profile in engine.profiles.values_mut() {
                if profile.headless_args == old_args {
                    profile.headless_args = new_args.clone();
                }
            }
        }
        // No longer sync to legacy_profile - profiles is the single source of truth
    }
}

fn config_path_core() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    let dir = home.join(".maestro");
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create config dir: {}", e))?;
    Ok(dir.join("config.toml"))
}

fn sync_api_keys_to_keyring(config: &AppConfig) {
    for (engine_id, engine) in config.engines.iter() {
        for (profile_id, profile) in engine.profiles.iter() {
            let entry_name = format!("{}-{}", engine_id, profile_id);
            match keyring::Entry::new("maestro", &entry_name) {
                Ok(kr) => {
                    if let Some(key) = &profile.api_key {
                        if !key.trim().is_empty() {
                            if let Err(e) = kr.set_password(key) {
                                tracing::warn!(
                                    engine_id = %engine_id,
                                    profile_id = %profile_id,
                                    error = %e,
                                    "keyring: failed to store API key; key will not persist"
                                );
                            }
                        } else {
                            let _ = kr.delete_credential();
                        }
                    } else {
                        let _ = kr.delete_credential();
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        engine_id = %engine_id,
                        profile_id = %profile_id,
                        error = %e,
                        "keyring: failed to open credential entry; API key will not persist"
                    );
                }
            }
        }
    }
}

/// Load API keys from keyring. Fallback: MAESTRO_API_KEY_{ENGINE_ID}_{PROFILE_ID} env var (dev/test).
fn load_api_keys_from_keyring(config: &mut AppConfig) {
    for (engine_id, engine) in config.engines.iter_mut() {
        for (profile_id, profile) in engine.profiles.iter_mut() {
            let entry_name = format!("{}-{}", engine_id, profile_id);
            let mut loaded = false;

            if let Ok(kr) = keyring::Entry::new("maestro", &entry_name) {
                match kr.get_password() {
                    Ok(pwd) if !pwd.is_empty() => {
                        profile.api_key = Some(pwd);
                        loaded = true;
                    }
                    Err(e) => {
                        tracing::warn!(
                            engine_id = %engine_id,
                            profile_id = %profile_id,
                            error = %e,
                            "keyring: failed to read API key"
                        );
                    }
                    _ => {}
                }
            } else {
                tracing::debug!(
                    engine_id = %engine_id,
                    profile_id = %profile_id,
                    "keyring: credential entry not available"
                );
            }

            if !loaded {
                let env_key = format!(
                    "MAESTRO_API_KEY_{}_{}",
                    engine_id.to_uppercase().replace('-', "_"),
                    profile_id.to_uppercase().replace('-', "_"),
                );
                if let Ok(val) = std::env::var(&env_key) {
                    if !val.trim().is_empty() {
                        profile.api_key = Some(val);
                        tracing::debug!(
                            engine_id = %engine_id,
                            profile_id = %profile_id,
                            "keyring: using MAESTRO_API_KEY_* env fallback"
                        );
                    }
                }
            }
        }
    }
    migrate_engine_profiles(config);
}

fn config_path(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    config_path_core()
}

/// Internal: load or create config from the given path.
fn load_or_create_config_from_path(path: &PathBuf) -> Result<AppConfig, String> {
    if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|e| format!("failed to read config: {}", e))?;
        let mut config = toml::from_str::<AppConfig>(&raw)
            .map_err(|e| format!("failed to parse config.toml: {}", e))?;
        migrate_engine_profiles(&mut config);
        load_api_keys_from_keyring(&mut config);
        Ok(config)
    } else {
        let mut default = AppConfig::default();
        migrate_engine_profiles(&mut default);
        load_api_keys_from_keyring(&mut default);
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
    sync_api_keys_to_keyring(config);
    let mut safe_config = config.clone();
    for engine in safe_config.engines.values_mut() {
        engine.legacy_profile.api_key = None;
        for profile in engine.profiles.values_mut() {
            profile.api_key = None;
        }
    }
    let content =
        toml::to_string_pretty(&safe_config).map_err(|e| format!("toml serialize failed: {}", e))?;
    fs::write(path, content).map_err(|e| format!("failed to save config: {}", e))?;
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
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    let mut config = config;
    migrate_engine_profiles(&mut config);
    write_config_to_disk(&app, &config)?;
    core_state.inner().config.set(config);
    Ok(())
}
