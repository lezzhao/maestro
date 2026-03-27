use ignore::gitignore::GitignoreBuilder;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

pub struct FileWatcherState {
    pub watcher: Arc<Mutex<Option<notify_debouncer_mini::Debouncer<RecommendedWatcher>>>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub async fn file_watcher_start(
    app: AppHandle,
    state: State<'_, FileWatcherState>,
    path: String,
) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().await;
    *watcher_guard = None; // clear existing

    let root_path = PathBuf::from(&path);
    if !root_path.exists() {
        return Ok(());
    }

    let mut builder = GitignoreBuilder::new(&root_path);
    let gitignore_path = root_path.join(".gitignore");
    if gitignore_path.exists() {
        let _ = builder.add(&gitignore_path);
    }
    let gitignore = builder
        .build()
        .unwrap_or(ignore::gitignore::Gitignore::empty());

    let handle_clone = app.clone();
    let root_path_clone = root_path.clone();

    let debouncer_res = new_debouncer(
        std::time::Duration::from_millis(1500),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let mut valid_changes = false;
                for event in events {
                    let path = event.path;
                    let is_dir = path.is_dir();

                    // Simple skip for .git or hidden dirs if ignore doesn't catch them
                    if path.components().any(|c| c.as_os_str() == ".git") {
                        continue;
                    }

                    // Strip the root path to pass a relative path to gitignore
                    if let Ok(rel_path) = path.strip_prefix(&root_path_clone) {
                        if !gitignore
                            .matched_path_or_any_parents(rel_path, is_dir)
                            .is_ignore()
                        {
                            valid_changes = true;
                            break;
                        }
                    } else if !gitignore
                        .matched_path_or_any_parents(&path, is_dir)
                        .is_ignore()
                    {
                        valid_changes = true;
                        break;
                    }
                }
                if valid_changes {
                    let _ = handle_clone.emit("project_files_changed", ());
                }
            }
        },
    );

    match debouncer_res {
        Ok(mut debouncer) => {
            if let Err(e) = debouncer
                .watcher()
                .watch(&root_path, RecursiveMode::Recursive)
            {
                tracing::error!("Failed to watch directory {}: {}", path, e);
                return Err(e.to_string());
            }
            *watcher_guard = Some(debouncer);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to create debouncer: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn file_watcher_stop(state: State<'_, FileWatcherState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().await;
    *watcher_guard = None;
    Ok(())
}
