use super::error;
use super::MaestroCore;
use crate::pty::{PtySessionInfo, PtySpawnOptions};
//

impl MaestroCore {
    pub fn pty_spawn(
        &self,
        options: PtySpawnOptions,
        on_data: Box<dyn Fn(String) + Send + Sync>,
    ) -> Result<PtySessionInfo, error::CoreError> {
        super::pty_spawn_guard::validate_pty_spawn(
            &self.config.get(),
            &options.file,
            &options.args,
        )?;
        self.pty_state
            .spawn_session(options, on_data)
            .map_err(error::CoreError::from)
    }

    pub fn pty_write(&self, session_id: String, data: String) -> Result<(), error::CoreError> {
        self.pty_state
            .write_to_session(&session_id, &data)
            .map_err(error::CoreError::from)
    }

    pub fn pty_resize(
        &self,
        session_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), error::CoreError> {
        self.pty_state
            .resize_session(&session_id, cols, rows)
            .map_err(error::CoreError::from)
    }

    pub fn pty_kill(&self, session_id: String) -> Result<(), error::CoreError> {
        self.pty_state
            .kill_session(&session_id)
            .map_err(error::CoreError::from)
    }

    pub fn pty_kill_all(&self) {
        self.pty_state.kill_all();
    }

    pub fn pty_cleanup_dead_sessions(&self) -> usize {
        self.pty_state.cleanup_dead_sessions()
    }
}
