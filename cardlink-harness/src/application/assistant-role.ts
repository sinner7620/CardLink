import type { Context } from "../domain/context.ts";
import type { ContextPlan } from "../domain/model-capabilities.ts";
import type { RequestTokenBreakdown } from "../domain/request-telemetry.ts";
import type { AssistantMessage } from "../domain/message.ts";
import type { Session } from "../domain/session.ts";
import type { ToolDefinition } from "../domain/tool.ts";
import type { AssistantBudget, ContextBuilder } from "./context-builder.ts";

/** §8.1：Assistant 角色 —— 输入会话，输出 Context<AssistantMessage>。 */
export class AssistantRole {
  constructor(
    private readonly builder: ContextBuilder,
    private readonly tools: ToolDefinition[],
  ) {}

  context(session: Session, continuation = false, budget?: AssistantBudget): Context<AssistantMessage> {
    return this.builder.buildAssistantContext(session, this.tools, continuation, budget);
  }

  /** v2.4 §11.1：最近一次构建的压缩信息（观测/审计/持久化用）。 */
  get compression(): ContextBuilder["lastCompression"] {
    return this.builder.lastCompression;
  }

  /** v2.5 §5.2：最近一次构建的预算计划（用量展示/校准）。 */
  get plan(): ContextPlan | null {
    return this.builder.lastPlan;
  }

  /** v2.14 §22：最近一次构建的输入分项估算（分项之和 == plan.estimatedInputTokens）。 */
  get breakdown(): RequestTokenBreakdown | null {
    return this.builder.lastBreakdown;
  }

  /** v2.5 §5.2：非空表示预算不足，AgentService 不得发起请求。 */
  get budgetError(): "context_budget_insufficient" | null {
    return this.builder.lastBudgetError;
  }
}
