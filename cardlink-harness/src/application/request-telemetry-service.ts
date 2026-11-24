import type {
  AssistantRequestRecord,
  RequestCompactionLink,
  RequestCost,
  RequestBudgetSnapshot,
  RequestOutcome,
  RequestTokenBreakdown,
  RequestUsageSource,
  ModelRate,
} from "../domain/request-telemetry.ts";
import { requestCost, roundMoney, validateModelRate } from "../domain/request-telemetry.ts";
import type { FinishReason } from "../domain/finish-reason.ts";
import type {
  RequestTelemetryKey,
  RequestTelemetryPatch,
  RequestTelemetryStore,
  SessionUsageSummary,
} from "./ports/request-telemetry-store.ts";
import { EMPTY_USAGE_SUMMARY, type CurrencyCostGroup } from "./ports/request-telemetry-store.ts";
import type { ModelRateStore } from "./ports/model-rate-store.ts";

/**
 * v2.14 §22：请求用量遥测与本地费用估算（应用层）。
 *
 * - 只记录 Assistant 请求（Reviewer 调用不计入，首版明确范围）；
 * - 输入分项来自 ContextBuilder 的**实际发送视图**（同一估算器与校准）；
 * - 费用按调用当时的 `providerId + model` 费率快照本地确定性计算，
 *   不联网取价、不按模型名猜网关价、不把未知当 0、不混币种；
 * - 按请求时间的**设备本地日历**聚合今日/近期，缺明细不回填。
 */

export type BeginCallInput = {
  sessionId: string;
  runId: string;
  requestSeq: number;
  attempt: number;
  providerId: string;
  modelId: string;
  outcome: "sent" | "not_sent";
  breakdown: RequestTokenBreakdown;
  budget: RequestBudgetSnapshot;
  compaction: RequestCompactionLink | null;
  errorCode?: string;
};

export type RequestInsightItem = {
  requestSeq: number;
  attempt: number;
  runId: string;
  createdAt: string;
  outcome: RequestOutcome;
  finishReason?: FinishReason;
  errorCode?: string;
  providerId: string;
  model: string;
  breakdown: RequestTokenBreakdown;
  budget: RequestBudgetSnapshot;
  compaction: RequestCompactionLink | null;
  tokens: {
    prompt?: number;
    completion?: number;
    total?: number;
    promptSource?: RequestUsageSource;
    completionSource?: RequestUsageSource;
    /** 至少一个分量来自本地估算。 */
    estimated: boolean;
    /** 至少一个分量缺失（无法确认用量/金额）。 */
    missing: boolean;
  };
  /** 与上一（更早）请求相比的估算输入增量；更早请求不在本页时为 null。 */
  deltaInputTokens: number | null;
  cost: RequestCost | null;
};

export type CurrencyCost = {
  /** null=没有费率快照的请求（未配置定价），不能与已计价合并。 */
  currency: string | null;
  /** null=该币种本次没有任何可计价请求（不显示 0 元）。 */
  amount: number | null;
  requests: number;
  pricedRequests: number;
  unpricedRequests: number;
  missingUsageRequests: number;
};

export type DayCost = { date: string; buckets: CurrencyCost[] };

export type SessionInsights = {
  sessionId: string;
  generatedAt: string;
  timezone: string;
  windowDays: number;
  limit: number;
  offset: number;
  requestCount: number;
  hasMore: boolean;
  totals: SessionUsageSummary;
  requests: RequestInsightItem[];
  cost: {
    /** 仅统计 Assistant 请求；Reviewer 调用不在范围内。 */
    scope: "assistant_requests";
    session: CurrencyCost[];
    today: CurrencyCost[];
    days: DayCost[];
    /** 近期窗口行数达到上限，聚合不完整（UI 必须说明）。 */
    truncated: boolean;
  };
};

export type SessionInsightsOptions = {
  limit?: number;
  offset?: number;
  days?: number;
  now?: Date;
};

export type RequestTelemetryServiceOptions = {
  store?: RequestTelemetryStore;
  rates?: ModelRateStore;
  now?: () => Date;
};

export const DEFAULT_INSIGHT_LIMIT = 20;
export const MAX_INSIGHT_LIMIT = 50;
export const MAX_INSIGHT_OFFSET = 500;
export const DEFAULT_INSIGHT_DAYS = 7;
export const MAX_INSIGHT_DAYS = 30;
export const MAX_RECENT_ROWS = 1000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** 设备本地日历日期键（YYYY-MM-DD）。 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 按币种把权重换算为金额；未配置费率的请求单列，不并入任何金额。 */
export function costBucketsOf(groups: CurrencyCostGroup[]): CurrencyCost[] {
  const buckets = new Map<string, CurrencyCost>();
  for (const group of groups) {
    const key = group.currency ?? "\u0000unpriced";
    const bucket = buckets.get(key) ?? {
      currency: group.currency,
      amount: null,
      requests: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
      missingUsageRequests: 0,
    };
    bucket.requests += group.requests;
    bucket.pricedRequests += group.pricedRequests;
    bucket.missingUsageRequests += group.missingUsageRequests;
    if (group.pricedRequests > 0) {
      const amount = roundMoney((group.inputWeighted + group.outputWeighted) / 1_000_000);
      bucket.amount = roundMoney((bucket.amount ?? 0) + amount);
    }
    buckets.set(key, bucket);
  }
  const result = [...buckets.values()];
  for (const bucket of result) {
    bucket.unpricedRequests = Math.max(0, bucket.requests - bucket.pricedRequests - bucket.missingUsageRequests);
  }
  return sortBuckets(result);
}

function addToBucket(buckets: Map<string, CurrencyCost>, record: AssistantRequestRecord): void {
  const currency = record.rate?.currency ?? null;
  const key = currency ?? "\u0000unpriced";
  const bucket = buckets.get(key) ?? {
    currency,
    amount: null,
    requests: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    missingUsageRequests: 0,
  };
  const cost = requestCost(record);
  bucket.requests += 1;
  if (cost) {
    bucket.pricedRequests += 1;
    bucket.amount = roundMoney((bucket.amount ?? 0) + cost.amount);
  } else if (record.promptTokens === undefined || record.completionTokens === undefined) {
    // 用量缺失：金额未知，单独计数（不并入金额、不当 0）。
    bucket.missingUsageRequests += 1;
  } else {
    bucket.unpricedRequests += 1;
  }
  buckets.set(key, bucket);
}

function compareCurrency(a: string | null, b: string | null): number {
  const left = a ?? "";
  const right = b ?? "";
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortBuckets(buckets: CurrencyCost[]): CurrencyCost[] {
  // 已计价币种在前（金额降序），未配置定价的分组最后；同额按币种名保证确定性。
  return buckets.sort((a, b) => {
    const aPriced = a.amount !== null;
    const bPriced = b.amount !== null;
    if (aPriced !== bPriced) return aPriced ? -1 : 1;
    if (aPriced && bPriced && a.amount !== b.amount) return (b.amount ?? 0) - (a.amount ?? 0);
    return compareCurrency(a.currency, b.currency);
  });
}

function tokensOf(record: AssistantRequestRecord): RequestInsightItem["tokens"] {
  const prompt = record.promptTokens;
  const completion = record.completionTokens;
  if (prompt === undefined || completion === undefined) {
    return {
      prompt,
      completion,
      total: undefined,
      promptSource: record.promptSource,
      completionSource: record.completionSource,
      estimated: record.promptSource === "estimated" || record.completionSource === "estimated",
      missing: true,
    };
  }
  return {
    prompt,
    completion,
    total: prompt + completion,
    promptSource: record.promptSource,
    completionSource: record.completionSource,
    estimated: record.promptSource === "estimated" || record.completionSource === "estimated",
    missing: false,
  };
}

export class RequestTelemetryService {
  constructor(private readonly options: RequestTelemetryServiceOptions = {}) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  get enabled(): boolean {
    return Boolean(this.options.store);
  }

  /** 记录一次请求开始（`sent`）或本地预算拦截（`not_sent`，未发送不计费）。 */
  beginCall(input: BeginCallInput): void {
    const store = this.options.store;
    if (!store) return;
    const now = this.now();
    const rate = this.options.rates?.get(input.providerId, input.modelId) ?? null;
    store.insertIfAbsent({
      sessionId: input.sessionId,
      runId: input.runId,
      requestSeq: input.requestSeq,
      attempt: input.attempt,
      providerId: input.providerId,
      modelId: input.modelId,
      createdAt: now.toISOString(),
      outcome: input.outcome,
      errorCode: input.errorCode,
      breakdown: { ...input.breakdown },
      budget: { ...input.budget },
      compaction: input.compaction ? { ...input.compaction } : null,
      usageEstimated: false,
      rate: rate
        ? {
            currency: rate.currency,
            inputPerMillion: rate.inputPerMillion,
            outputPerMillion: rate.outputPerMillion,
            updatedAt: rate.updatedAt,
          }
        : null,
    });
  }

  completeCall(key: RequestTelemetryKey, patch: RequestTelemetryPatch): void {
    this.options.store?.update(key, patch);
  }

  purgeSession(sessionId: string): void {
    this.options.store?.purgeSession(sessionId);
  }

  getRate(providerId: string, model: string): ModelRate | null {
    return this.options.rates?.get(providerId, model) ?? null;
  }

  /** 手动费率写入（校验失败抛错，桥接层转结构化错误）。 */
  setRate(input: unknown): ModelRate {
    const checked = validateModelRate(input, this.now());
    if (!checked.ok) throw new Error(checked.reason);
    if (!this.options.rates) throw new Error("费率存储未装配");
    this.options.rates.upsert(checked.value);
    return checked.value;
  }

  clearRate(providerId: string, model: string): boolean {
    if (!this.options.rates) return false;
    const existing = this.options.rates.get(providerId, model);
    this.options.rates.clear(providerId, model);
    return Boolean(existing);
  }

  listRates(limit = 50): ModelRate[] {
    return this.options.rates?.list(limit) ?? [];
  }

  /**
   * 会话级用量与费用快照。
   * 请求列表倒序分页（最多 50 条/页）；今日与按日费用只读近期有界窗口。
   */
  sessionInsights(sessionId: string, options: SessionInsightsOptions = {}): SessionInsights {
    const store = this.options.store;
    const now = options.now ?? this.now();
    const limit = clamp(options.limit ?? DEFAULT_INSIGHT_LIMIT, 1, MAX_INSIGHT_LIMIT);
    const offset = clamp(options.offset ?? 0, 0, MAX_INSIGHT_OFFSET);
    const days = clamp(options.days ?? DEFAULT_INSIGHT_DAYS, 1, MAX_INSIGHT_DAYS);
    if (!store) {
      return {
        sessionId,
        generatedAt: now.toISOString(),
        timezone: localTimeZone(),
        windowDays: days,
        limit,
        offset,
        requestCount: 0,
        hasMore: false,
        totals: { ...EMPTY_USAGE_SUMMARY, breakdown: { ...EMPTY_USAGE_SUMMARY.breakdown } },
        requests: [],
        cost: { scope: "assistant_requests", session: [], today: [], days: [], truncated: false },
      };
    }
    const requestCount = store.countBySession(sessionId);
    // 多取一行：本页最旧一条的"增长/跌落"需要它的上一条（更早）请求。
    const rowsDesc = store.listBySession(sessionId, limit + 1, offset);
    const page = rowsDesc.slice(0, limit);
    const requests: RequestInsightItem[] = page.map((row, index) => {
      const older = rowsDesc[index + 1];
      return {
        requestSeq: row.requestSeq,
        attempt: row.attempt,
        runId: row.runId,
        createdAt: row.createdAt,
        outcome: row.outcome,
        finishReason: row.finishReason,
        errorCode: row.errorCode,
        providerId: row.providerId,
        model: row.modelId,
        breakdown: { ...row.breakdown },
        budget: { ...row.budget },
        compaction: row.compaction ? { ...row.compaction } : null,
        tokens: tokensOf(row),
        deltaInputTokens: older ? row.breakdown.totalTokens - older.breakdown.totalTokens : null,
        cost: requestCost(row),
      };
    });

    const since = startOfLocalDay(now);
    since.setDate(since.getDate() - (days - 1));
    const recent = store.listSince(sessionId, since.toISOString(), MAX_RECENT_ROWS);
    const byDay = new Map<string, Map<string, CurrencyCost>>();
    for (const row of recent) {
      if (row.outcome === "not_sent") continue;
      const at = new Date(row.createdAt);
      if (!Number.isFinite(at.getTime())) continue;
      const key = localDateKey(at);
      const buckets = byDay.get(key) ?? new Map<string, CurrencyCost>();
      addToBucket(buckets, row);
      byDay.set(key, buckets);
    }
    const dayList: DayCost[] = [];
    for (let index = 0; index < days; index++) {
      const date = new Date(since.getFullYear(), since.getMonth(), since.getDate() + index);
      const key = localDateKey(date);
      dayList.push({ date: key, buckets: sortBuckets([...(byDay.get(key)?.values() ?? [])]) });
    }
    const todayKey = localDateKey(now);

    return {
      sessionId,
      generatedAt: now.toISOString(),
      timezone: localTimeZone(),
      windowDays: days,
      limit,
      offset,
      requestCount,
      hasMore: offset + page.length < requestCount,
      totals: store.summarize(sessionId),
      requests,
      cost: {
        scope: "assistant_requests",
        session: costBucketsOf(store.costGroups(sessionId)),
        today: dayList.find((day) => day.date === todayKey)?.buckets ?? [],
        days: dayList,
        truncated: recent.length >= MAX_RECENT_ROWS,
      },
    };
  }
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
