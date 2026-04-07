use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Clone)]
pub struct TaskQueue {
    semaphore: Arc<Semaphore>,
    max_concurrent: Arc<AtomicUsize>,
}

pub struct TaskPermit {
    _permit: OwnedSemaphorePermit,
}

impl TaskQueue {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            max_concurrent: Arc::new(AtomicUsize::new(max_concurrent)),
        }
    }

    pub async fn acquire(&self) -> Result<TaskPermit, String> {
        // Timeout prevents hanging indefinitely if tasks don't release permits
        match tokio::time::timeout(Duration::from_secs(300), Arc::clone(&self.semaphore).acquire_owned()).await {
            Ok(Ok(permit)) => Ok(TaskPermit { _permit: permit }),
            Ok(Err(e)) => Err(format!("Queue closed or failed: {}", e)),
            Err(_) => Err("Timeout waiting for queue capacity over 5 minutes".into()),
        }
    }
    
    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }

    pub fn current_limit(&self) -> usize {
        self.max_concurrent.load(Ordering::SeqCst)
    }

    pub fn update_limit(&self, new_limit: usize) {
        let old_limit = self.max_concurrent.swap(new_limit, Ordering::SeqCst);
        if new_limit > old_limit {
            let diff = new_limit - old_limit;
            self.semaphore.add_permits(diff);
            tracing::info!(from = old_limit, to = new_limit, "TaskQueue concurrency limit increased");
        } else if new_limit < old_limit {
            let diff = old_limit - new_limit;
            let sem = Arc::clone(&self.semaphore);
            // We use a background task to "drain" the permits as they are released.
            // This effectively decreases the functional limit by holding and then forgetting them.
            tokio::spawn(async move {
                match sem.acquire_many(diff as u32).await {
                    Ok(permits) => {
                        permits.forget();
                        tracing::debug!(diff = diff, "TaskQueue: Successfully drained and forgot old permits");
                    }
                    Err(e) => {
                        tracing::error!(error = ?e, "TaskQueue: Failed to drain permits during limit decrease");
                    }
                }
            });
            tracing::info!(from = old_limit, to = new_limit, "TaskQueue concurrency limit decrease scheduled (draining)");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_task_queue_concurrency() {
        let queue = TaskQueue::new(2);
        
        let permit1 = queue.acquire().await.unwrap();
        assert_eq!(queue.available_permits(), 1);
        
        let _permit2 = queue.acquire().await.unwrap();
        assert_eq!(queue.available_permits(), 0);
        
        drop(permit1);
        assert_eq!(queue.available_permits(), 1);
        
        let _permit3 = queue.acquire().await.unwrap();
        assert_eq!(queue.available_permits(), 0);
    }

    #[tokio::test]
    async fn test_task_queue_dynamic_limit() {
        let queue = TaskQueue::new(2);
        let _p1 = queue.acquire().await.unwrap();
        let _p2 = queue.acquire().await.unwrap();
        assert_eq!(queue.available_permits(), 0);

        // Increase
        queue.update_limit(3);
        assert_eq!(queue.available_permits(), 1);
        let _p3 = queue.acquire().await.unwrap();
        assert_eq!(queue.available_permits(), 0);

        // Decrease (drain)
        queue.update_limit(1);
        // Before release, available is 0
        assert_eq!(queue.available_permits(), 0);
        
        drop(_p1); 
        // Small sleep to ensure the background acquire_many has a chance to pick it up
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert_eq!(queue.available_permits(), 0);
        
        drop(_p2); 
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert_eq!(queue.available_permits(), 0);
        
        drop(_p3);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert_eq!(queue.available_permits(), 1); // Finally back to 1
    }
}
