import type { ISODateTime } from "../../domain/message.ts";
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

export type TextStatus = "complete" | "partial" | "missing";

/** 快照导入的规范化单条记录（导入层 → 投影仓储）。 */
export type SnapshotRecord = {
  recordId: RecordId;
  sourceNotebookId: string;
  sourceNoteId: string;
  sourceAvailable: boolean;
  sourceTitle: string;
  sourceNotebookTitle: string;
  sourceRootTitle?: string;
  sourcePathTitles: string[];
  categoryPath: string[];
  manualCategories: string[];
  customTags?: string[];
  reasonTags: string[];
  favorite: boolean;
  errorReasons: { key: string; label: string }[];
  questionText?: string;
  answerText?: string;
  level?: MistakeLevelInput;
  reviewCount: number;
  reviewCompleted: boolean;
  nextReviewAt?: ISODateTime;
  lastReviewedAt?: ISODateTime;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
  answerNotebookId?: string;
  answerRootNodeId?: string;
  /** v2.16 §6.1：答案正文来源（import/answer_card）与已核验的答案笔记身份。 */
  answerTextOrigin?: "import" | "answer_card";
  answerSourceNotebookId?: string;
  answerSourceNoteId?: string;
  answerStatus?: "projected" | "unavailable" | "missing";
  answerReason?: string;
  reviewEvents: Array<{
    at: ISODateTime;
    level: MistakeLevelInput;
    errorReason?: { key: string; label: string };
  }>;
};

export type MistakeLevelInput = 0 | 1 | 2 | "unknown";

export type SnapshotBatch = {
  snapshotId: string;
  sourceId: string;
  exportedAt: ISODateTime;
  isFullSnapshot: boolean;
  baseRevision?: string;
  records: SnapshotRecord[];
};

export type ImportResult = {
  snapshotId: string;
  inserted: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  /** recordId 修复：同源 (notebookId,noteId) 换新 ID，旧记录标记缺失。 */
  repaired: number;
  /** 完整快照中未出现而标记缺失的记录数（未删除）。 */
  markedMissing?: number;
  warnings: string[];
  errors?: { recordId?: string; field?: string; message: string }[];
};

export type SnapshotMeta = {
  snapshotId: string;
  sourceId: string;
  importedAt: ISODateTime;
  dataAsOf?: ISODateTime;
  isFullSnapshot: boolean;
  recordCount: number;
} | null;

/**
 * §5 端口（v1.3 增量扩展，未冻结）：只读投影的查询与快照应用。
 * applySnapshot 必须整批事务化：失败回滚并输出字段级诊断（§6.3）。
 * forSnapshot（v2.1 §6.2 运行锁定）：可选；返回钉住指定快照的只读视图，
 * 未实现时回退 latest 视图（工具层经 resolveRepo 统一处理）。
 */
export interface MistakeRepository {
  query(filter: MistakeFilter, scope: SessionScope): Promise<MistakePage>;
  getById(id: RecordId, scope: SessionScope): Promise<MistakeRecord | null>;
  getStats(filter: MistakeFilter, scope: SessionScope, dueBefore: ISODateTime): Promise<MistakeStats>;
  getReport?(filter: MistakeReportFilter, scope: SessionScope): Promise<MistakeReport>;
  getReviewHistory(id: RecordId, scope: SessionScope): Promise<ReviewEvent[]>;
  getCategoryDistribution(filter: MistakeFilter, scope: SessionScope): Promise<CategoryDistribution[]>;
  getLatestSnapshotMeta(): Promise<SnapshotMeta>;
  applySnapshot(batch: SnapshotBatch): Promise<ImportResult>;
  forSnapshot?(snapshotId: string): MistakeRepository;
}
