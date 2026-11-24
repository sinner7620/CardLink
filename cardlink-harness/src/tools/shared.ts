import type { Tool, ToolExecutionContext } from "../domain/tool.ts";
import type { MistakeRepository } from "../application/ports/mistake-repository.ts";
import type { MistakeRecord } from "../domain/mistake.ts";

export type ToolDeps = {
  repository: MistakeRepository;
};

/**
 * §6.2 运行锁定：工具数据读取按 ctx.snapshotId 钉住快照；
 * 仓储未实现 forSnapshot 时回退 latest 视图（Fake/内存实现兼容）。
 */
export function resolveRepo(ctx: ToolExecutionContext, deps: ToolDeps): MistakeRepository {
  return deps.repository.forSnapshot ? deps.repository.forSnapshot(ctx.snapshotId) : deps.repository;
}

export async function snapshotContext(ctx: ToolExecutionContext, repo: MistakeRepository): Promise<{ snapshotId: string; dataAsOf: string }> {
  const meta = await repo.getLatestSnapshotMeta();
  if (meta?.snapshotId !== ctx.snapshotId && ctx.snapshotId !== "none") throw new Error("运行快照不可访问");
  return { snapshotId: ctx.snapshotId, dataAsOf: meta?.dataAsOf ?? meta?.importedAt ?? new Date().toISOString() };
}

export function parseToolArgs<T extends object>(
  args: unknown,
  spec: { [K in keyof T]: (raw: unknown, field: string) => T[K] },
  onProblem: (message: string) => never,
): T {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    onProblem("工具参数必须是对象");
  }
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(spec) as Array<keyof T & string>) {
    const raw = (args as Record<string, unknown>)[field];
    if (raw !== undefined) out[field] = (spec[field] as (raw: unknown, field: string) => unknown)(raw, field);
  }
  return out as T;
}

export function readOptionalString(raw: unknown, field: string, max = 128): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error(`${field} 必须是字符串`);
  if (raw.length > max) throw new Error(`${field} 超过 ${max} 字符上限`);
  return raw;
}

export function readOptionalStringArray(raw: unknown, field: string, maxItems = 64): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error(`${field} 必须是字符串数组`);
  if (raw.length > maxItems) throw new Error(`${field} 数量超过 ${maxItems}`);
  return raw.map((x) => {
    if (typeof x !== "string" || !x.trim() || x.length > 128) throw new Error(`${field} 含非法项`);
    return x;
  });
}

export function readOptionalInt(raw: unknown, field: string, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error(`${field} 必须是整数`);
  if (raw < min || raw > max) throw new Error(`${field} 超出范围 [${min}, ${max}]`);
  return raw;
}

export function readOptionalLevel(raw: unknown, field: string): 0 | 1 | 2 | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw !== 0 && raw !== 1 && raw !== 2) throw new Error(`${field} 必须是 0/1/2`);
  return raw;
}

export function readOptionalIso(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) throw new Error(`${field} 必须是 ISO 时间`);
  return raw;
}

export function readOptionalInstant(raw: unknown, field: string): string | undefined {
  const value = readOptionalIso(raw, field);
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${field} 必须是带时区的 ISO 时间`);
  }
  return value === undefined ? undefined : new Date(value).toISOString();
}

export function assertTimeRange(from: string | undefined, before: string | undefined, range: string): void {
  if (from && before && Date.parse(from) >= Date.parse(before)) {
    throw new Error(`${range}的开始时间必须早于结束时间`);
  }
}

export function readOptionalBool(raw: unknown, field: string): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "boolean") throw new Error(`${field} 必须是布尔`);
  return raw;
}

/** v2.13 §9.2：关键词检索的单个字面短语（去首尾空白后 1..128 字符）。 */
export function readContentQuery(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error("contentQuery 必须是字符串");
  const value = raw.trim();
  if (value.length < 1 || value.length > 128) throw new Error("contentQuery 去首尾空白后必须为 1..128 字符");
  return value;
}

/** v2.13 §9.2：批量读取的已知 recordId（1..10 项，去重，保持请求顺序）。 */
export function readRecordIdList(raw: unknown, field: string, max = 10): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error(`${field} 必须是字符串数组`);
  if (raw.length < 1) throw new Error(`${field} 至少需要 1 项`);
  if (raw.length > max) throw new Error(`${field} 最多 ${max} 项`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${field} 含非法项`);
    const value = item.trim();
    if (value.length > 256) throw new Error(`${field} 含超长项`);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function readRecordId(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${field} 必须是非空字符串`);
  if (raw.length > 256) throw new Error(`${field} 超长`);
  return raw.trim();
}

/** JSON Schema 片段：对象、additionalProperties:false。 */
export function objectSchema(properties: Record<string, unknown>, required: string[] = []): object {
  return { type: "object", properties, required, additionalProperties: false };
}

const NOTEBOOK_IDS_SCHEMA = {
  type: "array",
  items: { type: "string", maxLength: 128 },
  maxItems: 64,
};

export const SUBJECT_SCHEMA = { type: "string", maxLength: 128 };

export function filterSchema(extra: Record<string, unknown> = {}): object {
  return objectSchema({
    subject: { ...SUBJECT_SCHEMA, description: "按分类首层或笔记本标题过滤" },
    notebookIds: { ...NOTEBOOK_IDS_SCHEMA, description: "笔记本 ID 范围（必须在会话授权范围内）" },
    ...extra,
  });
}

export type ToolFactory = (deps: ToolDeps) => Tool;

/**
 * v2.13 §9.2：列表/批量摘要投影。只含现有安全元数据，不含题干与答案正文，
 * 因此关键词检索与 recordIds 批量结果的包络体积有界（不扩大 §12 的发送范围）。
 */
export type CardSummary = {
  recordId: string;
  sourceNotebookId: string;
  sourceNoteId: string;
  sourceTitle: string;
  sourceNotebookTitle: string;
  sourceAvailable: boolean;
  level?: 0 | 1 | 2;
  reviewCompleted: boolean;
  reviewCount: number;
  verifiedReviewCount?: number;
  nextReviewAt?: string;
  lastReviewedAt?: string;
  textStatus: "complete" | "partial" | "missing";
  categoryPath: string[];
  favorite: boolean;
};

export function cardSummary(record: MistakeRecord): CardSummary {
  return {
    recordId: record.recordId,
    sourceNotebookId: record.sourceNotebookId,
    sourceNoteId: record.sourceNoteId,
    sourceTitle: record.sourceTitle,
    sourceNotebookTitle: record.sourceNotebookTitle,
    sourceAvailable: record.sourceAvailable,
    level: record.level,
    reviewCompleted: record.reviewCompleted,
    reviewCount: record.reviewCount,
    verifiedReviewCount: record.verifiedReviewCount,
    nextReviewAt: record.nextReviewAt,
    lastReviewedAt: record.lastReviewedAt,
    textStatus: record.textStatus,
    categoryPath: record.categoryPath,
    favorite: record.favorite,
  };
}

/**
 * v2.13 §9.2：按 Unicode 码点切分正文（不是 UTF-16 码元），因此不会切断代理对，
 * 继续偏移可精确接续。`nextOffset` 仅在仍有后续片段时返回。
 */
export function sliceCodePoints(text: string, offset: number, limit: number): { text: string; totalLength: number; nextOffset?: number } {
  const points = Array.from(text);
  const totalLength = points.length;
  const slice = points.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { text: slice.join(""), totalLength, nextOffset: end < totalLength ? end : undefined };
}
