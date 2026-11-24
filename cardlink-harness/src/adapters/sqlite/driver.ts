import { DatabaseSync } from "node:sqlite";

/** SQL 值与行类型：JSB 桥返回字符串，驱动层负责按列名归一化数值。 */
export type SqlValue = string | number | bigint | null;
export type SqlRow = Record<string, SqlValue>;

/**
 * 最小 SQL 驱动抽象（§4：同核异适配器）。
 * node:sqlite（开发/回归）与 JSB SQLiteDatabase（设备）各自实现；
 * 仓储/存储层只依赖本接口。exec 为单条或多条（驱动负责拆分）写语句；
 * rows 为查询并返回归一化后的行。
 */
export interface SqlDriver {
  exec(sql: string, args?: SqlValue[]): void;
  rows(sql: string, args?: SqlValue[]): SqlRow[];
  /** 事务：BEGIN IMMEDIATE / COMMIT / ROLLBACK。 */
  transaction<T>(fn: () => T): T;
  /** 可选：关闭底层连接（CLI init-db 等使用）。 */
  close?(): void;
}

/** 桌面/回归驱动：包装 node:sqlite DatabaseSync。 */
export class NodeSqliteDriver implements SqlDriver {
  constructor(public readonly db: DatabaseSync) {}

  exec(sql: string, args: SqlValue[] = []): void {
    if (args.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.prepare(sql).run(...(args as never[]));
  }

  rows(sql: string, args: SqlValue[] = []): SqlRow[] {
    return this.db.prepare(sql).all(...(args as never[])) as SqlRow[];
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
