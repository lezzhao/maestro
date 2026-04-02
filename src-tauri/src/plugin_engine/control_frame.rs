use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    Thinking,
    ExecutingTool,
    Completed,
    #[allow(dead_code)]
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalRequest {
    pub request_id: String,
    pub tool_name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControlFrame {
    Phase(AgentPhase),
    #[allow(dead_code)]
    ToolApprovalRequest(ApprovalRequest),
    Notice(String),
    #[allow(dead_code)]
    TokenUsage(Value), // Reuse the existing JSON structure for token usage
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
                    AgentPhase::Error => "error",
                };
                format!("{}PHASE:{}", Self::PREFIX, p_str)
            }
            Self::ToolApprovalRequest(req) => {
                let json = serde_json::to_string(req).unwrap_or_default();
                format!("{}TOOL_APPROVAL_REQUEST:{}", Self::PREFIX, json)
            }
            Self::Notice(msg) => {
                format!("{}NOTICE:{}", Self::PREFIX, msg)
            }
            Self::TokenUsage(usage) => {
                let json = serde_json::to_string(usage).unwrap_or_default();
                format!("{}TOKEN_USAGE:{}", Self::PREFIX, json)
            }
            Self::Trace(msg) => {
                format!("{}TRACE:{}", Self::PREFIX, msg)
            }
        }
    }
}
