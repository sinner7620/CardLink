import { loadConfig } from "../../src/config.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { newMessageId, type ToolCall } from "../../src/domain/message.ts";

/** 测试专用：:memory: 数据库 + 测试模型配置的 Harness 应用。 */
export function makeApp(): HarnessApp {
  const config = loadConfig({
    H1_MODEL_BASE_URL: "http://127.0.0.1:1/v1",
    H1_MODEL_API_KEY: "test-key",
    H1_MODEL_NAME: "test-model",
    H1_HTTP_TOKEN: "test-token",
    H1_DB_PATH: ":memory:",
  });
  return createHarnessApp(config, { driver: openDatabase(config.storage.database) });
}

export function makeToolCall(name: string, args: unknown): ToolCall {
  return { id: newMessageId(), name, arguments: args };
}

export { loadConfig };
