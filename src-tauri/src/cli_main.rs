use clap::{Parser, Subcommand};

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
    let _cli = Cli::parse_from(args);
    if let Commands::Daemon = _cli.command {
        println!("Starting daemon...");
        // This is where we will hook up `crate::ipc::unix::start_server` blockingly
        tokio::time::sleep(tokio::time::Duration::from_secs(600)).await;
    } else {
        println!("TODO: implementing daemon proxy...");
    }
}
