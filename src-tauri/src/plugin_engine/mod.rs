pub mod action_guard;
pub mod api_chat_runner;
pub mod cli_chat_runner;
pub mod cli_output_forwarder;
pub mod cli_verification;
pub mod maestro_engine;

use std::fmt;

/// 插件引擎层统一错误类型，替代裸 String。
/// 实现 Display 以便在边界处直接转为 CoreError 或日志输出。
#[derive(Debug, Clone)]
pub enum EngineError {
    /// 配置缺失或无效（API Key 未填、model 为空等）
    Config(String),
    /// 命令执行失败（spawn、IO 等）
    Execution(String),
    /// 安全策略拦截
    PermissionDenied(String),
    /// 其他未分类错误
    Other(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(msg) => write!(f, "{msg}"),
            Self::Execution(msg) => write!(f, "{msg}"),
            Self::PermissionDenied(msg) => write!(f, "{msg}"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<String> for EngineError {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

impl From<EngineError> for String {
    fn from(e: EngineError) -> Self {
        e.to_string()
    }
}
