pub mod context;
pub mod executor;
pub mod stream;
pub mod cost;
pub mod provider;

use crate::agent_state::{AppEventHandle, AgentStateUpdate};
use crate::core::events::StringStream;
use crate::core::MaestroCore;
use crate::plugin_engine::control_frame::{AgentPhase, ControlFrame, AgentLifecycle};
use crate::plugin_engine::maestro_engine::ApiChatRequest;
use crate::plugin_engine::EngineError;
use crate::tools::ToolCall;
use crate::plugin_engine::orchestrator::provider::LlmProvider;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

use self::context::ContextManager;
use self::executor::ToolExecutor;
use self::stream::ToolInterceptStream;


/// 统一事件总线，整合流输出与持久化状态。
struct AgentEventBus {
    pub(crate) event_handle: Arc<dyn AppEventHandle>,
    pub(crate) on_data: Arc<dyn StringStream>,
    pub(crate) task_id: Option<String>,
    pub(crate) state_token: Option<String>,
    pub(crate) i18n: crate::i18n::I18n,
}

impl AgentEventBus {
    fn new(event_handle: Arc<dyn AppEventHandle>, on_data: Arc<dyn StringStream>, task_id: Option<String>, state_token: Option<String>, i18n: crate::i18n::I18n) -> Self {
        Self { event_handle, on_data, task_id, state_token, i18n }
    }

    fn dispatch_lifecycle(&self, event: AgentLifecycle) {
        match event {
            AgentLifecycle::StepStarted { step, cost } => {
                let msg = if matches!(self.i18n.t("lang"), _z if _z == "ZH") {
                    format!("正在启动第 {} 步循环... (累计成本: ${:.4})", step, cost)
                } else {
                    format!("Starting loop step {}... (Total cost: ${:.4})", step, cost)
                };
                self.dispatch_trace(msg);
            }
            AgentLifecycle::Thinking => {
                self.dispatch_control(ControlFrame::Phase(AgentPhase::Thinking));
            }
            AgentLifecycle::ExecutingTools { count } => {
                let msg = if matches!(self.i18n.t("lang"), _z if _z == "ZH") {
                    format!("识别到 {} 个工具请求，正在并行执行...", count)
                } else {
                    format!("Identified {} tool requests, executing in parallel...", count)
                };
                self.dispatch_trace(msg);
                self.dispatch_control(ControlFrame::Phase(AgentPhase::ExecutingTool));
            }
            AgentLifecycle::BudgetExceeded { cost } => {
                let msg = if matches!(self.i18n.t("lang"), _z if _z == "ZH") {
                    format!("已达到预算阈值 (${:.2})，正在熔断停止...", cost)
                } else {
                    format!("Budget threshold reached (${:.2}), circuit breaking...", cost)
                };
                self.dispatch_trace(msg);
            }
            AgentLifecycle::MaxIterationsReached => {
                let msg = if matches!(self.i18n.t("lang"), _z if _z == "ZH") {
                    "达到 25 步迭代上限，强制熔断安全退出。".to_string()
                } else {
                    "Max iteration limit (25) reached, circuit breaking for safety.".to_string()
                };
                self.dispatch_trace(msg);
                let hint = if matches!(self.i18n.t("lang"), _z if _z == "ZH") {
                    "最大迭代次数已达到 (25)。"
                } else {
                    "Max iterations reached (25)."
                };
                self.dispatch_control(ControlFrame::Notice(hint.to_string()));
            }
            AgentLifecycle::Finalizing => {
                let msg = if matches!(self.i18n.t("lang"), _z if _z == "ZH") {
                    "执行循环已正常结束。正在收尾..."
                } else {
                    "Execution loop finished normally. Finalizing..."
                };
                self.dispatch_trace(msg.to_string());
            }
            AgentLifecycle::Completed => {
                self.dispatch_control(ControlFrame::Phase(AgentPhase::Completed));
            }
        }
    }

    fn dispatch_control(&self, frame: ControlFrame) {
        let _ = self.on_data.send_string(frame.serialize());
    }

    fn dispatch_trace(&self, msg: String) {
        if let Some(tid) = &self.task_id {
            self.event_handle.emit_state_update_with_token(AgentStateUpdate::Trace {
                task_id: tid.clone(),
                content: msg.clone(),
            }, self.state_token.clone());
        }
        let _ = self.on_data.send_string(ControlFrame::Trace(msg).serialize());
    }
}
pub struct AgentOrchestrator {
    core: Arc<MaestroCore>,
    cancel_token: CancellationToken,
    context: ContextManager,
    executor: ToolExecutor,
    request: ApiChatRequest,
    provider: Box<dyn LlmProvider>,
    cumulative_cost: Arc<Mutex<f64>>,
    bus: AgentEventBus,
}

impl AgentOrchestrator {
    /// 准备运行环境：构建工具箱、组装上下文、初始化成本追踪。
    pub async fn prepare(
        event_handle: Arc<dyn AppEventHandle>,
        core: Arc<MaestroCore>,
        request: ApiChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Result<Self, EngineError> {
        let root_path_str = core.config.get().project.path.clone();
        let root = if root_path_str.trim().is_empty() {
            std::env::current_dir().unwrap_or_default()
        } else {
            std::path::PathBuf::from(root_path_str)
        };

        let toolbox = Arc::new(core.tool_registry.build_toolbox(root.clone(), request.task_id.clone()).await
            .map_err(|e| EngineError::Execution(format!("Registry Error: {e}")))?);

        let (harness_mode, strategic_plan) = if let Some(task_id) = &request.task_id {
            if let Ok(session) = core.harness_mgr.get_or_create_session(task_id) {
                (Some(session.current_mode), session.strategic_plan)
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        let cfg_snapshot = core.config.get();
        let context = ContextManager::from_request(&request, root, &cfg_snapshot, harness_mode, strategic_plan).await;
        let executor = ToolExecutor::new(event_handle.clone(), core.clone(), toolbox, cancel_token.clone(), request.state_token.clone());

        let cumulative_cost = Arc::new(Mutex::new(0.0));
        let bus = AgentEventBus::new(event_handle, on_data, request.task_id.clone(), request.state_token.clone(), cfg_snapshot.i18n());
        let provider = provider::create_provider(&request.provider);

        let orchestrator = Self {
            core,
            cancel_token,
            context,
            executor,
            request,
            provider,
            cumulative_cost,
            bus,
        };

        // 5. Side Effects: Emit started events and persist initial messages (Removes patchy logic from workflow layer)
        orchestrator.emit_started_events();
        orchestrator.persist_initial_messages();

        Ok(orchestrator)
    }

    fn emit_started_events(&self) {
        if let Some(tid) = &self.request.task_id {
            let run_id = self.request.run_id.clone().unwrap_or_else(|| format!("run-{}", uuid::Uuid::new_v4()));
            
            self.bus.event_handle.emit_state_update_with_token(AgentStateUpdate::ExecutionStarted {
                task_id: tid.clone(),
                run_id: run_id.clone(),
                cycle_id: self.request.cycle_id.clone().unwrap_or_default(),
                mode: "api".to_string(),
            }, self.request.state_token.clone());

            let now_ms = chrono::Utc::now().timestamp_millis();
            let run_payload = crate::agent_state::task_run_from_execution(
                &run_id,
                tid,
                &self.request.provider,
                "api",
                now_ms,
            );
            
            self.bus.event_handle.emit_state_update_with_token(AgentStateUpdate::RunCreated {
                task_id: tid.clone(),
                run: run_payload,
            }, self.request.state_token.clone());
        }
    }

    fn persist_initial_messages(&self) {
        if let (Some(conv_id), Ok(db_path)) = (&self.request.conversation_id, crate::task::state::maestro_db_path_core()) {
            if let Some(last_user_msg) = self.request.messages.iter().rev().find(|m| m.role == "user") {
                let now_ms = chrono::Utc::now().timestamp_millis();
                let _ = crate::storage::conversation::upsert_message(
                    &db_path,
                    conv_id,
                    &crate::agent_state::PersistedMessagePayload {
                        id: uuid::Uuid::new_v4().to_string(),
                        role: "user".to_string(),
                        content: last_user_msg.content.clone(),
                        timestamp: Some(now_ms),
                        status: Some("done".into()),
                        attachments: None,
                        reasoning: None,
                        meta: None,
                    },
                );
            }
        }
    }

    pub async fn run(&mut self) -> Result<String, EngineError> {
        let mut iterations_left = 25;
        let mut final_text = String::new();
        let mut accumulated_reasoning = String::new();

        while iterations_left > 0 {
            let current_step = 26 - iterations_left;
            let cost = *self.cumulative_cost.lock().unwrap();
            self.bus.dispatch_lifecycle(AgentLifecycle::StepStarted { step: current_step, cost });
            
            if cost > 2.0 { // Increased budget limit for heavy tasks
                 self.bus.dispatch_lifecycle(AgentLifecycle::BudgetExceeded { cost });
                 return Err(EngineError::Execution("达到安全预算限额 ($2.0)".into()));
            }

            iterations_left -= 1;
            
            let (current_text, tool_calls, reasoning) = self.generate_completion().await?;
            
            if let Some(r) = reasoning {
                accumulated_reasoning.push_str(&r);
            }
            final_text.push_str(&current_text);

            // Persist progress after each turn (incremental consistency)
            self.persist_completion(
                final_text.clone(), 
                if accumulated_reasoning.is_empty() { None } else { Some(accumulated_reasoning.clone()) }
            ).await;

            if tool_calls.is_empty() {
                break;
            }

            self.process_tool_calls(current_text, tool_calls).await?;

            if self.cancel_token.is_cancelled() {
                break;
            }

            if iterations_left == 0 {
                self.bus.dispatch_lifecycle(AgentLifecycle::MaxIterationsReached);
                return Err(EngineError::Execution("达到最大迭代次数 (25)".into()));
            }
        }

        self.bus.dispatch_lifecycle(AgentLifecycle::Finalizing);
        self.finalize().await;
        Ok(final_text)
    }

    async fn generate_completion(&mut self) -> Result<(String, Vec<ToolCall>, Option<String>), EngineError> {
        self.context.ensure_window_safety(&self.core.config.get());
        self.bus.dispatch_lifecycle(AgentLifecycle::Thinking);
        let interceptor = Arc::new(ToolInterceptStream::new(
            self.bus.event_handle.clone(),
            self.request.task_id.clone(),
            self.bus.on_data.clone(),
            self.cumulative_cost.clone(),
            self.request.model.clone(),
            vec![self.request.api_key.clone()],
            self.request.state_token.clone(),
        ));
        
        if let Some(msg_id) = self.core.get_active_assistant_msg_id(self.request.task_id.as_deref()) {
            interceptor.set_message_id(msg_id);
        }

        let tool_defs = self.executor.toolbox.get_definitions();

        self.provider.stream_chat(
            &self.request.base_url,
            &self.request.api_key,
            &self.request.model,
            &self.context.messages,
            Some(&tool_defs),
            Some(self.context.system_prompt.clone()),
            self.cancel_token.clone(),
            &(interceptor.clone() as Arc<dyn StringStream>),
        )
        .await?;

        Ok((interceptor.take_accumulated_text(), interceptor.take_tool_calls(), interceptor.get_reasoning()))
    }

    async fn persist_completion(&self, content: String, reasoning: Option<String>) {
        if let (Some(conv_id), Ok(db_path)) = (&self.request.conversation_id, crate::task::state::maestro_db_path_core()) {
             let _ = crate::storage::conversation::upsert_message(
                    &db_path,
                    conv_id,
                    &crate::agent_state::PersistedMessagePayload {
                        id: self.request.assistant_message_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                        role: "assistant".to_string(),
                        content,
                        timestamp: Some(chrono::Utc::now().timestamp_millis()),
                        status: Some("done".into()),
                        attachments: None,
                        reasoning,
                        meta: None,
                    },
                );
        }
    }

    async fn process_tool_calls(&mut self, assistant_text: String, tool_calls: Vec<ToolCall>) -> Result<(), EngineError> {
        let call_count = tool_calls.len();
        self.bus.dispatch_lifecycle(AgentLifecycle::ExecutingTools { count: call_count });
        
        self.context.add_assistant_message(assistant_text, Some(tool_calls.clone()), &self.core.config.get());
        let mut futures = Vec::new();
        for tc in &tool_calls {
            let task_id = self.request.task_id.clone();
            let executor = &self.executor;
            futures.push(async move {
                let output = executor.execute(task_id, tc).await;
                (tc.id.clone(), output)
            });
        }

        let results = futures::future::join_all(futures).await;

        for (id, result) in results {
            let output = result?;
            self.context.register_tool_result(&id, &output, &self.core.config.get());
        }

        Ok(())
    }

    async fn finalize(&self) {
        if let Ok(db_path) = crate::task::state::maestro_db_path_core() {
            let last_msg = self.context.messages.last().map(|m| &m.content).cloned().unwrap_or_default();
            
            // 1. Auto-Memory Extraction (Triple-Filter Gate)
            //    Only memorize substantive interactions, not routine acks.
            let tool_call_count = self.context.messages.iter()
                .filter(|m| m.role == "tool")
                .count();
            let is_canned_ack = last_msg.starts_with("好的")
                || last_msg.starts_with("OK")
                || last_msg.starts_with("Sure")
                || last_msg.starts_with("已完成")
                || last_msg.starts_with("Done");
            let should_memorize = last_msg.len() > 200
                && !is_canned_ack
                && tool_call_count >= 2;

            if should_memorize {
                let _ = crate::storage::memory::create_memory(
                    &db_path,
                    self.request.task_id.as_deref(),
                    &last_msg,
                    "auto-extracted",
                    None,
                );
            }

        }
        self.bus.dispatch_lifecycle(AgentLifecycle::Completed);
    }
}

// Interceptor was moved to stream.rs
