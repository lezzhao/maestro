use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ScopedWorkspace {
    root: PathBuf,
    canonical_root: PathBuf,
}

impl ScopedWorkspace {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = root.as_ref().to_path_buf();
        if !root.exists() || !root.is_dir() {
            return Err(format!("project path invalid: {}", root.to_string_lossy()));
        }
        let canonical_root = root
            .canonicalize()
            .map_err(|e| format!("canonicalize project root failed: {e}"))?;
        Ok(Self {
            root,
            canonical_root,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn resolve_in_scope(&self, relative_or_abs: &str) -> Result<PathBuf, String> {
        let requested = PathBuf::from(relative_or_abs);
        let candidate = if requested.is_absolute() {
            requested
        } else {
            self.root.join(requested)
        };
        let canonical = candidate
            .canonicalize()
            .map_err(|e| format!("canonicalize file path failed: {e}"))?;
        if !canonical.starts_with(&self.canonical_root) {
            return Err("file path is outside current project".to_string());
        }
        Ok(canonical)
    }
}
