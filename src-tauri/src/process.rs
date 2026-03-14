use crate::pty::{active_os_pid, PtyManagerState};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tauri::{command, AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct ProcessStats {
    pub session_id: Option<u32>,
    pub os_pid: Option<u32>,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub running: bool,
}

#[derive(Default)]
pub struct ProcessMonitorState {
    running: AtomicBool,
    latest: RwLock<HashMap<Option<u32>, ProcessStats>>,
    stopper: Mutex<Option<Arc<AtomicBool>>>,
}

impl ProcessMonitorState {
    pub fn stop_all(&self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(flag) = self.stopper.lock().expect("stopper lock poisoned").take() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[command]
pub fn process_get_stats(
    session_id: Option<u32>,
    pty_state: tauri::State<'_, PtyManagerState>,
) -> ProcessStats {
    let os_pid = active_os_pid(&pty_state, session_id);
    if let Some(pid_u32) = os_pid {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_cpu().with_memory()),
        );
        let pid = Pid::from_u32(pid_u32);
        sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        if let Some(process) = sys.process(pid) {
            return ProcessStats {
                session_id,
                os_pid,
                cpu_percent: process.cpu_usage(),
                memory_mb: process.memory() / 1024 / 1024,
                running: true,
            };
        }
    }
    ProcessStats {
        session_id,
        os_pid,
        cpu_percent: 0.0,
        memory_mb: 0,
        running: false,
    }
}

#[command]
pub fn process_start_monitor(
    app: AppHandle,
    session_id: Option<u32>,
    interval_ms: Option<u64>,
    monitor_state: tauri::State<'_, ProcessMonitorState>,
) -> Result<(), String> {
    let interval = interval_ms.unwrap_or(2000).max(500);
    monitor_state.stop_all();
    monitor_state.running.store(true, Ordering::Relaxed);
    let stop_flag = Arc::new(AtomicBool::new(false));
    *monitor_state
        .stopper
        .lock()
        .expect("stopper lock poisoned") = Some(stop_flag.clone());

    let app_handle = app.clone();
    thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            let stats = {
                let pty = app_handle.state::<PtyManagerState>();
                let os_pid = active_os_pid(&pty, session_id);
                if let Some(pid_u32) = os_pid {
                    let mut sys = System::new_with_specifics(
                        RefreshKind::nothing().with_processes(
                            ProcessRefreshKind::nothing().with_cpu().with_memory(),
                        ),
                    );
                    let pid = Pid::from_u32(pid_u32);
                    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
                    if let Some(process) = sys.process(pid) {
                        ProcessStats {
                            session_id,
                            os_pid,
                            cpu_percent: process.cpu_usage(),
                            memory_mb: process.memory() / 1024 / 1024,
                            running: true,
                        }
                    } else {
                        ProcessStats {
                            session_id,
                            os_pid,
                            cpu_percent: 0.0,
                            memory_mb: 0,
                            running: false,
                        }
                    }
                } else {
                    ProcessStats {
                        session_id,
                        os_pid: None,
                        cpu_percent: 0.0,
                        memory_mb: 0,
                        running: false,
                    }
                }
            };

            app_handle
                .state::<ProcessMonitorState>()
                .latest
                .write()
                .expect("latest write lock poisoned")
                .insert(session_id, stats.clone());
            let _ = app_handle.emit("perf://stats", stats);
            thread::sleep(Duration::from_millis(interval));
        }
    });

    Ok(())
}

#[command]
pub fn process_stop_monitor(monitor_state: tauri::State<'_, ProcessMonitorState>) {
    monitor_state.stop_all();
}
