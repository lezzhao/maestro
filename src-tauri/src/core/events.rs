use crate::ipc::IpcResponse;
use serde_json::Value;

const MAX_STREAM_CHUNK_BYTES: usize = 4096;

pub trait EventStream: Send + Sync {
    fn send_event(&self, event_name: &str, payload: Value) -> Result<(), String>;
}

pub trait StringStream: Send + Sync {
    fn send_string(&self, data: String) -> Result<(), String>;
}

// Tauri AppHandle adapter
impl EventStream for tauri::AppHandle {
    fn send_event(&self, event_name: &str, payload: Value) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(event_name, payload).map_err(|e| e.to_string())
    }
}

// Tauri Channel adapter
pub struct ChannelStringStream(pub tauri::ipc::Channel<String>);

impl StringStream for ChannelStringStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        if data.is_empty() {
            return Ok(());
        }
        if data.len() <= MAX_STREAM_CHUNK_BYTES {
            return self.0.send(data).map_err(|e| e.to_string());
        }
        for part in data.as_bytes().chunks(MAX_STREAM_CHUNK_BYTES) {
            let chunk = String::from_utf8_lossy(part).to_string();
            self.0.send(chunk).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

pub struct MpscEventStream {
    pub tx: tokio::sync::mpsc::Sender<IpcResponse>,
    pub msg_id: Option<String>,
}

impl EventStream for MpscEventStream {
    fn send_event(&self, event_name: &str, payload: Value) -> Result<(), String> {
        let msg = serde_json::json!({
            "event": event_name,
            "payload": payload,
        });
        self.tx
            .try_send(IpcResponse {
                id: self.msg_id.clone(),
                result: Some(msg),
                error: None,
                is_stream: true,
            })
            .map_err(|e| format!("Channel full/closed: {e}"))?;
        Ok(())
    }
}

pub struct MpscStringStream {
    pub tx: tokio::sync::mpsc::Sender<IpcResponse>,
    pub msg_id: Option<String>,
}

impl StringStream for MpscStringStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        if data.is_empty() {
            return Ok(());
        }
        for part in data.as_bytes().chunks(MAX_STREAM_CHUNK_BYTES) {
            let chunk = String::from_utf8_lossy(part).to_string();
            self.tx
                .try_send(IpcResponse {
                    id: self.msg_id.clone(),
                    result: Some(serde_json::Value::String(chunk)),
                    error: None,
                    is_stream: true,
                })
                .map_err(|e| format!("Channel full/closed: {e}"))?;
        }
        Ok(())
    }
}
use crate::agent_state::AppEventHandle;
use std::sync::Arc;
pub struct StateUpdateStream {
    pub inner: Arc<dyn StringStream>,
    pub event_handle: Arc<dyn AppEventHandle>,
    pub task_id: String,
    pub run_id: String,
}

impl StringStream for StateUpdateStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        let res = self.inner.send_string(data.clone());
        if !data.is_empty() {
            if data.starts_with('\u{0}') {
                // Parsing token usage from control chunk if present
                if data.to_uppercase().contains("TOKEN_USAGE") {
                    if let Some(json_start) = data.find('{') {
                        if let Ok(v) =
                            serde_json::from_str::<serde_json::Value>(&data[json_start..])
                        {
                            let input = v
                                .pointer("/approx_input_tokens")
                                .and_then(|i| i.as_u64())
                                .unwrap_or(0);
                            let output = v
                                .pointer("/approx_output_tokens")
                                .and_then(|o| o.as_u64())
                                .unwrap_or(0);
                            
                            self.event_handle.emit_state_update(
                                crate::agent_state::AgentStateUpdate::ExecutionTokenUsage {
                                    task_id: self.task_id.clone(),
                                    run_id: self.run_id.clone(),
                                    input_tokens: input,
                                    output_tokens: output,
                                },
                            );
                        }
                    }
                }
            } else {
                self.event_handle.emit_state_update(
                    crate::agent_state::AgentStateUpdate::ExecutionOutputChunk {
                        task_id: self.task_id.clone(),
                        run_id: self.run_id.clone(),
                        chunk: data,
                    },
                );
            }
        }
        res
    }
}
