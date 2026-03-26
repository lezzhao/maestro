use crate::api_provider;
use crate::core::events::StringStream;
use crate::workflow::types::{ChatApiMessage, VerificationSummary};
use futures::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
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

use tokio::io::{AsyncBufReadExt, BufReader};

async fn forward_output<R>(reader: R, on_data: Arc<dyn StringStream>, aggregate: Arc<Mutex<String>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut stream = BufReader::new(reader);
    let mut line_buf = String::new();
    let mut is_json_stream = false;
    let mut json_detected = false;
    let mut in_thinking = false;

    loop {
        line_buf.clear();
        match stream.read_line(&mut line_buf).await {
            Ok(0) => break,
            Ok(_) => {
                let chunk = line_buf.clone();
                if !json_detected {
                    let trimmed = chunk.trim();
                    if trimmed.starts_with("{\"type\":") {
                        is_json_stream = true;
                    }
                    json_detected = true;
                }

                if is_json_stream {
                    let trimmed = chunk.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        let ty = v.pointer("/type").and_then(|t| t.as_str()).unwrap_or("");
                            let text_to_emit = if ty == "thinking" {
                            let subtype = v.pointer("/subtype").and_then(|s| s.as_str()).unwrap_or("");
                            if subtype == "completed" {
                                if in_thinking {
                                    in_thinking = false;
                                    Some("\n</think>\n\n".to_string())
                                } else { None }
                            } else {
                                let t = v.pointer("/text").and_then(|t| t.as_str()).unwrap_or("");
                                if !in_thinking {
                                    in_thinking = true;
                                    Some(format!("<think>\n{t}"))
                                } else {
                                    Some(t.to_string())
                                }
                            }
                        } else if ty == "assistant" {
                            if in_thinking {
                                in_thinking = false;
                                let _ = on_data.send_string("\n</think>\n\n".to_string());
                            }
                            if let Some(arr) = v.pointer("/message/content").and_then(|c| c.as_array()) {
                                if let Some(first) = arr.first() {
                                    first.pointer("/text").and_then(|t| t.as_str()).map(|t| t.to_string())
                                } else {
                                    None
                                }
                            } else if let Some(s) = v.pointer("/message/content").and_then(|c| c.as_str()) {
                                Some(s.to_string())
                            } else {
                                None
                            }
                        } else if ty == "result" {
                            if let Some(usage) = v.pointer("/usage") {
                                if let (Some(input), Some(output)) = (
                                    usage.pointer("/inputTokens").and_then(|t| t.as_u64()),
                                    usage.pointer("/outputTokens").and_then(|t| t.as_u64())
                                ) {
                                    let _ = on_data.send_string(format!(
                                        "\x00TOKEN_USAGE:{{\"approx_input_tokens\":{},\"approx_output_tokens\":{}}}",
                                        input, output
                                    ));
                                }
                            }
                            None
                        } else if ty == "system" || ty == "user" {
                            None
                        } else {
                            // other object, ignore
                            None
                        };

                        if let Some(t) = text_to_emit {
                            {
                                let mut text = aggregate.lock().expect("chat aggregate lock poisoned");
                                text.push_str(&t);
                                if text.len() > 1_500_000 {
                                    let drop_prefix = text.len() - 1_500_000;
                                    text.drain(..drop_prefix);
                                }
                            }
                            let _ = on_data.send_string(t);
                        }
                    } else {
                        // Not valid JSON line despite being in JSON stream mode... perhaps stderr mingled.
                        {
                            let mut text = aggregate.lock().expect("chat aggregate lock poisoned");
                            text.push_str(&chunk);
                        }
                        let _ = on_data.send_string(chunk);
                    }
                } else {
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
            }
            Err(_) => break,
        }
    }
    if is_json_stream && in_thinking {
        let _ = on_data.send_string("\n</think>\n".to_string());
    }
}

impl MaestroEngine for DefaultMaestroEngine {
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
