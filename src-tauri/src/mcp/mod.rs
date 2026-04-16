use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{timeout, Duration};

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    pub result: Option<Value>,
    pub error: Option<Value>,
}

pub struct McpServerHandle {
    pub name: String,
    stdin: Mutex<ChildStdin>,
    pending_requests: Arc<Mutex<HashMap<String, mpsc::Sender<JsonRpcResponse>>>>,
    _child: Child,
}

impl McpServerHandle {
    pub async fn spawn(name: &str, command: &str, args: &[String], env: &HashMap<String, String>) -> Result<Arc<Self>, String> {
        let mut child = Command::new(command)
            .args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server {name}: {e}"))?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        
        let pending_requests = Arc::new(Mutex::new(HashMap::<String, mpsc::Sender<JsonRpcResponse>>::new()));
        let pending_clone = pending_requests.clone();

        let handle = Arc::new(Self {
            name: name.to_string(),
            stdin: Mutex::new(stdin),
            pending_requests, // Reuse the same Arc — fixes split-brain bug
            _child: child,
        });

        // We need a background task to read stdout and dispatch messages
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(res) = serde_json::from_str::<JsonRpcResponse>(&line) {
                    let id_str = match &res.id {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        _ => continue,
                    };
                    let mut pending = pending_clone.lock().await;
                    if let Some(tx) = pending.remove(&id_str) {
                        let _ = tx.send(res).await;
                    }
                }
            }
        });

        Ok(handle)
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = Uuid::new_v4().to_string();
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(id),
            method: method.to_string(),
            params,
        };

        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id.clone(), tx);
        }

        let req_json = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";
        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(req_json.as_bytes()).await.map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
        }

        // Wait for response with timeout
        const MCP_REQUEST_TIMEOUT_SECS: u64 = 60;
        match timeout(Duration::from_secs(MCP_REQUEST_TIMEOUT_SECS), rx.recv()).await {
            Ok(Some(res)) => {
                if let Some(err) = res.error {
                    Err(format!("MCP Error: {}", err))
                } else {
                    Ok(res.result.unwrap_or(Value::Null))
                }
            }
            Ok(None) => Err("MCP server closed response channel".into()),
            Err(_) => Err(format!("MCP request timed out after {} seconds", MCP_REQUEST_TIMEOUT_SECS)),
        }
    }
}

use uuid::Uuid;
pub mod client;
pub mod service;
