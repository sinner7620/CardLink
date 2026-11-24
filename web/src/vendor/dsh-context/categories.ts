/**
 * Vendored from dsh-context (Apache-2.0)
 * https://github.com/bowenliang123/dsh-context/tree/459e2369a4ff6caee912cf8b6dfc35cfac8c77c1
 *   src/shared/categories.ts  (PartsPart / CATS / CAT_COLOR / partsOf)
 *   src/client/categories.ts  (re-export shim, skipped)
 *
 * CardLink 修改（最小适配）：
 *  - 保留 `PartsPart`、`CATS`、`CAT_COLOR` 原样（键与颜色值不改）；
 *  - 上游 `partsOf(breakdown)` 读取宿主 `Snapshot['current']` / `RequestRecord`，
 *    这里改为接收 `Record<string, number>`（H1 遥测的六项分项）；
 *  - `officialParts` / `anchoredParts` / `billedParts` 依赖宿主组成投影与计费账本，
 *    H1 分项本身就是实测估算值，不需要等比例折叠 → 未移植（见 NOTICE.md）。
 */
export interface PartsPart {
  key: string
  color: string
  value: number
  raw?: number
  label?: string
  group?: string
}

export const CATS: { key: string; color: string }[] = [
  { key: 'system', color: 'var(--color-indigo-500)' },
  { key: 'tools', color: 'var(--color-amber-500)' },
  { key: 'user', color: 'var(--color-green-500)' },
  { key: 'inject', color: 'var(--color-purple-500)' },
  { key: 'skill', color: 'var(--color-orange-500)' },
  { key: 'assistant', color: 'var(--color-blue-500)' },
  { key: 'tool', color: 'var(--color-teal-500)' },
]

export const CAT_COLOR = Object.fromEntries(CATS.map(c => [c.key, c.color])) as Record<string, string>

export function partsOf(values: Record<string, number | undefined>): PartsPart[] {
  return CATS.map((c) => {
    return { key: c.key, color: c.color, value: values[c.key] || 0 }
  })
}
