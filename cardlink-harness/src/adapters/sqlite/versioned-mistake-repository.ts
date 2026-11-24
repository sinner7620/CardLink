import type { ISODateTime } from "../../domain/message.ts";
import type { ReviewEventLike } from "../../application/ports/versioned-mistake-repository.ts";
import type { CoverageGroup, LevelBucket, MistakeLevel, MistakeReport, MistakeReportFilter, ReviewCoverage } from "../../domain/mistake.ts";
import { asciiLower } from "../../domain/mistake.ts";
import type {
  SnapshotManifest,
  VersionedFilter,
  VersionedImportPayload,
  VersionedImportResult,
  VersionedMistakeRepository,
  VersionedPage,
  VersionedSnapshotRecord,
  VersionedStats,
} from "../../application/ports/versioned-mistake-repository.ts";
import type { SessionScope } from "../../domain/session.ts";
import type { SqlDriver } from "./db.ts";
import { canonicalJson, sha256Hex } from "./db.ts";
import { encodeBase64Url, decodeBase64Url, utf8Decode } from "../../platform/base64url.ts";
import { utf8Bytes } from "../../platform/sha256.ts";
import { randomUUID } from "../../platform/uuid.ts";

interface V2Row {
  snapshot_id: string;
  record_id: string;
  source_notebook_id: string;
  source_note_id: string;
  source_available: number | null;
  level: number | null;
  review_count: number | null;
  verified_review_count?: number;
  review_completed: number | null;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  favorite: number | null;
  category_path_json: string;
  manual_categories_json: string;
  custom_tags_json: string;
  reason_tags_json: string;
  error_reasons_json: string;
  source_title: string | null;
  source_notebook_title: string | null;
  source_root_title: string | null;
  source_path_titles_json: string | null;
  question_text: string | null;
  answer_text: string | null;
  text_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  answer_notebook_id: string | null;
  answer_root_node_id: string | null;
  answer_text_origin: string | null;
  answer_source_notebook_id: string | null;
  answer_source_note_id: string | null;
  answer_status: string | null;
  answer_reason: string | null;
  content_hash: string;
  raw_json: string;
  ocr_json: string | null;
}

interface CoverageGroupRow {
  key: string;
  label: string;
  recordCount: number;
  qAvail: number;
  qMissing: number;
  aAvail: number;
  aMissing: number;
  aUnlocatable: number;
  aOutOfScope: number;
  rAvail: number;
  rNone: number;
  rMissing: number;
}

type CoverageDimensionKey = "notebook" | "category" | "customTag";

function rowToRecord(row: V2Row): VersionedSnapshotRecord {
  const ocrJson = row.ocr_json ? (JSON.parse(row.ocr_json) as Record<string, unknown>) : undefined;
  return {
    recordId: row.record_id,
    sourceNotebookId: row.source_notebook_id,
    sourceNoteId: row.source_note_id,
    sourceAvailable: row.source_available === null ? null : row.source_available === 1,
    level: row.level === null ? null : (row.level as MistakeLevel),
    currentLevelReviewCount: row.review_count,
    verifiedReviewCount: row.verified_review_count,
    reviewCompleted: row.review_completed === null ? null : row.review_completed === 1,
    nextReviewAt: row.next_review_at ?? undefined,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    favorite: row.favorite === null ? null : row.favorite === 1,
    categoryPath: JSON.parse(row.category_path_json) as string[],
    manualCategories: JSON.parse(row.manual_categories_json) as string[],
    customTags: JSON.parse(row.custom_tags_json) as string[],
    reasonTags: JSON.parse(row.reason_tags_json) as string[],
    errorReasons: JSON.parse(row.error_reasons_json) as Array<{ key: string; label: string }>,
    sourceTitle: row.source_title ?? undefined,
    sourceNotebookTitle: row.source_notebook_title ?? undefined,
    sourceRootTitle: row.source_root_title ?? undefined,
    sourcePathTitles: row.source_path_titles_json ? (JSON.parse(row.source_path_titles_json) as string[]) : [],
    questionText: row.question_text ?? undefined,
    answerText: row.answer_text ?? undefined,
    ocr: {
      rawText: typeof ocrJson?.rawText === "string" ? ocrJson.rawText : undefined,
      manualText: typeof ocrJson?.manualText === "string" ? ocrJson.manualText : undefined,
      effectiveText: typeof ocrJson?.effectiveText === "string" ? ocrJson.effectiveText : undefined,
      origin: (ocrJson?.origin as "manual" | "ocr" | "note" | "none") ?? "none",
      status: (row.text_status as "complete" | "partial" | "missing") ?? "missing",
    },
    sourcePayload: JSON.parse(row.raw_json) as Record<string, unknown>,
    history: [],
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    answerNotebookId: row.answer_notebook_id ?? undefined,
    answerRootNodeId: row.answer_root_node_id ?? undefined,
    answerTextOrigin: row.answer_text_origin === "answer_card" || row.answer_text_origin === "import"
      ? row.answer_text_origin
      : undefined,
    answerSourceNotebookId: row.answer_source_notebook_id ?? undefined,
    answerSourceNoteId: row.answer_source_note_id ?? undefined,
    answerStatus: row.answer_status === "projected" || row.answer_status === "unavailable" || row.answer_status === "missing"
      ? row.answer_status
      : undefined,
    answerReason: row.answer_reason ?? undefined,
    contentHash: row.content_hash,
  };
}

const DUE_TIME = "julianday(mv.next_review_at)";
const ISO_DATE_PREFIX = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'";
const DUE_ELIGIBLE = `mv.source_available = 1 AND COALESCE(mv.review_completed, 0) = 0
  AND mv.next_review_at GLOB ${ISO_DATE_PREFIX} AND ${DUE_TIME} IS NOT NULL`;
// Read the pinned row's own history. review_events is shared across snapshot versions.
const HISTORY_ROWS = "json_each(mv.raw_json, '$.history') history";
const HISTORY_AT = "CASE WHEN history.type = 'object' THEN json_extract(history.value, '$.at') END";
const HISTORY_TIME = `julianday(${HISTORY_AT})`;
const VALID_HISTORY_EVENT = `typeof(history.key) = 'integer' AND ${HISTORY_AT} GLOB ${ISO_DATE_PREFIX} AND ${HISTORY_TIME} IS NOT NULL`;
const VERIFIED_REVIEW = `history.key > 0 AND ${VALID_HISTORY_EVENT}`;
const VERIFIED_REVIEW_COUNT = `(SELECT COUNT(*) FROM ${HISTORY_ROWS} WHERE ${VERIFIED_REVIEW})`;
/** v2.18 §9.4：错因键/标签只在事件对象上读取，非对象或缺失均为 NULL。 */
const HISTORY_REASON_KEY = "CASE WHEN history.type = 'object' THEN json_extract(history.value, '$.errorReason.key') END";
const HISTORY_REASON_LABEL = "CASE WHEN history.type = 'object' THEN json_extract(history.value, '$.errorReason.label') END";
/**
 * 与 JS `String.prototype.trim` 的空白集合对齐：TAB/LF/VT/FF/CR/SP、NBSP、U+1680、
 * U+2000–U+200A、U+2028/2029、U+202F、U+205F、U+3000、BOM。SQLite 内建 trim(X) 只剔除
 * ASCII 空格，会把带 \t\n 或全角空白的键当成非空；这里显式给出字符集合（trim 的第二个
 * 参数按“字符集合”解释，不是多字符子串）。仅用于 v2.18 新报表，不改旧报告或快照数据。
 */
const SQL_TRIM_WHITESPACE = "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
const sqlTrimWhitespace = (expr: string): string => `trim(${expr}, ${SQL_TRIM_WHITESPACE})`;
const REPEATED_REVIEW_INTERPRETATION = "同一错题在快照历史中有至少两笔可核实的复习记录带非空错因键。这只表示该题多次复习记录带错因（或重复记录同一错因），不代表实际答错、正确率或因果；错因可能是沿用的标签。";

function buildWhere(filter: VersionedFilter, scope: SessionScope): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (scope.notebookIds.length) {
    clauses.push(`mv.source_notebook_id IN (${scope.notebookIds.map(() => "?").join(",")})`);
    params.push(...scope.notebookIds);
  }
  if (filter.notebookIds?.length) {
    clauses.push(`mv.source_notebook_id IN (${filter.notebookIds.map(() => "?").join(",")})`);
    params.push(...filter.notebookIds);
  }
  if (filter.subject) {
    clauses.push("(json_extract(mv.category_path_json, '$[0]') = ? OR mv.source_notebook_title = ?)");
    params.push(filter.subject, filter.subject);
  }
  for (const [index, part] of (filter.categoryPrefix ?? []).entries()) {
    clauses.push(`json_extract(mv.category_path_json, '$[${index}]') = ?`);
    params.push(part);
  }
  if (filter.queueOrder) clauses.push("mv.source_available = 1");
  if (filter.queueOrder === "strengthenWeak") clauses.push("mv.level IN (0, 1)");
  if (filter.level !== undefined) {
    clauses.push("mv.level = ?");
    params.push(filter.level);
  }
  if (filter.unmastered) clauses.push("mv.level IN (0, 1)");
  // v2.13 §9.2：已知 recordId 交集（去重与 scope 由调用方与下方 scope 子句共同保证）。
  if (filter.recordIds?.length) {
    clauses.push(`mv.record_id IN (${filter.recordIds.map(() => "?").join(",")})`);
    params.push(...filter.recordIds);
  }
  // v2.13 §9.2：字面短语匹配投影标题与有效题干（含用户修订）。
  // 全部值绑定；instr 不做模式解释，故 % _ 引号与 MATCH/NEAR 等字样均为字面量。
  // 只折叠 ASCII 大小写（SQLite 内建 lower() 的折叠范围），中文按连续子串匹配。
  if (filter.contentQuery) {
    clauses.push(
      "(instr(lower(COALESCE(mv.source_title, '')), ?) > 0 OR instr(lower(COALESCE(mv.question_text, '')), ?) > 0)",
    );
    const needle = asciiLower(filter.contentQuery);
    params.push(needle, needle);
  }
  if (filter.dueFrom || filter.dueBefore || filter.orderBy === "dueAtAsc") clauses.push(DUE_ELIGIBLE);
  if (filter.dueFrom) {
    clauses.push(`${DUE_TIME} >= julianday(?)`);
    params.push(filter.dueFrom);
  }
  if (filter.dueBefore) {
    clauses.push(`${DUE_TIME} < julianday(?)`);
    params.push(filter.dueBefore);
  }
  if (filter.from) {
    clauses.push("mv.updated_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("mv.updated_at <= ?");
    params.push(filter.to);
  }
  return { where: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

const QUERY_ORDER = "category_path_json, source_title, created_at, record_id";

/** `queryMistakes.cursor` 的固定上界，与工具 Schema 的 `maxLength` 一致。 */
const QUERY_CURSOR_MAX = 512;

interface CursorTuple {
  category: string;
  title: string;
  createdAt: string;
  recordId: string;
}

/** 旧路径保留的裸元组游标（无指纹，行为与 v2.12 相同）。 */
function encodeLegacyTupleCursor(t: CursorTuple): string {
  return encodeBase64Url(utf8Bytes(JSON.stringify(t)));
}

function legacyTupleCursor(cursor: string): CursorTuple | null {
  try {
    const raw = JSON.parse(utf8Decode(decodeBase64Url(cursor))) as CursorTuple;
    if (typeof raw.category !== "string" || typeof raw.title !== "string" || typeof raw.createdAt !== "string" || typeof raw.recordId !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

function cursorMismatch(): Error {
  return new Error("分页游标与当前查询条件或快照不匹配，请从第一页重新查询");
}

/**
 * v2.13 §9.2（修复）：关键词/批量模式的**紧凑游标**——只含查询指纹、锚点 `recordId` 与校验值。
 * 分类与标题不进入游标（既不泄漏本应只以元数据形式返回的内容，也使长度上界与文本长度无关）；
 * keyset 排序键一律由本仓储在**锁定的同快照 / 同 scope / 同筛选**条件下按 `recordId` 重新取回，
 * 不使用客户端回传的任何元组。
 */
function encodeAnchorCursor(fingerprint: string, recordId: string): string {
  const checksum = sha256Hex(JSON.stringify([3, fingerprint, recordId])).slice(0, 16);
  const cursor = encodeBase64Url(utf8Bytes(JSON.stringify({ v: 3, f: fingerprint, r: recordId, c: checksum })));
  if (cursor.length > QUERY_CURSOR_MAX) {
    throw new Error("分页游标超出长度上限：锚点记录 ID 不符合 §5 的 RecordId 形态（每段 ≤128 字符）");
  }
  return cursor;
}

function decodeAnchorCursor(cursor: string, fingerprint: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(decodeBase64Url(cursor)));
  } catch {
    throw cursorMismatch();
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw cursorMismatch();
  const payload = raw as { v?: unknown; f?: unknown; r?: unknown; c?: unknown };
  if (payload.v !== 3 || payload.f !== fingerprint || typeof payload.r !== "string" || !payload.r) throw cursorMismatch();
  if (payload.c !== sha256Hex(JSON.stringify([3, payload.f, payload.r])).slice(0, 16)) {
    throw new Error("分页游标校验失败，请重新查询");
  }
  return payload.r;
}

/**
 * v2.13 §9.2：查询指纹 = 快照 + 授权 scope + 全部筛选字段 + 排序方式。
 * 游标只能在同一指纹下继续翻页，从而排除跨快照与跨过滤条件的复用。
 */
function queryFingerprint(snapshotId: string, filter: VersionedFilter, scope: SessionScope): string {
  const sorted = (values?: string[]): string[] | null => (values?.length ? [...values].sort() : null);
  return sha256Hex(canonicalJson({
    snapshotId,
    scope: sorted(scope.notebookIds),
    subject: filter.subject ?? null,
    notebookIds: sorted(filter.notebookIds),
    level: filter.level ?? null,
    unmastered: filter.unmastered ?? null,
    dueFrom: filter.dueFrom ?? null,
    dueBefore: filter.dueBefore ?? null,
    orderBy: filter.orderBy ?? null,
    from: filter.from ?? null,
    to: filter.to ?? null,
    contentQuery: filter.contentQuery ?? null,
    recordIds: sorted(filter.recordIds),
  })).slice(0, 24);
}

function encodeLegacySortCursor(orderBy: string, sortKey: number, recordId: string): string {
  return encodeBase64Url(utf8Bytes(JSON.stringify([orderBy, sortKey, recordId])));
}

/** 旧排序路径的游标（无指纹）；含关键词/批量参数时改用紧凑锚点游标。 */
function decodeLegacySortCursor(cursor: string, orderBy: string): { sortKey: number; recordId: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(decodeBase64Url(cursor)));
  } catch {
    throw new Error("分页游标无法解析");
  }
  const legacy = raw as unknown[];
  if (!Array.isArray(legacy) || legacy[0] !== orderBy || typeof legacy[1] !== "number" || !Number.isFinite(legacy[1]) || typeof legacy[2] !== "string") {
    throw new Error("分页游标与排序方式不匹配");
  }
  return { sortKey: legacy[1], recordId: legacy[2] };
}

export class VersionedSqliteMistakeRepository implements VersionedMistakeRepository {
  constructor(private readonly driver: SqlDriver) {}

  private latestSnapshotRow() {
    return this.driver.rows("SELECT snapshot_id, source_id, complete, scope_json, source_hash, record_count FROM snapshots ORDER BY imported_at DESC, rowid DESC LIMIT 1")[0] as
      | { snapshot_id: string; source_id: string; complete: number; scope_json: string; source_hash: string; record_count: number }
      | undefined;
  }

  async latestSnapshotId(): Promise<string | null> {
    return this.latestSnapshotRow()?.snapshot_id ?? null;
  }

  async getSnapshot(snapshotId: string): Promise<SnapshotManifest | null> {
    const row = this.driver.rows("SELECT * FROM snapshots WHERE snapshot_id = ?", [snapshotId])[0] as unknown as
      | { snapshot_id: string; source_id: string; source_revision: string; complete: number; scope_json: string; imported_at: string; data_as_of: string; record_count: number }
      | undefined;
    if (!row) return null;
    return {
      snapshotId: row.snapshot_id,
      sourceId: row.source_id,
      sourceRevision: row.source_revision,
      complete: row.complete === 1,
      scope: JSON.parse(row.scope_json || "{}"),
      importedAt: row.imported_at,
      dataAsOf: row.data_as_of,
      recordCount: row.record_count,
    };
  }

  async listSnapshots(limit: number): Promise<SnapshotManifest[]> {
    const rows = this.driver.rows("SELECT * FROM snapshots ORDER BY imported_at DESC, rowid DESC LIMIT ?", [
      Math.max(1, Math.min(100, limit)),
    ]) as unknown as Array<Record<string, string | number>>;
    return rows.map((row) => ({
      snapshotId: String(row.snapshot_id),
      sourceId: String(row.source_id),
      sourceRevision: String(row.source_revision ?? ""),
      complete: Number(row.complete) === 1,
      scope: JSON.parse(String(row.scope_json || "{}")),
      importedAt: String(row.imported_at),
      dataAsOf: String(row.data_as_of),
      recordCount: Number(row.record_count ?? 0),
    }));
  }

  async applySnapshot(payload: VersionedImportPayload): Promise<VersionedImportResult> {
    const warnings: string[] = [];
    let m = payload.manifest;
    let records = payload.records;
    const scopeJson = canonicalJson({ notebookIds: [...new Set(m.scope?.notebookIds ?? [])].sort() });
    return this.driver.transaction(() => {
      const latestRow = this.latestSnapshotRow();
      const latest = latestRow?.snapshot_id ?? null;
      if (payload.preferIncremental && m.complete && latest &&
          latestRow?.source_id === m.sourceId && latestRow.scope_json === scopeJson) {
        const baseline = this.driver.rows(
          "SELECT record_id, content_hash FROM mistake_projection_v2 WHERE snapshot_id = ?", [latest],
        ) as unknown as Array<{ record_id: string; content_hash: string }>;
        const currentIds = new Set(records.map((record) => record.recordId));
        // 导出中的遗漏是真实删除或 ID 更换时，以完整源视图替换，避免增量继承旧记录。
        if (baseline.every((row) => currentIds.has(row.record_id))) {
          const hashes = new Map(baseline.map((row) => [row.record_id, row.content_hash]));
          records = records.filter((record) => hashes.get(record.recordId) !== sha256Hex(canonicalJson(record)));
          if (records.length === 0) {
            return {
              snapshotId: latest,
              inserted: 0,
              updated: 0,
              unchanged: 0,
              carried: baseline.length,
              repaired: 0,
              recordCount: baseline.length,
              warnings: ["最新快照内容一致，幂等跳过"],
            };
          }
          m = { ...m, complete: false, baseRevision: latest };
        }
      }
      const snapshotId = m.snapshotId ?? sha256Hex(canonicalJson({
        sourceId: m.sourceId, sourceRevision: m.sourceRevision, complete: m.complete,
        scope: scopeJson, baseRevision: m.baseRevision, records,
      }));
      const existing = this.driver.rows("SELECT snapshot_id FROM snapshots WHERE snapshot_id = ?", [snapshotId])[0];
      if (existing) {
        return {
          snapshotId,
          inserted: 0,
          updated: 0,
          unchanged: payload.records.length,
          carried: 0,
          repaired: 0,
          recordCount: payload.records.length,
          warnings: ["快照已存在，幂等跳过（§6.2 同 ID 同内容幂等）"],
        };
      }

      if (!m.complete) {
        if (!m.baseRevision) throw new Error("base_revision_required: 增量快照必须提供 baseRevision（§6.2）");
        if (m.baseRevision !== latest) throw new Error(`base_revision_mismatch: baseRevision ${m.baseRevision} 与当前最新 ${latest ?? "无"} 不一致`);
      }

      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let repaired = 0;
      const repairedIds: string[] = [];

      // 完整快照的跨版本同源对修复：前一版本中同 (notebookId,noteId) 挂着不同 recordId。
      // v2 语义下旧 ID 行天然缺席新版本，此处仅计数与告警（旧端口 markedMissing 据此排除）。
      const prevPair = new Map<string, string>();
      const prevIds = new Set<string>();
      if (m.complete && latest) {
        const prevRows = this.driver.rows(
          "SELECT record_id, source_notebook_id, source_note_id FROM mistake_projection_v2 WHERE snapshot_id = ?",
          [latest],
        ) as unknown as Array<{ record_id: string; source_notebook_id: string; source_note_id: string }>;
        for (const row of prevRows) {
          prevIds.add(row.record_id);
          prevPair.set(`${row.source_notebook_id}\u0000${row.source_note_id}`, row.record_id);
        }
      }

      // 合成完整逻辑视图：完整快照 = 提供记录；增量 = base 版本行 + 覆盖增量（含 recordId 修复替换）。
      const rowsById = new Map<string, { record: VersionedSnapshotRecord; hash: string }>();
      const pairIndex = new Map<string, string>(); // `${notebookId}:${noteId}` → row key (recordId)
      if (!m.complete) {
        const baseRows = this.driver.rows("SELECT * FROM mistake_projection_v2 WHERE snapshot_id = ?", [
          m.baseRevision as string,
        ]) as unknown as V2Row[];
        for (const row of baseRows) {
          const record = rowToRecord(row);
          rowsById.set(record.recordId, { record, hash: row.content_hash });
          pairIndex.set(`${record.sourceNotebookId}\u0000${record.sourceNoteId}`, record.recordId);
        }
      }
      for (const record of records) {
        const hash = sha256Hex(canonicalJson(record));
        const pairKey = `${record.sourceNotebookId}\u0000${record.sourceNoteId}`;
        const replaced = pairIndex.get(pairKey);
        if (replaced !== undefined && replaced !== record.recordId) {
          if (rowsById.delete(replaced)) {
            repaired++;
            repairedIds.push(replaced);
            warnings.push(`recordId 修复：${replaced} → ${record.recordId}（同源对替换）`);
          }
        }
        const prev = rowsById.get(record.recordId);
        if (prev) {
          if (prev.hash === hash) unchanged++;
          else updated++;
          prev.record = record;
          prev.hash = hash;
        } else {
          rowsById.set(record.recordId, { record, hash });
          const baseHash = !m.complete ? this.baseHashOf(m.baseRevision as string, record.recordId) : null;
          if (baseHash === null) inserted++;
          else if (baseHash === hash) unchanged++;
          else updated++;
          pairIndex.set(pairKey, record.recordId);
        }
        // 完整快照：检测跨版本同源对替换（旧 ID 在前一版本存在且不同）。
        if (m.complete) {
          const priorId = prevPair.get(pairKey);
          if (priorId !== undefined && priorId !== record.recordId && !repairedIds.includes(priorId)) {
            repairedIds.push(priorId);
            repaired++;
            warnings.push(`recordId 修复：${priorId} → ${record.recordId}（同源对替换）`);
          }
        }
      }
      const rows = [...rowsById.values()];
      const sourceHash = sha256Hex(canonicalJson(rows.map((r) => r.hash).sort()));
      if (latestRow && latestRow.source_id === m.sourceId &&
          (payload.preferIncremental !== undefined || Number(latestRow.complete) === Number(m.complete)) &&
          latestRow.scope_json === scopeJson && latestRow.source_hash === sourceHash) {
        return {
          snapshotId: latestRow.snapshot_id,
          inserted: 0,
          updated: 0,
          unchanged: records.length,
          carried: !m.complete ? rows.length - records.length : 0,
          repaired: 0,
          recordCount: rows.length,
          warnings: ["最新快照内容一致，幂等跳过"],
        };
      }

      this.driver.exec(
        "INSERT INTO snapshots(snapshot_id, source_id, source_revision, complete, scope_json, imported_at, data_as_of, source_hash, record_count) VALUES(?,?,?,?,?,?,?,?,?)",
        [
          snapshotId, m.sourceId, m.sourceRevision, m.complete ? 1 : 0,
          scopeJson, m.importedAt, m.importedAt, sourceHash, rows.length,
        ],
      );
      const insertRow = this.driver;
      for (const { record, hash } of rows) {
        insertRow.exec(
          `INSERT OR REPLACE INTO mistake_projection_v2(
             snapshot_id, record_id, source_notebook_id, source_note_id, source_available, level, review_count,
             review_completed, next_review_at, last_reviewed_at, favorite, category_path_json, manual_categories_json,
             custom_tags_json, reason_tags_json, error_reasons_json, source_title, source_notebook_title,
             source_root_title, source_path_titles_json, question_text, answer_text, text_status,
             created_at, updated_at, answer_notebook_id, answer_root_node_id, content_hash, raw_json, ocr_json,
             answer_text_origin, answer_source_notebook_id, answer_source_note_id, answer_status, answer_reason
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            snapshotId, record.recordId, record.sourceNotebookId, record.sourceNoteId,
            record.sourceAvailable === null ? null : record.sourceAvailable ? 1 : 0,
            record.level ?? null, record.currentLevelReviewCount ?? null,
            record.reviewCompleted === null ? null : record.reviewCompleted ? 1 : 0,
            record.nextReviewAt ?? null, record.lastReviewedAt ?? null,
            record.favorite === null ? null : record.favorite ? 1 : 0,
            JSON.stringify(record.categoryPath), JSON.stringify(record.manualCategories),
            JSON.stringify(record.customTags), JSON.stringify(record.reasonTags),
            JSON.stringify(record.errorReasons),
            record.sourceTitle ?? null, record.sourceNotebookTitle ?? null, record.sourceRootTitle ?? null,
            JSON.stringify(record.sourcePathTitles),
            record.questionText ?? null, record.answerText ?? null,
            record.ocr.status,
            record.createdAt ?? null, record.updatedAt ?? null,
            record.answerNotebookId ?? null, record.answerRootNodeId ?? null,
            hash, JSON.stringify(Array.isArray(record.sourcePayload?.history) || !record.history.length
              ? record.sourcePayload ?? {}
              : { ...record.sourcePayload, history: record.history }),
            record.ocr.rawText || record.ocr.manualText || record.ocr.effectiveText
              ? JSON.stringify(record.ocr)
              : null,
            record.answerTextOrigin ?? null, record.answerSourceNotebookId ?? null,
            record.answerSourceNoteId ?? null, record.answerStatus ?? null, record.answerReason ?? null,
          ],
        );
        insertReviewEvents(this.driver, snapshotId, record);
      }

      // 旧端口兼容计数（§21.2）：unavailable = 提供记录中 sourceAvailable=false；
      // markedMissing = 完整快照下前一版本有而本版本缺席（排除修复替换）。
      let unavailable = 0;
      for (const record of payload.records) {
        if (record.sourceAvailable === false) unavailable++;
      }
      let markedMissing = 0;
      if (m.complete && payload.records.length > 0 && prevIds.size) {
        const providedIds = new Set(payload.records.map((r) => r.recordId));
        for (const id of prevIds) {
          if (!providedIds.has(id) && !repairedIds.includes(id)) markedMissing++;
        }
        if (markedMissing > 0) {
          warnings.push(`${markedMissing} 条记录未出现在完整快照中，已标记缺失（未删除）`);
        }
      }

      return {
        snapshotId,
        inserted,
        updated,
        unchanged,
        carried: !m.complete ? rows.length - records.length : 0,
        repaired,
        ...(repairedIds.length ? { repairedIds } : {}),
        unavailable,
        ...(m.complete ? { markedMissing } : { markedMissing: 0 }),
        recordCount: rows.length,
        warnings,
      };
    });
  }

  private baseHashOf(baseSnapshotId: string, recordId: string): string | null {
    const row = this.driver.rows("SELECT content_hash FROM mistake_projection_v2 WHERE snapshot_id = ? AND record_id = ?", [
      baseSnapshotId,
      recordId,
    ])[0] as { content_hash: string } | undefined;
    return row ? row.content_hash : null;
  }

  async query(snapshotId: string, filter: VersionedFilter, scope: SessionScope): Promise<VersionedPage> {
    await this.assertSnapshot(snapshotId);
    const { where, params } = buildWhere(filter, scope);
    const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
    if (filter.queueOrder) {
      const order = filter.queueOrder === "dueToday"
        ? `${DUE_TIME}, COALESCE(mv.level, 3), mv.record_id`
        : `mv.level, ${VERIFIED_REVIEW_COUNT} DESC, mv.record_id`;
      const rows = this.driver.rows(
        `SELECT * FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where} ORDER BY ${order} LIMIT ?`,
        [snapshotId, ...params, limit],
      );
      const meta = await this.getSnapshot(snapshotId);
      return { records: rows.map((row) => rowToRecord(row as unknown as V2Row)), snapshotId, dataAsOf: meta?.dataAsOf ?? new Date().toISOString() };
    }
    // v2.13 §9.2：关键词/批量模式用带查询指纹的游标；旧查询保持原游标与排序语义。
    if (filter.contentQuery || filter.recordIds) {
      const fingerprint = queryFingerprint(snapshotId, filter, scope);
      if (filter.orderBy) {
        return this.querySorted(snapshotId, where, params, filter.orderBy, limit, filter.cursor, fingerprint);
      }
      return this.querySearch(snapshotId, where, params, limit, filter.cursor, fingerprint);
    }
    if (filter.orderBy) return this.querySorted(snapshotId, where, params, filter.orderBy, limit, filter.cursor);
    const cursorTuple = filter.cursor ? legacyTupleCursor(filter.cursor) : null;
    const cursorWhere = cursorTuple ? ` AND (mv.category_path_json, mv.source_title, mv.created_at, mv.record_id) > (?,?,?,?)` : "";
    const cursorParams = cursorTuple ? [cursorTuple.category, cursorTuple.title, cursorTuple.createdAt, cursorTuple.recordId] : [];
    const rows = this.driver
      .rows(
        `SELECT * FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}${cursorWhere} ORDER BY mv.${QUERY_ORDER} LIMIT ?`,
        [snapshotId, ...params, ...cursorParams, limit + 1],
      )
      .map((r) => rowToRecord(r as unknown as V2Row));
    const meta = await this.getSnapshot(snapshotId);
    const page: VersionedPage = { records: rows.slice(0, limit), snapshotId, dataAsOf: meta?.dataAsOf ?? new Date().toISOString() };
    if (rows.length > limit) {
      const lastRow = rows[limit - 1] as VersionedSnapshotRecord;
      page.nextCursor = encodeLegacyTupleCursor({
        category: JSON.stringify(lastRow.categoryPath),
        title: lastRow.sourceTitle ?? "",
        createdAt: lastRow.createdAt ?? "",
        recordId: lastRow.recordId,
      });
    }
    return page;
  }

  /**
   * v2.13 §9.2：关键词/批量模式的默认稳定排序（分类 → 标题 → 创建时间 → recordId）。
   * 键值统一 COALESCE 为空串，保证 NULL 行也参与 keyset 分页，逐页不重复不漏项。
   * 游标只带锚点 recordId；排序键由此处在同快照/同 scope/同筛选条件下重新取回。
   */
  private async querySearch(
    snapshotId: string,
    where: string,
    params: (string | number)[],
    limit: number,
    cursor: string | undefined,
    fingerprint: string,
  ): Promise<VersionedPage> {
    const anchor = cursor ? this.anchorTuple(snapshotId, where, params, decodeAnchorCursor(cursor, fingerprint)) : undefined;
    const order = "mv.category_path_json, COALESCE(mv.source_title, ''), COALESCE(mv.created_at, ''), mv.record_id";
    const cursorWhere = anchor
      ? " AND (mv.category_path_json, COALESCE(mv.source_title, ''), COALESCE(mv.created_at, ''), mv.record_id) > (?,?,?,?)"
      : "";
    const cursorParams = anchor ? [anchor.category, anchor.title, anchor.createdAt, anchor.recordId] : [];
    const rows = this.driver
      .rows(
        `SELECT * FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}${cursorWhere} ORDER BY ${order} LIMIT ?`,
        [snapshotId, ...params, ...cursorParams, limit + 1],
      )
      .map((r) => rowToRecord(r as unknown as V2Row));
    const meta = await this.getSnapshot(snapshotId);
    const page: VersionedPage = { records: rows.slice(0, limit), snapshotId, dataAsOf: meta?.dataAsOf ?? new Date().toISOString() };
    if (rows.length > limit) {
      const lastRow = rows[limit - 1] as VersionedSnapshotRecord;
      page.nextCursor = encodeAnchorCursor(fingerprint, lastRow.recordId);
    }
    return page;
  }

  /** 锚点排序键：在锁定快照与当前筛选内按 recordId 重新计算（不接受客户端提供的元组）。 */
  private anchorTuple(snapshotId: string, where: string, params: (string | number)[], recordId: string): CursorTuple {
    const row = this.driver.rows(
      `SELECT mv.category_path_json AS category, COALESCE(mv.source_title, '') AS title,
        COALESCE(mv.created_at, '') AS createdAt, mv.record_id AS recordId
       FROM mistake_projection_v2 mv
       WHERE mv.snapshot_id = ? AND ${where} AND mv.record_id = ? LIMIT 1`,
      [snapshotId, ...params, recordId],
    )[0] as unknown as CursorTuple | undefined;
    if (!row || row.recordId !== recordId) throw cursorMismatch();
    return row;
  }

  private anchorSortKey(
    snapshotId: string,
    where: string,
    params: (string | number)[],
    orderBy: NonNullable<VersionedFilter["orderBy"]>,
    recordId: string,
  ): number {
    const byReview = orderBy === "reviewCountDesc";
    const rank = byReview ? `-${VERIFIED_REVIEW_COUNT}` : `ROUND((${DUE_TIME} - 2440587.5) * 86400000)`;
    const row = this.driver.rows(
      `SELECT sort_key FROM (
        SELECT mv.record_id AS record_id, ${rank} AS sort_key
        FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}
      ) WHERE record_id = ? LIMIT 1`,
      [snapshotId, ...params, recordId],
    )[0] as { sort_key: number } | undefined;
    if (!row || typeof row.sort_key !== "number" || !Number.isFinite(row.sort_key)) throw cursorMismatch();
    // reviewCountDesc 只包含有可核实复习的记录；0 次复核对应该排序结果之外。
    if (byReview && !(row.sort_key < 0)) throw cursorMismatch();
    return row.sort_key;
  }

  private async querySorted(
    snapshotId: string,
    where: string,
    params: (string | number)[],
    orderBy: NonNullable<VersionedFilter["orderBy"]>,
    limit: number,
    cursor?: string,
    fingerprint?: string,
  ): Promise<VersionedPage> {
    const byReview = orderBy === "reviewCountDesc";
    // Both sorts use an ascending tuple for stable keyset pagination.
    const rank = byReview ? `-${VERIFIED_REVIEW_COUNT}` : `ROUND((${DUE_TIME} - 2440587.5) * 86400000)`;
    const base = `FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}`;
    const all = [snapshotId, ...params];
    const pageWhere = byReview ? ["sort_key < 0"] : ["1=1"];
    if (cursor) {
      let key: { sortKey: number; recordId: string };
      if (fingerprint) {
        const recordId = decodeAnchorCursor(cursor, fingerprint);
        key = { recordId, sortKey: this.anchorSortKey(snapshotId, where, params, orderBy, recordId) };
      } else {
        key = decodeLegacySortCursor(cursor, orderBy);
      }
      pageWhere.push("(sort_key, record_id) > (?, ?)");
      all.push(key.sortKey, key.recordId);
    }
    const rows = this.driver.rows(
      `SELECT *${byReview ? ", -sort_key AS verified_review_count" : ""} FROM (
        SELECT mv.*, ${rank} AS sort_key ${base}
      ) WHERE ${pageWhere.join(" AND ")} ORDER BY sort_key, record_id LIMIT ?`,
      [...all, limit + 1],
    ) as unknown as Array<V2Row & { sort_key: number }>;
    const meta = await this.getSnapshot(snapshotId);
    const page: VersionedPage = {
      records: rows.slice(0, limit).map(rowToRecord),
      snapshotId,
      dataAsOf: meta?.dataAsOf ?? new Date().toISOString(),
    };
    if (byReview) page.reviewCoverage = this.reviewCoverage(base, [snapshotId, ...params]);
    if (rows.length > limit) {
      const last = rows[limit - 1]!;
      page.nextCursor = fingerprint
        ? encodeAnchorCursor(fingerprint, last.record_id)
        : encodeLegacySortCursor(orderBy, last.sort_key, last.record_id);
    }
    return page;
  }

  private reviewCoverage(base: string, params: (string | number)[]): ReviewCoverage {
    const row = this.driver.rows(
      `SELECT COUNT(*) AS matchingRecords,
        COUNT(CASE WHEN EXISTS (SELECT 1 FROM ${HISTORY_ROWS} WHERE ${VALID_HISTORY_EVENT}) THEN 1 END) AS recordsWithHistory
        ${base}`, params,
    )[0] as ReviewCoverage;
    return { matchingRecords: row.matchingRecords, recordsWithHistory: row.recordsWithHistory };
  }

  async report(snapshotId: string, filter: MistakeReportFilter, scope: SessionScope): Promise<MistakeReport> {
    await this.assertSnapshot(snapshotId);
    const meta = await this.getSnapshot(snapshotId);
    const evidence = { snapshotId, dataAsOf: meta?.dataAsOf ?? new Date().toISOString() };
    const { where, params } = buildWhere(filter, scope);
    const base = `FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}`;
    const all = [snapshotId, ...params];
    if (filter.report === "errorReasons") {
      const limit = 20;
      const reasonRows = `WITH candidates AS (
        SELECT mv.record_id, mv.raw_json, mv.error_reasons_json ${base}
      ), reason_entries AS (
        SELECT mv.record_id, reason.value AS reason
        FROM candidates mv, json_each(mv.error_reasons_json) reason
        WHERE reason.type = 'object'
        UNION ALL
        SELECT mv.record_id, CASE WHEN history.type = 'object' THEN json_extract(history.value, '$.errorReason') END AS reason
        FROM candidates mv, ${HISTORY_ROWS}
        WHERE ${VALID_HISTORY_EVENT}
      ), reasons AS (
        SELECT record_id, json_extract(reason, '$.key') AS key, json_extract(reason, '$.label') AS label
        FROM reason_entries WHERE json_valid(reason)
      ), valid_reasons AS (
        SELECT record_id, key, COALESCE(NULLIF(label, ''), key) AS label
        FROM reasons WHERE typeof(key) = 'text' AND key <> ''
      )`;
      const reasons = this.driver.rows(
        `${reasonRows}
          SELECT key, MIN(label) AS label, COUNT(DISTINCT record_id) AS recordCount
          FROM valid_reasons GROUP BY key ORDER BY recordCount DESC, key LIMIT ?`, [...all, limit + 1],
      ) as Array<{ key: string; label: string; recordCount: number }>;
      const counts = this.driver.rows(
        `${reasonRows}
          SELECT (SELECT COUNT(*) FROM candidates) AS matchingRecords,
            COUNT(DISTINCT record_id) AS recordsWithErrorReasons FROM valid_reasons`, all,
      )[0] as { matchingRecords: number; recordsWithErrorReasons: number };
      return { ...evidence, report: filter.report, ...counts, reasons: reasons.slice(0, limit), hasMore: reasons.length > limit };
    }

    if (filter.report === "coverage") {
      return this.coverageReport(filter, scope, base, all, evidence);
    }

    if (filter.report === "repeatedReviewErrors") {
      return this.repeatedReviewErrorsReport(filter, where, all, evidence);
    }

    const { eventWhere, eventParams } = this.reviewEventScope(filter, all);
    const activity = this.driver.rows(
      `SELECT COUNT(*) AS verifiedReviewCount, COUNT(DISTINCT mv.record_id) AS reviewedRecordCount,
        strftime('%Y-%m-%dT%H:%M:%fZ', MAX(${HISTORY_TIME})) AS lastReviewedAt
        FROM mistake_projection_v2 mv, ${HISTORY_ROWS}
        WHERE mv.snapshot_id = ? AND ${where} AND ${eventWhere.join(" AND ")}`, eventParams,
    )[0] as { verifiedReviewCount: number; reviewedRecordCount: number; lastReviewedAt: string | null };
    return {
      ...evidence,
      report: "reviewActivity",
      reviewCoverage: this.reviewCoverage(base, all),
      verifiedReviewCount: Number(activity.verifiedReviewCount),
      reviewedRecordCount: Number(activity.reviewedRecordCount),
      lastReviewedAt: activity.lastReviewedAt ?? undefined,
    };
  }

  /** 复习事件窗口（§9.1/§9.4 共用）：半开区间，按实际发生时间比较。 */
  private reviewEventScope(
    filter: MistakeReportFilter,
    all: (string | number)[],
  ): { eventWhere: string[]; eventParams: (string | number)[] } {
    const eventWhere = [VERIFIED_REVIEW];
    const eventParams = [...all];
    if (filter.reviewFrom) {
      eventWhere.push(`${HISTORY_TIME} >= julianday(?)`);
      eventParams.push(filter.reviewFrom);
    }
    if (filter.reviewBefore) {
      eventWhere.push(`${HISTORY_TIME} < julianday(?)`);
      eventParams.push(filter.reviewBefore);
    }
    return { eventWhere, eventParams };
  }

  /**
   * v2.18 §9.4：跨题错因复习历史。
   * 只计可核实 review（排除 mark/无效时间）且带非空错因键的事件；同一题 ≥2 笔才入榜。
   */
  private repeatedReviewErrorsReport(
    filter: MistakeReportFilter,
    where: string,
    all: (string | number)[],
    evidence: { snapshotId: string; dataAsOf: ISODateTime },
  ): MistakeReport {
    const limit = Math.max(1, Math.min(50, filter.limit ?? 20));
    const { eventWhere, eventParams } = this.reviewEventScope(filter, all);
    const cte = `WITH events AS (
        SELECT mv.record_id AS record_id, ${HISTORY_AT} AS at,
          ${HISTORY_REASON_KEY} AS key, ${HISTORY_REASON_LABEL} AS label
        FROM mistake_projection_v2 mv, ${HISTORY_ROWS}
        WHERE mv.snapshot_id = ? AND ${where} AND ${eventWhere.join(" AND ")}
      ), qualifying AS (
        SELECT record_id, at,
          ${sqlTrimWhitespace("key")} AS key,
          COALESCE(NULLIF(${sqlTrimWhitespace("label")}, ''), ${sqlTrimWhitespace("key")}) AS label
        FROM events
        WHERE typeof(key) = 'text' AND ${sqlTrimWhitespace("key")} <> ''
      ), per_record AS (
        SELECT record_id, COUNT(*) AS eventCount,
          strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(at))) AS lastEventAt
        FROM qualifying GROUP BY record_id
      )`;
    const counts = this.driver.rows(
      `${cte}
       SELECT
         (SELECT COUNT(*) FROM per_record WHERE eventCount >= 2) AS totalMatchedRecords,
         (SELECT COUNT(*) FROM per_record) AS recordsWithQualifyingEvents,
         (SELECT COALESCE(SUM(eventCount), 0) FROM per_record) AS totalQualifyingEvents,
         (SELECT COUNT(DISTINCT record_id) FROM events) AS reviewedRecordsInWindow`,
      eventParams,
    )[0] as {
      totalMatchedRecords: number;
      recordsWithQualifyingEvents: number;
      totalQualifyingEvents: number;
      reviewedRecordsInWindow: number;
    };
    const page = this.driver.rows(
      `${cte}
       SELECT record_id AS recordId, eventCount, lastEventAt
       FROM per_record WHERE eventCount >= 2
       ORDER BY eventCount DESC, record_id ASC LIMIT ?`,
      [...eventParams, limit],
    ) as Array<{ recordId: string; eventCount: number; lastEventAt: string | null }>;
    const recordIds = page.map((row) => row.recordId);
    const keyRows = recordIds.length
      ? this.driver.rows(
          `${cte}, key_counts AS (
             SELECT record_id, key, MIN(label) AS label, COUNT(*) AS eventCount
             FROM qualifying WHERE record_id IN (${recordIds.map(() => "?").join(",")})
             GROUP BY record_id, key
           )
           SELECT record_id, key, label, eventCount FROM key_counts
           ORDER BY record_id ASC, eventCount DESC, key ASC`,
          [...eventParams, ...recordIds],
        ) as Array<{ record_id: string; key: string; label: string; eventCount: number }>
      : [];
    const keysByRecord = new Map<string, Array<{ key: string; label: string; eventCount: number }>>();
    for (const row of keyRows) {
      const list = keysByRecord.get(row.record_id) ?? [];
      list.push({ key: row.key, label: row.label, eventCount: Number(row.eventCount) });
      keysByRecord.set(row.record_id, list);
    }
    const records = page.map((row) => {
      const keys = keysByRecord.get(row.recordId) ?? [];
      return {
        recordId: row.recordId,
        eventCount: Number(row.eventCount),
        ...(row.lastEventAt ? { lastEventAt: String(row.lastEventAt) } : {}),
        errorKeys: keys.slice(0, 5),
        errorKeyCount: keys.length,
      };
    });
    const matchingRecords = Number((this.driver.rows(`SELECT COUNT(*) AS n FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}`, all)[0] as { n: number }).n);
    const reviewCoverage = this.reviewCoverage(`FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}`, all);
    const totalMatchedRecords = Number(counts.totalMatchedRecords);
    const notes: string[] = [];
    if (matchingRecords === 0) {
      notes.push("筛选范围内没有错题记录，数据不足。");
    } else if (reviewCoverage.recordsWithHistory === 0) {
      notes.push("筛选范围内没有可核实的复习历史。");
    } else if (Number(counts.reviewedRecordsInWindow) === 0) {
      notes.push("历史中存在复习记录，但所选复习窗口内没有可核实的复习事件（可能只有入册标记，或复习时间不在该窗口）。");
    } else if (Number(counts.recordsWithQualifyingEvents) === 0) {
      notes.push("所选复习窗口内有可核实复习事件，但没有任何一笔带非空错因键；无法判断反复记录错因。");
    } else if (totalMatchedRecords === 0) {
      notes.push("存在带错因的复习记录，但没有任何错题达到至少两笔，未形成反复记录错因的榜单。");
    }
    return {
      ...evidence,
      report: "repeatedReviewErrors",
      matchingRecords,
      reviewCoverage,
      reviewedRecordsInWindow: Number(counts.reviewedRecordsInWindow),
      recordsWithQualifyingEvents: Number(counts.recordsWithQualifyingEvents),
      totalMatchedRecords,
      totalQualifyingEvents: Number(counts.totalQualifyingEvents),
      window: {
        ...(filter.reviewFrom ? { from: filter.reviewFrom } : {}),
        ...(filter.reviewBefore ? { before: filter.reviewBefore } : {}),
      },
      records,
      truncated: totalMatchedRecords > records.length,
      omittedRecords: Math.max(0, totalMatchedRecords - records.length),
      interpretation: REPEATED_REVIEW_INTERPRETATION,
      notes,
    };
  }

  /**
   * v2.16 §9.3：确定性覆盖率报表。维度/键/分母/多值非互斥/空值/排序与上限在规范中固定；
   * 分组与计数全部由参数化 SQLite 在同一快照与同一 scope 内产生，模型不得自行计数。
   */
  private coverageReport(
    filter: MistakeReportFilter,
    scope: SessionScope,
    base: string,
    all: (string | number)[],
    evidence: { snapshotId: string; dataAsOf: ISODateTime },
  ): MistakeReport {
    const limit = Math.max(1, Math.min(50, filter.limit ?? 20));
    const answerScopeParams: string[] = scope.notebookIds.length ? [...scope.notebookIds, ...scope.notebookIds] : [];
    const answerScopeExpr = scope.notebookIds.length
      ? `s.a_source_notebook IN (${scope.notebookIds.map(() => "?").join(",")})`
      : "1=1";
    const cte = `
      WITH scoped AS (
        SELECT
          mv.record_id AS record_id,
          mv.source_notebook_id AS notebook_id,
          COALESCE(mv.source_notebook_title, '') AS notebook_title,
          COALESCE(json_extract(mv.category_path_json, '$[0]'), '') AS category0,
          mv.custom_tags_json AS custom_tags_json,
          CASE WHEN COALESCE(mv.question_text, '') <> '' THEN 1 ELSE 0 END AS q_avail,
          CASE WHEN COALESCE(mv.answer_text, '') <> '' THEN 1 ELSE 0 END AS a_text,
          CASE
            WHEN mv.answer_text_origin = 'answer_card'
              THEN (mv.answer_source_notebook_id IS NOT NULL AND mv.answer_source_note_id IS NOT NULL)
            ELSE (mv.answer_notebook_id IS NOT NULL AND mv.answer_root_node_id IS NOT NULL)
          END AS a_source_present,
          CASE
            WHEN mv.answer_text_origin = 'answer_card' THEN mv.answer_source_notebook_id
            ELSE mv.answer_notebook_id
          END AS a_source_notebook,
          CASE WHEN EXISTS (
            SELECT 1 FROM json_each(mv.raw_json, '$.history') h
            WHERE typeof(h.key) = 'integer' AND h.key > 0
              AND json_extract(h.value, '$.at') GLOB ${ISO_DATE_PREFIX}
              AND julianday(json_extract(h.value, '$.at')) IS NOT NULL
          ) THEN 1 ELSE 0 END AS review_avail,
          CASE WHEN EXISTS (
            SELECT 1 FROM json_each(mv.raw_json, '$.history') h
            WHERE typeof(h.key) = 'integer' AND json_type(h.value) = 'object'
          ) THEN 1 ELSE 0 END AS history_present
        ${base}
      ),
      flagged AS (
        SELECT
          s.record_id AS record_id,
          s.notebook_id AS notebook_id,
          s.notebook_title AS notebook_title,
          s.category0 AS category0,
          s.custom_tags_json AS custom_tags_json,
          s.q_avail AS q_avail,
          CASE WHEN s.a_text = 1 AND s.a_source_present = 1 AND (${answerScopeExpr}) THEN 1 ELSE 0 END AS a_avail,
          CASE WHEN s.a_text = 1 AND s.a_source_present = 0 THEN 1 ELSE 0 END AS a_unlocatable,
          CASE WHEN s.a_text = 1 AND s.a_source_present = 1 AND NOT (${answerScopeExpr}) THEN 1 ELSE 0 END AS a_out_of_scope,
          CASE WHEN s.a_text = 0 THEN 1 ELSE 0 END AS a_missing,
          s.review_avail AS review_avail,
          CASE WHEN s.history_present = 1 AND s.review_avail = 0 THEN 1 ELSE 0 END AS review_none,
          CASE WHEN s.history_present = 0 THEN 1 ELSE 0 END AS review_missing
        FROM scoped s
      )`;
    const cteParams = [...all, ...answerScopeParams];
    const matching = this.driver.rows(`${cte} SELECT COUNT(*) AS n FROM flagged`, cteParams)[0] as { n: number };
    const matchingRecords = Number(matching.n);
    const notes: string[] = matchingRecords === 0
      ? ["筛选范围内没有错题记录，覆盖率数据不足。"]
      : [];

    const toGroup = (row: CoverageGroupRow): CoverageGroup => ({
      key: String(row.key),
      label: String(row.label),
      recordCount: Number(row.recordCount),
      coverage: {
        questionText: { available: Number(row.qAvail), missing: Number(row.qMissing) },
        answerText: {
          available: Number(row.aAvail),
          missing: Number(row.aMissing),
          unlocatable: Number(row.aUnlocatable),
          outOfScope: Number(row.aOutOfScope),
        },
        reviewHistory: {
          available: Number(row.rAvail),
          none: Number(row.rNone),
          missing: Number(row.rMissing),
        },
      },
    });

    const groupSelect = (keyExpr: string, labelExpr: string, from: string, group: string): string => `
      SELECT ${keyExpr} AS key, ${labelExpr} AS label, COUNT(*) AS recordCount,
        SUM(q_avail) AS qAvail, SUM(1 - q_avail) AS qMissing,
        SUM(a_avail) AS aAvail, SUM(a_missing) AS aMissing,
        SUM(a_unlocatable) AS aUnlocatable, SUM(a_out_of_scope) AS aOutOfScope,
        SUM(review_avail) AS rAvail, SUM(review_none) AS rNone, SUM(review_missing) AS rMissing
      FROM ${from} ${group !== "" ? `GROUP BY ${group}` : ""}
      ORDER BY recordCount DESC, key ASC LIMIT ${limit + 1}`;

    const notebookRows = this.driver.rows(
      `${cte} ${groupSelect("notebook_id", "MIN(CASE WHEN notebook_id = '' THEN '未知学习集' ELSE notebook_title END)", "flagged", "notebook_id")}`,
      cteParams,
    ) as unknown as CoverageGroupRow[];
    const notebookTotal = (this.driver.rows(
      `${cte} SELECT COUNT(*) AS n FROM (SELECT 1 FROM flagged GROUP BY notebook_id)`,
      cteParams,
    )[0] as { n: number }).n;

    const categoryRows = this.driver.rows(
      `${cte} ${groupSelect("CASE WHEN category0 = '' THEN '(uncategorized)' ELSE category0 END", "CASE WHEN category0 = '' THEN '未分类' ELSE category0 END", "flagged", "category0")}`,
      cteParams,
    ) as unknown as CoverageGroupRow[];
    const categoryTotal = (this.driver.rows(
      `${cte} SELECT COUNT(*) AS n FROM (SELECT 1 FROM flagged GROUP BY category0)`,
      cteParams,
    )[0] as { n: number }).n;

    // 一题多标签：每个标签计一次；同一记录重复出现同一标签时先去重（DISTINCT 含全部标记列）。
    const tagCte = `${cte},
      tag_rows AS (
        SELECT DISTINCT f.record_id AS record_id, trim(t.value) AS tag,
          f.q_avail AS q_avail, f.a_avail AS a_avail, f.a_missing AS a_missing,
          f.a_unlocatable AS a_unlocatable, f.a_out_of_scope AS a_out_of_scope,
          f.review_avail AS review_avail, f.review_none AS review_none, f.review_missing AS review_missing
        FROM flagged f, json_each(f.custom_tags_json) t
        WHERE trim(t.value) <> ''
      )`;
    const tagRows = this.driver.rows(
      `${tagCte} SELECT tag AS key, tag AS label, COUNT(*) AS recordCount,
        SUM(q_avail) AS qAvail, SUM(1 - q_avail) AS qMissing,
        SUM(a_avail) AS aAvail, SUM(a_missing) AS aMissing,
        SUM(a_unlocatable) AS aUnlocatable, SUM(a_out_of_scope) AS aOutOfScope,
        SUM(review_avail) AS rAvail, SUM(review_none) AS rNone, SUM(review_missing) AS rMissing
      FROM tag_rows
      GROUP BY tag
      ORDER BY recordCount DESC, key ASC LIMIT ${limit + 1}`,
      cteParams,
    ) as unknown as CoverageGroupRow[];
    const tagTotal = (this.driver.rows(
      `${tagCte} SELECT COUNT(DISTINCT tag) AS n FROM tag_rows`,
      cteParams,
    )[0] as { n: number }).n;
    const tagRecordCount = (this.driver.rows(
      `${tagCte} SELECT COUNT(DISTINCT record_id) AS n FROM tag_rows`,
      cteParams,
    )[0] as { n: number }).n;
    const tagWithoutValue = Math.max(0, matchingRecords - Number(tagRecordCount));

    const toDimension = (
      key: CoverageDimensionKey,
      label: string,
      multiValue: boolean,
      recordCount: number,
      recordsWithoutValue: number,
      totalGroups: number,
      rows: CoverageGroupRow[],
      denominator: string,
    ) => {
      const truncated = totalGroups > limit;
      return {
        key,
        label,
        multiValue,
        recordCount,
        recordsWithoutValue,
        totalGroups,
        groups: rows.slice(0, limit).map(toGroup),
        truncated,
        omittedGroups: Math.max(0, totalGroups - rows.slice(0, limit).length),
        denominator,
      };
    };

    const dimensions = [
      toDimension(
        "notebook",
        "按学习集",
        false,
        matchingRecords,
        0,
        Number(notebookTotal),
        notebookRows,
        "筛选内错题按其来源学习集分组（同名不同 ID 分为两组）",
      ),
      toDimension(
        "category",
        "按分类",
        false,
        matchingRecords,
        0,
        Number(categoryTotal),
        categoryRows,
        "筛选内错题按分类路径首层分组（空分类归入未分类）",
      ),
      toDimension(
        "customTag",
        "按自定义标签",
        true,
        Number(tagRecordCount),
        Number(tagWithoutValue),
        Number(tagTotal),
        tagRows,
        "筛选内错题按去空白后的自定义标签分组（一题多标签分别计入）",
      ),
    ];
    if (notes.length === 0 && dimensions.every((dimension) => dimension.totalGroups === 0)) {
      notes.push("筛选范围内各维度均无可分组的可用值，覆盖率数据不足。");
    }
    return { ...evidence, report: "coverage", matchingRecords, dimensions, notes };
  }

  async get(snapshotId: string, recordId: string, scope: SessionScope): Promise<VersionedSnapshotRecord | null> {
    await this.assertSnapshot(snapshotId);
    if (scope.notebookIds.length) {
      const row = this.driver.rows("SELECT * FROM mistake_projection_v2 WHERE snapshot_id = ? AND record_id = ?", [snapshotId, recordId])[0] as unknown as V2Row | undefined;
      if (!row) return null;
      if (!scope.notebookIds.includes(row.source_notebook_id)) return null;
      return rowToRecord(row);
    }
    const row = this.driver.rows("SELECT * FROM mistake_projection_v2 WHERE snapshot_id = ? AND record_id = ?", [snapshotId, recordId])[0] as unknown as V2Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  async stats(
    snapshotId: string,
    filter: VersionedFilter,
    scope: SessionScope,
    now: Date,
    timezone?: string,
    dueBeforeOverride?: ISODateTime,
  ): Promise<VersionedStats> {
    await this.assertSnapshot(snapshotId);
    const { where, params } = buildWhere(filter, scope);
    const base = `FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where}`;
    const all = [snapshotId, ...params];
    const total = (this.driver.rows(`SELECT COUNT(*) AS n ${base}`, all)[0] as { n: number }).n;
    const levelRows = this.driver.rows(`SELECT mv.level AS level, COUNT(*) AS n ${base} GROUP BY mv.level`, all) as unknown as Array<{ level: number | null; n: number }>;
    const levelCounts: Record<LevelBucket, number> = { "0": 0, "1": 0, "2": 0, unknown: 0 };
    for (const r of levelRows) {
      const bucket: LevelBucket = r.level === null ? "unknown" : (String(r.level) as LevelBucket);
      levelCounts[bucket] += r.n;
    }
    const tz = timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const dueBoundary = dueBeforeOverride ?? endOfLocalDayOf(now, tz);
    const due = (this.driver
      .rows(`SELECT COUNT(*) AS n ${base} AND ${DUE_ELIGIBLE} AND ${DUE_TIME} < julianday(?)`, [...all, dueBoundary])[0] as { n: number }).n;
    const available = (this.driver.rows(`SELECT COUNT(*) AS n ${base} AND mv.source_available = 1`, all)[0] as { n: number }).n;
    const reviewed = (this.driver.rows(`SELECT COUNT(*) AS n ${base} AND mv.last_reviewed_at IS NOT NULL`, all)[0] as { n: number }).n;
    const reviewCountSum = (this.driver.rows(`SELECT COALESCE(SUM(mv.review_count), 0) AS n ${base}`, all)[0] as { n: number }).n;
    // G2 and the reports count actions from the same pinned history.
    const reviewActions = (this.driver
      .rows(
        `SELECT COALESCE(SUM(${VERIFIED_REVIEW_COUNT}), 0) AS n ${base}`, all,
      )[0] as { n: number }).n;
    const meta = await this.getSnapshot(snapshotId);
    return {
      totalRecords: Number(total),
      totalMistakes: Number(total),
      availableRecords: Number(available),
      levelCounts,
      dueCount: Number(due),
      reviewedRecordCount: Number(reviewed),
      reviewedCount: Number(reviewed),
      totalReviewActions: Number(reviewActions),
      reviewEventCount: Number(reviewActions),
      currentLevelReviewCountSum: Number(reviewCountSum),
      snapshotId,
      dataAsOf: meta?.dataAsOf ?? now.toISOString(),
      params: { statsTime: now.toISOString(), timezone: tz, dueBoundary },
    };
  }

  async history(snapshotId: string, recordId: string, scope: SessionScope): Promise<ReviewEventLike[]> {
    await this.assertSnapshot(snapshotId);
    const record = await this.get(snapshotId, recordId, scope);
    if (!record) return [];
    // 历史事件暂存于 raw_json.history（平铺 {at, level, errorReason}），mark=首条。
    const raw = record.sourcePayload as { history?: Array<{ at: string; level: number | null; errorReason?: { key: string; label: string } }> };
    const history = Array.isArray(raw?.history) ? raw.history : [];
    return history.map((h, index) => ({
      id: `${recordId}:${index}`,
      recordId,
      at: String(h.at ?? ""),
      level: h.level === 0 || h.level === 1 || h.level === 2 ? h.level : null,
      errorReason: h.errorReason,
      eventType: index === 0 ? ("mark" as const) : ("review" as const),
      source: "cardlink_history",
    }));
  }

  async getCategoryDistribution(snapshotId: string, filter: VersionedFilter, scope: SessionScope): Promise<Array<{ path: string[]; count: number }>> {
    await this.assertSnapshot(snapshotId);
    const { where, params } = buildWhere(filter, scope);
    const rows = this.driver
      .rows(
        `SELECT mv.category_path_json AS path, COUNT(*) AS n FROM mistake_projection_v2 mv WHERE mv.snapshot_id = ? AND ${where} GROUP BY mv.category_path_json ORDER BY n DESC LIMIT 50`,
        [snapshotId, ...params],
      )
      .map((r) => ({ path: JSON.parse(String(r.path)) as string[], count: Number(r.n) }));
    return rows;
  }

  private async assertSnapshot(snapshotId: string): Promise<void> {
    if (snapshotId === "none") return;
    const exists = this.driver.rows("SELECT snapshot_id FROM snapshots WHERE snapshot_id = ?", [snapshotId])[0];
    if (!exists) throw new Error(`snapshot_not_found: ${snapshotId}`);
  }
}

function endOfLocalDayOf(instant: Date, timeZone: string): string {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = dayFmt.format(instant).split("-").map(Number);
  const offsetAt = (utcGuess: number): number => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(utcGuess));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUtc - utcGuess;
  };
  const nextGuess = Date.UTC(y, m - 1, d + 1);
  return new Date(nextGuess - offsetAt(nextGuess)).toISOString();
}

function insertReviewEvents(driver: SqlDriver, snapshotId: string, record: VersionedSnapshotRecord): void {
  record.history.forEach((event, index) => {
    const eventType = index === 0 ? "mark" : "review";
    driver.exec(
      "INSERT OR IGNORE INTO review_events(event_id, record_id, occurred_at, event_type, level, error_reason_json, source, payload_json) VALUES(?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        record.recordId,
        event.at,
        eventType,
        event.level ?? null,
        event.errorReason ? JSON.stringify(event.errorReason) : null,
        "cardlink_history",
        JSON.stringify(event),
      ],
    );
    void snapshotId;
  });
}


// ---------------------------------------------------------------------------
// legacy latest-view adapter（§21.2 映射）：旧 MistakeRepository 接口以"最新快照"
// 为当前视图实现。导入路径经 applySnapshot(v2)；旧调用方（工具/AgentService/桥）
// 无需感知版本化改造即可工作。Agent 运行锁定 snapshotId 时直接用上面的 v2 方法。
// ---------------------------------------------------------------------------
export class VersionedMistakeRepositoryWithLegacyView implements VersionedMistakeRepository {
  constructor(private readonly inner: VersionedSqliteMistakeRepository) {}

  async latestSnapshotId(): Promise<string | null> {
    return this.inner.latestSnapshotId();
  }
  async getSnapshot(id: string) { return this.inner.getSnapshot(id); }
  async listSnapshots(limit: number) { return this.inner.listSnapshots(limit); }
  async applySnapshot(payload: VersionedImportPayload) { return this.inner.applySnapshot(payload); }
  async query(snapshotId: string, filter: VersionedFilter, scope: SessionScope) { return this.inner.query(snapshotId, filter, scope); }
  async report(snapshotId: string, filter: MistakeReportFilter, scope: SessionScope) { return this.inner.report(snapshotId, filter, scope); }
  async get(snapshotId: string, recordId: string, scope: SessionScope) { return this.inner.get(snapshotId, recordId, scope); }
  async stats(snapshotId: string, filter: VersionedFilter, scope: SessionScope, now: Date) { return this.inner.stats(snapshotId, filter, scope, now); }
  async history(snapshotId: string, recordId: string, scope: SessionScope) { return this.inner.history(snapshotId, recordId, scope); }
  async getCategoryDistribution(snapshotId: string, filter: VersionedFilter, scope: SessionScope) { return this.inner.getCategoryDistribution(snapshotId, filter, scope); }

  // ---- 旧接口（latest 视图） ----
  async queryLegacy(filter: VersionedFilter, scope: SessionScope): Promise<VersionedPage> {
    const latest = await this.inner.latestSnapshotId();
    if (!latest) return { records: [], snapshotId: "none", dataAsOf: new Date().toISOString() };
    return this.inner.query(latest, filter, scope);
  }
  async getLegacy(recordId: string, scope: SessionScope): Promise<VersionedSnapshotRecord | null> {
    const latest = await this.inner.latestSnapshotId();
    if (!latest) return null;
    return this.inner.get(latest, recordId, scope);
  }
  async statsLegacy(filter: VersionedFilter, scope: SessionScope, dueBefore: ISODateTime) {
    const latest = await this.inner.latestSnapshotId();
    const now = new Date();
    const stats = await this.inner.stats(latest ?? "none", filter, scope, now);
    return { ...stats, params: { ...stats.params, dueBoundary: dueBefore } };
  }
  async historyLegacy(recordId: string, scope: SessionScope) {
    const latest = await this.inner.latestSnapshotId();
    if (!latest) return [];
    return this.inner.history(latest, recordId, scope);
  }
  async distributionLegacy(filter: VersionedFilter, scope: SessionScope) {
    const latest = await this.inner.latestSnapshotId();
    if (!latest) return [];
    return this.inner.getCategoryDistribution(latest, filter, scope);
  }
  async getLatestSnapshotMeta() {
    const m = await this.inner.getSnapshot((await this.inner.latestSnapshotId()) ?? "");
    if (!m) return null;
    return { snapshotId: m.snapshotId, sourceId: m.sourceId, importedAt: m.importedAt, isFullSnapshot: m.complete, recordCount: m.recordCount };
  }
  async applySnapshotLegacy(records: Array<{ recordId: string }>, sourceId: string, isFullSnapshot: boolean): Promise<VersionedImportResult> {
    return this.inner.applySnapshot({
      manifest: { sourceId, sourceRevision: "", importedAt: new Date().toISOString(), scope: { notebookIds: [] }, complete: isFullSnapshot },
      records: records as VersionedSnapshotRecord[],
    });
  }
}
