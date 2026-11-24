import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { loadConfig } from "../../src/config.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { createBridgeHandler, HARNESS_COMMANDS, type BridgeResult } from "../../src/adapters/bridge/commands.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

let app: HarnessApp;
let handler: (name: string, data?: unknown) => Promise<BridgeResult>;
let model: FakeModelClient;

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }> = []): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

before(async () => {
  model = new FakeModelClient();
  model.behavior = (ctx) => {
    if (ctx.outputType.name === "assistant_message") {
      const hasToolResult = ctx.messages.some((m) => m.type === "tool_result");
      return hasToolResult
        ? { text: "统计完成：共 100 道错题。", toolCalls: [] }
        : { text: "查统计", toolCalls: [{ id: `bridge-call-${model.calls.length}`, name: "getMistakeStats", arguments: {} }] };
    }
    return { approved: true, reason: "ok" };
  };
  const config = loadConfig({
    H1_MODEL_BASE_URL: "http://127.0.0.1:1/v1",
    H1_MODEL_API_KEY: "unused-desktop-key",
    H1_MODEL_NAME: "test-model",
    H1_HTTP_TOKEN: "t",
    H1_DB_PATH: ":memory:",
  });
  app = createHarnessApp(config, { driver: openDatabase(config.storage.database), model });
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "bridge-session-fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
  handler = createBridgeHandler({
    service: app.service,
    repository: app.repository,
    syncService: app.syncService,
    statisticsEngine: app.statisticsEngine,
    runStore: app.runStore,
  });
});

async function waitForFinished(runId: string, timeoutMs = 5000): Promise<{ status: string; data: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await handler("harness.getRunStatus", { runId });
    const data = res.data as { status: string; result?: unknown; sessionId?: string };
    if (data.status !== "active") return { status: data.status, data };
    if (Date.now() > deadline) throw new Error(`等待运行结束超时: ${JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("P0（v2.4 §13.1）：会话管理桥命令", () => {
  test("B0: 白名单新增 v2.4 命令", () => {
    for (const name of ["harness.deleteSession", "harness.purgeSession", "harness.renameSession", "harness.continueRun", "harness.resolveRecordTitles"]) {
      assert.ok((HARNESS_COMMANDS as readonly string[]).includes(name), `${name} 不在白名单`);
    }
  });

  test("B7: exportSession——format 校验与导出内容（BRIDGE-03）", async () => {
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const bad = await handler("harness.exportSession", { sessionId, format: "json" });
    assert.equal(bad.ok, false);
    assert.equal((bad.error as { code: string }).code, "invalid_args");
    const ok = await handler("harness.exportSession", { sessionId, format: "markdown" });
    assert.equal(ok.ok, true);
    assert.match((ok.data as { markdown: string }).markdown, /# CardLink AI 分析会话/);
    assert.match((ok.data as { filename: string }).filename, /\.md$/);
  });

  test("B6: resolveRecordTitles——recordId → 真实标题/等级；未知记录 available:false", async () => {
    const result = await handler("harness.resolveRecordTitles", {
      recordIds: ["bookA0000000000000000000000000001:noteA010", "bookZ0000000000000000000000000099:noteFAKE"],
    });
    assert.equal(result.ok, true);
    const titles = result.data as Record<string, { available: boolean; title?: string; level?: number | null }>;
    assert.equal(titles["bookA0000000000000000000000000001:noteA010"].available, true);
    assert.match(titles["bookA0000000000000000000000000001:noteA010"].title ?? "", /错题/);
    assert.equal(titles["bookZ0000000000000000000000000099:noteFAKE"].available, false);
  });

  test("B1: getRunStatus 返回 sessionId 绑定", async () => {
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const started = await handler("harness.startRun", { sessionId, requestId: `req-b1-${Date.now()}`, text: "统计如何？" });
    const runId = (started.data as { runId: string }).runId;
    const finished = await waitForFinished(runId);
    assert.equal(finished.data.sessionId, sessionId);
    assert.equal(finished.status, "finished");
  });

  test("B2: renameSession + listSessions(summaries+query)", async () => {
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const renamed = await handler("harness.renameSession", { sessionId, title: "桥测试会话" });
    assert.equal(renamed.ok, true);

    const listed = await handler("harness.listSessions", { limit: 50, query: "桥测试" });
    assert.equal(listed.ok, true);
    const summaries = listed.data as Array<{ id: string; title?: string; messageCount?: number }>;
    assert.ok(summaries.some((s) => s.id === sessionId && s.title === "桥测试会话"));
    assert.ok(!("messages" in (summaries[0] ?? {})));

    const miss = await handler("harness.listSessions", { limit: 50, query: "不可能匹配xyz" });
    assert.deepEqual(miss.data, []);

    const bad = await handler("harness.renameSession", { sessionId, title: "   " });
    assert.equal(bad.ok, false);
  });

  test("B3: deleteSession 软删除；运行中默认拒绝、force 先取消", async () => {
    // 3a: 空闲会话直接删除
    const idle = await handler("harness.createSession", {});
    const idleId = (idle.data as { sessionId: string }).sessionId;
    const del = await handler("harness.deleteSession", { sessionId: idleId });
    assert.equal(del.ok, true);
    const listed = await handler("harness.listSessions", { limit: 50 });
    assert.ok(!(listed.data as Array<{ id: string }>).some((s) => s.id === idleId));

    // 3b: 运行中会话——默认拒绝并列 runId
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    // 挂起模型：首次 assistant 调用挂 120ms，使 run 处于 active
    const originalBehavior = model.behavior;
    model.behavior = async (ctx) => {
      await new Promise((r) => setTimeout(r, 120));
      return originalBehavior?.(ctx, 0);
    };
    const started = await handler("harness.startRun", { sessionId, requestId: `req-b3-${Date.now()}`, text: "慢慢统计" });
    const runId = (started.data as { runId: string }).runId;
    // 等运行真正进入 assistant_pending（模型调用挂起中）再触发删除，保证取消检查点语义可验证
    const deadlineB3 = Date.now() + 3000;
    for (;;) {
      const status = await handler("harness.getRunStatus", { runId });
      if ((status.data as { phase?: string }).phase === "assistant_pending") break;
      if (Date.now() > deadlineB3) throw new Error("等待 assistant_pending 超时");
      await new Promise((r) => setTimeout(r, 10));
    }
    const refused = await handler("harness.deleteSession", { sessionId });
    assert.equal(refused.ok, false);
    assert.equal((refused.error as { code: string }).code, "session_running");

    // force：先取消再删除
    const forced = await handler("harness.deleteSession", { sessionId, force: true });
    assert.equal(forced.ok, true);
    const finished = await waitForFinished(runId);
    assert.equal(finished.status, "cancelled");
    const after = await handler("harness.listSessions", { limit: 50 });
    assert.ok(!(after.data as Array<{ id: string }>).some((s) => s.id === sessionId));
    // 重建 behavior
    model.behavior = originalBehavior;
  });

  test("B8: purgeSession 彻底删除；运行中默认拒绝、force 先取消再清除", async () => {
    // 8a: 空闲会话 → 物理清除，getSession 返回 null
    const idle = await handler("harness.createSession", {});
    const idleId = (idle.data as { sessionId: string }).sessionId;
    const purged = await handler("harness.purgeSession", { sessionId: idleId });
    assert.equal(purged.ok, true);
    assert.equal(await app.service.getSession(idleId), null);
    assert.equal(app.db.rows("SELECT 1 FROM sessions WHERE session_id = ?", [idleId]).length, 0);
    assert.equal(app.db.rows("SELECT 1 FROM session_events WHERE session_id = ?", [idleId]).length, 0);

    // 8b: 运行中 → 默认拒绝；force 先取消并清除
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const originalBehavior = model.behavior;
    model.behavior = async (ctx) => {
      await new Promise((r) => setTimeout(r, 120));
      return originalBehavior?.(ctx, 0);
    };
    const started = await handler("harness.startRun", { sessionId, requestId: `req-b8-${Date.now()}`, text: "慢慢统计" });
    const runId = (started.data as { runId: string }).runId;
    const refused = await handler("harness.purgeSession", { sessionId });
    assert.equal(refused.ok, false);
    assert.equal((refused.error as { code: string }).code, "session_running");

    const forced = await handler("harness.purgeSession", { sessionId, force: true });
    assert.equal(forced.ok, true);
    const finished = await waitForFinished(runId);
    assert.equal(finished.status, "cancelled");
    assert.equal(await app.service.getSession(sessionId), null);
    // 幂等：再次彻底删除仍成功
    const again = await handler("harness.purgeSession", { sessionId });
    assert.equal(again.ok, true);
    model.behavior = originalBehavior;
  });

  test("B4: continueRun 桥命令——迭代上限后续答完成", async () => {
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    // 第一轮：模型持续请求工具直到迭代上限（behavior 每轮返回带工具输出）
    const originalBehavior = model.behavior;
    model.behavior = (ctx) => {
      if (ctx.outputType.name !== "assistant_message") return { approved: true, reason: "ok" };
      return { text: "", toolCalls: [{ id: `loop-${model.calls.length}`, name: "getMistakeStats", arguments: {} }] };
    };
    const first = await handler("harness.startRun", { sessionId, requestId: `req-b4-${Date.now()}`, text: "统计" });
    const firstRunId = (first.data as { runId: string }).runId;
    const firstFinished = await waitForFinished(firstRunId);
    const firstResult = firstFinished.data.result as { status: string; finishReason?: string } | undefined;
    assert.equal(firstResult?.status, "limit_reached");
    assert.equal(firstResult?.finishReason, "iteration_limit");

    // 续答：恢复正常 behavior（有工具结果后给最终回答）
    model.behavior = originalBehavior;
    const cont = await handler("harness.continueRun", { sessionId, requestId: `req-b4-cont-${Date.now()}` });
    assert.equal(cont.ok, true);
    const contRunId = (cont.data as { runId: string }).runId;
    const contFinished = await waitForFinished(contRunId);
    assert.equal(contFinished.status, "finished");
    const contResult = contFinished.data.result as { status: string; message?: string } | undefined;
    assert.equal(contResult?.status, "completed");
    assert.ok(contResult?.message?.includes("统计完成"));
  });

  test("B5: getRunStatus 内存未命中时从 runs.result_json 兜底（重启语义）", async () => {
    const created = await handler("harness.createSession", {});
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const started = await handler("harness.startRun", { sessionId, requestId: `req-b5-${Date.now()}`, text: "统计如何？" });
    const runId = (started.data as { runId: string }).runId;
    await waitForFinished(runId);

    // 新建 handler（内存 Map 清空）——模拟进程重启
    const fresh = createBridgeHandler({
      service: app.service,
      repository: app.repository,
      runStore: app.runStore,
    });
    const status = await fresh("harness.getRunStatus", { runId });
    assert.equal(status.ok, true);
    const data = status.data as { status: string; result?: { status?: string }; sessionId?: string };
    assert.equal(data.status, "finished");
    assert.equal(data.sessionId, sessionId);
    assert.equal(data.result?.status, "completed");
  });
});
