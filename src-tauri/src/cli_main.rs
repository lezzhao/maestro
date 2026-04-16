use clap::{Parser, Subcommand};
use std::sync::Arc;
use std::io::Seek; // Added for logs --tail
use tauri_app_lib::core::events::{MpscEventStream, MpscStringStream};
use tauri_app_lib::ipc::{IpcMessage, IpcResponse};
use tauri_app_lib::workflow::types::{
    ChatApiRequest, ChatExecuteCliRequest, StepRunRequest, WorkflowRunRequest,
};

#[derive(Parser, Debug)]
#[command(name = "maestro", about = "CLI orchestrator for Maestro Daemon")]
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
    /// 检查守护进程状态
    Status,
    /// 停止运行中的守护进程
    Stop,
    /// 查看守护进程日志
    Logs {
        /// 持续追踪日志输出
        #[arg(long)]
        tail: bool,
    },
}

pub async fn run_cli_mode(args: Vec<String>) {
    use tauri_app_lib::telemetry;
    telemetry::init_telemetry(telemetry::get_default_log_dir(), "info");
    
    let cli_args = Cli::parse_from(args);
    match cli_args.command {
        Commands::Daemon => {
            println!("Starting Maestro Daemon...");
            let (config, db_path) = tauri_app_lib::config::load_or_create_config_headless().unwrap();
            let core = Arc::new(tauri_app_lib::core::MaestroCore::new(config, db_path));
            
            // Start safety reaper
            core.safety_manager.clone().start_reaper();

            let handler = Arc::new(
                move |msg: IpcMessage, tx: tokio::sync::mpsc::Sender<IpcResponse>| {
                    let core_clone = Arc::clone(&core);
                    Box::pin(async move {
                        macro_rules! handle_request {
                            ($req_type:ty, $core_method:ident, $msg:expr, $tx:expr, $stream_type:ident) => {{
                                if let Ok(req) = serde_json::from_value::<$req_type>($msg.payload) {
                                    let stream = Arc::new($stream_type {
                                        tx: $tx.clone(),
                                        msg_id: $msg.id.clone(),
                                    });
                                    let event_handle = Arc::clone(&core_clone.event_registry);
                                    let result = core_clone.$core_method(event_handle as _, req, stream).await;
                                    let response = match result {
                                        Ok(r) => IpcResponse::success($msg.id.clone(), serde_json::to_value(&r).unwrap_or_default()),
                                        Err(e) => {
                                            let err_val = serde_json::to_value(&e).unwrap_or_else(|_| serde_json::Value::String(e.to_string()));
                                            IpcResponse::error($msg.id.clone(), err_val.to_string())
                                        }
                                    };
                                    let _ = $tx.send(response).await;
                                } else {
                                    let _ = $tx.send(IpcResponse::error($msg.id.clone(), format!("Invalid payload for {}", $msg.method))).await;
                                }
                            }};
                            // For workflow which doesn't follow the exact same arguments format:
                            (@workflow $req_type:ty, $core_method:ident, $msg:expr, $tx:expr, $stream_type:ident) => {{
                                if let Ok(req) = serde_json::from_value::<$req_type>($msg.payload) {
                                    let stream = Arc::new($stream_type {
                                        tx: $tx.clone(),
                                        msg_id: $msg.id.clone(),
                                    });
                                    let event_handle = Arc::clone(&core_clone.event_registry);
                                    let result = core_clone.$core_method(event_handle as _, stream, req).await;
                                    let response = match result {
                                        Ok(r) => IpcResponse::success($msg.id.clone(), serde_json::to_value(&r).unwrap_or_default()),
                                        Err(e) => {
                                            let err_val = serde_json::to_value(&e).unwrap_or_else(|_| serde_json::Value::String(e.to_string()));
                                            IpcResponse::error($msg.id.clone(), err_val.to_string())
                                        }
                                    };
                                    let _ = $tx.send(response).await;
                                } else {
                                    let _ = $tx.send(IpcResponse::error($msg.id.clone(), format!("Invalid payload for {}", $msg.method))).await;
                                }
                            }};
                        }

                        match msg.method.as_str() {
                            "ping" | "status" => {
                                let running_tasks = core_clone.config.get().max_concurrent_tasks.saturating_sub(core_clone.run_queue.available_permits());
                                let queued_tasks = core_clone.run_queue.waiting_tasks();
                                let res = serde_json::json!({
                                    "status": "online",
                                    "version": env!("CARGO_PKG_VERSION"),
                                    "uptime_secs": core_clone.uptime().as_secs(),
                                    "active_sessions": core_clone.pty_state.list_sessions().len(),
                                    "active_tasks": running_tasks,
                                    "queued_tasks": queued_tasks,
                                    "max_concurrent": core_clone.config.get().max_concurrent_tasks,
                                });
                                let _ = tx.send(IpcResponse::success(msg.id, res)).await;
                            }
                            "stop" | "shutdown" => {
                                let _ = tx.send(IpcResponse::success(msg.id, serde_json::Value::String("stopping".into()))).await;
                                tokio::spawn(async {
                                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                                    std::process::exit(0);
                                });
                            }
                            "list_sessions" => {
                                let res = serde_json::to_value(&core_clone.pty_state.list_sessions()).unwrap_or(serde_json::Value::Null);
                                let _ = tx.send(IpcResponse::success(msg.id, res)).await;
                            }
                            "workflow_run" => handle_request!(@workflow WorkflowRunRequest, workflow_run, msg, tx, MpscEventStream),
                            "workflow_run_step" => handle_request!(@workflow StepRunRequest, workflow_run_step, msg, tx, MpscEventStream),
                            "chat_execute_api" => handle_request!(ChatApiRequest, chat_execute_api, msg, tx, MpscStringStream),
                            "chat_execute_cli" => handle_request!(ChatExecuteCliRequest, chat_execute_cli, msg, tx, MpscStringStream),
                            _ => {
                                let _ = tx.send(IpcResponse::error(msg.id, format!("Unknown method: {}", msg.method))).await;
                            }
                        }
                    }) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
                },
            );

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
        Commands::Status => {
            if let Err(_) = tauri_app_lib::ipc::ensure_daemon_running().await {
                eprintln!("Daemon is offline.");
                return;
            }
            #[cfg(unix)]
            {
                let msg = IpcMessage {
                    method: "status".to_string(),
                    payload: serde_json::Value::Null,
                    id: Some("cli-status".into()),
                };
                match tauri_app_lib::ipc::unix::send_request(msg).await {
                    Ok(resp) => {
                        if let Some(res) = resp.result {
                            println!("Maestro Daemon Status:");
                            println!("  Status:           {}", res["status"].as_str().unwrap_or("unknown"));
                            println!("  Version:          {}", res["version"].as_str().unwrap_or("unknown"));
                            println!("  Uptime:           {}s", res["uptime_secs"].as_u64().unwrap_or(0));
                            println!("  Active Sessions:  {}", res["active_sessions"].as_u64().unwrap_or(0));
                            println!("  Queued Tasks:     {}", res["queued_tasks"].as_u64().unwrap_or(0));
                            println!("  Max Concurrency:  {}", res["max_concurrent"].as_u64().unwrap_or(0));
                        }
                    }
                    Err(_) => println!("Status: offline"),
                }
            }
        }
        Commands::Stop => {
            #[cfg(unix)]
            {
                let msg = IpcMessage {
                    method: "stop".to_string(),
                    payload: serde_json::Value::Null,
                    id: Some("cli-stop".into()),
                };
                match tauri_app_lib::ipc::unix::send_request(msg).await {
                    Ok(_) => println!("Daemon stop signal sent."),
                    Err(_) => println!("Daemon was not running."),
                }
            }
        }
        Commands::Logs { tail } => {
            let log_dir = tauri_app_lib::telemetry::get_default_log_dir();
            let log_file = log_dir.join("maestro.log");
            if !log_file.exists() {
                eprintln!("Log file not found at {}", log_file.display());
                return;
            }

            if tail {
                use std::io::{BufRead, BufReader};
                let file = std::fs::File::open(&log_file).unwrap();
                let mut reader = BufReader::new(file);
                // Seek to end
                let _ = reader.get_mut().seek(std::io::SeekFrom::End(0));

                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        }
                        Ok(_) => {
                            print!("{}", line);
                        }
                        Err(e) => {
                            eprintln!("Error reading log: {}", e);
                            break;
                        }
                    }
                }
            } else {
                let content = std::fs::read_to_string(&log_file).unwrap_or_default();
                println!("{}", content);
            }
        }
    }
}
