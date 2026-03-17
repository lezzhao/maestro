import { useMemo, useState } from "react";
import { ListChecks, MessageSquareText, FolderTree, Activity } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { useTranslation } from "../i18n";
import { useChatStore } from "../stores/chatStore";
import { useShallow } from "zustand/react/shallow";
import { ChatPanel } from "./ChatPanel";
import type { AppTask, EngineConfig } from "../types";

type Props = {
  projectPath: string;
  engines: Record<string, EngineConfig>;
  activeTask: AppTask | null;
  onSetExecutionMode: (mode: "api" | "cli") => Promise<void>;
};

type WorkspaceTab = "overview" | "transcript";
type EventStatusFilter = "all" | "pending" | "done" | "error";
type EventModeFilter = "all" | "api" | "cli";

function formatTaskStatus(status: AppTask["status"]) {
  if (status === "running") return "执行中";
  if (status === "verified") return "已验证";
  if (status === "needs_review") return "待审阅";
  if (status === "completed") return "已完成";
  if (status === "error") return "异常";
  return "待命";
}

export function TaskWorkspace({
  projectPath,
  engines,
  activeTask,
  onSetExecutionMode,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<WorkspaceTab>("transcript");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("all");
  const [eventModeFilter, setEventModeFilter] = useState<EventModeFilter>("all");
  const activeId = activeTask?.id || null;
  const messages = useChatStore((s) => s.getTaskMessages(activeId));
  const isRunning = useChatStore((s) => s.getTaskRunning(activeId));
  const pendingAttachments = useChatStore((s) => s.getTaskPendingAttachments(activeId));
  const latestRun = useChatStore((s) => s.getLatestRun(activeId));
  const latestTranscript = useChatStore((s) => s.getRunTranscript(latestRun?.id || null));
  const runEvents = useChatStore(useShallow((s) => s.getTaskRunEvents(activeId)));
  const activeEngineId = activeTask?.engineId || Object.keys(engines)[0] || "";
  const activeEngine = engines[activeEngineId];
  const activeProfile = useMemo(() => {
    if (!activeEngine?.profiles) return null;
    const profileId =
      activeEngine.active_profile_id && activeEngine.profiles[activeEngine.active_profile_id]
        ? activeEngine.active_profile_id
        : Object.keys(activeEngine.profiles)[0];
    if (!profileId) return null;
    return activeEngine.profiles[profileId] || null;
  }, [activeEngine]);
  const executionMode = ((activeProfile?.execution_mode || "cli") as "api" | "cli");

  const groupedRunEvents = useMemo(() => {
    const filtered = runEvents.filter((event) => {
      const passStatus = eventStatusFilter === "all" || event.status === eventStatusFilter;
      const passMode = eventModeFilter === "all" || event.mode === eventModeFilter;
      return passStatus && passMode;
    });
    const groupMap = new Map<string, typeof filtered>();
    filtered.forEach((event) => {
      const list = groupMap.get(event.runId) || [];
      list.push(event);
      groupMap.set(event.runId, list);
    });
    return Array.from(groupMap.entries())
      .map(([runId, events]) => ({
        runId,
        events: events.sort((a, b) => a.createdAt - b.createdAt),
      }))
      .sort((a, b) => {
        const aTime = a.events[a.events.length - 1]?.createdAt || 0;
        const bTime = b.events[b.events.length - 1]?.createdAt || 0;
        return bTime - aTime;
      });
  }, [eventModeFilter, eventStatusFilter, runEvents]);

  const timeline = useMemo(() => {
    if (runEvents.length > 0) {
      return runEvents.slice(-20).map((event) => ({
        id: event.id,
        label: event.message,
        status: event.status,
        ts: event.createdAt,
      }));
    }
    return messages
      .filter((msg) => msg.role === "system" || msg.role === "assistant")
      .slice(-12)
      .map((msg) => {
        if (msg.role === "system") {
          return {
            id: msg.id,
            label: msg.content || "系统事件",
            status: msg.meta?.eventStatus || "done",
            ts: msg.timestamp,
          };
        }
        return {
          id: msg.id,
          label: msg.content.trim() ? "已收到模型输出" : "等待模型输出",
          status: msg.status === "error" ? "error" : msg.status === "streaming" ? "pending" : "done",
          ts: msg.timestamp,
        };
      });
  }, [messages, runEvents]);

  const currentContext = useMemo(() => {
    const changedFiles = (activeTask?.gitChanges || []).slice(0, 6).map((item) => item.path);
    const queuedAttachments = pendingAttachments.slice(0, 4).map((item) => item.name);
    return {
      changedFiles,
      queuedAttachments,
      latestTranscript: latestTranscript.slice(-3).map((chunk) => chunk.content.trim()).filter(Boolean),
    };
  }, [activeTask?.gitChanges, latestTranscript, pendingAttachments]);

  const tabButton = (id: WorkspaceTab, label: string, Icon: typeof ListChecks) => (
    <Button
      size="sm"
      variant={tab === id ? "default" : "outline"}
      className={cn("h-8 rounded-lg text-[11px] font-semibold")}
      onClick={() => setTab(id)}
    >
      <Icon size={14} />
      {label}
    </Button>
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-12 border-b border-border-muted px-3 flex items-center justify-between gap-3 bg-bg-surface">
        <div className="flex items-center gap-2">
          {tabButton("overview", "执行概览", ListChecks)}
          {tabButton("transcript", "辅助转录", MessageSquareText)}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          <Activity size={12} className={cn(isRunning ? "text-emerald-500" : "text-text-muted")} />
          <span>{activeEngine?.display_name || activeEngineId}</span>
          <span className="opacity-60">/</span>
          <span>{executionMode.toUpperCase()}</span>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
          <div className="rounded-xl border border-border-muted bg-bg-surface p-3 shadow-sm">
            <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">任务状态</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-text-muted">当前任务</div>
                <div className="font-semibold">{activeTask?.name || "未选择任务"}</div>
              </div>
              <div>
                <div className="text-text-muted">执行状态</div>
                <div className="font-semibold">{activeTask ? formatTaskStatus(activeTask.status) : "待命"}</div>
              </div>
              <div>
                <div className="text-text-muted">消息总数</div>
                <div className="font-semibold">{messages.length}</div>
              </div>
              <div>
                <div className="text-text-muted">当前 Run</div>
                <div className="font-semibold truncate">{latestRun?.id || "-"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-muted bg-bg-surface p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] font-semibold mb-2">
              <FolderTree size={14} />
              <span>本轮上下文</span>
            </div>
            {currentContext.changedFiles.length === 0 &&
            currentContext.queuedAttachments.length === 0 &&
            currentContext.latestTranscript.length === 0 ? (
              <div className="text-xs text-text-muted">{t("no_project_desc")}</div>
            ) : (
              <div className="space-y-2">
                <div>
                  <div className="text-[10px] text-text-muted mb-1">最近改动文件</div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentContext.changedFiles.length === 0 ? (
                      <span className="text-[10px] text-text-muted">无</span>
                    ) : (
                      currentContext.changedFiles.map((name) => (
                        <span
                          key={name}
                          className="px-2 py-0.5 rounded-md border border-border-muted/40 bg-bg-base/40 text-[10px]"
                        >
                          {name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-muted mb-1">待发送附件</div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentContext.queuedAttachments.length === 0 ? (
                      <span className="text-[10px] text-text-muted">无</span>
                    ) : (
                      currentContext.queuedAttachments.map((name) => (
                        <span
                          key={name}
                          className="px-2 py-0.5 rounded-md border border-border-muted bg-bg-elevated text-[10px]"
                        >
                          {name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-muted mb-1">最近输出片段</div>
                  {currentContext.latestTranscript.length === 0 ? (
                    <div className="text-[10px] text-text-muted">无</div>
                  ) : (
                    <div className="space-y-1">
                      {currentContext.latestTranscript.map((snippet, index) => (
                        <div
                          key={`${index}-${snippet.slice(0, 16)}`}
                          className="text-[10px] text-text-main border border-border-muted rounded px-2 py-1 bg-bg-elevated"
                        >
                          {snippet.length > 120 ? `${snippet.slice(0, 120)}...` : snippet}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border-muted bg-bg-surface p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-semibold">执行时间线</div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={eventStatusFilter === "all" ? "default" : "outline"}
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setEventStatusFilter("all")}
                >
                  全部
                </Button>
                <Button
                  size="sm"
                  variant={eventStatusFilter === "error" ? "default" : "outline"}
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setEventStatusFilter("error")}
                >
                  错误
                </Button>
                <Button
                  size="sm"
                  variant={eventModeFilter === "cli" ? "default" : "outline"}
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setEventModeFilter(eventModeFilter === "cli" ? "all" : "cli")}
                >
                  CLI
                </Button>
                <Button
                  size="sm"
                  variant={eventModeFilter === "api" ? "default" : "outline"}
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setEventModeFilter(eventModeFilter === "api" ? "all" : "api")}
                >
                  API
                </Button>
              </div>
            </div>
            {timeline.length === 0 ? (
              <div className="text-xs text-text-muted">暂无执行事件，发送任务后会在这里持续更新。</div>
            ) : (
              <div className="space-y-2">
                {timeline.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 rounded-full",
                        item.status === "error"
                          ? "bg-red-500"
                          : item.status === "pending"
                            ? "bg-amber-500"
                            : "bg-emerald-500",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-text-main">{item.label}</div>
                      <div className="text-[10px] text-text-muted">
                        {new Date(item.ts).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border-muted bg-bg-surface p-3 shadow-sm">
            <div className="text-[11px] font-semibold mb-2">运行分组（按 Run）</div>
            {groupedRunEvents.length === 0 ? (
              <div className="text-xs text-text-muted">当前筛选下暂无运行事件。</div>
            ) : (
              <div className="space-y-2">
                {groupedRunEvents.map((group) => (
                  <div key={group.runId} className="rounded-md border border-border-muted bg-bg-elevated p-2">
                    <div className="text-[10px] text-text-muted mb-1">
                      {group.runId} · {new Date(group.events[0]?.createdAt || 0).toLocaleTimeString()}
                    </div>
                    <div className="space-y-1">
                      {group.events.map((event) => (
                        <div key={event.id} className="flex items-start gap-2 text-xs">
                          <span
                            className={cn(
                              "mt-1 h-1.5 w-1.5 rounded-full",
                              event.status === "error"
                                ? "bg-red-500"
                                : event.status === "pending"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-text-main">{event.message}</div>
                            <div className="text-[10px] text-text-muted">
                              {new Date(event.createdAt).toLocaleTimeString()} · {event.mode?.toUpperCase() || "-"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 bg-bg-base">
          <ChatPanel
            projectPath={projectPath}
            engines={engines}
            activeTask={activeTask}
            onSetExecutionMode={onSetExecutionMode}
          />
        </div>
      )}
    </div>
  );
}
