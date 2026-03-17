//! Engine module: configuration, preflight, models, and session lifecycle.
//!
//! **Module boundaries:**
//! - `config`: Engine config CRUD, profile management, disk persistence. Does NOT handle task-level logic.
//! - `legacy`: Tauri command entry points; forwards to MaestroCore.
//! - `models`: Fetches model lists from engines. Read-only.
//! - `preflight`: Checks command existence, auth, headless support. No side effects.
//! - `runtime`: Low-level session cleanup for task-engine switch. Does NOT know about tasks;
//!   the task_switch_engine use case lives in core and orchestrates this.

pub mod config;
pub mod legacy;
pub mod models;
pub mod preflight;
pub mod runtime;
pub(crate) mod utils;

pub use config::*;
pub use legacy::*;
pub use models::*;
pub use preflight::*;
pub use runtime::*;
