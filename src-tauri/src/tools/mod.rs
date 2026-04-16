use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;
use async_trait::async_trait;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ToolSecurityLevel {
    Low,      // Read-only, no risk (e.g. read_file)
    Medium,   // Limited side effects (e.g. write_file, create_dir)
    High,     // Significant side effects (e.g. execute_shell, network_access)
    Critical, // Irreversible or system-wide (e.g. delete_system_file)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value, // JSON Schema
    #[serde(default)]
    pub requires_confirmation: bool,
    #[serde(default = "default_security_level")]
    pub security_level: ToolSecurityLevel,
}

fn default_security_level() -> ToolSecurityLevel {
    ToolSecurityLevel::Medium
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String, // JSON string
}



#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    fn security_level(&self) -> ToolSecurityLevel {
        self.definition().security_level
    }
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
pub mod harness_tools;
pub mod mcp_proxy;
pub mod registry;
pub mod sandbox;
