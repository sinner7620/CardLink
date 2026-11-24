import { stableHashHex, canonicalJson } from "../domain/canonical.ts";
import { errorEnvelope, okEnvelope, type ToolEnvelope } from "../domain/evidence.ts";
import type { Tool } from "../domain/tool.ts";
import type { MistakeFilter } from "../domain/mistake.ts";
import { endOfLocalDay } from "../application/statistics-engine.ts";
import { resolveRepo, type ToolDeps } from "./shared.ts";

const shortText = { type: "string", minLength: 1, maxLength: 120 };
const key = { type: "string", minLength: 1, maxLength: 256 };
const list = (items: object, maxItems: number) => ({ type: "array", items, minItems: 1, maxItems });
const shape = (properties: object, required: string[]) => ({ type: "object", additionalProperties: false, properties, required });
const tool = (name: string, description: string, parameters: object, run: Tool["run"]): Tool => ({
  definition: { name, description, parameters, resultSchema: { type: "object" }, permission: "mistakes:read" },
  run,
});

function artifact<T extends object>(data: T): T & { version: 1; artifactId: string } {
  return { ...data, version: 1, artifactId: "artifact-" + stableHashHex(canonicalJson(data)) };
}

const numericFields = [
  "totalRecords", "totalMistakes", "availableRecords", "dueCount", "reviewedRecordCount", "totalReviewActions",
  "verifiedReviewCount", "reviewCount", "matchingRecords", "recordsWithHistory", "score", "outOf", "weight",
] as const;
const dataFields = [...numericFields, "sourceTitle", "level", "nextReviewAt", "categoryPath", "count", "label", "date", "at"];
type Cell = { field: string; value: string | number };

function projectedRows(data: unknown, selected: readonly string[]): Cell[][] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const orderedKeys = ["records", "events", "rows", "items", "activities", "buckets", "groups"];
  const nested = orderedKeys.map((name) => obj[name]).find(Array.isArray);
  const rows = Array.isArray(data) ? data : Array.isArray(nested) ? nested : [obj];
  return rows.slice(0, 32).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const cells = selected.flatMap((field) => {
      if (!Object.prototype.hasOwnProperty.call(row, field)) return [];
      const value = (row as Record<string, unknown>)[field];
      if (typeof value !== "string" && typeof value !== "number") return [];
      return [{ field, value: typeof value === "string" ? value.slice(0, 160) : value }];
    });
    return cells.length ? [cells] : [];
  });
}

export function createRenderVisualization(): Tool {
  const name = "renderVisualization";
  return tool(name, "生成回答内的可视化。证据图必须使用已提供的证据 ID，可选字段仅来自原结果。概念图必须使用结构化节点和边。",
    { type: "object", oneOf: [
      shape({
        kind: { enum: ["evidence"] },
        view: { enum: ["table", "chart", "timeline", "spec", "comparison", "scoreBreakdown"] },
        evidenceIds: list(key, 8), fields: list({ enum: dataFields }, 12), title: shortText,
      }, ["kind", "view", "evidenceIds"]),
      shape({
        kind: { enum: ["concept"] }, view: { enum: ["diagram", "flowGraph"] }, title: shortText,
        nodes: list(shape({ id: shortText, label: shortText }, ["id", "label"]), 64),
        edges: { type: "array", items: shape({ from: shortText, to: shortText, label: shortText }, ["from", "to"]), maxItems: 128 },
      }, ["kind", "view", "title", "nodes", "edges"]),
    ] }, async (raw, ctx) => {
      const args = raw as {
        kind: "concept" | "evidence"; view: string; title?: string; evidenceIds?: string[]; fields?: string[];
        nodes?: { id: string; label: string }[]; edges?: { from: string; to: string; label?: string }[];
      };
      const dataAsOf = ctx.dataAsOf ?? new Date().toISOString();
      const fail = (message: string) => errorEnvelope(name, "invalid_args", message, ctx.snapshotId, dataAsOf);
      if (args.kind === "concept") {
        const nodes = args.nodes ?? [];
        const edges = args.edges ?? [];
        const nodeIds = new Set(nodes.map((node) => node.id));
        if (nodeIds.size !== nodes.length || edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
          return fail("节点 ID 必须唯一，所有连线须指向已有节点");
        }
        return okEnvelope(name, artifact({ kind: "concept", view: args.view, title: args.title, nodes, edges }), { snapshotId: ctx.snapshotId, dataAsOf });
      }

      const sources: { evidenceId: string; source: ToolEnvelope; rows: Cell[][] }[] = [];
      const requestedFields = args.fields ?? dataFields;
      if (args.view === "chart" || args.view === "scoreBreakdown") {
        if (!requestedFields.some((field) => numericFields.some((item) => item === field))) return fail("请选择有数值依据的字段");
      }
      for (const evidenceId of [...new Set(args.evidenceIds ?? [])]) {
        const source = ctx.readVerifiedEvidence?.(evidenceId);
        if (!source || source.truncated || source.evidence.snapshotId !== ctx.snapshotId || source.evidence.dataAsOf !== dataAsOf) {
          return fail("证据不存在、已截断或不属于当前分支和快照");
        }
        const rows = projectedRows(source.data, requestedFields);
        if (!rows.length || (args.fields && args.fields.some((field) => !rows.some((row) => row.some((cell) => cell.field === field))))) {
          return fail("所选来源没有可渲染的字段");
        }
        sources.push({ evidenceId, source, rows });
      }
      if (!sources.length) return fail("请提供已核验的来源");
      if (args.view === "scoreBreakdown" && !sources.some(({ rows }) => rows.some((row) =>
        row.some((cell) => cell.field === "score" && typeof cell.value === "number") &&
        row.some((cell) => cell.field === "outOf" && typeof cell.value === "number" && cell.value > 0)))) {
        return fail("评分图需要有来源的分数和满分字段");
      }
      const recordIds = [...new Set(sources.flatMap(({ source }) => source.evidence.recordIds ?? []))];
      return okEnvelope(name, artifact({
        kind: "evidence", view: args.view, title: args.title, sources: sources.map(({ evidenceId, source, rows }) => ({
          evidenceId, tool: source.tool, params: (source.data as { params?: unknown })?.params, rows,
        })), snapshotId: ctx.snapshotId, dataAsOf,
      }), { snapshotId: ctx.snapshotId, dataAsOf, recordIds });
    });
}

export function createBuildReviewQueue(deps: ToolDeps): Tool {
  const name = "buildReviewQueue";
  return tool(name, "按快照生成有序复习队列建议。只提出队列，由用户决定是否开始。",
    shape({
      goal: { enum: ["dueToday", "strengthenWeak"] }, notebookIds: list(key, 20), categoryPrefix: list(shortText, 8),
      limit: { type: "integer", minimum: 1, maximum: 50 },
      timeBudgetMinutes: { type: "integer", minimum: 1, maximum: 480 },
    }, ["goal", "limit"]), async (raw, ctx) => {
      const args = raw as { goal: "dueToday" | "strengthenWeak"; notebookIds?: string[]; categoryPrefix?: string[]; limit: number; timeBudgetMinutes?: number };
      const now = new Date();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const dueBoundary = args.goal === "dueToday" ? endOfLocalDay(now, timezone).toISOString() : undefined;
      const filter: MistakeFilter = { notebookIds: args.notebookIds, categoryPrefix: args.categoryPrefix, queueOrder: args.goal, dueBefore: dueBoundary, limit: args.limit + 1 };
      const page = await resolveRepo(ctx, deps).query(filter, ctx.scope);
      const items = page.records.slice(0, args.limit).map((record) => ({
        recordId: record.recordId, title: record.sourceTitle, dueAt: record.nextReviewAt, level: record.level,
        reason: args.goal === "dueToday" ? "已到期且尚未完成复习" : record.level === 0 ? "当前等级为不会" : "当前等级为不熟",
      }));
      return okEnvelope(name, artifact({
        goal: args.goal, items, count: items.length, hasMore: page.records.length > args.limit || Boolean(page.nextCursor),
        rules: { notebookIds: args.notebookIds ?? ctx.scope.notebookIds, categoryPrefix: args.categoryPrefix ?? [],
          order: args.goal === "dueToday" ? ["nextReviewAt", "level", "recordId"] : ["level", "verifiedReviewCountDesc", "recordId"],
          statsTime: now.toISOString(), timezone, dueBoundary },
        ...(args.timeBudgetMinutes ? { timeBudgetMinutes: args.timeBudgetMinutes, estimate: "unavailable" } : {}),
        snapshotId: page.snapshotId, dataAsOf: page.dataAsOf,
      }), { snapshotId: page.snapshotId, dataAsOf: page.dataAsOf, recordIds: items.map((item) => item.recordId) });
    });
}
