import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { createBridgeHandler, type BridgeResult } from "../../src/adapters/bridge/commands.ts";
import { loadConfig } from "../../src/config.ts";
import {
  BUDGET_TIERS,
  DEFAULT_BUDGET_CAPS,
  legacyRunBudget,
  resolveRunBudget,
  validateBudgetTier,
} from "../../src/domain/run-budget.ts";
import * as F from "../fixtures/discovery-data.ts";

/**
 * v2.16 §11.3 / H1-T47/T48：分级运行预算。
 * 覆盖档位解析与硬上限、Run 固定、本 Run 工具总量、未知档拒绝、续答继承、
 * 时限/取消优先，以及 ACL/审核/审计不因档位放宽。
 */

type Scripted = Record<string, unknown>;

function makeStack(limits?: { maxIterations?: number; maxToolCallsPerTurn?: number }): { app: HarnessApp; model: FakeModelClient } {
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
      limits: {
        maxIterations: limits?.maxIterations ?? 4,
        maxToolCallsPerTurn: limits?.maxToolCallsPerTurn ?? 8,
        hardLimits: { maxIterations: 12, maxToolCalls: 24, maxRunDurationMs: 1_200_000 },
        toolTimeoutMs: 3000,
        contextBudgetChars: 0,
      },
    },
    { driver, model },
  );
  return { app, model };
}

async function importFixture(app: HarnessApp): Promise<string> {
  const imported = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "budget-fixture", exportedAt: "2026-11-16T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotA(),
  });
  return imported.snapshotId;
}

function toolMessage(text: string, calls: Array<{ id: string; name: string; arguments?: unknown }>): Scripted {
  return { text, toolCalls: calls.map((call) => ({ ...call, arguments: call.arguments ?? {} })) };
}

function statsCalls(prefix: string, count: number, offset = 0): Array<{ id: string; name: string; arguments?: unknown }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${offset + index}`,
    name: "getMistakeStats",
    arguments: {},
  }));
}

const ALL = { notebookIds: [] as string[] };

describe("v2.16 §11.3：档位解析与管理员硬上限", () => {
  test("默认档位值、管理员硬上限取 min、未选档沿用既有默认上限", () => {
    assert.equal(BUDGET_TIERS.simple.iterations, 4);
    assert.equal(BUDGET_TIERS.simple.toolCalls, 8);
    assert.equal(BUDGET_TIERS.comparison.iterations, 8);
    assert.equal(BUDGET_TIERS.comparison.toolCalls, 16);
    assert.equal(BUDGET_TIERS.deep.iterations, 12);
    assert.equal(BUDGET_TIERS.deep.toolCalls, 24);
    assert.deepEqual(resolveRunBudget("deep", DEFAULT_BUDGET_CAPS), {
      tier: "deep", maxIterations: 12, maxToolCalls: 24, maxDurationMs: 1_200_000, fromTier: true,
    });
    assert.deepEqual(resolveRunBudget("deep", { maxIterations: 5, maxToolCalls: 9, maxDurationMs: 2000 }), {
      tier: "deep", maxIterations: 5, maxToolCalls: 9, maxDurationMs: 2000, fromTier: true,
    });
    assert.deepEqual(legacyRunBudget({ maxIterations: 6, maxToolCalls: 7, maxDurationMs: 1000 }), {
      maxIterations: 6, maxToolCalls: 7, maxDurationMs: 1000, fromTier: false,
    });
    assert.equal(validateBudgetTier("deep").ok, true);
    assert.equal(validateBudgetTier("huge").ok, false);
    assert.equal(validateBudgetTier(undefined).ok, false);
  });
});

describe("v2.16 §11.3 / H1-T47：FakeModel 档位行为", () => {
  let app: HarnessApp;
  let model: FakeModelClient;
  let sessionId: string;

  before(async () => {
    const stack = makeStack();
    app = stack.app;
    model = stack.model;
    await importFixture(app);
    sessionId = (await app.service.createSession(ALL)).id;
    await app.service.setReviewLevel(sessionId, "full_allow");
  });

  function reset(): void {
    model.reset();
  }

  test("未带档位：沿用配置默认 4/8（旧调用兼容，记录 tier 为空）", async () => {
    reset();
    model.enqueueMany([toolMessage("查统计", statsCalls("legacy", 1)), { text: "完成", toolCalls: [] }]);
    const result = await app.service.sendMessage(sessionId, "req-budget-legacy", "统计");
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.budget?.tier, undefined);
    assert.equal(result.budget?.maxIterations, 4);
    assert.equal(result.budget?.maxToolCalls, 8);
    assert.equal(result.budget?.usedToolCalls, 1);
    assert.equal(app.runStore.get(result.runId!)?.budgetTier, undefined);
  });

  test("简单档 4 次迭代到上限停止且可续；多题比较档完成更长的链", async () => {
    reset();
    model.enqueueMany([
      ...Array.from({ length: 6 }, (_, index) => toolMessage(`第${index + 1}步`, statsCalls(`simple-${index}`, 1))),
      { text: "完成", toolCalls: [] },
    ]);
    const simple = await app.service.sendMessage(sessionId, "req-budget-simple", "逐题统计", {
      budget: app.service.resolveBudget("simple"),
    });
    assert.equal(simple.status, "limit_reached", JSON.stringify(simple));
    assert.equal(simple.finishReason, "iteration_limit");
    assert.equal(simple.continuable, true);
    assert.equal(simple.budget?.tier, "simple");
    assert.equal(simple.budget?.usedToolCalls, 4);
    assert.equal(app.runStore.get(simple.runId!)?.budgetTier, "simple");
    assert.equal(app.runStore.listToolCalls(simple.runId!).filter((call) => call.executionStatus === "executed").length, 4);

    // 续答：同一会话下一次显式提高档位，完成剩余链路（工具结果经新 toolCallId 重新查询）。
    reset();
    model.enqueueMany([
      ...Array.from({ length: 6 }, (_, index) => toolMessage(`对比${index + 1}`, statsCalls(`comparison-${index}`, 1))),
      { text: "对比完成", toolCalls: [] },
    ]);
    const comparison = await app.service.continueTurn(sessionId, "req-budget-comparison", {
      budget: app.service.resolveBudget("comparison"),
    });
    assert.equal(comparison.status, "completed", JSON.stringify(comparison));
    assert.equal(comparison.budget?.tier, "comparison");
    assert.equal(comparison.budget?.maxIterations, 8);
    assert.equal(comparison.budget?.usedToolCalls, 6);
  });

  test("工具总量按本 Run 全局计数：简单档 8 个后拒绝，拒绝不占额度", async () => {
    reset();
    // 4 次迭代 × 3 个调用 = 12 个请求；简单档只允许 8 个执行。
    model.enqueueMany([
      toolMessage("批次1", statsCalls("cap-a", 3)),
      toolMessage("批次2", statsCalls("cap-b", 3)),
      toolMessage("批次3", statsCalls("cap-c", 3)),
      toolMessage("批次4", statsCalls("cap-d", 3)),
    ]);
    const result = await app.service.sendMessage(sessionId, "req-budget-cap", "连续统计", {
      budget: app.service.resolveBudget("simple"),
    });
    assert.equal(result.status, "limit_reached", JSON.stringify(result));
    assert.equal(result.budget?.usedToolCalls, 8);
    const calls = app.runStore.listToolCalls(result.runId!);
    assert.equal(calls.filter((call) => call.executionStatus === "executed").length, 8);
    const denied = calls.filter((call) => call.executionStatus === "not_executed" || call.executionStatus === "denied");
    assert.equal(denied.length, 4);
    assert.ok(denied.every((call) => call.policyStatus === "limit_exceeded"), JSON.stringify(denied));
  });

  test("取消先于后续请求；总时限到达返回 timeout 且不继续", async () => {
    reset();
    model.enqueueMany([toolMessage("不应执行", statsCalls("cancelled", 1))]);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await app.service.sendMessage(sessionId, "req-budget-cancel", "取消", {
      budget: app.service.resolveBudget("simple"),
      signal: controller.signal,
    });
    assert.equal(cancelled.finishReason, "cancelled");
    assert.equal(cancelled.budget?.usedToolCalls, 0);
    assert.equal(model.assistantCalls, 0, "取消后不再请求模型");

    reset();
    const timedOut = await app.service.sendMessage(sessionId, "req-budget-timeout", "超时", {
      // 直接传入到期预算（内部装配/测试路径）；正常入口由 resolveBudget 从档位派生。
      budget: { tier: "simple", maxIterations: 4, maxToolCalls: 8, maxDurationMs: 0, fromTier: true },
    });
    assert.equal(timedOut.status, "limit_reached", JSON.stringify(timedOut));
    assert.equal(timedOut.finishReason, "timeout");
    assert.equal(timedOut.continuable, true);
    assert.equal(model.assistantCalls, 0, "超过总时限不再请求模型");
  });

  test("档位不放宽 ACL/审核：越权参数仍被 PolicyGuard 拒绝且不进 Reviewer", async () => {
    reset();
    const scopedSession = (await app.service.createSession({ notebookIds: [F.DISCOVERY_NOTEBOOK_M] })).id;
    await app.service.setReviewLevel(scopedSession, "provenance");
    model.enqueueMany([
      toolMessage("越权查询", [{ id: "escape-1", name: "queryMistakes", arguments: { notebookIds: [F.DISCOVERY_NOTEBOOK_O] } }]),
      toolMessage("合法查询", [{ id: "ok-1", name: "queryMistakes", arguments: { notebookIds: [F.DISCOVERY_NOTEBOOK_M], limit: 1 } }]),
      { approved: true, reason: "范围一致" },
      { text: "完成", toolCalls: [] },
    ]);
    const result = await app.service.sendMessage(scopedSession, "req-budget-acl", "查询", {
      budget: app.service.resolveBudget("deep"),
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    const calls = app.runStore.listToolCalls(result.runId!);
    const escape = calls.find((call) => call.toolCallId === "escape-1");
    assert.equal(escape?.policyStatus, "scope_escape");
    assert.equal(escape?.executionStatus, "denied");
    assert.equal(escape?.reviewerApproved, undefined, "确定性门拒绝不进入 Reviewer");
    const ok = calls.find((call) => call.toolCallId === "ok-1");
    assert.equal(ok?.executionStatus, "executed");
    assert.equal(ok?.reviewerApproved, true);
    assert.equal(model.reviewerCalls, 1, "仅合法的新数据访问经过 Reviewer");
  });
});

describe("v2.16 §11.3 / H1-T47：桥接档位选择与状态回显", () => {
  let app: HarnessApp;
  let model: FakeModelClient;
  let handler: (name: string, data?: unknown) => Promise<BridgeResult>;
  let sessionId: string;

  function waitForFinished(runId: string, timeoutMs = 5000): Promise<{ status: string; data: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    return (async () => {
      for (;;) {
        const res = await handler("harness.getRunStatus", { runId });
        const data = res.data as { status: string };
        if (data.status !== "active") return { status: data.status, data };
        if (Date.now() > deadline) throw new Error(`等待运行结束超时: ${JSON.stringify(data)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })();
  }

  before(async () => {
    const stack = makeStack();
    app = stack.app;
    model = stack.model;
    await importFixture(app);
    sessionId = (await app.service.createSession(ALL)).id;
    await app.service.setReviewLevel(sessionId, "full_allow");
    handler = createBridgeHandler({ service: app.service, repository: app.repository, runStore: app.runStore });
  });

  test("未知档拒绝；会话档位持久化；Run 固定并在状态回显", async () => {
    const bad = await handler("harness.startRun", { sessionId, text: "x", requestId: "req-budget-bad", budgetTier: "huge" });
    assert.equal(bad.ok, false);
    assert.equal((bad.error as { code: string }).code, "invalid_budget_tier");
    const badSet = await handler("harness.setBudgetTier", { sessionId, tier: "huge" });
    assert.equal(badSet.ok, false);

    const set = await handler("harness.setBudgetTier", { sessionId, tier: "comparison" });
    assert.equal(set.ok, true, JSON.stringify(set.error));
    assert.equal((await handler("harness.getSession", { sessionId })).data && (await app.service.getSession(sessionId))?.budgetTier, "comparison");

    model.reset();
    model.enqueueMany([{ text: "完成", toolCalls: [] }]);
    const started = await handler("harness.startRun", { sessionId, text: "从会话档位运行", requestId: "req-budget-bridge" });
    assert.equal(started.ok, true, JSON.stringify(started.error));
    const runId = (started.data as { runId: string }).runId;
    const finished = await waitForFinished(runId);
    assert.equal(finished.status, "finished", JSON.stringify(finished.data));
    const budget = finished.data.budget as { tier?: string; maxIterations: number; maxToolCalls: number; usedToolCalls: number };
    assert.equal(budget.tier, "comparison");
    assert.equal(budget.maxIterations, 8);
    assert.equal(budget.maxToolCalls, 16);
    assert.equal(budget.usedToolCalls, 0);
    assert.equal(finished.data.budgetTier, "comparison");
  });

  test("续答未指定档位时沿用会话最近一次 Run 的档位", async () => {
    model.reset();
    model.enqueueMany([{ text: "续答完成", toolCalls: [] }]);
    const continued = await handler("harness.continueRun", { sessionId, requestId: "req-budget-continue" });
    assert.equal(continued.ok, true, JSON.stringify(continued.error));
    const runId = (continued.data as { runId: string }).runId;
    const finished = await waitForFinished(runId);
    assert.equal(finished.status, "finished", JSON.stringify(finished.data));
    assert.equal((finished.data.budget as { tier?: string }).tier, "comparison");
    assert.equal(app.runStore.get(runId)?.budgetTier, "comparison");
  });
});
