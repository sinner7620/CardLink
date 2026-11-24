import type { ISODateTime } from "./message.ts";

export type RecordId = string;
export type MistakeLevel = 0 | 1 | 2;

export type ErrorReasonRef = { key: string; label: string };

/**
 * H1 统一只读投影（规范 §6.2 v1.3）。字段缺失用 undefined 表达，
 * 统计与工具层必须区分“缺失”与“显式零值”（§12）。
 */
export type MistakeRecord = {
  recordId: RecordId;
  sourceNotebookId: string;
  sourceNoteId: string;
  sourceAvailable: boolean;
  sourceTitle: string;
  sourceNotebookTitle: string;
  sourceRootTitle?: string;
  sourcePathTitles: string[];
  manualCategories: string[];
  customTags?: string[];
  reasonTags: string[];
  favorite: boolean;
  errorReasons: ErrorReasonRef[];
  questionText?: string;
  answerText?: string;
  textStatus: "complete" | "partial" | "missing";
  categoryPath: string[];
  level?: MistakeLevel;
  reviewCount: number;
  /** Verifiable actions in the pinned snapshot, present in review-count results. */
  verifiedReviewCount?: number;
  reviewCompleted: boolean;
  nextReviewAt?: ISODateTime;
  lastReviewedAt?: ISODateTime;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
  answerNotebookId?: string;
  answerRootNodeId?: string;
  /** v2.16 §6.1：答案正文来源；缺失/'import' = 旧导入载荷（保持旧详情行为）。 */
  answerTextOrigin?: "import" | "answer_card";
  /** v2.16 §6.1：已核验的实际答案笔记身份（不是答案脑图根）。 */
  answerSourceNotebookId?: string;
  answerSourceNoteId?: string;
  answerStatus?: "projected" | "unavailable" | "missing";
  answerReason?: string;
  contentHash: string;
  snapshotId: string;
};

export type ReviewEvent = {
  id: string;
  recordId: RecordId;
  at: ISODateTime;
  level: MistakeLevel;
  errorReason?: ErrorReasonRef;
  /** mark = 入册标记（每条记录至多一条，即 history[0]）；review = 其后追加的复习条目。 */
  eventType: "mark" | "review";
  source: "cardlink_history";
};

export type MistakeFilter = {
  subject?: string;
  notebookIds?: string[];
  level?: MistakeLevel;
  unmastered?: boolean;
  dueFrom?: ISODateTime;
  dueBefore?: ISODateTime;
  categoryPrefix?: string[];
  queueOrder?: "dueToday" | "strengthenWeak";
  orderBy?: "dueAtAsc" | "reviewCountDesc";
  from?: ISODateTime;
  to?: ISODateTime;
  /** v2.13 §9.2：单个字面短语（已去首尾空白），匹配投影标题与有效题干。 */
  contentQuery?: string;
  /** v2.13 §9.2：已知 recordId 交集（已去重、已受 scope 约束）。 */
  recordIds?: string[];
  /** 仅 repository.query 使用：分页大小与游标。 */
  limit?: number;
  cursor?: string;
};

export type MistakePage = {
  records: MistakeRecord[];
  nextCursor?: string;
  reviewCoverage?: ReviewCoverage;
  snapshotId: string;
  dataAsOf: ISODateTime;
};

export type ReviewCoverage = {
  matchingRecords: number;
  recordsWithHistory: number;
};

export type MistakeReportFilter = Pick<MistakeFilter, "subject" | "notebookIds" | "from" | "to"> & {
  report: "errorReasons" | "reviewActivity" | "coverage" | "repeatedReviewErrors";
  reviewFrom?: ISODateTime;
  reviewBefore?: ISODateTime;
  /** coverage / repeatedReviewErrors 的展示上限（默认 20，最大 50）。 */
  limit?: number;
};

/** v2.16 §9.3：覆盖率统计的分组与口径（键与分母在规范中固定）。 */
export type CoverageCounts = {
  questionText: { available: number; missing: number };
  answerText: { available: number; missing: number; unlocatable: number; outOfScope: number };
  reviewHistory: { available: number; none: number; missing: number };
};

export type CoverageGroup = {
  key: string;
  label: string;
  recordCount: number;
  coverage: CoverageCounts;
};

export type CoverageDimension = {
  key: "notebook" | "category" | "customTag";
  label: string;
  /** true = 一题可命中多个分组，分组之和可大于 recordCount（§9.3）。 */
  multiValue: boolean;
  /** 该维度中至少命中一个分组的筛选内记录数（去重）。 */
  recordCount: number;
  /** 未命中任何分组的记录数（仅 customTag 可能非零）。 */
  recordsWithoutValue: number;
  totalGroups: number;
  groups: CoverageGroup[];
  truncated: boolean;
  omittedGroups: number;
  denominator: string;
};

/** v2.18 §9.4：单题符合条件的错因键计数（每题最多展示 5 项）。 */
export type RepeatedReviewErrorKey = {
  key: string;
  label: string;
  eventCount: number;
};

/** v2.18 §9.4：跨题错因复习历史榜单记录（不含题干/答案正文）。 */
export type RepeatedReviewErrorRecord = {
  recordId: RecordId;
  eventCount: number;
  lastEventAt?: ISODateTime;
  errorKeys: RepeatedReviewErrorKey[];
  /** 该题不同错因键总数，可能大于 errorKeys.length（展示截断）。 */
  errorKeyCount: number;
};

export type MistakeReport = {
  snapshotId: string;
  dataAsOf: ISODateTime;
} & ({
  report: "errorReasons";
  matchingRecords: number;
  recordsWithErrorReasons: number;
  reasons: Array<ErrorReasonRef & { recordCount: number }>;
  hasMore: boolean;
} | {
  report: "reviewActivity";
  reviewCoverage: ReviewCoverage;
  verifiedReviewCount: number;
  reviewedRecordCount: number;
  lastReviewedAt?: ISODateTime;
} | {
  report: "coverage";
  matchingRecords: number;
  dimensions: CoverageDimension[];
  notes: string[];
} | {
  report: "repeatedReviewErrors";
  matchingRecords: number;
  reviewCoverage: ReviewCoverage;
  /** 窗口内至少 1 笔可核实复习（不要求带错因）。 */
  reviewedRecordsInWindow: number;
  /** 至少 1 笔带非空错因复习的题数（未达 2 笔门槛也计入）。 */
  recordsWithQualifyingEvents: number;
  /** 达到 ≥2 笔门槛的题数（总命中）。 */
  totalMatchedRecords: number;
  /** 全部符合条件的事件总数。 */
  totalQualifyingEvents: number;
  window: { from?: ISODateTime; before?: ISODateTime };
  records: RepeatedReviewErrorRecord[];
  truncated: boolean;
  omittedRecords: number;
  /** 固定语义边界：只表示复习记录带错因，不推断实际答错/正确率/因果。 */
  interpretation: string;
  notes: string[];
});

export type LevelBucket = "0" | "1" | "2" | "unknown";

export type MistakeStats = {
  /** v2.1 §8：本快照已登记错题总数。 */
  totalRecords: number;
  /** 兼容字段（= totalRecords）。 */
  totalMistakes: number;
  /** 确认来源仍存在的错题数，不与总数混用。 */
  availableRecords: number;
  levelCounts: Record<LevelBucket, number>;
  dueCount: number;
  /** v2.1 §8：有可核实复习行为的错题数（非同级连击次数）。 */
  reviewedRecordCount: number;
  /** 兼容字段（= reviewedRecordCount）。 */
  reviewedCount: number;
  /** v2.1 §8：真实复习动作数（mark/review 可分辨时提供；不可分辨时为 null 并在 notes 说明）。 */
  totalReviewActions: number | null;
  /** v2.1 §8：原 reviewCount 求和，仅辅助指标，不得标成"累计复习次数"。 */
  currentLevelReviewCountSum: number;
  /** 兼容字段：review 事件条数（= totalReviewActions，可分辨时）。 */
  reviewEventCount: number;
  snapshotId: string;
  dataAsOf: ISODateTime;
  params: {
    statsTime: ISODateTime;
    timezone: string;
    dueBoundary: ISODateTime;
  };
  notes?: string[];
};

export type CategoryDistribution = {
  path: string[];
  count: number;
};

/** recordId 形态：`${sourceNotebookId}:${sourceNoteId}`，两端为非空短标识。 */
export const RECORD_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}:[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}$/;

/**
 * v2.13 §9.2：关键词检索的折叠范围——只有 ASCII 字母大小写不敏感，
 * 其余字符（含中文、全角字母）保持字面量。与 SQLite 内建 `lower()` 的折叠范围一致。
 */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (char) => char.toLowerCase());
}


/** 从自然语言文本中提取疑似 recordId 的引用，用于证据校验（§12/T15）。 */
export function extractRecordIdCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const re = /[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}:[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}/g;
  for (const match of text.matchAll(re)) {
    const token = match[0];
    if (RECORD_ID_PATTERN.test(token) && !/^[0-9.]+:[0-9.]+$/.test(token) && !token.includes("://")) {
      candidates.add(token);
    }
  }
  return [...candidates];
}
