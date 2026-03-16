use super::archive::save_archive;
use super::history::persist_engine_history;
use super::types::*;
use super::util::*;
use crate::core::MaestroCore;
use crate::engine::EngineRuntimeState;
use crate::pty::PtyManagerState;
use crate::core::execution::{Execution, ExecutionMode};
use crate::run_persistence::{
    append_run_record, current_time_ms, resolve_root_dir_from_project_path,
};
use regex::Regex;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
    AppHandle, State,
};
use crate::core::events::EventStream;

fn parse_case_counts(output: &str) -> (usize, usize, usize, usize) {
    let passed_re = Regex::new(r"(?i)\b(\d+)\s+passed\b").expect("regex must compile");
    let failed_re = Regex::new(r"(?i)\b(\d+)\s+failed\b").expect("regex must compile");
    let skipped_re =
        Regex::new(r"(?i)\b(\d+)\s+(skipped|todo|pending)\b").expect("regex must compile");
    let total_re = Regex::new(r"(?i)\b(\d+)\s+total\b").expect("regex must compile");

    let passed = passed_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let failed = failed_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let skipped = skipped_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let mut total = total_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    if total == 0 {
        total = passed + failed + skipped;
    }
    (total, passed, failed, skipped)
}

fn parse_suite_counts(output: &str) -> (usize, usize, usize) {
    let suite_passed_re = Regex::new(
        r"(?i)test suites?:\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+total)?",
    )
    .expect("regex must compile");
    if let Some(cap) = suite_passed_re.captures(output) {
        let passed = cap
            .get(1)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0);
        let failed = cap
            .get(2)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0);
        let total = cap
            .get(3)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(passed + failed);
        return (total, passed, failed);
    }
    let generic_suite_re =
        Regex::new(r"(?i)\b(\d+)\s+(passed|failed)\s+\([0-9.]+s?\)").expect("regex must compile");
    let mut passed = 0;
    let mut failed = 0;
    for cap in generic_suite_re.captures_iter(output) {
        let value = cap
            .get(1)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0);
        let status = cap
            .get(2)
            .map(|m| m.as_str().to_lowercase())
            .unwrap_or_default();
        if status == "passed" {
            passed += value;
        } else if status == "failed" {
            failed += value;
        }
    }
    let total = passed + failed;
    (total, passed, failed)
}

fn detect_framework(output: &str) -> Option<String> {
    let lower = output.to_lowercase();
    if lower.contains("vitest") {
        return Some("vitest".to_string());
    }
    if lower.contains("jest") {
        return Some("jest".to_string());
    }
    if lower.contains("playwright") {
        return Some("playwright".to_string());
    }
    if lower.contains("cypress") {
        return Some("cypress".to_string());
    }
    None
}

fn extract_verification_summary(
    output: &str,
    step_success: bool,
    duration_ms: u128,
) -> Option<VerificationSummary> {
    let framework = detect_framework(output)?;
    let (total_cases, passed_cases, failed_cases, skipped_cases) = parse_case_counts(output);
    let (total_suites, passed_suites, failed_suites) = parse_suite_counts(output);
    let has_cases = total_cases > 0 || passed_cases > 0 || failed_cases > 0 || skipped_cases > 0;
    let has_suites = total_suites > 0 || passed_suites > 0 || failed_suites > 0;
    if !has_cases && !has_suites {
        return Some(VerificationSummary {
            has_verification: true,
            test_run: Some(TestRunSummary {
                framework,
                success: step_success,
                total_suites: 0,
                passed_suites: 0,
                failed_suites: 0,
                total_cases: 0,
                passed_cases: 0,
                failed_cases: 0,
                skipped_cases: 0,
                duration_ms: Some(duration_ms),
                suites: vec![],
                raw_summary: Some("检测到测试框架输出，但未解析到结构化计数".to_string()),
            }),
            source: Some("text-parser".to_string()),
            notes: Some("请检查原始输出确认测试结果".to_string()),
        });
    }
    let success = step_success && failed_cases == 0 && failed_suites == 0;
    Some(VerificationSummary {
        has_verification: true,
        test_run: Some(TestRunSummary {
            framework,
            success,
            total_suites,
            passed_suites,
            failed_suites,
            total_cases,
            passed_cases,
            failed_cases,
            skipped_cases,
            duration_ms: Some(duration_ms),
            suites: vec![TestSuiteResult {
                name: "default".to_string(),
                total_cases,
                passed_cases,
                failed_cases,
                skipped_cases,
                duration_ms: Some(duration_ms),
                cases: vec![],
            }],
            raw_summary: None,
        }),
        source: Some("text-parser".to_string()),
        notes: None,
    })
}

fn merge_verification_summary(step_results: &[WorkflowStepResult]) -> Option<VerificationSummary> {
    let mut target: Option<TestRunSummary> = None;
    for step in step_results {
        let maybe_run = step
            .verification
            .as_ref()
            .and_then(|verification| verification.test_run.as_ref());
        let Some(run) = maybe_run else {
            continue;
        };
        if let Some(current) = target.as_mut() {
            current.success = current.success && run.success;
            current.total_suites += run.total_suites;
            current.passed_suites += run.passed_suites;
            current.failed_suites += run.failed_suites;
            current.total_cases += run.total_cases;
            current.passed_cases += run.passed_cases;
            current.failed_cases += run.failed_cases;
            current.skipped_cases += run.skipped_cases;
            current.suites.extend(run.suites.clone());
        } else {
            target = Some(run.clone());
        }
    }
    target.map(|run| VerificationSummary {
        has_verification: true,
        test_run: Some(run),
        source: Some("aggregated".to_string()),
        notes: None,
    })
}

async fn execute_workflow_step(
    emitter: Arc<dyn EventStream>,
    workflow_name: &str,
    step: &WorkflowRunStep,
    step_index: usize,
    total_steps: usize,
    runtime_state: &EngineRuntimeState,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
) -> Result<(WorkflowStepResult, String), String> {
    let step_started = Instant::now();
    let engine = cfg
        .engines
        .get(&step.engine)
        .ok_or_else(|| format!("engine not found: {}", step.engine))?
        .clone();
    let profile =
        if let Some(profile_id) = step.profile_id.as_deref() {
            engine.profiles.get(profile_id).cloned().ok_or_else(|| {
                format!("profile not found for engine {}: {profile_id}", step.engine)
            })?
        } else {
            engine.active_profile()
        };
    *runtime_state
        .active_engine_id
        .lock()
        .expect("active_engine lock poisoned") = Some(step.engine.clone());

    emitter.send_event(
        "workflow://progress",
        serde_json::to_value(WorkflowProgressEvent {
            workflow_name: workflow_name.to_string(),
            step_index,
            total_steps,
            engine: step.engine.clone(),
            status: "starting".to_string(),
            message: "starting step".to_string(),
            token_estimate: None,
        }).map_err(|e| format!("serialize failed: {e}"))?,
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    let _mode_hint = if profile.supports_headless() {
        "headless"
    } else {
        "pty-fallback"
    };
    emitter.send_event(
        "workflow://progress",
        serde_json::to_value(WorkflowProgressEvent {
            workflow_name: workflow_name.to_string(),
            step_index,
            total_steps,
            engine: step.engine.clone(),
            status: "running".to_string(),
            message: format!("starting step {} with {}", step_index + 1, step.engine),
            token_estimate: None,
        }).map_err(|e| format!("serialize failed: {e}"))?,
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    let result = if profile.supports_headless() {
        let mut args = if profile.headless_args().is_empty() {
            profile.args().clone()
        } else {
            profile.headless_args().clone()
        };
        args = with_model_args(args, &step.engine, &profile.model());
        args.push(step.prompt.clone());

        let full_command_str = format!("{} {}", profile.command(), args.join(" "));
        if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default().check_command(&full_command_str) {
            return Ok((WorkflowStepResult {
                engine: step.engine.clone(),
                mode: "headless".to_string(),
                status: "error".to_string(),
                fallback: false,
                success: false,
                completion_matched: false,
                failure_reason: Some("action-guard".to_string()),
                duration_ms: step_started.elapsed().as_millis(),
                output: format!("Blocked by ActionGuard: {reason}"),
                verification: None,
            }, profile.id));
        }

        let mut command = tokio::process::Command::new(&profile.command());
        #[cfg(unix)]
        {
            command.process_group(0);
        }
        command.args(args.clone());
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if !cfg.project.path.trim().is_empty() {
            command.current_dir(&cfg.project.path);
        }
        for (k, v) in &profile.env() {
            command.env(k, v);
        }

        match command.spawn() {
            Ok(mut child) => {
                let timeout = step.timeout_ms.unwrap_or(30_000).max(20_000);
                let deadline = Instant::now() + Duration::from_millis(timeout);
                let mut timed_out = false;

                let status = loop {
                    match child.try_wait() {
                        Ok(Some(status)) => break Some(status),
                        Ok(None) => {
                            if Instant::now() >= deadline {
                                timed_out = true;
                                let _ = child.start_kill();
                                break None;
                            }
                            tokio::time::sleep(Duration::from_millis(80)).await;
                        }
                        Err(_) => break None,
                    }
                };

                let output = child
                    .wait_with_output()
                    .await
                    .map_err(|e| format!("wait child failed: {e}"))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                let message = if stderr.trim().is_empty() {
                    stdout
                } else if stdout.trim().is_empty() {
                    stderr
                } else {
                    format!("{stdout}\n{stderr}")
                };

                let exited_ok =
                    status.map(|s| s.success()).unwrap_or(false) || output.status.success();
                let matched = completion_matched(step.completion_signal.as_deref(), &message);
                let success = exited_ok && !timed_out;
                let duration_ms = step_started.elapsed().as_millis();
                let verification =
                    extract_verification_summary(&message, success && matched, duration_ms);

                WorkflowStepResult {
                    engine: step.engine.clone(),
                    mode: "headless".to_string(),
                    status: if success && matched { "done".to_string() } else { "error".to_string() },
                    fallback: false,
                    success,
                    completion_matched: matched,
                    failure_reason: if timed_out {
                        Some("timeout".to_string())
                    } else if !exited_ok {
                        Some("exit-nonzero".to_string())
                    } else if !matched {
                        Some("not-matched".to_string())
                    } else {
                        None
                    },
                    duration_ms,
                    output: message,
                    verification,
                }
            }
            Err(e) => WorkflowStepResult {
                engine: step.engine.clone(),
                mode: "headless".to_string(),
                status: "error".to_string(),
                fallback: false,
                success: false,
                completion_matched: false,
                failure_reason: Some("spawn-failed".to_string()),
                duration_ms: step_started.elapsed().as_millis(),
                output: format!("failed to run headless command: {e}"),
                verification: None,
            },
        }
    } else {
        let args_for_pty = with_model_args(profile.args().clone(), &step.engine, &profile.model());
        let full_command_str = format!("{} {} {}", profile.command(), args_for_pty.join(" "), step.prompt);
        if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default().check_command(&full_command_str) {
            return Ok((WorkflowStepResult {
                engine: step.engine.clone(),
                mode: "pty-fallback".to_string(),
                status: "error".to_string(),
                fallback: true,
                success: false,
                completion_matched: false,
                failure_reason: Some("action-guard".to_string()),
                duration_ms: step_started.elapsed().as_millis(),
                output: format!("Blocked by ActionGuard: {reason}"),
                verification: None,
            }, profile.id));
        }

        let output_buf = Arc::new(Mutex::new(String::new()));
        let output_buf_ch = Arc::clone(&output_buf);
        let on_data = Channel::new(move |chunk: InvokeResponseBody| {
            let text = match chunk {
                InvokeResponseBody::Json(s) => s,
                InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            };
            let mut buf = output_buf_ch.lock().expect("workflow output lock poisoned");
            buf.push_str(&text);
            if buf.len() > 1_000_000 {
                let drop_prefix = buf.len() - 1_000_000;
                buf.drain(..drop_prefix);
            }
            Ok(())
        });

        let session_id = uuid::Uuid::new_v4().to_string();
        let spawn = pty_state.spawn_session(
            session_id,
            profile.command().clone(),
            args_for_pty,
            if cfg.project.path.trim().is_empty() {
                None
            } else {
                Some(cfg.project.path.clone())
            },
            profile.env().clone().into_iter().collect(),
            120,
            36,
            on_data,
        )?;

        if let Some(ready_signal) = profile.ready_signal().as_deref() {
            let ready_deadline =
                Instant::now() + Duration::from_millis(step.timeout_ms.unwrap_or(15_000) / 3);
            while Instant::now() < ready_deadline {
                let snap = output_buf
                    .lock()
                    .expect("workflow output lock poisoned")
                    .clone();
                if completion_matched(Some(ready_signal), &snap) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
        }

        pty_state.write_to_session(Some(spawn.session_id.clone()), &format!("{}\n", step.prompt))?;

        let timeout = step.timeout_ms.unwrap_or(30_000).max(500);
        let deadline = Instant::now() + Duration::from_millis(timeout);
        let mut matched = false;
        let mut timed_out = false;
        while Instant::now() < deadline {
            let snap = output_buf
                .lock()
                .expect("workflow output lock poisoned")
                .clone();
            if completion_matched(step.completion_signal.as_deref(), &snap) {
                matched = true;
                break;
            }
            if pty_state.try_wait_exit_status(&spawn.session_id).is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
        if !matched && Instant::now() >= deadline {
            timed_out = true;
        }

        let _ = pty_state.kill_session(&spawn.session_id);
        let final_output = output_buf
            .lock()
            .expect("workflow output lock poisoned")
            .clone();

        WorkflowStepResult {
            engine: step.engine.clone(),
            mode: "pty-fallback".to_string(),
            status: if matched { "done".to_string() } else { "error".to_string() },
            fallback: true,
            success: matched,
            completion_matched: matched,
            failure_reason: if matched {
                None
            } else if timed_out {
                Some("timeout".to_string())
            } else {
                Some("not-matched".to_string())
            },
            duration_ms: step_started.elapsed().as_millis(),
            verification: extract_verification_summary(
                &final_output,
                matched,
                step_started.elapsed().as_millis(),
            ),
            output: final_output,
        }
    };

    let token_estimate = estimate_tokens(&step.prompt, &result.output);
    emitter.send_event(
        "workflow://progress",
        serde_json::to_value(WorkflowProgressEvent {
            workflow_name: workflow_name.to_string(),
            step_index,
            total_steps,
            engine: step.engine.clone(),
            status: "done".to_string(),
            message: if result.success && result.completion_matched {
                "step completed".to_string()
            } else if result.success {
                "step done but completion signal not matched".to_string()
            } else {
                "step failed".to_string()
            },
            token_estimate: Some(token_estimate),
        }).map_err(|e| format!("serialize failed: {e}"))?,
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    Ok((result, profile.id))
}

#[command]
pub async fn workflow_run_step(
    app: AppHandle,
    request: StepRunRequest,
    core_state: State<'_, MaestroCore>,
) -> Result<StepRunResult, String> {
    core_state
        .workflow_run_step(Arc::new(app.clone()), request)
        .await
}

pub async fn workflow_run_step_core(
    emitter: Arc<dyn EventStream>,
    request: StepRunRequest,
    runtime_state: &EngineRuntimeState,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
) -> Result<StepRunResult, String> {
    let total_steps = request.total_steps.max(1);
    let step_index = request.step_index.min(total_steps.saturating_sub(1));
    let (result, profile_id): (WorkflowStepResult, String) = execute_workflow_step(
        emitter.clone(),
        &request.workflow_name,
        &request.step,
        step_index,
        total_steps,
        runtime_state,
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
            }).unwrap_or_default()
        );
    }

    let tokens = estimate_tokens(&request.step.prompt, &result.output);
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
        token_estimate: tokens,
        verification: result.verification,
    })
}

#[command]
pub async fn workflow_run(
    app: AppHandle,
    request: WorkflowRunRequest,
    core_state: State<'_, MaestroCore>,
) -> Result<WorkflowRunResult, String> {
    core_state.workflow_run(Arc::new(app.clone()), request).await
}

pub async fn workflow_run_core(
    emitter: Arc<dyn EventStream>,
    request: WorkflowRunRequest,
    runtime_state: &EngineRuntimeState,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
) -> Result<WorkflowRunResult, String> {
    let workflow_name = request.name.clone();
    let total = request.steps.len();
    if total == 0 {
        return Err("workflow has no steps".to_string());
    }

    // Create Execution at start - it becomes the single source of truth for this run
    let now_ms = current_time_ms().unwrap_or_default();
    let mut execution = Execution::new(
        format!("workflow-{workflow_name}-{now_ms}"),
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
        let (result, profile_id): (WorkflowStepResult, String) = execute_workflow_step(
            emitter.clone(),
            &workflow_name,
            step,
            idx,
            total,
            runtime_state,
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
                }).unwrap_or_default()
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
            engine: runtime_state
                .active_engine_id
                .lock()
                .expect("active_engine lock poisoned")
                .clone()
                .unwrap_or_default(),
            status: "finished".to_string(),
            message: "workflow completed".to_string(),
            token_estimate: None,
        }).unwrap_or_default()
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

    run_result.archive_path = save_archive(&request, &run_result)?;

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
    if let Ok(root) = resolve_root_dir_from_project_path(&cfg.project.path) {
        let _ = append_run_record(&root, &execution);
    }

    Ok(run_result)
}
