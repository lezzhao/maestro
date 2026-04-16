use crate::config::AppConfig;

pub(crate) fn migrate_engine_profiles(config: &mut AppConfig) {
    for (_, engine) in config.engines.iter_mut() {
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
            let old_args: Vec<String> = vec![
                "agent".to_string(),
                "--yolo".to_string(),
                "--print".to_string(),
            ];
            let new_args: Vec<String> = vec![
                "agent".to_string(),
                "--yolo".to_string(),
                "--print".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--stream-partial-output".to_string(),
            ];

            for profile in engine.profiles.values_mut() {
                if profile.headless_args == old_args {
                    profile.headless_args = new_args.clone();
                }
            }
        }
        // No longer sync to legacy_profile - profiles is the single source of truth
    }
}
// Migration: physically rename "bmad" to "maestro" in raw TOML string to avoid legacy leak.
pub(crate) fn migrate_config_content(raw: String) -> (String, bool) {
    let mut value: toml::Value = match toml::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return (raw, false),
    };

    let mut modified = false;

    // 1. Rename [providers.bmad] to [providers.maestro]
    if let Some(providers) = value.get_mut("providers").and_then(|v| v.as_table_mut()) {
        if let Some(bmad) = providers.remove("bmad") {
            providers.insert("maestro".to_string(), bmad);
            modified = true;
        }
    }

    // 2. Rename [spec.providers.bmad] to [spec.providers.maestro]
    if let Some(spec) = value.get_mut("spec").and_then(|v| v.as_table_mut()) {
        if let Some(providers) = spec.get_mut("providers").and_then(|v| v.as_table_mut()) {
            if let Some(bmad) = providers.remove("bmad") {
                providers.insert("maestro".to_string(), bmad);
                modified = true;
            }
        }
    }

    if modified {
        match toml::to_string_pretty(&value) {
            Ok(s) => (s, true),
            Err(_) => (raw, false),
        }
    } else {
        (raw, false)
    }
}
