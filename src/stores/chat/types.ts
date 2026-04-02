import type {
  ChatAttachment,
  ChatMessage,
  Conversation,
  RunArtifact,
  RunEvent,
  TaskRun,
  TaskRunStatus,
  VerificationSummary,
} from "../../types";

export type ChatState = {
  messages: Record<string, ChatMessage[]>;
  pendingAttachments: Record<string, ChatAttachment[]>;
  taskRunning: Record<string, boolean>;
  runsById: Record<string, TaskRun>;
  runOrderByTask: Record<string, string[]>;
  eventsByRun: Record<string, RunEvent[]>;
  transcriptByRun: Record<string, string>;
  artifactsByRun: Record<string, RunArtifact[]>;
  verificationsByRun: Record<string, VerificationSummary | null>;
  activeSessionId: string | null;
  taskActiveRunId: Record<string, string | null>;
  taskActiveAssistantMsgId: Record<string, string | null>;
  taskExecutionPhase: Record<string, "idle" | "connecting" | "sending" | "streaming" | "completed" | "error">;
  orchestrationMode: "direct" | "auto";
  autoRetryCount: number;
  maxAutoRetries: number;

  // Multi-conversation support
  conversationsByTask: Record<string, Conversation[]>;
  activeConversationId: Record<string, string | null>;
  
  // Pending permission (New)
  pendingPermissionRequest: PermissionRequest | null;
};

export type PermissionRequest = {
  requestId: string;
  toolName: string;
  toolInput: string;
  message: string;
};

export type ChatActions = {
  setConversations: (taskId: string, convs: Conversation[]) => void;
  setActiveConversationId: (taskId: string, id: string | null) => void;
  refreshConversations: (taskId: string | null) => Promise<void>;
  switchConversation: (taskId: string | null, conversationId: string | null) => Promise<void>;
  createNewConversation: (taskId: string | null, engineId: string, profileId?: string | null) => Promise<string>;
  deleteConversation: (taskId: string | null, conversationId: string) => Promise<void>;
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;
  generateTitle: (conversationId: string) => Promise<string | null>;

  setActiveRunId: (taskId: string, runId: string | null) => void;
  setActiveAssistantMsgId: (taskId: string, messageId: string | null) => void;
  setExecutionPhase: (taskId: string, phase: "idle" | "connecting" | "sending" | "streaming" | "completed" | "error") => void;

  addMessage: (taskId: string, message: ChatMessage) => void;
  setMessages: (taskId: string, messages: ChatMessage[]) => void;
  updateMessage: (taskId: string, id: string, patch: Partial<ChatMessage>) => void;
  resolveChoice: (taskId: string, messageId: string, optionId: string) => void;
  appendToMessage: (taskId: string, id: string, chunk: string) => void;
  clearMessages: (taskId: string) => void;

  setPendingAttachments: (taskId: string, attachments: ChatAttachment[]) => void;
  addPendingAttachment: (taskId: string, attachment: ChatAttachment) => void;
  addPendingAttachments: (taskId: string, attachments: ChatAttachment[]) => void;
  removePendingAttachment: (taskId: string, path: string) => void;
  clearPendingAttachments: (taskId: string) => void;

  setTaskRunning: (taskId: string, running: boolean) => void;
  createRun: (run: TaskRun) => void;
  updateRun: (runId: string, patch: Partial<TaskRun>) => void;
  finishRun: (runId: string, status: TaskRunStatus, error?: string | null) => void;
  addRunEvent: (runId: string, event: RunEvent) => void;
  appendRunTranscript: (runId: string, content: string) => void;
  addRunArtifact: (runId: string, artifact: RunArtifact) => void;
  setRunVerification: (runId: string, verification: VerificationSummary | null) => void;
  clearTaskRuns: (taskId: string) => void;
  clearRunEvents: (taskId: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setOrchestrationMode: (mode: "direct" | "auto") => void;
  setMaxAutoRetries: (count: number) => void;
  incrementAutoRetry: () => void;
  resetAutoRetry: () => void;
  
  // Permission actions (New)
  setPendingPermissionRequest: (request: PermissionRequest | null) => void;
  resolvePermission: (approved: boolean) => Promise<void>;

  getTaskMessages: (taskId: string | null) => ChatMessage[];
  getTaskPendingAttachments: (taskId: string | null) => ChatAttachment[];
  getTaskRunning: (taskId: string | null) => boolean;
  getTaskRuns: (taskId: string | null) => TaskRun[];
  getLatestRun: (taskId: string | null) => TaskRun | null;
  getTaskRunEvents: (taskId: string | null) => RunEvent[];
  getRunEvents: (runId: string | null) => RunEvent[];
  getRunTranscript: (runId: string | null) => string;
  getRunVerification: (runId: string | null) => VerificationSummary | null;
};

export type ChatStore = ChatState & ChatActions;

export const MAX_MESSAGES = 200;
export const MAX_RUN_EVENTS = 500;
export const MAX_ARTIFACTS = 200;
export const MAX_TRANSCRIPT_LENGTH = 65536;

export const EMPTY_MESSAGES: ChatMessage[] = [];
export const EMPTY_ATTACHMENTS: ChatAttachment[] = [];
export const EMPTY_RUNS: TaskRun[] = [];
export const EMPTY_RUN_EVENTS: RunEvent[] = [];
export const EMPTY_TRANSCRIPT = "";
