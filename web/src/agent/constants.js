/**
 * AI 分析面板共享常量与纯函数（新前端：web/src/agent/*）。
 * 只放无副作用的展示逻辑；运行与数据状态在 hooks.js。
 */

export const SCENE_READY =
  typeof window !== "undefined" &&
  window.__MN_SCENE_ENABLED__ === true &&
  Boolean(window.mn)

export const DEFAULT_REVIEW_LEVEL = "provenance"

/** §10.1 审核档位（会话属性，作用于下一轮）。 */
export const REVIEW_LEVELS = [
  { value: "strict", label: "严格审核", hint: "所有工具调用都经模型审核者复核" },
  { value: "provenance", label: "溯源免审", hint: "可溯源的详情/历史下钻免审，新数据访问仍复核" },
  { value: "full_allow", label: "完全允许", hint: "只保留确定性检查，不再调用模型审核者" },
]

export const PHASE_TEXT = {
  created: "排队中",
  assistant_pending: "思考中",
  review_pending: "审核中",
  tool_pending: "读取错题数据",
  tool_completed: "读取完成",
  final_pending: "整理回答",
  finished: "完成",
  interrupted: "已停止",
  failed: "出错",
}

/** v2.4 §11.1 FinishReason 的用户可读文案。 */
export const FINISH_REASON_TEXT = {
  output_limit: "输出长度达到模型上限，回答可能不完整",
  context_limit: "对话上下文超出模型窗口限制",
  iteration_limit: "达到本轮工具调用迭代上限",
  tool_result_truncated: "工具返回的数据被截断，本轮未得出完整结论",
  timeout: "模型或工具执行超时",
  cancelled: "已手动停止",
  provider_error: "模型服务返回错误",
}

/** 面板内稳定的乐观消息 ID（crypto 不可用时回退时间戳+随机）。 */
export function newUiId() {
  const c = typeof crypto !== "undefined" ? crypto : undefined
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function reviewLevelOf(session) {
  const level = session?.reviewLevel
  return REVIEW_LEVELS.some((item) => item.value === level) ? level : DEFAULT_REVIEW_LEVEL
}

export function safeParse(json) {
  if (!json) return undefined
  try { return JSON.parse(json) } catch { return undefined }
}

/** §10.1：免审调用在审计里以 tier_skip 标记，UI 必须区别于「已审核」。 */
export function isTierSkipped(call) {
  if (call?.reviewerApproved !== undefined) return false
  return typeof call?.reviewerReason === "string" && call.reviewerReason.startsWith("tier_skip")
}

export function auditOf(call) {
  if (isTierSkipped(call)) return "skipped"
  if (call?.reviewerApproved === true) return "approved"
  return undefined
}

export function toolStateOf(executionStatus) {
  if (executionStatus === "executed") return "output-available"
  if (executionStatus === "denied") return "output-denied"
  if (executionStatus === "timeout") return "output-error"
  return "input-available"
}

export function formatRelative(value) {
  const time = Date.parse(value ?? "")
  if (!Number.isFinite(time)) return "—"
  const diff = Date.now() - time
  if (diff < 60000) return "刚刚"
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return new Date(time).toLocaleDateString()
}

/** §12：开发者诊断模式（内部 ID / 原始 JSON），默认关闭并跨会话记忆。 */
export const DIAGNOSTIC_KEY = "cardlink.agent.diagnostic"

export function readDiagnostic() {
  try {
    if (typeof window === "undefined") return false
    return window.localStorage?.getItem(DIAGNOSTIC_KEY) === "1"
  } catch {
    return false
  }
}
