import { TokenEstimate } from "./workflow";

export type ChatAttachment = {
  name: string;
  path: string;
  mime_type?: string;
  data?: string; // Base64
  snippet?: string;
};

export type ChoiceVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "primary-gradient";

export type ChatChoiceAction =
  | {
      kind: "open_settings";
    }
  | {
      kind: "switch_execution_mode";
      mode: "api" | "cli";
    }
  | {
      kind: "open_external_url";
      url: string;
    }
  | {
      kind: "resolve_pending_tool";
      requestId: string;
      approved: boolean;
    };

export type ChatChoiceOption = {
  id: string;
  label: string;
  description?: string;
  variant?: ChoiceVariant;
  action: ChatChoiceAction;
};

export type ChatChoicePayload = {
  title: string;
  description?: string;
  options: ChatChoiceOption[];
  status?: "pending" | "resolved";
  selectedOptionId?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "plan";
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  status?: "streaming" | "done" | "error";
  tokenEstimate?: TokenEstimate;
  durationMs?: number;
  reasoning?: string;
  meta?: {
    auto?: boolean;
    engineId?: string;
    profileId?: string;
    eventType?: "status" | "tool" | "notice";
    eventStatus?: "pending" | "done" | "error";
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    choice?: ChatChoicePayload;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  };
};

export type ChatSpawnRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  conversation_id?: string | null;
  cols?: number;
  rows?: number;
};

export type ChatSendRequest = {
  session_id: string;
  content: string;
  append_newline?: boolean;
};

export type ChatStopRequest = {
  session_id: string;
};

export type ChatSessionMeta = {
  session_id: string;
  task_id?: string | null;
  engine_id: string;
  profile_id: string;
  ready_signal?: string | null;
};

export type ChatApiAttachment = {
  name: string;
  path: string;
  mime_type: string;
  data: string; // Base64 encoded data
};

export type ChatApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: ChatApiAttachment[];
};

export type ChatApiRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  conversation_id?: string | null;
  message_ids?: string[];
  messages?: ChatApiMessage[];
  pinned_files?: string[];
  max_input_tokens?: number;
  max_messages?: number;
  assistant_message_id?: string;
};

export type ChatExecuteApiResult = {
  exec_id: string;
  run_id: string;
  engine_id: string;
  profile_id: string;
};

export type ChatExecuteCliRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  prompt: string;
  is_continuation: boolean;
};

export type ChatExecuteCliResult = {
  exec_id: string;
  run_id: string;
  pid?: number | null;
  engine_id: string;
  profile_id: string;
};

export type ChatExecuteStopRequest = {
  exec_id: string;
};

export type ChatSubmitChoiceRequest = {
  task_id: string;
  message_id: string;
  option_id: string;
  option_label: string;
};

export type Conversation = {
  id: string;
  taskId?: string | null;
  title: string;
  engineId: string;
  profileId?: string | null;
  messageCount: number;
  summary?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationRecord = Conversation;
