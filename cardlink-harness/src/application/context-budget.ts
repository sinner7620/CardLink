import type { ContextPlan, ModelCapabilities } from "../domain/model-capabilities.ts";

/**
 * v2.5 §5.2：上下文预算（ContextBudgetManager）。
 * B_input = C − O − R；O 取请求值与服务商上限的较小者，并受窗口约束。
 */
export type BudgetPolicy = {
  /** R：安全余量。 */
  reservedTokens: number;
  /** 触发压缩的输入占比（初始 0.85）。 */
  triggerRatio: number;
  /** 近期原文保留上限（token）。 */
  recentRetentionMaxTokens: number;
  /** 近期原文占输入预算的比例上限。 */
  recentRetentionRatio: number;
  /** 低于该输入预算直接拒绝请求。 */
  minInputBudgetTokens: number;
  /** 压缩摘要自身 token 上限。 */
  summaryMaxTokens: number;
};

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  reservedTokens: 4096,
  triggerRatio: 0.85,
  recentRetentionMaxTokens: 20000,
  recentRetentionRatio: 0.4,
  minInputBudgetTokens: 2048,
  summaryMaxTokens: 4096,
};

export type BudgetRequest = {
  capabilities: ModelCapabilities;
  /** 角色配置请求的输出上限。 */
  requestedOutputTokens: number;
  /** 本次预计输入（系统指令 + 工具 + 消息）。 */
  estimatedInputTokens: number;
};

export type BudgetOutcome = {
  plan: ContextPlan;
  /** 非空表示预算不足以发起请求（不得静默缩水后仍发送）。 */
  error?: "context_budget_insufficient";
};

export function resolveBudgetPolicy(overrides?: Partial<BudgetPolicy>): BudgetPolicy {
  const merged = { ...DEFAULT_BUDGET_POLICY, ...(overrides ?? {}) };
  // 防御非法配置：阈值与比例限定在合理区间。
  merged.triggerRatio = Math.min(0.98, Math.max(0.5, merged.triggerRatio));
  merged.recentRetentionRatio = Math.min(0.8, Math.max(0.1, merged.recentRetentionRatio));
  merged.reservedTokens = Math.max(0, Math.floor(merged.reservedTokens));
  merged.minInputBudgetTokens = Math.max(512, Math.floor(merged.minInputBudgetTokens));
  return merged;
}

/** §5.2 预算规则：小窗口按比例缩小安全余量，避免 4K 模型被固定预留挤死。 */
export function reservedForWindow(contextWindowTokens: number, policy: BudgetPolicy): number {
  return Math.min(policy.reservedTokens, Math.max(512, Math.floor(contextWindowTokens * 0.125)));
}

export function compactionTriggerTokens(inputBudgetTokens: number, policy = DEFAULT_BUDGET_POLICY): number {
  return Math.floor(inputBudgetTokens * policy.triggerRatio);
}

export function computeContextPlan(request: BudgetRequest, overrides?: Partial<BudgetPolicy>): BudgetOutcome {
  const policy = resolveBudgetPolicy(overrides);
  const windowTokens = Math.max(1024, Math.floor(request.capabilities.contextWindowTokens));
  const reserved = reservedForWindow(windowTokens, policy);
  const capabilityMaxOutput = Math.max(1, Math.min(windowTokens, Math.floor(request.capabilities.maxOutputTokens)));
  const requested = Number.isFinite(request.requestedOutputTokens) ? Math.floor(request.requestedOutputTokens) : capabilityMaxOutput;
  const maxOutputForWindow = Math.max(256, windowTokens - reserved - policy.minInputBudgetTokens);
  const outputBudget = Math.max(1, Math.min(requested, capabilityMaxOutput, maxOutputForWindow));
  const inputBudget = windowTokens - outputBudget - reserved;
  const estimated = Math.max(0, Math.ceil(request.estimatedInputTokens));

  const plan: ContextPlan = {
    inputBudgetTokens: inputBudget,
    estimatedInputTokens: estimated,
    outputBudgetTokens: outputBudget,
    reservedTokens: reserved,
    requiresCompaction: estimated > compactionTriggerTokens(inputBudget, policy),
    includedMessageIds: [],
  };

  if (inputBudget < policy.minInputBudgetTokens) {
    return { plan, error: "context_budget_insufficient" };
  }
  return { plan };
}

/** 近期原文保留预算：min(20k, 40% · B_input)。 */
export function recentRetentionTokens(inputBudgetTokens: number, overrides?: Partial<BudgetPolicy>): number {
  const policy = resolveBudgetPolicy(overrides);
  return Math.max(0, Math.min(policy.recentRetentionMaxTokens, Math.floor(inputBudgetTokens * policy.recentRetentionRatio)));
}

export function summaryBudgetTokens(inputBudgetTokens: number, overrides?: Partial<BudgetPolicy>): number {
  const policy = resolveBudgetPolicy(overrides);
  return Math.max(256, Math.min(policy.summaryMaxTokens, Math.floor(inputBudgetTokens * 0.25)));
}
