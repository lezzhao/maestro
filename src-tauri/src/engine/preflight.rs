//! Preflight checks: command existence, auth, headless support. Read-only, no side effects.

use crate::config::{AppConfig, EngineConfig, EngineProfile};
use crate::engine::utils::{cursor_status_check, run_status_check_shell, StatusCheckResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnginePreflightResult {
    pub engine_id: String,
    pub profile_id: String,
    pub command_exists: bool,
    pub auth_ok: bool,
    pub supports_headless: bool,
    pub notes: String,
}

fn shell_single_quote(input: &str) -> String {
    let escaped = input.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

fn resolve_profile(
    engine: &EngineConfig,
    profile_id: Option<&str>,
) -> Result<(String, EngineProfile), String> {
    if let Some(requested_profile_id) = profile_id.filter(|id| !id.trim().is_empty()) {
        let profile = engine
            .profiles
            .get(requested_profile_id)
            .cloned()
            .ok_or_else(|| format!("profile not found: {requested_profile_id}"))?;
        return Ok((requested_profile_id.to_string(), profile));
    }

    Ok((engine.active_profile_id().to_string(), engine.active_profile()))
}

pub async fn engine_preflight_core(
    engine_id: String,
    profile_id: Option<String>,
    config: AppConfig,
) -> Result<EnginePreflightResult, String> {
    let engine = config
        .engines
        .get(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    let (resolved_profile_id, profile) = resolve_profile(engine, profile_id.as_deref())?;

    let command_exists = which::which(profile.command()).is_ok();
    if !command_exists {
        return Ok(EnginePreflightResult {
            engine_id,
            profile_id: resolved_profile_id,
            command_exists: false,
            auth_ok: false,
            supports_headless: profile.supports_headless(),
            notes: format!("command not found: {}", profile.command()),
        });
    }

    let auth_check = match engine.id.as_str() {
        "cursor" => cursor_status_check(&profile.command()).await,
        "claude" => {
            run_status_check_shell(
                &format!("{} auth status", shell_single_quote(&profile.command())),
                8000,
            )
            .await
        }
        "opencode" => {
            run_status_check_shell(
                &format!("{} auth", shell_single_quote(&profile.command())),
                8000,
            )
            .await
        }
        "gemini" => {
            let probe = run_status_check_shell(
                &format!(
                    "{} -p {}",
                    shell_single_quote(&profile.command()),
                    shell_single_quote("ping")
                ),
                8000,
            )
            .await;
            if probe.ok {
                probe
            } else {
                let help_probe = run_status_check_shell(
                    &format!("{} --help", shell_single_quote(&profile.command())),
                    5000,
                )
                .await;
                if help_probe.ok {
                    StatusCheckResult {
                        ok: false,
                        detail: format!("prompt probe failed: {}", probe.detail),
                    }
                } else {
                    probe
                }
            }
        }
        "codex" => {
            let probe = run_status_check_shell(
                &format!(
                    "{} exec {}",
                    shell_single_quote(&profile.command()),
                    shell_single_quote("ping")
                ),
                8000,
            )
            .await;
            if probe.ok {
                probe
            } else {
                let help_probe = run_status_check_shell(
                    &format!("{} --help", shell_single_quote(&profile.command())),
                    5000,
                )
                .await;
                if help_probe.ok {
                    StatusCheckResult {
                        ok: false,
                        detail: format!("exec probe failed: {}", probe.detail),
                    }
                } else {
                    probe
                }
            }
        }
        _ => {
            run_status_check_shell(
                &format!("{} --help", shell_single_quote(&profile.command())),
                5000,
            )
            .await
        }
    };
    let auth_ok = auth_check.ok;

    let notes = if auth_ok {
        "ready".to_string()
    } else {
        format!("auth check failed: {}", auth_check.detail)
    };

    Ok(EnginePreflightResult {
        engine_id,
        profile_id: resolved_profile_id,
        command_exists,
        auth_ok,
        supports_headless: profile.supports_headless(),
        notes,
    })
}
