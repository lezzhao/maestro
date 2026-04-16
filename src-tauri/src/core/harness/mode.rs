use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HarnessMode {
    /// Initial mode for planning and architecture analysis.
    Strategic,
    /// Mode for active code changes, implementation, and command execution.
    Action,
    /// Mode for verification, testing, and final review.
    Review,
}

impl HarnessMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Strategic => "strategic",
            Self::Action => "action",
            Self::Review => "review",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "strategic" => Some(Self::Strategic),
            "action" => Some(Self::Action),
            "review" => Some(Self::Review),
            _ => None,
        }
    }

    /// Returns the system instructions (role) associated with the mode.
    pub fn system_prompt(&self) -> &'static str {
        match self {
            Self::Strategic => {
                "You are in STRATEGIC mode. Your goal is to analyze the task, identify affected components, and produce a high-level technical plan. Avoid implementation details for now. Focus on 'Why' and 'How' at an architectural level."
            }
            Self::Action => {
                "You are in ACTION mode. Your goal is to execute the approved plan. Write code, modify files, and run commands as necessary. Prioritize correctness and edge-case handling."
            }
            Self::Review => {
                "You are in REVIEW mode. Your goal is to verify that the implementation meets the requirements. Run tests, perform self-code review, and ensure no regressions were introduced."
            }
        }
    }
}

impl Default for HarnessMode {
    fn default() -> Self {
        Self::Strategic
    }
}
