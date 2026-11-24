import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { createBridgeHandler } from "../../src/adapters/bridge/commands.ts";
import { ProviderRouterModelClient } from "../../src/adapters/model/provider-router.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { InMemoryCredentialStore, InMemoryProviderConfigStore } from "../../src/application/ports/provider-store.ts";
import { InMemoryRoleConfigStore } from "../../src/application/ports/role-config-store.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";
import type { BridgeResult } from "../../src/adapters/bridge/commands.ts";

/**
 * P4-2 集成验收（GPT 表「真实 Agent 闭环」开发机等价）：
 * 设置命令（Provider/密钥/角色）→ 快照导入 → 会话 → startRun → 轮询 getRunStatus
 * → finished（Assistant→Reviewer→getMistakeStats→Assistant）→ 证据回溯 → 会话持久化。
 * 模型经 ProviderRouter（设备上协议客户端走 ocrHTTP 传输，此处注入 Fake）。
 */

function makeStack() {
  const driver = openDatabase(":memory:");
  const providers = new InMemoryProviderConfigStore();
  const credentials = new InMemoryCredentialStore();
  const roles = new InMemoryRoleConfigStore();
  const model = new FakeModelClient();
  const app: HarnessApp = createHarnessApp(
    {
      bind: "127.0.0.1", port: 0, httpToken: "t",
      model: { provider: "openai-compatible", baseUrl: "https://unused/v1", apiKey: "unused", name: "unused", reviewerName: "", effortAssistant: "medium", effortReviewer: "low", timeoutMs: 3000, maxOutputTokens: 1024, providerId: "p1", credentialRef: "k1" },
      storage: { database: ":memory:" },
      limits: { maxIterations: 4, maxToolCallsPerTurn: 8, toolTimeoutMs: 3000, contextBudgetChars: 0 },
    },
    {
      driver,
      model: new ProviderRouterModelClient({ providers, credentials, createProtocolClient: () => model }),
      roleConfigStore: roles,
    },
  );
  const handler = createBridgeHandler({
    service: app.service,
    repository: app.repository,
    syncService: app.syncService,
    statisticsEngine: app.statisticsEngine,
    runStore: app.runStore,
    evidenceStore: app.evidenceStore,
    providers,
    credentials,
    roles,
    createProtocolClient: () => model,
  });
  return { app, handler, model, roles };
}

async function pollRunStatus(handler: (n: string, d?: unknown) => Promise<BridgeResult>, runId: string, attempts = 50): Promise<Record<string, unknown>> {
  for (let i = 0; i < attempts; i++) {
    const status = await handler("harness.getRunStatus", { runId });
    const data = status.data as { status?: string };
    if (data?.status && data.status !== "active") return status.data as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("getRunStatus 轮询超时");
}

describe("P4-2: 真实 Agent 闭环（桥命令序列）", () => {
  test("Provider 配置 → 快照导入 → startRun → finished，证据/审计/会话全贯通", async () => {
    const { handler, model } = makeStack();

    // ① 设备设置序列（设置页将调用的同一批命令）
    const provider = await handler("harness.setProviderConfig", {
      config: { id: "p1", protocol: "openai-compatible", baseUrl: "https://llm.example/v1", credentialRef: "k1", enabled: true },
    });
    assert.equal(provider.ok, true, JSON.stringify(provider));
    const cred = await handler("harness.setCredential", { credentialRef: "k1", apiKey: "sk-test" });
    assert.equal(cred.ok, true);
    const role = await handler("harness.setModelRoleConfig", {
      role: "assistant", providerId: "p1", model: "role-model", credentialRef: "k1", timeoutMs: 3000, maxOutputTokens: 1024,
    });
    assert.equal(role.ok, true);

    // ② 快照导入（插件 JSB 侧构建的同形态契约载荷）
    const imported = await handler("harness.importSnapshot", {
      schemaVersion: 1, sourceId: "e2e", exportedAt: "2026-11-14T08:00:00+08:00", isFullSnapshot: true, records: snapshot1(),
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));

    // ③ 会话 + 运行
    const session = await handler("harness.createSession", { notebookIds: [] });
    assert.equal(session.ok, true);
    const sessionId = (session.data as { sessionId: string }).sessionId;

    model.enqueueMany([
      { text: "查统计", toolCalls: [{ id: "e2e-call-1", name: "getMistakeStats", arguments: {} }] },
      { approved: true, reason: "ok" },
      { text: "统计完成：共 100 条错题。", toolCalls: [] },
    ]);
    const started = await handler("harness.startRun", { sessionId, text: "我的错题情况如何？", requestId: "req-e2e-1" });
    assert.equal(started.ok, true, JSON.stringify(started));
    const runId = (started.data as { runId: string }).runId;
    assert.ok(runId);

    // ④ 轮询到终态（UI 将使用的同一轮询语义）
    const status = await pollRunStatus(handler, runId);
    assert.equal(status.status, "finished", JSON.stringify(status));
    const result = status.result as { status: string; message?: string };
    assert.equal(result.status, "completed");
    assert.match(result.message ?? "", /统计完成/);

    // ⑤ 工具调用记录（getRunStatus.toolCalls）
    const toolCalls = status.toolCalls as Array<{ toolName: string; executionStatus: string; evidenceJson?: string }>;
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]!.toolName, "getMistakeStats");
    assert.equal(toolCalls[0]!.executionStatus, "executed");
    const evidenceId = (JSON.parse(toolCalls[0]!.evidenceJson ?? "{}") as { evidenceId?: string }).evidenceId;
    assert.ok(evidenceId, "tool_calls 携带 evidenceId");

    // ⑥ 证据回溯（证据跳转 UI 数据源）
    const evidence = await handler("harness.getEvidence", { evidenceId });
    assert.equal(evidence.ok, true, JSON.stringify(evidence));
    assert.equal((evidence.data as { runId: string }).runId, runId);

    // ⑦ 会话持久化（刷新后 getSession 可恢复）
    const got = await handler("harness.getSession", { sessionId });
    assert.equal(got.ok, true);
    const messages = (got.data as { messages?: Array<{ type: string }> }).messages ?? [];
    assert.equal(messages.filter((m) => m.type === "tool_result").length, 1, "工具结果在会话流中");

    // ⑧ 角色覆盖生效：Assistant 模型调用用了角色配置的 model
    const assistantCalls = model.calls.filter((c) => c.context.outputType.name === "assistant_message");
    assert.ok(assistantCalls.length >= 1);
    assert.equal(assistantCalls[0]!.setting.model, "role-model", "角色配置覆盖默认模型");
    assert.equal(assistantCalls[0]!.setting.providerId, "p1");

    // ⑨ testModelProvider 用配置的模型名探测（b9 修正：不再传占位名 "probe"）
    model.enqueueMany([{ ok: true }]);
    const probe = await handler("harness.testModelProvider", { providerId: "p1", role: "assistant" });
    assert.equal(probe.ok, true, JSON.stringify(probe));
    assert.equal((probe.data as { model?: string }).model, "role-model");
    const probeCall = model.calls[model.calls.length - 1]!;
    assert.equal(probeCall.setting.model, "role-model", "探测请求使用角色配置的模型名");
  });

  test("testModelProvider 未配置模型名时显式报错（b9）", async () => {
    const driver = openDatabase(":memory:");
    const providers = new InMemoryProviderConfigStore();
    const credentials = new InMemoryCredentialStore();
    const model = new FakeModelClient();
    const app = createHarnessApp(
      { bind: "127.0.0.1", port: 0, httpToken: "t",
        model: { provider: "openai-compatible", baseUrl: "https://unused/v1", apiKey: "unused", name: "unused", reviewerName: "", effortAssistant: "medium", effortReviewer: "low", timeoutMs: 3000, maxOutputTokens: 1024, providerId: "p1", credentialRef: "k1" },
        storage: { database: ":memory:" },
        limits: { maxIterations: 4, maxToolCallsPerTurn: 8, toolTimeoutMs: 3000, contextBudgetChars: 0 } },
      { driver, model, roleConfigStore: new InMemoryRoleConfigStore() },
    );
    const handler = createBridgeHandler({ service: app.service, repository: app.repository, providers, credentials });
    await handler("harness.setProviderConfig", { config: { id: "p1", protocol: "openai-compatible", baseUrl: "https://x/v1", credentialRef: "k1", enabled: true } });
    await handler("harness.setCredential", { credentialRef: "k1", apiKey: "sk-x" });
    const probe = await handler("harness.testModelProvider", { providerId: "p1", role: "assistant" });
    assert.equal(probe.ok, false);
    assert.match((probe.error as { message: string }).message, /model_missing/);
  });

  test("未配置 Provider 时 startRun 显式报错（不静默降级）", async () => {
    const { handler } = makeStack();
    const imported = await handler("harness.importSnapshot", {
      schemaVersion: 1, sourceId: "e2e", exportedAt: "2026-11-14T09:00:00+08:00", isFullSnapshot: true, records: snapshot1().slice(0, 2),
    });
    assert.equal(imported.ok, true);
    const session = await handler("harness.createSession", { notebookIds: [] });
    const sessionId = (session.data as { sessionId: string }).sessionId;
    const started = await handler("harness.startRun", { sessionId, text: "测试", requestId: "req-e2e-2" });
    assert.equal(started.ok, true);
    const runId = (started.data as { runId: string }).runId;
    const status = await pollRunStatus(handler, runId);
    assert.equal(status.status, "failed", JSON.stringify(status));
    const result = status.result as { error?: { code?: string; message?: string } };
    assert.match(result.error?.message ?? "", /provider_not_found|provider_missing/);
  });
});

test("保存连接和固定输入测试不会启用，启用失败保留两个角色，旧会话保留助手", async () => {
  const { app, handler, model, roles } = makeStack();
  try {
    async function saveConnection(baseUrl: string, apiKey: string, connectionId?: string) {
      const response = await handler("harness.saveModelConnection", { baseUrl, apiKey, connectionId });
      assert.equal(response.ok, true);
      assert.ok(!JSON.stringify(response).includes(apiKey));
      return (response.data as { connection: { id: string; baseUrl: string; credentialRef: string } }).connection;
    }

    const first = await saveConnection("https://first.example/v1", "private-first-key");
    const activate = (id: string, model: string, reviewerAuthorized: boolean) => handler("harness.activateModelRoles", {
      assistant: { providerId: id, model, authorized: true },
      reviewer: { followsAssistant: true, authorized: reviewerAuthorized },
    });
    assert.equal((await activate(first.id, "m-first", true)).ok, true);
    const oldSession = await app.service.createSession({ notebookIds: [] });

    const second = await saveConnection("https://second.example/v1", "private-second-key", first.id);
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.credentialRef, first.credentialRef);
    assert.equal(roles.get("assistant")?.providerId, first.id);
    model.enqueue({ ok: true });
    assert.equal((await handler("harness.testModelProvider", { providerId: second.id, model: "m-second" })).ok, true);
    assert.deepEqual(model.calls[0]?.context.messages.map((item) => item.type === "user" ? item.text : null), ["ping"]);
    assert.equal(roles.get("assistant")?.providerId, first.id);
    assert.equal((await activate(second.id, "m-second", false)).ok, false);
    assert.equal(roles.get("assistant")?.providerId, first.id);
    assert.equal(roles.get("reviewer")?.providerId, first.id);

    const activated = await activate(second.id, "m-second", true);
    assert.equal(activated.ok, true);
    assert.equal((activated.data as { assistantVerification: boolean }).assistantVerification, true);
    const newSession = await app.service.createSession({ notebookIds: [] });
    assert.equal((await app.service.getSession(oldSession.id))?.assistantModel?.providerId, first.id);
    assert.equal((await app.service.getSession(newSession.id))?.assistantModel?.providerId, second.id);
    const configured = await handler("harness.getModelSettings");
    const { connections } = configured.data as { connections: Array<{ id: string; baseUrl: string; keySet: boolean }> };
    assert.equal(connections.find((item) => item.id === first.id)?.baseUrl, first.baseUrl);
    assert.equal(connections.find((item) => item.id === first.id)?.keySet, true);

    const { id: rotatedId } = await saveConnection(second.baseUrl, "another-private-key", second.id);
    assert.equal(rotatedId, second.id);
    assert.equal(((await handler("harness.getModelSettings")).data as { assistantVerification: boolean | null }).assistantVerification, null);

    await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "model-binding-test", exportedAt: new Date().toISOString(), isFullSnapshot: true, records: snapshot1(),
    });
    const unauthorized = await saveConnection("https://unused.example/v1", "never-authorized");
    const switchModel = (providerId: string, model: string) => handler("harness.setSessionModel", { sessionId: oldSession.id, providerId, model });
    assert.equal((await switchModel(unauthorized.id, "m-third")).ok, false);
    model.enqueue({ text: "核对旧模型绑定", toolCalls: [] });
    const started = await handler("harness.startRun", { sessionId: oldSession.id, requestId: "old-model-run", text: "继续" });
    assert.equal(started.ok, true);
    assert.equal((await pollRunStatus(handler, (started.data as { runId: string }).runId)).status, "finished");
    assert.equal(model.calls.at(-1)?.setting.providerId, first.id);
    assert.equal(model.calls.at(-1)?.setting.model, "m-first");
    assert.equal((await switchModel(second.id, "m-next")).ok, true);
    assert.equal((await app.service.getSession(oldSession.id))?.assistantModel?.model, "m-next");
    assert.equal(roles.get("assistant")?.model, "m-second");
    model.enqueue({ text: "核对切换后的模型", toolCalls: [] });
    const next = await handler("harness.startRun", { sessionId: oldSession.id, requestId: "new-model-run", text: "继续" });
    assert.equal(next.ok, true);
    assert.equal((await pollRunStatus(handler, (next.data as { runId: string }).runId)).status, "finished");
    assert.equal(model.calls.at(-1)?.setting.model, "m-next");
  } finally {
    app.db.close?.();
  }
});
