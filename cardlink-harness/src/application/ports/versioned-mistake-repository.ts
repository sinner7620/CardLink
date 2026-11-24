import type { ISODateTime } from "../../domain/message.ts";
import type { MistakeFilter, MistakeLevel, MistakeReport, MistakeReportFilter, ReviewCoverage } from "../../domain/mistake.ts";
import type { SessionScope } from "../../domain/session.ts";

/** v2.1 §6.2：快照清单（冻结字段）。 */
export type SnapshotManifest = {
  snapshotId: string;
  sourceId: string;
  sourceRevision: string;
  complete: boolean;
  scope: { notebookIds: string[] };
  importedAt: string;
  dataAsOf: string;
  recordCount: number;
};

export type TextStatusV2 = "complete" | "partial" | "missing";

/** v2.1 §6.1：版本化投影记录（raw_json 保留源字段；缺失显式 null）。 */
export type VersionedSnapshotRecord = {
  recordId: string;
  sourceNotebookId: string;
  sourceNoteId: string;
  sourceAvailable: boolean | null;
  level: MistakeLevel | null;
  /** 原 CardLink reviewCount：同级复习计数，等级变更归零（非累计）。 */
  currentLevelReviewCount: number | null;
  verifiedReviewCount?: number;
  reviewCompleted: boolean | null;
  nextReviewAt?: string;
  lastReviewedAt?: string;
  favorite: boolean | null;
  categoryPath: string[];
  manualCategories: string[];
  customTags: string[];
  reasonTags: string[];
  errorReasons: Array<{ key: string; label: string }>;
  sourceTitle?: string;
  sourceNotebookTitle?: string;
  sourceRootTitle?: string;
  sourcePathTitles: string[];
  questionText?: string;
  answerText?: string;
  ocr: {
    rawText?: string;
    manualText?: string;
    effectiveText?: string;
    origin: "manual" | "ocr" | "note" | "none";
    status: TextStatusV2;
  };
  /** 源记录原始字段无损保留。 */
  sourcePayload: Record<string, unknown>;
  history: Array<{ at: string; level: MistakeLevel | null; errorReason?: { key: string; label: string } }>;
  createdAt?: string;
  updatedAt?: string;
  answerNotebookId?: string;
  answerRootNodeId?: string;
  /** v2.16 §6.1：答案正文来源与已核验的答案笔记身份（旧行缺失 = 旧导入口径）。 */
  answerTextOrigin?: "import" | "answer_card";
  answerSourceNotebookId?: string;
  answerSourceNoteId?: string;
  answerStatus?: "projected" | "unavailable" | "missing";
  answerReason?: string;
  contentHash: string;
};

export type VersionedFilter = MistakeFilter;

export type VersionedPage = {
  records: VersionedSnapshotRecord[];
  nextCursor?: string;
  reviewCoverage?: ReviewCoverage;
  snapshotId: string;
  dataAsOf: string;
};

export type VersionedStats = {
  totalRecords: number;
  /** 兼容别名（§21.2 映射）：= totalRecords。 */
  totalMistakes: number;
  availableRecords: number;
  levelCounts: Record<"0" | "1" | "2" | "unknown", number>;
  dueCount: number;
  reviewedRecordCount: number;
  /** 兼容别名（§21.2 映射）：= reviewedRecordCount。 */
  reviewedCount: number;
  totalReviewActions: number | null;
  /** 兼容别名：= totalReviewActions（可分辨时）。 */
  reviewEventCount: number | null;
  totalReviewActionsNote?: string;
  currentLevelReviewCountSum: number;
  snapshotId: string;
  dataAsOf: string;
  params: { statsTime: string; timezone: string; dueBoundary: string };
};

export type VersionedImportPayload = {
  manifest: {
    sourceId: string;
    sourceRevision: string;
    importedAt: string;
    scope: { notebookIds: string[] };
    complete: boolean;
    /** 增量（complete=false）必填：必须等于当前最新快照 ID，否则 base_revision_mismatch。 */
    baseRevision?: string;
    /** 缺省由内容哈希派生（确定性，重复导入幂等）。 */
    snapshotId?: string;
  };
  records: VersionedSnapshotRecord[];
  /** 插件提供完整源视图，由仓储在事务内选择从同源基线生成增量。 */
  preferIncremental?: boolean;
};

export type VersionedImportResult = {
  snapshotId: string;
  inserted: number;
  updated: number;
  unchanged: number;
  carried: number;
  repaired: number;
  /** 同源对替换中被移出的旧 recordId（供旧端口 markedMissing 口径排除）。 */
  repairedIds?: string[];
  /** 旧端口兼容（§21.2）：提供记录中 sourceAvailable=false 的条数。 */
  unavailable?: number;
  /** 旧端口兼容（§21.2）：完整快照下前一版本有而本版本缺席的记录数（未删除）。 */
  markedMissing?: number;
  recordCount: number;
  warnings: string[];
};

/** v2.1 §5/§6：版本化只读投影仓储。同一 Agent 运行锁定 snapshotId，不跨快照混算。 */
export interface VersionedMistakeRepository {
  latestSnapshotId(): Promise<string | null>;
  getSnapshot(snapshotId: string): Promise<SnapshotManifest | null>;
  listSnapshots(limit: number): Promise<SnapshotManifest[]>;
  applySnapshot(payload: VersionedImportPayload): Promise<VersionedImportResult>;
  query(snapshotId: string, filter: VersionedFilter, scope: SessionScope): Promise<VersionedPage>;
  report(snapshotId: string, filter: MistakeReportFilter, scope: SessionScope): Promise<MistakeReport>;
  get(snapshotId: string, recordId: string, scope: SessionScope): Promise<VersionedSnapshotRecord | null>;
  stats(
    snapshotId: string,
    filter: VersionedFilter,
    scope: SessionScope,
    now: Date,
    timezone?: string,
    /** 旧端口兼容：显式到期边界（§12 由引擎按 statsTime 派生），缺省用 now 的本地当日 24:00。 */
    dueBeforeOverride?: ISODateTime,
  ): Promise<VersionedStats>;
  history(snapshotId: string, recordId: string, scope: SessionScope): Promise<ReviewEventLike[]>;
  getCategoryDistribution(snapshotId: string, filter: VersionedFilter, scope: SessionScope): Promise<Array<{ path: string[]; count: number }>>;
}

export type ReviewEventLike = {
  id: string;
  recordId: string;
  at: string;
  level: MistakeLevel | null;
  errorReason?: { key: string; label: string };
  eventType: "mark" | "review";
  source: string;
};
