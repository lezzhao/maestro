import Database from "@tauri-apps/plugin-sql";

export interface Task {
  id: string; // UUID
  title: string;
  description: string;
  current_state: string; // e.g. 'BACKLOG', 'PLANNING', 'IN_PROGRESS', 'DONE'
  workspace_boundary: string; // JSON string of allowed paths
  created_at: string;
  updated_at: string;
}

export interface StateTransition {
  id: string; // UUID
  task_id: string;
  from_state: string;
  to_state: string;
  triggered_by: string; // e.g. 'user', 'coder_agent'
  git_snapshot_hash: string | null;
  context_reasoning: string;
  timestamp: string;
}

export interface Artefact {
  id: string; // UUID
  task_id: string;
  type: string; // e.g. 'PRD', 'ARCHITECTURE', 'TEST_PLAN'
  content: string;
  created_at: string;
  updated_at: string;
}

class MaestroDatabase {
  private db: Database | null = null;
  private initialized = false;

  async init() {
    if (this.initialized) return;
    
    // Load the SQLite database instance from Tauri.
    // It creates state.db in the app's appData directory.
    this.db = await Database.load("sqlite:maestro_state.db");

    await this.createTables();
    this.initialized = true;
  }

  private async createTables() {
    if (!this.db) throw new Error("Database not initialized");

    const tasksSchema = `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        current_state TEXT NOT NULL,
        workspace_boundary TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const transitionsSchema = `
      CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        git_snapshot_hash TEXT,
        context_reasoning TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `;

    const artefactsSchema = `
      CREATE TABLE IF NOT EXISTS artefacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `;

    await this.db.execute(tasksSchema);
    await this.db.execute(transitionsSchema);
    await this.db.execute(artefactsSchema);
  }

  // --- DAL Methods ---

  async getDb(): Promise<Database> {
    if (!this.initialized) {
      await this.init();
    }
    return this.db!;
  }

  async createTask(task: Omit<Task, 'created_at' | 'updated_at'>) {
    const db = await this.getDb();
    await db.execute(
      `INSERT INTO tasks (id, title, description, current_state, workspace_boundary) 
       VALUES ($1, $2, $3, $4, $5)`,
      [task.id, task.title, task.description, task.current_state, task.workspace_boundary]
    );
  }

  async updateTaskState(id: string, newState: string) {
    const db = await this.getDb();
    await db.execute(
      `UPDATE tasks SET current_state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newState, id]
    );
  }

  async getTask(id: string): Promise<Task | null> {
    const db = await this.getDb();
    const result = await db.select<Task[]>(`SELECT * FROM tasks WHERE id = $1`, [id]);
    return result.length > 0 ? result[0] : null;
  }

  async logTransition(transition: Omit<StateTransition, 'timestamp'>) {
    const db = await this.getDb();
    await db.execute(
      `INSERT INTO state_transitions (id, task_id, from_state, to_state, triggered_by, git_snapshot_hash, context_reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        transition.id, transition.task_id, transition.from_state, 
        transition.to_state, transition.triggered_by, 
        transition.git_snapshot_hash, transition.context_reasoning
      ]
    );
  }
}

export const dbProvider = new MaestroDatabase();
