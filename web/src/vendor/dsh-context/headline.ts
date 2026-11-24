/**
 * Vendored from dsh-context (Apache-2.0)
 * https://github.com/bowenliang123/dsh-context/tree/459e2369a4ff6caee912cf8b6dfc35cfac8c77c1
 *   src/client/headline.ts  (Headline 形状 + occupancyPercent)
 *
 * CardLink 修改（最小适配）：
 *  - `headlineOf()` 依赖宿主 `ContextTimeline` / `ContextPressure` / `ContextBreakdown`，
 *    未移植；H1 用遥测行直接构造同一个 `Headline` 形状（见 context-insights.jsx），
 *    因此 `pct` 与 `parts` 都由真实请求分项给出，不做等比例折叠。
 */
import type { PartsPart } from './categories'
import type { ContextReserve } from './reserve'

export interface Headline {
  tokens: number
  window?: number
  pct: number | null
  parts: PartsPart[]
  reserve?: ContextReserve
}

export function occupancyPercent(tokens: number, window: number): number {
  return Math.min(100, Math.round(tokens / window * 1000) / 10)
}
