import type { FinishReason } from "./finish-reason.ts";

/**
 * v2.14 §22：单次 Assistant 请求的用量遥测（H1 元数据）。
 *
 * 只记录"这次请求的输入由什么组成、服务商报了多少用量、当时适用什么费率"，
 * 不复制系统指令正文、会话消息正文、工具结果正文、OCR 或密钥。
 * 全部 token 数值都是**估算**（同一估算器 + 校准系数），服务商实报值单列，
 * 缺失与实报 0 明确区分。
 */

/** 估算输入分项。分项之和恒等于 `totalTokens`（自洽，见 scaleBreakdown）。 */
export type RequestTokenBreakdown = {
  /** 系统指令正文（不含历史压缩摘要）。 */
  instructionTokens: number;
  /** 注入 instruction 的历史压缩摘要。 */
  compactionTokens: number;
  /** 五个只读工具定义（Schema + 说明）。 */
  toolDefinitionTokens: number;
  /** 会话消息正文（user/assistant，含续答指令）。 */
  messageTokens: number;
  /** 工具结果消息正文（已按裁剪后内容估算）。 */
  toolResultTokens: number;
  /** 角色/消息/工具的结构开销（估算器的固定加成）。 */
  overheadTokens: number;
  /** 有效输入合计（= 预算计划中的 estimatedInputTokens）。 */
  totalTokens: number;
};

export const BREAKDOWN_PART_KEYS = [
  "instructionTokens",
  "compactionTokens",
  "toolDefinitionTokens",
  "messageTokens",
  "toolResultTokens",
  "overheadTokens",
] as const;

export type BreakdownPartKey = (typeof BREAKDOWN_PART_KEYS)[number];

export const EMPTY_BREAKDOWN: RequestTokenBreakdown = {
  instructionTokens: 0,
  compactionTokens: 0,
  toolDefinitionTokens: 0,
  messageTokens: 0,
  toolResultTokens: 0,
  overheadTokens: 0,
  totalTokens: 0,
};

/** provider=服务商实报（含实报 0）；estimated=服务商未返回该字段，本地估算。 */
export type RequestUsageSource = "provider" | "estimated";

/**
 * 单次请求的执行/计量状态：
 * - not_sent：已构建上下文但被本地预算拒绝，未向服务商发送（不计费用）；
 * - sent：已写入且请求已发出，但没有收到终结结果（进程中断/未确认）；
 * - delivered：收到模型响应（无论 finishReason）；
 * - failed：请求抛出错误；
 * - cancelled：请求因用户取消中止。
 */
export type RequestOutcome = "not_sent" | "sent" | "delivered" | "failed" | "cancelled";

/** 该次请求的预算摘要（与 ContextPlan 同源；输出预留不计入输入）。 */
export type RequestBudgetSnapshot = {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  reservedTokens: number;
  compactionTriggerTokens: number;
};

/** 与 §11.1 持久化压缩记录的关联（不复制摘要正文）。 */
export type RequestCompactionLink = {
  /** 本次请求采用的压缩记录 id（复用或本轮新增）。 */
  id?: string;
  /** true=本轮新建了压缩记录；false=复用既有摘要。 */
  applied: boolean;
  triggerReason?: "budget" | "context_limit";
};

/** 调用当时适用的费率快照（写入请求行，历史不随费率修改而变）。 */
export type ModelRateSnapshot = {
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
  updatedAt: string;
};

export type ModelRate = ModelRateSnapshot & {
  providerId: string;
  model: string;
};

export type AssistantRequestRecord = {
  sessionId: string;
  /** 运行 id；无 RunStore 的装配用 `req:<requestId>` 兜底，保证幂等键稳定。 */
  runId: string;
  /** 本次运行内第几次真实模型请求（1 起，含重试）。 */
  requestSeq: number;
  /** 同一逻辑步骤内的第几次尝试（1=首次；2=context_limit 压缩后重试）。 */
  attempt: number;
  providerId: string;
  modelId: string;
  createdAt: string;
  outcome: RequestOutcome;
  finishReason?: FinishReason;
  errorCode?: string;
  breakdown: RequestTokenBreakdown;
  budget: RequestBudgetSnapshot;
  compaction: RequestCompactionLink | null;
  /** 计入统计的 prompt token（实报优先，否则估算）。 */
  promptTokens?: number;
  promptSource?: RequestUsageSource;
  completionTokens?: number;
  completionSource?: RequestUsageSource;
  /** 服务商实报原值；undefined=未返回（与实报 0 区分）。 */
  reportedPromptTokens?: number;
  reportedCompletionTokens?: number;
  usageEstimated: boolean;
  rate: ModelRateSnapshot | null;
};

/** 一次请求的本地费用估算（按调用当时的费率快照确定性计算）。 */
export type RequestCost = {
  currency: string;
  amount: number;
  inputAmount: number;
  outputAmount: number;
  /** true=用量的至少一个分量来自本地估算（不是服务商实报）。 */
  estimated: boolean;
};

export const MAX_RATE_PER_MILLION = 1_000_000;

/** 费用保留 6 位小数，避免浮点噪声传播到聚合。 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 本地确定性费用：只用该行记录的费率快照与用量。
 * 费率缺失或任一分量 token 缺失 → 金额未知（null），绝不把未知当 0。
 */
export function requestCost(record: AssistantRequestRecord): RequestCost | null {
  const rate = record.rate;
  if (!rate) return null;
  const prompt = record.promptTokens;
  const completion = record.completionTokens;
  if (prompt === undefined || completion === undefined) return null;
  const inputAmount = roundMoney((prompt / 1_000_000) * rate.inputPerMillion);
  const outputAmount = roundMoney((completion / 1_000_000) * rate.outputPerMillion);
  return {
    currency: rate.currency,
    amount: roundMoney(inputAmount + outputAmount),
    inputAmount,
    outputAmount,
    estimated: record.promptSource === "estimated" || record.completionSource === "estimated",
  };
}

export type RateValidation = { ok: true; value: ModelRate } | { ok: false; reason: string };

function numericField(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 手动费率校验（§13 设置页）：providerId + model + 币种 + 每百万 token 单价。
 * 单价允许 0（免费/额度内），但不得为负或非数；币种必须是 3 位字母代码。
 */
export function validateModelRate(input: unknown, now: Date = new Date()): RateValidation {
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return { ok: false, reason: "费率配置必须是对象" };
  const providerId = String(raw.providerId ?? "").trim();
  const model = String(raw.model ?? "").trim();
  if (!providerId || providerId.length > 128) return { ok: false, reason: "providerId 缺失或过长" };
  if (!model || model.length > 256) return { ok: false, reason: "model 缺失或过长" };
  const currency = String(raw.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, reason: "currency 必须是 3 位字母代码（如 CNY、USD）" };
  const inputRate = numericField(raw.inputPerMillion);
  const outputRate = numericField(raw.outputPerMillion);
  if (inputRate === null || inputRate < 0 || inputRate > MAX_RATE_PER_MILLION) {
    return { ok: false, reason: `inputPerMillion 必须是 0..${MAX_RATE_PER_MILLION} 的数值` };
  }
  if (outputRate === null || outputRate < 0 || outputRate > MAX_RATE_PER_MILLION) {
    return { ok: false, reason: `outputPerMillion 必须是 0..${MAX_RATE_PER_MILLION} 的数值` };
  }
  return {
    ok: true,
    value: {
      providerId,
      model,
      currency,
      inputPerMillion: inputRate,
      outputPerMillion: outputRate,
      updatedAt: now.toISOString(),
    },
  };
}
