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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineProfile {
    pub id: String,
    pub display_name: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
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
    #[serde(flatten)]
    pub extra: serde_json::Value,
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

fn default_plugin_type() -> String {
    "cli".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut engines = BTreeMap::new();

        engines.insert(
            "cursor".to_string(),
            EngineConfig::new(
                "cursor",
                "Cursor Agent",
                "cursor",
                "ctrl-c",
                true,
                vec!["agent".to_string(), "--print".to_string()],
                ">",
                "terminal-square",
                "cli",
                vec!["agent".to_string()],
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
        let mut extra = serde_json::Map::new();
        extra.insert("command".to_string(), serde_json::json!(command));
        extra.insert("args".to_string(), serde_json::json!(override_args));
        extra.insert("env".to_string(), serde_json::json!(serde_json::Map::new()));
        extra.insert("exit_command".to_string(), serde_json::json!(exit_command));
        extra.insert("exit_timeout_ms".to_string(), serde_json::json!(3000));
        extra.insert(
            "supports_headless".to_string(),
            serde_json::json!(supports_headless),
        );
        extra.insert(
            "headless_args".to_string(),
            serde_json::json!(headless_args),
        );
        extra.insert("ready_signal".to_string(), serde_json::json!(ready_signal));
        extra.insert("execution_mode".to_string(), serde_json::json!("cli"));

        let profile_extra = extra.clone();
        let profile = EngineProfile {
            id: "default".to_string(),
            display_name: "Default".to_string(),
            extra: serde_json::Value::Object(profile_extra),
        };
        let mut profiles = BTreeMap::new();
        profiles.insert("default".to_string(), profile);

        Self {
            id: id.to_string(),
            plugin_type: plugin_type.to_string(),
            display_name: display_name.to_string(),
            icon: icon.to_string(),
            profiles,
            active_profile_id: "default".to_string(),
            extra: serde_json::Value::Object(extra),
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
            extra: self.extra.clone(),
        }
    }

    pub fn exit_command(&self) -> String {
        self.extra
            .get("exit_command")
            .and_then(|v| v.as_str())
            .unwrap_or("ctrl-c")
            .to_string()
    }

    pub fn exit_timeout_ms(&self) -> u64 {
        self.extra
            .get("exit_timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(3000)
    }
}

impl EngineProfile {
    pub fn command(&self) -> String {
        self.extra
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }

    pub fn args(&self) -> Vec<String> {
        self.extra
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn env(&self) -> BTreeMap<String, String> {
        self.extra
            .get("env")
            .and_then(|v| v.as_object())
            .map(|o| {
                o.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn model(&self) -> String {
        self.extra
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }

    pub fn supports_headless(&self) -> bool {
        self.extra
            .get("supports_headless")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    pub fn headless_args(&self) -> Vec<String> {
        self.extra
            .get("headless_args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn ready_signal(&self) -> Option<String> {
        self.extra
            .get("ready_signal")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn api_provider(&self) -> Option<String> {
        self.extra
            .get("api_provider")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn api_base_url(&self) -> Option<String> {
        self.extra
            .get("api_base_url")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn api_key(&self) -> Option<String> {
        self.extra
            .get("api_key")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }
}

// Minimal migration pass: ensures we have a default profile and execution_mode.
fn migrate_engine_profiles(config: &mut AppConfig) {
    for (_, engine) in config.engines.iter_mut() {
        if !engine.extra.is_object() {
            engine.extra = serde_json::Value::Object(serde_json::Map::new());
        }
        if engine.profiles.is_empty() {
            let profile_id = "default".to_string();
            engine.profiles.insert(
                profile_id.clone(),
                EngineProfile {
                    id: profile_id.clone(),
                    display_name: "Default".to_string(),
                    extra: engine.extra.clone(),
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
        // Sync active profile's extra back to engine's extra for easy access
        if let Some(active_profile) = engine.profiles.get(&engine.active_profile_id).cloned() {
            engine.extra = active_profile.extra;
        }
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

pub fn load_or_create_config_headless() -> Result<AppConfig, String> {
    let path = config_path_core()?;
    if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("failed to read config: {}", e))?;
        let mut config = toml::from_str::<AppConfig>(&raw)
            .map_err(|e| format!("failed to parse config.toml: {}", e))?;
        migrate_engine_profiles(&mut config);
        Ok(config)
    } else {
        let default = AppConfig::default();
        let content = toml::to_string_pretty(&default)
            .map_err(|e| format!("toml serialize failed: {}", e))?;
        std::fs::write(&path, content).map_err(|e| format!("failed to write default config: {}", e))?;
        Ok(default)
    }
}

pub fn write_config_to_disk(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let content =
        toml::to_string_pretty(config).map_err(|e| format!("toml serialize failed: {}", e))?;
    fs::write(path, content).map_err(|e| format!("failed to save config: {}", e))?;
    Ok(())
}

#[command]
pub fn load_or_create_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("failed to read config: {}", e))?;
        let mut config = toml::from_str::<AppConfig>(&raw)
            .map_err(|e| format!("failed to parse config.toml: {}", e))?;
        migrate_engine_profiles(&mut config);
        Ok(config)
    } else {
        let default = AppConfig::default();
        let content = toml::to_string_pretty(&default)
            .map_err(|e| format!("toml serialize failed: {}", e))?;
        fs::write(path, content).map_err(|e| format!("failed to write default config: {}", e))?;
        Ok(default)
    }
}

#[command]
pub fn save_config(
    app: AppHandle,
    config: AppConfig,
    state: tauri::State<'_, AppConfigState>,
) -> Result<(), String> {
    let mut config = config;
    migrate_engine_profiles(&mut config);
    write_config_to_disk(&app, &config)?;
    state.set(config);
    Ok(())
}
