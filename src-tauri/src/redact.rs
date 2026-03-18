//! Sensitive data redaction for logs and persistence.
//! Prevents API keys and tokens from being written to disk or logs.

use once_cell::sync::Lazy;
use regex::Regex;

static SK_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"sk-[a-zA-Z0-9\-_]{20,}").expect("redact sk- pattern")
});

static BEARER_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"Bearer\s+[a-zA-Z0-9\-_.]+").expect("redact Bearer pattern")
});

/// Redact sensitive patterns in text. Replaces matches with [REDACTED].
pub fn redact_sensitive(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut out = text.to_string();
    for re in [&*SK_PATTERN, &*BEARER_PATTERN] {
        out = re.replace_all(&out, "[REDACTED]").to_string();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_sk_prefix() {
        let s = "key is sk-abc123def456ghi789jkl012";
        assert_eq!(redact_sensitive(s), "key is [REDACTED]");
    }

    #[test]
    fn redacts_bearer() {
        let s = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        assert!(redact_sensitive(s).contains("[REDACTED]"));
        assert!(!redact_sensitive(s).contains("eyJ"));
    }

    #[test]
    fn leaves_safe_text() {
        let s = "hello world";
        assert_eq!(redact_sensitive(s), "hello world");
    }
}
