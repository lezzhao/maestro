//! PTY spawn validation: path whitelist + ActionGuard for command injection prevention.
//!
//! Only allows spawning executables registered in engine config.
//! Validates args via ActionGuard to block dangerous commands (rm -rf /, etc.).

use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::plugin_engine::action_guard::ActionGuard;
use std::collections::HashSet;
use std::path::Path;

/// Resolve a command (bare name or path) to canonical path for comparison.
fn resolve_command_to_path(cmd: &str) -> Option<std::path::PathBuf> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return None;
    }
    let as_path = Path::new(trimmed);
    if as_path.has_root() || trimmed.contains('/') || trimmed.contains('\\') {
        as_path.canonicalize().ok()
    } else {
        which::which(trimmed).ok()
    }
}

/// Build the set of allowed executable paths from engine config.
fn allowed_commands_from_config(config: &AppConfig) -> HashSet<std::path::PathBuf> {
    let mut allowed = HashSet::new();
    for engine in config.engines.values() {
        for profile in engine.profiles.values() {
            let cmd = profile.command.trim();
            if cmd.is_empty() {
                continue;
            }
            if let Some(resolved) = resolve_command_to_path(cmd) {
                allowed.insert(resolved);
            }
        }
    }
    allowed
}

/// Validate file and args for pty_spawn. Returns Ok(()) if safe.
pub fn validate_pty_spawn(
    config: &AppConfig,
    file: &str,
    args: &[String],
) -> Result<(), CoreError> {
    let allowed = allowed_commands_from_config(config);
    if allowed.is_empty() {
        return Err(CoreError::ValidationError {
            field: "file".to_string(),
            message: "No engine commands configured; pty_spawn rejected".to_string(),
        });
    }

    let resolved_file = resolve_command_to_path(file).ok_or_else(|| {
        CoreError::ValidationError {
            field: "file".to_string(),
            message: format!("Command not found or invalid path: {}", file),
        }
    })?;

    if !allowed.contains(&resolved_file) {
        return Err(CoreError::PermissionDenied {
            reason: format!(
                "Executable '{}' is not in engine whitelist",
                resolved_file.display()
            ),
        });
    }

    let command_str = shlex::try_join(std::iter::once(file).chain(args.iter().map(String::as_str)))
        .map_err(|_| CoreError::ValidationError {
            field: "args".to_string(),
            message: "command contains invalid characters".to_string(),
        })?;
    ActionGuard::unwrap_default()
        .check_command(&command_str)
        .map_err(|e| CoreError::PermissionDenied { reason: e })?;

    Ok(())
}
