import type { SnapshotExportRecord } from "../../src/adapters/cardlink/snapshot-export-contract.ts";

/**
 * v2.16 §9.3 Fixture：确定性覆盖率报表（手算对照）。
 *
 * 关键场景：
 * - 同名不同 ID 的学习集（bookA/bookB 都叫“数学”）必须分成两组；
 * - 一题多标签分别计入各分组（multiValue，分母去重）；
 * - 无历史（history=[] → missing）与只有入册标记（history 仅 1 条 → none）可区分；
 * - 有正文但来源不可定位（无 answerNotebookId/answerRootNodeId/answerSource*）→ unlocatable；
 * - 设备投影答案来源不在授权 scope（answerSourceNotebookId=答案集）→ outOfScope；
 * - 空分类归入 (uncategorized)、无标签计入 recordsWithoutValue。
 */
export const COVERAGE_NOTEBOOK_A = "bookA0000000000000000000000000001";
export const COVERAGE_NOTEBOOK_B = "bookB0000000000000000000000000001";
export const COVERAGE_NOTEBOOK_C = "bookC0000000000000000000000000001";
export const COVERAGE_NOTEBOOK_ANS = "bookAns000000000000000000000000001";

export const COVERAGE_RECORD_A1 = `${COVERAGE_NOTEBOOK_A}:noteA001`;
export const COVERAGE_RECORD_A2 = `${COVERAGE_NOTEBOOK_A}:noteA002`;
export const COVERAGE_RECORD_B1 = `${COVERAGE_NOTEBOOK_B}:noteB001`;
export const COVERAGE_RECORD_C1 = `${COVERAGE_NOTEBOOK_C}:noteC001`;
export const COVERAGE_RECORD_C2 = `${COVERAGE_NOTEBOOK_C}:noteC002`;

function recordIdOf(recordId: string): { notebookId: string; noteId: string } {
  const index = recordId.indexOf(":");
  return { notebookId: recordId.slice(0, index), noteId: recordId.slice(index + 1) };
}

function base(
  recordId: string,
  notebookTitle: string,
  title: string,
  overrides: Partial<SnapshotExportRecord> = {},
): SnapshotExportRecord {
  const { notebookId, noteId } = recordIdOf(recordId);
  return {
    recordId,
    sourceNotebookId: notebookId,
    sourceNoteId: noteId,
    sourceAvailable: true,
    sourceTitle: title,
    sourceNotebookTitle: notebookTitle,
    sourceRootTitle: notebookTitle,
    sourcePathTitles: ["第三章"],
    categoryPath: [notebookTitle, "第三章"],
    manualCategories: [],
    customTags: [],
    reasonTags: [],
    favorite: false,
    level: 0,
    reviewCount: 1,
    reviewCompleted: false,
    nextReviewAt: "2026-11-20T09:00:00+08:00",
    lastReviewedAt: "2026-10-02T09:00:00+08:00",
    createdAt: "2026-10-01T09:00:00+08:00",
    updatedAt: "2026-10-02T09:00:00+08:00",
    history: [
      { at: "2026-10-01T09:00:00+08:00", level: 0 },
      { at: "2026-10-02T09:00:00+08:00", level: 0 },
    ],
    ...overrides,
  };
}

/** 全量快照：5 条记录，手算数字见 coverage-report.test.ts。 */
export function coverageSnapshot(): SnapshotExportRecord[] {
  return [
    base(COVERAGE_RECORD_A1, "数学", "代数题一", {
      categoryPath: ["数学", "代数"],
      customTags: ["tag1", "tag2"],
      questionText: "题干 A1",
      answerText: "答案 A1",
      answerTextOrigin: "answer_card",
      answerSourceNotebookId: COVERAGE_NOTEBOOK_ANS,
      answerSourceNoteId: "ansA001",
      answerStatus: "projected",
    }),
    base(COVERAGE_RECORD_B1, "数学", "几何题一", {
      categoryPath: ["数学", "几何"],
      customTags: ["tag1"],
      questionText: "题干 B1",
      answerText: "答案 B1",
      answerTextOrigin: "import",
      answerNotebookId: COVERAGE_NOTEBOOK_ANS,
      answerRootNodeId: "ansB001",
      history: [{ at: "2026-10-01T09:00:00+08:00", level: 0 }],
    }),
    base(COVERAGE_RECORD_C1, "英语", "无题干无标签题", {
      categoryPath: [],
      customTags: [],
      questionText: undefined,
      answerText: "答案 C1",
      answerTextOrigin: "import",
      answerNotebookId: COVERAGE_NOTEBOOK_C,
      answerRootNodeId: "ansC001",
      history: [],
    }),
    base(COVERAGE_RECORD_C2, "英语", "答案无来源题", {
      categoryPath: ["英语"],
      customTags: ["tag2"],
      questionText: "题干 C2",
      answerText: "答案 C2（有正文但无来源绑定）",
    }),
    base(COVERAGE_RECORD_A2, "数学", "代数题二", {
      categoryPath: ["数学", "代数"],
      customTags: ["tag1", "tag3"],
      questionText: "题干 A2",
      answerText: "答案 A2",
      answerTextOrigin: "answer_card",
      answerSourceNotebookId: COVERAGE_NOTEBOOK_ANS,
      answerSourceNoteId: "ansA002",
      answerStatus: "projected",
    }),
  ];
}
