/**
 * Vendored from dsh-context (Apache-2.0)
 * https://github.com/bowenliang123/dsh-context/tree/459e2369a4ff6caee912cf8b6dfc35cfac8c77c1
 *   src/client/viewkit.ts        (只取本面板用到的 t / fmt / catLabel 三个能力)
 *   src/client/i18nZh.ts         (只取本面板用到的词条，原文照抄)
 *   src/client/format.ts         (只取 token 数字格式)
 *
 * CardLink 修改（最小适配）：
 *  - 上游 ViewKit 由宿主注入语言、格式化与事件标签；这里固定中文并只保留三个方法；
 *  - `catLabel` 允许调用方覆盖，以便把上游分类名换成 H1 分项名（键与颜色不变）；
 *  - 去掉 `useLocaleTick` / `fmtDuration` / `eventLabel` / `eventAt`（趋势图精简版不用）。
 */

/** 与上游同名的词条（键名保留，值取 i18nZh.ts 原文）。 */
const DICT = {
  'overview.title': '当前上下文',
  'overview.estimate': 'tokens（估算）',
  'overview.free': '剩余窗口',
  'overview.used': '上下文已用',
  'overview.ofUsed': '占已用上下文',
  'overview.ofWindow': '占窗口',
  'overview.reserveHeadroom': '压缩预留空间',
  'overview.reserveOutput': '模型最大输出预留',
  'overview.reserveHeadroomTip': '自动压缩预计在窗口的 {p}% 处触发',
  'overview.reserveHeadroomBuffer': '在输出预留之前留出的缓冲',
  'overview.reserveOutputTip': '模型最大输出 token 数',
  'overview.reserveTrigger': '自动压缩触发线',
  'overview.reserveTriggerTip': '已用量到达此线时触发压缩',
  'trend.title': '上下文趋势',
  'trend.empty': '发起一轮对话后，这里会展示每次模型请求的上下文构成',
  'cat.system': '系统提示词',
  'cat.tools': '工具定义',
  'cat.user': '用户消息',
  'cat.inject': '注入内容',
  'cat.skill': '技能注入',
  'cat.assistant': '助手消息',
  'cat.tool': '工具结果',
} as const

export type LcKey = keyof typeof DICT

export type LcKit = {
  t: (key: LcKey, params?: Record<string, string | number>) => string
  fmt: (value: number) => string
  catLabel: (key: string) => string
}

/** 与上游 format.ts 的 token 数字格式一致（千分位、取整）。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('zh-CN')
}

export function makeKit(overrides: { catLabel?: (key: string) => string } = {}): LcKit {
  const t = (key: LcKey, params?: Record<string, string | number>): string => {
    const template: string = DICT[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
      params[name] === undefined ? `{${name}}` : String(params[name]))
  }
  const catLabel = (key: string): string => {
    if (overrides.catLabel !== undefined) return overrides.catLabel(key)
    const dictKey = `cat.${key}` as LcKey
    return DICT[dictKey] ?? key
  }
  return { t, fmt: formatTokens, catLabel }
}
