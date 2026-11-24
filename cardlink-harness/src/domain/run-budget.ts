/**
 * v2.16 §11.3：复杂任务分级运行预算（Domain 纯函数）。
 *
 * 档位由用户/可信 UI 选择，在 Run 入列时解析并固定；模型没有选择或扩大预算的通道。
 * 每个档位同时受管理员硬上限约束（min），并保留单工具超时、token 预算、取消与审计。
 */

export type BudgetTier = "simple" | "comparison" | "deep";

export type BudgetCaps = {
  /** 所有档位的迭代硬上限。 */
  maxIterations: number;
  /** 所有档位的本 Run 工具总量硬上限。 */
  maxToolCalls: number;
  /** 所有档位的本 Run 总时限硬上限（毫秒）。 */
  maxDurationMs: number;
};

export type RunBudget = {
  /** 缺省 = 未选档旧调用（使用管理员配置的默认上限）。 */
  tier?: BudgetTier;
  maxIterations: number;
  maxToolCalls: number;
  maxDurationMs: number;
  /** 是否来自显式档位（false = legacy 默认上限）。 */
  fromTier: boolean;
};

export const BUDGET_TIERS: Record<BudgetTier, { label: string; iterations: number; toolCalls: number; durationMs: number; hint: string }> = {
  simple: { label: "简单", iterations: 4, toolCalls: 8, durationMs: 300_000, hint: "单题或简单追问（4 次迭代 / 8 次工具）" },
  comparison: { label: "多题比较", iterations: 8, toolCalls: 16, durationMs: 600_000, hint: "多题比较与归纳（8 次迭代 / 16 次工具）" },
  deep: { label: "深度诊断", iterations: 12, toolCalls: 24, durationMs: 1_200_000, hint: "深度诊断与跨集合核对（12 次迭代 / 24 次工具）" },
};

export const BUDGET_TIER_VALUES: BudgetTier[] = ["simple", "comparison", "deep"];
export const DEFAULT_BUDGET_TIER: BudgetTier = "simple";
/** 管理员硬上限缺省值（规范 §11.3）。 */
export const DEFAULT_BUDGET_CAPS: BudgetCaps = { maxIterations: 12, maxToolCalls: 24, maxDurationMs: 1_200_000 };

export function validateBudgetTier(value: unknown): { ok: true; tier: BudgetTier } | { ok: false; reason: string } {
  if (value === "simple" || value === "comparison" || value === "deep") return { ok: true, tier: value };
  return { ok: false, reason: `budgetTier 必须是 simple/comparison/deep，收到 ${String(value)}` };
}

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 档位 → 生效预算（与管理员硬上限取 min；非法硬上限回退规范默认值）。 */
export function resolveRunBudget(tier: BudgetTier, caps: BudgetCaps): RunBudget {
  const spec = BUDGET_TIERS[tier];
  return {
    tier,
    maxIterations: Math.max(1, Math.min(spec.iterations, positiveInt(caps.maxIterations, spec.iterations))),
    maxToolCalls: Math.max(1, Math.min(spec.toolCalls, positiveInt(caps.maxToolCalls, spec.toolCalls))),
    maxDurationMs: Math.max(1_000, Math.min(spec.durationMs, positiveInt(caps.maxDurationMs, spec.durationMs))),
    fromTier: true,
  };
}

/** 未选档旧调用：沿用管理员配置的默认上限（不套用新档位默认值）。 */
export function legacyRunBudget(defaults: BudgetCaps): RunBudget {
  return {
    maxIterations: Math.max(1, positiveInt(defaults.maxIterations, BUDGET_TIERS.simple.iterations)),
    maxToolCalls: Math.max(1, positiveInt(defaults.maxToolCalls, BUDGET_TIERS.simple.toolCalls)),
    maxDurationMs: Math.max(1_000, positiveInt(defaults.maxDurationMs, BUDGET_TIERS.deep.durationMs)),
    fromTier: false,
  };
}
