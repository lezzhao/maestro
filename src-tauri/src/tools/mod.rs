use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;
use async_trait::async_trait;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value, // JSON Schema
    #[serde(default)]
    pub requires_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String, // JSON string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub content: String,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    async fn execute(&self, args: Value, cancel_token: CancellationToken) -> Result<String, String>;
}

pub struct ToolBox {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl ToolBox {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        let def = tool.definition();
        self.tools.insert(def.name, tool);
    }

    pub fn get_definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().map(|t| t.definition()).collect()
    }

    pub fn get_tool_definition(&self, name: &str) -> Option<ToolDefinition> {
        self.tools.get(name).map(|t| t.definition())
    }

    pub async fn execute(&self, name: &str, args_json: &str, cancel_token: CancellationToken) -> Result<String, String> {
        let tool = self.tools.get(name).ok_or_else(|| format!("Tool not found: {name}"))?;
        let args: Value = serde_json::from_str(args_json).map_err(|e| format!("Invalid tool arguments: {e}"))?;
        tool.execute(args, cancel_token).await
    }
}

pub mod builtin;
pub mod mcp_proxy;
pub mod registry;
