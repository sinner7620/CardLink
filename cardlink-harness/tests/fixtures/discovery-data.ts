import type { SnapshotExportRecord } from "../../src/adapters/cardlink/snapshot-export-contract.ts";

/**
 * v2.13 §9.2 Fixture：数据发现与正文分段。
 * 两个快照的"傅里叶变换"命中集合不同；另一学习集的记录保持命中；
 * 仅存在于旧 OCR 原文（已被手工修订替代）的片段不得被搜回。
 */
const NOTEBOOK_M = "bookM0000000000000000000000000001";
const NOTEBOOK_N = "bookN0000000000000000000000000001";
const NOTEBOOK_O = "bookO0000000000000000000000000001";

export const DISCOVERY_NOTEBOOK_M = NOTEBOOK_M;
export const DISCOVERY_NOTEBOOK_N = NOTEBOOK_N;
export const DISCOVERY_NOTEBOOK_O = NOTEBOOK_O;

export const DISCOVERY_RECORD_M1 = `${NOTEBOOK_M}:noteM001`;
export const DISCOVERY_RECORD_M2 = `${NOTEBOOK_M}:noteM002`;
export const DISCOVERY_RECORD_M3 = `${NOTEBOOK_M}:noteM003`;
export const DISCOVERY_RECORD_M4 = `${NOTEBOOK_M}:noteM004`;
export const DISCOVERY_RECORD_M5 = `${NOTEBOOK_M}:noteM005`;
export const DISCOVERY_RECORD_M6 = `${NOTEBOOK_M}:noteM006`;
export const DISCOVERY_RECORD_M7 = `${NOTEBOOK_M}:noteM007`;
export const DISCOVERY_RECORD_N1 = `${NOTEBOOK_N}:noteN001`;
export const DISCOVERY_RECORD_N2 = `${NOTEBOOK_N}:noteN002`;
export const DISCOVERY_RECORD_O1 = `${NOTEBOOK_O}:noteO001`;

/**
 * 分页边界用例：符合 §5 `RecordId` 形态的最长 ID（每段 127 字符）、超长中文标题与超长分类，
 * 以及同条件命中的两条普通记录——用于验证新游标长度固定且能真实回传翻页。
 */
const LONG_NOTEBOOK = `bookL${"0".repeat(122)}`;
const LONG_NOTE = `noteL${"1".repeat(122)}`;
export const DISCOVERY_RECORD_LONG = `${LONG_NOTEBOOK}:${LONG_NOTE}`;
export const DISCOVERY_RECORD_T2 = `${NOTEBOOK_M}:noteT002`;
export const DISCOVERY_RECORD_T3 = `${NOTEBOOK_M}:noteT003`;
export const DISCOVERY_NEEDLE = "定位词";
const LONG_TITLE = `A${DISCOVERY_NEEDLE}：${"超长中文标题用于游标长度验证".repeat(12)}`;
const LONG_CATEGORY = `${"超长中文分类路径".repeat(12)}`;

/** 6000+ 字符、含中文与 emoji（代理对）的长题干，用于分段与截断回归。 */
export const LONG_QUESTION = Array.from(
  { length: 300 },
  (_, index) => `第${index}步：计算∫f(x)dx，注意😀与🙂符号。`,
).join("");

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

/** 快照 A：M1/M2/N1/N2 命中“变换”，其中 N2 只有旧 OCR 含“傅里叶变换”。 */
export function discoverySnapshotA(): SnapshotExportRecord[] {
  return [
    base(DISCOVERY_RECORD_M1, "信号与系统", "傅里叶变换的基本性质", {
      level: 0,
      ocr: { effectiveText: "傅里叶变换把时域卷积变成频域相乘", sourceFingerprint: "fp-m1" },
    }),
    base(DISCOVERY_RECORD_M2, "信号与系统", "拉普拉斯变换", {
      level: 1,
      ocr: { effectiveText: "拉普拉斯变换用于稳定性分析", sourceFingerprint: "fp-m2" },
    }),
    base(DISCOVERY_RECORD_M3, "信号与系统", "傅里叶级数", {
      ocr: { effectiveText: '运算符字样 NEAR( AND OR MATCH * 与标点句号。 100%', sourceFingerprint: "fp-m3" },
    }),
    base(DISCOVERY_RECORD_M4, "信号与系统", "fourier series", {
      level: 2,
      reviewCompleted: true,
      ocr: { effectiveText: "Discrete Fourier Transform 频域采样", sourceFingerprint: "fp-m4" },
    }),
    base(DISCOVERY_RECORD_M5, "信号与系统", "长篇题干与答案", {
      level: 1,
      questionText: LONG_QUESTION,
      answerText: "答案要点：先换元，再分段积分，最后核对符号。",
      answerNotebookId: "bookA0000000000000000000000000009",
      answerRootNodeId: "answerRootM005",
    }),
    base(DISCOVERY_RECORD_M6, "信号与系统", "无答案记录", {
      level: 0,
      questionText: "题干：求 f(x)=x^2 的导数。",
    }),
    // 有答案正文但缺少可定位来源（无 answerNotebookId/answerRootNodeId）——分段模式必须拒绝发送。
    base(DISCOVERY_RECORD_M7, "信号与系统", "答案无来源绑定", {
      level: 0,
      questionText: "题干：求不定积分。",
      answerText: "答案：存在投影正文但无来源绑定。",
    }),
    base(DISCOVERY_RECORD_N1, "复变函数", "Fourier Transform 100% 例题", {
      level: 2,
      ocr: {
        effectiveText: 'Fourier 级数与傅里叶变换的区别；标记 a_b 与 "引号" 测试',
        sourceFingerprint: "fp-n1",
      },
    }),
    base(DISCOVERY_RECORD_N2, "复变函数", "反变换练习", {
      level: 1,
      ocr: {
        manualText: "拉普拉斯反变换求法",
        effectiveText: "傅里叶变换旧版正文（已被修订替代）",
        sourceFingerprint: "fp-n2",
      },
    }),
    base(DISCOVERY_RECORD_O1, "另一学习集", "第三种情况", {
      level: 0,
      ocr: { effectiveText: "只用于授权范围过滤测试", sourceFingerprint: "fp-o1" },
    }),
    // —— 游标上界与 keyset 回取边界 ——
    base(DISCOVERY_RECORD_LONG, "分页边界", LONG_TITLE, {
      level: 0,
      categoryPath: ["分页边界", LONG_CATEGORY],
      questionText: `题干：${DISCOVERY_NEEDLE}的超长题干。${"重复内容".repeat(20)}`,
      nextReviewAt: "2026-11-10T09:00:00+08:00",
      reviewCount: 5,
      lastReviewedAt: "2026-11-09T09:00:00+08:00",
      history: Array.from({ length: 6 }, (_, index) => ({
        at: new Date(Date.parse("2026-11-04T09:00:00+08:00") + index * 86_400_000).toISOString(),
        level: 0,
      })),
    }),
    base(DISCOVERY_RECORD_T2, "分页边界", `B${DISCOVERY_NEEDLE}示例二`, {
      level: 1,
      categoryPath: ["分页边界"],
      questionText: `题干：${DISCOVERY_NEEDLE}示例二。`,
      nextReviewAt: "2026-11-12T09:00:00+08:00",
      reviewCount: 3,
      lastReviewedAt: "2026-11-09T09:00:00+08:00",
      history: Array.from({ length: 4 }, (_, index) => ({
        at: new Date(Date.parse("2026-11-05T09:00:00+08:00") + index * 86_400_000).toISOString(),
        level: 1,
      })),
    }),
    base(DISCOVERY_RECORD_T3, "分页边界", `C${DISCOVERY_NEEDLE}示例三`, {
      level: 2,
      categoryPath: ["分页边界"],
      questionText: `题干：${DISCOVERY_NEEDLE}示例三。`,
      nextReviewAt: "2026-11-14T09:00:00+08:00",
      reviewCount: 1,
      lastReviewedAt: "2026-11-09T09:00:00+08:00",
      history: Array.from({ length: 2 }, (_, index) => ({
        at: new Date(Date.parse("2026-11-06T09:00:00+08:00") + index * 86_400_000).toISOString(),
        level: 2,
      })),
    }),
  ];
}

/**
 * 快照 B：M1 改为“采样定理”（不再命中），M2 的正文加入“傅里叶变换”（新增命中），
 * N1（另一学习集）与旧 OCR 情形保持不变。
 */
export function discoverySnapshotB(): SnapshotExportRecord[] {
  return discoverySnapshotA().map((record) => {
    if (record.recordId === DISCOVERY_RECORD_M1) {
      return {
        ...record,
        sourceTitle: "采样定理",
        ocr: { effectiveText: "奈奎斯特采样定理的适用条件", sourceFingerprint: "fp-m1b" },
      };
    }
    if (record.recordId === DISCOVERY_RECORD_M2) {
      return {
        ...record,
        ocr: { effectiveText: "傅里叶变换与拉普拉斯变换的关系", sourceFingerprint: "fp-m2b" },
      };
    }
    return record;
  });
}

export const DISCOVERY_SCOPE_MN = { notebookIds: [NOTEBOOK_M, NOTEBOOK_N] };
