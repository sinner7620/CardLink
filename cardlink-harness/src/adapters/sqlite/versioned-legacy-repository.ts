import type {
  CategoryDistribution,
  MistakeFilter,
  MistakePage,
  MistakeRecord,
  MistakeReport,
  MistakeReportFilter,
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
import type {
  VersionedImportPayload,
  VersionedMistakeRepository,
  VersionedSnapshotRecord,
} from "../../application/ports/versioned-mistake-repository.ts";
import type { SqlDriver } from "./db.ts";
import { canonicalJson, sha256Hex } from "./db.ts";
import { deriveTextStatus } from "./sqlite-mistake-repository.ts";

/**
 * §21.2 映射：旧 MistakeRepository 端口跑在版本化投影（v2）之上。
 * - 未锁定 = latest 视图（与 v1"最新快照语义"等价）；
 * - forSnapshot(snapshotId) = 运行锁定视图（§6.2：同一运行不跨快照混算），
 *   AgentService 在 turn 开始解析的 snapshotId 经 ToolExecutionContext 传入工具。
 * 旧端口计数（inserted/updated/unchanged/unavailable/markedMissing）相对
 * 前一版本精确复现 v1 语义，保证 T06/T07/T09/T21 基线在 v2 存储上成立。
 */
export class VersionedBackedMistakeRepository implements MistakeRepository {
  constructor(
    private readonly inner: VersionedMistakeRepository,
    private readonly pinnedSnapshotId?: string,
    private readonly driver?: SqlDriver,
  ) {}

  forSnapshot(snapshotId: string): VersionedBackedMistakeRepository {
    return new VersionedBackedMistakeRepository(this.inner, snapshotId, this.driver);
  }

  private async activeSnapshotId(): Promise<string> {
    if (this.pinnedSnapshotId) return this.pinnedSnapshotId;
    return (await this.inner.latestSnapshotId()) ?? "none";
  }

  async query(filter: MistakeFilter, scope: SessionScope): Promise<MistakePage> {
    const snapshotId = await this.activeSnapshotId();
    const page = await this.inner.query(snapshotId, filter, scope);
    return {
      records: page.records.map((r) => v2ToRecord(r, page.snapshotId)),
      nextCursor: page.nextCursor,
      reviewCoverage: page.reviewCoverage,
      snapshotId: page.snapshotId,
      dataAsOf: page.dataAsOf,
    };
  }

  async getReport(filter: MistakeReportFilter, scope: SessionScope): Promise<MistakeReport> {
    return this.inner.report(await this.activeSnapshotId(), filter, scope);
  }

  async getById(id: RecordId, scope: SessionScope): Promise<MistakeRecord | null> {
    const snapshotId = await this.activeSnapshotId();
    const record = await this.inner.get(snapshotId, id, scope);
    return record ? v2ToRecord(record, snapshotId) : null;
  }

  async getStats(filter: MistakeFilter, scope: SessionScope, dueBefore: string): Promise<MistakeStats> {
    const snapshotId = await this.activeSnapshotId();
    const stats = await this.inner.stats(snapshotId, filter, scope, new Date(), undefined, dueBefore);
    return {
      totalRecords: stats.totalRecords,
      totalMistakes: stats.totalMistakes,
      availableRecords: stats.availableRecords,
      levelCounts: stats.levelCounts,
      dueCount: stats.dueCount,
      reviewedRecordCount: stats.reviewedRecordCount,
      reviewedCount: stats.reviewedCount,
      totalReviewActions: stats.totalReviewActions ?? 0,
      currentLevelReviewCountSum: stats.currentLevelReviewCountSum,
      reviewEventCount: stats.reviewEventCount ?? 0,
      snapshotId: stats.snapshotId,
      dataAsOf: stats.dataAsOf,
      params: stats.params,
    };
  }

  async getReviewHistory(id: RecordId, scope: SessionScope): Promise<ReviewEvent[]> {
    const snapshotId = await this.activeSnapshotId();
    const events = await this.inner.history(snapshotId, id, scope);
    return events.map((e) => ({
      id: e.id,
      recordId: e.recordId,
      at: e.at,
      level: (e.level ?? 0) as ReviewEvent["level"],
      errorReason: e.errorReason,
      eventType: e.eventType,
      source: "cardlink_history" as const,
    }));
  }

  async getCategoryDistribution(filter: MistakeFilter, scope: SessionScope): Promise<CategoryDistribution[]> {
    const snapshotId = await this.activeSnapshotId();
    return this.inner.getCategoryDistribution(snapshotId, filter, scope);
  }

  async getLatestSnapshotMeta(): Promise<SnapshotMeta> {
    const snapshotId = this.pinnedSnapshotId ?? (await this.inner.latestSnapshotId());
    if (!snapshotId) return null;
    const m = await this.inner.getSnapshot(snapshotId);
    if (!m) return null;
    return {
      snapshotId: m.snapshotId,
      sourceId: m.sourceId,
      importedAt: m.importedAt,
      dataAsOf: m.dataAsOf,
      isFullSnapshot: m.complete,
      recordCount: m.recordCount,
    };
  }

  async applySnapshot(batch: SnapshotBatch): Promise<ImportResult> {
    // 导入始终走 latest 链（pinned 视图不承接导入）。
    const latest = await this.inner.latestSnapshotId();
    const baseRevision = batch.isFullSnapshot ? undefined : batch.baseRevision ?? latest;
    // 预状态：当前最新版本的 id→hash 映射，供旧端口 inserted/updated/unchanged 计数
    //（v2 对完整快照的计数相对空集，旧端口语义相对前一版本）。
    const preHash = new Map<string, string>();
    if (latest && this.driver) {
      const rows = this.driver.rows(
        "SELECT record_id, content_hash FROM mistake_projection_v2 WHERE snapshot_id = ?",
        [latest],
      ) as unknown as Array<{ record_id: string; content_hash: string }>;
      for (const row of rows) preHash.set(row.record_id, row.content_hash);
    }

    const v2Records = batch.records.map(snapshotRecordToV2);
    const v2Hash = new Map(v2Records.map((r) => [r.recordId, sha256Hex(canonicalJson(r))] as const));
    const result = await this.inner.applySnapshot({
      manifest: {
        sourceId: batch.sourceId,
        sourceRevision: batch.exportedAt,
        importedAt: new Date().toISOString(),
        scope: { notebookIds: [] },
        // 空库上的"增量"没有可合成基线，等价完整快照（§6.2 baseRevision 语义）。
        complete: batch.isFullSnapshot || !baseRevision,
        ...(baseRevision ? { baseRevision } : {}),
      },
      records: v2Records,
    });

    // 跨版本同源对修复/缺失标记/unavailable 由版本化仓储统一判定（repairedIds 已排除）。
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const rec of batch.records) {
      const prevHash = preHash.get(rec.recordId);
      const hash = v2Hash.get(rec.recordId) ?? "";
      if (prevHash === undefined) inserted++;
      else if (prevHash !== hash) updated++;
      else unchanged++;
    }

    return {
      snapshotId: result.snapshotId,
      inserted,
      updated,
      unchanged,
      unavailable: result.unavailable ?? 0,
      repaired: result.repaired,
      markedMissing: result.markedMissing ?? 0,
      warnings: [...result.warnings],
    };
  }
}

/** v2 投影记录 → 旧端口 MistakeRecord（§21.2 字段映射；null 按旧端口语义收敛）。 */
function v2ToRecord(v: VersionedSnapshotRecord, snapshotId: string): MistakeRecord {
  return {
    recordId: v.recordId,
    sourceNotebookId: v.sourceNotebookId,
    sourceNoteId: v.sourceNoteId,
    sourceAvailable: v.sourceAvailable === true,
    sourceTitle: v.sourceTitle ?? "",
    sourceNotebookTitle: v.sourceNotebookTitle ?? "",
    sourceRootTitle: v.sourceRootTitle,
    sourcePathTitles: v.sourcePathTitles,
    manualCategories: v.manualCategories,
    customTags: v.customTags,
    reasonTags: v.reasonTags,
    favorite: v.favorite === true,
    errorReasons: v.errorReasons,
    questionText: v.questionText,
    answerText: v.answerText,
    textStatus: v.ocr.status,
    categoryPath: v.categoryPath,
    level: v.level ?? undefined,
    reviewCount: v.currentLevelReviewCount ?? 0,
    verifiedReviewCount: v.verifiedReviewCount,
    reviewCompleted: v.reviewCompleted === true,
    nextReviewAt: v.nextReviewAt,
    lastReviewedAt: v.lastReviewedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    answerNotebookId: v.answerNotebookId,
    answerRootNodeId: v.answerRootNodeId,
    answerTextOrigin: v.answerTextOrigin,
    answerSourceNotebookId: v.answerSourceNotebookId,
    answerSourceNoteId: v.answerSourceNoteId,
    answerStatus: v.answerStatus,
    answerReason: v.answerReason,
    contentHash: v.contentHash,
    snapshotId,
  };
}

/** 旧端口 SnapshotRecord → v2 投影记录；sourcePayload 保留规范化字段与 history（供 v2 history() 读取）。 */
function snapshotRecordToV2(rec: SnapshotRecord): VersionedSnapshotRecord {
  const level = rec.level === undefined || rec.level === "unknown" ? null : rec.level;
  const history = rec.reviewEvents.map((e) => ({
    at: e.at,
    level: e.level === "unknown" ? null : e.level,
    errorReason: e.errorReason,
  }));
  return {
    recordId: rec.recordId,
    sourceNotebookId: rec.sourceNotebookId,
    sourceNoteId: rec.sourceNoteId,
    sourceAvailable: rec.sourceAvailable,
    level,
    currentLevelReviewCount: rec.reviewCount,
    reviewCompleted: rec.reviewCompleted,
    nextReviewAt: rec.nextReviewAt,
    lastReviewedAt: rec.lastReviewedAt,
    favorite: rec.favorite,
    categoryPath: rec.categoryPath,
    manualCategories: rec.manualCategories,
    customTags: rec.customTags ?? [],
    reasonTags: rec.reasonTags,
    errorReasons: rec.errorReasons,
    sourceTitle: rec.sourceTitle,
    sourceNotebookTitle: rec.sourceNotebookTitle,
    sourceRootTitle: rec.sourceRootTitle,
    sourcePathTitles: rec.sourcePathTitles,
    questionText: rec.questionText,
    answerText: rec.answerText,
    ocr: { origin: "none", status: deriveTextStatus(rec) },
    sourcePayload: { ...rec, history },
    history,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    answerNotebookId: rec.answerNotebookId,
    answerRootNodeId: rec.answerRootNodeId,
    answerTextOrigin: rec.answerTextOrigin,
    answerSourceNotebookId: rec.answerSourceNotebookId,
    answerSourceNoteId: rec.answerSourceNoteId,
    answerStatus: rec.answerStatus,
    answerReason: rec.answerReason,
    contentHash: "",
  };
}
