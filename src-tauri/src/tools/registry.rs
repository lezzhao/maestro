use crate::infra::scoped_fs::ScopedFS;
use std::sync::Arc;
use crate::tools::ToolBox;
use crate::tools::builtin;
use crate::tools::mcp_proxy;
use crate::mcp::service::McpService;

pub struct ToolRegistry {
    mcp_service: Arc<McpService>,
    sandbox_manager: crate::tools::sandbox::SandboxManager,
    harness_mgr: Arc<crate::core::harness::HarnessManager>,
    db_path: std::path::PathBuf,
}

impl ToolRegistry {
    pub fn new(
        mcp_service: Arc<McpService>,
        sandbox_manager: crate::tools::sandbox::SandboxManager,
        harness_mgr: Arc<crate::core::harness::HarnessManager>,
        db_path: std::path::PathBuf,
    ) -> Self {
        Self { mcp_service, sandbox_manager, harness_mgr, db_path }
    }

    pub async fn build_toolbox(&self, root: std::path::PathBuf, task_id: Option<String>) -> Result<ToolBox, String> {
        let mut toolbox = ToolBox::new();
        let workspace = ScopedFS::new(root)?;

        // 1. Register Builtin Tools
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::ReadFileTool { workspace: workspace.clone() })));
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::ListDirTool { workspace: workspace.clone() })));
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::SearchRepoTool { workspace: workspace.clone() })));
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::WriteFileTool { workspace: workspace.clone() })));
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::RunCommandTool { workspace: workspace.clone() })));
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::FinishTaskTool)));
        toolbox.register(self.sandbox_manager.wrap(Arc::new(builtin::LearnSkillTool { db_path: self.db_path.clone() })));

        // Harness Tools
        if let Some(tid) = task_id {
            toolbox.register(Arc::new(super::harness_tools::HarnessTransitionTool {
                harness_mgr: self.harness_mgr.clone(),
                task_id: tid,
            }));
        }

        // 2. Register MCP Tools
        let clients = self.mcp_service.get_clients().await;
        for client in clients {
            if let Ok(mcp_tools) = client.list_tools().await {
                for t in mcp_tools {
                    toolbox.register(self.sandbox_manager.wrap(Arc::new(mcp_proxy::McpToolProxy {
                        client: client.clone(),
                        name: t.name,
                        description: t.description,
                        schema: t.input_schema,
                    })));
                }
            }
        }

        Ok(toolbox)
    }
}
