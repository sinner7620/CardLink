import { errorEnvelope, okEnvelope, REVIEW_HISTORY_LIMIT_MAX } from "../domain/evidence.ts";
import type { ReviewEvent } from "../domain/mistake.ts";
import type { Tool } from "../domain/tool.ts";
import { encodeBase64Url, decodeBase64Url, utf8Decode } from "../platform/base64url.ts";
import { sha256Hex, utf8Bytes } from "../platform/sha256.ts";
import { assertTimeRange, objectSchema, readOptionalInstant, readOptionalInt, readOptionalString, readRecordId, resolveRepo, snapshotContext, type ToolDeps } from "./shared.ts";

type HistoryOrder = "asc" | "desc";

type HistoryCursorKey = { time: number | null; index: number };

/**
 * v2.13 §9.2（修复）：紧凑游标。记录 ID、快照 ID、排序与时间过滤被压成一个绑定指纹，
 * 因此游标长度固定（约 110 字符），与记录/快照 ID 长度无关；指纹与校验值都是**非秘密**的
 * 一致性标记——只承诺检出"不匹配/被篡改"，不构成访问控制（授权仍由 scope 与 PolicyGuard 保证）。
 */
function readOrder(raw: unknown): HistoryOrder {
  if (raw === undefined || raw === null) return "asc";
  if (raw !== "asc" && raw !== "desc") throw new Error("order 必须是 asc 或 desc");
  return raw;
}

function filterKeyOf(fromMs: number | undefined, beforeMs: number | undefined): string {
  return sha256Hex(JSON.stringify([fromMs ?? null, beforeMs ?? null])).slice(0, 12);
}

function bindingKeyOf(recordId: string, order: HistoryOrder, snapshotId: string, filterKey: string): string {
  return sha256Hex(JSON.stringify([recordId, snapshotId, order, filterKey])).slice(0, 24);
}

function checksumOf(payload: { v: number; k: string; t: unknown[] }): string {
  return sha256Hex(JSON.stringify([payload.v, payload.k, payload.t])).slice(0, 16);
}

function encodeHistoryCursor(binding: string, key: HistoryCursorKey): string {
  const payload = { v: 2, k: binding, t: [key.time, key.index] as unknown[] };
  return encodeBase64Url(utf8Bytes(JSON.stringify({ ...payload, c: checksumOf(payload) })));
}

function decodeHistoryCursor(cursor: string, binding: string): HistoryCursorKey {
  const mismatch = new Error("历史分页游标与当前记录/排序/快照/筛选条件不匹配，请重新查询");
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(decodeBase64Url(cursor)));
  } catch {
    throw mismatch;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw mismatch;
  const payload = raw as { v?: unknown; k?: unknown; t?: unknown; c?: unknown };
  if (payload.v !== 2 || payload.k !== binding) throw mismatch;
  if (!Array.isArray(payload.t) || payload.t.length !== 2) throw mismatch;
  if (typeof payload.c !== "string" || payload.c !== checksumOf({ v: 2, k: binding, t: payload.t })) {
    throw new Error("历史分页游标校验失败，请重新查询");
  }
  const [time, index] = payload.t as unknown[];
  if (time !== null && (typeof time !== "number" || !Number.isFinite(time))) throw mismatch;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw mismatch;
  return { time: time === null ? null : time, index };
}

function timeOf(at: string): number | null {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? null : parsed;
}

/** asc/desc 都用同一 key 比较；无效时间始终置后，同时间戳按快照内事件序号作确定性 tie-break。 */
function compareKeys(a: HistoryCursorKey, b: HistoryCursorKey, order: HistoryOrder): number {
  const aInvalid = a.time === null;
  const bInvalid = b.time === null;
  if (aInvalid !== bInvalid) return aInvalid ? 1 : -1;
  if (a.time !== null && b.time !== null && a.time !== b.time) return order === "asc" ? a.time - b.time : b.time - a.time;
  return order === "asc" ? a.index - b.index : b.index - a.index;
}

type IndexedEvent = { event: ReviewEvent; key: HistoryCursorKey };

/** §9：getReviewHistory —— limit<=100；缺失单独标明。 */
export function createGetReviewHistory(deps: ToolDeps): Tool {
  return {
    definition: {
      name: "getReviewHistory",
      description: "读取一条错题的复习历史。首条为入册标记（mark），其余为复习（review）条目，各含等级与可选错因。默认按时间升序；要看最近几次用 order='desc' 并重复传入 nextCursor。若记录或历史缺失会显式标明。",
      parameters: objectSchema(
        {
          recordId: { type: "string", description: "错题 ID（笔记本ID:笔记ID）" },
          limit: { type: "integer", minimum: 1, maximum: REVIEW_HISTORY_LIMIT_MAX },
          order: { type: "string", enum: ["asc", "desc"], description: "asc 为默认时间升序；desc 为最新优先" },
          cursor: { type: "string", maxLength: 512, description: "上一页返回的 nextCursor（绑定记录、排序、快照与时间过滤）" },
          reviewFrom: { type: "string", maxLength: 40, description: "复习发生时间下界（含），带时区的 ISO 时间" },
          reviewBefore: { type: "string", maxLength: 40, description: "复习发生时间上界（不含），带时区的 ISO 时间" },
        },
        ["recordId"],
      ),
      resultSchema: { type: "object" },
      permission: "mistakes:read",
    },
    async run(args, ctx) {
      const a = args as { recordId: string; limit?: number; order?: string; cursor?: string; reviewFrom?: string; reviewBefore?: string };
      const recordId = readRecordId(a.recordId, "recordId");
      const limit = readOptionalInt(a.limit, "limit", 1, REVIEW_HISTORY_LIMIT_MAX) ?? 50;
      const order = readOrder(a.order);
      const reviewFrom = readOptionalInstant(a.reviewFrom, "reviewFrom");
      const reviewBefore = readOptionalInstant(a.reviewBefore, "reviewBefore");
      assertTimeRange(reviewFrom, reviewBefore, "复习区间");
      const fromMs = reviewFrom === undefined ? undefined : Date.parse(reviewFrom);
      const beforeMs = reviewBefore === undefined ? undefined : Date.parse(reviewBefore);
      const cursor = readOptionalString(a.cursor, "cursor", 512);
      // §9.2：只有"完全没有新参数"的调用保留旧的 truncated 兼容标记；分页分支只用 nextCursor。
      const legacyMode = a.order === undefined && a.cursor === undefined && a.reviewFrom === undefined && a.reviewBefore === undefined;
      const repo = resolveRepo(ctx, deps);
      const snap = await snapshotContext(ctx, repo);
      const record = await repo.getById(recordId, ctx.scope);
      if (!record) {
        return errorEnvelope("getReviewHistory", "not_found", `错题不存在或不在授权范围: ${recordId}`, snap.snapshotId, snap.dataAsOf);
      }
      const all = await repo.getReviewHistory(recordId, ctx.scope);
      const binding = bindingKeyOf(recordId, order, snap.snapshotId, filterKeyOf(fromMs, beforeMs));
      const startKey = cursor ? decodeHistoryCursor(cursor, binding) : undefined;
      // 时间过滤按实际发生时间比较（解析为时间戳），不受 ISO 字符串时区字面顺序影响。
      const matching: IndexedEvent[] = all
        .map((event, index) => ({ event, key: { time: timeOf(event.at), index } }))
        .filter(({ key }) => {
          if (fromMs === undefined && beforeMs === undefined) return true;
          if (key.time === null) return false;
          if (fromMs !== undefined && key.time < fromMs) return false;
          if (beforeMs !== undefined && key.time >= beforeMs) return false;
          return true;
        })
        .sort((left, right) => compareKeys(left.key, right.key, order));
      // 锚点必须真实存在于当前（同记录/同快照/同过滤）历史中，否则不接受该游标。
      if (startKey && !matching.some(({ key }) => key.index === startKey.index && key.time === startKey.time)) {
        throw new Error("历史分页游标锚点无效，请重新查询");
      }
      const remaining = startKey ? matching.filter(({ key }) => compareKeys(key, startKey, order) > 0) : matching;
      const page = remaining.slice(0, limit);
      const hasMore = remaining.length > limit;
      return okEnvelope(
        "getReviewHistory",
        {
          recordId,
          events: page.map(({ event }) => event),
          total: all.length,
          totalMatching: matching.length,
          historyMissing: all.length === 0,
          order,
          ...(hasMore ? { nextCursor: encodeHistoryCursor(binding, page[page.length - 1]!.key) } : {}),
        },
        { recordIds: [recordId], snapshotId: snap.snapshotId, dataAsOf: snap.dataAsOf },
        legacyMode && all.length > limit,
      );
    },
  };
}
