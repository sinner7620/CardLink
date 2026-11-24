import { randomUUID } from "../platform/uuid.ts";

export type ISODateTime = string;

export type UserMessage = {
  type: "user";
  id: string;
  text: string;
  createdAt: ISODateTime;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type AssistantMessage = {
  type: "assistant";
  id: string;
  text: string;
  toolCalls: ToolCall[];
  createdAt: ISODateTime;
  /**
   * v2.4 §11.1：该条回答的终止原因（仅最终回答标记；工具轮次不写）。
   * 重开会话时据此提示“回答未完成 · 继续生成”，不再靠 result 缓存推断。
   */
  finishReason?: string;
  /**
   * v2.4 §10.1.1：本条回答经校验的证据引用集合（recordId）。
   * 持久化后，重开会话仍能对 card: 链接做“本轮有效引用”核对。
   */
  evidenceRefs?: string[];
};

export type ToolResultStatus = "ok" | "denied" | "invalid_args" | "timeout" | "error";

export type ToolResult = {
  type: "tool_result";
  id: string;
  toolCallId: string;
  status: ToolResultStatus;
  content: unknown;
  createdAt: ISODateTime;
};

export type AgentMessage = UserMessage | AssistantMessage | ToolResult;

export function newMessageId(): string {
  return randomUUID();
}

export function newUserMessage(text: string, now: Date = new Date()): UserMessage {
  return { type: "user", id: newMessageId(), text, createdAt: now.toISOString() };
}

export function newAssistantMessage(
  text: string,
  toolCalls: ToolCall[],
  now: Date = new Date(),
): AssistantMessage {
  return { type: "assistant", id: newMessageId(), text, toolCalls, createdAt: now.toISOString() };
}

export function newToolResult(
  toolCallId: string,
  status: ToolResultStatus,
  content: unknown,
  now: Date = new Date(),
): ToolResult {
  return { type: "tool_result", id: newMessageId(), toolCallId, status, content, createdAt: now.toISOString() };
}

export function newToolCall(name: string, args: unknown, id?: string): ToolCall {
  return { id: id ?? newMessageId(), name, arguments: args };
}

export function isUserMessage(m: AgentMessage): m is UserMessage {
  return m.type === "user";
}

export function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.type === "assistant";
}

export function isToolResult(m: AgentMessage): m is ToolResult {
  return m.type === "tool_result";
}

/** §10.1：校验用户消息长度与类型。超限返回错误说明，不静默截断。 */
export const USER_TEXT_MAX_LENGTH = 8000;

export function validateUserText(text: unknown): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof text !== "string") return { ok: false, reason: "消息必须是字符串" };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "消息不能为空" };
  if (trimmed.length > USER_TEXT_MAX_LENGTH) {
    return { ok: false, reason: `消息超过最大长度 ${USER_TEXT_MAX_LENGTH}` };
  }
  return { ok: true, text: trimmed };
}
