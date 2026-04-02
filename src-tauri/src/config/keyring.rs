use crate::config::AppConfig;
use keyring::Entry;

pub(crate) fn sync_api_keys_to_keyring(config: &AppConfig) {
    for (engine_id, engine) in config.engines.iter() {
        for (profile_id, profile) in engine.profiles.iter() {
            let entry_name = format!("{}-{}", engine_id, profile_id);
            match Entry::new("maestro", &entry_name) {
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
pub(crate) fn load_api_keys_from_keyring(config: &mut AppConfig) {
    for (engine_id, engine) in config.engines.iter_mut() {
        for (profile_id, profile) in engine.profiles.iter_mut() {
            let entry_name = format!("{}-{}", engine_id, profile_id);
            let mut loaded = false;

            if let Ok(kr) = Entry::new("maestro", &entry_name) {
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
}
