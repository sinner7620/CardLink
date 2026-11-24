/**
 * JSB 入口（P4-0，§3/§4）：随 .mnaddon 分发的 HarnessCore 产物唯一入口。
 * 约束：本文件及其依赖图不得引用 node:crypto/node:sqlite/node:fs/Buffer/process/动态 import
 * ——打包门禁（scripts/build-jsb.mjs）强制扫描，禁止用 external 掩盖。
 *
 * 设备装配路径：main.js 读到 SQLiteDatabase 桥 → JsbSqliteDriver → migrate →
 * createHarnessApp({driver}) → createBridgeHandler（15 条白名单命令）。
 * 模型客户端由宿主注入（设备为 JSB HTTPS 传输形态，P4-2 接入）；缺省 fetch 客户端。
 */
import { JsbSqliteDriver, type JsbSQLiteDatabase, type JsbValue } from "./adapters/jsb/jsb-sqlite.ts";
import { migrate } from "./adapters/sqlite/db.ts";
import { createHarnessApp, type HarnessApp } from "./bootstrap.ts";
import { createBridgeHandler, InMemoryRoleConfigStore, type BridgeResult, type RoleConfigStore } from "./adapters/bridge/commands.ts";
import { InMemoryCredentialStore, InMemoryProviderConfigStore, type ModelCredentialStore, type ProviderConfigStore } from "./application/ports/provider-store.ts";
import type { ModelClient } from "./application/ports/model-client.ts";
import { loadConfig } from "./config.ts";
import { installAbortControllerPolyfill } from "./platform/abort.ts";

installAbortControllerPolyfill();

export type HarnessJsbOptions = {
  /** 设备配置（H1_DB_PATH 等环境变量的设备等价物）；未提供的键用安全默认值。 */
  config?: Partial<{
    databaseLabel: string;
    httpToken: string;
    modelBaseUrl: string;
    modelApiKey: string;
    modelName: string;
  }>;
  /** 设备模型客户端注入点（P4-2 接 JSB HTTPS 传输）；缺省 fetch 兼容客户端。 */
  model?: ModelClient;
};

export type CardLinkHarnessInstance = {
  /** v2.1 §13 白名单命令分发（WebView 经命令桥调用）。 */
  handle(command: string, data?: unknown): Promise<BridgeResult>;
  app: HarnessApp;
};

export function createHarness(
  sqliteBridge: JsbSQLiteDatabase,
  roleConfigStore?: RoleConfigStore,
  options: HarnessJsbOptions = {},
): CardLinkHarnessInstance {
  const driver = new JsbSqliteDriver(sqliteBridge);
  migrate(driver);
  const config = loadConfig({
    H1_HTTP_TOKEN: options.config?.httpToken ?? "",
    H1_DB_PATH: ":memory:", // driver 已注入，占位不使用
    H1_MODEL_BASE_URL: options.config?.modelBaseUrl ?? "",
    H1_MODEL_API_KEY: options.config?.modelApiKey ?? "",
    H1_MODEL_NAME: options.config?.modelName ?? "",
  }, false);
  const app = createHarnessApp(config, { driver, model: options.model });
  const handler = createBridgeHandler({
    service: app.service,
    repository: app.repository,
    syncService: app.syncService,
    statisticsEngine: app.statisticsEngine,
    runStore: app.runStore,
    evidenceStore: app.evidenceStore,
    providers: new InMemoryProviderConfigStore(),
    credentials: new InMemoryCredentialStore(),
    roles: roleConfigStore ?? new InMemoryRoleConfigStore(),
    capabilities: app.capabilities,
    compactions: app.compactions,
    telemetry: app.telemetry,
  });
  return { handle: (command, data) => handler(command, data), app };
}

export type { JsbSQLiteDatabase, JsbValue };

// JSB 装载：脚本在宿主全局作用域执行，显式挂载保证 JSB.require 后可访问（P4-0 门禁检查项）。
(globalThis as Record<string, unknown>).CardLinkHarness = { createHarness };
