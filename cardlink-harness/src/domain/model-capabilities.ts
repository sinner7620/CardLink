/**
 * v2.5 §5.2：模型能力与上下文预算数据契约（冻结）。
 *
 * 上下文窗口与最大输出量属于模型服务商能力，不能由模型名推断。能力来源优先级：
 * user（用户覆盖）> verified（仓库内已验证预置）> provider（服务商目录/文档）
 * > default（未知能力的保守回退）。
 */
export type CapabilitySource = "user" | "verified" | "provider" | "default";

export type ModelCapabilities = {
  providerId: string;
  modelId: string;
  /** C：上下文窗口（token）。 */
  contextWindowTokens: number;
  /** 服务商允许的单次生成上限（token）。 */
  maxOutputTokens: number;
  supportsToolCalls: boolean;
  /** 服务商是否返回 prompt/completion tokens。 */
  supportsUsage: boolean;
  /** 估算器标识；校准按此 id 记录。 */
  tokenEstimatorId: string;
  source: CapabilitySource;
};

/** 未知能力的保守回退：32K 窗口、8,192 输出。 */
export const CONSERVATIVE_CAPABILITIES = {
  contextWindowTokens: 32 * 1024,
  maxOutputTokens: 8 * 1024,
  supportsToolCalls: true,
  supportsUsage: false,
  tokenEstimatorId: "heuristic-v1",
} as const;

export const MAX_REASONABLE_CONTEXT_WINDOW = 4_000_000;

export function defaultCapabilities(providerId: string, modelId: string): ModelCapabilities {
  return {
    providerId,
    modelId,
    ...CONSERVATIVE_CAPABILITIES,
    source: "default",
  };
}

export function capabilitiesKey(providerId: string, modelId: string): string {
  return `${providerId.trim().toLowerCase()}::${modelId.trim().toLowerCase()}`;
}

export type CapabilityValidation =
  | { ok: true; value: ModelCapabilities }
  | { ok: false; reason: string };

/** 用户覆盖校验：窗口/输出必须为正整数且输出不超过窗口；未知字段忽略。 */
export function validateUserCapabilities(
  input: unknown,
  fallbackEstimatorId = "heuristic-v1",
): CapabilityValidation {
  const raw = input as Partial<ModelCapabilities> | null;
  if (!raw || typeof raw !== "object") return { ok: false, reason: "能力配置必须是对象" };
  const providerId = typeof raw.providerId === "string" ? raw.providerId.trim() : "";
  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
  if (!providerId || providerId.length > 128) return { ok: false, reason: "providerId 缺失或过长" };
  if (!modelId || modelId.length > 256) return { ok: false, reason: "modelId 缺失或过长" };
  const window = Number(raw.contextWindowTokens);
  const maxOut = Number(raw.maxOutputTokens);
  if (!Number.isInteger(window) || window < 1024 || window > MAX_REASONABLE_CONTEXT_WINDOW) {
    return { ok: false, reason: `contextWindowTokens 必须是 1024..${MAX_REASONABLE_CONTEXT_WINDOW} 的整数` };
  }
  if (!Number.isInteger(maxOut) || maxOut < 1 || maxOut > window) {
    return { ok: false, reason: "maxOutputTokens 必须是正整数且不超过上下文窗口" };
  }
  return {
    ok: true,
    value: {
      providerId,
      modelId,
      contextWindowTokens: window,
      maxOutputTokens: maxOut,
      supportsToolCalls: raw.supportsToolCalls !== false,
      supportsUsage: raw.supportsUsage === true,
      tokenEstimatorId:
        typeof raw.tokenEstimatorId === "string" && raw.tokenEstimatorId.trim()
          ? raw.tokenEstimatorId.trim()
          : fallbackEstimatorId,
      source: "user",
    },
  };
}

/** v2.5 §5.2：一次请求的上下文计划（预算计算结果）。 */
export type ContextPlan = {
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  /** 压缩前的完整历史估算（可选；UI 用来说明"为什么触发了压缩"）。 */
  estimatedFullTokens?: number;
  outputBudgetTokens: number;
  reservedTokens: number;
  requiresCompaction: boolean;
  includedMessageIds: string[];
  compactionId?: string;
};
