use crate::api_provider;
use crate::core::events::StringStream;
use crate::workflow::types::{ChatApiMessage, TokenEstimate, VerificationSummary};
use futures::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ApiChatRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<ChatApiMessage>,
}

#[derive(Debug, Clone)]
pub struct CliChatRequest {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct CliChatOutput {
    pub exit_code: Option<i32>,
    pub output_snapshot: String,
    pub verification: Option<VerificationSummary>,
}

pub trait MaestroEngine: Send + Sync {
    fn estimate_tokens(&self, messages: &[ChatApiMessage]) -> TokenEstimate;
    fn run_api_chat<'a>(
        &'a self,
        request: ApiChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
    fn run_cli_chat<'a>(
        &'a self,
        request: CliChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<CliChatOutput, String>> + Send + 'a>>;
}

#[derive(Default)]
pub struct DefaultMaestroEngine;

fn parse_case_counts(output: &str) -> (usize, usize, usize, usize) {
    let passed_re = regex::Regex::new(r"(?i)\b(\d+)\s+passed\b").expect("regex must compile");
    let failed_re = regex::Regex::new(r"(?i)\b(\d+)\s+failed\b").expect("regex must compile");
    let skipped_re =
        regex::Regex::new(r"(?i)\b(\d+)\s+(skipped|todo|pending)\b").expect("regex must compile");
    let total_re = regex::Regex::new(r"(?i)\b(\d+)\s+total\b").expect("regex must compile");
    let passed = passed_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let failed = failed_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let skipped = skipped_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let mut total = total_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    if total == 0 {
        total = passed + failed + skipped;
    }
    (total, passed, failed, skipped)
}

fn detect_framework(output: &str) -> Option<String> {
    let lower = output.to_lowercase();
    if lower.contains("vitest") {
        return Some("vitest".to_string());
    }
    if lower.contains("jest") {
        return Some("jest".to_string());
    }
    if lower.contains("playwright") {
        return Some("playwright".to_string());
    }
    if lower.contains("cypress") {
        return Some("cypress".to_string());
    }
    None
}

fn extract_verification_summary(output: &str) -> Option<VerificationSummary> {
    let framework = detect_framework(output)?;
    let (total_cases, passed_cases, failed_cases, skipped_cases) = parse_case_counts(output);
    let success = failed_cases == 0;
    Some(VerificationSummary {
        has_verification: true,
        test_run: Some(crate::workflow::types::TestRunSummary {
            framework,
            success,
            total_suites: 0,
            passed_suites: 0,
            failed_suites: 0,
            total_cases,
            passed_cases,
            failed_cases,
            skipped_cases,
            duration_ms: None,
            suites: vec![crate::workflow::types::TestSuiteResult {
                name: "chat-exec".to_string(),
                total_cases,
                passed_cases,
                failed_cases,
                skipped_cases,
                duration_ms: None,
                cases: vec![],
            }],
            raw_summary: None,
        }),
        source: Some("chat-exec-parser".to_string()),
        notes: None,
    })
}

async fn forward_output<R>(reader: R, on_data: Arc<dyn StringStream>, aggregate: Arc<Mutex<String>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut stream = reader;
    let mut buffer = vec![0_u8; 4096];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) => break,
            Ok(size) => {
                let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                {
                    let mut text = aggregate.lock().expect("chat aggregate lock poisoned");
                    text.push_str(&chunk);
                    if text.len() > 1_500_000 {
                        let drop_prefix = text.len() - 1_500_000;
                        text.drain(..drop_prefix);
                    }
                }
                if on_data.send_string(chunk).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

impl MaestroEngine for DefaultMaestroEngine {
    fn estimate_tokens(&self, messages: &[ChatApiMessage]) -> TokenEstimate {
        let input_chars: usize = messages.iter().map(|m| m.content.chars().count()).sum();
        let approx_input_tokens = (input_chars + 3) / 4;
        TokenEstimate {
            input_chars,
            output_chars: 0,
            approx_input_tokens,
            approx_output_tokens: 0,
        }
    }

    fn run_api_chat<'a>(
        &'a self,
        request: ApiChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            api_provider::stream_chat(
                &request.provider,
                &request.base_url,
                &request.api_key,
                &request.model,
                &request.messages,
                cancel_token,
                on_data,
            )
            .await
        })
    }

    fn run_cli_chat<'a>(
        &'a self,
        request: CliChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<CliChatOutput, String>> + Send + 'a>> {
        Box::pin(async move {
            let mut command = tokio::process::Command::new(&request.command);
            #[cfg(unix)]
            {
                command.process_group(0);
            }
            command
                .args(&request.args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(cwd) = request.cwd.as_deref().filter(|s| !s.trim().is_empty()) {
                command.current_dir(cwd);
            }
            for (k, v) in &request.env {
                command.env(k, v);
            }

            let mut child = command
                .spawn()
                .map_err(|e| format!("spawn failed: {e}"))?;
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

            let output_snapshot = aggregate
                .lock()
                .expect("chat aggregate lock poisoned")
                .clone();
            let verification = extract_verification_summary(&output_snapshot);

            let exit_code = wait_result.ok().and_then(|s| s.code());
            Ok(CliChatOutput {
                exit_code,
                output_snapshot,
                verification,
            })
        })
    }
}
