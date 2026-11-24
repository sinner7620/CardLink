import type { SqlDriver, SqlRow, SqlValue } from "../sqlite/driver.ts";

/**
 * JSB SQLiteDatabase 驱动（设备形态，§3/§4）。
 * 对接 MarginNote 宿主暴露的 SQLiteDatabase 桥——方法面与插件内
 * `src/ocr-native.ts` 的 openNativeSQL 完全一致（数组参数绑定，禁止可变参数）。
 * 真机行为属 P0 门禁（§17）；本驱动在开发机用 mock 桥做协议级契约测试（T27）。
 */
export interface JsbResultSet {
  columnCount(): number | undefined;
  columnNameForIndex(i: number): string | undefined;
  stringForColumnIndex(i: number): string | null | undefined;
  next(): boolean | undefined;
  close(): boolean | undefined;
}

export interface JsbSQLiteDatabase {
  open(): boolean | undefined;
  close(): boolean | undefined;
  executeUpdateWithArgumentsInArray(sql: string, args?: JsbValue[]): boolean | undefined;
  executeQueryWithArgumentsInArray(sql: string, args?: JsbValue[]): JsbResultSet | null | undefined;
}

export type JsbValue = string | number | null;

/** 与 ocr-native 同策略：按列名归一化数值，其余为字符串。 */
const NUMERIC_COLUMNS = new Set([
  "sequence_no", "reviewer_approved", "favorite", "review_completed", "review_count",
  "source_available", "missing_in_latest", "level", "n", "count", "total", "v",
  "is_full_snapshot", "record_count", "version",
  "sort_key", "verified_review_count", "matchingRecords", "recordsWithHistory",
  "recordCount", "recordsWithErrorReasons", "verifiedReviewCount", "reviewedRecordCount",
]);

export function isJsbNull(v: unknown): boolean {
  return v === null || v === undefined || String(v) === "<NSNull>" || String(v) === "(null)";
}

export class JsbSqliteDriver implements SqlDriver {
  constructor(private readonly bridge: JsbSQLiteDatabase) {
    if (typeof bridge.open !== "function") throw new Error("JSB SQLiteDatabase 桥缺少 open()");
    if (bridge.open() === false) throw new Error("JSB SQLite 数据库无法打开");
  }

  exec(sql: string, args: SqlValue[] = []): void {
    const statements = splitStatements(sql);
    for (const statement of statements) {
      const ok = this.bridge.executeUpdateWithArgumentsInArray(statement, args.length ? toJsbArgs(args) : undefined);
      if (ok === false) throw new Error(`JSB SQLite 写入失败: ${statement.slice(0, 80)}`);
    }
  }

  rows(sql: string, args: SqlValue[] = []): SqlRow[] {
    const rs = this.bridge.executeQueryWithArgumentsInArray(sql, args.length ? toJsbArgs(args) : undefined);
    if (!rs) return [];
    const out: SqlRow[] = [];
    try {
      const count = Number(typeof rs.columnCount === "function" ? rs.columnCount() : rs.columnCount);
      if (!Number.isInteger(count)) throw new Error("JSB SQLite 结果集列数不可用");
      while (rs.next()) {
        const row: SqlRow = {};
        for (let i = 0; i < count; i++) {
          const key = String(rs.columnNameForIndex(i));
          const raw = rs.stringForColumnIndex(i);
          row[key] = isJsbNull(raw) ? null : NUMERIC_COLUMNS.has(key) ? Number(raw) : String(raw);
        }
        out.push(row);
      }
    } finally {
      rs.close();
    }
    return out;
  }

  transaction<T>(fn: () => T): T {
    if (this.bridge.executeUpdateWithArgumentsInArray("BEGIN IMMEDIATE") === false) {
      throw new Error("JSB SQLite 开启事务失败");
    }
    try {
      const result = fn();
      if (this.bridge.executeUpdateWithArgumentsInArray("COMMIT") === false) throw new Error("JSB SQLite 提交失败");
      return result;
    } catch (error) {
      this.bridge.executeUpdateWithArgumentsInArray("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (this.bridge.close() === false) throw new Error("JSB SQLite 关闭失败");
  }
}

function toJsbArgs(args: SqlValue[]): JsbValue[] {
  return args.map((v) => (v === null || v === undefined ? null : typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : String(v)));
}

/** JSB 桥一次只接受一条语句；按行尾分号拆分（schema 无触发器/存储过程）。 */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
