import { okEnvelope } from "../domain/evidence.ts";
import type { Tool } from "../domain/tool.ts";
import type { MistakeFilter } from "../domain/mistake.ts";
import { assertTimeRange, cardSummary, filterSchema, readContentQuery, readRecordIdList, readOptionalBool, readOptionalInstant, readOptionalIso, readOptionalInt, readOptionalLevel, readOptionalStringArray, readOptionalString, resolveRepo, type ToolDeps } from "./shared.ts";

/** §9：queryMistakes —— limit<=50，范围交集校验由 PolicyGuard 完成。 */
export function createQueryMistakes(deps: ToolDeps): Tool {
  return {
    definition: {
      name: "queryMistakes",
      description: "分页列出错题。查待复习题用日期区间与 dueAtAsc；查复习多次仍未掌握的错题，用 unmastered=true 和 reviewCountDesc 一次获取排名及历史覆盖。按内容找题用 contentQuery（单个字面短语，匹配标题与有效题干，仅 ASCII 大小写不敏感）；已知多条 recordId 用 recordIds 批量取元数据。列表不返回题干与答案正文，正文用详情工具分段读取。",
      parameters: filterSchema({
        level: { type: "integer", enum: [0, 1, 2], description: "0=不会 1=不熟 2=掌握" },
        unmastered: { type: "boolean", description: "true 同时匹配不会、不熟，排除掌握和未知等级" },
        dueFrom: { type: "string", maxLength: 40, description: "可用且未完成复习的错题，到期时间下界（含），带时区的 ISO 时间" },
        dueBefore: { type: "string", description: "可用且未完成复习的错题，到期时间上界（不含）；今天待复习用本地次日零点，省略 dueFrom 以含逾期" },
        orderBy: {
          type: "string", enum: ["dueAtAsc", "reviewCountDesc"],
          description: "dueAtAsc 按有效到期时间升序；reviewCountDesc 按快照内可核实的累计复习次数倒序，默认前 10 条",
        },
        contentQuery: {
          type: "string", minLength: 1, maxLength: 128,
          description: "单个字面短语，匹配投影标题与有效题干（含用户修订）。中文按连续子串命中；仅 ASCII 字母大小写不敏感；% _ 引号与 MATCH/NEAR 等字样均按字面量。可与等级、范围、到期区间与排序同用",
        },
        recordIds: {
          type: "array", items: { type: "string", maxLength: 256 }, minItems: 1, maxItems: 10,
          description: "1..10 个已知错题 ID，批量返回安全元数据（不含正文），与其他筛选取交集；不可见或不存在项统一列入 missingRecordIds",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        cursor: { type: "string", maxLength: 512 },
      }),
      resultSchema: { type: "object" },
      permission: "mistakes:read",
    },
    async run(args, ctx) {
      const a = args as MistakeFilter;
      const dueFrom = readOptionalInstant(a.dueFrom, "dueFrom");
      const legacyDueBefore = readOptionalIso(a.dueBefore, "dueBefore");
      const dueBefore = legacyDueBefore === undefined ? undefined : new Date(legacyDueBefore).toISOString();
      assertTimeRange(dueFrom, dueBefore, "到期区间");
      const contentQuery = readContentQuery(a.contentQuery);
      const recordIds = readRecordIdList(a.recordIds, "recordIds", 10);
      const repo = resolveRepo(ctx, deps);
      const filter = {
        subject: readOptionalString(a.subject, "subject"),
        notebookIds: readOptionalStringArray(a.notebookIds, "notebookIds"),
        level: readOptionalLevel(a.level, "level"),
        unmastered: readOptionalBool(a.unmastered, "unmastered"),
        dueFrom,
        dueBefore,
        orderBy: a.orderBy,
        contentQuery,
        recordIds,
        limit: readOptionalInt(a.limit, "limit", 1, 50) ?? (a.orderBy === "reviewCountDesc" ? 10 : 20),
        cursor: readOptionalString(a.cursor, "cursor", 512),
      };
      const page = await repo.query(filter, ctx.scope);
      // v2.13 §9.2：新参数模式只返回安全元数据；旧参数与默认路径的返回字段保持原契约。
      const summarized = Boolean(contentQuery || recordIds);
      const records = page.records.map((record) => {
        if (summarized) return cardSummary(record);
        if (!a.orderBy) {
          const { questionText, answerText, ...rest } = record;
          void questionText;
          void answerText;
          return rest;
        }
        return {
          recordId: record.recordId,
          sourceNotebookId: record.sourceNotebookId,
          sourceNotebookTitle: record.sourceNotebookTitle,
          sourceTitle: record.sourceTitle,
          sourceAvailable: record.sourceAvailable,
          level: record.level,
          nextReviewAt: record.nextReviewAt,
          verifiedReviewCount: record.verifiedReviewCount,
        };
      });
      // 未匹配的请求 ID：用同快照、同 scope、同筛选的完整匹配集合（`recordIds` 最多 10 项）判定，
      // 因此后续页不会把本页之外的记录误报为缺失；scope 外与不存在仍得到同一结果。
      let missingRecordIds: string[] | undefined;
      if (recordIds) {
        const matched = await repo.query({ ...filter, recordIds, limit: recordIds.length, cursor: undefined }, ctx.scope);
        const matchedIds = new Set(matched.records.map((record) => record.recordId));
        missingRecordIds = recordIds.filter((id) => !matchedIds.has(id));
      }
      return okEnvelope("queryMistakes", {
        records,
        nextCursor: page.nextCursor,
        reviewCoverage: page.reviewCoverage,
        ...(missingRecordIds ? { missingRecordIds } : {}),
      }, { recordIds: records.map((record) => record.recordId), snapshotId: page.snapshotId, dataAsOf: page.dataAsOf });
    },
  };
}
