import { okEnvelope } from "../domain/evidence.ts";
import type { Tool } from "../domain/tool.ts";
import { assertTimeRange, filterSchema, readOptionalInstant, readOptionalInt, readOptionalIso, readOptionalString, readOptionalStringArray, resolveRepo, type ToolDeps } from "./shared.ts";
import type { MistakeReportFilter } from "../domain/mistake.ts";
import { StatisticsEngine } from "../application/statistics-engine.ts";

export type StatsToolDeps = ToolDeps & { statisticsEngine: StatisticsEngine };

/** §9：getMistakeStats —— 数字只由 StatisticsEngine/SQL 计算（§12 口径）。 */
export function createGetMistakeStats(deps: StatsToolDeps): Tool {
  return {
    definition: {
      name: "getMistakeStats",
      description: "确定性错题统计。默认返回总数、等级分布、到期和复习数；errorReasons 返回最常见错因；reviewActivity 按复习事件时间汇总题数和次数；coverage 返回按学习集/分类/自定义标签的题干、可授权可定位答案与复习历史覆盖率；repeatedReviewErrors 返回复习记录中反复带非空错因的题目（≥2 笔可核实复习事件，不含入册标记），并回传覆盖与截断；只表示复习记录带错因，不代表实际答错。",
      parameters: filterSchema({
        from: { type: "string", description: "ISO 时间下界（按 updatedAt）" },
        to: { type: "string", description: "ISO 时间上界（按 updatedAt）" },
        statsTime: { type: "string", description: "常规统计的到期基准时刻，缺省为当前时刻" },
        timezone: { type: "string", maxLength: 64, description: "统计时区（IANA 名称），缺省为服务本地时区" },
        report: { type: "string", enum: ["errorReasons", "reviewActivity", "coverage", "repeatedReviewErrors"], description: "错因分布、复习活动、覆盖率或跨题错因复习历史；省略返回常规统计" },
        reviewFrom: { type: "string", maxLength: 40, description: "reviewActivity / repeatedReviewErrors 的复习发生时间下界（含），带时区的 ISO 时间" },
        reviewBefore: { type: "string", maxLength: 40, description: "reviewActivity / repeatedReviewErrors 的复习发生时间上界（不含），带时区的 ISO 时间" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "coverage 每组或 repeatedReviewErrors 每题榜单的最大条数（默认 20）" },
      }),
      resultSchema: { type: "object" },
      permission: "mistakes:read",
    },
    async run(args, ctx) {
      const a = args as Partial<MistakeReportFilter> & { statsTime?: string; timezone?: string };
      const reviewFrom = readOptionalInstant(a.reviewFrom, "reviewFrom");
      const reviewBefore = readOptionalInstant(a.reviewBefore, "reviewBefore");
      const windowedReport = a.report === "reviewActivity" || a.report === "repeatedReviewErrors";
      if ((reviewFrom || reviewBefore) && !windowedReport) {
        throw new Error("复习时间区间仅适用于 reviewActivity 或 repeatedReviewErrors");
      }
      assertTimeRange(reviewFrom, reviewBefore, "复习区间");
      // 统计经引擎跑在运行锁定视图上（§6.2 + §12：数字只由引擎/SQL 产生）。
      const engine = new StatisticsEngine(resolveRepo(ctx, deps));
      const request = {
        filter: {
          subject: readOptionalString(a.subject, "subject"),
          notebookIds: readOptionalStringArray(a.notebookIds, "notebookIds"),
          from: readOptionalIso(a.from, "from"),
          to: readOptionalIso(a.to, "to"),
        },
        scope: ctx.scope,
        statsTime: readOptionalIso(a.statsTime, "statsTime"),
        timezone: readOptionalString(a.timezone, "timezone", 64),
      };
      const stats = a.report
        ? await engine.getReport({
            ...request,
            filter: {
              ...request.filter,
              report: a.report,
              reviewFrom,
              reviewBefore,
              ...((a.report === "coverage" || a.report === "repeatedReviewErrors")
                ? { limit: readOptionalInt(a.limit, "limit", 1, 50) ?? 20 }
                : {}),
            },
          })
        : { ...await engine.getStats(request), filter: request.filter };
      // v2.18 §9.4：榜单记录是本轮证据的一部分，可用于授权下钻与卡片引用（只回传 ID，无正文）。
      let recordIds: string[] | undefined;
      if (a.report === "repeatedReviewErrors") {
        const repeated = stats as unknown as { report?: string; records?: Array<{ recordId: string }> };
        if (repeated.report === "repeatedReviewErrors") recordIds = (repeated.records ?? []).map((record) => record.recordId);
      }
      return okEnvelope("getMistakeStats", stats, {
        snapshotId: stats.snapshotId,
        dataAsOf: stats.dataAsOf,
        ...(recordIds ? { recordIds } : {}),
      });
    },
  };
}
