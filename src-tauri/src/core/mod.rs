use crate::config::{AppConfigState, AppConfig};
use crate::engine::EngineRuntimeState;
use crate::headless::HeadlessProcessState;
use crate::process::ProcessMonitorState;
use crate::pty::PtyManagerState;


pub struct MaestroCore {
    pub config: AppConfigState,
    pub pty_state: PtyManagerState,
    pub engine_runtime: EngineRuntimeState,
    pub process_monitor: ProcessMonitorState,
    pub headless_state: HeadlessProcessState,
}

impl MaestroCore {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config: AppConfigState::new(config),
            pty_state: PtyManagerState::default(),
            engine_runtime: EngineRuntimeState::default(),
            process_monitor: ProcessMonitorState::default(),
            headless_state: HeadlessProcessState::default(),
        }
    }
}
