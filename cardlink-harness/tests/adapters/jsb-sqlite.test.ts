import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { SqliteSessionStore } from "../../src/adapters/sqlite/sqlite-session-store.ts";
import { SqliteMistakeRepository } from "../../src/adapters/sqlite/sqlite-mistake-repository.ts";
import { VersionedSqliteMistakeRepository } from "../../src/adapters/sqlite/versioned-mistake-repository.ts";
import { SyncService } from "../../src/application/sync-service.ts";
import { JsbSqliteDriver } from "../../src/adapters/jsb/jsb-sqlite.ts";
import type { JsbResultSet, JsbSQLiteDatabase, JsbValue } from "../../src/adapters/jsb/jsb-sqlite.ts";
import { openDatabase, type SqlDriver } from "../../src/adapters/sqlite/node-driver.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

/**
 * T27（v2.1 矩阵）/ H1-T27：JSB SQLiteDatabase 驱动走同一套仓储/存储契约。
 * Mock 桥用 node:sqlite 模拟宿主 ObjC 方法面（字符串化结果集），
 * 驱动的桥接转换逻辑由此获得协议级覆盖；真机行为属 P0.2 设备门禁。
 */
class MockJsbBridge implements JsbSQLiteDatabase {
  private db: SqlDriver;

  constructor() {
    this.db = openDatabase(":memory:");
  }

  open(): boolean {
    return true;
  }

  close(): boolean {
    return true;
  }

  executeUpdateWithArgumentsInArray(sql: string, args?: JsbValue[]): boolean {
    try {
      this.db.exec(sql, args ?? []);
      return true;
    } catch {
      return false;
    }
  }

  executeQueryWithArgumentsInArray(sql: string, args?: JsbValue[]): JsbResultSet | null {
    try {
      const rows = this.db.rows(sql, args ?? []);
      let index = 0; // FMDB 语义：next() 先推进，读取发生在当前行（index-1 为已指向行）
      const columns = rows.length ? Object.keys(rows[0] as Record<string, unknown>) : [];
      const rs: JsbResultSet = {
        columnCount: () => columns.length,
        columnNameForIndex: (i: number) => columns[i],
        stringForColumnIndex: (i: number) => {
          const row = rows[index - 1] as Record<string, unknown> | undefined;
          if (!row) return null;
          const v = row[columns[i] as string];
          return v === null || v === undefined ? null : String(v);
        },
        next: () => {
          index += 1;
          return index <= rows.length;
        },
        close: () => true,
      };
      return rs;
    } catch {
      return null;
    }
  }
}

describe("H1-T27: JSB SQLiteDatabase 驱动（mock 桥协议级）", () => {
  test("排序分页和报表在 JSB 字符串结果集上保留数值类型", async () => {
    const driver = new JsbSqliteDriver(new MockJsbBridge());
    const repo = new VersionedSqliteMistakeRepository(driver);
    const scope = { notebookIds: [] };
    const { snapshotId } = await new SyncService(repo).importSnapshot({
      schemaVersion: 1, sourceId: "jsb-report", exportedAt: "2026-11-12T08:00:00+08:00",
      isFullSnapshot: true, records: snapshot1().slice(0, 6),
    });
    const order = { orderBy: "reviewCountDesc", limit: 2 } as const;
    const first = await repo.query(snapshotId, order, scope);
    assert.ok(first.nextCursor);
    assert.equal(first.records[0]?.verifiedReviewCount, 1);
    const second = await repo.query(snapshotId, { ...order, cursor: first.nextCursor }, scope);
    assert.equal(second.records[0]?.recordId, snapshot1()[2]?.recordId);
    assert.deepEqual(first.reviewCoverage, { matchingRecords: 6, recordsWithHistory: 6 });

    const activity = await repo.report(snapshotId, { report: "reviewActivity" }, scope);
    assert.equal(activity.report, "reviewActivity");
    assert.equal(activity.verifiedReviewCount, 6);
    assert.equal(activity.reviewedRecordCount, 6);
    const reasons = await repo.report(snapshotId, { report: "errorReasons" }, scope);
    assert.equal(reasons.report, "errorReasons");
    assert.equal(reasons.matchingRecords, 6);
    assert.equal(reasons.reasons[0]?.recordCount, 4);
  });

  test("SessionStore 契约在 JsbSqliteDriver 上通过", async () => {
    const driver = new JsbSqliteDriver(new MockJsbBridge());
    const store = new SqliteSessionStore(driver);
    const id = "jsb-session-1";
    await store.create({
      id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: { notebookIds: [] },
      status: "active",
    });
    await store.append(id, { type: "user", id: "m1", text: "你好", createdAt: new Date().toISOString() });
    const loaded = await store.get(id);
    assert.equal(loaded?.messages.length, 1);
    assert.equal(loaded?.messages[0]?.type, "user");
    await store.setStatus(id, "completed");
    assert.equal((await store.get(id))?.status, "completed");
    assert.equal(await store.get("missing"), null);
    await assert.rejects(() => store.append("missing", { type: "user", id: "x", text: "y", createdAt: new Date().toISOString() }));
  });

  test("快照导入与统计走同一仓储实现（数值列归一化）", async () => {
    const driver = new JsbSqliteDriver(new MockJsbBridge());
    const repository = new SqliteMistakeRepository(driver);
    const result = await repository.applySnapshot({
      snapshotId: "jsb-fixture",
      sourceId: "fixture",
      exportedAt: "2026-11-12T08:00:00+08:00",
      isFullSnapshot: true,
      records: snapshot1().map((r) => ({
        recordId: r.recordId,
        sourceNotebookId: r.sourceNotebookId,
        sourceNoteId: r.sourceNoteId,
        sourceAvailable: r.sourceAvailable ?? true,
        sourceTitle: r.sourceTitle ?? "",
        sourceNotebookTitle: r.sourceNotebookTitle ?? "",
        sourcePathTitles: r.sourcePathTitles ?? [],
        categoryPath: r.categoryPath ?? [],
        manualCategories: r.manualCategories ?? [],
        reasonTags: r.reasonTags ?? [],
        favorite: r.favorite ?? false,
        errorReasons: r.errorReasons ?? [],
        level: r.level ?? "unknown",
        reviewCount: r.reviewCount ?? 0,
        reviewCompleted: r.reviewCompleted ?? false,
        nextReviewAt: r.nextReviewAt,
        lastReviewedAt: r.lastReviewedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        reviewEvents: (r.history ?? []).map((h) => ({ at: h.at, level: h.level as 0 | 1 | 2 | "unknown", errorReason: h.errorReason })),
      })) as never,
    });
    assert.equal(result.inserted, 100);
    const stats = await repository.getStats({}, { notebookIds: [] }, "2026-11-12T16:00:00.000Z");
    assert.equal(stats.totalMistakes, 100);
    assert.equal(stats.dueCount, 23);
    assert.equal(stats.reviewedCount, 55);
    assert.equal(stats.availableRecords, 97);
    assert.equal(stats.currentLevelReviewCountSum, 90);
    assert.equal(stats.totalReviewActions, 90);
    const page = await repository.query({ limit: 5 }, { notebookIds: [] });
    assert.equal(page.records.length, 5);
    const detail = await repository.getById("bookA0000000000000000000000000001:noteA001", { notebookIds: [] });
    assert.ok(detail);
    assert.equal(detail?.level, 0);
    assert.equal(detail?.favorite, true);
    assert.equal(detail?.reviewCompleted, false);
  });

  test("事务与回滚（T27 前提能力）", async () => {
    const driver = new JsbSqliteDriver(new MockJsbBridge());
    driver.exec("CREATE TABLE t_probe(a TEXT)");
    assert.throws(() =>
      driver.transaction(() => {
        driver.exec("INSERT INTO t_probe(a) VALUES('x')");
        throw new Error("boom");
      }),
    );
    assert.equal(driver.rows("SELECT COUNT(*) AS n FROM t_probe")[0]?.n, 0);
    driver.transaction(() => {
      driver.exec("INSERT INTO t_probe(a) VALUES('y')");
    });
    assert.equal(driver.rows("SELECT COUNT(*) AS n FROM t_probe")[0]?.n, 1);
  });
});
