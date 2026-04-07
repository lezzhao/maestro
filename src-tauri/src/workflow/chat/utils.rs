use crate::core::error::CoreError;
use std::path::PathBuf;

pub async fn last_conversation_path_core() -> Result<PathBuf, CoreError> {
    let home = dirs::home_dir().ok_or_else(|| CoreError::Io {
        message: "Could not find home directory".to_string(),
    })?;
    let dir = home.join(".maestro");
    if !dir.exists() {
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| CoreError::Io {
                message: format!("create .maestro dir failed: {e}"),
            })?;
    }
    Ok(dir.join("last-conversation.json"))
}

pub fn engine_supports_continue(engine_id: &str) -> bool {
    matches!(engine_id, "opencode" | "claude" | "gemini" | "codex")
}

pub fn builtin_headless_defaults(engine_id: &str) -> Option<Vec<String>> {
    match engine_id {
        "cursor" => Some(vec![
            "agent".to_string(),
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--stream-partial-output".to_string(),
        ]),
        "claude" => Some(vec!["-p".to_string()]),
        "gemini" => Some(vec!["-p".to_string()]),
        "opencode" => Some(vec!["run".to_string()]),
        "codex" => Some(vec!["exec".to_string()]),
        _ => None,
    }
}
