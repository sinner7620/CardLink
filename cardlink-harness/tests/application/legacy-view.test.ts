import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import { VersionedSqliteMistakeRepository, VersionedMistakeRepositoryWithLegacyView } from "../../src/adapters/sqlite/versioned-mistake-repository.ts";
import { openDatabase, type SqlDriver } from "../../src/adapters/sqlite/node-driver.ts";
import type { VersionedImportPayload, VersionedSnapshotRecord } from "../../src/application/ports/versioned-mistake-repository.ts";

let driver: SqlDriver;
let repo: VersionedSqliteMistakeRepository;
let legacy: VersionedMistakeRepositoryWithLegacyView;

beforeEach(() => {
  driver = openDatabase(":memory:");
  repo = new VersionedSqliteMistakeRepository(driver);
  legacy = new VersionedMistakeRepositoryWithLegacyView(repo);
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

describe("legacy latest-view 兼容（§21.2：旧调用方零改造）", () => {
  test("queryLegacy/getLatestSnapshotMeta 走最新快照", async () => {
    await repo.applySnapshot(payload([record("bookA:note1", { level: 0 })]));
    const v2 = await repo.applySnapshot(payload([record("bookA:note1", { level: 1 }), record("bookA:note2")]));

    const page = await legacy.queryLegacy({}, { notebookIds: [] });
    assert.equal(page.records.length, 2);
    assert.equal(page.snapshotId, v2.snapshotId);
    const meta = await legacy.getLatestSnapshotMeta();
    assert.equal(meta?.snapshotId, v2.snapshotId);
    assert.equal(meta?.isFullSnapshot, true);
  });

  test("旧完整快照语义：新版本缺失记录 = 旧视图不可见但不删除", async () => {
    await repo.applySnapshot(payload([record("bookA:note1"), record("bookA:note2")]));
    await repo.applySnapshot(payload([record("bookA:note1")]));
    const page = await legacy.queryLegacy({}, { notebookIds: [] });
    assert.equal(page.records.length, 1, "v2 完整快照缺 note2 → 视图不含");
    const stillThere = await repo.get((await repo.listSnapshots(1))[0].snapshotId === page.snapshotId
      ? (await repo.listSnapshots(2))[1].snapshotId
      : page.snapshotId, "bookA:note2", { notebookIds: [] });
    assert.ok(stillThere, "旧快照版本仍保留记录（未删除）");
  });

  test("applySnapshotLegacy 以确定性内容哈希幂等", async () => {
    const r = record("bookA:note1");
    const first = await legacy.applySnapshotLegacy([r], "fx", true);
    const second = await legacy.applySnapshotLegacy([r], "fx", true);
    assert.equal(first.snapshotId, second.snapshotId, "内容哈希派生 snapshotId → 同内容同 ID");
    assert.equal(second.inserted, 0);
  });

  test("statsLegacy G2 字段", async () => {
    await repo.applySnapshot(payload([
      record("bookA:note1", { level: 0, currentLevelReviewCount: 3, lastReviewedAt: "2026-11-10T00:00:00.000Z", nextReviewAt: "2026-11-12T00:00:00.000Z" }),
      record("bookA:note2", { level: 2, reviewCompleted: true }),
    ]));
    const stats = await legacy.statsLegacy({}, { notebookIds: [] }, "2026-11-12T16:00:00.000Z");
    assert.equal(stats.totalRecords, 2);
    assert.equal(stats.availableRecords, 2);
    assert.equal(stats.dueCount, 1);
    assert.equal(stats.reviewedRecordCount, 1);
    assert.equal(stats.currentLevelReviewCountSum, 3);
    assert.equal(stats.params.dueBoundary, "2026-11-12T16:00:00.000Z");
  });
});

function payload(records: VersionedSnapshotRecord[]): VersionedImportPayload {
  return {
    manifest: { sourceId: "fixture", sourceRevision: `rev-${Math.random().toString(36).slice(2, 8)}`, importedAt: new Date().toISOString(), scope: { notebookIds: [] }, complete: true },
    records,
  };
}
