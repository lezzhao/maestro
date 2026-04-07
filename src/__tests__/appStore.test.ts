import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri commands
vi.mock("../hooks/commands/task-commands", () => ({
  createTaskCommand: vi.fn(),
  deleteTaskCommand: vi.fn(),
}));

// We need a local import for the store since it uses localStorage
import { useAppStore } from "../stores/appStore";

describe("appStore", () => {
  beforeEach(() => {
    // Reset state before each test
    useAppStore.setState({
      tasks: [],
      activeTaskId: null,
      engines: {
        "test-engine": {
          id: "test-engine",
          display_name: "Test Engine",
          category: "local",
          icon: "bot",
          plugin_type: "cli",
          profiles: {
             "default": { id: "default", display_name: "Default", command: "test", args: [], env: {}, supports_headless: false, headless_args: [] }
          },
          active_profile_id: "default"
        }
      },
      workspaces: []
    });
  });

  it("should add a task correctly", async () => {
    const store = useAppStore.getState();
    const { createTaskCommand } = await import("../hooks/commands/task-commands");
    (createTaskCommand as any).mockResolvedValue({ id: "123", name: "Test Task" });
    
    await store.addTask("Test Task");
    
    expect(createTaskCommand).toHaveBeenCalledWith(expect.objectContaining({
      title: "Test Task"
    }));
  });

  it("should update task view state", () => {
    useAppStore.setState({
      tasks: [{ id: "task1", name: "Task 1", engineId: "e1", status: "idle", created_at: Date.now(), updated_at: Date.now(), gitChanges: [], stats: { cpu_percent: 0, memory_mb: 0, approx_input_tokens: 0, approx_output_tokens: 0 } }] as unknown as any
    });
    
    const store = useAppStore.getState();
    store.updateTaskRecord("task1", { status: "running" });
    
    const updated = useAppStore.getState().tasks.find(t => t.id === "task1");
    expect(updated?.status).toBe("running");
  });

  it("should handle workspace operations", () => {
    const store = useAppStore.getState();
    const mockWS = { id: "ws1", name: "Workspace 1", createdAt: Date.now(), updatedAt: Date.now() };
    
    store.addWorkspace(mockWS as unknown as any);
    expect(useAppStore.getState().workspaces).toHaveLength(1);
    expect(useAppStore.getState().activeWorkspaceId).toBe("ws1");
    
    store.removeWorkspace("ws1");
    expect(useAppStore.getState().workspaces).toHaveLength(0);
    expect(useAppStore.getState().activeWorkspaceId).toBeNull();
  });
});
