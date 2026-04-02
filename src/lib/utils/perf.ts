export type PerfRecord = {
  name: string;
  duration: number;
  ts: number;
  meta?: Record<string, unknown>;
};

const PERF_KEY = "__MAESTRO_PERF__";
const MAX_RECORDS = 400;
const MARK_PREFIX = "maestro:";

function getPerfStore(): PerfRecord[] {
  const target = window as Window & {
    __MAESTRO_PERF__?: PerfRecord[];
  };
  if (!target[PERF_KEY]) {
    target[PERF_KEY] = [];
  }
  return target[PERF_KEY] as PerfRecord[];
}

function pushPerfRecord(record: PerfRecord) {
  const store = getPerfStore();
  store.push(record);
  if (store.length > MAX_RECORDS) {
    store.splice(0, store.length - MAX_RECORDS);
  }
}


export function markPerf(name: string) {
  if (typeof performance === "undefined") return;
  performance.mark(`${MARK_PREFIX}${name}`);
}

export function measurePerf(name: string, startName: string, endName?: string) {
  if (typeof performance === "undefined") return;
  const markStart = `${MARK_PREFIX}${startName}`;
  const markEnd = endName ? `${MARK_PREFIX}${endName}` : undefined;
  try {
    const measureName = `${MARK_PREFIX}${name}`;
    performance.measure(measureName, markStart, markEnd);
    const entries = performance.getEntriesByName(measureName, "measure");
    const last = entries[entries.length - 1];
    if (!last) return;
    pushPerfRecord({
      name,
      duration: Number(last.duration.toFixed(2)),
      ts: Date.now(),
    });
  } catch {
    // 标记不存在时忽略，避免影响主流程
  }
}

export function recordPerf(name: string, duration: number, meta?: Record<string, unknown>) {
  if (!Number.isFinite(duration)) return;
  pushPerfRecord({
    name,
    duration: Number(duration.toFixed(2)),
    ts: Date.now(),
    meta,
  });
}
