use crate::scoped_fs::ScopedFS;
use std::sync::Arc;
use crate::tools::ToolBox;
use crate::tools::builtin;
use crate::tools::mcp_proxy;
use crate::mcp::service::McpService;

pub struct ToolRegistry {
    mcp_service: Arc<McpService>,
}

impl ToolRegistry {
    pub fn new(mcp_service: Arc<McpService>) -> Self {
        Self { mcp_service }
    }

    pub async fn build_toolbox(&self, root: std::path::PathBuf) -> Result<ToolBox, String> {
        let mut toolbox = ToolBox::new();
        let workspace = ScopedFS::new(root)?;

        // 1. Register Builtin Tools
        toolbox.register(Arc::new(builtin::ReadFileTool { workspace: workspace.clone() }));
        toolbox.register(Arc::new(builtin::ListDirTool { workspace: workspace.clone() }));
        toolbox.register(Arc::new(builtin::SearchRepoTool { workspace: workspace.clone() }));
        toolbox.register(Arc::new(builtin::WriteFileTool { workspace: workspace.clone() }));
        toolbox.register(Arc::new(builtin::RunCommandTool { workspace: workspace.clone() }));
        toolbox.register(Arc::new(builtin::FinishTaskTool));

        // 2. Register MCP Tools
        let clients = self.mcp_service.get_clients().await;
        for client in clients {
            if let Ok(mcp_tools) = client.list_tools().await {
                for t in mcp_tools {
                    toolbox.register(Arc::new(mcp_proxy::McpToolProxy {
                        client: client.clone(),
                        name: t.name,
                        description: t.description,
                        schema: t.input_schema,
                    }));
                }
            }
        }

        Ok(toolbox)
    }
}
