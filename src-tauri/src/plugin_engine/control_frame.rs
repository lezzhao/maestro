use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    Thinking,
    ExecutingTool,
    Completed,
}

/// Agent 运行时的生命周期阶段，统一映射为控制帧或系统追踪。
#[derive(Debug, Clone)]
pub enum AgentLifecycle {
    StepStarted { step: usize, cost: f64 },
    Thinking,
    ExecutingTools { count: usize },
    BudgetExceeded { cost: f64 },
    MaxIterationsReached,
    Finalizing,
    Completed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControlFrame {
    Phase(AgentPhase),
    Notice(String),
    Trace(String),     // Internal execution trace / monologue
}

impl ControlFrame {
    pub const PREFIX: &'static str = "\u{0000}";

    pub fn serialize(&self) -> String {
        match self {
            Self::Phase(phase) => {
                let p_str = match phase {
                    AgentPhase::Thinking => "thinking",
                    AgentPhase::ExecutingTool => "executing_tool",
                    AgentPhase::Completed => "completed",
                };
                format!("{}PHASE:{}", Self::PREFIX, p_str)
            }
            Self::Notice(msg) => {
                format!("{}NOTICE:{}", Self::PREFIX, msg)
            }
            Self::Trace(msg) => {
                format!("{}TRACE:{}", Self::PREFIX, msg)
            }
        }
    }
}
