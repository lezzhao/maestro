use clap::{Parser, Subcommand};
use tauri_app_lib::ipc::{IpcMessage, IpcResponse};
use std::sync::Arc;
use tauri_app_lib::workflow::types::{ChatApiRequest, ChatExecuteCliRequest, StepRunRequest, WorkflowRunRequest};
use tauri_app_lib::workflow::chat::{chat_execute_api_core, chat_execute_cli_core};
use tauri_app_lib::workflow::run::{workflow_run_core, workflow_run_step_core};
use tauri_app_lib::core::events::{MpscEventStream, MpscStringStream};

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
            
            let handler = Arc::new(move |msg: IpcMessage, tx: tokio::sync::mpsc::Sender<IpcResponse>| {
                let core_clone = Arc::clone(&core);
                Box::pin(async move {
                    if msg.method == "ping" {
                        let _ = tx.send(IpcResponse {
                            id: msg.id,
                            result: Some(serde_json::Value::String("pong".to_string())),
                            error: None,
                            is_stream: false,
                        }).await;
                        return;
                    } else if msg.method == "list_sessions" {
                        let sessions = core_clone.pty_state.list_sessions();
                        let _ = tx.send(IpcResponse {
                            id: msg.id,
                            result: Some(serde_json::to_value(&sessions).unwrap_or(serde_json::Value::Null)),
                            error: None,
                            is_stream: false,
                        }).await;
                        return;
                    } else if msg.method == "workflow_run" {
                        if let Ok(req) = serde_json::from_value::<WorkflowRunRequest>(msg.payload) {
                            let stream = Arc::new(MpscEventStream { tx: tx.clone(), msg_id: msg.id.clone() });
                            let result = workflow_run_core(
                                stream,
                                req,
                                &core_clone.engine_runtime,
                                &core_clone.config.get(),
                                &core_clone.pty_state,
                            ).await;
                            
                            match result {
                                Ok(res) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: Some(serde_json::to_value(&res).unwrap_or_default()),
                                        error: None,
                                        is_stream: false,
                                    }).await;
                                }
                                Err(err) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: None,
                                        error: Some(err),
                                        is_stream: false,
                                    }).await;
                                }
                            }
                        } else {
                            let _ = tx.send(IpcResponse {
                                id: msg.id,
                                result: None,
                                error: Some("Invalid payload for workflow_run".to_string()),
                                is_stream: false,
                            }).await;
                        }
                        return;
                    } else if msg.method == "workflow_run_step" {
                        if let Ok(req) = serde_json::from_value::<StepRunRequest>(msg.payload) {
                            let stream = Arc::new(MpscEventStream { tx: tx.clone(), msg_id: msg.id.clone() });
                            let result = workflow_run_step_core(
                                stream,
                                req,
                                &core_clone.engine_runtime,
                                &core_clone.config.get(),
                                &core_clone.pty_state,
                            ).await;
                            
                            match result {
                                Ok(res) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: Some(serde_json::to_value(&res).unwrap_or_default()),
                                        error: None,
                                        is_stream: false,
                                    }).await;
                                }
                                Err(err) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: None,
                                        error: Some(err),
                                        is_stream: false,
                                    }).await;
                                }
                            }
                        } else {
                            let _ = tx.send(IpcResponse {
                                id: msg.id,
                                result: None,
                                error: Some("Invalid payload for workflow_run_step".to_string()),
                                is_stream: false,
                            }).await;
                        }
                        return;
                    } else if msg.method == "chat_execute_api" {
                        if let Ok(req) = serde_json::from_value::<ChatApiRequest>(msg.payload) {
                            let stream = Arc::new(MpscStringStream { tx: tx.clone(), msg_id: msg.id.clone() });
                            let result = chat_execute_api_core(
                                req,
                                core_clone.config.get(),
                                &core_clone.headless_state,
                                stream,
                            ).await;
                            match result {
                                Ok(res) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: Some(serde_json::to_value(&res).unwrap_or_default()),
                                        error: None,
                                        is_stream: false,
                                    }).await;
                                }
                                Err(err) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: None,
                                        error: Some(err),
                                        is_stream: false,
                                    }).await;
                                }
                            }
                        } else {
                            let _ = tx.send(IpcResponse {
                                id: msg.id,
                                result: None,
                                error: Some("Invalid payload for chat_execute_api".to_string()),
                                is_stream: false,
                            }).await;
                        }
                        return;
                    } else if msg.method == "chat_execute_cli" {
                        if let Ok(req) = serde_json::from_value::<ChatExecuteCliRequest>(msg.payload) {
                            let stream = Arc::new(MpscStringStream { tx: tx.clone(), msg_id: msg.id.clone() });
                            let result = chat_execute_cli_core(
                                req,
                                core_clone.config.get(),
                                &core_clone.headless_state,
                                stream,
                            ).await;
                            match result {
                                Ok(res) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: Some(serde_json::to_value(&res).unwrap_or_default()),
                                        error: None,
                                        is_stream: false,
                                    }).await;
                                }
                                Err(err) => {
                                    let _ = tx.send(IpcResponse {
                                        id: msg.id,
                                        result: None,
                                        error: Some(err),
                                        is_stream: false,
                                    }).await;
                                }
                            }
                        } else {
                            let _ = tx.send(IpcResponse {
                                id: msg.id,
                                result: None,
                                error: Some("Invalid payload for chat_execute_cli".to_string()),
                                is_stream: false,
                            }).await;
                        }
                        return;
                    }
                    let _ = tx.send(IpcResponse {
                        id: msg.id,
                        result: None,
                        error: Some(format!("Unknown method: {}", msg.method)),
                        is_stream: false,
                    }).await;
                }) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
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
