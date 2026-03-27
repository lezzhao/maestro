use crate::core::events::StringStream;
use crate::plugin_engine::cli_output_forwarder::forward_output;
use crate::plugin_engine::cli_verification::extract_verification_summary;
use crate::plugin_engine::maestro_engine::{CliChatOutput, CliChatRequest};
use crate::plugin_engine::EngineError;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

pub async fn run_cli_chat(
    request: CliChatRequest,
    cancel_token: CancellationToken,
    on_data: Arc<dyn StringStream>,
) -> Result<CliChatOutput, EngineError> {
    let mut command = tokio::process::Command::new(&request.command);
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    command
        .args(&request.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = request
        .cwd
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        command.current_dir(cwd);
    }
    for (key, value) in &request.env {
        command.env(key, value);
    }

    let mut child = command
        .spawn()
        .map_err(|e| EngineError::Execution(format!("spawn failed: {e}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let aggregate = Arc::new(Mutex::new(String::new()));
    let stdout_aggregate = Arc::clone(&aggregate);
    let stderr_aggregate = Arc::clone(&aggregate);
    let stdout_task =
        stdout.map(|out| tokio::spawn(forward_output(out, on_data.clone(), stdout_aggregate)));
    let stderr_task =
        stderr.map(|err| tokio::spawn(forward_output(err, on_data.clone(), stderr_aggregate)));

    let wait_result: Result<std::process::ExitStatus, std::io::Error> = tokio::select! {
        _ = cancel_token.cancelled() => {
            let _ = child.start_kill();
            child.wait().await
        }
        status = child.wait() => status
    };

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    let output_snapshot = aggregate.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let verification = extract_verification_summary(&output_snapshot);

    Ok(CliChatOutput {
        exit_code: wait_result.ok().and_then(|status| status.code()),
        output_snapshot,
        verification,
    })
}
