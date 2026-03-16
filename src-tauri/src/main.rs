#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli_main;

#[tokio::main]
async fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "cli" {
        args.remove(1);
        cli_main::run_cli_mode(args).await;
        return;
    }

    tauri_app_lib::run()
}
