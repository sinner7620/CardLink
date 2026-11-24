import type { Context } from "../domain/context.ts";
import type { Decision } from "../domain/decision.ts";
import type { ToolCall } from "../domain/message.ts";
import type { Session, SessionScope } from "../domain/session.ts";
import type { ToolRegistry } from "./tool-registry.ts";
import type { ContextBuilder } from "./context-builder.ts";
import type { ReviewChainContext } from "./review-policy.ts";

/**
 * §8.2：Reviewer 角色 —— 无工具、仅决策，第二次模型调用。
 * 注意：Reviewer 不是权限系统；即使误批准，PolicyGuard 仍会拒绝。
 * v2.2 §10.1：Reviewer 仅对档位要求审核的调用参与。
 */
export class ReviewerRole {
  constructor(
    private readonly builder: ContextBuilder,
    private readonly registry: ToolRegistry,
  ) {}

  context(session: Session, call: ToolCall, scope: SessionScope, chain?: ReviewChainContext): Context<Decision> {
    const definition = this.registry.get(call.name)?.definition;
    if (!definition) {
      // 不可达路径（PolicyGuard 先行）；防御性构造空定义上下文。
      throw new Error(`Reviewer 上下文构建失败：未知工具 ${call.name}`);
    }
    return this.builder.buildReviewerContext(session, call, definition, scope, chain);
  }
}
