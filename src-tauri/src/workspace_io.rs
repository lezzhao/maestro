use crate::scoped_fs::ScopedWorkspace;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct WorkspaceIo {
    scoped: ScopedWorkspace,
}

impl WorkspaceIo {
    pub fn new(project_path: &Path) -> Result<Self, String> {
        Ok(Self {
            scoped: ScopedWorkspace::new(project_path)?,
        })
    }

    pub fn root(&self) -> &Path {
        self.scoped.root()
    }

    pub fn resolve(&self, rel_path: &str) -> Result<PathBuf, String> {
        self.scoped.resolve_in_scope(rel_path)
    }

    pub fn read_text(&self, rel_path: &str) -> Result<String, String> {
        let file = self.resolve(rel_path)?;
        fs::read_to_string(&file).map_err(|e| format!("read file failed: {e}"))
    }

    pub fn write_text(&self, rel_path: &str, content: &str) -> Result<(), String> {
        let file = self.resolve(rel_path)?;
        ensure_parent(&file)?;
        fs::write(&file, content).map_err(|e| format!("write file failed: {e}"))
    }

    pub fn remove_path(&self, rel_path: &str) -> Result<(), String> {
        let path = self.resolve(rel_path)?;
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|e| format!("remove dir failed: {e}"))?;
        } else if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("remove file failed: {e}"))?;
        }
        Ok(())
    }

    pub fn copy_dir_from(&self, src: &Path, dst_rel: &str) -> Result<(), String> {
        let dst = self.resolve(dst_rel)?;
        copy_dir_all(src, &dst)
    }

    pub fn backup_file_if_exists(&self, rel_path: &str) -> Result<Option<PathBuf>, String> {
        let src = self.resolve(rel_path)?;
        if !(src.exists() && src.is_file()) {
            return Ok(None);
        }
        let backup = backup_path(&src);
        ensure_parent(&backup)?;
        fs::copy(&src, &backup).map_err(|e| format!("backup copy failed: {e}"))?;
        Ok(Some(src))
    }

    pub fn restore_file_if_exists(&self, rel_path: &str) -> Result<Option<PathBuf>, String> {
        let dst = self.resolve(rel_path)?;
        let backup = backup_path(&dst);
        if !(backup.exists() && backup.is_file()) {
            return Ok(None);
        }
        ensure_parent(&dst)?;
        fs::copy(&backup, &dst).map_err(|e| format!("restore copy failed: {e}"))?;
        fs::remove_file(&backup).map_err(|e| format!("remove backup failed: {e}"))?;
        Ok(Some(dst))
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Err(format!("source path does not exist: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("create dir failed: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir failed: {e}"))? {
        let entry = entry.map_err(|e| format!("dir entry failed: {e}"))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("file_type failed: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy failed {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent failed: {e}"))?;
    }
    Ok(())
}

fn backup_path(path: &Path) -> PathBuf {
    let mut raw: OsString = path.as_os_str().to_os_string();
    raw.push(".bmad-bak");
    PathBuf::from(raw)
}
