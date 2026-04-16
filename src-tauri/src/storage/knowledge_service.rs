use crate::core::error::CoreError;
use super::memory::{self, MemoryEntry};
use std::collections::HashMap;
use std::path::PathBuf;

// ─── Lightweight TF-IDF Embedding (Zero External Dependencies) ───────────

const EMBEDDING_DIM: usize = 128;

/// Compute a fixed-dimension TF-IDF-inspired embedding from text.
/// Uses hash-based feature projection (hashing trick) for zero-dependency operation.
fn compute_embedding(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0f32; EMBEDDING_DIM];
    let lowered = text.to_lowercase();
    let tokens: Vec<&str> = lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 2)
        .collect();
    
    let total = tokens.len().max(1) as f32;
    
    // Count term frequencies
    let mut tf: HashMap<&str, f32> = HashMap::new();
    for tok in &tokens {
        *tf.entry(tok).or_insert(0.0) += 1.0;
    }

    // Hashing trick: project each term into the fixed-dim vector
    for (term, freq) in &tf {
        let normalized_tf = freq / total;
        // Use two hash slots per term for better distribution
        let h1 = hash_str(term) % EMBEDDING_DIM;
        let h2 = hash_str(&format!("{}$", term)) % EMBEDDING_DIM;
        let sign = if hash_str(&format!("~{}", term)) % 2 == 0 { 1.0 } else { -1.0 };
        vec[h1] += normalized_tf * sign;
        vec[h2] += normalized_tf * -sign;
    }

    // L2 normalize
    let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-8 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }
    vec
}

/// Simple string hash (FNV-1a inspired).
fn hash_str(s: &str) -> usize {
    let mut hash: usize = 0xcbf29ce484222325;
    for b in s.bytes() {
        hash ^= b as usize;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Cosine similarity between two embedding vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a < 1e-8 || norm_b < 1e-8 {
        return 0.0;
    }
    (dot / (norm_a * norm_b)) as f64
}

fn serialize_embedding(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn deserialize_embedding(data: &[u8]) -> Vec<f32> {
    data.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

// ─── KnowledgeService ────────────────────────────────────────────────────

/// Service for managing multi-modal knowledge and cross-task memory.
/// Part of the Maestro Diamond Architecture for intelligence enhancement.
pub struct KnowledgeService {
    db_path: PathBuf,
}

impl KnowledgeService {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    /// Stores a new chunk of knowledge.
    pub fn store_memory(
        &self,
        task_id: Option<&str>,
        content: &str,
        category: &str,
        metadata: Option<&str>,
    ) -> Result<String, CoreError> {
        memory::create_memory(&self.db_path, task_id, content, category, metadata)
    }

    /// Specialized method for storing reusable skills.
    /// Computes and persists a TF-IDF embedding for vector-based retrieval.
    pub fn store_skill(
        &self,
        name: &str,
        description: &str,
        instructions: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<String, CoreError> {
        let content = format!("### Skill: {}\n**Description**: {}\n\n**Instructions**:\n{}", name, description, instructions);
        let meta_str = metadata.map(|v| v.to_string());
        let id = self.store_memory(None, &content, "skill", meta_str.as_deref())?;

        // Compute and persist embedding
        let embedding = compute_embedding(&format!("{} {} {}", name, description, instructions));
        let blob = serialize_embedding(&embedding);
        let conn = crate::task::repository::db_connection(&self.db_path)
            .map_err(|e| CoreError::Db { message: e.to_string() })?;
        let _ = conn.execute(
            "UPDATE memories SET embedding = ?1 WHERE id = ?2",
            rusqlite::params![blob, id],
        );

        Ok(id)
    }

    /// Retrieves relevant knowledge based on a text query.
    /// MVP: Uses simple keyword matching. 
    /// Future: Will use vector embeddings and RAG.
    pub fn query_knowledge(
        &self,
        query: &str,
        task_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, CoreError> {
        let all_memories = memory::list_memories(&self.db_path, task_id)?;
        
        let mut results: Vec<MemoryEntry> = all_memories
            .into_iter()
            .filter(|m| {
                m.content.to_lowercase().contains(&query.to_lowercase()) ||
                m.category.to_lowercase().contains(&query.to_lowercase())
            })
            .take(limit)
            .collect();

        // If not enough results, add some recent global memories
        if results.len() < limit && task_id.is_some() {
            let global = memory::list_memories(&self.db_path, None)?;
            for m in global {
                if results.len() >= limit { break; }
                if !results.iter().any(|r| r.id == m.id) {
                    results.push(m);
                }
            }
        }

        Ok(results)
    }

    /// Automatically extracts and stores knowledge from a finished task.
    pub fn ingest_task_summary(
        &self,
        task_id: &str,
        summary: &str,
    ) -> Result<(), CoreError> {
        self.store_memory(Some(task_id), summary, "task_summary", None)?;
        Ok(())
    }

    /// Specifically retrieves stored skills using multi-dimensional scoring.
    /// Scoring factors: keyword coverage, usage_count boost, recency.
    pub fn query_skills(&self, query: &str, limit: usize) -> Result<Vec<MemoryEntry>, CoreError> {
        let all_memories = memory::list_memories(&self.db_path, None)?;
        let skills: Vec<MemoryEntry> = all_memories
            .into_iter()
            .filter(|m| m.category == "skill")
            .collect();

        if skills.is_empty() {
            return Ok(vec![]);
        }

        // Tokenize query into keywords
        let keywords: Vec<String> = query
            .to_lowercase()
            .split(|c: char| c.is_whitespace() || c == ',' || c == '.' || c == '?' || c == '!')
            .filter(|w| w.len() >= 2)
            .map(|w| w.to_string())
            .collect();

        if keywords.is_empty() {
            // Fallback: return most recently created skills
            let mut recent = skills;
            recent.truncate(limit);
            return Ok(recent);
        }

        // Compute query embedding for vector similarity
        let query_embedding = compute_embedding(query);

        // Load embeddings from DB for vector scoring
        let conn = crate::task::repository::db_connection(&self.db_path)
            .map_err(|e| CoreError::Db { message: e.to_string() })?;
        let mut embedding_map: HashMap<String, Vec<f32>> = HashMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT id, embedding FROM memories WHERE category = 'skill' AND embedding IS NOT NULL"
            ).map_err(|e| CoreError::Db { message: e.to_string() })?;
            let rows = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let blob: Option<Vec<u8>> = row.get(1)?;
                Ok((id, blob))
            }).map_err(|e| CoreError::Db { message: e.to_string() })?;
            for row in rows.flatten() {
                if let Some(blob) = row.1 {
                    embedding_map.insert(row.0, deserialize_embedding(&blob));
                }
            }
        }
        drop(conn);

        // Score each skill with hybrid: keyword + vector + usage + recency
        let mut scored: Vec<(MemoryEntry, f64)> = skills
            .into_iter()
            .filter_map(|m| {
                let content_lower = m.content.to_lowercase();
                let meta_lower = m.metadata.as_deref().unwrap_or("").to_lowercase();
                let searchable = format!("{} {}", content_lower, meta_lower);
                
                let matched = keywords.iter()
                    .filter(|kw| searchable.contains(kw.as_str()))
                    .count();

                // Keyword coverage score (0.0 - 1.0)
                let keyword_score = if keywords.is_empty() { 0.0 } else {
                    matched as f64 / keywords.len() as f64
                };

                // Vector similarity score (0.0 - 1.0)
                let vector_score = embedding_map.get(&m.id)
                    .map(|emb| cosine_similarity(&query_embedding, emb).max(0.0))
                    .unwrap_or(0.0);

                // Skip if neither keyword nor vector has any signal
                if matched == 0 && vector_score < 0.1 {
                    return None;
                }

                // Hybrid score: 60% keyword + 40% vector
                let hybrid = keyword_score * 0.6 + vector_score * 0.4;

                // Usage frequency boost (logarithmic, max ~0.3 contribution)
                let usage_boost = (m.importance.max(0) as f64 + 1.0).ln() * 0.1;
                // Recency bonus: newer skills get a slight boost
                let recency_bonus = if m.created_at > 0 {
                    let age_days = (chrono::Utc::now().timestamp_millis() - m.created_at).max(0) as f64 / 86_400_000.0;
                    (1.0 / (1.0 + age_days * 0.01)).min(0.2)
                } else {
                    0.0
                };
                
                Some((m, hybrid + usage_boost + recency_bonus))
            })
            .collect();

        // Sort by score descending
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        // Auto-increment usage_count for recalled skills
        for (entry, _) in &scored {
            let _ = memory::increment_usage(&self.db_path, &entry.id);
        }

        Ok(scored.into_iter().map(|(m, _)| m).collect())
    }
}

/// Global singleton or shared state for knowledge service could be managed here.
pub fn get_default_knowledge_service() -> Result<KnowledgeService, CoreError> {
    let db_path = crate::task::state::maestro_db_path_core()?;
    Ok(KnowledgeService::new(db_path))
}
