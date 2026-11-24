/** 插件面板内的更新提示载荷；原生 updater 推给面板，面板选择后带 promptId 回传。 */
export interface UpdatePromptPayload {
  version: string
  channel: string
  source: string
  currentVersion: string
  /** Release 正文的纯文本摘要：原生弹窗（系统兜底）与旧面板都用它。 */
  notes: string
  /**
   * Release 正文的原 Markdown，供 Web 更新确认弹窗渲染。
   * 可选：旧原生版本不会带这个字段，面板必须回退到 `notes` 纯文本。
   */
  notesMarkdown?: string
}

export interface UpdatePromptMessage extends UpdatePromptPayload {
  promptId?: string
  close?: boolean
}

/**
 * 归一化面板收到的更新提示。
 *
 * 只把带版本号的载荷当作要显示的弹窗；关闭信号（`close: true`）、旧版本实现直接推的
 * `null`、场景通道补成的 `{}` 以及任何缺少版本的载荷都按关闭处理，避免显示空壳弹窗。
 * 关闭只作用于同一 `promptId` 的提示：过期计时器或旧请求不能关掉随后到达的新提示。
 */
export function normalizeUpdatePrompt(payload: unknown, current: UpdatePromptMessage | null): UpdatePromptMessage | null {
  const message = payload && typeof payload === "object" ? payload as UpdatePromptMessage : null
  const closing = !message || message.close === true || typeof message.version !== "string" || !message.version
  if (!closing) return message
  const promptId = typeof message?.promptId === "string" ? message.promptId : ""
  if (promptId && current && current.promptId !== promptId) return current
  return null
}
