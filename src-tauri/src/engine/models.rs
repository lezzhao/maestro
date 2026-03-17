//! Fetches model lists from engines. Read-only.

use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use crate::config::AppConfig;
use crate::engine::utils::run_capture_shell;

#[derive(Debug, Clone, Serialize)]
pub struct EngineModelListResult {
    pub engine_id: String,
    pub profile_id: String,
    pub models: Vec<String>,
    pub source: String,
    pub notes: String,
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

fn shell_single_quote(input: &str) -> String {
    let escaped = input.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
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

pub async fn engine_list_models_core(
    engine_id: String,
    config: AppConfig,
) -> Result<EngineModelListResult, String> {
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
