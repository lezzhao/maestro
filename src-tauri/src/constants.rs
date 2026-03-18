//! Centralized default values and constants.

/// Default exit timeout in milliseconds when waiting for engine process to exit.
pub const DEFAULT_EXIT_TIMEOUT_MS: u64 = 3000;

/// Default for take_snapshot when transitioning task state (run git snapshot before persisting).
pub const DEFAULT_TAKE_SNAPSHOT: bool = true;
