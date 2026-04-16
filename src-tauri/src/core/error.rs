use serde::ser::{Serialize, SerializeStruct, Serializer};
use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub enum CoreError {
    #[error("NotFound: {resource} - {id}")]
    NotFound { resource: String, id: String },

    #[error("EngineUnavailable: {engine_id} - {reason}")]
    EngineUnavailable { engine_id: String, reason: String },

    #[error("SystemError: {message}")]
    SystemError { message: String },

    #[error("ValidationError: {field} - {message}")]
    ValidationError { field: String, message: String },

    #[error("AuthFailed: {engine_id} - {reason}")]
    AuthFailed { engine_id: String, reason: String },

    #[error("ExecutionFailed: {id} - {reason}")]
    ExecutionFailed { id: String, reason: String },

    #[error("CancelFailed: {id} - {reason}")]
    CancelFailed { id: String, reason: String },

    #[error("Io: {message}")]
    Io { message: String },

    #[error("Serialization: {message}")]
    Serialization { message: String },

    #[error("Unsupported: {feature}")]
    Unsupported { feature: String },

    #[error("PermissionDenied: {reason}")]
    PermissionDenied { reason: String },

    #[error("Db: {message}")]
    Db { message: String },

    #[error("QueueFull: {message}")]
    QueueFull { message: String },
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let (code, message) = match self {
            CoreError::NotFound { resource, id } => {
                ("ERR_NOT_FOUND", format!("{} not found: {}", resource, id))
            }
            CoreError::EngineUnavailable { engine_id, reason } => (
                "ERR_ENGINE_UNAVAILABLE",
                format!("Engine {} unavailable: {}", engine_id, reason),
            ),
            CoreError::SystemError { message } => ("ERR_SYSTEM", message.clone()),
            CoreError::ValidationError { field, message } => {
                ("ERR_VALIDATION", format!("Invalid {}: {}", field, message))
            }
            CoreError::AuthFailed { engine_id, reason } => (
                "ERR_AUTH_FAILED",
                format!("Auth failed for {}: {}", engine_id, reason),
            ),
            CoreError::ExecutionFailed { id, reason } => (
                "ERR_EXECUTION_FAILED",
                format!("Execution {} failed: {}", id, reason),
            ),
            CoreError::CancelFailed { id, reason } => (
                "ERR_CANCEL_FAILED",
                format!("Cancel failed for {}: {}", id, reason),
            ),
            CoreError::Io { message } => ("ERR_IO", message.clone()),
            CoreError::Serialization { message } => ("ERR_SERIALIZATION", message.clone()),
            CoreError::Unsupported { feature } => {
                ("ERR_UNSUPPORTED", format!("Unsupported: {}", feature))
            }
            CoreError::PermissionDenied { reason } => ("ERR_PERMISSION_DENIED", reason.clone()),
            CoreError::Db { message } => ("ERR_DB", message.clone()),
            CoreError::QueueFull { message } => ("ERR_QUEUE_FULL", message.clone()),
        };
        let mut state = serializer.serialize_struct("CoreError", 2)?;
        state.serialize_field("code", code)?;
        state.serialize_field("message", &message)?;
        state.end()
    }
}

impl From<std::io::Error> for CoreError {
    fn from(err: std::io::Error) -> Self {
        CoreError::SystemError {
            message: err.to_string(),
        }
    }
}

impl From<String> for CoreError {
    fn from(s: String) -> Self {
        CoreError::SystemError { message: s }
    }
}

impl From<&str> for CoreError {
    fn from(s: &str) -> Self {
        CoreError::SystemError {
            message: s.to_string(),
        }
    }
}
