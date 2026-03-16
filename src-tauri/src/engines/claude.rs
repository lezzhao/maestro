use crate::config::EngineProfile;
use crate::plugin_engine::AgentEngine;

pub struct ClaudeEngine {}

impl AgentEngine for ClaudeEngine {
    fn check_status(&self, _profile: &EngineProfile) -> Result<String, String> {
        Ok("mock claude ok".to_string())
    }

    fn list_models(&self, _profile: &EngineProfile) -> Result<Vec<String>, String> {
        Ok(vec![
            "claude-3-5-sonnet".to_string(),
            "claude-opus".to_string(),
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
