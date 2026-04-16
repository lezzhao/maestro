use super::archive::save_archive;
use super::history::persist_engine_history;
use super::step_executor::execute_workflow_step;
use super::types::*;

use super::verification_parser::merge_verification_summary;
use crate::agent_state::emitter::AppEventHandle;
use crate::core::error::CoreError;
use crate::core::events::EventStream;
use crate::core::execution::{Execution, ExecutionMode};
use crate::infra::workspace_io::WorkspaceIo;
use crate::pty::PtyManagerState;
use crate::storage::execution_binding::prepare_execution_binding;
use crate::storage::run_persistence::{append_run_record, current_time_ms};
use std::sync::Arc;


pub async fn workflow_run_step_core(
    _event_handle: Arc<dyn AppEventHandle>,
    emitter: Arc<dyn EventStream>,
    request: StepRunRequest,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
) -> Result<StepRunResult, CoreError> {
    let total_steps = request.total_steps.max(1);
    let step_index = request.step_index.min(total_steps.saturating_sub(1));
    let (result, profile_id) = execute_workflow_step(
        _event_handle.clone(),
        emitter.clone(),
        &request.workflow_name,
        &request.step,
        step_index,
        total_steps,
        request.state_token.clone(),
        cfg,
        pty_state,
    )
    .await?;

    if let Err(err) = persist_engine_history(
        &request.step.engine,
        &profile_id,
        &request.workflow_name,
        step_index,
        &request.step.prompt,
        &result,
    )
    .await
    {
        let _ = emitter.send_event(
            "workflow://progress",
            serde_json::to_value(WorkflowProgressEvent {
                workflow_name: request.workflow_name.clone(),
                step_index,
                total_steps,
                engine: request.step.engine.clone(),
                status: "warning".to_string(),
                message: format!("history persistence failed: {err}"),
                token_estimate: None,
                state_token: request.state_token.clone(),
            })
            .unwrap_or_default(),
        );
    }

    Ok(StepRunResult {
        engine: result.engine,
        mode: result.mode,
        status: result.status.clone(),
        fallback: result.fallback,
        success: result.success,
        completion_matched: result.completion_matched,
        failure_reason: result.failure_reason,
        duration_ms: result.duration_ms,
        output: result.output,
        token_estimate: result.token_estimate,
        verification: result.verification,
    })
}

pub async fn workflow_run_core(
    event_handle: Arc<dyn AppEventHandle>,
    emitter: Arc<dyn EventStream>,
    request: WorkflowRunRequest,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
) -> Result<WorkflowRunResult, CoreError> {
    let i18n = cfg.i18n();
    let workflow_name = request.name.clone();
    let total = request.steps.len();
    if total == 0 {
        return Err(CoreError::ValidationError {
            field: "steps".to_string(),
            message: "workflow has no steps".to_string(),
        });
    }

    let now_ms = current_time_ms().unwrap_or_default();
    let execution_id = format!("workflow-{workflow_name}-{now_ms}");

    // When task_id exists, ensure execution binding before run
    if let Some(task_id) = request.task_id.as_ref() {
        if !task_id.is_empty() {
            prepare_execution_binding(event_handle.clone(), &execution_id, task_id, cfg)?;
        }
    }

    // Create Execution at start - it becomes the single source of truth for this run
    let mut execution = Execution::new(
        execution_id,
        "workflow".to_string(),
        ExecutionMode::Workflow,
    );
    execution.source = "workflow_run".to_string();
    execution.task_id = request.task_id.clone().unwrap_or_default();
    execution.cwd = cfg.project.path.clone();
    execution.start();

    let mut used_fallback = false;
    let mut step_results = Vec::with_capacity(total);

    for (idx, step) in request.steps.iter().enumerate() {
        let (result, profile_id) = execute_workflow_step(
            event_handle.clone(),
            emitter.clone(),
            &workflow_name,
            step,
            idx,
            total,
            request.state_token.clone(),
            cfg,
            pty_state,
        )
        .await?;
        used_fallback = used_fallback || result.fallback;

        if let Err(err) = persist_engine_history(
            &step.engine,
            &profile_id,
            &workflow_name,
            idx,
            &step.prompt,
            &result,
        )
        .await
        {
            let _ = emitter.send_event(
                "workflow://progress",
                serde_json::to_value(WorkflowProgressEvent {
                    workflow_name: workflow_name.clone(),
                    step_index: idx,
                    total_steps: total,
                    engine: step.engine.clone(),
                    status: "warning".to_string(),
                    message: format!("history persistence failed: {err}"),
                    token_estimate: None,
                    state_token: request.state_token.clone(),
                })
                .unwrap_or_default(),
            );
        }

        step_results.push(result);
    }

    let _ = emitter.send_event(
        "workflow://progress",
        serde_json::to_value(WorkflowProgressEvent {
            workflow_name: workflow_name.clone(),
            step_index: total,
            total_steps: total,
            engine: request
                .steps
                .last()
                .map(|s| s.engine.clone())
                .unwrap_or_default(),
            status: "finished".to_string(),
            message: i18n.t("workflow_completed"),
            token_estimate: None,
            state_token: request.state_token.clone(),
        })
        .unwrap_or_default(),
    );

    let completed = step_results
        .iter()
        .all(|s| s.success && s.completion_matched);
    let mut run_result = WorkflowRunResult {
        workflow_name,
        used_fallback,
        completed,
        archive_path: String::new(),
        step_results,
        verification: None,
    };
    run_result.verification = merge_verification_summary(&run_result.step_results);
    run_result.archive_path = save_archive(&request, &run_result).map_err(CoreError::from)?;

    // Finalize execution (single source of truth created at start)
    let output_preview: String = run_result
        .step_results
        .last()
        .map(|item| item.output.chars().take(300).collect())
        .unwrap_or_default();
    if run_result.completed {
        execution.complete_with(output_preview, run_result.verification.clone());
    } else {
        execution.fail_with("workflow failed".to_string(), output_preview);
    }
    if let Ok(io) = WorkspaceIo::new(&std::path::PathBuf::from(&cfg.project.path)) {
        let _ = append_run_record(&io, &execution, None);
    }

    Ok(run_result)
}
