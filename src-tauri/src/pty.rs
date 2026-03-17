use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{command, ipc::Channel};

#[derive(Debug, Clone, Serialize)]
pub struct PtySessionInfo {
    pub session_id: String,
    pub os_pid: Option<u32>,
    pub task_id: Option<String>,
}

struct PtySession {
    id: String,
    task_id: Option<String>,
    os_pid: Option<u32>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
}

#[derive(Default)]
pub struct PtyManagerState {
    sessions: RwLock<HashMap<String, Arc<PtySession>>>,
}

impl PtyManagerState {
    fn add_session(&self, session: Arc<PtySession>) {
        let mut sessions = self.sessions.write().expect("sessions write lock poisoned");
        sessions.insert(session.id.clone(), session.clone());
    }

    fn get_session(&self, session_id: &str) -> Result<Arc<PtySession>, String> {
        self.sessions
            .read()
            .expect("sessions read lock poisoned")
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("session not found: {session_id}"))
    }

    fn remove_session(&self, session_id: &str) {
        self.sessions
            .write()
            .expect("sessions write lock poisoned")
            .remove(session_id);
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .keys()
            .cloned()
            .collect();
        for id in ids {
            let _ = self.kill_session(&id);
        }
    }

    pub fn cleanup_dead_sessions(&self) -> usize {
        let mut dead_ids = Vec::new();
        {
            let sessions = self.sessions.read().expect("sessions read lock poisoned");
            for (id, session) in sessions.iter() {
                if let Ok(Some(_)) = session.child.lock().expect("child lock poisoned").try_wait() {
                    dead_ids.push(id.clone());
                }
            }
        }
        let count = dead_ids.len();
        for id in dead_ids {
            self.remove_session(&id);
        }
        count
    }

    pub fn write_to_session(&self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self.get_session(session_id)?;
        session
            .writer
            .lock()
            .expect("writer lock poisoned")
            .write_all(data.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        Ok(())
    }

    pub fn resize_session(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let session = self.get_session(session_id)?;
        session
            .master
            .lock()
            .expect("master lock poisoned")
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))?;
        Ok(())
    }



    pub fn list_sessions(&self) -> Vec<PtySessionInfo> {
        self.sessions
            .read()
            .expect("sessions read lock poisoned")
            .values()
            .map(|s| PtySessionInfo {
                session_id: s.id.clone(),
                os_pid: s.os_pid,
                task_id: s.task_id.clone(),
            })
            .collect()
    }

    pub fn kill_sessions_by_task(&self, task_id: &str) -> usize {
        let ids: Vec<String> = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .values()
            .filter(|session| session.task_id.as_deref() == Some(task_id))
            .map(|session| session.id.clone())
            .collect();
        let mut killed = 0usize;
        for id in ids {
            if self.kill_session(&id).is_ok() {
                killed += 1;
            }
        }
        killed
    }

    pub fn active_os_pid(&self, session_id: &str) -> Option<u32> {
        self.get_session(session_id).ok().and_then(|s| s.os_pid)
    }

    pub fn try_wait_exit_status(&self, session_id: &str) -> Option<i32> {
        let session = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .get(session_id)
            .cloned()?;
        let status = session
            .child
            .lock()
            .expect("child lock poisoned")
            .try_wait()
            .ok()
            .flatten();
        status.map(|s| s.exit_code() as i32)
    }

    pub fn kill_session(&self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("session not found: {session_id}"))?;
        session
            .killer
            .lock()
            .expect("killer lock poisoned")
            .kill()
            .map_err(|e| format!("kill failed: {e}"))?;
        self.remove_session(session_id);
        Ok(())
    }

    pub fn spawn_session(
        &self,
        session_id: String,
        task_id: Option<String>,
        file: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
        on_data: Channel<String>,
    ) -> Result<PtySessionInfo, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(&file);
        cmd.args(&args);
        if let Some(cwd) = cwd {
            cmd.cwd(cwd);
        }
        for (k, v) in env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;
        drop(pair.slave);

        let os_pid = child.process_id();
        let killer = child.clone_killer();

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer failed: {e}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_reader failed: {e}"))?;

        let session_task_id = task_id.clone();
        let session = Arc::new(PtySession {
            id: session_id.clone(),
            task_id,
            os_pid,
            master: Mutex::new(pair.master),
            writer: Arc::new(Mutex::new(writer)),
            child: Mutex::new(child),
            killer: Arc::new(Mutex::new(killer)),
        });
        self.add_session(session.clone());

        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut pending = String::new();
            let mut last_send = Instant::now();

            loop {
                // Non-blocking read (with a small sleep if needed or just use blocking read and batch)
                // Actually, read() is blocking. If it returns fast, we batch.
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let text = String::from_utf8_lossy(&buffer[..size]);
                        pending.push_str(&text);

                        // Batch if either pending buffer is large enough or enough time has passed
                        if pending.len() > 16384 || last_send.elapsed() >= Duration::from_millis(30)
                        {
                            if on_data.send(pending.clone()).is_err() {
                                break;
                            }
                            pending.clear();
                            last_send = Instant::now();
                        }
                    }
                    Err(_) => break,
                }
            }
            if !pending.is_empty() {
                let _ = on_data.send(pending);
            }
        });

        Ok(PtySessionInfo {
            session_id,
            os_pid,
            task_id: session_task_id,
        })
    }
}

#[command]
pub fn pty_spawn(
    session_id: String,
    task_id: Option<String>,
    file: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<PtySessionInfo, String> {
    core_state
        .inner()
        .pty_spawn(session_id, task_id, file, args, cwd, env, cols, rows, on_data)
}

#[command]
pub fn pty_write(
    session_id: String,
    data: String,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    core_state.inner().pty_write(session_id, data)
}

#[command]
pub fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    core_state.inner().pty_resize(session_id, cols, rows)
}

#[command]
pub fn pty_kill(session_id: String, core_state: tauri::State<'_, crate::core::MaestroCore>) -> Result<(), String> {
    core_state.inner().pty_kill(session_id)
}

#[command]
pub fn pty_kill_all(core_state: tauri::State<'_, crate::core::MaestroCore>) {
    core_state.inner().pty_kill_all();
}

#[command]
pub fn pty_cleanup_dead_sessions(core_state: tauri::State<'_, crate::core::MaestroCore>) -> usize {
    core_state.inner().pty_cleanup_dead_sessions()
}

pub fn resolve_exit_payload(exit_command: &str) -> String {
    match exit_command {
        "ctrl-c" => String::from("\u{3}"),
        "ctrl-d" => String::from("\u{4}"),
        text => {
            if text.ends_with('\n') {
                text.to_string()
            } else {
                format!("{text}\n")
            }
        }
    }
}

pub fn active_os_pid(state: &PtyManagerState, session_id: &str) -> Option<u32> {
    state.active_os_pid(session_id)
}

pub fn wait_exit_status(state: &PtyManagerState, session_id: &str) -> Option<i32> {
    state.try_wait_exit_status(session_id)
}
