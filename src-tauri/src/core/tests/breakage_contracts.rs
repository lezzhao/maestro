use crate::config::{AppConfig, EngineConfig, EngineProfile};
use crate::execution_binding::prepare_execution_binding_with_path;
use crate::task_runtime::{
    resolve_task_runtime_context, ResolvedRuntimeContext, RuntimeResolvedFrom,
};
use crate::task_state;
use std::collections::BTreeMap;
use std::path::PathBuf;

fn temp_db_path() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("test_maestro_state.db");
    (dir, path)
}

fn mock_profile(id: &str) -> EngineProfile {
    EngineProfile {
        id: id.to_string(),
        display_name: id.to_string(),
        command: "test".to_string(),
        args: vec![],
        env: BTreeMap::new(),
        ..Default::default()
    }
}

fn create_test_config() -> AppConfig {
    let mut profiles = BTreeMap::new();
    profiles.insert("default".to_string(), mock_profile("default"));
    profiles.insert("custom".to_string(), mock_profile("custom"));

    let engine = EngineConfig {
        id: "eng1".to_string(),
        plugin_type: "cli".to_string(),
        display_name: "Engine".to_string(),
        icon: "".to_string(),
        profiles: profiles.clone(),
        active_profile_id: "default".to_string(),
        category: None,
        legacy_profile: mock_profile("default"),
    };

    let mut engines = BTreeMap::new();
    engines.insert("eng1".to_string(), engine);

    AppConfig {
        engines,
        ..Default::default()
    }
}

// 1. 验证 Task 无 profile_id 时使用 engine 的第一个 profile 解析（迁移回退已移除）
#[test]
fn breakage_contract_task_without_profile_id_uses_first_profile() {
    let (_dir, db_path) = temp_db_path();
    let cfg = create_test_config();

    let task_id = task_state::create_task(&db_path, "Task", "", "eng1", "{}", None, None, None)
        .expect("create_task")
        .id;

    let _ctx = prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg)
        .expect("prepare_execution_binding");

    task_state::update_task_runtime_snapshot(&db_path, &task_id, None).expect("clear");
    let raw_ctx_no_snap = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");

    assert!(matches!(
        raw_ctx_no_snap.resolved_from,
        RuntimeResolvedFrom::LiveProfile
    ));
    // BTreeMap keys are sorted; "custom" < "default" so first profile is "custom"
    assert_eq!(raw_ctx_no_snap.profile_id.as_deref(), Some("custom"));
}

// 2. 验证并发 binding 篡改场景 (Binding altered while execution is preparing or snapshot exists)
#[test]
fn breakage_contract_binding_tamper_invalidates_snapshot() {
    let (_dir, db_path) = temp_db_path();
    let cfg = create_test_config();

    let task_id = task_state::create_task(
        &db_path,
        "Task",
        "",
        "eng1",
        "{}",
        Some("default"),
        None,
        None,
    )
    .expect("create_task")
    .id;

    let ctx1 =
        prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg).expect("prepare 1");
    let snap_id_1 = ctx1.snapshot_id.clone().unwrap();

    // Update binding, simulating task_runtime_service::update_task_runtime_context
    crate::task_repository::update_task_engine(&db_path, &task_id, "eng1", Some("custom")).unwrap();
    task_state::update_task_runtime_snapshot(&db_path, &task_id, None).unwrap();

    let ctx2 =
        prepare_execution_binding_with_path(&db_path, "exec-2", &task_id, &cfg).expect("prepare 2");

    let snap_id_2 = ctx2.snapshot_id.clone().unwrap();

    assert_ne!(snap_id_1, snap_id_2, "A new snapshot must be generated");
    assert_eq!(ctx2.profile_id.as_deref(), Some("custom"));
}

// 3. 验证旧 snapshot 不会被复用给新 run 当 binding 已发生变化
#[test]
fn breakage_contract_old_snapshot_will_not_leak_to_new_binding() {
    let (_dir, db_path) = temp_db_path();
    let cfg = create_test_config();

    let task_id = task_state::create_task(
        &db_path,
        "Task",
        "",
        "eng1",
        "{}",
        Some("default"),
        None,
        None,
    )
    .expect("create_task")
    .id;

    let _ctx1 = prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg).unwrap();

    crate::task_repository::update_task_engine(&db_path, &task_id, "eng1", Some("custom")).unwrap();
    crate::task_state::update_task_runtime_snapshot(&db_path, &task_id, None).unwrap();

    let binding = crate::task_state::get_task_runtime_binding(&db_path, &task_id)
        .unwrap()
        .unwrap();
    assert!(
        binding.runtime_snapshot_id.is_none(),
        "Snapshot must be entirely detached"
    );

    let raw_ctx = resolve_task_runtime_context(&db_path, &task_id, &cfg).unwrap();
    assert_eq!(raw_ctx.profile_id.as_deref(), Some("custom"));
    assert!(matches!(
        raw_ctx.resolved_from,
        RuntimeResolvedFrom::LiveProfile
    ));
}

// 4. JSON contract: RuntimeResolvedFrom serializes to snake_case; ResolvedRuntimeContext has all execution fields
#[test]
fn breakage_contract_resolved_from_json_snake_case() {
    let ctx = ResolvedRuntimeContext {
        task_id: "t1".to_string(),
        engine_id: "eng1".to_string(),
        profile_id: Some("default".to_string()),
        snapshot_id: None,
        command: "cmd".to_string(),
        args: vec![],
        env: BTreeMap::new(),
        execution_mode: "cli".to_string(),
        model: Some("model".to_string()),
        api_provider: None,
        api_base_url: None,
        api_key: None,
        supports_headless: true,
        headless_args: vec![],
        ready_signal: None,
        exit_command: None,
        exit_timeout_ms: None,
        settings: None,
        system_prompt: None,
        resolved_from: RuntimeResolvedFrom::ConfigFallback,
    };
    let json = serde_json::to_value(&ctx).expect("serialize");
    let resolved_from = json
        .get("resolvedFrom")
        .and_then(|v| v.as_str())
        .expect("resolvedFrom");
    assert_eq!(
        resolved_from, "config_fallback",
        "RuntimeResolvedFrom must serialize to snake_case"
    );
}

#[test]
fn breakage_contract_resolved_runtime_context_json_has_execution_fields() {
    let ctx = ResolvedRuntimeContext {
        task_id: "t1".to_string(),
        engine_id: "eng1".to_string(),
        profile_id: Some("default".to_string()),
        snapshot_id: None,
        command: "cmd".to_string(),
        args: vec!["a".to_string(), "b".to_string()],
        env: BTreeMap::new(),
        execution_mode: "cli".to_string(),
        model: Some("m".to_string()),
        api_provider: Some("openai".to_string()),
        api_base_url: Some("https://api.example.com".to_string()),
        api_key: None,
        supports_headless: true,
        headless_args: vec!["agent".to_string()],
        ready_signal: Some(">".to_string()),
        exit_command: Some("ctrl-c".to_string()),
        exit_timeout_ms: Some(crate::constants::DEFAULT_EXIT_TIMEOUT_MS),
        settings: None,
        system_prompt: None,
        resolved_from: RuntimeResolvedFrom::Snapshot,
    };
    let json = serde_json::to_value(&ctx).expect("serialize");
    assert!(json.get("command").and_then(|v| v.as_str()).is_some());
    assert!(json.get("args").and_then(|v| v.as_array()).is_some());
    assert!(json.get("env").is_some());
    assert!(json.get("executionMode").and_then(|v| v.as_str()).is_some());
    assert!(json.get("model").is_some());
    assert!(json.get("apiProvider").is_some());
    assert!(json.get("apiBaseUrl").is_some());
    assert!(json
        .get("headlessArgs")
        .and_then(|v| v.as_array())
        .is_some());
    assert_eq!(
        json.get("resolvedFrom").and_then(|v| v.as_str()),
        Some("snapshot")
    );
}
