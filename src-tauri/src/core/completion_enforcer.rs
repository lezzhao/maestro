use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// CompletionEnforcer acts as a watchdog to prevent runaway execution loops.
/// It wraps a cancellation token and automatically fires it if the specified 
/// timeout is exceeded, ensuring that orphaned or stuck tasks are cleaned up.
pub struct CompletionEnforcer {
    _watchdog: tokio::task::JoinHandle<()>,
}

impl CompletionEnforcer {
    /// Spawns a background task that will cancel the given token after `timeout` duration.
    /// If the token is already cancelled (e.g. task finished normally), the watchdog exits cleanly.
    pub fn spawn(timeout: Duration, token: CancellationToken) -> Self {
        let watchdog = tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(timeout) => {
                    tracing::warn!("CompletionEnforcer watchdog triggered! Execution exceeded limit of {:?}.", timeout);
                    token.cancel();
                }
                _ = token.cancelled() => {
                    // Token was cancelled naturally (task finished or user stopped)
                }
            }
        });

        Self {
            _watchdog: watchdog,
        }
    }
}
