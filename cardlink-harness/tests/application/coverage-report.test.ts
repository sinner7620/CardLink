import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { ToolEnvelope } from "../../src/domain/evidence.ts";
import { statisticValue } from "../../src/application/statistic-evidence.ts";
import * as F from "../fixtures/coverage-data.ts";

/**
 * v2.16 §9.3：getMistakeStats.report:'coverage' 的手算对照。
 * 覆盖同名不同学习集、跨域答案、重复标签、无历史、无授权答案、空分类/无标签、
 * 确定性排序与 limit/截断，以及同一快照/scope 口径（模型不得自行计数）。
 */

let app: HarnessApp;
let snapshot: string;

const ALL = { notebookIds: [] as string[] };

before(async () => {
  app = makeApp();
  const imported = await app.syncService.importSnapshot({
    schemaVersion: 1,
    sourceId: "coverage-fixture",
    exportedAt: "2026-11-16T08:00:00+08:00",
    isFullSnapshot: true,
    records: F.coverageSnapshot(),
  });
  snapshot = imported.snapshotId;
});

type CoverageData = {
  report: "coverage";
  matchingRecords: number;
  snapshotId: string;
  dataAsOf: string;
  dimensions: Array<{
    key: string;
    label: string;
    multiValue: boolean;
    recordCount: number;
    recordsWithoutValue: number;
    totalGroups: number;
    truncated: boolean;
    omittedGroups: number;
    groups: Array<{
      key: string;
      label: string;
      recordCount: number;
      coverage: {
        questionText: { available: number; missing: number };
        answerText: { available: number; missing: number; unlocatable: number; outOfScope: number };
        reviewHistory: { available: number; none: number; missing: number };
      };
    }>;
  }>;
};

async function coverage(
  args: Record<string, unknown>,
  scope: { notebookIds: string[] } = ALL,
): Promise<CoverageData> {
  const tool = app.registry.get("getMistakeStats");
  assert.ok(tool, "getMistakeStats 未注册");
  const envelope = (await tool.run(args, {
    sessionId: "coverage-session",
    scope,
    snapshotId: snapshot,
    signal: new AbortController().signal,
  })) as ToolEnvelope;
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
  return envelope.data as CoverageData;
}

function dimensionOf(report: CoverageData, key: string) {
  const dimension = report.dimensions.find((item) => item.key === key);
  assert.ok(dimension, `缺少维度 ${key}`);
  return dimension as CoverageData["dimensions"][number];
}

function groupOf(report: CoverageData, key: string, groupKey: string) {
  const dimension = dimensionOf(report, key);
  const group = dimension.groups.find((item) => item.key === groupKey);
  assert.ok(group, `维度 ${key} 缺少分组 ${groupKey}`);
  return group as CoverageData["dimensions"][number]["groups"][number];
}

describe("v2.16 §9.3: getMistakeStats.report='coverage'", () => {
  test("手算对照：同名不同 ID 学习集成两组，一题多标签分母去重", async () => {
    const report = await coverage({ report: "coverage", limit: 20 });
    assert.equal(report.matchingRecords, 5);
    assert.equal(report.snapshotId, snapshot);

    const notebook = dimensionOf(report, "notebook");
    assert.equal(notebook.multiValue, false);
    assert.equal(notebook.recordCount, 5, "每个筛选内记录都命中一个学习集分组");
    assert.equal(notebook.recordsWithoutValue, 0);
    assert.equal(notebook.totalGroups, 3, "bookA/bookB/bookC 三组（bookA 与 bookB 同名但不同 ID）");
    const groupA = groupOf(report, "notebook", F.COVERAGE_NOTEBOOK_A);
    const groupB = groupOf(report, "notebook", F.COVERAGE_NOTEBOOK_B);
    assert.equal(groupA.label, "数学");
    assert.equal(groupB.label, "数学");
    assert.equal(groupA.recordCount, 2);
    assert.equal(groupB.recordCount, 1);

    const tags = dimensionOf(report, "customTag");
    assert.equal(tags.multiValue, true);
    assert.equal(tags.recordCount, 4, "去重后带标签记录数（R3 无标签）");
    assert.equal(tags.recordsWithoutValue, 1);
    assert.equal(tags.totalGroups, 3);
    const tag1 = groupOf(report, "customTag", "tag1");
    const tag2 = groupOf(report, "customTag", "tag2");
    const tag3 = groupOf(report, "customTag", "tag3");
    assert.equal(tag1.recordCount, 3);
    assert.equal(tag2.recordCount, 2);
    assert.equal(tag3.recordCount, 1);
    // 多标签分组之和 > 分母（§9.3 customTag 允许大于）。
    const sumGroups = tags.groups.reduce((sum, group) => sum + group.recordCount, 0);
    assert.ok(sumGroups > tags.recordCount, "一题多标签分组之和大于去重分母");
  });

  test("空分类与无标签有明确计数；无历史/仅入册标记可区分", async () => {
    const report = await coverage({ report: "coverage" });

    const category = dimensionOf(report, "category");
    const uncategorized = groupOf(report, "category", "(uncategorized)");
    assert.equal(uncategorized.label, "未分类");
    assert.equal(uncategorized.recordCount, 1, "仅 R3 空分类");
    assert.equal(uncategorized.coverage.questionText.available, 0, "R3 无题干");
    assert.equal(uncategorized.coverage.reviewHistory.missing, 1, "R3 无历史");

    const tag = dimensionOf(report, "customTag");
    assert.equal(tag.recordsWithoutValue, 1, "仅 R3 无标签");

    // R2 只有入册标记（mark），无真实复习 → none；R3 history=[] → missing；其余有复习 → available。
    const notebookB = groupOf(report, "notebook", F.COVERAGE_NOTEBOOK_B);
    assert.deepEqual(notebookB.coverage.reviewHistory, { available: 0, none: 1, missing: 0 });
    const notebookC = groupOf(report, "notebook", F.COVERAGE_NOTEBOOK_C);
    assert.deepEqual(notebookC.coverage.reviewHistory, { available: 1, none: 0, missing: 1 });
  });

  test("有正文但来源不可定位 → unlocatable，不计入可读取答案", async () => {
    const report = await coverage({ report: "coverage" });
    const notebookC = groupOf(report, "notebook", F.COVERAGE_NOTEBOOK_C);
    assert.deepEqual(notebookC.coverage.answerText, {
      available: 1, // C1 旧导入，answerNotebookId + answerRootNodeId 可定位
      missing: 0,
      unlocatable: 1, // C2 有正文但无来源
      outOfScope: 0,
    });
  });

  test("答案来源不在授权 scope → outOfScope，不返回正文", async () => {
    const report = await coverage({ report: "coverage" }, { notebookIds: [F.COVERAGE_NOTEBOOK_A] });
    assert.equal(report.matchingRecords, 2, "仅 bookA 两条记录进入分母");
    const notebookA = groupOf(report, "notebook", F.COVERAGE_NOTEBOOK_A);
    assert.deepEqual(notebookA.coverage.answerText, {
      available: 0,
      missing: 0,
      unlocatable: 0,
      outOfScope: 2, // 两条设备答案的来源均在答案集 bookAns，不在授权 scope
    });
  });

  test("旧统计与 G2 报告不退化（省略 report 仍返回常规统计）", async () => {
    const tool = app.registry.get("getMistakeStats");
    assert.ok(tool, "getMistakeStats 未注册");
    const envelope = (await tool.run({}, {
      sessionId: "coverage-session",
      scope: ALL,
      snapshotId: snapshot,
      signal: new AbortController().signal,
    })) as ToolEnvelope;
    assert.equal(envelope.ok, true);
    const stats = envelope.data as { totalRecords: number; snapshotId: string; dataAsOf: string };
    assert.equal(stats.totalRecords, 5);
    assert.equal(stats.snapshotId, snapshot);
    assert.equal(typeof stats.dataAsOf, "string");
  });

  test("确定性排序与 limit/截断", async () => {
    const report = await coverage({ report: "coverage", limit: 1 });
    const notebook = dimensionOf(report, "notebook");
    assert.equal(notebook.totalGroups, 3);
    assert.equal(notebook.truncated, true);
    assert.equal(notebook.omittedGroups, 2);
    assert.equal(notebook.groups.length, 1);
    // recordCount 降序：bookA(2) 与 bookC(2) 并列，key 升序 bookA 在前。
    assert.equal(notebook.groups[0]!.key, F.COVERAGE_NOTEBOOK_A);
  });

  test("覆盖率数值进入同轮统计证据与引用校验（只接受本轮同快照数据）", async () => {
    const report = await coverage({ report: "coverage" });
    const evidence = {
      evidenceId: "ev-coverage-1",
      toolCallId: "call-coverage-1",
      toolName: "getMistakeStats",
      data: report,
    };
    const groupCount = statisticValue(evidence as never, "data.dimensions.0.groups.0.recordCount");
    assert.ok(groupCount, "分组题数应可引用");
    assert.equal(groupCount.value, report.dimensions[0]!.groups[0]!.recordCount);
    assert.equal(groupCount.label, "该分组题数");
    const answerCoverage = statisticValue(evidence as never, "dimensions.0.groups.0.coverage.answerText.available");
    assert.ok(answerCoverage);
    assert.equal(answerCoverage.label, "可读取答案题数");
    const historyCoverage = statisticValue(evidence as never, "dimensions.0.groups.0.coverage.reviewHistory.available");
    assert.ok(historyCoverage);
    assert.equal(historyCoverage.label, "有可核实复习历史的题数");
    assert.equal(statisticValue(evidence as never, "dimensions.0.groups.0.coverage.reviewHistory.none"), null, "未列入白名单的字段不可引用");
  });
});
