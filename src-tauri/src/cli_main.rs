use clap::{Parser, Subcommand};
use tauri_app_lib::ipc::{IpcMessage, IpcResponse};
use std::sync::Arc;

#[derive(Parser, Debug)]
#[command(name = "bmad", about = "CLI orchestrator for Maestro Daemon")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// 运行在守护进程模式
    Daemon,
    /// 列出当前的正在运行的引擎
    List,
}

pub async fn run_cli_mode(args: Vec<String>) {
    let cli_args = Cli::parse_from(args);
    match cli_args.command {
        Commands::Daemon => {
            println!("Starting Maestro Daemon...");
            let config = tauri_app_lib::config::load_or_create_config_headless().unwrap();
            let core = Arc::new(tauri_app_lib::core::MaestroCore::new(config));
            
            let handler = Arc::new(move |msg: IpcMessage| {
                let core_clone = Arc::clone(&core);
                Box::pin(async move {
                    if msg.method == "ping" {
                        return IpcResponse {
                            id: msg.id,
                            result: Some(serde_json::Value::String("pong".to_string())),
                            error: None,
                        };
                    } else if msg.method == "list_sessions" {
                        let sessions = core_clone.pty_state.list_sessions();
                        return IpcResponse {
                            id: msg.id,
                            result: Some(serde_json::to_value(&sessions).unwrap_or(serde_json::Value::Null)),
                            error: None,
                        };
                    }
                    IpcResponse {
                        id: msg.id,
                        result: None,
                        error: Some(format!("Unknown method: {}", msg.method)),
                    }
                }) as std::pin::Pin<Box<dyn std::future::Future<Output = IpcResponse> + Send>>
            });

            #[cfg(unix)]
            if let Err(e) = tauri_app_lib::ipc::unix::start_server(handler).await {
                eprintln!("Daemon error: {}", e);
            }
            #[cfg(not(unix))]
            eprintln!("Daemon mode is not currently supported on non-unix systems.");
        }
        Commands::List => {
            // First ensure daemon is running
            if let Err(e) = tauri_app_lib::ipc::ensure_daemon_running().await {
                eprintln!("Failed to connect or spawn daemon: {}", e);
                return;
            }

            #[cfg(unix)]
            {
                let msg = IpcMessage {
                    method: "list_sessions".to_string(),
                    payload: serde_json::Value::Null,
                    id: Some("cli-list".to_string()),
                };
                match tauri_app_lib::ipc::unix::send_request(msg).await {
                    Ok(resp) => {
                        if let Some(err) = resp.error {
                            eprintln!("Daemon returned error: {}", err);
                        } else if let Some(res) = resp.result {
                            // we get the session payload, just print it directly to let CLI parse it
                            println!("{}", serde_json::to_string_pretty(&res).unwrap_or_default());
                        }
                    }
                    Err(e) => eprintln!("Failed to communicate with daemon: {}", e),
                }
            }
        }
    }
}
