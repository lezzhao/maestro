use crate::core::error::CoreError;
use rusqlite::Connection;

pub(crate) fn db_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Db {
        message: e.to_string(),
    }
}

pub trait Migration {
    fn version(&self) -> i32;
    fn description(&self) -> &str;
    fn up(&self, conn: &Connection) -> Result<(), CoreError>;
}

struct MigrationV1;
impl Migration for MigrationV1 {
    fn version(&self) -> i32 { 1 }
    fn description(&self) -> &str { "Initial baseline schema" }
    fn up(&self, conn: &Connection) -> Result<(), CoreError> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                engine_id TEXT NOT NULL,
                current_state TEXT NOT NULL,
                workspace_boundary TEXT NOT NULL,
                profile_id TEXT,
                workspace_id TEXT,
                settings TEXT,
                runtime_snapshot_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS state_transitions (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                from_state TEXT NOT NULL,
                to_state TEXT NOT NULL,
                triggered_by TEXT NOT NULL,
                git_snapshot_hash TEXT,
                context_reasoning TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS runtime_snapshots (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                engine_id TEXT NOT NULL,
                profile_id TEXT,
                payload_json TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS execution_bindings (
                execution_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                snapshot_id TEXT NOT NULL,
                engine_id TEXT NOT NULL,
                profile_id TEXT,
                mode TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                task_id TEXT,
                title TEXT NOT NULL,
                engine_id TEXT NOT NULL,
                profile_id TEXT,
                message_count INTEGER DEFAULT 0,
                summary TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT,
                meta TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                task_id TEXT,
                content TEXT NOT NULL,
                category TEXT NOT NULL,
                importance INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            "#
        ).map_err(db_err)
    }
}

struct MigrationV2;
impl Migration for MigrationV2 {
    fn version(&self) -> i32 { 2 }
    fn description(&self) -> &str { "Add harness_sessions table" }
    fn up(&self, conn: &Connection) -> Result<(), CoreError> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS harness_sessions (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                current_mode TEXT NOT NULL,
                strategic_plan TEXT,
                metadata_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_harness_task ON harness_sessions(task_id);
            "#
        ).map_err(db_err)
    }
}

struct MigrationV3;
impl Migration for MigrationV3 {
    fn version(&self) -> i32 { 3 }
    fn description(&self) -> &str { "Add metadata column to memories table" }
    fn up(&self, conn: &Connection) -> Result<(), CoreError> {
        conn.execute_batch(
            r#"
            ALTER TABLE memories ADD COLUMN metadata TEXT;
            CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
            "#
        ).map_err(db_err)
    }
}

struct MigrationV4;
impl Migration for MigrationV4 {
    fn version(&self) -> i32 { 4 }
    fn description(&self) -> &str { "Add usage tracking and embedding columns to memories" }
    fn up(&self, conn: &Connection) -> Result<(), CoreError> {
        conn.execute_batch(
            r#"
            ALTER TABLE memories ADD COLUMN usage_count INTEGER DEFAULT 0;
            ALTER TABLE memories ADD COLUMN last_used_at DATETIME;
            ALTER TABLE memories ADD COLUMN embedding BLOB;
            "#
        ).map_err(db_err)
    }
}

const MIGRATIONS: &[&dyn Migration] = &[
    &MigrationV1,
    &MigrationV2,
    &MigrationV3,
    &MigrationV4,
];

pub fn run_migrations(conn: &Connection) -> Result<(), CoreError> {
    // 1. Ensure the schema_version table exists
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(db_err)?;

    // 2. Get current version
    let current_db_version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .map_err(db_err)?;

    // 3. Find missing migrations
    for m in MIGRATIONS {
        let v = m.version();
        if v > current_db_version {
            tracing::info!(version = v, description = m.description(), "Applying database migration");
            
            // Execute in an unchecked transaction since we handle the COMMIT ourselves 
            // and the 'up' function might execute multiple statements.
            // Using a simple transaction wrapper for each migration ensures consistency.
            let tx = conn.unchecked_transaction().map_err(db_err)?;
            
            m.up(&tx)?;
            
            tx.execute(
                "INSERT INTO schema_version (version) VALUES (?)",
                [v],
            )
            .map_err(db_err)?;
            
            tx.commit().map_err(db_err)?;
            
            tracing::info!(version = v, "Successfully applied migration");
        }
    }

    Ok(())
}
