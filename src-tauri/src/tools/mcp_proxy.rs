use super::{Tool, ToolDefinition};
use crate::mcp::client::McpClient;
use serde_json::Value;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use async_trait::async_trait;

pub struct McpToolProxy {
    pub client: Arc<McpClient>,
    pub name: String,
    pub description: String,
    pub schema: Value,
}

#[async_trait]
impl Tool for McpToolProxy {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name.clone(),
            description: self.description.clone(),
            parameters: self.schema.clone(),
            requires_confirmation: false,
            security_level: crate::tools::ToolSecurityLevel::Medium,
        }
    }

    async fn execute(&self, args: Value, cancel_token: CancellationToken) -> Result<String, String> {
        let client = self.client.clone();
        let name = self.name.clone();
        
        tokio::select! {
            _ = cancel_token.cancelled() => {
                Err("MCP tool call cancelled by user.".into())
            }
            res = client.call_tool(&name, args) => {
                res
            }
        }
    }
}
