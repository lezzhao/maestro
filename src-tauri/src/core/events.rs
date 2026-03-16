use crate::ipc::IpcResponse;
use serde_json::Value;

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
        self.0.send(data).map_err(|e| e.to_string())
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
        let _ = self.tx.try_send(IpcResponse {
            id: self.msg_id.clone(),
            result: Some(msg),
            error: None,
            is_stream: true,
        });
        Ok(())
    }
}

pub struct MpscStringStream {
    pub tx: tokio::sync::mpsc::Sender<IpcResponse>,
    pub msg_id: Option<String>,
}

impl StringStream for MpscStringStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        let _ = self.tx.try_send(IpcResponse {
            id: self.msg_id.clone(),
            result: Some(serde_json::Value::String(data)),
            error: None,
            is_stream: true,
        });
        Ok(())
    }
}
