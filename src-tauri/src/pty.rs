use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{command, ipc::Channel};

#[derive(Debug, Clone, Serialize)]
pub struct PtySessionInfo {
    pub session_id: u32,
    pub os_pid: Option<u32>,
}

struct PtySession {
    id: u32,
    os_pid: Option<u32>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
}

#[derive(Default)]
pub struct PtyManagerState {
    next_id: AtomicU32,
    sessions: RwLock<HashMap<u32, Arc<PtySession>>>,
    active_session_id: Mutex<Option<u32>>,
}

impl PtyManagerState {
    fn add_session(&self, session: Arc<PtySession>) {
        let mut sessions = self.sessions.write().expect("sessions write lock poisoned");
        sessions.insert(session.id, session.clone());
        *self
            .active_session_id
            .lock()
            .expect("active_session lock poisoned") = Some(session.id);
    }

    fn get_session(&self, session_id: Option<u32>) -> Result<Arc<PtySession>, String> {
        let id = if let Some(id) = session_id {
            id
        } else {
            self.active_session_id
                .lock()
                .expect("active_session lock poisoned")
                .ok_or("no active PTY session")?
        };
        self.sessions
            .read()
            .expect("sessions read lock poisoned")
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("session not found: {id}"))
    }

    fn remove_session(&self, session_id: u32) {
        self.sessions
            .write()
            .expect("sessions write lock poisoned")
            .remove(&session_id);
        let mut active = self
            .active_session_id
            .lock()
            .expect("active_session lock poisoned");
        if *active == Some(session_id) {
            *active = None;
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<u32> = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .keys()
            .copied()
            .collect();
        for id in ids {
            let _ = self.kill_session(id);
        }
    }

    pub fn cleanup_dead_sessions(&self) -> usize {
        let mut dead_ids = Vec::new();
        {
            let sessions = self.sessions.read().expect("sessions read lock poisoned");
            for (id, session) in sessions.iter() {
                if let Ok(Some(_)) = session.child.lock().expect("child lock poisoned").try_wait() {
                    dead_ids.push(*id);
                }
            }
        }
        let count = dead_ids.len();
        for id in dead_ids {
            self.remove_session(id);
        }
        count
    }

    pub fn write_to_session(&self, session_id: Option<u32>, data: &str) -> Result<(), String> {
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
        session_id: Option<u32>,
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

    pub fn active_session(&self) -> Option<PtySessionInfo> {
        let active_id = *self
            .active_session_id
            .lock()
            .expect("active_session lock poisoned");
        active_id.and_then(|id| {
            self.sessions
                .read()
                .expect("sessions read lock poisoned")
                .get(&id)
                .map(|session| PtySessionInfo {
                    session_id: session.id,
                    os_pid: session.os_pid,
                })
        })
    }

    pub fn list_sessions(&self) -> Vec<PtySessionInfo> {
        self.sessions
            .read()
            .expect("sessions read lock poisoned")
            .values()
            .map(|s| PtySessionInfo {
                session_id: s.id,
                os_pid: s.os_pid,
            })
            .collect()
    }

    pub fn active_os_pid(&self, session_id: Option<u32>) -> Option<u32> {
        self.get_session(session_id).ok().and_then(|s| s.os_pid)
    }

    pub fn try_wait_exit_status(&self, session_id: u32) -> Option<i32> {
        let session = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .get(&session_id)
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

    pub fn kill_session(&self, session_id: u32) -> Result<(), String> {
        let session = self
            .sessions
            .read()
            .expect("sessions read lock poisoned")
            .get(&session_id)
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

        let session_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let session = Arc::new(PtySession {
            id: session_id,
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

        Ok(PtySessionInfo { session_id, os_pid })
    }
}

#[command]
pub fn pty_spawn(
    file: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
    state: tauri::State<'_, PtyManagerState>,
) -> Result<PtySessionInfo, String> {
    state.spawn_session(file, args, cwd, env, cols, rows, on_data)
}

#[command]
pub fn pty_write(
    session_id: Option<u32>,
    data: String,
    state: tauri::State<'_, PtyManagerState>,
) -> Result<(), String> {
    state.write_to_session(session_id, &data)
}

#[command]
pub fn pty_resize(
    session_id: Option<u32>,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyManagerState>,
) -> Result<(), String> {
    state.resize_session(session_id, cols, rows)
}

#[command]
pub fn pty_kill(session_id: u32, state: tauri::State<'_, PtyManagerState>) -> Result<(), String> {
    state.kill_session(session_id)
}

#[command]
pub fn pty_kill_all(state: tauri::State<'_, PtyManagerState>) {
    state.kill_all();
}

#[command]
pub fn pty_cleanup_dead_sessions(state: tauri::State<'_, PtyManagerState>) -> usize {
    state.cleanup_dead_sessions()
}

#[command]
pub fn pty_active_session(state: tauri::State<'_, PtyManagerState>) -> Option<PtySessionInfo> {
    state.active_session()
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

pub fn active_os_pid(state: &PtyManagerState, session_id: Option<u32>) -> Option<u32> {
    state.active_os_pid(session_id)
}

pub fn wait_exit_status(state: &PtyManagerState, session_id: u32) -> Option<i32> {
    state.try_wait_exit_status(session_id)
}
