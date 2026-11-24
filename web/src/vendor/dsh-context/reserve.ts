/**
 * Vendored verbatim from dsh-context (Apache-2.0)
 * https://github.com/bowenliang123/dsh-context/tree/459e2369a4ff6caee912cf8b6dfc35cfac8c77c1
 *   src/client/reserve.ts
 *
 * CardLink 修改：无（原样保留）。
 * 说明：H1 不使用这里的启发式 `reserveGeometry`（压缩阈值 80%/64K 缓冲是宿主的经验值），
 * 而是把遥测里的真实 `inputBudgetTokens` / `outputBudgetTokens` / `reservedTokens` /
 * `compactionTriggerTokens` 直接填进同一个 `ContextReserve` 结构（见 context-insights.jsx）。
 */
export const COMPACT_THRESHOLD_RATIO = 0.8

export const COMPACT_HEADROOM_TOKENS = 65_536

export interface ContextReserve {
  threshold: number
  headroom: number
  output: number
}

export function reserveGeometry(
  window: number | undefined,
  maxOutputTokens: number | undefined,
): ContextReserve | undefined {
  if (window === undefined || !Number.isFinite(window) || window <= 0) return undefined
  const output = Math.min(
    maxOutputTokens !== undefined && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 0,
    window,
  )
  const pressureBudget = window - output - COMPACT_HEADROOM_TOKENS
  if (pressureBudget <= 0) return undefined
  const threshold = Math.min(Math.floor(window * COMPACT_THRESHOLD_RATIO), pressureBudget)
  return { threshold, headroom: COMPACT_HEADROOM_TOKENS, output }
}
