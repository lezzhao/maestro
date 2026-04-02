use crate::mcp::{McpServerHandle, client::McpClient};
use crate::config::AppConfig;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct McpService {
    handles: RwLock<HashMap<String, Arc<McpServerHandle>>>,
}

impl McpService {
    pub fn new() -> Self {
        Self {
            handles: RwLock::new(HashMap::new()),
        }
    }

    pub async fn sync_with_config(&self, config: &AppConfig) -> Result<(), String> {
        let mut handles = self.handles.write().await;
        
        // 1. Remove servers no longer in config
        handles.retain(|id, _| config.mcp_servers.contains_key(id));

        // 2. Add or update servers
        for (id, cfg) in &config.mcp_servers {
            if !handles.contains_key(id) {
                let env_map: HashMap<String, String> = cfg.env.clone().into_iter().collect();
                match McpServerHandle::spawn(id, &cfg.command, &cfg.args, &env_map).await {
                    Ok(handle) => {
                        handles.insert(id.clone(), handle);
                        println!("MCP Server {id} spawned successfully.");
                    }
                    Err(e) => {
                        eprintln!("Failed to spawn MCP server {id}: {e}");
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn get_clients(&self) -> Vec<Arc<McpClient>> {
        let handles = self.handles.read().await;
        handles.values()
            .map(|h| Arc::new(McpClient::new(h.clone())))
            .collect()
    }
}
