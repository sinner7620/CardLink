import type { ToolCall, ToolResult } from "../domain/message.ts";
import { newToolResult } from "../domain/message.ts";
import type { SessionScope } from "../domain/session.ts";
import type { PolicyStatus } from "./ports/audit-log.ts";
import type { ToolRegistry } from "./tool-registry.ts";
import { validateAgainstSchema } from "./schema-validate.ts";
import { summarizeArgs } from "./ports/audit-log.ts";

export type PolicyCheck =
  | { ok: true; argsSummary?: string }
  | { ok: false; policyStatus: PolicyStatus; reason: string; toolResult: ToolResult };

/**
 * 确定性安全门（§8.2/§11）：是 Reviewer 之外的必要条件，Reviewer 误批准也绕不过。
 * 检查顺序：注册 → 参数 Schema（additionalProperties:false）→ 范围 → 本轮次数上限。
 */
export class PolicyGuard {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly maxToolCallsPerTurn: number,
  ) {}

  /**
   * @param limits v2.16 §11.3：本 Run 生效的工具总量上限（档位值经管理员硬上限收敛）。
   *               缺省沿用构造时的全局默认值；档位不免除任何一项检查。
   */
  check(call: ToolCall, scope: SessionScope, executedThisTurn: number, limits?: { maxToolCalls?: number }): PolicyCheck {
    const deny = (policyStatus: PolicyStatus, status: "denied" | "invalid_args", reason: string): PolicyCheck => ({
      ok: false,
      policyStatus,
      reason,
      toolResult: newToolResult(call.id, status, { code: policyStatus, message: reason }),
    });

    const tool = this.registry.get(call.name);
    if (!tool) {
      return deny("unknown_tool", "denied", `未注册工具: ${call.name}`);
    }

    const schemaErrors = validateAgainstSchema(tool.definition.parameters as never, call.arguments ?? {});
    if (schemaErrors.length) {
      return deny("invalid_args", "invalid_args", `参数不合法: ${schemaErrors.join("; ")}`);
    }

    const args = (call.arguments ?? {}) as { notebookIds?: unknown };
    if (scope.notebookIds.length && Array.isArray(args.notebookIds)) {
      const outside = (args.notebookIds as unknown[]).filter(
        (id) => typeof id === "string" && !scope.notebookIds.includes(id),
      );
      if (outside.length) {
        return deny("scope_escape", "denied", `请求的笔记本超出会话授权范围: ${outside.join(", ")}`);
      }
    }

    const maxToolCalls = limits?.maxToolCalls ?? this.maxToolCallsPerTurn;
    if (executedThisTurn >= maxToolCalls) {
      return deny("limit_exceeded", "denied", `本轮工具调用已达上限 ${maxToolCalls}`);
    }

    return { ok: true, argsSummary: summarizeArgs(call.arguments) };
  }
}
