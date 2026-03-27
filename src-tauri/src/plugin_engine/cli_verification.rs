use crate::workflow::types::{TestRunSummary, TestSuiteResult, VerificationSummary};

fn parse_case_counts(output: &str) -> (usize, usize, usize, usize) {
    let passed_re = regex::Regex::new(r"(?i)\b(\d+)\s+passed\b").expect("regex must compile");
    let failed_re = regex::Regex::new(r"(?i)\b(\d+)\s+failed\b").expect("regex must compile");
    let skipped_re =
        regex::Regex::new(r"(?i)\b(\d+)\s+(skipped|todo|pending)\b").expect("regex must compile");
    let total_re = regex::Regex::new(r"(?i)\b(\d+)\s+total\b").expect("regex must compile");
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

pub fn extract_verification_summary(output: &str) -> Option<VerificationSummary> {
    let framework = detect_framework(output)?;
    let (total_cases, passed_cases, failed_cases, skipped_cases) = parse_case_counts(output);
    let success = failed_cases == 0;
    Some(VerificationSummary {
        has_verification: true,
        test_run: Some(TestRunSummary {
            framework,
            success,
            total_suites: 0,
            passed_suites: 0,
            failed_suites: 0,
            total_cases,
            passed_cases,
            failed_cases,
            skipped_cases,
            duration_ms: None,
            suites: vec![TestSuiteResult {
                name: "chat-exec".to_string(),
                total_cases,
                passed_cases,
                failed_cases,
                skipped_cases,
                duration_ms: None,
                cases: vec![],
            }],
            raw_summary: None,
        }),
        source: Some("chat-exec-parser".to_string()),
        notes: None,
    })
}
