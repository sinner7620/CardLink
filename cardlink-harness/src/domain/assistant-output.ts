import { newMessageId, type AssistantMessage, type ToolCall } from "./message.ts";
import type { OutputSchema } from "./context.ts";

/**
 * Assistant 输出契约：模型只需给出 text 与 toolCalls；
 * type/id/createdAt 由服务端填充，避免模型伪造消息元数据。
 */
export function assistantMessageOutputSchema(): OutputSchema<AssistantMessage> {
  return {
    name: "assistant_message",
    jsonSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        toolCalls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
            },
            required: ["id", "name"],
            additionalProperties: true,
          },
        },
      },
      required: ["text", "toolCalls"],
      additionalProperties: false,
    },
    parse(raw: unknown): AssistantMessage {
      if (raw === null || typeof raw !== "object") throw new Error("assistant 输出必须是对象");
      const o = raw as Record<string, unknown>;
      if (typeof o.text !== "string") throw new Error("assistant.text 必须是字符串");
      const rawCalls = o.toolCalls;
      if (!Array.isArray(rawCalls)) throw new Error("assistant.toolCalls 必须是数组");
      const toolCalls: ToolCall[] = rawCalls.map((c, i) => {
        if (c === null || typeof c !== "object") throw new Error(`toolCalls[${i}] 必须是对象`);
        const call = c as Record<string, unknown>;
        if (typeof call.id !== "string" || !call.id.trim()) throw new Error(`toolCalls[${i}].id 非法`);
        if (typeof call.name !== "string" || !call.name.trim()) throw new Error(`toolCalls[${i}].name 非法`);
        return {
          id: call.id.trim().slice(0, 128),
          name: call.name.trim(),
          arguments: call.arguments ?? {},
        };
      });
      if (toolCalls.length > 8) throw new Error("单条消息工具调用数超过上限 8");
      return {
        type: "assistant",
        id: newMessageId(),
        text: o.text,
        toolCalls,
        createdAt: new Date().toISOString(),
      };
    },
  };
}
