use super::error;
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
    ) -> Result<(), error::CoreError> {
        crate::spec::spec_inject_core(
            &self.config.get(),
            provider,
            project_path,
            mode,
            target_ide,
        )
        .map_err(error::CoreError::from)
    }

    pub fn spec_remove(&self, provider: String, project_path: String) -> Result<(), error::CoreError> {
        crate::spec::spec_remove_core(&self.config.get(), provider, project_path)
            .map_err(error::CoreError::from)
    }

    pub fn spec_detect(&self, project_path: String) -> Vec<SpecDetectResult> {
        crate::spec::spec_detect_core(&self.config.get(), project_path)
    }

    pub fn spec_preview(
        &self,
        provider: String,
        mode: String,
        target_ide: String,
    ) -> Result<Vec<SpecPreviewResult>, error::CoreError> {
        crate::spec::spec_preview_core(&self.config.get(), provider, mode, target_ide)
            .map_err(error::CoreError::from)
    }

    pub fn spec_backup(&self, project_path: String) -> Result<Vec<String>, error::CoreError> {
        crate::spec::spec_backup_core(&self.config.get(), project_path)
            .map_err(error::CoreError::from)
    }

    pub fn spec_restore(&self, project_path: String) -> Result<Vec<String>, error::CoreError> {
        crate::spec::spec_restore_core(&self.config.get(), project_path)
            .map_err(error::CoreError::from)
    }
}
