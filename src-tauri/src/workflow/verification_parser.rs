use once_cell::sync::Lazy;
use regex::Regex;

use super::types::{TestRunSummary, TestSuiteResult, VerificationSummary};

// ── Pre-compiled Regex (compiled once, reused globally) ──────────────

static RE_PASSED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(\d+)\s+passed\b").expect("regex must compile"));
static RE_FAILED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(\d+)\s+failed\b").expect("regex must compile"));
static RE_SKIPPED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(\d+)\s+(skipped|todo|pending)\b").expect("regex must compile"));
static RE_TOTAL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(\d+)\s+total\b").expect("regex must compile"));
static RE_SUITE_PASSED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)test suites?:\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+total)?")
        .expect("regex must compile")
});
static RE_GENERIC_SUITE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(\d+)\s+(passed|failed)\s+\([0-9.]+s?\)").expect("regex must compile"));

// ── Test output parsing ─────────────────────────────────────────────

fn last_match(re: &Regex, output: &str) -> usize {
    re.captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0)
}

pub(crate) fn parse_case_counts(output: &str) -> (usize, usize, usize, usize) {
    let passed = last_match(&RE_PASSED, output);
    let failed = last_match(&RE_FAILED, output);
    let skipped = last_match(&RE_SKIPPED, output);
    let mut total = last_match(&RE_TOTAL, output);
    if total == 0 {
        total = passed + failed + skipped;
    }
    (total, passed, failed, skipped)
}

pub(crate) fn parse_suite_counts(output: &str) -> (usize, usize, usize) {
    if let Some(cap) = RE_SUITE_PASSED.captures(output) {
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
    let mut passed = 0;
    let mut failed = 0;
    for cap in RE_GENERIC_SUITE.captures_iter(output) {
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

pub(crate) fn detect_framework(output: &str) -> Option<String> {
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

pub(crate) fn extract_verification_summary(
    output: &str,
    step_success: bool,
    duration_ms: u128,
    i18n: &crate::i18n::I18n,
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
                raw_summary: Some(i18n.t("test_no_structured")),
            }),
            source: Some("text-parser".to_string()),
            notes: Some(i18n.t("check_raw_output")),
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

pub(crate) fn merge_verification_summary(
    step_results: &[super::types::WorkflowStepResult],
) -> Option<VerificationSummary> {
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
