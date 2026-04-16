use std::path::PathBuf;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use once_cell::sync::OnceCell;

static LOG_GUARD: OnceCell<tracing_appender::non_blocking::WorkerGuard> = OnceCell::new();

pub fn init_telemetry(log_dir: PathBuf, env_filter: &str) {
    // 1. Ensure log directory exists
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("Warning: Failed to create log directory {}: {}", log_dir.display(), e);
    }

    // 2. Setup File Appender (maestro.log with daily rotation)
    let file_appender = RollingFileAppender::new(Rotation::DAILY, &log_dir, "maestro.log");
    let (non_blocking_file, _guard) = tracing_appender::non_blocking(file_appender);

    // 3. Setup EnvFilter
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(env_filter));

    // 4. Build Layers
    let stdout_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(true);

    let file_layer = fmt::layer()
        .with_writer(non_blocking_file)
        .with_ansi(false) // No ANSI colors in file
        .with_target(true);

    // 5. Initialize Registry
    // Note: We store the guard in a global OnceCell so it stays alive 
    // for the duration of the program, instead of leaking it.
    let _ = LOG_GUARD.set(_guard);

    tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();
}

pub fn get_default_log_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
        .join(".maestro")
        .join("logs")
}
