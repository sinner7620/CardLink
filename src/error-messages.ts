/**
 * 用户可读的错误文案映射：HUD 不直接展示原始异常串（可含内部路径/英文堆栈），
 * 完整异常仍通过 MN.error / 运行日志保留供诊断。
 */
const ERROR_TEXTS: Array<[RegExp, string]> = [
  [/索引/, "答案索引尚未建立或已过期，请先在设置中刷新答案索引"],
  [/不存在|已被删除|not found/i, "目标内容不存在或已被删除，请刷新后重试"],
  [/noteId|卡片/, "所选卡片无效，请重新选择"],
  [/超时|timeout/i, "操作超时，请稍后重试"],
  [/网络|network|fetch|http/i, "网络连接失败，请检查网络后重试"],
  [/JSON|解析|parse/i, "数据解析失败，请刷新索引后重试"],
  [/权限|permission/i, "没有执行该操作的权限"]
]

/**
 * 已经是面向用户策划过的错误文案，直接透传（否则会被下方兜底文案吞掉，
 * 例如跳转重试超时的具体提示、更新包体积校验的具体原因）。
 */
const PASSTHROUGH_PATTERNS = [
  /^更新包下载不完整/,
  /^原题脑图尚未加载完成/,
  /^打开了原题链接，但脑图加载超时/,
  /^无法打开原题链接/,
  /^复习失败：未能写入原题标签/,
  /^标记错题失败：/
]

export function describeError(error: unknown, fallback = "操作失败，请重试；若持续出现请开启调试模式导出日志"): string {
  // Error 实例取 message：String(error) 会带 "Error: " 前缀，锚定正则全部失配
  const raw = error instanceof Error ? error.message : String(error ?? "")
  if (PASSTHROUGH_PATTERNS.some(pattern => pattern.test(raw))) return raw
  for (const [pattern, text] of ERROR_TEXTS) {
    if (pattern.test(raw)) return text
  }
  return fallback
}
