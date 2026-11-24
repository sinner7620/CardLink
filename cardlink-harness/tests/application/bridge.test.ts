import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { loadConfig } from "../../src/config.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { migrate } from "../../src/adapters/sqlite/db.ts";
import { createBridgeHandler, HARNESS_COMMANDS } from "../../src/adapters/bridge/commands.ts";
import { SqliteRunStore } from "../../src/adapters/sqlite/sqlite-run-store.ts";
import { InMemoryProviderConfigStore, InMemoryCredentialStore } from "../../src/application/ports/provider-store.ts";
import { InMemoryRoleConfigStore } from "../../src/adapters/bridge/commands.ts";
import type { BridgeResult } from "../../src/adapters/bridge/commands.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

const TOKEN_KEY_TEST = "sk-bridge-test-key-8f3a";

let app: HarnessApp;
let handler: (name: string, data?: unknown) => Promise<BridgeResult>;
const model = new FakeModelClient();

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }>): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

before(async () => {
  model.behavior = (ctx) => {
    if (ctx.outputType.name === "assistant_message") {
      const result = ctx.messages.find((m) => m.type === "tool_result");
      const ref = (result?.content as { citation?: { statisticRef: string } } | undefined)?.citation?.statisticRef;
      return result
        ? { text: `统计完成：共 {{stat:ref_1|${ref}|totalRecords}} 道错题。`, toolCalls: [] }
        : { text: "查统计", toolCalls: [{ id: "bridge-call-1", name: "getMistakeStats", arguments: {} }] };
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
    schemaVersion: 1, sourceId: "bridge-fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
  handler = createBridgeHandler({
    service: app.service,
    repository: app.repository,
    syncService: app.syncService,
    statisticsEngine: app.statisticsEngine,
    runStore: app.runStore,
    evidenceStore: app.evidenceStore,
    capabilities: app.capabilities,
    compactions: app.compactions,
    providers: new InMemoryProviderConfigStore(),
    credentials: new InMemoryCredentialStore(),
    roles: new InMemoryRoleConfigStore(),
  });
});

async function waitForFinished(runId: string, poll = handler, timeoutMs = 5000): Promise<BridgeResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await poll("harness.getRunStatus", { runId });
    const data = status.data as { status: string; result?: unknown };
    if (data.status === "finished" || data.status === "interrupted" || data.status === "failed" || data.status === "cancelled") {
      return status;
    }
    if (Date.now() > deadline) throw new Error(`等待运行结束超时: ${JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("H1-T29/T30: 命令桥（v2.1 §13）", () => {
  test("停止挂起的模型调用后进入 cancelled，迟到的纯文本回答不能落库", { timeout: 3000 }, async () => {
    let entered!: () => void;
    let release!: (value: unknown) => void;
    const inFlight = new Promise<void>((resolve) => { entered = resolve; });
    const late = new Promise<unknown>((resolve) => { release = resolve; });
    const original = model.behavior;
    model.behavior = () => { entered(); return late; };
    try {
      const created = await handler("harness.createSession", {});
      const { sessionId } = created.data as { sessionId: string };
      const started = await handler("harness.startRun", { sessionId, requestId: "cancel-in-flight", text: "测试停止" });
      const { runId } = started.data as { runId: string };
      await inFlight;
      await handler("harness.cancelRun", { runId });
      const stopped = await waitForFinished(runId, handler, 1000);
      const status = stopped.data as { status: string; phase: string; finishReason: string };
      assert.deepEqual([status.status, status.phase, status.finishReason], ["cancelled", "interrupted", "cancelled"]);
      release(assistantOutput("迟到的最终回答", []));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const session = await app.service.getSession(sessionId);
      assert.deepEqual(session?.messages.map((message) => message.type), ["user"]);
    } finally {
      model.behavior = original;
      release(assistantOutput("释放测试请求", []));
    }
  });

  test("白名单完整；未知命令拒绝（T25）", async () => {
    assert.deepEqual(
      [...HARNESS_COMMANDS].sort(),
      [
        "harness.cancelRun", "harness.continueRun", "harness.createSession", "harness.deleteSession", "harness.exportSession",
        "harness.getEvidence",
        "harness.getSession", "harness.getRunStatus", "harness.health", "harness.importSnapshot", "harness.listModelProviders",
        "harness.listProviderModels",
        "harness.listSessions", "harness.purgeSession", "harness.renameSession", "harness.resolveRecordTitles", "harness.setModelRoleConfig", "harness.setCredential",
        "harness.setProviderConfig",
        "harness.setReviewLevel", "harness.startRun", "harness.stats", "harness.testModelProvider", "harness.clearCredential",
        // v2.5 §13：模型能力（上下文窗口/输出上限）查询与用户覆盖。
        "harness.getModelCapabilities", "harness.setModelCapabilities",
        // v2.14 §22：上下文用量遥测（只读）与手动费率。
        "harness.getContextInsights", "harness.getModelRate", "harness.setModelRate",
        "harness.getDataFreshness", "harness.setBudgetTier",
        "harness.getModelSettings", "harness.saveModelConnection", "harness.activateModelRoles", "harness.setSessionModel", "harness.forkSession", "harness.selectSessionBranch", "harness.answerRunQuestion", "harness.saveQuestionDraft",
        "harness.clearModelRate", "harness.listModelRates",
      ].sort(),
    );
    const bad = await handler("harness.dropDatabase");
    assert.equal(bad.ok, false);
    assert.equal((bad.error as { code: string }).code, "unknown_command");
  });

  test("v2.5：模型能力查询与用户覆盖（§5.2）", async () => {
    const preset = await handler("harness.getModelCapabilities", { providerId: "p1", model: "deepseek-chat" });
    assert.equal(preset.ok, true);
    assert.equal((preset.data as { capabilities: { contextWindowTokens: number } }).capabilities.contextWindowTokens, 65536);

    const unknown = await handler("harness.getModelCapabilities", { providerId: "p1", model: "my-private-model" });
    assert.equal((unknown.data as { capabilities: { source: string } }).capabilities.source, "default");

    const set = await handler("harness.setModelCapabilities", {
      providerId: "p1", modelId: "my-private-model", contextWindowTokens: 131072, maxOutputTokens: 16384,
    });
    assert.equal(set.ok, true);
    assert.equal((set.data as { source: string }).source, "user");

    const after = await handler("harness.getModelCapabilities", { providerId: "p1", model: "my-private-model" });
    assert.equal((after.data as { capabilities: { contextWindowTokens: number; source: string } }).capabilities.contextWindowTokens, 131072);
    assert.equal((after.data as { capabilities: { source: string } }).capabilities.source, "user");

    const invalid = await handler("harness.setModelCapabilities", {
      providerId: "p1", modelId: "bad", contextWindowTokens: 512, maxOutputTokens: 999999,
    });
    assert.equal(invalid.ok, false);
  });

  test("health/stats/importSnapshot 通路", async () => {
    const health = await handler("harness.health");
    assert.equal((health.data as { snapshotId: string }).snapshotId.includes("bridge-fixture") || (health.data as { snapshotId: string }).snapshotId !== "none", true);
    const stats = await handler("harness.stats", { statsTime: "2026-11-12T22:00:00+08:00", timezone: "Asia/Shanghai" });
    assert.equal((stats.data as { totalRecords: number }).totalRecords, 100);
    assert.equal((stats.data as { dueCount: number }).dueCount, 22);
    assert.equal((stats.data as { availableRecords: number }).availableRecords, 97);
  });

  test("startRun → getRunStatus → finished；requestId 幂等（T12）", async () => {
    const created = await handler("harness.createSession", { scope: { notebookIds: [] } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const request = { sessionId, requestId: "req-bridge-1", text: "统计如何？" };
    const [started, concurrent] = await Promise.all([
      handler("harness.startRun", request), handler("harness.startRun", request),
    ]);
    assert.equal(started.ok, true);
    const runId = (started.data as { runId: string }).runId;
    assert.ok(runId);
    assert.deepEqual(concurrent.data, started.data);

    const finished = await waitForFinished(runId);
    const data = finished.data as { result?: { status: string; message?: string }; status: string };
    assert.equal(data.status, "finished");
    assert.equal((data.result as { status: string }).status, "completed");
    const evidenceId = data.result?.message?.match(/\[100\]\(stat:(ev_[a-f0-9]+)\)/)?.[1];
    assert.ok(evidenceId);
    const evidence = await handler("harness.getEvidence", { evidenceId });
    assert.equal((evidence.data as { envelope?: { data?: { totalRecords: number } } }).envelope?.data?.totalRecords, 100);

    // 同 requestId 重放 → 缓存结果
    const restarted = createBridgeHandler({ service: app.service, repository: app.repository, runStore: app.runStore });
    const replay = await restarted("harness.startRun", request);
    assert.deepEqual(replay.data, started.data);
    const replayStatus = await restarted("harness.getRunStatus", { runId });
    assert.deepEqual((replayStatus.data as { result: unknown }).result, (finished.data as { result: unknown }).result);
    assert.equal(app.db.rows("SELECT run_id FROM runs WHERE session_id = ?", [sessionId]).length, 1);
    assert.equal((await app.service.getSession(sessionId))?.messages.filter((message) => message.type === "user").length, 1);
  });

  test("从旧库建立请求映射时保留历史运行并采用原始运行 ID", async () => {
    const db = openDatabase(":memory:", 11);
    const runs = new SqliteRunStore(db);
    const now = new Date().toISOString();
    for (const id of ["old", "original", "duplicate"]) {
      db.exec("INSERT INTO runs(run_id, session_id, snapshot_id, request_id, status, phase, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)",
        [id, "session", "snapshot", "request", "finished", "finished", now, now]);
    }
    db.exec("INSERT INTO turn_results VALUES(?,?,?,?)", ["session", "request", JSON.stringify({ runId: "original" }), now]);
    migrate(db);
    assert.equal(runs.startRun("replay", "session", "other", "request").runId, "original");
    assert.equal(db.rows("SELECT run_id FROM runs").length, 3);
    db.close?.();
  });

  test("同步切换最新快照后，入列 Run 的详情与统计证据仍引用同一旧版本", async () => {
    const model = new FakeModelClient();
    const local = createHarnessApp(app.config, { driver: openDatabase(":memory:"), model });
    const records = snapshot1();
    const sync = (items: typeof records, exportedAt: string) => local.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "bridge-pin", exportedAt, isFullSnapshot: true, records: items,
    });
    const initial = await sync(records, "2026-11-12T08:00:00+08:00");
    const meta = await local.repositoryV2.getSnapshot(initial.snapshotId);
    const session = await local.service.createSession({ notebookIds: [] });
    model.enqueueMany([
      assistantOutput("查旧快照", [
        { id: "detail-pin", name: "getMistakeDetail", arguments: { recordId: records[0].recordId } },
        { id: "stat-pin", name: "getMistakeStats" },
      ]),
      { approved: true, reason: "ok" }, { approved: true, reason: "ok" },
      assistantOutput("完成", []),
    ]);
    // The bridge resolves the old manifest, then sync commits before AgentService starts.
    const bridgeRepo = Object.create(local.repository) as typeof local.repository;
    bridgeRepo.getLatestSnapshotMeta = async () => {
      const old = await local.repository.getLatestSnapshotMeta();
      await sync(records.slice(1, 2), "2026-11-13T08:00:00+08:00");
      return old;
    };
    const bridge = createBridgeHandler({ service: local.service, repository: bridgeRepo, runStore: local.runStore });
    const started = await bridge("harness.startRun", { sessionId: session.id, requestId: "pin", text: "查统计与详情" });
    const { runId } = started.data as { runId: string };
    await waitForFinished(runId, bridge);
    assert.equal(local.runStore.get(runId)?.snapshotId, initial.snapshotId);
    const calls = local.runStore.listToolCalls(runId);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.executionStatus, "executed");
      const result = JSON.parse(call.resultJson!);
      assert.equal(result.evidence.snapshotId, initial.snapshotId);
      assert.equal(result.evidence.dataAsOf, meta?.dataAsOf);
    }
  });

  test("复习排名回答可直接引用卡片和工具结果附带的统计编号，重开会话仍保留引用", async () => {
    const model = new FakeModelClient();
    const local = createHarnessApp(app.config, { driver: openDatabase(":memory:"), model });
    await local.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "review-ranking", exportedAt: "2026-11-12T08:00:00+08:00",
      isFullSnapshot: true, records: snapshot1(),
    });
    const session = await local.service.createSession({ notebookIds: [] });
    let first: { recordId: string; verifiedReviewCount: number } | undefined;
    model.behavior = (ctx) => {
      if (ctx.outputType.name !== "assistant_message") return { approved: true, reason: "准许" };
      const toolResult = ctx.messages.find((message) => message.type === "tool_result");
      if (!toolResult) return assistantOutput("查复习排名", [
        { id: "rank-source", name: "queryMistakes", arguments: { unmastered: true, orderBy: "reviewCountDesc" } },
      ]);
      const supplied = toolResult.content as {
        citation: { statisticRef: string };
        data: { records: Array<{ recordId: string; verifiedReviewCount: number }> };
      };
      first = supplied.data.records[0];
      assert.ok(first);
      return assistantOutput(`[复习最多的题](card:${first.recordId}) 已复习 {{stat:ref_1|${supplied.citation.statisticRef}|records.0.verifiedReviewCount}} 次。`, []);
    };
    const result = await local.service.sendMessage(session.id, "rank-refs", "哪些题复习次数多且还未掌握？");
    assert.ok(first);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.warnings ?? [], []);
    assert.ok(result.message?.includes(`[${first.verifiedReviewCount}](stat:ev_`));
    assert.ok(result.evidenceRefs?.includes(first.recordId));
    const reloaded = await local.service.getSession(session.id);
    const last = reloaded?.messages.at(-1);
    assert.equal(last?.type, "assistant");
    if (last?.type === "assistant") assert.deepEqual(last.evidenceRefs, result.evidenceRefs);
  });

  test("T30: 密钥不落盘（configureModel/startRun 后全库扫描）", async () => {
    await handler("harness.setProviderConfig", {
      config: { id: "session-default", protocol: "openai-compatible", baseUrl: "https://session-default.test/v1", credentialRef: "session-key", enabled: true },
    });
    await handler("harness.setCredential", { credentialRef: "session-key", apiKey: TOKEN_KEY_TEST });
    await handler("harness.setModelRoleConfig", {
      role: "assistant", providerId: "session-default", model: "m", credentialRef: "session-key", timeoutMs: 5000, maxOutputTokens: 256,
    });
    const providers = await handler("harness.listModelProviders");
    assert.equal((providers.data as Array<{ id: string }>).some((p) => p.id === "session-default"), true);

    const created = await handler("harness.createSession", { scope: { notebookIds: [] } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const started = await handler("harness.startRun", { sessionId, requestId: "req-key", text: "hi" });
    const runId = (started.data as { runId: string }).runId;
    await waitForFinished(runId);

    // 全库扫描：密钥明文不得出现在任何表
    const tables = ["sessions", "session_events", "tool_audit", "turn_results", "runs", "run_requests", "tool_calls", "mistake_projection"];
    for (const table of tables) {
      const rows = app.db.rows(`SELECT * FROM ${table}`);
      for (const row of rows) {
        assert.equal(JSON.stringify(row).includes(TOKEN_KEY_TEST), false, `表 ${table} 泄漏密钥`);
      }
    }
  });

  test("cancelRun 协作取消（T24/v2.1-T19 部分）", async () => {
    const model = app.model as FakeModelClient;
    const previous = model.behavior;
    model.behavior = async (ctx) => {
      if (ctx.outputType.name === "assistant_message" && !ctx.messages.some((m) => m.type === "tool_result")) {
        await new Promise((r) => setTimeout(r, 120));
        return { text: "查", toolCalls: [{ id: `c-${Math.random().toString(36).slice(2, 8)}`, name: "getMistakeStats", arguments: {} }] };
      }
      return { text: "done", toolCalls: [] };
    };
    const created = await handler("harness.createSession", { scope: { notebookIds: [] } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const started = await handler("harness.startRun", { sessionId, requestId: `req-cancel-${Date.now()}`, text: "慢慢来" });
    const runId = (started.data as { runId: string }).runId;
    await new Promise((r) => setTimeout(r, 30));
    await handler("harness.cancelRun", { runId });
    const finished = await waitForFinished(runId);
    const data = finished.data as { status: string; result?: { error?: { code: string } } };
    assert.equal(data.status, "cancelled");
    assert.equal((data.result as { error?: { code: string } }).error?.code, "cancelled");
    model.behavior = previous;
  });
});
