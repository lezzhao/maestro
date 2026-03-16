use crate::config::EngineProfile;
use crate::plugin_engine::AgentEngine;

pub struct CursorEngine {}

impl AgentEngine for CursorEngine {
    fn check_status(&self, _profile: &EngineProfile) -> Result<String, String> {
        Ok("mock cursor ok".to_string())
    }

    fn list_models(&self, _profile: &EngineProfile) -> Result<Vec<String>, String> {
        Ok(vec!["gpt-5".to_string(), "claude-sonnet-4".to_string()])
    }

    fn build_session_command(
        &self,
        profile: &EngineProfile,
        _args: &[String],
    ) -> Result<(String, Vec<String>), String> {
        Ok((profile.command(), profile.args()))
    }
}
