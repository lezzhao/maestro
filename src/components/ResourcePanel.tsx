import { useMemo } from "react";
import { Panel } from "react-resizable-panels";
import { Button } from "./ui/button";
import { CliSessionPanel } from "./CliSessionPanel";
import { GitChangesPanel } from "./GitChangesPanel";
import { cn } from "../lib/utils";
import type { ChatMessage, VerificationSummary } from "../types";
import type { TaskRun } from "../types";

export type RightPanelTab = "runs" | "verification" | "changes" | "conclusion";

interface ResourcePanelProps {
  activeTaskId: string;
  activeEngineId: string;
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
  // Git Props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gitChanges: any[];
  activeFile: string;
  activeDiff: string;
  onFileSelect: (path: string) => void;
  onRefreshGit: () => Promise<void>;
  // Verification & Runs Props
  latestVerification: VerificationSummary | null;
  latestRun: TaskRun | null;
  activeTaskMessages: ChatMessage[];
}

export function ResourcePanel({
  activeTaskId,
  activeEngineId,
  rightPanelTab,
  setRightPanelTab,
  gitChanges,
  activeFile,
  activeDiff,
  onFileSelect,
  onRefreshGit,
  latestVerification,
  latestRun,
  activeTaskMessages,
}: ResourcePanelProps) {
  const outputSummary = useMemo(() => {
    const assistantMessages = activeTaskMessages.filter((msg) => msg.role === "assistant");
    const lastAssistant = [...assistantMessages].reverse().find((msg) => msg.content.trim());
    if (!lastAssistant) {
      return "暂无产出摘要";
    }
    return lastAssistant.content.length > 800
      ? `${lastAssistant.content.slice(0, 800)}...`
      : lastAssistant.content;
  }, [activeTaskMessages]);

  const conclusionSummary = useMemo(() => {
    const runStatus = latestRun?.status || "pending";
    const verification = latestVerification?.test_run;
    const hasVerification = Boolean(latestVerification?.has_verification && verification);
    const riskList: string[] = [];
    if (runStatus === "error") {
      riskList.push("本轮执行失败，需要先处理错误后再继续。");
    }
    if (runStatus === "stopped") {
      riskList.push("本轮被手动停止，产出可能不完整。");
    }
    if (hasVerification && verification && !verification.success) {
      riskList.push("验证未通过，存在失败用例。");
    }
    return {
      done: runStatus === "done" && hasVerification && Boolean(verification?.success),
      risks: riskList,
      pending: runStatus === "running" ? ["执行仍在进行中。"] : [],
      next:
        runStatus === "done" && hasVerification
          ? "可进入下一轮任务，或先审查 diff 后提交。"
          : runStatus === "done"
            ? "当前缺少验证证据，建议先补一次可验证执行。"
          : runStatus === "running"
            ? "等待当前轮次结束，期间可继续排队补充约束。"
            : "建议补充约束后重新执行一轮。"
    };
  }, [latestRun?.status, latestVerification]);

  return (
    <Panel id="resource-panel" defaultSize={320} minSize={200} className="flex flex-col bg-bg-surface border-l border-border-muted z-10">
      <div className="flex items-center gap-1 border-b border-border-muted px-2 py-1.5 shrink-0 bg-bg-surface">
        <Button
          size="sm"
          variant={rightPanelTab === "runs" ? "default" : "outline"}
          className="h-7 px-2 text-[10px] font-semibold"
          onClick={() => setRightPanelTab("runs")}
        >
          运行
        </Button>
        <Button
          size="sm"
          variant={rightPanelTab === "verification" ? "default" : "outline"}
          className="h-7 px-2 text-[10px] font-semibold"
          onClick={() => setRightPanelTab("verification")}
        >
          验证
        </Button>
        <Button
          size="sm"
          variant={rightPanelTab === "changes" ? "default" : "outline"}
          className="h-7 px-2 text-[10px] font-semibold"
          onClick={() => setRightPanelTab("changes")}
        >
          变更
        </Button>
        <Button
          size="sm"
          variant={rightPanelTab === "conclusion" ? "default" : "outline"}
          className="h-7 px-2 text-[10px] font-semibold"
          onClick={() => setRightPanelTab("conclusion")}
        >
          结论
        </Button>
      </div>
      
      {rightPanelTab === "runs" ? (
        <div className="flex-1 min-h-0">
          <CliSessionPanel activeEngineId={activeEngineId} activeTaskId={activeTaskId} />
        </div>
      ) : rightPanelTab === "verification" ? (
        <div className="flex-1 min-h-0 p-3 overflow-y-auto custom-scrollbar">
          <div className="text-[11px] font-semibold mb-2">结构化验证结果</div>
          {!latestVerification?.has_verification || !latestVerification.test_run ? (
            <div className="text-xs text-text-muted">本轮暂无结构化验证数据。</div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                <div className="text-text-muted">框架</div>
                <div className="text-text-main font-semibold uppercase">
                  {latestVerification.test_run.framework}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                  <div className="text-text-muted">用例通过</div>
                  <div className="text-emerald-500 font-semibold">
                    {latestVerification.test_run.passed_cases} / {latestVerification.test_run.total_cases}
                  </div>
                </div>
                <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                  <div className="text-text-muted">用例失败</div>
                  <div className="text-rose-500 font-semibold">
                    {latestVerification.test_run.failed_cases}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                <div className="text-text-muted">套件</div>
                <div className="text-text-main">
                  {latestVerification.test_run.passed_suites} 通过 / {latestVerification.test_run.failed_suites} 失败
                </div>
              </div>
              <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                <div className="text-text-muted">数据来源</div>
                <div className="text-text-main">{latestVerification.source || "unknown"}</div>
              </div>
              {latestVerification.test_run.raw_summary ? (
                <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                  <div className="text-text-muted mb-1">原始摘要</div>
                  <pre className="whitespace-pre-wrap wrap-break-word text-[11px] text-text-main leading-relaxed">
                    {latestVerification.test_run.raw_summary}
                  </pre>
                </div>
              ) : null}
              {latestVerification.test_run.suites.length > 0 ? (
                <div className="rounded-md border border-border-muted/20 px-2 py-1.5">
                  <div className="text-text-muted mb-1">Suite 明细</div>
                  <div className="space-y-1">
                    {latestVerification.test_run.suites.map((suite, index) => (
                      <div key={`${suite.name}-${index}`} className="text-[11px] border border-border-muted/15 rounded px-2 py-1">
                        <div className="font-semibold text-text-main">{suite.name}</div>
                        <div className="text-text-muted">
                          {suite.passed_cases} 通过 / {suite.failed_cases} 失败 / {suite.skipped_cases} 跳过
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : rightPanelTab === "changes" ? (
        <div className="flex-1 min-h-0">
          <GitChangesPanel
            gitChanges={gitChanges}
            activeFile={activeFile}
            activeDiff={activeDiff}
            onFileSelect={onFileSelect}
            onRefresh={onRefreshGit}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-3 overflow-y-auto custom-scrollbar">
          <div className="text-[11px] font-semibold mb-2">结论</div>
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-text-muted mb-1">已完成</div>
              <div className={cn("font-semibold", conclusionSummary.done ? "text-emerald-500" : "text-amber-500")}>
                {conclusionSummary.done ? "本轮结果可进入下一步" : "本轮结果仍需审查"}
              </div>
            </div>
            <div>
              <div className="text-text-muted mb-1">风险</div>
              {conclusionSummary.risks.length === 0 ? (
                <div className="text-emerald-500">未检测到高风险信号</div>
              ) : (
                <div className="space-y-1">
                  {conclusionSummary.risks.map((risk) => (
                    <div key={risk} className="text-rose-400">{risk}</div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-text-muted mb-1">待确认</div>
              {conclusionSummary.pending.length === 0 ? (
                <div className="text-text-main">无</div>
              ) : (
                <div className="space-y-1">
                  {conclusionSummary.pending.map((item) => (
                    <div key={item} className="text-amber-400">{item}</div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-text-muted mb-1">下一步</div>
              <div className="text-text-main">{conclusionSummary.next}</div>
            </div>
            <div>
              <div className="text-text-muted mb-1">最新产出摘要</div>
              <pre className="whitespace-pre-wrap wrap-break-word text-xs text-text-main leading-relaxed">
                {outputSummary}
              </pre>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
