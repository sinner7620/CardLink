import type { SnapshotExportRecord } from "../../src/adapters/cardlink/snapshot-importer.ts";

/**
 * v2.18 §9.4：跨题错因复习历史 fixture。
 * 事件时间固定（UTC），覆盖：同键重复、单次排除、mark（即使带错因）、空/空白错因键、
 * 无错因复习、无历史、同名不同 ID 学习集、跨 scope、半开区间边界、同分排序与 limit 截断。
 */

export const REPEATED_NOTEBOOK_A = "bookRE000000000000000000000001";
export const REPEATED_NOTEBOOK_B = "bookRE000000000000000000000002";
export const REPEATED_NOTEBOOK_C = "bookRE000000000000000000000003";

export const REPEATED_R01 = `${REPEATED_NOTEBOOK_A}:r01`;
export const REPEATED_R02 = `${REPEATED_NOTEBOOK_A}:r02`;
export const REPEATED_R03 = `${REPEATED_NOTEBOOK_A}:r03`;
export const REPEATED_R04 = `${REPEATED_NOTEBOOK_A}:r04`;
export const REPEATED_R05 = `${REPEATED_NOTEBOOK_A}:r05`;
export const REPEATED_R06 = `${REPEATED_NOTEBOOK_B}:r06`;
export const REPEATED_R07 = `${REPEATED_NOTEBOOK_C}:r07`;
export const REPEATED_R08 = `${REPEATED_NOTEBOOK_A}:r08`;
export const REPEATED_R09 = `${REPEATED_NOTEBOOK_A}:r09`;
export const REPEATED_R10 = `${REPEATED_NOTEBOOK_A}:r10`;
export const REPEATED_R12 = `${REPEATED_NOTEBOOK_A}:r12`;
/** 空白边界：\t\n、全角空格、NBSP 与边缘空白的同键合并。 */
export const REPEATED_W1 = `${REPEATED_NOTEBOOK_A}:w01`;
export const REPEATED_W2 = `${REPEATED_NOTEBOOK_A}:w02`;
export const REPEATED_W3 = `${REPEATED_NOTEBOOK_A}:w03`;

export const REPEATED_SCOPE_AB = { notebookIds: [REPEATED_NOTEBOOK_A, REPEATED_NOTEBOOK_B] };
export const REPEATED_SCOPE_ALL = { notebookIds: [] as string[] };

/** 最近 30 天窗口 [2026-10-20, 2026-11-20)。 */
export const REPEATED_RECENT = { reviewFrom: "2026-10-20T00:00:00.000Z", reviewBefore: "2026-11-20T00:00:00.000Z" };
/** 前 30 天窗口 [2026-09-20, 2026-10-20)。 */
export const REPEATED_PREVIOUS = { reviewFrom: "2026-09-20T00:00:00.000Z", reviewBefore: "2026-10-20T00:00:00.000Z" };

type Event = { at: string; level?: 0 | 1 | 2; key?: string; label?: string };

function history(markAt: string | null, events: Event[]): SnapshotExportRecord["history"] {
  const out: NonNullable<SnapshotExportRecord["history"]> = [];
  if (markAt) out.push({ at: markAt, level: 0 });
  for (const event of events) {
    out.push({
      at: event.at,
      level: event.level ?? 0,
      ...(event.key !== undefined ? { errorReason: { key: event.key, label: event.label ?? event.key } } : {}),
    });
  }
  return out;
}

function record(
  recordId: string,
  notebookId: string,
  notebookTitle: string,
  title: string,
  entries: SnapshotExportRecord["history"],
): SnapshotExportRecord {
  return {
    recordId,
    sourceNotebookId: notebookId,
    sourceNoteId: recordId.slice(recordId.indexOf(":") + 1),
    sourceAvailable: true,
    sourceTitle: title,
    sourceNotebookTitle: notebookTitle,
    sourceRootTitle: notebookTitle,
    sourcePathTitles: ["错因复习"],
    categoryPath: [notebookTitle, "错因复习"],
    manualCategories: [],
    customTags: [],
    reasonTags: [],
    favorite: false,
    level: 0,
    reviewCount: 1,
    reviewCompleted: false,
    nextReviewAt: "2026-12-01T00:00:00.000Z",
    lastReviewedAt: "2026-11-10T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    history: entries ?? [],
  };
}

export function repeatedReviewSnapshot(): SnapshotExportRecord[] {
  return [
    // 3 笔近期 + 1 笔更早；K1 出现两次、K2 一次 → 事件计数而非去重原因。
    record(REPEATED_R01, REPEATED_NOTEBOOK_A, "复习集", "反复记录错因 A", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-09-25T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-11-01T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-11-05T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-11-10T00:00:00.000Z", key: "K2", label: "符号" },
    ])),
    // 仅 1 笔近期（另 1 笔在上个窗口）→ 最近窗口不入榜，全历史窗口入榜。
    record(REPEATED_R02, REPEATED_NOTEBOOK_A, "复习集", "跨窗口一次", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-10-05T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-10-25T00:00:00.000Z", key: "K1", label: "计算" },
    ])),
    // 单次带错因 → 排除。
    record(REPEATED_R03, REPEATED_NOTEBOOK_A, "复习集", "单次带错因", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-02T00:00:00.000Z", key: "K3", label: "审题" },
    ])),
    // 有复习但无错因 / 空白键 → 不计。
    record(REPEATED_R04, REPEATED_NOTEBOOK_A, "复习集", "无错因复习", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-03T00:00:00.000Z" },
      { at: "2026-11-04T00:00:00.000Z", key: "   ", label: "空白" },
    ])),
    // 无历史（含无 mark）→ 覆盖缺失。
    record(REPEATED_R05, REPEATED_NOTEBOOK_A, "复习集", "无历史", []),
    // 同名不同 ID 学习集：正常入榜（2 笔，与 R08 同分，按 recordId 升序）。
    record(REPEATED_R06, REPEATED_NOTEBOOK_B, "复习集", "同名学习集", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-02T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-11-06T00:00:00.000Z", key: "K1", label: "计算" },
    ])),
    // 跨 scope 学习集：默认 A+B scope 不可见，不进入分母/榜单。
    record(REPEATED_R07, REPEATED_NOTEBOOK_C, "复习集", "越权学习集", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-01T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-11-02T00:00:00.000Z", key: "K1", label: "计算" },
      { at: "2026-11-03T00:00:00.000Z", key: "K1", label: "计算" },
    ])),
    record(REPEATED_R08, REPEATED_NOTEBOOK_A, "复习集", "同分第二题", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-04T00:00:00.000Z", key: "K2", label: "符号" },
      { at: "2026-11-07T00:00:00.000Z", key: "K2", label: "符号" },
    ])),
    // 半开区间：恰好等于 reviewFrom 计入，恰好等于 reviewBefore 排除 → 最近窗口仅 1 笔。
    record(REPEATED_R09, REPEATED_NOTEBOOK_A, "复习集", "半开边界", history("2026-09-01T00:00:00.000Z", [
      { at: REPEATED_RECENT.reviewFrom, key: "K1", label: "计算" },
      { at: REPEATED_RECENT.reviewBefore, key: "K1", label: "计算" },
    ])),
    // 空字符串/纯空白错因键 → 不计。
    record(REPEATED_R10, REPEATED_NOTEBOOK_A, "复习集", "空错因键", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-02T00:00:00.000Z", key: "", label: "空" },
      { at: "2026-11-03T00:00:00.000Z", key: " ", label: "空白" },
    ])),
    // 入册 mark 即使带错因也不算复习；另有 1 笔 review → 不足两笔。
    record(REPEATED_R12, REPEATED_NOTEBOOK_A, "复习集", "mark 带错因", [
      { at: "2026-09-01T00:00:00.000Z", level: 0, errorReason: { key: "K9", label: "入册" } },
      { at: "2026-11-05T00:00:00.000Z", level: 0, errorReason: { key: "K1", label: "计算" } },
    ]),
  ];
}

/** v2.18 边界修复：SQLite trim 需覆盖 JS String.trim 的空白集合（\t\n、全角空格、NBSP 等）。 */
export function repeatedWhitespaceSnapshot(): SnapshotExportRecord[] {
  return [
    // 边缘空白（TAB/LF/普通空格）的同一 key 应合并为 K1，两条事件都计入。
    record(REPEATED_W1, REPEATED_NOTEBOOK_A, "复习集", "边缘空白同键", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-01T00:00:00.000Z", key: "\tK1\n", label: " 计算 " },
      { at: "2026-11-02T00:00:00.000Z", key: " K1 ", label: "计算" },
    ])),
    // 全角空格与 TAB/LF 组成的“空白 key”必须视为空，不入榜。
    record(REPEATED_W2, REPEATED_NOTEBOOK_A, "复习集", "纯空白键", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-03T00:00:00.000Z", key: "\u3000", label: "全角空白" },
      { at: "2026-11-04T00:00:00.000Z", key: "\t\n", label: "换行" },
    ])),
    // NBSP 包裹的 K2 与裸 K2 应合并。
    record(REPEATED_W3, REPEATED_NOTEBOOK_A, "复习集", "NBSP 同键", history("2026-09-01T00:00:00.000Z", [
      { at: "2026-11-05T00:00:00.000Z", key: "\u00a0K2\u00a0", label: "符号" },
      { at: "2026-11-06T00:00:00.000Z", key: "K2", label: "符号" },
    ])),
  ];
}
