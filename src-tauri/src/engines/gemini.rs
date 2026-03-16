use crate::config::EngineProfile;
use crate::plugin_engine::AgentEngine;

pub struct GeminiEngine {}

impl AgentEngine for GeminiEngine {
    fn check_status(&self, _profile: &EngineProfile) -> Result<String, String> {
        Ok("mock gemini ok".to_string())
    }

    fn list_models(&self, _profile: &EngineProfile) -> Result<Vec<String>, String> {
        Ok(vec![
            "gemini-2.5-pro".to_string(),
            "gemini-2.5-flash".to_string(),
        ])
    }

    fn build_session_command(
        &self,
        profile: &EngineProfile,
        _args: &[String],
    ) -> Result<(String, Vec<String>), String> {
        Ok((profile.command(), profile.args()))
    }
}
