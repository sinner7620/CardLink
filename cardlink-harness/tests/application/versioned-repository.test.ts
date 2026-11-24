import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import { VersionedSqliteMistakeRepository } from "../../src/adapters/sqlite/versioned-mistake-repository.ts";
import { openDatabase, type SqlDriver } from "../../src/adapters/sqlite/node-driver.ts";
import type { VersionedImportPayload, VersionedSnapshotRecord } from "../../src/application/ports/versioned-mistake-repository.ts";

let driver: SqlDriver;
let repo: VersionedSqliteMistakeRepository;

beforeEach(() => {
  driver = openDatabase(":memory:");
  repo = new VersionedSqliteMistakeRepository(driver);
});

function record(id: string, overrides: Partial<VersionedSnapshotRecord> = {}): VersionedSnapshotRecord {
  const [notebookId, noteId] = id.split(":");
  return {
    recordId: id,
    sourceNotebookId: notebookId,
    sourceNoteId: noteId,
    sourceAvailable: true,
    level: 0,
    currentLevelReviewCount: 0,
    reviewCompleted: false,
    nextReviewAt: "2026-11-20T09:00:00.000Z",
    lastReviewedAt: undefined,
    favorite: false,
    categoryPath: ["数学"],
    manualCategories: [],
    customTags: [],
    reasonTags: [],
    errorReasons: [],
    sourceTitle: `错题 ${id}`,
    sourceNotebookTitle: "数学",
    sourcePathTitles: [],
    ocr: { origin: "none", status: "missing" },
    sourcePayload: {},
    history: [],
    contentHash: "",
    ...overrides,
  };
}

function payload(records: VersionedSnapshotRecord[], opts: { complete?: boolean; baseRevision?: string; sourceId?: string; revision?: string; snapshotId?: string } = {}): VersionedImportPayload {
  return {
    manifest: {
      sourceId: opts.sourceId ?? "fixture",
      sourceRevision: opts.revision ?? `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      importedAt: new Date().toISOString(),
      scope: { notebookIds: [] },
      complete: opts.complete ?? true,
      baseRevision: opts.baseRevision,
      snapshotId: opts.snapshotId,
    },
    records,
  };
}

describe("版本化快照投影（§6.2/§7）", () => {
  test("完整快照首次导入：全部插入，manifest 正确", async () => {
    const result = await repo.applySnapshot(payload([record("bookA:note1"), record("bookA:note2"), record("bookB:note1")]));
    assert.equal(result.inserted, 3);
    assert.equal(result.recordCount, 3);
    const manifest = await repo.getSnapshot(result.snapshotId);
    assert.ok(manifest);
    assert.equal(manifest.complete, true);
    assert.equal(manifest.recordCount, 3);
    assert.equal(await repo.latestSnapshotId(), result.snapshotId);
  });

  test("重复导入同内容快照：幂等跳过（同 snapshotId）", async () => {
    const p = payload([record("bookA:note1")]);
    const first = await repo.applySnapshot(p);
    const repeat = await repo.applySnapshot(p);
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.unchanged, 1);
    assert.ok(repeat.warnings.some((w) => w.includes("幂等")));
  });

  test("导出时间和记录顺序不产生重复版本，数据回到旧值时仍更新最新版本", async () => {
    const records = [record("bookA:note1"), record("bookA:note2")];
    const [first, duplicate] = await Promise.all([
      repo.applySnapshot(payload(records, { revision: "first" })),
      repo.applySnapshot(payload([...records].reverse(), { revision: "duplicate" })),
    ]);
    assert.equal(first.snapshotId, duplicate.snapshotId);
    assert.equal((await repo.listSnapshots(5)).length, 1);
    await repo.applySnapshot(payload([record("bookA:note1", { level: 2 })], { revision: "changed" }));
    const restored = await repo.applySnapshot(payload(records, { revision: "restored" }));
    assert.notEqual(restored.snapshotId, first.snapshotId);
    assert.equal(await repo.latestSnapshotId(), restored.snapshotId);
  });

  test("跨快照隔离：新完整快照不影响旧版本查询（GC 保护前提）", async () => {
    const v1 = await repo.applySnapshot(payload([record("bookA:note1", { level: 0 })]));
    const v2 = await repo.applySnapshot(payload([record("bookA:note1", { level: 1 })]));
    assert.notEqual(v1.snapshotId, v2.snapshotId);
    const old = await repo.get(v1.snapshotId, "bookA:note1", { notebookIds: [] });
    const now = await repo.get(v2.snapshotId, "bookA:note1", { notebookIds: [] });
    assert.equal(old?.level, 0, "旧版本保留原值");
    assert.equal(now?.level, 1, "新版本反映变更");
    const oldStats = await repo.stats(v1.snapshotId, {}, { notebookIds: [] }, new Date());
    assert.equal(oldStats.totalRecords, 1);
  });

  test("增量快照：baseRevision 校验 + 差异合成完整逻辑视图", async () => {
    const full = await repo.applySnapshot(payload([record("bookA:note1"), record("bookA:note2")]));
    // 缺 baseRevision → 拒绝
    await assert.rejects(
      () => repo.applySnapshot(payload([record("bookA:note3")], { complete: false })),
      (e: Error) => e.message.includes("base_revision_required"),
    );
    // baseRevision 过期 → 拒绝
    await assert.rejects(
      () => repo.applySnapshot(payload([record("bookA:note3")], { complete: false, baseRevision: "stale" })),
      (e: Error) => e.message.includes("base_revision_mismatch"),
    );
    // 正确 baseRevision → base 行保留 + 增量覆盖
    const delta = await repo.applySnapshot(
      payload([record("bookA:note3")], { complete: false, baseRevision: full.snapshotId, revision: "rev-delta" }),
    );
    assert.equal(delta.recordCount, 3, "base 2 条 + 增量 1 条");
    const page = await repo.query(delta.snapshotId, {}, { notebookIds: [] });
    assert.equal(page.records.length, 3);
    assert.ok(page.records.some((r) => r.recordId === "bookA:note3"));
  });

  test("recordId 修复：同源对替换（增量合成时不静默合并）", async () => {
    const full = await repo.applySnapshot(payload([record("bookW:noteX", { sourceTitle: "修复前" })]));
    const delta = await repo.applySnapshot(
      payload(
        [{ ...record("bookA:noteX", { sourceTitle: "修复后" }), sourceNotebookId: "bookW", sourceNoteId: "noteX" }],
        { complete: false, baseRevision: full.snapshotId },
      ),
    );
    assert.equal(delta.repaired, 1);
    assert.ok(delta.warnings.some((w) => w.includes("recordId 修复")));
    const page = await repo.query(delta.snapshotId, {}, { notebookIds: [] });
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0]?.recordId, "bookA:noteX");
    const oldVersion = await repo.get(full.snapshotId, "bookW:noteX", { notebookIds: [] });
    assert.ok(oldVersion, "旧版本保留修复前记录");
  });

  test("每快照统计（G2 字段）与分布", async () => {
    const snap = await repo.applySnapshot(
      payload([
        record("bookA:note1", { level: 0, currentLevelReviewCount: 2, lastReviewedAt: "2026-11-10T00:00:00.000Z" }),
        record("bookA:note2", { level: 2, reviewCompleted: true }),
        record("bookB:note1", { level: 1, sourceAvailable: false }),
      ]),
    );
    const stats = await repo.stats(snap.snapshotId, {}, { notebookIds: [] }, new Date("2026-11-12T22:00:00+08:00"));
    assert.equal(stats.totalRecords, 3);
    assert.equal(stats.availableRecords, 2);
    assert.deepEqual(stats.levelCounts, { "0": 1, "1": 1, "2": 1, unknown: 0 });
    assert.equal(stats.reviewedRecordCount, 1);
    assert.equal(stats.currentLevelReviewCountSum, 2);
    assert.equal(stats.dueCount, 0, "note1 次日未到期；note2 已完成；note3 来源不可用");
    const dist = await repo.getCategoryDistribution(snap.snapshotId, {}, { notebookIds: [] });
    assert.ok(dist.length >= 1);
  });

  test("授权范围过滤：scope 外不可读", async () => {
    const snap = await repo.applySnapshot(payload([record("bookA:note1"), record("bookB:note1")]));
    const got = await repo.get(snap.snapshotId, "bookB:note1", { notebookIds: ["bookA"] });
    assert.equal(got, null);
    const page = await repo.query(snap.snapshotId, {}, { notebookIds: ["bookA"] });
    assert.equal(page.records.every((r) => r.sourceNotebookId === "bookA"), true);
  });

  test("快照不存在时显式报错（不静默空结果）", async () => {
    await assert.rejects(
      () => repo.query("missing-snapshot", {}, { notebookIds: [] }),
      (e: Error) => e.message.includes("snapshot_not_found"),
    );
  });
});
