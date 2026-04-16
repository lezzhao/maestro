use regex::Regex;

use super::types::TokenEstimate;

pub(crate) fn sanitize_file_stem(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    if out.is_empty() {
        "workflow".to_string()
    } else {
        out
    }
}

pub(crate) fn summarize_output(text: &str, max_chars: usize) -> String {
    let trimmed = strip_ansi_escapes::strip_str(text);
    if trimmed.chars().count() <= max_chars {
        return trimmed;
    }
    let mut out = String::new();
    for ch in trimmed.chars().take(max_chars) {
        out.push(ch);
    }
    out.push_str("...(truncated)");
    out
}

pub(crate) fn completion_matched(signal: Option<&str>, output: &str) -> bool {
    let Some(sig) = signal.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    let normalized = strip_ansi_escapes::strip_str(output);
    if let Ok(re) = Regex::new(sig) {
        re.is_match(&normalized)
    } else {
        normalized.contains(sig)
    }
}

fn has_model_flag(args: &[String]) -> bool {
    args.iter().any(|arg| {
        let trimmed = arg.trim();
        trimmed == "--model"
            || trimmed == "-m"
            || trimmed.starts_with("--model=")
            || trimmed.starts_with("-m=")
    })
}

fn model_flag_for_engine(engine_id: &str) -> &'static str {
    match engine_id {
        "claude" => "--model",
        "cursor" => "--model",
        "gemini" => "--model",
        "codex" => "--model",
        "opencode" => "--model",
        _ => "--model",
    }
}

pub(crate) fn with_model_args(mut args: Vec<String>, engine_id: &str, model: &str) -> Vec<String> {
    let model = model.trim();
    if model.is_empty() || has_model_flag(&args) {
        return args;
    }
    args.push(model_flag_for_engine(engine_id).to_string());
    args.push(model.to_string());
    args
}

use tiktoken_rs::cl100k_base;
use std::sync::OnceLock;

static TOKENIZER: OnceLock<tiktoken_rs::CoreBPE> = OnceLock::new();

pub(crate) fn estimate_token_count(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let bpe = TOKENIZER.get_or_init(|| cl100k_base().unwrap());
    bpe.encode_with_special_tokens(text).len()
}

pub(crate) fn estimate_tokens(prompt: &str, output: &str) -> TokenEstimate {
    let input_chars = prompt.chars().count();
    let output_chars = output.chars().count();
    TokenEstimate {
        input_chars,
        output_chars,
        approx_input_tokens: estimate_token_count(prompt),
        approx_output_tokens: estimate_token_count(output),
    }
}
