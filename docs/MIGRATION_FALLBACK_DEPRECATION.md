# Migration Fallback Deprecation

## Overview

The migration fallback allows the system to resolve runtime context when task or engine configuration is incomplete. It exists for backward compatibility during migration from older data models. **It is deprecated and will be removed.**

## Current Fallback Paths

1. **FallbackProfile** (task_runtime): When a task has no `profile_id`, the system uses `engine.active_profile_id` to resolve the profile. A warning is logged and the resolved `profile_id` is written back to the task (solidify) so subsequent resolves use `LiveProfile`.

2. **ConfigFallback** (execution_binding): When execution is not bound to a task (e.g. workflow steps, ad-hoc chat), runtime context is resolved directly from config. A warning is logged.

3. **resolve_profile_id_for_update** (task_runtime_service): When updating task runtime context without a profile_id, uses `engine.active_profile_id`.

4. **engine_upsert_profile_core** (engine/config): When an engine has no `active_profile_id`, sets it to the profile being upserted.

## Telemetry

All fallback paths emit `tracing::warn!` when triggered. To count fallback hits, grep logs for:

- `migration fallback: task has no profile_id`
- `config fallback: ad-hoc execution without task binding`
- `migration fallback: using engine.active_profile_id for profile_id`
- `migration fallback: engine had no active_profile_id`

## Solidify Behavior

When **FallbackProfile** is hit, the system automatically writes the resolved `profile_id` back to the task. This reduces the chance of hitting fallback again on the next resolve. Task state converges toward task-owned binding over time.

## Deprecation Timeline

| Phase | Action |
|-------|--------|
| **Now** | Telemetry and solidify in place. Fallback remains functional. |
| **Next minor** | Remove fallback execution capability. Migration scripts only. |
| **Future** | Remove fallback code entirely. |

See **MIGRATION_FALLBACK_REMOVAL.md** for executable removal criteria and checklist.

## Scope of Removal

- **In scope**: FallbackProfile, resolve_profile_id_for_update fallback, engine active_profile_id auto-set
- **Out of scope**: ConfigFallback for ad-hoc execution (workflow steps, chat without task) — this is a legitimate path for non-task-bound execution, not migration. The naming may be clarified to avoid confusion.

## Migration Scripts

Before removal, provide migration scripts that:

1. For tasks with empty `profile_id`: set from `engine.active_profile_id` or first profile
2. For engines with empty `active_profile_id`: set from first profile
