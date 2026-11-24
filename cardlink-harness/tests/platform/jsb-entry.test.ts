import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { createHarness } from "../../src/jsb-entry.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import type { JsbSQLiteDatabase, JsbResultSet, JsbValue } from "../../src/adapters/jsb/jsb-sqlite.ts";

/**
 * P4-0 集成验收（GPT 建议表「JSB Bundle 装载」开发机等价）：
 * jsb-entry 装配链 JsbSqliteDriver → migrate → createHarnessApp → 命令桥
 * 在 mock 桥上跑通 harness.health（真机装载属 P5）。
 */

/** 内存 mock JSB 桥：与 T27 同策略，表存行数组，支持参数化查询子集。 */
function mockBridge(): JsbSQLiteDatabase {
  const tables = new Map<string, Array<Record<string, JsbValue>>>();
  let seq = 0;
  const api = {
    open: () => true,
    close: () => true,
    executeUpdateWithArgumentsInArray(sql: string, args?: JsbValue[]) {
      const lower = sql.trim().toUpperCase();
      const createMatch = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(sql.trim());
      if (createMatch) {
        if (!tables.has(createMatch[1]!)) tables.set(createMatch[1]!, []);
        return true;
      }
      const tableMatch = /(?:INSERT(?:\s+OR\s+IGNORE| OR REPLACE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i.exec(sql.trim());
      if (!tableMatch) return true; // PRAGMA 等
      const table = tables.get(tableMatch[1]!) ?? [];
      tables.set(tableMatch[1]!, table);
      if (lower.startsWith("INSERT")) {
        table.push({ __row: JSON.stringify({ sql, args: args ?? [] }), __seq: String(++seq) });
        return true;
      }
      return true; // UPDATE/DELETE 在健康检查路径不出现
    },
    executeQueryWithArgumentsInArray(sql: string): JsbResultSet | null {
      const match = /FROM\s+(\w+)/i.exec(sql);
      const table = match ? (tables.get(match[1]!) ?? []) : [];
      const rows = [...table];
      let cursor = 0;
      return {
        columnCount: () => (rows.length ? 2 : 0),
        columnNameForIndex: (i: number) => (i === 0 ? "__row" : "__seq"),
        stringForColumnIndex: (i: number) => {
          const row = rows[cursor];
          if (!row) return null;
          return i === 0 ? (row.__row as string) : (row.__seq as string);
        },
        next: () => (cursor < rows.length ? ++cursor > 0 : false),
        close: () => true,
      };
    },
  };
  return api as unknown as JsbSQLiteDatabase;
}

describe("P4-0: JSB 入口装配", () => {
  test("createHarness 在 mock 桥上完成迁移并通过 harness.health", async () => {
    const model = new FakeModelClient();
    const instance = createHarness(mockBridge(), undefined, { model });
    const health = await instance.handle("harness.health");
    assert.equal(health.ok, true, JSON.stringify(health));
    // 命令面可用：会话创建走通（JsbSqliteDriver 持久化语义由 T27 覆盖）
    const session = await instance.handle("harness.createSession", { notebookIds: [] });
    assert.equal(session.ok, true, JSON.stringify(session));
  });
});
