use crate::config::AppConfig;

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
// Migration: physically rename "bmad" to "maestro" in raw TOML string to avoid legacy leak.
pub(crate) fn migrate_config_content(raw: String) -> (String, bool) {
    let mut modified = false;
    let mut result = raw;
    
    // Replace section headers
    if result.contains("[providers.bmad]") {
        result = result.replace("[providers.bmad]", "[providers.maestro]");
        modified = true;
    }
    if result.contains("[spec.providers.bmad]") {
        result = result.replace("[spec.providers.bmad]", "[spec.providers.maestro]");
        modified = true;
    }
    
    (result, modified)
}
