use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scoped_workspace_resolve_in_scope() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(root.join("a.txt"), "a").unwrap();
        std::fs::write(sub.join("b.txt"), "b").unwrap();

        let ws = ScopedWorkspace::new(&root).unwrap();
        let a = ws.resolve_in_scope("a.txt").unwrap();
        assert!(a.ends_with("a.txt"));
        let b = ws.resolve_in_scope("sub/b.txt").unwrap();
        assert!(b.ends_with("b.txt"));
        // Path outside project should fail
        let outside = root.join("../outside");
        std::fs::create_dir_all(&outside).unwrap();
        let outside_file = outside.join("x.txt");
        std::fs::write(&outside_file, "x").unwrap();
        let abs_outside = std::fs::canonicalize(&outside_file).unwrap();
        assert!(ws.resolve_in_scope(abs_outside.to_str().unwrap()).is_err());
    }

    #[test]
    fn test_resolve_new_relative_path_in_scope() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let ws = ScopedWorkspace::new(&root).unwrap();

        let new_file = ws.resolve_in_scope("nested/new.txt").unwrap();
        assert_eq!(new_file, root.join("nested/new.txt"));
    }

    #[test]
    fn test_resolve_new_absolute_path_outside_scope_should_fail() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let ws = ScopedWorkspace::new(&root).unwrap();

        let outside = root
            .parent()
            .unwrap_or(root.as_path())
            .join("outside-nonexistent.txt");
        assert!(ws.resolve_in_scope(outside.to_str().unwrap()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn test_symlink_inside_root_pointing_outside_should_fail() {
        use std::os::unix::fs as unix_fs;

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("x.txt");
        std::fs::write(&outside_file, "x").unwrap();
        let link = root.join("leak.txt");
        unix_fs::symlink(&outside_file, &link).unwrap();

        let ws = ScopedWorkspace::new(&root).unwrap();
        assert!(ws.resolve_in_scope("leak.txt").is_err());
    }
}

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
            self.root.join(&requested)
        };
        if candidate.exists() {
            let canonical = candidate
                .canonicalize()
                .map_err(|e| format!("canonicalize file path failed: {e}"))?;
            if !canonical.starts_with(&self.canonical_root) {
                return Err("file path is outside current project".to_string());
            }
            Ok(canonical)
        } else {
            // For new files: reject paths that could escape (contain "..")
            if candidate
                .components()
                .any(|c| c == std::path::Component::ParentDir)
            {
                return Err("file path is outside current project".to_string());
            }
            // For non-existing targets: anchor scope check on nearest existing parent.
            let mut ancestor = candidate.as_path();
            while !ancestor.exists() {
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| "file path is outside current project".to_string())?;
            }
            let canonical_ancestor = ancestor
                .canonicalize()
                .map_err(|e| format!("canonicalize file path failed: {e}"))?;
            if !canonical_ancestor.starts_with(&self.canonical_root) {
                return Err("file path is outside current project".to_string());
            }
            Ok(candidate)
        }
    }
}
