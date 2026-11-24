import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { parseSnapshotPayload } from "../../src/adapters/cardlink/snapshot-importer.ts";
import { StatisticsEngine } from "../../src/application/statistics-engine.ts";
import { snapshot1, snapshot2, partialSnapshot, pluginBackup, FIXTURE_STATS_TIME_SH, FIXTURE_STATS_TIME_UTC, FIXTURE_TIMEZONE_SH, FIXTURE_TIMEZONE_UTC, EXPECTED_AFTER_SNAPSHOT1, EXPECTED_AFTER_SNAPSHOT2, NOTEBOOK_A_TITLE } from "../fixtures/fixture-data.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";

/** 旧端口导入语义（插入/更新/缺失标记计数）经适配器在 v2 存储上成立。 */
async function importPayload(app: HarnessApp, payload: unknown) {
  const parsed = parseSnapshotPayload(payload);
  const result = await app.repository.applySnapshot(parsed.batch);
  return { ...result, sourceKind: parsed.sourceKind };
}

function contractPayload(records: ReturnType<typeof snapshot1>, isFull: boolean) {
  return {
    schemaVersion: 1,
    sourceId: "fixture",
    exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: isFull,
    records,
  };
}

describe("P2: 快照导入与统计（T06/T07/T09/T19/T20/T21）", () => {
  test("T09: 100 条 Fixture 的等级/到期/复习统计与独立基准一致", async () => {
    const app = makeApp();
    const result = await importPayload(app, contractPayload(snapshot1(), true));
    assert.equal(result.inserted, 100);
    assert.equal(result.unavailable, EXPECTED_AFTER_SNAPSHOT1.sourceUnavailableCount);
    assert.equal(result.errors, undefined);

    const engine = new StatisticsEngine(app.repository);
    const scope = { notebookIds: [] };

    const shanghai = await engine.getStats({
      filter: {}, scope, statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH,
    });
    assert.equal(shanghai.totalRecords, EXPECTED_AFTER_SNAPSHOT1.totalMistakes);
    assert.equal(shanghai.totalMistakes, EXPECTED_AFTER_SNAPSHOT1.totalMistakes);
    assert.deepEqual(shanghai.levelCounts, EXPECTED_AFTER_SNAPSHOT1.levelCounts);
    assert.equal(shanghai.dueCount, EXPECTED_AFTER_SNAPSHOT1.dueCountShanghai);
    assert.equal(shanghai.reviewedRecordCount, EXPECTED_AFTER_SNAPSHOT1.reviewedCount);
    assert.equal(shanghai.reviewedCount, EXPECTED_AFTER_SNAPSHOT1.reviewedCount);
    assert.equal(shanghai.reviewEventCount, EXPECTED_AFTER_SNAPSHOT1.reviewEventCount);
    // v2.1 §8 G2 扩展字段
    assert.equal(shanghai.availableRecords, EXPECTED_AFTER_SNAPSHOT1.availableRecords);
    assert.equal(shanghai.totalReviewActions, EXPECTED_AFTER_SNAPSHOT1.reviewEventCount);
    assert.equal(shanghai.currentLevelReviewCountSum, EXPECTED_AFTER_SNAPSHOT1.reviewEventCount);
    // 口径参数回传（§12）
    assert.equal(shanghai.params.statsTime, FIXTURE_STATS_TIME_SH);
    assert.equal(shanghai.params.timezone, FIXTURE_TIMEZONE_SH);
    assert.ok(shanghai.params.dueBoundary);

    // T19: 同一时刻的 UTC 口径把 2026-11-13T01:00+08 计入到期
    const utc = await engine.getStats({
      filter: {}, scope, statsTime: FIXTURE_STATS_TIME_UTC, timezone: FIXTURE_TIMEZONE_UTC,
    });
    assert.equal(utc.dueCount, EXPECTED_AFTER_SNAPSHOT1.dueCountUtc);

    // 主题过滤（subject=笔记本标题）
    const aOnly = await engine.getStats({ filter: { subject: NOTEBOOK_A_TITLE }, scope, statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH });
    assert.equal(aOnly.totalMistakes, 60);
  });

  test("T06: 重复导入幂等（计数正确，无重复事件）", async () => {
    const app = makeApp();
    const payload = contractPayload(snapshot1(), true);
    const first = await importPayload(app, payload);
    assert.equal(first.inserted, 100);
    assert.equal(first.updated, 0);

    const repeat = await importPayload(app, payload);
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.updated, 0);
    assert.equal(repeat.unchanged, 100);
    assert.equal(repeat.warnings.some((w) => w.includes("幂等")), true);

    const stats = await new StatisticsEngine(app.repository).getStats({ filter: {}, scope: { notebookIds: [] }, statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH });
    assert.equal(stats.reviewEventCount, EXPECTED_AFTER_SNAPSHOT1.reviewEventCount);
  });

  test("T21: recordId 修复 → 旧记录标记缺失、新记录新增；T07: 全量缺失标记不删除", async () => {
    const app = makeApp();
    await importPayload(app, contractPayload(snapshot1(), true));
    const before = new StatisticsEngine(app.repository).getStats({ filter: {}, scope: { notebookIds: [] }, statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH });
    void before;

    const second = await importPayload(app, contractPayload(snapshot2(), true));
    assert.equal(second.inserted, EXPECTED_AFTER_SNAPSHOT2.inserted);
    assert.equal(second.updated, EXPECTED_AFTER_SNAPSHOT2.updated);
    assert.equal(second.unchanged, EXPECTED_AFTER_SNAPSHOT2.unchanged);
    assert.equal(second.repaired, EXPECTED_AFTER_SNAPSHOT2.repaired);
    assert.equal(second.markedMissing, EXPECTED_AFTER_SNAPSHOT2.markedMissing);
    assert.ok(second.warnings.some((w) => w.includes("recordId 修复")));
    assert.ok(second.warnings.some((w) => w.includes("缺失")));

    const stats = await new StatisticsEngine(app.repository).getStats({ filter: {}, scope: { notebookIds: [] }, statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH });
    assert.equal(stats.totalMistakes, EXPECTED_AFTER_SNAPSHOT2.totalMistakes);
    assert.deepEqual(stats.levelCounts, EXPECTED_AFTER_SNAPSHOT2.levelCounts);
    assert.equal(stats.dueCount, EXPECTED_AFTER_SNAPSHOT2.dueCountShanghai);
    assert.equal(stats.reviewedCount, EXPECTED_AFTER_SNAPSHOT2.reviewedCount);
    assert.equal(stats.reviewEventCount, EXPECTED_AFTER_SNAPSHOT2.reviewEventCount);

    // T07：被取消/被替换的记录仍在前一版本中（未删除），只是不在最新版本视图。
    const db = app.db;
    const latestId = (db.rows("SELECT snapshot_id FROM snapshots ORDER BY imported_at DESC, rowid DESC LIMIT 1")[0] as { snapshot_id: string }).snapshot_id;
    const prevIds = new Set(
      (db.rows("SELECT record_id FROM mistake_projection_v2 WHERE snapshot_id != ?", [latestId]) as unknown as Array<{ record_id: string }>).map((r) => r.record_id),
    );
    const latestIds = new Set(
      (db.rows("SELECT record_id FROM mistake_projection_v2 WHERE snapshot_id = ?", [latestId]) as unknown as Array<{ record_id: string }>).map((r) => r.record_id),
    );
    let absentFromLatest = 0;
    for (const id of prevIds) if (!latestIds.has(id)) absentFromLatest++;
    assert.equal(absentFromLatest, 3); // 2 取消 + 1 修复替换（版本化语义：缺席即旧 missing_in_latest）
    // 修复替换：bookW 旧 ID 不在最新版本，其同源对新 ID 在。
    const bookWIds = [...prevIds].filter((id) => id.startsWith("bookW"));
    assert.ok(bookWIds.length >= 1);
    assert.equal(bookWIds.every((id) => !latestIds.has(id)), true);
    void openDatabase;
  });

  test("T07: 局部快照不触发缺失标记", async () => {
    const app = makeApp();
    await importPayload(app, contractPayload(snapshot1(), true));
    const partial = await importPayload(app, contractPayload(partialSnapshot(), false));
    assert.equal(partial.inserted, 0);
    assert.equal(partial.markedMissing, 0);
    const stats = await new StatisticsEngine(app.repository).getStats({ filter: {}, scope: { notebookIds: [] }, statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH });
    assert.equal(stats.totalMistakes, 100);
  });

  test("插件备份形态 {version:2, records} 可直接导入", async () => {
    const app = makeApp();
    const result = await importPayload(app, pluginBackup());
    assert.equal(result.sourceKind, "plugin-backup");
    assert.equal(result.inserted, 2);
    const detail = await app.repository.getById(Object.keys(pluginBackup().records)[0] as string, { notebookIds: [] });
    assert.ok(detail);
  });

  test("非法载荷整批回滚并给出字段级诊断（§6.3）", async () => {
    const app = makeApp();
    const sync = app.syncService;
    await assert.rejects(
      () => sync.importSnapshot({ schemaVersion: 99 }),
      (e: Error) => e.message.includes("schemaVersion"),
    );
    await assert.rejects(
      () => sync.importSnapshot({ schemaVersion: 1, sourceId: "x", exportedAt: "2026-11-12T00:00:00Z", isFullSnapshot: true, records: [{ sourceNotebookId: "nb", sourceNoteId: "n" }] }),
      (e: Error) => e.message.includes("recordId"),
    );
    const count = (app.db.rows("SELECT COUNT(*) AS n FROM mistake_projection_v2")[0] as { n: number }).n;
    assert.equal(count, 0);
  });
});
