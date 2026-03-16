use crate::config::EngineProfile;

pub mod action_guard;
pub mod maestro_engine;

pub trait AgentEngine: Send + Sync {
    /// Check if the engine is ready and authenticated
    fn check_status(&self, profile: &EngineProfile) -> Result<String, String>;

    /// List available models for this engine
    fn list_models(&self, profile: &EngineProfile) -> Result<Vec<String>, String>;

    /// Build command and args for PTY spawning
    fn build_session_command(
        &self,
        profile: &EngineProfile,
        args: &[String],
    ) -> Result<(String, Vec<String>), String>;
}
