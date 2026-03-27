use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::sleep;

pub async fn ensure_daemon_running() -> Result<(), String> {
    if ping_daemon().await {
        return Ok(());
    }

    // Spawn detached daemon
    let exe = std::env::current_exe().map_err(|e| format!("failed to get current exe: {}", e))?;
    std::process::Command::new(exe)
        .arg("cli")
        .arg("daemon")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn daemon: {}", e))?;

    // Wait until it responds to ping
    for _ in 0..30 {
        sleep(Duration::from_millis(100)).await;
        if ping_daemon().await {
            return Ok(());
        }
    }

    Err("Daemon did not start in time".to_string())
}

async fn ping_daemon() -> bool {
    #[cfg(unix)]
    {
        let msg = IpcMessage {
            method: "ping".to_string(),
            payload: serde_json::Value::Null,
            id: None,
        };
        unix::send_request(msg).await.is_ok()
    }
    #[cfg(not(unix))]
    {
        // For non-unix, assume true or implement windows named pipes
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMessage {
    pub method: String,
    pub payload: serde_json::Value,
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: Option<String>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    #[serde(default)]
    pub is_stream: bool,
}

pub fn get_socket_path() -> PathBuf {
    std::env::temp_dir().join("maestro-daemon.sock")
}

#[cfg(unix)]
pub mod unix {
    use super::*;
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{UnixListener, UnixStream};

    // NOTE: This signature expects a handler that takes a message and a channel to send responses.
    pub async fn start_server<F, Fut>(handler: Arc<F>) -> Result<(), String>
    where
        F: Fn(IpcMessage, tokio::sync::mpsc::Sender<IpcResponse>) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let socket_path = get_socket_path();
        if socket_path.exists() {
            let _ = std::fs::remove_file(&socket_path);
        }

        let listener =
            UnixListener::bind(&socket_path).map_err(|e| format!("failed to bind UDS: {}", e))?;

        loop {
            match listener.accept().await {
                Ok((mut stream, _addr)) => {
                    let h = Arc::clone(&handler);
                    tokio::spawn(async move {
                        let (reader, mut writer) = stream.split();
                        let mut lines = BufReader::new(reader).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Ok(msg) = serde_json::from_str::<IpcMessage>(&line) {
                                let (tx, mut rx) = tokio::sync::mpsc::channel(100);
                                let run_handle = tokio::spawn({
                                    let h_clone = Arc::clone(&h);
                                    let msg_clone = msg.clone();
                                    async move {
                                        h_clone(msg_clone, tx).await;
                                    }
                                });

                                while let Some(resp) = rx.recv().await {
                                    if let Ok(resp_json) = serde_json::to_string(&resp) {
                                        let _ = writer
                                            .write_all(format!("{}\n", resp_json).as_bytes())
                                            .await;
                                    }
                                    if !resp.is_stream {
                                        break; // End of this request
                                    }
                                }
                                let _ = run_handle.await;
                            }
                        }
                    });
                }
                Err(e) => {
                    eprintln!("UDS accept error: {}", e);
                }
            }
        }
    }

    pub async fn send_request(msg: IpcMessage) -> Result<IpcResponse, String> {
        let socket_path = get_socket_path();
        let mut stream = UnixStream::connect(socket_path)
            .await
            .map_err(|e| format!("failed to connect to daemon: {}", e))?;

        let payload = serde_json::to_string(&msg)
            .map_err(|e| format!("serialize IPC message failed: {e}"))?
            + "\n";
        stream
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("write to daemon socket failed: {e}"))?;

        let mut reader = BufReader::new(stream);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Ok(0) => return Err("Unexpected EOF from daemon".to_string()),
                Ok(_) => {
                    let resp: IpcResponse = serde_json::from_str(&line)
                        .map_err(|e| format!("parse response failed: {}", e))?;
                    if !resp.is_stream {
                        return Ok(resp);
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    pub async fn send_request_stream<F>(
        msg: IpcMessage,
        mut on_chunk: F,
    ) -> Result<IpcResponse, String>
    where
        F: FnMut(IpcResponse),
    {
        let socket_path = get_socket_path();
        let mut stream = UnixStream::connect(socket_path)
            .await
            .map_err(|e| format!("failed to connect to daemon: {}", e))?;

        let payload = serde_json::to_string(&msg)
            .map_err(|e| format!("serialize IPC message failed: {e}"))?
            + "\n";
        stream
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("write to daemon socket failed: {e}"))?;

        let mut reader = BufReader::new(stream);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Ok(0) => return Err("Unexpected EOF from daemon stream".to_string()),
                Ok(_) => {
                    let resp: IpcResponse = serde_json::from_str(&line)
                        .map_err(|e| format!("parse response failed: {}", e))?;
                    if !resp.is_stream {
                        return Ok(resp);
                    } else {
                        on_chunk(resp);
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }
}
