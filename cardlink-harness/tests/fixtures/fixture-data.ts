import type { SnapshotExportRecord } from "../../src/adapters/cardlink/snapshot-export-contract.ts";

/**
 * H1-T09/T19/T20/T21 Fixture：100 条确定性错题，期望统计按构造编码
 * （独立基准，不依赖被测实现）。时间基准固定，随时区口径可复算。
 */
export const FIXTURE_STATS_TIME_SH = "2026-11-12T22:00:00+08:00";
export const FIXTURE_STATS_TIME_UTC = "2026-11-12T14:00:00+08:00"; // 同一时刻的 UTC 视角
export const FIXTURE_TIMEZONE_SH = "Asia/Shanghai";
export const FIXTURE_TIMEZONE_UTC = "UTC";
export const FIXTURE_EXPORTED_AT = "2026-11-12T08:00:00+08:00";

const NOTEBOOK_A = "bookA0000000000000000000000000001";
const NOTEBOOK_B = "bookB0000000000000000000000000001";
const NOTEBOOK_W = "bookW0000000000000000000000000001";
export const NOTEBOOK_A_TITLE = "数学·必修一";

/** 构造参数（基准常量的来源，改动任何一行都必须同步下面的 EXPECTED_*）。 */
const DUE_RANGE: [number, number] = [20, 49]; // 排除已完成的 7 条和不可用的第 37 条后剩 22 条
const COMPLETED_RANGE: [number, number] = [43, 54]; // 12 条全部已复习
const CANCELLED = [97, 98]; // 第二份全量快照中消失 → 标记缺失
const REPAIR_INDEX = 59; // 快照1 用 bookW:noteA060，快照2 修复为 bookA:noteA060（源对不变）
const MUTATED_INDEX = 5; // 快照2 中等级 0→1 并追加一条复习
const SPECIAL_INDEX = 99; // 时区口径用例：2026-11-13T01:00+08:00（Shanghai 不算到期，UTC 算）

const DUE_AT = "2026-11-12T09:00:00+08:00";
const FUTURE_AT = "2026-11-20T09:00:00+08:00";
const SPECIAL_DUE_AT = "2026-11-13T01:00:00+08:00";
const BASE_MS = Date.parse("2026-11-01T00:00:00+08:00");

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function levelOf(i: number): 0 | 1 | 2 {
  if (i < 40) return 0;
  if (i < 75) return 1;
  return 2;
}

function isReviewed(i: number): boolean {
  return i < 55;
}

function historyLen(i: number): number {
  if (!isReviewed(i)) return 1;
  if (i < 30) return 2;
  if (i < 50) return 3;
  return 5;
}

function isCompleted(i: number): boolean {
  return i >= COMPLETED_RANGE[0] && i <= COMPLETED_RANGE[1];
}

function isErrorReason(i: number, j: number): { key: string; label: string } | undefined {
  if ((i + j) % 3 === 0) return { key: "careless", label: "计算粗心" };
  if ((i + j) % 3 === 1 && j > 0) return { key: "concept", label: "概念不清" };
  return undefined;
}

export function buildFixtureRecord(i: number, overrides?: Partial<SnapshotExportRecord>): SnapshotExportRecord {
  const notebookId = i === REPAIR_INDEX ? NOTEBOOK_W : i < 60 ? NOTEBOOK_A : NOTEBOOK_B;
  const notebookTitle = i < 60 ? NOTEBOOK_A_TITLE : "物理·力学";
  const noteId = i < 60 ? `noteA${String(i + 1).padStart(3, "0")}` : `noteB${String(i - 59).padStart(3, "0")}`;
  const level = levelOf(i);
  const len = historyLen(i);
  const markAt = iso(BASE_MS + i * 3600_000);
  const history = Array.from({ length: len }, (_, j) => ({
    at: j === 0 ? markAt : iso(BASE_MS + i * 3600_000 + j * 3 * 86400_000),
    level: j === 0 ? level : (isCompleted(i) ? 2 : level),
    ...(isErrorReason(i, j) ? { errorReason: isErrorReason(i, j) } : {}),
  }));
  const lastReviewedAt = len > 1 ? history[len - 1]?.at : undefined;
  const nextReviewAt = i === SPECIAL_INDEX ? SPECIAL_DUE_AT : i >= DUE_RANGE[0] && i <= DUE_RANGE[1] ? DUE_AT : FUTURE_AT;

  const textMode = i % 5;
  const record: SnapshotExportRecord = {
    recordId: `${notebookId}:${noteId}`,
    sourceNotebookId: notebookId,
    sourceNoteId: noteId,
    sourceAvailable: i % 37 === 0 ? false : true,
    sourceTitle: `错题 ${i + 1}：一元二次方程`,
    sourceNotebookTitle: notebookTitle,
    sourceRootTitle: notebookTitle,
    sourcePathTitles: ["第二章", "方程与不等式"],
    categoryPath: [notebookTitle, "第二章", "方程与不等式"],
    manualCategories: i % 4 === 0 ? ["自定义标签A"] : i % 4 === 1 ? ["自定义标签B"] : [],
    reasonTags: i % 3 === 0 ? ["计算粗心"] : i % 3 === 1 ? ["概念不清"] : [],
    favorite: i % 10 === 0,
    level,
    reviewCount: Math.max(0, len - 1),
    reviewCompleted: isCompleted(i),
    nextReviewAt,
    lastReviewedAt,
    createdAt: markAt,
    updatedAt: markAt,
    history,
    ...(textMode === 0
      ? { questionText: `题干 native #${i}：解方程 x^2-3x+2=0` }
      : textMode === 1
        ? { ocr: { effectiveText: `题干 ocr #${i}：解方程 x^2-3x+2=0`, sourceFingerprint: `fp-${i}` } }
        : textMode === 2
          ? { ocr: { manualText: `题干 用户修订 #${i}：解方程 x^2-3x+2=0`, effectiveText: `题干 ocr 覆盖前 #${i}`, sourceFingerprint: `fp-${i}` } }
          : textMode === 3
            ? { ocr: { effectiveText: `题干 ocr #${i}（有效文本）`, sourceFingerprint: `fp-${i}` } }
            : {}),
  };
  return { ...record, ...overrides };
}

function withRepair(record: SnapshotExportRecord): SnapshotExportRecord {
  return { ...record, recordId: `${NOTEBOOK_A}:noteA060` };
}

function withMutation(record: SnapshotExportRecord): SnapshotExportRecord {
  const level = 1 as const;
  const history = [
    ...(record.history ?? []),
    { at: "2026-11-11T09:00:00+08:00", level },
  ];
  return {
    ...record,
    level,
    reviewCount: (record.reviewCount ?? 0) + 1,
    lastReviewedAt: "2026-11-11T09:00:00+08:00",
    nextReviewAt: FUTURE_AT,
    history,
  };
}

/** 快照 1：全量 100 条（REPAIR_INDEX 用旧 ID bookW:noteA060）。 */
export function snapshot1(): SnapshotExportRecord[] {
  return Array.from({ length: 100 }, (_, i) => buildFixtureRecord(i));
}

/** 快照 2：全量（取消 2 条；修复 1 条；变异 1 条；其余不变）。 */
export function snapshot2(): SnapshotExportRecord[] {
  return Array.from({ length: 100 }, (_, i) => {
    if (CANCELLED.includes(i)) return null;
    let record = buildFixtureRecord(i);
    if (i === REPAIR_INDEX) record = withRepair(record);
    if (i === MUTATED_INDEX) record = withMutation(record);
    return record;
  }).filter((x): x is SnapshotExportRecord => x !== null);
}

/** 局部快照：仅 2 条（T07：不得因局部快照缺失而删除原记录）。 */
export function partialSnapshot(): SnapshotExportRecord[] {
  return [buildFixtureRecord(0), buildFixtureRecord(1)];
}

/** 插件备份形态样例（§6.3：{version:2, records}）。 */
export function pluginBackup(): { version: number; records: Record<string, unknown> } {
  const a = buildFixtureRecord(0);
  const b = buildFixtureRecord(1);
  return {
    version: 2,
    records: {
      [a.recordId]: a,
      [b.recordId]: b,
    },
  };
}

/** —— 独立人工基准（T09）：按上方构造参数直接推导 —— */
export const EXPECTED_AFTER_SNAPSHOT1 = {
  totalMistakes: 100,
  levelCounts: { "0": 40, "1": 35, "2": 25, unknown: 0 },
  dueCountShanghai: 22,
  dueCountUtc: 23, // SPECIAL_INDEX 在 UTC 口径下计入
  reviewedCount: 55,
  reviewEventCount: 90,
  availableRecords: 97, // 100 − 3 条 sourceAvailable=false（i ∈ {0,37,74}）
  missingTextCount: 20, // i%5===4
  favoriteCount: 10,
  sourceUnavailableCount: 3, // i ∈ {0, 37, 74}
};

export const EXPECTED_AFTER_SNAPSHOT2 = {
  totalMistakes: 98, // 101 行 − 2 取消 − 1 修复被替换
  levelCounts: { "0": 39, "1": 36, "2": 23, unknown: 0 },
  dueCountShanghai: 22,
  reviewedCount: 55, // 修复后的新记录只有入册标记，不计入已复习
  reviewEventCount: 91, // MUTATED +1
  inserted: 1,
  updated: 1,
  unchanged: 96,
  repaired: 1,
  markedMissing: 2,
};
