import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { loadConfig } from "../../src/config.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { createHarnessApp } from "../../src/bootstrap.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";

/**
 * 活体模型冒烟（env 门控）：H1_LIVE_MODEL=1 且配置 .env 后运行。
 * 2026-11-12 首次运行：网关鉴权通过但上游 429（余额不足）——见任务记录。
 */
describe("P3: 活体模型冒烟（门控）", () => {
  const live = process.env.H1_LIVE_MODEL === "1" && !!process.env.H1_MODEL_API_KEY && !!process.env.H1_MODEL_BASE_URL;
  const options = { skip: live ? false : "未启用 H1_LIVE_MODEL=1，跳过活体冒烟" as const };

  test("真机模型完整一轮问答", { skip: live ? false : "未启用 H1_LIVE_MODEL=1，跳过活体冒烟" as const }, async () => {
    const config = loadConfig(process.env);
    const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
    const session = await app.service.createSession({ notebookIds: [] });
    const result = await app.service.sendMessage(session.id, `live-${Date.now()}`, "直接回答：1+1 等于几？不要调用工具。");
    assert.equal(result.status, "completed", `活体调用失败: ${JSON.stringify(result.error ?? result)}`);
    assert.ok(result.message && result.message.length > 0);
    void FakeModelClient;
    void options;
  });
});
