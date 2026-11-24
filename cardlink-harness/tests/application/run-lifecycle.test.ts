import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { SqliteRunStore } from "../../src/adapters/sqlite/sqlite-run-store.ts";
import { AgentService } from "../../src/application/agent-service.ts";
import { AssistantRole } from "../../src/application/assistant-role.ts";
import { ReviewerRole } from "../../src/application/reviewer-role.ts";
import { ContextBuilder } from "../../src/application/context-builder.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { ToolExecutor } from "../../src/application/tool-executor.ts";
import { EvidenceValidator } from "../../src/application/evidence-validator.ts";
import { SyncService } from "../../src/application/sync-service.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";
import type { Session, SessionId } from "../../src/domain/session.ts";
import type { ToolResult } from "../../src/domain/message.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { ModelSetting } from "../../src/domain/model-setting.ts";

const SETTING: ModelSetting = { provider: "test", model: "fake", effort: "low", timeoutMs: 1000, maxOutputTokens: 1024 };

let app: HarnessApp;

before(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
});

function buildService(model: FakeModelClient, runStore: SqliteRunStore, target = app): AgentService {
  const builder = new ContextBuilder();
  return new AgentService({
    store: target.store,
    model,
    assistant: new AssistantRole(builder, target.registry.definitions()),
    reviewer: new ReviewerRole(builder, target.registry),
    guard: new PolicyGuard(target.registry, 8),
    executor: new ToolExecutor(target.registry, 3000),
    evidenceValidator: new EvidenceValidator(target.repository),
    auditLog: target.auditLog,
    repository: target.repository,
    config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
    assistantSetting: SETTING,
    reviewerSetting: SETTING,
    runStore,
  });
}

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }>): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

async function findToolResult(sessionId: SessionId, toolCallId: string, which: "first" | "last" = "first"): Promise<ToolResult | undefined> {
  const session = await app.store.get(sessionId);
  const results = session?.messages.filter((m): m is ToolResult => m.type === "tool_result" && m.toolCallId === toolCallId) ?? [];
  return which === "first" ? results[0] : results[results.length - 1];
}

describe("H1-T31/T32: Run 生命周期（v2.1 §10/§11）", () => {
  test("同 ID 同参跨轮复用终结结果，跨快照要求新 ID，不重复执行", async () => {
    const local = makeApp();
    const model = new FakeModelClient();
    const { runStore, auditLog, syncService } = local;
    const service = buildService(model, runStore, local);
    const importFixture = (records: ReturnType<typeof snapshot1>) => syncService.importSnapshot({
      schemaVersion: 1, sourceId: "replay", exportedAt: "2026-11-12T08:00:00+08:00",
      isFullSnapshot: true, records,
    });
    await importFixture(snapshot1());
    const session = await service.createSession({ notebookIds: [] });
    const call = { id: "same-call", name: "queryMistakes", arguments: { limit: 1 } };
    model.enqueueMany([
      assistantOutput("读取", [call]), { approved: true, reason: "ok" }, assistantOutput("已读取", []),
      assistantOutput("重放", [call]), assistantOutput("已复用", []),
      assistantOutput("再次重放", [call]), assistantOutput("需要新查询", []),
    ]);
    await service.sendMessage(session.id, "first", "第一问");
    const replay = await service.sendMessage(session.id, "second", "第二问");
    assert.equal(replay.status, "completed");
    const result = model.calls.at(-1)?.context.messages.at(-1);
    assert.equal(result?.type, "tool_result");
    assert.equal((result as ToolResult).status, "ok");
    assert.match(JSON.stringify((result as ToolResult).content), /cachedResult/);

    await importFixture(snapshot1().slice(1));
    assert.equal((await service.sendMessage(session.id, "third", "第三问")).status, "completed");
    const stale = model.calls.at(-1)?.context.messages.at(-1) as ToolResult;
    assert.equal(stale.status, "error");
    assert.match(JSON.stringify(stale.content), /cached_result_unavailable/);
    assert.equal(model.reviewerCalls, 1);
    assert.equal(auditLog.listBySession(session.id).length, 1);
    assert.equal(runStore.listToolCalls(replay.runId!).length, 0);
    assert.equal((await service.getSession(session.id))?.messages.filter((m) => m.type === "tool_result").length, 1);
  });

  test("T31: 同一 toolCallId 异参重放 → idempotency_conflict，不重复执行", async () => {
    const runStore = new SqliteRunStore(app.db);
    const model = new FakeModelClient();
    const service = buildService(model, runStore);
    const session = await service.createSession({ notebookIds: [] });

    // 第一轮：call id "reuse" 参数 {limit:1}
    model.enqueueMany([
      assistantOutput("查", [{ id: "reuse", name: "queryMistakes", arguments: { limit: 1 } }]),
      { approved: true, reason: "ok" },
      assistantOutput("第一轮完成", []),
    ]);
    const r1 = await service.sendMessage(session.id, "req-1", "第一问", { runId: "run-1" });
    assert.equal(r1.status, "completed");

    // 第二轮：同 ID 异参 {limit:2} → idempotency_conflict
    model.enqueueMany([
      assistantOutput("再查", [{ id: "reuse", name: "queryMistakes", arguments: { limit: 2 } }]),
      assistantOutput("冲突已拒绝。", []),
    ]);
    const r2 = await service.sendMessage(session.id, "req-2", "第二问", { runId: "run-2" });
    assert.equal(r2.status, "completed");
    const conflict = await findToolResult(session.id, "reuse", "last");
    const content = conflict?.content as { code?: string } | undefined;
    assert.equal(content?.code, "idempotency_conflict", "同 ID 异参必须返回冲突，不得复用旧结果");
    assert.equal(conflict?.status, "error");

    const row = runStore.getToolCall(session.id, "reuse");
    assert.ok(row);
    assert.equal(row.executionStatus, "executed", "tool_calls 仅保留首次执行记录");
    assert.equal(row.argsHash.length > 0, true);
    assert.equal(runStore.listToolCalls("run-1").length, 1);
    const run2 = runStore.get("run-2");
    assert.equal(run2?.status, "finished");
    assert.equal(run2?.phase, "finished");
  });

  test("T32: 悬空工具调用恢复——未完成调用补执行，已完成调用不重复", async () => {
    const runStore = new SqliteRunStore(app.db);
    const model = new FakeModelClient();
    const service = buildService(model, runStore);
    const session = await service.createSession({ notebookIds: [] });

    // 崩溃模拟：assistant 已持久化两个工具调用，其中一个已有终结结果，另一个悬空
    await app.store.append(session.id, {
      type: "assistant", id: "a-crash", text: "查两条",
      toolCalls: [
        { id: "done-call", name: "getMistakeStats", arguments: {} },
        { id: "dangling-call", name: "getMistakeDetail", arguments: { recordId: "bookA0000000000000000000000000001:noteA001" } },
      ],
      createdAt: new Date().toISOString(),
    });
    await app.store.append(session.id, {
      type: "tool_result", id: "tr-done", toolCallId: "done-call", status: "ok",
      content: { ok: true, tool: "getMistakeStats", evidence: { snapshotId: "s", dataAsOf: "x" } },
      createdAt: new Date().toISOString(),
    });
    model.enqueueMany([
      { approved: true, reason: "恢复执行" },
      assistantOutput("恢复完成：共 100 道错题。", []),
    ]);
    const result = await service.sendMessage(session.id, "req-recover", "继续", { runId: "run-3" });
    assert.equal(result.status, "completed");

    // done-call 不重复执行：tool_calls 仅 dangling-call 一条恢复记录；done-call 无 runStore 行
    assert.equal(runStore.getToolCall(session.id, "done-call"), null, "已完成的调用不得重复执行");
    assert.ok(runStore.getToolCall(session.id, "dangling-call"));
    const danglingResult = await findToolResult(session.id, "dangling-call");
    assert.equal(danglingResult?.status, "ok");
    // 审计恰好各一条
    assert.equal(app.auditLog.listBySession(session.id).filter((r) => r.toolCallId === "dangling-call").length, 1);
    assert.equal(app.auditLog.listBySession(session.id).filter((r) => r.toolCallId === "done-call").length, 0, "已完成调用不重复审计");
    assert.ok(result.message?.includes("100"));
    void runStore.listToolCalls;
  });

  test("Run 阶段检查点：created→assistant_pending→tool_pending→finished", async () => {
    const runStore = new SqliteRunStore(app.db);
    const model = new FakeModelClient();
    const service = buildService(model, runStore);
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueMany([
      assistantOutput("查", [{ id: "phase-call", name: "getMistakeStats", arguments: {} }]),
      { approved: true, reason: "ok" },
      assistantOutput("完成", []),
    ]);
    await service.sendMessage(session.id, "req-phase", "查", { runId: "run-phase" });
    const run = runStore.get("run-phase");
    assert.ok(run);
    assert.equal(run.status, "finished");
    assert.equal(run.phase, "finished");
    assert.ok(run.resultJson?.includes("completed"));
    const calls = runStore.listToolCalls("run-phase");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.executionStatus, "executed");
  });
});
