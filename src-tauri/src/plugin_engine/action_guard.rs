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
            protected_paths: vec![
                "/etc".to_string(),
                "/var".to_string(),
                "~/.ssh".to_string(),
            ],
            blocked_commands: vec![
                r"(?i)\brm\s+-rf\s+(/|/etc|/var|~)\b".to_string(),
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
    pub fn new(config: ActionGuardConfig) -> Result<Self, String> {
        let mut regexes = Vec::new();
        for pattern in &config.blocked_commands {
            let re = Regex::new(pattern).map_err(|e| format!("Invalid regex '{}': {}", pattern, e))?;
            regexes.push(re);
        }
        Ok(Self { config, regexes })
    }

    pub fn unwrap_default() -> Self {
        Self::new(ActionGuardConfig::default()).unwrap()
    }

    /// Checks if a command violates any guard rules.
    /// Returns `Err(reason)` if blocked, `Ok(())` if safe.
    pub fn check_command(&self, command: &str) -> Result<(), String> {
        for (i, re) in self.regexes.iter().enumerate() {
            if re.is_match(command) {
                return Err(format!("Command blocked by rule '{}'", self.config.blocked_commands[i]));
            }
        }
        
        // rudimentary path check
        for path in &self.config.protected_paths {
            if command.contains(path) && (command.starts_with("rm ") || command.starts_with("chmod ") || command.starts_with("chown ")) {
                 return Err(format!("Command affects protected path '{}'", path));
            }
        }

        Ok(())
    }
}
