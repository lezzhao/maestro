use super::McpServerHandle;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct McpClient {
    pub handle: Arc<McpServerHandle>,
}

impl McpClient {
    pub fn new(handle: Arc<McpServerHandle>) -> Self {
        Self { handle }
    }

    pub async fn initialize(&self) -> Result<Value, String> {
        self.handle.call("initialize", json!({
            "protocolVersion": "1.0",
            "capabilities": {},
            "clientInfo": {
                "name": "Maestro",
                "version": "0.1.0"
            }
        })).await
    }

    pub async fn list_tools(&self) -> Result<Vec<McpToolDefinition>, String> {
        let res = self.handle.call("tools/list", json!({})).await?;
        let tools = res.get("tools").and_then(|v| v.as_array()).ok_or("Failed to get tools list")?;
        
        let mut list = Vec::new();
        for t in tools {
            let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let description = t.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let input_schema = t.get("inputSchema").cloned().unwrap_or(json!({}));
            if !name.is_empty() {
                list.push(McpToolDefinition { name, description, input_schema });
            }
        }
        Ok(list)
    }

    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String> {
        let res = self.handle.call("tools/call", json!({
            "name": name,
            "arguments": arguments
        })).await?;
        
        // MCP tools/call returns a result with 'content' array
        if let Some(content) = res.get("content").and_then(|v| v.as_array()) {
            let mut result = String::new();
            for item in content {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    result.push_str(text);
                }
            }
            Ok(result)
        } else {
            Err("Invalid tool call response: missing content".into())
        }
    }
}

pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}
