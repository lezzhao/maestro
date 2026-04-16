use super::{Tool, ToolDefinition};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use async_trait::async_trait;
use std::sync::Arc;
use crate::core::harness::HarnessManager;
use crate::core::harness::mode::HarnessMode;

pub struct HarnessTransitionTool {
    pub harness_mgr: Arc<HarnessManager>,
    pub task_id: String,
}

#[async_trait]
impl Tool for HarnessTransitionTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "harness_transition".into(),
            description: "切换 Harness 的执行模式（Strategic, Action, Review）。当你完成当前阶段的任务并准备进入下一阶段时调用。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "new_mode": {
                        "type": "string",
                        "enum": ["strategic", "action", "review"],
                        "description": "要进入的新模式"
                    },
                    "reason": {
                        "type": "string",
                        "description": "切换模式的原因或当前阶段的简要总结"
                    }
                },
                "required": ["new_mode"]
            }),
            requires_confirmation: true,
            security_level: crate::tools::ToolSecurityLevel::Medium,
        }
    }

    async fn execute(&self, args: Value, _cancel_token: CancellationToken) -> Result<String, String> {
        let new_mode_str = args.get("new_mode").and_then(|v| v.as_str()).ok_or("Missing new_mode argument")?;
        let reason = args.get("reason").and_then(|v| v.as_str()).unwrap_or("No reason provided");
        
        let new_mode = HarnessMode::from_str(new_mode_str).ok_or_else(|| format!("Invalid mode: {}", new_mode_str))?;
        
        self.harness_mgr.transition(&self.task_id, new_mode).map_err(|e| e.to_string())?;
        
        Ok(format!("Successfully transitioned to {} mode. Reason: {}", new_mode_str, reason))
    }
}
