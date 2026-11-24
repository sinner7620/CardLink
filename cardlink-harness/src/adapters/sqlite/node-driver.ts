import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NodeSqliteDriver, type SqlDriver } from "./driver.ts";
import { migrate } from "./db.ts";

export type { SqlDriver } from "./driver.ts";
export { NodeSqliteDriver } from "./driver.ts";

/**
 * 开发/回归驱动（node:sqlite）——仅限桌面 CLI/HTTP/测试使用，不进入 JSB 打包图。
 * 设备形态用 adapters/jsb 的 JsbSqliteDriver（真机行为属 P0 门禁）。
 */
export function openDatabase(path: string, migrationTarget?: number): SqlDriver {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const driver = new NodeSqliteDriver(new DatabaseSync(path));
  driver.exec("PRAGMA journal_mode=WAL");
  driver.exec("PRAGMA foreign_keys=ON");
  driver.exec("PRAGMA busy_timeout=1000");
  migrate(driver, migrationTarget);
  return driver;
}
