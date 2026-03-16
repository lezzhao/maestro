use super::types::{ChatApiMessage, ChatApiRequest, TokenEstimate};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const DEFAULT_MAX_MESSAGES: usize = 48;
const DEFAULT_MAX_INPUT_TOKENS: usize = 12_000;

#[derive(Debug, Clone)]
pub struct BuiltChatContext {
    pub messages: Vec<ChatApiMessage>,
    pub estimate: TokenEstimate,
}

#[derive(Debug, Deserialize)]
struct PersistedConversation {
    messages: Vec<PersistedMessage>,
}

#[derive(Debug, Deserialize)]
struct PersistedMessage {
    id: String,
    role: String,
    content: String,
}

fn estimate_tokens_from_chars(chars: usize) -> usize {
    (chars + 3) / 4
}

fn sanitize_messages(messages: Vec<ChatApiMessage>) -> Vec<ChatApiMessage> {
    messages
        .into_iter()
        .filter_map(|m| {
            let role = m.role.trim().to_string();
            let content = m.content.trim().to_string();
            if content.is_empty() {
                return None;
            }
            let normalized_role = match role.as_str() {
                "system" => "system",
                "assistant" => "assistant",
                _ => "user",
            }
            .to_string();
            Some(ChatApiMessage {
                role: normalized_role,
                content,
            })
        })
        .collect()
}

fn apply_windowing(
    mut messages: Vec<ChatApiMessage>,
    max_messages: usize,
    max_input_tokens: usize,
) -> BuiltChatContext {
    if messages.len() > max_messages {
        messages = messages.split_off(messages.len().saturating_sub(max_messages));
    }

    let mut total_chars: usize = messages.iter().map(|m| m.content.chars().count()).sum();
    let mut total_tokens = estimate_tokens_from_chars(total_chars);

    while messages.len() > 1 && total_tokens > max_input_tokens {
        let drop_idx = messages
            .iter()
            .position(|m| m.role != "system")
            .unwrap_or(0);
        let removed = messages.remove(drop_idx);
        total_chars = total_chars.saturating_sub(removed.content.chars().count());
        total_tokens = estimate_tokens_from_chars(total_chars);
    }

    BuiltChatContext {
        estimate: TokenEstimate {
            input_chars: total_chars,
            output_chars: 0,
            approx_input_tokens: total_tokens,
            approx_output_tokens: 0,
        },
        messages,
    }
}

async fn last_conversation_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve app config dir failed: {e}"))?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create app config dir failed: {e}"))?;
    dir.push("last-conversation.json");
    Ok(dir)
}

async fn load_messages_by_ids(app: &AppHandle, message_ids: &[String]) -> Result<Vec<ChatApiMessage>, String> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    let path = last_conversation_path(app).await?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("read last conversation failed: {e}"))?;
    let payload: PersistedConversation =
        serde_json::from_str(&text).map_err(|e| format!("parse last conversation failed: {e}"))?;
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
            });
        }
    }
    Ok(out)
}

pub async fn build_chat_context(app: Option<&AppHandle>, request: &ChatApiRequest) -> Result<BuiltChatContext, String> {
    let mut source_messages = if !request.messages.is_empty() {
        request.messages.clone()
    } else if let Some(app) = app {
        load_messages_by_ids(app, &request.message_ids).await?
    } else {
        Vec::new()
    };

    source_messages = sanitize_messages(source_messages);
    if source_messages.is_empty() {
        return Err("消息上下文为空，请先发送消息".to_string());
    }

    let max_messages = request
        .max_messages
        .unwrap_or(DEFAULT_MAX_MESSAGES)
        .clamp(8, 200);
    let max_input_tokens = request
        .max_input_tokens
        .unwrap_or(DEFAULT_MAX_INPUT_TOKENS)
        .clamp(512, 128_000);

    Ok(apply_windowing(
        source_messages,
        max_messages,
        max_input_tokens,
    ))
}
