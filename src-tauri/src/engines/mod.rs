use crate::plugin_engine::AgentEngine;

pub mod claude;
pub mod cursor;
pub mod gemini;

pub fn get_engine(plugin_type: &str) -> Option<Box<dyn AgentEngine>> {
    match plugin_type {
        "cursor" => Some(Box::new(cursor::CursorEngine {})),
        "claude" => Some(Box::new(claude::ClaudeEngine {})),
        "gemini" => Some(Box::new(gemini::GeminiEngine {})),
        // fallback to a generic CLI engine if desired
        _ => None,
    }
}
