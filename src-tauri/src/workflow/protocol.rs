use serde::{Deserialize, Serialize};

use crate::workflow::types::VerificationSummary;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsagePayload {
    pub approx_input_tokens: usize,
    pub approx_output_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalPayload {
    pub request_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum StreamFrame {
    #[serde(rename = "run_id")]
    RunId(String),
    #[serde(rename = "output")]
    Output(String),
    #[serde(rename = "verification")]
    Verification(VerificationSummary),
    #[serde(rename = "exit")]
    Exit(i32),
    #[serde(rename = "error")]
    Error(String),
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "token_usage")]
    TokenUsage(TokenUsagePayload),
    #[serde(rename = "tool_approval_request")]
    ToolApprovalRequest(ToolApprovalPayload),
}

impl StreamFrame {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{\"type\":\"error\",\"payload\":\"serialization failed\"}".to_string())
    }

    pub fn to_frame_string(&self) -> String {
        format!("\u{0}{}", self.to_json())
    }
}
