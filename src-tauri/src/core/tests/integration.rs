use crate::ipc::{IpcMessage, IpcResponse};
use std::sync::Arc;
use tokio::sync::mpsc;
use std::time::Duration;

#[tokio::test]
async fn test_ipc_ping_pong() {
    // 1. Setup a simple handler that replies pong
    let handler = Arc::new(|msg: IpcMessage, tx: mpsc::Sender<IpcResponse>| {
        Box::pin(async move {
            if msg.method == "ping" {
                let _ = tx.send(IpcResponse {
                    id: msg.id,
                    result: Some(serde_json::Value::String("pong".to_string())),
                    error: None,
                    is_stream: false,
                }).await;
            }
        }) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
    });

    // 2. Start server in background (using a dedicated test socket)
    // Note: We'd need to modify ipc.rs slightly to allow custom socket paths for tests,
    // or just rely on the default one if no other daemon is running.
    // For now, let's use the default one but ensure it's cleaned up.
    let socket_path = crate::ipc::get_socket_path();
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let server_handle = tokio::spawn(async move {
        crate::ipc::unix::start_server(handler).await.unwrap();
    });

    // Wait for server to bind
    tokio::time::sleep(Duration::from_millis(100)).await;

    // 3. Send request
    let msg = IpcMessage {
        method: "ping".to_string(),
        payload: serde_json::Value::Null,
        id: Some("test-1".into()),
    };
    
    let resp = crate::ipc::unix::send_request(msg).await.unwrap();
    assert_eq!(resp.result.unwrap(), serde_json::Value::String("pong".to_string()));

    // 4. Cleanup
    server_handle.abort();
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }
}
