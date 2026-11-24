import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import type { VersionedSnapshotRecord } from "../../src/application/ports/versioned-mistake-repository.ts";

/**
 * v2.13 §9.2 检索基准（手动运行，不进入 `pnpm test` 列表）：
 * 参数化 SQLite 字面匹配的复杂度为 O(匹配范围内行数 × 文本长度)。
 * 本用例固定 3000 条 × 约 200 字符的投影，输出一次分页查询的中位耗时，供任务记录引用。
 * 不设时间断言，避免不同机器上的抖动造成假失败；正确性仍断言。
 */

const NOTEBOOK = "bookP0000000000000000000000000001";
const RECORD_COUNT = 3000;
const NEEDLE = "傅里叶变换";
const TOTAL_CHARS = 200;

function seededText(index: number): string {
  const filler = "设函数在闭区间上连续且可导，讨论其收敛性与一致连续性。";
  const hit = index % 20 === 0 ? "题目涉及傅里叶变换与频域分析。" : "题目涉及级数展开与积分换元。";
  let text = `${hit}第 ${index} 题：`;
  while (text.length < TOTAL_CHARS) text += filler;
  return text.slice(0, TOTAL_CHARS);
}

function record(index: number): VersionedSnapshotRecord {
  const noteId = `noteP${String(index).padStart(5, "0")}`;
  const history = [{ at: "2026-10-01T09:00:00+08:00", level: 0 as const }];
  return {
    recordId: `${NOTEBOOK}:${noteId}`,
    sourceNotebookId: NOTEBOOK,
    sourceNoteId: noteId,
    sourceAvailable: true,
    level: 0,
    currentLevelReviewCount: 0,
    reviewCompleted: false,
    favorite: false,
    categoryPath: ["基准"],
    manualCategories: [],
    customTags: [],
    reasonTags: [],
    errorReasons: [],
    sourceTitle: `基准题 ${index}`,
    sourceNotebookTitle: "检索基准",
    sourcePathTitles: [],
    questionText: seededText(index),
    ocr: { origin: "none", status: "complete" },
    sourcePayload: { history },
    history,
    contentHash: "",
  };
}

describe("v2.13 §9.2: 关键词检索基准（手动）", () => {
  test(`${RECORD_COUNT} 条投影上的字面匹配耗时与命中数`, async () => {
    const app = makeApp();
    const imported = await app.repositoryV2.applySnapshot({
      manifest: {
        sourceId: "bench",
        sourceRevision: "b1",
        importedAt: new Date().toISOString(),
        scope: { notebookIds: [] },
        complete: true,
      },
      records: Array.from({ length: RECORD_COUNT }, (_, index) => record(index)),
    });
    const tool = app.registry.get("queryMistakes");
    assert.ok(tool);
    const runQuery = async (args: Record<string, unknown>) =>
      (await tool.run(args, {
        sessionId: "bench",
        scope: { notebookIds: [] },
        snapshotId: imported.snapshotId,
        signal: new AbortController().signal,
      })) as { ok: boolean; data?: { records: Array<{ recordId: string }>; nextCursor?: string }; error?: unknown };

    // 预热一次（避开首次语句编译与缓存冷启动）。
    await runQuery({ contentQuery: NEEDLE, limit: 20 });
    const samples: number[] = [];
    for (let round = 0; round < 5; round++) {
      const started = performance.now();
      const page = await runQuery({ contentQuery: NEEDLE, limit: 20 });
      samples.push(performance.now() - started);
      assert.equal(page.ok, true, JSON.stringify(page.error));
      assert.equal(page.data?.records.length, 20);
      assert.equal(typeof page.data?.nextCursor, "string", "命中数远大于一页，必须给出游标");
    }
    samples.sort((left, right) => left - right);
    const median = samples[2]!;
    console.log(
      `[bench] contentQuery 字面匹配：${RECORD_COUNT} 行 × ${TOTAL_CHARS} 字符，` +
        `中位 ${median.toFixed(2)} ms（样本 ${samples.map((value) => value.toFixed(2)).join("/")} ms）`,
    );
    assert.ok(median < 2000, `单页查询耗时异常: ${median} ms`);
  });
});
