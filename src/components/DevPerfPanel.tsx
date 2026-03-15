import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { getPerfRecords, type PerfRecord } from "../lib/utils/perf";

type MetricKey = "app_first_screen" | "workspace_task_switch" | "chat_message_list_commit";

type MetricView = {
  key: MetricKey;
  label: string;
  count: number;
  latest: number | null;
  p50: number | null;
  p95: number | null;
};

const METRIC_LABELS: Record<MetricKey, string> = {
  app_first_screen: "首屏",
  workspace_task_switch: "任务切换",
  chat_message_list_commit: "消息渲染",
};

function calcPercentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[index].toFixed(2));
}

function formatMs(value: number | null): string {
  if (value === null) return "-";
  return `${value.toFixed(2)}ms`;
}

function buildMetric(records: PerfRecord[], key: MetricKey): MetricView {
  const values = records
    .filter((record) => record.name === key)
    .map((record) => record.duration)
    .filter((duration) => Number.isFinite(duration));
  const latest = values.length > 0 ? values[values.length - 1] : null;
  return {
    key,
    label: METRIC_LABELS[key],
    count: values.length,
    latest: latest === null ? null : Number(latest.toFixed(2)),
    p50: calcPercentile(values, 0.5),
    p95: calcPercentile(values, 0.95),
  };
}

export function DevPerfPanel() {
  const [records, setRecords] = useState<PerfRecord[]>(() => getPerfRecords());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRecords(getPerfRecords());
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = useMemo<MetricView[]>(
    () => [
      buildMetric(records, "app_first_screen"),
      buildMetric(records, "workspace_task_switch"),
      buildMetric(records, "chat_message_list_commit"),
    ],
    [records],
  );

  return (
    <div className="fixed left-4 bottom-4 z-120 w-[320px] rounded-xl border border-border-muted/50 bg-bg-surface/95 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted/30">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          <Activity size={14} className="text-primary-500" />
          <span>性能基线（DEV）</span>
        </div>
        <span className="text-[10px] text-text-muted">样本 {records.length}</span>
      </div>
      <div className="p-2 space-y-1.5">
        {metrics.map((metric) => (
          <div key={metric.key} className="rounded-lg border border-border-muted/30 bg-bg-base/50 px-2 py-1.5">
            <div className="flex items-center justify-between text-[10px] text-text-muted">
              <span>{metric.label}</span>
              <span>n={metric.count}</span>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-[11px]">
              <div>
                <div className="text-text-muted">最新</div>
                <div className="font-semibold text-text-main">{formatMs(metric.latest)}</div>
              </div>
              <div>
                <div className="text-text-muted">P50</div>
                <div className="font-semibold text-text-main">{formatMs(metric.p50)}</div>
              </div>
              <div>
                <div className="text-text-muted">P95</div>
                <div className="font-semibold text-text-main">{formatMs(metric.p95)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
