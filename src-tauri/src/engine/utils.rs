use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;

#[derive(Debug, Clone)]
pub struct StatusCheckResult {
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct CaptureResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub detail: String,
}

fn compact_output(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim().replace('\n', " ").replace('\r', " ");
    if trimmed.chars().count() <= max_chars {
        return trimmed;
    }
    let mut out: String = trimmed.chars().take(max_chars).collect();
    out.push_str("...(truncated)");
    out
}

fn shell_single_quote(input: &str) -> String {
    let escaped = input.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

pub async fn cursor_status_check(profile_cmd: &str) -> StatusCheckResult {
    if which::which("cursor-agent").is_ok() {
        let result = run_status_check_shell("cursor-agent status", 6000).await;
        if result.ok {
            return result;
        }
    }
    run_status_check_shell(
        &format!("{} agent status", shell_single_quote(profile_cmd)),
        8000,
    )
    .await
}

pub async fn run_status_check_shell(command_line: &str, timeout_ms: u64) -> StatusCheckResult {
    let mut parts = shlex::split(command_line).unwrap_or_default();
    if parts.is_empty() {
        return StatusCheckResult {
            ok: false,
            detail: "empty command line".to_string(),
        };
    }
    let cmd = parts.remove(0);
    let args: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
    run_status_check(&cmd, &args, timeout_ms).await
}

pub async fn run_capture_shell(command_line: &str, timeout_ms: u64) -> CaptureResult {
    let mut parts = shlex::split(command_line).unwrap_or_default();
    if parts.is_empty() {
        return CaptureResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            detail: "empty command line".to_string(),
        };
    }
    let cmd = parts.remove(0);
    let args: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
    run_capture(&cmd, &args, timeout_ms).await
}

async fn run_status_check(cmd: &str, args: &[&str], timeout_ms: u64) -> StatusCheckResult {
    let mut child = match TokioCommand::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return StatusCheckResult {
                ok: false,
                detail: format!("spawn failed: {e}"),
            }
        }
    };
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(500));
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.start_kill();
                    break None;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => {
                return StatusCheckResult {
                    ok: false,
                    detail: format!("try_wait failed: {e}"),
                }
            }
        }
    };

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_end(&mut stdout_buf).await;
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_end(&mut stderr_buf).await;
    }
    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
    let stderr = String::from_utf8_lossy(&stderr_buf).to_string();

    if timed_out {
        let hint = if !stderr.trim().is_empty() {
            compact_output(&stderr, 180)
        } else {
            compact_output(&stdout, 180)
        };
        return StatusCheckResult {
            ok: false,
            detail: if hint.is_empty() {
                format!("timeout after {timeout_ms}ms")
            } else {
                format!("timeout after {timeout_ms}ms: {hint}")
            },
        };
    }

    if let Some(exit) = status {
        if exit.success() {
            return StatusCheckResult {
                ok: true,
                detail: "ready".to_string(),
            };
        }
        let code = exit
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        let hint = if !stderr.trim().is_empty() {
            compact_output(&stderr, 180)
        } else {
            compact_output(&stdout, 180)
        };
        return StatusCheckResult {
            ok: false,
            detail: if hint.is_empty() {
                format!("exit code {code}")
            } else {
                format!("exit code {code}: {hint}")
            },
        };
    }

    StatusCheckResult {
        ok: false,
        detail: "unknown status check failure".to_string(),
    }
}

async fn run_capture(cmd: &str, args: &[&str], timeout_ms: u64) -> CaptureResult {
    let mut child = match TokioCommand::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return CaptureResult {
                ok: false,
                stdout: String::new(),
                stderr: String::new(),
                detail: format!("spawn failed: {e}"),
            }
        }
    };
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(800));
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.start_kill();
                    break None;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => {
                return CaptureResult {
                    ok: false,
                    stdout: String::new(),
                    stderr: String::new(),
                    detail: format!("try_wait failed: {e}"),
                }
            }
        }
    };
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_end(&mut stdout_buf).await;
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_end(&mut stderr_buf).await;
    }
    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
    let stderr = String::from_utf8_lossy(&stderr_buf).to_string();
    if timed_out {
        return CaptureResult {
            ok: false,
            stdout,
            stderr,
            detail: format!("timeout after {timeout_ms}ms"),
        };
    }
    let ok = status.map(|s| s.success()).unwrap_or(false);
    let detail = if ok {
        "ok".to_string()
    } else {
        status
            .and_then(|s| s.code())
            .map(|code| format!("exit code {code}"))
            .unwrap_or_else(|| "unknown failure".to_string())
    };
    CaptureResult {
        ok,
        stdout,
        stderr,
        detail,
    }
}
