use super::MaestroCore;
use crate::spec::{SpecDescriptor, SpecDetectResult, SpecPreviewResult};

impl MaestroCore {
    pub fn spec_list(&self) -> Vec<SpecDescriptor> {
        crate::spec::spec_descriptors(&self.config.get())
    }

    pub fn spec_inject(
        &self,
        provider: String,
        project_path: String,
        mode: String,
        target_ide: String,
    ) -> Result<(), String> {
        crate::spec::spec_inject_core(
            &self.config.get(),
            provider,
            project_path,
            mode,
            target_ide,
        )
    }

    pub fn spec_remove(&self, provider: String, project_path: String) -> Result<(), String> {
        crate::spec::spec_remove_core(&self.config.get(), provider, project_path)
    }

    pub fn spec_detect(&self, project_path: String) -> Vec<SpecDetectResult> {
        crate::spec::spec_detect_core(&self.config.get(), project_path)
    }

    pub fn spec_preview(
        &self,
        provider: String,
        mode: String,
        target_ide: String,
    ) -> Result<Vec<SpecPreviewResult>, String> {
        crate::spec::spec_preview_core(&self.config.get(), provider, mode, target_ide)
    }

    pub fn spec_backup(&self, project_path: String) -> Result<Vec<String>, String> {
        crate::spec::spec_backup_core(&self.config.get(), project_path)
    }

    pub fn spec_restore(&self, project_path: String) -> Result<Vec<String>, String> {
        crate::spec::spec_restore_core(&self.config.get(), project_path)
    }
}
