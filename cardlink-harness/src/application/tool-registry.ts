import { createBuildReviewQueue, createRenderVisualization } from "../tools/answer-artifacts.ts";
import type { Tool, ToolDefinition } from "../domain/tool.ts";
import { createGetMistakeDetail } from "../tools/get-mistake-detail.ts";
import { createGetMistakeStats, type StatsToolDeps } from "../tools/get-mistake-stats.ts";
import { createGetReviewHistory } from "../tools/get-review-history.ts";
import { createListWeakPoints } from "../tools/list-weak-points.ts";
import { createQueryMistakes } from "../tools/query-mistakes.ts";

/** §9 工具白名单 v1：H1 只允许注册以下五个只读工具。新增工具必须先修订规范。 */
export const ALLOWED_TOOL_NAMES = ["queryMistakes", "getMistakeDetail", "getMistakeStats", "getReviewHistory", "listWeakPoints"] as const;

export const TOOL_PROTOCOL_V2_NAMES = [...ALLOWED_TOOL_NAMES, "renderVisualization", "buildReviewQueue"] as const;

export type AllowedToolName = (typeof ALLOWED_TOOL_NAMES)[number];

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(readonly version: 1 | 2 = 1) {}

  register(tool: Tool): this {
    const allowed = this.version === 2 ? TOOL_PROTOCOL_V2_NAMES : ALLOWED_TOOL_NAMES;
    if (!(allowed as readonly string[]).includes(tool.definition.name)) {
      throw new Error(`工具 ${tool.definition.name} 不在 §9 白名单中，拒绝注册`);
    }
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`工具重复注册: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  registerDefaults(deps: StatsToolDeps): this {
    this
      .register(createQueryMistakes(deps))
      .register(createGetMistakeDetail(deps))
      .register(createGetMistakeStats(deps))
      .register(createGetReviewHistory(deps))
      .register(createListWeakPoints(deps));
    if (this.version === 2) this.register(createRenderVisualization()).register(createBuildReviewQueue(deps));
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  size(): number {
    return this.tools.size;
  }
}
