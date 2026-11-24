import type { OutputSchema } from "./context.ts";

export type Decision = { approved: boolean; reason: string };

/** Reviewer 输出契约：approved 必须为布尔、reason 必须为非空字符串；多余字段忽略。 */
export function decisionOutputSchema(): OutputSchema<Decision> {
  return {
    name: "tool_call_decision",
    jsonSchema: {
      type: "object",
      properties: {
        approved: { type: "boolean" },
        reason: { type: "string", minLength: 1 },
      },
      required: ["approved", "reason"],
      additionalProperties: false,
    },
    parse(raw: unknown): Decision {
      if (raw === null || typeof raw !== "object") {
        throw new Error("decision 输出必须是对象");
      }
      const o = raw as Record<string, unknown>;
      if (typeof o.approved !== "boolean") throw new Error("decision.approved 必须是布尔");
      if (typeof o.reason !== "string" || !o.reason.trim()) throw new Error("decision.reason 必须是非空字符串");
      return { approved: o.approved, reason: o.reason.trim().slice(0, 500) };
    },
  };
}
