mod m20260407_backfill_profile;

use crate::config::AppConfig;
use crate::core::error::CoreError;
use std::path::Path;

pub struct MigrationManager<'a> {
    db_path: &'a Path,
    config: &'a AppConfig,
}

impl<'a> MigrationManager<'a> {
    pub fn new(db_path: &'a Path, config: &'a AppConfig) -> Self {
        Self { db_path, config }
    }

    /// Run all pending migrations
    pub fn migrate_all(&self) -> Result<usize, CoreError> {
        let mut total_updated = 0;
        
        // 1. m20260407_backfill_profile
        // Note: Currently we don't have a high-level version table yet,
        // so we run idempotent logic. In the next phase, we should add Version/PRAGMA tracking.
        let n = m20260407_backfill_profile::migrate(self.db_path, self.config)?;
        if n > 0 {
            tracing::info!(count = n, "migration: m20260407_backfill_profile completed");
            total_updated += n;
        }

        Ok(total_updated)
    }
}
