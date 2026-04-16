use super::{Tool, ToolDefinition};
use serde_json::{json, Value};
use std::fs;
use tokio_util::sync::CancellationToken;
use async_trait::async_trait;
use crate::infra::scoped_fs::ScopedFS;
use std::time::Duration;

pub struct ReadFileTool {
    pub workspace: ScopedFS,
}

#[async_trait]
impl Tool for ReadFileTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "read_file".into(),
            description: "读取指定路径的文件内容。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "相对于项目根目录的文件路径"
                    }
                },
                "required": ["path"]
            }),
            requires_confirmation: false,
            security_level: crate::tools::ToolSecurityLevel::Low,
        }
    }

    async fn execute(&self, args: Value, _cancel_token: CancellationToken) -> Result<String, String> {
        let rel_path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path argument")?;
        let full_path = self.workspace.resolve_in_scope(rel_path)?;
        
        fs::read_to_string(full_path).map_err(|e| format!("Failed to read file: {e}"))
    }
}

pub struct ListDirTool {
    pub workspace: ScopedFS,
}

#[async_trait]
impl Tool for ListDirTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_dir".into(),
            description: "列出指定目录下的文件和文件夹。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "相对于项目根目录的目录路径，默认为 \".\""
                    }
                }
            }),
            requires_confirmation: false,
            security_level: crate::tools::ToolSecurityLevel::Low,
        }
    }

    async fn execute(&self, args: Value, _cancel_token: CancellationToken) -> Result<String, String> {
        let rel_path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let full_path = self.workspace.resolve_in_scope(rel_path)?;

        let entries = fs::read_dir(full_path).map_err(|e| format!("Failed to read directory: {e}"))?;
        let mut result = Vec::new();
        for entry in entries.flatten() {
            let file_type = if entry.path().is_dir() { "dir" } else { "file" };
            result.push(format!("[{}] {}", file_type, entry.file_name().to_string_lossy()));
        }
        Ok(result.join("\n"))
    }
}

pub struct SearchRepoTool {
    pub workspace: ScopedFS,
}

#[async_trait]
impl Tool for SearchRepoTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "search_repo".into(),
            description: "在整个项目代码库中搜索指定字符串或模式。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或正则表达式"
                    }
                },
                "required": ["query"]
            }),
            requires_confirmation: false,
            security_level: crate::tools::ToolSecurityLevel::Low,
        }
    }

    async fn execute(&self, args: Value, cancel_token: CancellationToken) -> Result<String, String> {
        let query = args.get("query").and_then(|v| v.as_str()).ok_or("Missing query argument")?;
        
        let child = tokio::process::Command::new("grep")
            .arg("-r")
            .arg("--max-count=50")
            .arg(query)
            .arg(".")
            .current_dir(self.workspace.root())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Search failed to spawn: {e}"))?;

        tokio::select! {
            _ = cancel_token.cancelled() => {
                Err("Search cancelled by user.".into())
            }
            res = child.wait_with_output() => {
                match res {
                    Ok(output) => {
                        let text = String::from_utf8_lossy(&output.stdout);
                        if text.is_empty() {
                            Ok("No matches found.".into())
                        } else {
                            Ok(text.into())
                        }
                    }
                    Err(e) => Err(format!("Search failed: {e}")),
                }
            }
        }
    }
}

pub struct WriteFileTool {
    pub workspace: ScopedFS,
}

#[async_trait]
impl Tool for WriteFileTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "write_file".into(),
            description: "在指定路径创建或覆盖文件。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "相对于项目根目录的文件路径" },
                    "content": { "type": "string", "description": "文件的完整内容" }
                },
                "required": ["path", "content"]
            }),
            requires_confirmation: true,
            security_level: crate::tools::ToolSecurityLevel::Medium,
        }
    }

    async fn execute(&self, args: Value, _cancel_token: CancellationToken) -> Result<String, String> {
        let rel_path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing content")?;
        let full_path = self.workspace.resolve_in_scope(rel_path)?;

        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {e}"))?;
        }

        // --- File Shadowing (Backup before overwrite) ---
        if full_path.exists() {
            let backup_id = uuid::Uuid::new_v4().to_string();
            let backup_dir = self.workspace.root().join(".maestro-cli").join("backups").join(&backup_id);
            if let Some(backup_parent) = backup_dir.join(rel_path).parent() {
                let _ = fs::create_dir_all(backup_parent);
            }
            let _ = fs::copy(&full_path, backup_dir.join(rel_path));
        }
        // ------------------------------------------------

        fs::write(full_path, content).map_err(|e| format!("Failed to write file: {e}"))?;
        Ok(format!("Successfully wrote to {}", rel_path))
    }
}

pub struct RunCommandTool {
    pub workspace: ScopedFS,
}

impl RunCommandTool {
    fn is_dangerous(&self, command: &str) -> bool {
        let blacklist = ["rm -rf", "sudo", "chmod -R", "chown", "mkfs", "dd if=", ":(){ :|:& };:"];
        blacklist.iter().any(|&bad| command.contains(bad))
    }
}

#[async_trait]
impl Tool for RunCommandTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "run_command".into(),
            description: "在项目根目录执行 shell 命令。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的命令" }
                },
                "required": ["command"]
            }),
            requires_confirmation: true,
            security_level: crate::tools::ToolSecurityLevel::High,
        }
    }

    async fn execute(&self, args: Value, cancel_token: CancellationToken) -> Result<String, String> {
        let command_str = args.get("command").and_then(|v| v.as_str()).ok_or("Missing command")?;
        
        if self.is_dangerous(command_str) {
            return Err("Access denied: The command contains potentially dangerous operations (e.g., rm -rf /, sudo). Execution blocked for safety.".into());
        }

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = tokio::process::Command::new("cmd");
            c.arg("/C").arg(command_str);
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.arg("-c").arg(command_str);
            c
        };
        cmd.current_dir(self.workspace.root())
           .stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::piped())
           .stdin(std::process::Stdio::null())
           .kill_on_drop(true);

        let child = cmd.spawn().map_err(|e| format!("Command execution failed to spawn: {e}"))?;

        let timeout_duration = Duration::from_secs(60);
        let output_res = tokio::select! {
            _ = cancel_token.cancelled() => {
                return Err("Command execution cancelled by user.".into());
            }
            res = tokio::time::timeout(timeout_duration, child.wait_with_output()) => {
                match res {
                    Ok(wait_res) => wait_res,
                    Err(_) => return Err("Command execution timed out after 60 seconds.".into()),
                }
            }
        };

        match output_res {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let status = output.status.code().unwrap_or(-1);

                if output.status.success() {
                    Ok(format!("Command finished successfully (code 0).\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}"))
                } else {
                    Ok(format!("Command failed with exit code {status}.\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}"))
                }
            }
            Err(e) => Err(format!("Command execution failed: {e}"))
        }
    }
}
pub struct FinishTaskTool;

#[async_trait]
impl Tool for FinishTaskTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "finish_task".into(),
            description: "显式完结当前任务。当你认为任务已经圆满完成，或者达到了无法进一步推进的状态时，必须调用此工具。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "对已完成工作的简要总结"
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "判定制任务完成的理由"
                    }
                },
                "required": ["summary", "reasoning"]
            }),
            requires_confirmation: false,
            security_level: crate::tools::ToolSecurityLevel::Low,
        }
    }

    async fn execute(&self, args: Value, _cancel_token: CancellationToken) -> Result<String, String> {
        let summary = args.get("summary").and_then(|v| v.as_str()).unwrap_or("无总结");
        let reasoning = args.get("reasoning").and_then(|v| v.as_str()).unwrap_or("无理由");
        
        Ok(format!("任务已标记为完成。\n总结: {}\n理由: {}", summary, reasoning))
    }
}

pub struct LearnSkillTool {
    pub db_path: std::path::PathBuf,
}

#[async_trait]
impl Tool for LearnSkillTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "learn_skill".into(),
            description: "将一组成功的操作模式或知识沉淀为全局可复用的'技能'。当你发现某种特定的操作流程（如配置特定环境、解决特定类型的 Bug）非常有效且未来可能再次用到时，应调用此工具。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "技能名称，简短且易于记忆（例：'React-Tailwind-Setup'）"
                    },
                    "description": {
                        "type": "string",
                        "description": "详细描述此技能的应用场景，即什么时候该使用它"
                    },
                    "instructions": {
                        "type": "string",
                        "description": "该技能的具体操作指南，包含步骤、注意点及核心命令。建议使用 Markdown 格式。"
                    }
                },
                "required": ["name", "description", "instructions"]
            }),
            requires_confirmation: false,
            security_level: crate::tools::ToolSecurityLevel::Low,
        }
    }

    async fn execute(&self, args: Value, _cancel_token: CancellationToken) -> Result<String, String> {
        let name = args.get("name").and_then(|v| v.as_str()).ok_or("Missing name")?;
        let description = args.get("description").and_then(|v| v.as_str()).ok_or("Missing description")?;
        let instructions = args.get("instructions").and_then(|v| v.as_str()).ok_or("Missing instructions")?;

        let service = crate::storage::knowledge_service::KnowledgeService::new(self.db_path.clone());
        match service.store_skill(name, description, instructions, None) {
            Ok(id) => Ok(format!("成功沉淀新技能: {} (ID: {})。该技能现在已进入我的全局知识库，未来在类似场景中我会主动回忆并应用。", name, id)),
            Err(e) => Err(format!("技能沉淀失败: {}", e)),
        }
    }
}
