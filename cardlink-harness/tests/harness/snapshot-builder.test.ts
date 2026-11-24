import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { buildSnapshotPayload, type PluginOcrRow } from "../../src/harness/snapshot-builder.ts";
import { parseSnapshotPayload } from "../../src/adapters/cardlink/snapshot-importer.ts";
import { SyncService } from "../../src/application/sync-service.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { VersionedSqliteMistakeRepository } from "../../src/adapters/sqlite/versioned-mistake-repository.ts";
import { VersionedBackedMistakeRepository } from "../../src/adapters/sqlite/versioned-legacy-repository.ts";
import { StatisticsEngine } from "../../src/application/statistics-engine.ts";

/**
 * P4-1 集成验收（GPT 表「全量快照导入：原始记录与全部关键字段一致」开发机等价）：
 * 插件形态记录 + OCR 行 → buildSnapshotPayload → SyncService（版本化导入）→ 适配器读回，
 * G7 关键字段逐项核对；OCR 手工修订优先于机器文本。
 */

function pluginRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: "bookA0000000000000000000000000001:noteA001",
    sourceNoteId: "noteA001",
    sourceNotebookId: "bookA0000000000000000000000000001",
    sourceNotebookTitle: "数学·微积分",
    sourceRootTitle: "考研错题",
    sourceTitle: "极限计算题",
    sourcePathTitles: ["考研错题", "高等数学"],
    categoryPath: ["数学", "极限"],
    manualCategory: "常错题型",
    reasonTags: ["计算失误"],
    favorite: true,
    level: 1,
    reviewCount: 3,
    reviewCompleted: false,
    nextReviewAt: "2026-11-20T09:00:00.000Z",
    lastReviewedAt: "2026-11-13T09:00:00.000Z",
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-13T09:00:00.000Z",
    answerNotebookId: "bookB0000000000000000000000000002",
    answerRootNodeId: "answer-node-1",
    history: [
      { at: "2026-11-01T08:00:00.000Z", level: 1, errorReason: { key: "calc", label: "计算失误" } },
      { at: "2026-11-10T08:00:00.000Z", level: 2 },
    ],
    // 插件自有扩展字段（G7 无损进 sourcePayload）
    levelModel: 3,
    reviewScheduleModel: 3,
    tagsWrittenAt: "2026-11-02T00:00:00.000Z",
    ...overrides,
  };
}

const OCR_ROWS: PluginOcrRow[] = [
  {
    record_id: "bookA0000000000000000000000000001:noteA001",
    native_text: "机器识别原文",
    ocr_text: "机器 OCR 文本",
    manual_text: "用户手工修订后的题干",
    effective_text: "用户手工修订后的题干",
    status: "complete",
  },
];

function makeStack() {
  const driver = openDatabase(":memory:");
  const v2 = new VersionedSqliteMistakeRepository(driver);
  const legacy = new VersionedBackedMistakeRepository(v2, undefined, driver);
  const sync = new SyncService(v2);
  return { driver, v2, legacy, sync };
}

describe("P4-1: SnapshotBuilder 真数据集成", () => {
  test("插件差分同步携带未变记录，保留手工 OCR 与历史，同内容复用，源删除时全量替换", async () => {
    const { sync, v2, legacy } = makeStack();
    const first = pluginRecord();
    const second = pluginRecord({
      recordId: "bookA0000000000000000000000000001:noteA002", sourceNoteId: "noteA002",
    });
    const options = { preferIncremental: true };
    const initial = await sync.importSnapshot(buildSnapshotPayload([first, second], OCR_ROWS), options);
    assert.equal((await v2.getSnapshot(initial.snapshotId))?.complete, true);

    const afterEdit = { ...second, sourceTitle: "修改后标题" };
    const delta = await sync.importSnapshot(buildSnapshotPayload([first, afterEdit], OCR_ROWS), options);
    assert.equal((await v2.getSnapshot(delta.snapshotId))?.complete, false);
    assert.equal(delta.updated, 1);
    assert.equal(delta.carried, 1);
    const scope = { notebookIds: [] };
    assert.equal((await v2.get(delta.snapshotId, String(first.recordId), scope))?.ocr.manualText, "用户手工修订后的题干");
    assert.equal((await legacy.getReviewHistory(String(first.recordId), scope)).length, 2);
    assert.equal((await v2.get(delta.snapshotId, String(second.recordId), scope))?.sourceTitle, "修改后标题");
    const same = await sync.importSnapshot(buildSnapshotPayload([afterEdit, first], OCR_ROWS), options);
    assert.equal(same.snapshotId, delta.snapshotId);
    assert.equal(same.carried, 2);
    const sameFull = await sync.importSnapshot(buildSnapshotPayload([afterEdit, first], OCR_ROWS), { preferIncremental: false });
    assert.equal(sameFull.snapshotId, delta.snapshotId);

    const deletion = await sync.importSnapshot(buildSnapshotPayload([first], OCR_ROWS), options);
    assert.equal((await v2.getSnapshot(deletion.snapshotId))?.complete, true);
    assert.equal(await v2.get(deletion.snapshotId, String(second.recordId), scope), null);
    assert.ok(await v2.get(delta.snapshotId, String(second.recordId), scope));
  });

  test("插件记录 + OCR 行 → 契约载荷 → 版本化导入 → G7 字段逐项读回一致", async () => {
    const { sync, legacy } = makeStack();
    const payload = buildSnapshotPayload([pluginRecord()], OCR_ROWS);
    const parsed = parseSnapshotPayload(payload);
    assert.equal(parsed.sourceKind, "harness-contract");
    const result = await sync.importSnapshot(payload);
    assert.equal(result.inserted, 1);

    const record = await legacy.getById("bookA0000000000000000000000000001:noteA001", { notebookIds: [] });
    assert.ok(record);
    // 身份与来源体系
    assert.equal(record!.recordId, "bookA0000000000000000000000000001:noteA001");
    assert.equal(record!.sourceNotebookTitle, "数学·微积分");
    assert.deepEqual(record!.sourcePathTitles, ["考研错题", "高等数学"]);
    assert.deepEqual(record!.categoryPath, ["数学", "极限"]);
    // G7 用户自定义内容
    assert.deepEqual(record!.manualCategories, []);
    assert.deepEqual(record!.customTags, ["常错题型"], "旧插件单数标签映射至 customTags");
    assert.deepEqual(record!.reasonTags, ["计算失误"]);
    assert.equal(record!.favorite, true);
    assert.equal(record!.errorReasons.length, 0, "插件形状：错因在 history 事件里，不在顶层");
    // 复习状态
    assert.equal(record!.level, 1);
    assert.equal(record!.reviewCount, 3);
    assert.equal(record!.reviewCompleted, false);
    assert.equal(record!.nextReviewAt, "2026-11-20T09:00:00.000Z");
    assert.equal(record!.lastReviewedAt, "2026-11-13T09:00:00.000Z");
    // 答案绑定不与来源节点混淆
    assert.equal(record!.answerNotebookId, "bookB0000000000000000000000000002");
    // OCR 手工修订优先（G7）：getMistakeDetail includeText 取到手工文本
    const detailTool = (await import("../../src/tools/get-mistake-detail.ts")).createGetMistakeDetail({ repository: legacy });
    const envelope = (await detailTool.run(
      { recordId: record!.recordId, includeText: true },
      { sessionId: "s", scope: { notebookIds: [] }, snapshotId: record!.snapshotId, signal: new AbortController().signal },
    )) as { data?: { record?: { questionText?: string; customTags?: string[]; manualCategories?: string[] } } };
    assert.equal(envelope.data?.record?.questionText, "用户手工修订后的题干");
    assert.deepEqual(envelope.data?.record?.customTags, ["常错题型"]);
    assert.deepEqual(envelope.data?.record?.manualCategories, []);
  });

  test("原生备份、显式标签和普通快照分别投影且保留原始标签字段", async () => {
    const { sync, v2 } = makeStack();
    const scope = { notebookIds: [] };
    const native = pluginRecord({ manualCategories: ["旧版标签"], manualCategory: "过时标签" });
    const recordId = String(native.recordId);
    const backup = await sync.importSnapshot({ version: 2, records: { [recordId]: native } });
    const restored = await v2.get(backup.snapshotId, recordId, scope);
    assert.deepEqual(restored?.customTags, ["旧版标签"]);
    assert.deepEqual(restored?.manualCategories, []);
    assert.deepEqual(restored?.sourcePayload.manualCategories, ["旧版标签"]);
    assert.equal(restored?.sourcePayload.manualCategory, "过时标签");

    const cases = [
      { sourceId: "cardlink-plugin", fields: { customTags: ["题型标签"] }, tags: ["题型标签"] },
      { sourceId: "cardlink-plugin", fields: { customTags: [] }, tags: [] },
      { sourceId: "external", fields: {}, tags: [] },
    ];
    for (const { sourceId, fields, tags } of cases) {
      const payload = buildSnapshotPayload([
        pluginRecord({ manualCategory: undefined, manualCategories: ["手动分类"], ...fields }),
      ], [], { sourceId });
      const { snapshotId } = await sync.importSnapshot(payload);
      const record = await v2.get(snapshotId, recordId, scope);
      assert.deepEqual(record?.manualCategories, ["手动分类"]);
      assert.deepEqual(record?.customTags, tags);
    }
  });

  test("无 OCR 的记录状态为 missing，不伪造文本；复习历史转事件", async () => {
    const { sync, legacy } = makeStack();
    await sync.importSnapshot(buildSnapshotPayload([pluginRecord({ favorite: false })], []));
    const record = await legacy.getById("bookA0000000000000000000000000001:noteA001", { notebookIds: [] });
    assert.ok(record);
    assert.equal(record!.textStatus, "missing");
    const events = await legacy.getReviewHistory(record!.recordId, { notebookIds: [] });
    assert.equal(events.length, 2, "mark + review");
    assert.equal(events[0]!.eventType, "mark");
    assert.deepEqual(events[0]!.errorReason, { key: "calc", label: "计算失误" });
  });

  test("统计口径：导入后 dueCount/levelCounts 与记录直接推导一致", async () => {
    const { sync, legacy } = makeStack();
    await sync.importSnapshot(buildSnapshotPayload([
      pluginRecord(),
      pluginRecord({ recordId: "bookA0000000000000000000000000001:noteA002", sourceNoteId: "noteA002", level: 0, reviewCompleted: true, nextReviewAt: "2026-11-01T00:00:00.000Z" }),
      pluginRecord({ recordId: "bookA0000000000000000000000000001:noteA003", sourceNoteId: "noteA003", level: 2, nextReviewAt: "2026-11-25T00:00:00.000Z", favorite: false }),
    ], OCR_ROWS));
    const engine = new StatisticsEngine(legacy);
    const stats = await engine.getStats({ filter: {}, scope: { notebookIds: [] }, statsTime: "2026-11-14T10:00:00.000Z", timezone: "Asia/Shanghai" });
    assert.equal(stats.totalRecords, 3);
    assert.deepEqual(stats.levelCounts, { "0": 1, "1": 1, "2": 1, unknown: 0 });
    // noteA001 到期(2026-11-20 < 11-14 本地今天24点? 否) → 实际 noteA002 已完成不计, noteA003 未到期
    assert.equal(stats.dueCount, 0);
    // 三条记录都继承基础夹具的 lastReviewedAt → 已复习数 3
    assert.equal(stats.reviewedRecordCount, 3);
  });

  test("缺 recordId/来源字段的插件记录被导入器整批拒绝（§6.3 诊断），不静默跳过", async () => {
    const { sync } = makeStack();
    const payload = buildSnapshotPayload([{ sourceNotebookId: "nb", sourceNoteId: "n" }]);
    await assert.rejects(() => sync.importSnapshot(payload), /recordId/);
  });
});
