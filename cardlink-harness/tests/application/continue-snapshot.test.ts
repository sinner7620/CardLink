import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { createBridgeHandler, type BridgeResult } from "../../src/adapters/bridge/commands.ts";
import * as F from "../fixtures/discovery-data.ts";

/**
 * v2.16 §6.3 / H1-T45：继续生成沿用该会话最近一次 Run 锁定快照。
 * 覆盖：截断运行 A → 导入 B → continue 仍读 A（工具 evidence 的 snapshotId/dataAsOf 均为 A）；
 * 新提问读 B；直接 AgentService.continueTurn 同语义；历史 none 与快照元数据缺失可区分。
 */

type Stack = { app: HarnessApp; model: FakeModelClient };

function makeStack(): Stack {
  const driver = openDatabase(":memory:");
  const model = new FakeModelClient();
  const app = createHarnessApp(
    {
      bind: "127.0.0.1", port: 0, httpToken: "t",
      model: {
        provider: "openai-compatible", baseUrl: "https://unused/v1", apiKey: "unused", name: "unused",
        reviewerName: "", effortAssistant: "medium", effortReviewer: "low",
        timeoutMs: 3000, maxOutputTokens: 1024, providerId: "p1", credentialRef: "k1",
      },
      storage: { database: ":memory:" },
      limits: { maxIterations: 4, maxToolCallsPerTurn: 8, toolTimeoutMs: 3000, contextBudgetChars: 0 },
    },
    { driver, model },
  );
  return { app, model };
}

function toolMessage(text: string, calls: Array<{ id: string; name: string; arguments?: unknown }>): Record<string, unknown> {
  return { text, toolCalls: calls.map((call) => ({ ...call, arguments: call.arguments ?? {} })) };
}

const SNAPSHOT_BUDGET = { tier: "simple" as const, maxIterations: 1, maxToolCalls: 8, maxDurationMs: 300_000, fromTier: true };

type SnapshotInfo = { id: string; dataAsOf: string };

async function importSnapshotA(app: HarnessApp): Promise<SnapshotInfo> {
  const a = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "continue-snapshot", exportedAt: "2026-11-16T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotA(),
  });
  const meta = await app.repository.forSnapshot(a.snapshotId).getLatestSnapshotMeta();
  assert.ok(meta?.dataAsOf);
  return { id: a.snapshotId, dataAsOf: meta.dataAsOf };
}

async function importSnapshotB(app: HarnessApp): Promise<SnapshotInfo> {
  // dataAsOf = importedAt（毫秒）；确保 A/B 的导入时间可区分。
  await new Promise((resolve) => setTimeout(resolve, 5));
  const b = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "continue-snapshot", exportedAt: "2026-11-17T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotA().map((record) => ({ ...record, level: 2 })),
  });
  const meta = await app.repository.forSnapshot(b.snapshotId).getLatestSnapshotMeta();
  assert.ok(meta?.dataAsOf);
  return { id: b.snapshotId, dataAsOf: meta.dataAsOf };
}

/** 在快照 A 上制造截断运行：1 次迭代、执行 1 个工具后达到迭代上限（可续）。 */
async function seedTruncatedRun(app: HarnessApp, model: FakeModelClient, sessionId: string, snapshotId: string): Promise<void> {
  model.enqueueMany([toolMessage("先查统计", [{ id: "seed-stats", name: "getMistakeStats", arguments: {} }])]);
  const first = await app.service.sendMessage(sessionId, `seed-${snapshotId}`, "先统计", { budget: SNAPSHOT_BUDGET });
  assert.equal(first.status, "limit_reached", JSON.stringify(first));
  assert.equal(first.finishReason, "iteration_limit");
  assert.equal(app.runStore.get(first.runId!)?.snapshotId, snapshotId);
}

function waitFor(handler: (name: string, data?: unknown) => Promise<BridgeResult>, runId: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    for (;;) {
      const res = await handler("harness.getRunStatus", { runId });
      const data = res.data as { status: string };
      if (data.status !== "active") return data;
      if (Date.now() > deadline) throw new Error(`等待运行结束超时: ${JSON.stringify(data)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
}

describe("v2.16 §6.3 / H1-T45：续答锁定上次 Run 的快照", () => {
  test("桥 continue：导入 B 后仍读 A，工具 evidence 的 snapshotId/dataAsOf 正确；新提问读 B", async () => {
    const { app, model } = makeStack();
    const a = await importSnapshotA(app);
    const session = await app.service.createSession({ notebookIds: [] });
    await app.service.setReviewLevel(session.id, "full_allow");
    await seedTruncatedRun(app, model, session.id, a.id);
    const handler = createBridgeHandler({ service: app.service, repository: app.repository, runStore: app.runStore });

    // A 上已有截断运行后导入 B；最新快照变为 B，continue 仍须读 A。
    const b = await importSnapshotB(app);
    assert.equal((await app.repository.getLatestSnapshotMeta())!.snapshotId, b.id);
    model.reset();
    model.enqueueMany([
      toolMessage("续答中继续查统计", [{ id: "continue-stats", name: "getMistakeStats", arguments: {} }]),
      { text: "续答完成", toolCalls: [] },
    ]);
    const started = await handler("harness.continueRun", { sessionId: session.id, requestId: "req-continue-a" });
    assert.equal(started.ok, true, JSON.stringify(started.error));
    const runId = (started.data as { runId: string }).runId;
    const finished = await waitFor(handler, runId);
    assert.equal(finished.status, "finished", JSON.stringify(finished));

    assert.equal(app.runStore.get(runId)?.snapshotId, a.id);
    const calls = app.runStore.listToolCalls(runId);
    assert.equal(calls.length, 1, JSON.stringify(calls));
    const envelope = JSON.parse(calls[0]!.resultJson ?? "{}") as { evidence?: { snapshotId?: string; dataAsOf?: string } };
    assert.equal(envelope.evidence?.snapshotId, a.id);
    assert.equal(envelope.evidence?.dataAsOf, a.dataAsOf);

    // 新提问（send）读 B。
    model.reset();
    model.enqueueMany([
      toolMessage("新问题查统计", [{ id: "send-stats", name: "getMistakeStats", arguments: {} }]),
      { text: "新问题完成", toolCalls: [] },
    ]);
    const newRun = await handler("harness.startRun", { sessionId: session.id, text: "新问题", requestId: "req-send-b" });
    assert.equal(newRun.ok, true, JSON.stringify(newRun.error));
    const newRunId = (newRun.data as { runId: string }).runId;
    await waitFor(handler, newRunId);
    assert.equal(app.runStore.get(newRunId)?.snapshotId, b.id);
    const newCall = app.runStore.listToolCalls(newRunId)[0]!;
    const newEnvelope = JSON.parse(newCall.resultJson ?? "{}") as { evidence?: { snapshotId?: string; dataAsOf?: string } };
    assert.equal(newEnvelope.evidence?.snapshotId, b.id);
    assert.equal(newEnvelope.evidence?.dataAsOf, b.dataAsOf);
  });

  test("直接 AgentService.continueTurn 同样锁定 A；requestId 重放仍返回原 Run", async () => {
    const { app, model } = makeStack();
    const a = await importSnapshotA(app);
    const session = await app.service.createSession({ notebookIds: [] });
    await app.service.setReviewLevel(session.id, "full_allow");
    await seedTruncatedRun(app, model, session.id, a.id);
    await importSnapshotB(app);

    model.reset();
    model.enqueueMany([
      toolMessage("续答", [{ id: "direct-stats", name: "getMistakeStats", arguments: {} }]),
      { text: "完成", toolCalls: [] },
    ]);
    const result = await app.service.continueTurn(session.id, "req-direct-continue");
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(app.runStore.get(result.runId!)?.snapshotId, a.id);
    const call = app.runStore.listToolCalls(result.runId!)[0]!;
    const envelope = JSON.parse(call.resultJson ?? "{}") as { evidence?: { snapshotId?: string; dataAsOf?: string } };
    assert.equal(envelope.evidence?.snapshotId, a.id);
    assert.equal(envelope.evidence?.dataAsOf, a.dataAsOf);

    const replay = await app.service.continueTurn(session.id, "req-direct-continue");
    assert.deepEqual(replay, result);
    assert.equal(model.assistantCalls, 2, "重放不再调用模型");
  });

  test("历史 none 与快照元数据缺失可区分：none 按空快照运行，缺失显式失败且不回退最新", async () => {
    const { app, model } = makeStack();
    await importSnapshotA(app);
    const session = await app.service.createSession({ notebookIds: [] });
    await app.service.setReviewLevel(session.id, "full_allow");

    // 历史 Run 的 snapshotId = none：续答保持 none，不借用最新。
    app.runStore.startRun("legacy-none", session.id, "none", "req-legacy-none");
    model.reset();
    model.enqueueMany([{ text: "空快照续答", toolCalls: [] }]);
    const noneResult = await app.service.continueTurn(session.id, "req-after-none");
    assert.equal(noneResult.status, "completed", JSON.stringify(noneResult));
    assert.equal(app.runStore.get(noneResult.runId!)?.snapshotId, "none");

    // 历史 Run 指向不存在的快照：显式 snapshot_unavailable，不读最新。
    app.runStore.startRun("legacy-missing", session.id, "missing-snapshot", "req-legacy-missing");
    await assert.rejects(
      () => app.service.continueTurn(session.id, "req-after-missing"),
      /snapshot_unavailable/,
    );
  });
});
