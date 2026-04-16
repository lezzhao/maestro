use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    Thinking,
    ExecutingTool,
    Completed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControlFrame {
    Phase(AgentPhase),
    Notice(String),
    Trace(String),     // Internal execution trace / monologue
}

impl ControlFrame {
    pub const PREFIX: &'static str = "\u{0000}";

    pub fn serialize(&self) -> String {
        match self {
            Self::Phase(phase) => {
                let p_str = match phase {
                    AgentPhase::Thinking => "thinking",
                    AgentPhase::ExecutingTool => "executing_tool",
                    AgentPhase::Completed => "completed",
                };
                format!("{}PHASE:{}", Self::PREFIX, p_str)
            }
            Self::Notice(msg) => {
                format!("{}NOTICE:{}", Self::PREFIX, msg)
            }
            Self::Trace(msg) => {
                format!("{}TRACE:{}", Self::PREFIX, msg)
            }
        }
    }
}
