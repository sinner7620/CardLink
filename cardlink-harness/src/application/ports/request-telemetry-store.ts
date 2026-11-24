import type {
  AssistantRequestRecord,
  RequestOutcome,
  RequestTokenBreakdown,
  RequestUsageSource,
} from "../../domain/request-telemetry.ts";
import type { FinishReason } from "../../domain/finish-reason.ts";

/**
 * v2.14 §22：请求用量遥测端口。
 *
 * 幂等键 `(sessionId, runId, requestSeq)`：同一次运行的同一请求序号只落一行，
 * 迟到/重放的写入被忽略；后续状态变更走 update（不新增行）。
 * 物理删除只在 `purgeSession` 时发生；软删除会话保留遥测（与审计同生命周期）。
 */
export type RequestTelemetryKey = {
  sessionId: string;
  runId: string;
  requestSeq: number;
};

export type RequestTelemetryPatch = {
  outcome?: RequestOutcome;
  finishReason?: FinishReason;
  errorCode?: string;
  promptTokens?: number;
  promptSource?: RequestUsageSource;
  completionTokens?: number;
  completionSource?: RequestUsageSource;
  reportedPromptTokens?: number;
  reportedCompletionTokens?: number;
  usageEstimated?: boolean;
};

/** 会话级累计用量（只统计已记录行；缺失/估算分别计数，不互相冒充）。 */
export type SessionUsageSummary = {
  requests: number;
  delivered: number;
  failed: number;
  cancelled: number;
  notSent: number;
  /** 已发出但没有终结结果（进程中断）：用量按缺失处理。 */
  unconfirmed: number;
  promptTokens: number;
  completionTokens: number;
  promptMissing: number;
  completionMissing: number;
  promptEstimated: number;
  completionEstimated: number;
  /** 已发送请求的估算输入分项累计（not_sent 不计）。 */
  breakdown: RequestTokenBreakdown;
};

/** 按币种分组的费用权重（金额换算在应用层统一完成）。 */
export type CurrencyCostGroup = {
  /** null=该组请求没有费率快照（未配置费率）。 */
  currency: string | null;
  requests: number;
  /** 两个 token 分量都有值且有费率 → 可计价。 */
  pricedRequests: number;
  /** token 缺失（失败/未确认/未发送）→ 无法计价。 */
  missingUsageRequests: number;
  /** Σ prompt_tokens × 输入单价（未除以 1e6）。 */
  inputWeighted: number;
  /** Σ completion_tokens × 输出单价（未除以 1e6）。 */
  outputWeighted: number;
};

export interface RequestTelemetryStore {
  /** 幂等写入；已存在同键行时返回 false 且不改动既有行。 */
  insertIfAbsent(record: AssistantRequestRecord): boolean;
  update(key: RequestTelemetryKey, patch: RequestTelemetryPatch): void;
  /** 倒序（最新在前）分页。 */
  listBySession(sessionId: string, limit: number, offset: number): AssistantRequestRecord[];
  countBySession(sessionId: string): number;
  summarize(sessionId: string): SessionUsageSummary;
  costGroups(sessionId: string): CurrencyCostGroup[];
  /** 近期窗口（`createdAt >= sinceIso`），倒序返回，供本地日历按日聚合。 */
  listSince(sessionId: string, sinceIso: string, limit: number): AssistantRequestRecord[];
  purgeSession(sessionId: string): void;
}

export const EMPTY_USAGE_SUMMARY: SessionUsageSummary = {
  requests: 0,
  delivered: 0,
  failed: 0,
  cancelled: 0,
  notSent: 0,
  unconfirmed: 0,
  promptTokens: 0,
  completionTokens: 0,
  promptMissing: 0,
  completionMissing: 0,
  promptEstimated: 0,
  completionEstimated: 0,
  breakdown: {
    instructionTokens: 0,
    compactionTokens: 0,
    toolDefinitionTokens: 0,
    messageTokens: 0,
    toolResultTokens: 0,
    overheadTokens: 0,
    totalTokens: 0,
  },
};

function keyOf(record: RequestTelemetryKey): string {
  return `${record.sessionId}\u0000${record.runId}\u0000${record.requestSeq}`;
}

function copyRecord(record: AssistantRequestRecord): AssistantRequestRecord {
  return {
    ...record,
    breakdown: { ...record.breakdown },
    budget: { ...record.budget },
    compaction: record.compaction ? { ...record.compaction } : null,
    rate: record.rate ? { ...record.rate } : null,
  };
}

/** 测试/无持久化装配用内存实现（语义与 SQLite 适配器一致）。 */
export class InMemoryRequestTelemetryStore implements RequestTelemetryStore {
  private readonly rows: AssistantRequestRecord[] = [];

  insertIfAbsent(record: AssistantRequestRecord): boolean {
    if (this.rows.some((row) => keyOf(row) === keyOf(record))) return false;
    this.rows.push(copyRecord(record));
    return true;
  }

  update(key: RequestTelemetryKey, patch: RequestTelemetryPatch): void {
    const stored = this.rows.find((row) => keyOf(row) === keyOf(key));
    if (!stored) return;
    if (patch.outcome !== undefined) stored.outcome = patch.outcome;
    if (patch.finishReason !== undefined) stored.finishReason = patch.finishReason;
    if (patch.errorCode !== undefined) stored.errorCode = patch.errorCode;
    if (patch.promptTokens !== undefined) stored.promptTokens = patch.promptTokens;
    if (patch.promptSource !== undefined) stored.promptSource = patch.promptSource;
    if (patch.completionTokens !== undefined) stored.completionTokens = patch.completionTokens;
    if (patch.completionSource !== undefined) stored.completionSource = patch.completionSource;
    if (patch.reportedPromptTokens !== undefined) stored.reportedPromptTokens = patch.reportedPromptTokens;
    if (patch.reportedCompletionTokens !== undefined) stored.reportedCompletionTokens = patch.reportedCompletionTokens;
    if (patch.usageEstimated !== undefined) stored.usageEstimated = patch.usageEstimated;
  }

  listBySession(sessionId: string, limit: number, offset: number): AssistantRequestRecord[] {
    return this.rows
      .filter((row) => row.sessionId === sessionId)
      .sort((a, b) => (a.createdAt === b.createdAt ? b.requestSeq - a.requestSeq : a.createdAt < b.createdAt ? 1 : -1))
      .slice(offset, offset + limit)
      .map(copyRecord);
  }

  countBySession(sessionId: string): number {
    return this.rows.filter((row) => row.sessionId === sessionId).length;
  }

  summarize(sessionId: string): SessionUsageSummary {
    const summary: SessionUsageSummary = {
      ...EMPTY_USAGE_SUMMARY,
      breakdown: { ...EMPTY_USAGE_SUMMARY.breakdown },
    };
    for (const row of this.rows) {
      if (row.sessionId !== sessionId) continue;
      summary.requests += 1;
      if (row.outcome === "delivered") summary.delivered += 1;
      else if (row.outcome === "failed") summary.failed += 1;
      else if (row.outcome === "cancelled") summary.cancelled += 1;
      else if (row.outcome === "not_sent") summary.notSent += 1;
      else summary.unconfirmed += 1;
      if (row.promptTokens === undefined) summary.promptMissing += 1;
      else summary.promptTokens += row.promptTokens;
      if (row.completionTokens === undefined) summary.completionMissing += 1;
      else summary.completionTokens += row.completionTokens;
      if (row.promptSource === "estimated") summary.promptEstimated += 1;
      if (row.completionSource === "estimated") summary.completionEstimated += 1;
      if (row.outcome === "not_sent") continue;
      summary.breakdown.instructionTokens += row.breakdown.instructionTokens;
      summary.breakdown.compactionTokens += row.breakdown.compactionTokens;
      summary.breakdown.toolDefinitionTokens += row.breakdown.toolDefinitionTokens;
      summary.breakdown.messageTokens += row.breakdown.messageTokens;
      summary.breakdown.toolResultTokens += row.breakdown.toolResultTokens;
      summary.breakdown.overheadTokens += row.breakdown.overheadTokens;
      summary.breakdown.totalTokens += row.breakdown.totalTokens;
    }
    return summary;
  }

  costGroups(sessionId: string): CurrencyCostGroup[] {
    const groups = new Map<string, CurrencyCostGroup>();
    for (const row of this.rows) {
      if (row.sessionId !== sessionId) continue;
      // 未发送的构建（not_sent）没有产生调用，不计入费用口径。
      if (row.outcome === "not_sent") continue;
      const currency = row.rate?.currency ?? null;
      const key = currency ?? "\u0000none";
      const group = groups.get(key) ?? {
        currency,
        requests: 0,
        pricedRequests: 0,
        missingUsageRequests: 0,
        inputWeighted: 0,
        outputWeighted: 0,
      };
      group.requests += 1;
      if (row.promptTokens === undefined || row.completionTokens === undefined) {
        group.missingUsageRequests += 1;
      } else if (row.rate) {
        group.pricedRequests += 1;
        group.inputWeighted += row.promptTokens * row.rate.inputPerMillion;
        group.outputWeighted += row.completionTokens * row.rate.outputPerMillion;
      }
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  listSince(sessionId: string, sinceIso: string, limit: number): AssistantRequestRecord[] {
    return this.rows
      .filter((row) => row.sessionId === sessionId && row.createdAt >= sinceIso)
      .sort((a, b) => (a.createdAt === b.createdAt ? b.requestSeq - a.requestSeq : a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map(copyRecord);
  }

  purgeSession(sessionId: string): void {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.sessionId === sessionId) this.rows.splice(index, 1);
    }
  }
}
