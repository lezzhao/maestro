//! Sensitive data redaction for logs and persistence.
//! Prevents API keys and tokens from being written to disk or logs.

use once_cell::sync::Lazy;
use regex::Regex;

static SK_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"sk-[a-zA-Z0-9\-_]{20,}").expect("redact sk- pattern"));

static BEARER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Bearer\s+[a-zA-Z0-9\-_.]+").expect("redact Bearer pattern"));

static GEMINI_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"AIzaSy[a-zA-Z0-9\-_]{30,}").expect("redact gemini pattern"));

static AWS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}").expect("redact aws pattern"));


/// Redact sensitive patterns in text. Replaces matches with [REDACTED].
pub fn redact_sensitive(text: &str, extra_sensitive: Option<&[String]>) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut out = text.to_string();
    
    // 1. Redact Regex Patterns
    for re in [&*SK_PATTERN, &*BEARER_PATTERN, &*GEMINI_PATTERN, &*AWS_PATTERN] {
        out = re.replace_all(&out, "[REDACTED]").to_string();
    }

    // 2. Redact Extra Sensitive Strings (e.g. from config)
    if let Some(extras) = extra_sensitive {
        for s in extras {
            if s.len() < 5 { continue; } // Ignore very short strings to avoid false positives
            out = out.replace(s, "[REDACTED]");
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_sk_prefix() {
        let s = "key is sk-abc123def456ghi789jkl012";
        assert_eq!(redact_sensitive(s, None), "key is [REDACTED]");
    }

    #[test]
    fn redacts_bearer() {
        let s = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        assert!(redact_sensitive(s, None).contains("[REDACTED]"));
        assert!(!redact_sensitive(s, None).contains("eyJ"));
    }

    #[test]
    fn leaves_safe_text() {
        let s = "hello world";
        assert_eq!(redact_sensitive(s, None), "hello world");
    }
}
