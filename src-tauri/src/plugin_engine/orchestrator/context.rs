use crate::api_provider::{ApiProviderAttachment, ApiProviderMessage};
use crate::plugin_engine::maestro_engine::ApiChatRequest;
use crate::workflow::types::ChatApiMessage;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

const DEFAULT_MAX_MESSAGES: usize = 48;
const DEFAULT_MAX_INPUT_TOKENS: usize = 12_000;

#[derive(Debug, Deserialize)]
struct PersistedConversation {
    pub messages: Vec<PersistedMessage>,
}

#[derive(Debug, Deserialize)]
struct PersistedMessage {
    pub id: String,
    pub role: String,
    pub content: String,
}

#[allow(dead_code)]
const MAESTRO_SYSTEM_IDENTITY: &str = r#"<identity>
你是一位顶级全栈工程师与 AI 开发中枢 (Maestro Omni-Agent Orchestrator)。
你不仅具备卓越的代码编写能力，还擅长多步骤任务编排、环境诊断与自主决策。
你的目标是以前瞻性的眼光，高效、安全地解决用户提出的任何开发挑战。
</identity>

<thought_process>
在采取任何行动（特别是调用工具）之前，请务必进行深入思考：
1. **分析现状**：理解当前的上下文、文件结构和用户意图。
2. **制定计划**：将任务分解为逻辑清晰的子目标。
3. **预期结果**：预测每一步操作的影响与可能的异常。
4. **即时修正**：根据工具返回的执行结果（stdout/stderr），实时调整后续方案。
请在内部单色气泡中使用 <think> 标签展示你的思考过程分支。
</thought_process>

<capabilities>
你拥有的核心能力包括但不限于：
- 源码审计与逻辑分析。
- 多语言全栈开发 (Node.js, Rust, Python, Go, etc.)。
- 系统命令执行与 PTY 交互。
- 上下文感知的自动化测试与验证。
</capabilities>

<constraints>
1. **安全性第一**：严禁无故修改系统关键路径（如 /etc）或执行具有破坏性的全局删除命令。
2. **最小侵入原则**：代码修改应精准、优雅，避免多余的重构或格式化。
3. **路径规范**：所有文件操作必须基于当前工作目录，优先使用相对路径。
4. **错误处理**：若工具报错，应分析 stderr 并尝试自我修复或向用户解释原因。
5. **任务终结**：当你确信任务已圆满完成、无后续步骤时，**必须**调用 `finish_task` 工具进行总结。禁止在未调用该工具的情况下直接宣告结束。
</constraints>
"#;

pub struct ContextManager {
    pub messages: Vec<ApiProviderMessage>,
    pub system_prompt: String,
}

impl ContextManager {
    #[allow(dead_code)]
    pub fn new(messages: Vec<ApiProviderMessage>, system_prompt: String) -> Self {
        Self {
            messages,
            system_prompt,
        }
    }

    /// Unified initialization from an ApiChatRequest.
    /// Handles: Identity, Task Context, Pinned Files, Memory Recall (RAG), and Windowing.
    pub async fn from_request(request: &ApiChatRequest, root: PathBuf, cfg: &crate::config::AppConfig) -> Self {
        let i18n = cfg.i18n();

        // 1. Build System Identity
        let mut system_prompt = i18n.t("system_identity");

        // 2. Append User/Task specific prompt
        if let Some(user_prompt) = &request.system_prompt {
            if !user_prompt.trim().is_empty() {
                system_prompt.push_str(&format!("\n\n<task_context>\n{}\n</task_context>", user_prompt.trim()));
            }
        }

        // 3. Incorporate Pinned Files
        if !request.pinned_files.is_empty() {
             let mut pinned_context = i18n.t("context_files_header");
             for rel_path in &request.pinned_files {
                 let full_path = root.join(rel_path);
                 if let Ok(content) = std::fs::read_to_string(&full_path) {
                     pinned_context.push_str(&format!("\n--- FILE: {} ---\n{}\n", rel_path, content));
                 }
             }
             pinned_context.push_str("\n</context_files>");
             system_prompt.push_str(&pinned_context);
        }

        // 4. Resolve Source Messages
        let source_messages = if !request.messages.is_empty() {
            request.messages.clone()
        } else if !request.message_ids.is_empty() {
            // Load by IDs from DB or JSON fallback
            Self::load_messages_by_ids(&request.message_ids).await
        } else {
            Vec::new()
        };

        // 5. Map and Sanitize Messages
        let mut messages: Vec<ApiProviderMessage> = source_messages.into_iter().filter_map(|m| {
            let content = m.content.trim().to_string();
            if content.is_empty() && m.attachments.is_none() {
                return None;
            }
            Some(ApiProviderMessage {
                role: m.role,
                content,
                attachments: m.attachments.map(|atts| {
                    atts.into_iter().map(|a| ApiProviderAttachment {
                        name: a.name,
                        mime_type: a.mime_type,
                        data: a.data,
                    }).collect()
                }),
                tool_calls: None,
                tool_call_id: None,
            })
        }).collect();

        // 5. Inject Memories (RAG)
        if let Ok(db_path) = crate::task::state::maestro_db_path_core() {
            let query = messages.iter().rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.as_str())
                .unwrap_or("");
            
            if !query.is_empty() {
                if let Ok(recalled) = crate::storage::memory::recall_memories(&db_path, query, 5) {
                    if !recalled.is_empty() {
                        let memory_prompt = format!("\n\n[Relevant Memories]:\n{}\n", recalled);
                        system_prompt.push_str(&memory_prompt);
                    }
                }
            }
        }

        // 6. Apply Windowing
        let max_messages = DEFAULT_MAX_MESSAGES; // Could be parameterized
        let max_tokens = DEFAULT_MAX_INPUT_TOKENS;

        if messages.len() > max_messages {
            messages = messages.split_off(messages.len().saturating_sub(max_messages));
        }

        // Simple token estimation (chars / 4)
        let mut total_chars: usize = messages.iter().map(|m| m.content.chars().count()).sum();
        while messages.len() > 1 && (total_chars / 4) > max_tokens {
            let removed = messages.remove(0);
            total_chars = total_chars.saturating_sub(removed.content.chars().count());
        }

        Self {
            messages,
            system_prompt,
        }
    }

    pub fn register_tool_result(&mut self, tool_call_id: &str, result: &str, cfg: &crate::config::AppConfig) {
        let i18n = cfg.i18n();
        let max_len = 12000;
        let content = if result.len() > max_len {
            let head = &result[..4000];
            let tail = &result[result.len() - 6000..];
            let removed = result.len() - 10000;
            let truncated_mid = i18n.t_n("truncated_buffer", removed);
            format!("{head}{truncated_mid}{tail}")
        } else {
            result.to_string()
        };

        self.messages.push(ApiProviderMessage {
            role: "tool".into(),
            content,
            attachments: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
        });
    }

    pub fn add_assistant_message(&mut self, content: String, tool_calls: Option<Vec<crate::tools::ToolCall>>, cfg: &crate::config::AppConfig) {
        self.messages.push(ApiProviderMessage {
            role: "assistant".into(),
            content,
            attachments: None,
            tool_calls,
            tool_call_id: None,
        });

        // Auto-prune if message history is too deep
        self.ensure_window_safety(cfg);
    }

    /// Ensure the context window is safe for the next LLM request.
    pub fn ensure_window_safety(&mut self, cfg: &crate::config::AppConfig) {
        if self.messages.len() > 40 {
            self.prune(cfg);
        }
    }

    /// Semantic Compaction: Prune the middle of the history, keeping assistant thoughts but
    /// shedding bulk tool results that are no longer in the immediate vicinity of the task.
    pub fn prune(&mut self, cfg: &crate::config::AppConfig) {
        let i18n = cfg.i18n();
        if self.messages.len() <= 20 {
            return;
        }

        let keep_last = 12;
        let keep_first = 5; 
        let total = self.messages.len();

        for i in keep_first..(total - keep_last) {
            let msg = &mut self.messages[i];
            if msg.role == "tool" && msg.content.len() > 200 {
                if !msg.content.starts_with("Error:") {
                    msg.content = i18n.t_n("history_summary", msg.content.len());
                }
            }
        }
    }

    async fn load_messages_by_ids(message_ids: &[String]) -> Vec<ChatApiMessage> {
        if message_ids.is_empty() {
            return Vec::new();
        }
        let home = dirs::home_dir().unwrap_or_default();
        let path = home.join(".maestro").join("last-conversation.json");
        
        if !path.exists() {
            return Vec::new();
        }

        let text = match tokio::fs::read_to_string(&path).await {
            Ok(t) => t,
            _ => return Vec::new(),
        };

        let payload = match serde_json::from_str::<PersistedConversation>(&text) {
            Ok(p) => p,
            _ => return Vec::new(),
        };

        let mut by_id: HashMap<String, PersistedMessage> = HashMap::new();
        for msg in payload.messages {
            by_id.insert(msg.id.clone(), msg);
        }

        let mut out = Vec::new();
        for id in message_ids {
            if let Some(found) = by_id.get(id) {
                out.push(ChatApiMessage {
                    role: found.role.clone(),
                    content: found.content.clone(),
                    attachments: None,
                });
            }
        }
        out
    }
}
