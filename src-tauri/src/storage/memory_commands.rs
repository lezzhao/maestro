use crate::core::MaestroCore;
use crate::storage::memory::MemoryEntry;
use std::sync::Arc;
use tauri::State;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct SaveSkillRequest {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

#[tauri::command]
pub async fn save_skill(
    core: State<'_, Arc<MaestroCore>>,
    req: SaveSkillRequest,
) -> Result<String, String> {
    let service = crate::storage::knowledge_service::KnowledgeService::new(core.state_db_path.clone());
    service.store_skill(&req.name, &req.description, &req.instructions, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_skills(
    core: State<'_, Arc<MaestroCore>>,
) -> Result<Vec<MemoryEntry>, String> {
    let service = crate::storage::knowledge_service::KnowledgeService::new(core.state_db_path.clone());
    service.query_skills("", 100)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_skill(
    core: State<'_, Arc<MaestroCore>>,
    id: String,
) -> Result<(), String> {
    crate::storage::memory::delete_memory(&core.state_db_path, &id)
        .map_err(|e| e.to_string())
}
