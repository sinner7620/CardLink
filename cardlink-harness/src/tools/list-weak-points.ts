import { okEnvelope } from "../domain/evidence.ts";
import type { Tool } from "../domain/tool.ts";
import { filterSchema, readOptionalInt, readOptionalString, readOptionalStringArray, resolveRepo, snapshotContext, type ToolDeps } from "./shared.ts";

/**
 * §9：listWeakPoints —— H1 没有规范知识点标签，永远返回 insufficient_labels，
 * 附“原始分类分布”供查看（绝不把笔记本层级/用户标签直接称为薄弱知识点）。
 */
export function createListWeakPoints(deps: ToolDeps): Tool {
  return {
    definition: {
      name: "listWeakPoints",
      description: "薄弱知识点分析。当前数据没有经过确认的知识点标签，因此返回 status=insufficient_labels，并附带原始分类分布（笔记本层级/用户自定义分类，不是知识点）。",
      parameters: filterSchema({
        minSamples: { type: "integer", minimum: 1, maximum: 50, description: "分组最小样本量，默认 10（对分布展示无效，保留参数兼容）" },
      }),
      resultSchema: { type: "object" },
      permission: "mistakes:read",
    },
    async run(args, ctx) {
      const a = args as { subject?: string; notebookIds?: string[]; minSamples?: number };
      readOptionalInt(a.minSamples, "minSamples", 1, 50);
      const repo = resolveRepo(ctx, deps);
      const distribution = await repo.getCategoryDistribution(
        {
          subject: readOptionalString(a.subject, "subject"),
          notebookIds: readOptionalStringArray(a.notebookIds, "notebookIds"),
        },
        ctx.scope,
      );
      const snap = await snapshotContext(ctx, repo);
      return okEnvelope(
        "listWeakPoints",
        {
          status: "insufficient_labels",
          message: "当前错题数据没有可验证的知识点标签，无法计算薄弱知识点。",
          distribution: distribution.map((d) => ({
            path: d.path,
            count: d.count,
            note: "原始分类（笔记本层级或用户自定义分类），非知识点",
          })),
        },
        { snapshotId: snap.snapshotId, dataAsOf: snap.dataAsOf },
      );
    },
  };
}
