# Migration Fallback Removal Plan

This document defines **executable removal criteria** for migration fallback code. Fallbacks are not permanent; they must be removed once conditions are met.

## Removal Criteria (Must ALL be met)

1. **Telemetry threshold**: For N consecutive releases (e.g. 3), telemetry shows fallback hit rate < X% (e.g. 1%) of `resolve_task_runtime_context` or `resolve_profile_id_for_update` calls.

2. **Task create path**: All `task_create` paths explicitly pass `profile_id` in the request. No caller relies on `engine.active_profile_id` for new tasks.

3. **Contract tests**: Breakage contract tests no longer allow `engine.active_profile_id` to participate in runtime resolution decisions. Tests assert that tasks without `profile_id` fail (or require explicit migration).

4. **Migration script**: A one-time migration script is available and run to backfill `profile_id` for all tasks with empty `profile_id`.

## Target Removal Version

- **Tentative**: Remove after criteria met, in a minor version bump.
- **Checkpoint**: Re-evaluate after each release; log fallback hit count in release notes.

## Removal Checklist

- [ ] Run migration script to backfill task `profile_id`
- [ ] Verify telemetry: fallback hit rate below threshold
- [ ] Update contract tests to disallow fallback
- [ ] Remove `engine.active_profile_id` fallback from `task_runtime::resolve_task_runtime_context_inner`
- [ ] Remove `engine.active_profile_id` fallback from `task_runtime_service::resolve_profile_id_for_update`
- [ ] Remove `engine.active_profile_id` fallback from `task_app_service::task_create`
- [ ] Remove `active_profile_id` auto-set from `config::migrate_engine_profiles` and `engine::config`
- [ ] Remove `engine.active_profile_id` field from `EngineConfig` (breaking change; require migration)

## Out of Scope

- **ConfigFallback** (adhoc execution): Legitimate path for workflow steps and chat without task. Not migration fallback; keep.
