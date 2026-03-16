use crate::config::{write_config_to_disk, AppConfig, AppConfigState, EngineConfig, EngineProfile};
use crate::pty::{resolve_exit_payload, wait_exit_status, PtyManagerState};
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::process::Stdio;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, State};
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;

#[derive(Default)]
pub struct EngineRuntimeState {
    pub active_engine_id: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineSwitchResult {
    pub active_engine_id: String,
    pub previous_session_killed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnginePreflightResult {
    pub engine_id: String,
    pub profile_id: String,
    pub command_exists: bool,
    pub auth_ok: bool,
    pub supports_headless: bool,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineModelListResult {
    pub engine_id: String,
    pub profile_id: String,
    pub models: Vec<String>,
    pub source: String,
    pub notes: String,
}

#[derive(Debug, Clone)]
struct StatusCheckResult {
    ok: bool,
    detail: String,
}

#[derive(Debug, Clone)]
struct CaptureResult {
    ok: bool,
    stdout: String,
    stderr: String,
    detail: String,
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

async fn cursor_status_check(profile_cmd: &str) -> StatusCheckResult {
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

async fn run_status_check_shell(command_line: &str, timeout_ms: u64) -> StatusCheckResult {
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

async fn run_capture_shell(command_line: &str, timeout_ms: u64) -> CaptureResult {
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

fn builtin_models(engine_id: &str) -> Vec<String> {
    match engine_id {
        "cursor" => vec![
            "gpt-5".to_string(),
            "gpt-5-mini".to_string(),
            "claude-sonnet-4".to_string(),
        ],
        "claude" => vec![
            "claude-sonnet-4".to_string(),
            "claude-opus-4".to_string(),
            "claude-3-5-haiku".to_string(),
        ],
        "gemini" => vec!["gemini-2.5-pro".to_string(), "gemini-2.5-flash".to_string()],
        "codex" => vec!["gpt-5".to_string(), "gpt-5-mini".to_string()],
        "opencode" => vec!["gpt-5".to_string(), "claude-sonnet-4".to_string()],
        _ => vec![],
    }
}

fn parse_models_from_text(text: &str) -> Vec<String> {
    let token_re =
        Regex::new(r"[A-Za-z0-9][A-Za-z0-9._:/-]{2,}").expect("model token regex is valid");
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for m in token_re.find_iter(text) {
        let token = m
            .as_str()
            .trim_matches(|c| c == '"' || c == '\'' || c == ',' || c == ';');
        if token.is_empty() {
            continue;
        }
        let lower = token.to_ascii_lowercase();
        let looks_like_model = lower.contains("gpt")
            || lower.starts_with("o1")
            || lower.starts_with("o3")
            || lower.starts_with("o4")
            || lower.contains("claude")
            || lower.contains("sonnet")
            || lower.contains("opus")
            || lower.contains("haiku")
            || lower.contains("gemini")
            || lower.contains("flash")
            || lower.contains("deepseek")
            || lower.contains("qwen")
            || lower.contains("llama")
            || lower.contains("mistral")
            || lower.contains("mixtral")
            || lower.contains("kimi")
            || lower.contains("codex");
        if !looks_like_model {
            continue;
        }
        if seen.insert(lower) {
            out.push(token.to_string());
        }
        if out.len() >= 50 {
            break;
        }
    }
    out
}

fn model_list_commands(engine_id: &str, profile_command: &str) -> Vec<String> {
    let cmd = shell_single_quote(profile_command);
    match engine_id {
        "cursor" => vec![
            "cursor-agent models".to_string(),
            format!("{cmd} agent models"),
            format!("{cmd} models"),
        ],
        "claude" => vec![format!("{cmd} models"), format!("{cmd} model list")],
        "gemini" => vec![format!("{cmd} models"), format!("{cmd} model list")],
        "codex" => vec![format!("{cmd} models"), format!("{cmd} model list")],
        "opencode" => vec![format!("{cmd} models"), format!("{cmd} model list")],
        _ => vec![format!("{cmd} models"), format!("{cmd} model list")],
    }
}

#[command]
pub fn engine_list(state: State<'_, AppConfigState>) -> BTreeMap<String, EngineConfig> {
    state.get().engines
}

#[command]
pub fn engine_upsert(
    app: AppHandle,
    id: String,
    engine: EngineConfig,
    state: State<'_, AppConfigState>,
) -> Result<(), String> {
    let mut config = state.get();
    config.engines.insert(id, engine);
    write_config_to_disk(&app, &config)?;
    state.set(config);
    Ok(())
}

#[command]
pub fn engine_set_active_profile(
    app: AppHandle,
    engine_id: String,
    profile_id: String,
    state: State<'_, AppConfigState>,
) -> Result<(), String> {
    let mut config = state.get();
    let engine = config
        .engines
        .get_mut(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    if !engine.profiles.contains_key(&profile_id) {
        return Err(format!("profile not found: {profile_id}"));
    }
    engine.active_profile_id = profile_id;
    write_config_to_disk(&app, &config)?;
    state.set(config);
    Ok(())
}

#[command]
pub fn engine_upsert_profile(
    app: AppHandle,
    engine_id: String,
    profile_id: String,
    profile: EngineProfile,
    state: State<'_, AppConfigState>,
) -> Result<(), String> {
    let mut config = state.get();
    let engine = config
        .engines
        .get_mut(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    engine.profiles.insert(
        profile_id.clone(),
        EngineProfile {
            id: profile_id.clone(),
            ..profile
        },
    );
    if engine.active_profile_id.trim().is_empty() {
        engine.active_profile_id = profile_id;
    }
    write_config_to_disk(&app, &config)?;
    state.set(config);
    Ok(())
}

#[command]
pub fn engine_set_active(
    engine_id: String,
    runtime: State<'_, EngineRuntimeState>,
    config_state: State<'_, AppConfigState>,
) -> Result<(), String> {
    let config = config_state.get();
    if !config.engines.contains_key(&engine_id) {
        return Err(format!("engine not found: {engine_id}"));
    }
    *runtime
        .active_engine_id
        .lock()
        .expect("active_engine lock poisoned") = Some(engine_id);
    Ok(())
}

#[command]
pub fn engine_get_active(runtime: State<'_, EngineRuntimeState>) -> Option<String> {
    runtime
        .active_engine_id
        .lock()
        .expect("active_engine lock poisoned")
        .clone()
}

#[command]
pub async fn engine_preflight(
    engine_id: String,
    config_state: State<'_, AppConfigState>,
) -> Result<EnginePreflightResult, String> {
    let config: AppConfig = config_state.get();
    let engine = config
        .engines
        .get(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    let profile = engine.active_profile();

    let command_exists = which::which(&profile.command()).is_ok();
    if !command_exists {
        return Ok(EnginePreflightResult {
            engine_id,
            profile_id: profile.id.clone(),
            command_exists: false,
            auth_ok: false,
            supports_headless: profile.supports_headless(),
            notes: format!("command not found: {}", profile.command()),
        });
    }

    let auth_check = match engine.id.as_str() {
        "cursor" => cursor_status_check(&profile.command()).await,
        "claude" => {
            run_status_check_shell(
                &format!("{} auth status", shell_single_quote(&profile.command())),
                8000,
            )
            .await
        }
        "opencode" => {
            run_status_check_shell(
                &format!("{} auth", shell_single_quote(&profile.command())),
                8000,
            )
            .await
        }
        "gemini" => {
            let probe = run_status_check_shell(
                &format!(
                    "{} -p {}",
                    shell_single_quote(&profile.command()),
                    shell_single_quote("ping")
                ),
                8000,
            )
            .await;
            if probe.ok {
                probe
            } else {
                let help_probe = run_status_check_shell(
                    &format!("{} --help", shell_single_quote(&profile.command())),
                    5000,
                )
                .await;
                if help_probe.ok {
                    StatusCheckResult {
                        ok: false,
                        detail: format!("prompt probe failed: {}", probe.detail),
                    }
                } else {
                    probe
                }
            }
        }
        "codex" => {
            let probe = run_status_check_shell(
                &format!(
                    "{} exec {}",
                    shell_single_quote(&profile.command()),
                    shell_single_quote("ping")
                ),
                8000,
            )
            .await;
            if probe.ok {
                probe
            } else {
                let help_probe = run_status_check_shell(
                    &format!("{} --help", shell_single_quote(&profile.command())),
                    5000,
                )
                .await;
                if help_probe.ok {
                    StatusCheckResult {
                        ok: false,
                        detail: format!("exec probe failed: {}", probe.detail),
                    }
                } else {
                    probe
                }
            }
        }
        _ => {
            run_status_check_shell(
                &format!("{} --help", shell_single_quote(&profile.command())),
                5000,
            )
            .await
        }
    };
    let auth_ok = auth_check.ok;

    let notes = if auth_ok {
        "ready".to_string()
    } else {
        format!("auth check failed: {}", auth_check.detail)
    };

    Ok(EnginePreflightResult {
        engine_id,
        profile_id: profile.id.clone(),
        command_exists,
        auth_ok,
        supports_headless: profile.supports_headless(),
        notes,
    })
}

#[command]
pub async fn engine_list_models(
    engine_id: String,
    config_state: State<'_, AppConfigState>,
) -> Result<EngineModelListResult, String> {
    let config: AppConfig = config_state.get();
    let engine = config
        .engines
        .get(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    let profile = engine.active_profile();

    let mut models = Vec::new();
    let mut notes = String::new();
    if which::which(&profile.command()).is_ok() {
        for cmd in model_list_commands(&engine.id, &profile.command()) {
            let result = run_capture_shell(&cmd, 10_000).await;
            let parsed = parse_models_from_text(&format!("{}\n{}", result.stdout, result.stderr));
            if !parsed.is_empty() {
                models = parsed;
                notes = if result.ok {
                    "fetched from cli".to_string()
                } else {
                    format!("parsed from cli output ({})", result.detail)
                };
                break;
            }
            if notes.is_empty() {
                notes = result.detail;
            }
        }
    } else {
        notes = format!("command not found: {}", profile.command());
    }

    if models.is_empty() {
        models = builtin_models(&engine.id);
        if !profile.model().trim().is_empty() && !models.iter().any(|m| m == &profile.model()) {
            models.insert(0, profile.model().clone());
        }
        return Ok(EngineModelListResult {
            engine_id,
            profile_id: profile.id,
            models,
            source: "builtin".to_string(),
            notes: if notes.is_empty() {
                "using builtin defaults".to_string()
            } else {
                format!("using builtin defaults: {notes}")
            },
        });
    }

    if !profile.model().trim().is_empty() && !models.iter().any(|m| m == &profile.model()) {
        models.insert(0, profile.model().clone());
    }
    Ok(EngineModelListResult {
        engine_id,
        profile_id: profile.id,
        models,
        source: "cli".to_string(),
        notes,
    })
}

#[command]
pub fn engine_switch_session(
    engine_id: String,
    session_id: Option<u32>,
    runtime: State<'_, EngineRuntimeState>,
    config_state: State<'_, AppConfigState>,
    pty_state: State<'_, PtyManagerState>,
) -> Result<EngineSwitchResult, String> {
    let config: AppConfig = config_state.get();
    let engine = config
        .engines
        .get(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;

    let mut killed = false;
    if let Some(id) = session_id {
        let payload = resolve_exit_payload(&engine.exit_command());
        let _ = pty_state.write_to_session(Some(id.to_string()), &payload);
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(engine.exit_timeout_ms()) {
            if wait_exit_status(&pty_state, &id.to_string()).is_some() {
                let _ = pty_state.kill_session(&id.to_string());
                killed = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if !killed {
            let _ = pty_state.kill_session(&id.to_string());
            killed = true;
        }
    }

    *runtime
        .active_engine_id
        .lock()
        .expect("active_engine lock poisoned") = Some(engine_id.clone());

    Ok(EngineSwitchResult {
        active_engine_id: engine_id,
        previous_session_killed: killed,
    })
}
