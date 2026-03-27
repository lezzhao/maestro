use super::EngineError;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionGuardConfig {
    pub protected_paths: Vec<String>,
    pub blocked_commands: Vec<String>,
}

impl Default for ActionGuardConfig {
    fn default() -> Self {
        Self {
            protected_paths: vec!["/etc".to_string(), "/var".to_string(), "~/.ssh".to_string()],
            blocked_commands: vec![
                r"(?i)\brm\s+-rf\s+(/|/etc|/var|~)(\s|$)".to_string(),
                r"(?i)\bmkfs\b".to_string(),
                r"(?i)\bdd\s+if=.*of=/dev/.*".to_string(),
            ],
        }
    }
}

pub struct ActionGuard {
    config: ActionGuardConfig,
    regexes: Vec<Regex>,
}

impl ActionGuard {
    pub fn new(config: ActionGuardConfig) -> Result<Self, EngineError> {
        let mut regexes = Vec::new();
        for pattern in &config.blocked_commands {
            let re = Regex::new(pattern)
                .map_err(|e| EngineError::Config(format!("Invalid regex '{pattern}': {e}")))?;
            regexes.push(re);
        }
        Ok(Self { config, regexes })
    }

    pub fn unwrap_default() -> Self {
        Self::new(ActionGuardConfig::default()).unwrap()
    }

    /// 检查命令是否违反安全策略。
    /// 被拦截时返回 `Err(EngineError::PermissionDenied)`。
    pub fn check_command(&self, command: &str) -> Result<(), EngineError> {
        for (i, re) in self.regexes.iter().enumerate() {
            if re.is_match(command) {
                return Err(EngineError::PermissionDenied(format!(
                    "Command blocked by rule '{}'",
                    self.config.blocked_commands[i]
                )));
            }
        }

        let lower = command.to_lowercase();
        for path in &self.config.protected_paths {
            let path_lower = path.to_lowercase();
            if !lower.contains(&path_lower) {
                continue;
            }
            let dangerous = [
                "rm ", "chmod ", "chown ", "mv ", "cp ", "dd ", "mkfs", "fdisk ",
            ];
            for prefix in &dangerous {
                if lower.contains(prefix) {
                    return Err(EngineError::PermissionDenied(format!(
                        "Command affects protected path '{path}'"
                    )));
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_action_guard_blocks_rm_rf() {
        let guard = ActionGuard::unwrap_default();
        assert!(guard.check_command("rm -rf /").is_err());
        assert!(guard.check_command("rm -rf /etc").is_err());
        assert!(guard.check_command("rm -rf ~").is_err());
    }

    #[test]
    fn test_action_guard_blocks_protected_paths() {
        let guard = ActionGuard::unwrap_default();
        assert!(guard.check_command("chmod 777 /etc/passwd").is_err());
        assert!(guard.check_command("rm -rf ~/.ssh").is_err());
    }

    #[test]
    fn test_action_guard_allows_safe_commands() {
        let guard = ActionGuard::unwrap_default();
        assert!(guard.check_command("ls -la").is_ok());
        assert!(guard.check_command("npm install").is_ok());
        assert!(guard.check_command("cargo build").is_ok());
    }
}
