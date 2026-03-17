import { describe, expect, it } from "vitest";
import { resolveTaskRuntimeContextFromState } from "./useTaskRuntimeContext";
import type { AppTask, EngineConfig, EnginePreflightResult } from "../types";

function mockEngine(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    id: "cursor",
    plugin_type: "cli",
    display_name: "Cursor",
    profiles: {
      default: {
        id: "default",
        display_name: "Default",
        command: "cursor",
        args: [],
        env: {},
        supports_headless: true,
        headless_args: [],
        execution_mode: "cli",
      },
      review: {
        id: "review",
        display_name: "Review",
        command: "cursor",
        args: [],
        env: {},
        supports_headless: true,
        headless_args: [],
        execution_mode: "api",
      },
    },
    active_profile_id: "default",
    command: "cursor",
    args: [],
    env: {},
    exit_command: "ctrl-c",
    exit_timeout_ms: 3000,
    supports_headless: true,
    headless_args: [],
    icon: "",
    ...overrides,
  };
}

function mockTask(overrides?: Partial<AppTask>): AppTask {
  return {
    id: "t1",
    name: "Task 1",
    engineId: "cursor",
    profileId: null,
    status: "idle",
    gitChanges: [],
    stats: {
      cpu_percent: 0,
      memory_mb: 0,
      approx_input_tokens: 0,
      approx_output_tokens: 0,
    },
    created_at: Date.now(),
    updated_at: Date.now(),
    sessionId: null,
    ...overrides,
  };
}

function mockPreflight(ok = true): Record<string, EnginePreflightResult> {
  return {
    cursor: {
      engine_id: "cursor",
      command_exists: ok,
      auth_ok: ok,
      supports_headless: true,
      notes: ok ? "ready" : "not ready",
    },
  };
}

describe("resolveTaskRuntimeContextFromState", () => {
  it("uses authoritative backend resolution if resolvedRuntimeContext is provided", () => {
    const engines: Record<string, EngineConfig> = {
      cursor: mockEngine({ active_profile_id: "default" }),
    };
    const task = mockTask({
      profileId: "default",
      resolvedRuntimeContext: {
        taskId: "t1",
        engineId: "cursor",
        profileId: "review", // The backend says review, even if task entity says default
        command: "cursor",
        args: [],
        env: {},
        executionMode: "api",
        supportsHeadless: true,
        resolvedFrom: "Snapshot"
      }
    });

    const result = resolveTaskRuntimeContextFromState(
      task,
      engines,
      mockPreflight(),
    );
    expect(result.profileId).toBe("review");
    expect(result.profile?.id).toBe("review");
    expect(result.executionMode).toBe("api");
  });

  it("returns task.profileId when it differs from engine.active_profile_id and is valid (fallback logic)", () => {
    const engines: Record<string, EngineConfig> = {
      cursor: mockEngine({ active_profile_id: "default" }),
    };
    const task = mockTask({ profileId: "review" });
    const result = resolveTaskRuntimeContextFromState(
      task,
      engines,
      mockPreflight(),
    );
    expect(result.profileId).toBe("review");
    expect(result.profile?.id).toBe("review");
    expect(result.executionMode).toBe("api");
  });

  it("falls back to engine.active_profile_id when task has no profileId (fallback logic)", () => {
    const engines: Record<string, EngineConfig> = {
      cursor: mockEngine({ active_profile_id: "review" }),
    };
    const task = mockTask({ profileId: null });
    const result = resolveTaskRuntimeContextFromState(
      task,
      engines,
      mockPreflight(),
    );
    expect(result.profileId).toBe("review");
    expect(result.profile?.id).toBe("review");
  });

  it("falls back to first profile when task.profileId is invalid (deleted) (fallback logic)", () => {
    const engines: Record<string, EngineConfig> = {
      cursor: mockEngine({ active_profile_id: "default" }),
    };
    const task = mockTask({ profileId: "deleted_profile" });
    const result = resolveTaskRuntimeContextFromState(
      task,
      engines,
      mockPreflight(),
    );
    expect(result.profileId).toBe("default");
    expect(result.profile?.id).toBe("default");
  });

  it("returns default when activeTask is null", () => {
    const result = resolveTaskRuntimeContextFromState(
      null,
      { cursor: mockEngine() },
      mockPreflight(),
    );
    expect(result.engineId).toBe("");
    expect(result.profileId).toBe(null);
    expect(result.isReady).toBe(false);
  });

  it("returns default when engines is null", () => {
    const result = resolveTaskRuntimeContextFromState(
      mockTask(),
      null,
      mockPreflight(),
    );
    expect(result.engineId).toBe("");
    expect(result.profileId).toBe(null);
  });
});
