use crate::pty::active_os_pid;
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
    pub session_id: Option<String>,
    pub os_pid: Option<u32>,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub running: bool,
}

#[derive(Default)]
pub struct ProcessMonitorState {
    running: AtomicBool,
    latest: RwLock<HashMap<Option<String>, ProcessStats>>,
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
    session_id: Option<String>,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> ProcessStats {
    let pty_state = &core_state.inner().pty_state;
    let os_pid = session_id.as_ref().and_then(|id| active_os_pid(pty_state, id));
    if let Some(pid_u32) = os_pid {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_processes(ProcessRefreshKind::nothing().with_cpu().with_memory()),
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
    session_id: Option<String>,
    interval_ms: Option<u64>,
    core_state: tauri::State<'_, crate::core::MaestroCore>,
) -> Result<(), String> {
    let interval = interval_ms.unwrap_or(2000).max(500);
    let core = core_state.inner();
    core.process_monitor.stop_all();
    core.process_monitor.running.store(true, Ordering::Relaxed);
    let stop_flag = Arc::new(AtomicBool::new(false));
    *core.process_monitor.stopper.lock().expect("stopper lock poisoned") = Some(stop_flag.clone());

    let app_handle = app.clone();
    thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            let stats = {
                let core = app_handle.state::<crate::core::MaestroCore>();
                let pty = &core.inner().pty_state;
                let os_pid = session_id.as_ref().and_then(|id| active_os_pid(pty, id));
                if let Some(pid_u32) = os_pid {
                    let mut sys = System::new_with_specifics(
                        RefreshKind::nothing()
                            .with_processes(ProcessRefreshKind::nothing().with_cpu().with_memory()),
                    );
                    let pid = Pid::from_u32(pid_u32);
                    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
                    if let Some(process) = sys.process(pid) {
                        ProcessStats {
                            session_id: session_id.clone(),
                            os_pid,
                            cpu_percent: process.cpu_usage(),
                            memory_mb: process.memory() / 1024 / 1024,
                            running: true,
                        }
                    } else {
                        ProcessStats {
                            session_id: session_id.clone(),
                            os_pid,
                            cpu_percent: 0.0,
                            memory_mb: 0,
                            running: false,
                        }
                    }
                } else {
                    ProcessStats {
                        session_id: session_id.clone(),
                        os_pid: None,
                        cpu_percent: 0.0,
                        memory_mb: 0,
                        running: false,
                    }
                }
            };

            app_handle
                .state::<crate::core::MaestroCore>()
                .inner()
                .process_monitor
                .latest
                .write()
                .expect("latest write lock poisoned")
                .insert(session_id.clone(), stats.clone());
            let _ = app_handle.emit("perf://stats", stats);
            thread::sleep(Duration::from_millis(interval));
        }
    });

    Ok(())
}

#[command]
pub fn process_stop_monitor(core_state: tauri::State<'_, crate::core::MaestroCore>) {
    core_state.inner().process_monitor.stop_all();
}
