use serde::ser::{Serialize, SerializeStruct, Serializer};
use std::fmt;

#[derive(Debug, Clone)]
pub enum CoreError {
    NotFound(String),
    EngineUnavailable(String),
    SystemError(String),
    ValidationError(String),
    AuthFailed(String),
    ExecutionFailed(String),
    CancelFailed(String),
    Io(String),
    Serialization(String),
    Unsupported(String),
    PermissionDenied(String),
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let (code, message) = match self {
            CoreError::NotFound(m) => ("ERR_NOT_FOUND", m),
            CoreError::EngineUnavailable(m) => ("ERR_ENGINE_UNAVAILABLE", m),
            CoreError::SystemError(m) => ("ERR_SYSTEM", m),
            CoreError::ValidationError(m) => ("ERR_VALIDATION", m),
            CoreError::AuthFailed(m) => ("ERR_AUTH_FAILED", m),
            CoreError::ExecutionFailed(m) => ("ERR_EXECUTION_FAILED", m),
            CoreError::CancelFailed(m) => ("ERR_CANCEL_FAILED", m),
            CoreError::Io(m) => ("ERR_IO", m),
            CoreError::Serialization(m) => ("ERR_SERIALIZATION", m),
            CoreError::Unsupported(m) => ("ERR_UNSUPPORTED", m),
            CoreError::PermissionDenied(m) => ("ERR_PERMISSION_DENIED", m),
        };
        let mut state = serializer.serialize_struct("CoreError", 2)?;
        state.serialize_field("code", code)?;
        state.serialize_field("message", message)?;
        state.end()
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::NotFound(m) => write!(f, "NotFound: {}", m),
            CoreError::EngineUnavailable(m) => write!(f, "EngineUnavailable: {}", m),
            CoreError::SystemError(m) => write!(f, "SystemError: {}", m),
            CoreError::ValidationError(m) => write!(f, "ValidationError: {}", m),
            CoreError::AuthFailed(m) => write!(f, "AuthFailed: {}", m),
            CoreError::ExecutionFailed(m) => write!(f, "ExecutionFailed: {}", m),
            CoreError::CancelFailed(m) => write!(f, "CancelFailed: {}", m),
            CoreError::Io(m) => write!(f, "Io: {}", m),
            CoreError::Serialization(m) => write!(f, "Serialization: {}", m),
            CoreError::Unsupported(m) => write!(f, "Unsupported: {}", m),
            CoreError::PermissionDenied(m) => write!(f, "PermissionDenied: {}", m),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<std::io::Error> for CoreError {
    fn from(err: std::io::Error) -> Self {
        CoreError::SystemError(err.to_string())
    }
}

impl From<String> for CoreError {
    fn from(s: String) -> Self {
        CoreError::SystemError(s)
    }
}

impl From<&str> for CoreError {
    fn from(s: &str) -> Self {
        CoreError::SystemError(s.to_string())
    }
}
