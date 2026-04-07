use crate::agent_state::{AppEventHandle, AgentStateUpdate, PersistedMessagePayload, PersistedAttachmentPayload};
use crate::core::error::CoreError;
use super::utils::last_conversation_path_core;
use std::sync::Arc;

pub async fn chat_save_last_conversation_core(
    event_handle: Arc<dyn AppEventHandle>,
    payload: serde_json::Value,
) -> Result<(), CoreError> {
    let path = last_conversation_path_core().await?;
    let text = serde_json::to_string_pretty(&payload).map_err(|e| CoreError::Serialization {
        message: format!("serialize last conversation failed: {e}"),
    })?;
    tokio::fs::write(&path, text)
        .await
        .map_err(|e| CoreError::Io {
            message: format!("write last conversation failed: {e}"),
        })?;
    
    // Emit agent state update so frontend can sync
    if let (Some(task_id), Some(messages)) = (
        payload.get("task_id").and_then(|v| v.as_str()),
        payload.get("messages").and_then(|v| v.as_array()),
    ) {
        let msgs: Vec<PersistedMessagePayload> = messages
            .iter()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?.to_string();
                let role = m.get("role")?.as_str().unwrap_or("user").to_string();
                let content = m.get("content")?.as_str().unwrap_or("").to_string();
                let timestamp = m.get("timestamp").and_then(|value| value.as_i64());
                let status = m
                    .get("status")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string());
                let attachments = m
                    .get("attachments")
                    .and_then(|value| value.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                Some(PersistedAttachmentPayload {
                                    name: item.get("name")?.as_str()?.to_string(),
                                    path: item.get("path")?.as_str()?.to_string(),
                                    snippet: item
                                        .get("snippet")
                                        .and_then(|value| value.as_str())
                                        .map(|value| value.to_string()),
                                })
                            })
                            .collect::<Vec<_>>()
                    })
                    .filter(|items| !items.is_empty());
                let meta = m.get("meta").cloned().filter(|value| value.is_object());
                Some(PersistedMessagePayload {
                    id,
                    role,
                    content,
                    timestamp,
                    status,
                    attachments,
                    meta,
                })
            })
            .collect();
        event_handle.emit_state_update_with_token(
            AgentStateUpdate::MessagesUpdated {
                task_id: task_id.to_string(),
                messages: msgs,
            },
            None,
        );
    }
    Ok(())
}

pub async fn chat_load_last_conversation_core(
    _event_handle: Arc<dyn AppEventHandle>,
) -> Result<Option<serde_json::Value>, CoreError> {
    let path = last_conversation_path_core().await?;
    if !path.exists() {
        return Ok(None);
    }
    let text = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| CoreError::Io {
            message: format!("read last conversation failed: {e}"),
        })?;
    let payload =
        serde_json::from_str::<serde_json::Value>(&text).map_err(|e| CoreError::Serialization {
            message: format!("parse last conversation failed: {e}"),
        })?;
    Ok(Some(payload))
}
