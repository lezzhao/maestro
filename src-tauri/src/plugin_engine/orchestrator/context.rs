use crate::api_provider::{ApiProviderAttachment, ApiProviderMessage};
use crate::plugin_engine::maestro_engine::ApiChatRequest;
use crate::workflow::types::ChatApiMessage;
use std::path::PathBuf;
use crate::workflow::util::estimate_token_count;

const DEFAULT_MAX_MESSAGES: usize = 48;
const DEFAULT_MAX_INPUT_TOKENS: usize = 12_000;

pub struct ContextManager {
    pub messages: Vec<ApiProviderMessage>,
    pub system_prompt: String,
}

impl ContextManager {

    /// Unified initialization from an ApiChatRequest.
    /// Handles: Identity, Task Context, Pinned Files, Memory Recall (RAG), and Windowing.
    pub async fn from_request(
        request: &ApiChatRequest,
        root: PathBuf,
        cfg: &crate::config::AppConfig,
        harness_mode: Option<crate::core::harness::mode::HarnessMode>,
        strategic_plan: Option<String>,
    ) -> Self {
        let i18n = cfg.i18n();

        // 1. Build System Identity
        let mut system_prompt = i18n.t("system_identity");

        // 2. Append User/Task specific prompt
        if let Some(user_prompt) = &request.system_prompt {
            if !user_prompt.trim().is_empty() {
                system_prompt.push_str(&format!("\n\n<task_context>\n{}\n</task_context>", user_prompt.trim()));
            }
        }

        // 2b. Inject Harness Mode prompt
        if let Some(mode) = harness_mode {
            let mode_prompt = mode.system_prompt();
            system_prompt.push_str(&format!("\n\n<harness_mode name=\"{}\">\n{}\n</harness_mode>", mode.as_str(), mode_prompt));
        }

        if let Some(plan) = strategic_plan {
            system_prompt.push_str(&format!("\n\n<strategic_plan>\n{}\n</strategic_plan>", plan));
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
                // 5a. Recall Global Memories
                if let Ok(recalled) = crate::storage::memory::recall_memories(&db_path, query, 5) {
                    if !recalled.is_empty() {
                        let memory_prompt = format!("\n\n[Relevant Memories]:\n{}\n", recalled);
                        system_prompt.push_str(&memory_prompt);
                    }
                }

                // 5b. Recall Learned Skills
                let service = crate::storage::knowledge_service::KnowledgeService::new(db_path);
                if let Ok(skills) = service.query_skills(query, 3) {
                    if !skills.is_empty() {
                        let mut skills_prompt = String::from("\n\n<learned_skills>\n我的全局技能库中发现以下相关技能，我将优先参考这些模式进行操作：");
                        for skill in skills {
                            skills_prompt.push_str(&format!("\n\n-- SKILL: {} --\n{}", skill.id, skill.content));
                        }
                        skills_prompt.push_str("\n</learned_skills>");
                        system_prompt.push_str(&skills_prompt);
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

        // Accurate token estimation using tiktoken-rs
        let mut total_tokens: usize = messages.iter().map(|m| estimate_token_count(&m.content)).sum();
        while messages.len() > 1 && total_tokens > max_tokens {
            let removed = messages.remove(0);
            total_tokens = total_tokens.saturating_sub(estimate_token_count(&removed.content));
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
        if let Ok(db_path) = crate::task::state::maestro_db_path_core() {
            if let Ok(msgs) = crate::storage::conversation::get_messages_by_ids(&db_path, message_ids) {
                return msgs.into_iter().map(|m| ChatApiMessage {
                    role: m.role,
                    content: m.content,
                    attachments: None, // Attachments handled via separate API flow usually
                }).collect();
            }
        }
        Vec::new()
    }
}
