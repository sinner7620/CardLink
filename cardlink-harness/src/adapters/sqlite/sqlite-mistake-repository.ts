import type { ISODateTime } from "../../domain/message.ts";
import type {
  CategoryDistribution,
  LevelBucket,
  MistakeFilter,
  MistakeLevel,
  MistakePage,
  MistakeRecord,
  MistakeStats,
  RecordId,
  ReviewEvent,
} from "../../domain/mistake.ts";
import type { SessionScope } from "../../domain/session.ts";
import type {
  ImportResult,
  MistakeRepository,
  SnapshotBatch,
  SnapshotMeta,
  SnapshotRecord,
} from "../../application/ports/mistake-repository.ts";
import type { SqlDriver } from "./db.ts";
import { canonicalJson, sha256Hex } from "./db.ts";
import { encodeBase64Url, decodeBase64Url, utf8Decode } from "../../platform/base64url.ts";
import { utf8Bytes } from "../../platform/sha256.ts";
import { randomUUID } from "../../platform/uuid.ts";

interface ProjectionRow {
  record_id: string;
  source_notebook_id: string;
  source_note_id: string;
  source_available: number;
  source_title: string;
  source_notebook_title: string;
  source_root_title: string | null;
  source_path_titles_json: string;
  category_path_json: string;
  manual_categories_json: string;
  reason_tags_json: string;
  favorite: number;
  error_reasons_json: string;
  question_text: string | null;
  answer_text: string | null;
  text_status: string;
  level: number | null;
  review_count: number;
  review_completed: number;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  answer_notebook_id: string | null;
  answer_root_node_id: string | null;
  content_hash: string;
  snapshot_id: string;
  missing_in_latest: number;
  superseded_by: string | null;
}

function rowToRecord(row: ProjectionRow): MistakeRecord {
  return {
    recordId: row.record_id,
    sourceNotebookId: row.source_notebook_id,
    sourceNoteId: row.source_note_id,
    sourceAvailable: row.source_available === 1,
    sourceTitle: row.source_title,
    sourceNotebookTitle: row.source_notebook_title,
    sourceRootTitle: row.source_root_title ?? undefined,
    sourcePathTitles: JSON.parse(row.source_path_titles_json) as string[],
    manualCategories: JSON.parse(row.manual_categories_json) as string[],
    reasonTags: JSON.parse(row.reason_tags_json) as string[],
    favorite: row.favorite === 1,
    errorReasons: JSON.parse(row.error_reasons_json) as { key: string; label: string }[],
    questionText: row.question_text ?? undefined,
    answerText: row.answer_text ?? undefined,
    textStatus: row.text_status as MistakeRecord["textStatus"],
    categoryPath: JSON.parse(row.category_path_json) as string[],
    level: row.level === null ? undefined : (row.level as MistakeLevel),
    reviewCount: row.review_count,
    reviewCompleted: row.review_completed === 1,
    nextReviewAt: row.next_review_at ?? undefined,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    answerNotebookId: row.answer_notebook_id ?? undefined,
    answerRootNodeId: row.answer_root_node_id ?? undefined,
    contentHash: row.content_hash,
    snapshotId: row.snapshot_id,
  };
}

function buildWhere(filter: MistakeFilter, scope: SessionScope): { where: string; params: (string | number | null)[] } {
  const clauses: string[] = ["mp.missing_in_latest = 0"];
  const params: (string | number | null)[] = [];
  if (scope.notebookIds.length) {
    clauses.push(`mp.source_notebook_id IN (${scope.notebookIds.map(() => "?").join(",")})`);
    params.push(...scope.notebookIds);
  }
  if (filter.notebookIds?.length) {
    clauses.push(`mp.source_notebook_id IN (${filter.notebookIds.map(() => "?").join(",")})`);
    params.push(...filter.notebookIds);
  }
  if (filter.subject) {
    clauses.push("(json_extract(mp.category_path_json, '$[0]') = ? OR mp.source_notebook_title = ?)");
    params.push(filter.subject, filter.subject);
  }
  if (filter.level !== undefined) {
    clauses.push("mp.level = ?");
    params.push(filter.level);
  }
  if (filter.dueBefore) {
    clauses.push("mp.review_completed = 0 AND mp.next_review_at IS NOT NULL AND mp.next_review_at < ?");
    params.push(filter.dueBefore);
  }
  if (filter.from) {
    clauses.push("mp.updated_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("mp.updated_at <= ?");
    params.push(filter.to);
  }
  return { where: clauses.join(" AND "), params };
}

const QUERY_ORDER = "category_path_json, source_title, created_at, record_id";

interface CursorTuple {
  category: string;
  title: string;
  createdAt: string;
  recordId: string;
}

function encodeTupleCursor(t: CursorTuple): string {
  return encodeBase64Url(utf8Bytes(JSON.stringify(t)));
}

function decodeTupleCursor(cursor: string): CursorTuple | null {
  try {
    const raw = JSON.parse(utf8Decode(decodeBase64Url(cursor))) as CursorTuple;
    if (typeof raw.category !== "string" || typeof raw.title !== "string" || typeof raw.createdAt !== "string" || typeof raw.recordId !== "string") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export class SqliteMistakeRepository implements MistakeRepository {
  constructor(private readonly driver: SqlDriver) {}

  async query(filter: MistakeFilter, scope: SessionScope): Promise<MistakePage> {
    const { where, params } = buildWhere(filter, scope);
    const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
    const cursorTuple = filter.cursor ? decodeTupleCursor(filter.cursor) : null;
    const cursorWhere = cursorTuple
      ? ` AND (mp.category_path_json, mp.source_title, mp.created_at, mp.record_id) > (?,?,?,?)`
      : "";
    const cursorParams = cursorTuple ? [cursorTuple.category, cursorTuple.title, cursorTuple.createdAt, cursorTuple.recordId] : [];
    const rows = this.driver.rows(
      `SELECT * FROM mistake_projection mp WHERE ${where}${cursorWhere} ORDER BY mp.${QUERY_ORDER} LIMIT ?`,
      [...params, ...cursorParams, limit + 1],
    ) as unknown as ProjectionRow[];
    const page = rows.slice(0, limit).map(rowToRecord);
    const dataAsOf = new Date().toISOString();
    const meta = await this.getLatestSnapshotMeta();
    if (page.length === limit && rows.length > limit) {
      const lastRow = rows[limit - 1] as ProjectionRow;
      const nextCursor = encodeTupleCursor({
        category: lastRow.category_path_json,
        title: lastRow.source_title,
        createdAt: lastRow.created_at ?? "",
        recordId: lastRow.record_id,
      });
      return { records: page, nextCursor, snapshotId: meta?.snapshotId ?? "none", dataAsOf };
    }
    return { records: page, snapshotId: meta?.snapshotId ?? "none", dataAsOf };
  }

  async getById(id: RecordId, scope: SessionScope): Promise<MistakeRecord | null> {
    if (scope.notebookIds.length) {
      const row = this.driver.rows("SELECT * FROM mistake_projection WHERE record_id = ?", [id])[0] as unknown as ProjectionRow | undefined;
      if (!row || row.missing_in_latest === 1) return null;
      if (!scope.notebookIds.includes(row.source_notebook_id)) return null;
      return rowToRecord(row);
    }
    const row = this.driver
      .rows("SELECT * FROM mistake_projection WHERE record_id = ? AND missing_in_latest = 0", [id])[0] as unknown as ProjectionRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async getStats(filter: MistakeFilter, scope: SessionScope, dueBefore: ISODateTime): Promise<MistakeStats> {
    const { where, params } = buildWhere(filter, scope);
    const base = `FROM mistake_projection mp WHERE ${where}`;
    const total = (this.driver.rows(`SELECT COUNT(*) AS n ${base}`, params)[0] as { n: number }).n;
    const levelRows = this.driver.rows(`SELECT mp.level AS level, COUNT(*) AS n ${base} GROUP BY mp.level`, params) as unknown as Array<{
      level: number | null;
      n: number;
    }>;
    const levelCounts: Record<LevelBucket, number> = { "0": 0, "1": 0, "2": 0, unknown: 0 };
    for (const r of levelRows) {
      const bucket: LevelBucket = r.level === null ? "unknown" : (String(r.level) as LevelBucket);
      levelCounts[bucket] += r.n;
    }
    const due = (this.driver
      .rows(`SELECT COUNT(*) AS n ${base} AND mp.review_completed = 0 AND mp.next_review_at IS NOT NULL AND mp.next_review_at < ?`, [...params, dueBefore])[0] as { n: number }).n;
    const reviewed = (this.driver
      .rows(`SELECT COUNT(*) AS n ${base} AND mp.last_reviewed_at IS NOT NULL`, params)[0] as { n: number }).n;
    const reviewEvents = (this.driver
      .rows(
        `SELECT COUNT(*) AS n FROM review_events re JOIN mistake_projection mp ON mp.record_id = re.record_id WHERE re.event_type = 'review' AND ${where}`,
        params,
      )[0] as { n: number }).n;
    const available = (this.driver
      .rows(`SELECT COUNT(*) AS n ${base} AND mp.source_available = 1`, params)[0] as { n: number }).n;
    const reviewCountSum = (this.driver
      .rows(`SELECT COALESCE(SUM(mp.review_count), 0) AS n ${base}`, params)[0] as { n: number }).n;
    const meta = await this.getLatestSnapshotMeta();
    const nowIso = new Date().toISOString();
    return {
      // v2.1 §8 G2 字段 + 兼容字段（§21.2 映射）
      totalRecords: Number(total),
      totalMistakes: Number(total),
      availableRecords: Number(available),
      levelCounts,
      dueCount: Number(due),
      reviewedRecordCount: Number(reviewed),
      reviewedCount: Number(reviewed),
      // mark/review 事件可分辨（§6.2 history 平铺映射），totalReviewActions 可提供数值
      totalReviewActions: Number(reviewEvents),
      currentLevelReviewCountSum: Number(reviewCountSum),
      reviewEventCount: Number(reviewEvents),
      snapshotId: meta?.snapshotId ?? "none",
      dataAsOf: nowIso,
      params: { statsTime: nowIso, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", dueBoundary: dueBefore },
    };
  }

  async getReviewHistory(id: RecordId, scope: SessionScope): Promise<ReviewEvent[]> {
    const record = await this.getById(id, scope);
    if (!record) return [];
    const rows = this.driver.rows(
      "SELECT * FROM review_events WHERE record_id = ? ORDER BY occurred_at ASC, CASE event_type WHEN 'mark' THEN 0 ELSE 1 END ASC, rowid ASC",
      [id],
    ) as unknown as Array<{
      event_id: string;
      record_id: string;
      occurred_at: string;
      event_type: string;
      level: number | null;
      error_reason_json: string | null;
      source: string;
    }>;
    return rows.map((r) => ({
      id: r.event_id,
      recordId: r.record_id,
      at: r.occurred_at,
      level: (r.level ?? 0) as MistakeLevel,
      errorReason: r.error_reason_json ? (JSON.parse(r.error_reason_json) as { key: string; label: string }) : undefined,
      eventType: r.event_type as ReviewEvent["eventType"],
      source: r.source as ReviewEvent["source"],
    }));
  }

  async getCategoryDistribution(filter: MistakeFilter, scope: SessionScope): Promise<CategoryDistribution[]> {
    const { where, params } = buildWhere(filter, scope);
    const rows = this.driver
      .rows(`SELECT mp.category_path_json AS path, COUNT(*) AS n FROM mistake_projection mp WHERE ${where} GROUP BY mp.category_path_json ORDER BY n DESC LIMIT 50`, params)
      .map((r) => ({ path: JSON.parse(String(r.path)) as string[], count: Number(r.n) }));
    return rows;
  }

  async getLatestSnapshotMeta(): Promise<SnapshotMeta> {
    const row = this.driver.rows("SELECT * FROM sync_batches ORDER BY imported_at DESC, rowid DESC LIMIT 1")[0] as unknown as
      | { snapshot_id: string; source_id: string; imported_at: string; is_full_snapshot: number; record_count: number }
      | undefined;
    if (!row) return null;
    return {
      snapshotId: row.snapshot_id,
      sourceId: row.source_id,
      importedAt: row.imported_at,
      isFullSnapshot: row.is_full_snapshot === 1,
      recordCount: row.record_count,
    };
  }

  async applySnapshot(batch: SnapshotBatch): Promise<ImportResult> {
    const warnings: string[] = [];
    return this.driver.transaction(() => {
      const dup = this.driver.rows("SELECT batch_id FROM sync_batches WHERE snapshot_id = ?", [batch.snapshotId])[0] as unknown as
        | { batch_id: string }
        | undefined;
      if (dup) {
        return {
          snapshotId: batch.snapshotId,
          inserted: 0,
          updated: 0,
          unchanged: batch.records.length,
          unavailable: 0,
          repaired: 0,
          warnings: ["快照已导入过，幂等跳过"],
        };
      }

      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let unavailable = 0;
      let repaired = 0;

      const selectById = (id: string): ProjectionRow | undefined =>
        this.driver.rows("SELECT * FROM mistake_projection WHERE record_id = ?", [id])[0] as unknown as ProjectionRow | undefined;
      const selectBySourcePair = (notebookId: string, noteId: string, recordId: string): { record_id: string } | undefined =>
        this.driver.rows(
          "SELECT record_id FROM mistake_projection WHERE source_notebook_id = ? AND source_note_id = ? AND record_id != ? AND missing_in_latest = 0",
          [notebookId, noteId, recordId],
        )[0] as { record_id: string } | undefined;
      const insertStmt = this.driver;
      const insertSql =
        `INSERT INTO mistake_projection(
           record_id, source_notebook_id, source_note_id, source_available, source_title, source_notebook_title,
           source_root_title, source_path_titles_json, category_path_json, manual_categories_json, reason_tags_json,
           favorite, error_reasons_json, question_text, answer_text, text_status, level, review_count,
           review_completed, next_review_at, last_reviewed_at, created_at, updated_at, answer_notebook_id,
           answer_root_node_id, content_hash, snapshot_id, missing_in_latest, superseded_by
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL)`;
      const updateSql =
        `UPDATE mistake_projection SET
           source_notebook_id=?, source_note_id=?, source_available=?, source_title=?, source_notebook_title=?,
           source_root_title=?, source_path_titles_json=?, category_path_json=?, manual_categories_json=?, reason_tags_json=?,
           favorite=?, error_reasons_json=?, question_text=?, answer_text=?, text_status=?, level=?, review_count=?,
           review_completed=?, next_review_at=?, last_reviewed_at=?, created_at=?, updated_at=?, answer_notebook_id=?,
           answer_root_node_id=?, content_hash=?, snapshot_id=?, missing_in_latest=0, superseded_by=NULL
         WHERE record_id=?`;
      const markSuperseded = (newId: string, oldId: string): void => {
        this.driver.exec("UPDATE mistake_projection SET missing_in_latest = 1, superseded_by = ? WHERE record_id = ?", [newId, oldId]);
      };

      for (const record of batch.records) {
        const hash = recordContentHash(record);
        if (!record.sourceAvailable) unavailable++;
        const existing = selectById(record.recordId);
        if (!existing) {
          const stale = selectBySourcePair(record.sourceNotebookId, record.sourceNoteId, record.recordId);
          if (stale) {
            markSuperseded(record.recordId, stale.record_id);
            repaired++;
            warnings.push(`recordId 修复：${stale.record_id} → ${record.recordId}（旧记录已标记缺失）`);
          }
          insertStmt.exec(insertSql, [
            record.recordId, record.sourceNotebookId, record.sourceNoteId, record.sourceAvailable ? 1 : 0,
            record.sourceTitle, record.sourceNotebookTitle, record.sourceRootTitle ?? null,
            JSON.stringify(record.sourcePathTitles), JSON.stringify(record.categoryPath),
            JSON.stringify(record.manualCategories), JSON.stringify(record.reasonTags),
            record.favorite ? 1 : 0, JSON.stringify(record.errorReasons),
            record.questionText ?? null, record.answerText ?? null, deriveTextStatus(record),
            record.level === undefined || record.level === "unknown" ? null : record.level,
            record.reviewCount, record.reviewCompleted ? 1 : 0,
            record.nextReviewAt ?? null, record.lastReviewedAt ?? null,
            record.createdAt ?? null, record.updatedAt ?? null,
            record.answerNotebookId ?? null, record.answerRootNodeId ?? null,
            hash, batch.snapshotId,
          ]);
          insertReviewEvents(this.driver, record);
          inserted++;
        } else if (existing.content_hash === hash) {
          this.driver.exec("UPDATE mistake_projection SET snapshot_id = ? WHERE record_id = ?", [batch.snapshotId, record.recordId]);
          unchanged++;
        } else {
          this.driver.exec(updateSql, [
            record.sourceNotebookId, record.sourceNoteId, record.sourceAvailable ? 1 : 0,
            record.sourceTitle, record.sourceNotebookTitle, record.sourceRootTitle ?? null,
            JSON.stringify(record.sourcePathTitles), JSON.stringify(record.categoryPath),
            JSON.stringify(record.manualCategories), JSON.stringify(record.reasonTags),
            record.favorite ? 1 : 0, JSON.stringify(record.errorReasons),
            record.questionText ?? null, record.answerText ?? null, deriveTextStatus(record),
            record.level === undefined || record.level === "unknown" ? null : record.level,
            record.reviewCount, record.reviewCompleted ? 1 : 0,
            record.nextReviewAt ?? null, record.lastReviewedAt ?? null,
            record.createdAt ?? null, record.updatedAt ?? null,
            record.answerNotebookId ?? null, record.answerRootNodeId ?? null,
            hash, batch.snapshotId, record.recordId,
          ]);
          insertReviewEvents(this.driver, record);
          updated++;
        }
      }

      let markedMissing = 0;
      if (batch.isFullSnapshot && batch.records.length > 0) {
        const placeholders = batch.records.map(() => "?").join(",");
        const toMark = this.driver.rows(
          `SELECT COUNT(*) AS n FROM mistake_projection WHERE missing_in_latest = 0 AND record_id NOT IN (${placeholders})`,
          batch.records.map((r) => r.recordId),
        )[0] as { n: number };
        markedMissing = Number(toMark.n);
        if (markedMissing > 0) {
          this.driver.exec(
            `UPDATE mistake_projection SET missing_in_latest = 1 WHERE missing_in_latest = 0 AND record_id NOT IN (${placeholders})`,
            batch.records.map((r) => r.recordId),
          );
          warnings.push(`${markedMissing} 条记录未出现在完整快照中，已标记缺失（未删除）`);
        }
      }

      this.driver.exec(
        "INSERT INTO sync_batches(batch_id, source_id, snapshot_id, imported_at, is_full_snapshot, scope, status, record_count) VALUES(?,?,?,?,?,?,?,?)",
        [
          randomUUID(), batch.sourceId, batch.snapshotId, new Date().toISOString(),
          batch.isFullSnapshot ? 1 : 0, "", "completed", batch.records.length,
        ],
      );

      return {
        snapshotId: batch.snapshotId,
        inserted,
        updated,
        unchanged,
        unavailable,
        repaired,
        markedMissing,
        warnings,
      };
    });
  }
}

/** T07/T21：contentHash 覆盖业务内容，不含 snapshotId，保证跨批次可比。 */
export function recordContentHash(record: SnapshotRecord): string {
  return sha256Hex(
    canonicalJson({
      recordId: record.recordId,
      sourceNotebookId: record.sourceNotebookId,
      sourceNoteId: record.sourceNoteId,
      sourceAvailable: record.sourceAvailable,
      sourceTitle: record.sourceTitle,
      sourceNotebookTitle: record.sourceNotebookTitle,
      sourceRootTitle: record.sourceRootTitle ?? null,
      sourcePathTitles: record.sourcePathTitles,
      categoryPath: record.categoryPath,
      manualCategories: record.manualCategories,
      reasonTags: record.reasonTags,
      favorite: record.favorite,
      errorReasons: record.errorReasons,
      questionText: record.questionText ?? null,
      answerText: record.answerText ?? null,
      level: record.level ?? null,
      reviewCount: record.reviewCount,
      reviewCompleted: record.reviewCompleted,
      nextReviewAt: record.nextReviewAt ?? null,
      lastReviewedAt: record.lastReviewedAt ?? null,
      createdAt: record.createdAt ?? null,
      updatedAt: record.updatedAt ?? null,
      answerNotebookId: record.answerNotebookId ?? null,
      answerRootNodeId: record.answerRootNodeId ?? null,
      reviewEvents: record.reviewEvents,
    }),
  );
}

/** v1 口径：questionText 非空 → complete；仅答案 → partial；都没有 → missing。 */
export function deriveTextStatus(record: SnapshotRecord): "complete" | "partial" | "missing" {
  if (record.questionText && record.questionText.trim()) return "complete";
  if (record.answerText && record.answerText.trim()) return "partial";
  return "missing";
}

/** 事件按 (recordId, at, type, level) 幂等去重（T06：重复导入不产生重复事件）。 */
function insertReviewEvents(driver: SqlDriver, record: SnapshotRecord): void {
  record.reviewEvents.forEach((event, index) => {
    const eventType = index === 0 ? "mark" : "review";
    driver.exec(
      "INSERT OR IGNORE INTO review_events(event_id, record_id, occurred_at, event_type, level, error_reason_json, source, payload_json) VALUES(?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        record.recordId,
        event.at,
        eventType,
        event.level === "unknown" ? null : event.level,
        event.errorReason ? JSON.stringify(event.errorReason) : null,
        "cardlink_history",
        JSON.stringify(event),
      ],
    );
  });
}
