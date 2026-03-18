//! Centralized default values and constants.

/// Default engine id when no engines are configured (matches frontend DEFAULT_ENGINE_ID).
pub const DEFAULT_ENGINE_ID: &str = "cursor";

/// Default profile id when engine has no profiles.
pub const DEFAULT_PROFILE_ID: &str = "default";

/// Default target IDE for spec injection.
pub const DEFAULT_TARGET_IDE: &str = "cursor";

/// Default exit timeout in milliseconds when waiting for engine process to exit.
pub const DEFAULT_EXIT_TIMEOUT_MS: u64 = 3000;

/// Default for take_snapshot when transitioning task state (run git snapshot before persisting).
pub const DEFAULT_TAKE_SNAPSHOT: bool = true;
