import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(void 0),
}));

import { useChatStore } from "../stores/chatStore";

describe("chatStore", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: {},
      pendingPermissionRequest: null,
      conversationsByTask: {},
    });
  });

  it("should set pending permission request", () => {
    const mockReq = { requestId: "req1", toolName: "test_tool", toolInput: "{}", createdAt: Date.now() };
    
    useChatStore.getState().setPendingPermissionRequest(mockReq as unknown as any);
    expect(useChatStore.getState().pendingPermissionRequest?.requestId).toBe("req1");
  });

  it("should resolve permission and call backend", async () => {
    const mockReq = { requestId: "req2", toolName: "write_file", toolInput: '{"path":"foo"}', createdAt: Date.now() };
    
    useChatStore.setState({ pendingPermissionRequest: mockReq as unknown as any });
    
    await useChatStore.getState().resolvePermission(true);
    
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("chat_resolve_pending_tool", {
      request_id: "req2",
      approved: true
    });
    
    expect(useChatStore.getState().pendingPermissionRequest).toBeNull();
  });

  it("should manage message state", () => {
    const store = useChatStore.getState();
    const msg = { id: "m1", role: "user", content: "hello", timestamp: Date.now() };
    
    (store as unknown as any).addMessage("task1", msg);
    
    const messages = useChatStore.getState().getTaskMessages("task1");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hello");
  });
});
