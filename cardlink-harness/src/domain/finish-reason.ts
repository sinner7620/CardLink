/**
 * v2.4 §11.1：轮次终止原因（冻结枚举）。
 * Turn 结果与 Run 记录携带；替代三态 status 的粗粒度语义（status 保留为兼容字段）。
 */
export type FinishReason =
  | "completed"
  | "output_limit"
  | "context_limit"
  | "iteration_limit"
  | "tool_result_truncated"
  | "timeout"
  | "cancelled"
  | "provider_error";

export const FINISH_REASONS: readonly FinishReason[] = [
  "completed",
  "output_limit",
  "context_limit",
  "iteration_limit",
  "tool_result_truncated",
  "timeout",
  "cancelled",
  "provider_error",
];

export function isFinishReason(value: unknown): value is FinishReason {
  return typeof value === "string" && (FINISH_REASONS as readonly string[]).includes(value);
}

/**
 * 服务商 finish_reason → FinishReason（消息级映射）：
 * stop/tool_calls → completed（tool_calls 的循环语义由 AgentService 处理）；
 * length → output_limit；content_filter → provider_error；未知 → completed（不伪造）。
 */
export function providerFinishReasonOf(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "stop":
    case "tool_calls":
    case "function_call":
      return "completed";
    case "length":
    case "max_output_tokens":
      return "output_limit";
    case "content_filter":
      return "provider_error";
    default:
      return "completed";
  }
}

/**
 * 模型调用错误文本 → FinishReason（错误路径分类）：
 * 超时 → timeout；上下文超限关键词 → context_limit；其余 → provider_error。
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context length/i,
  /maximum context/i,
  /context_length_exceeded/i,
  /too many tokens/i,
  /prompt is too long/i,
  /request_too_large/i,
  /exceeds? .*token/i,
];

export function classifyModelError(message: string): FinishReason {
  if (/^model_timeout/.test(message) || /\btimeout\b/i.test(message.slice(0, 80))) return "timeout";
  // §5.2：本地预算拦截归入 context_limit；只有服务商超限才可触发重试。
  if (/^context_budget_insufficient/.test(message)) return "context_limit";
  if (CONTEXT_OVERFLOW_PATTERNS.some((re) => re.test(message))) return "context_limit";
  return "provider_error";
}
