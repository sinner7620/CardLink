import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { newMessageId } from "../../src/domain/message.ts";
import type { RunBudget } from "../../src/domain/run-budget.ts";
import * as F from "../fixtures/discovery-data.ts";

/**
 * v2.16 §11.3 / H1-T48：崩溃恢复（reconcile）共用本 Run 预算、已用计数与总时限。
 * 覆盖：多个悬空调用 + maxToolCalls=1 只执行限内调用；拒绝不占额度；
 * 恢复执行失败同样计数；到上限停止可续；取消优先；Reviewer await 后共享超时不再执行工具。
 */

type Stack = { app: HarnessApp; model: FakeModelClient; sessionId: string };

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
  return { app, model, sessionId: "" };
}

function budget(overrides: Partial<RunBudget> = {}): RunBudget {
  return { tier: "simple", maxIterations: 4, maxToolCalls: 8, maxDurationMs: 300_000, fromTier: true, ...overrides };
}

function danglingAssistant(calls: Array<{ id: string; name: string; arguments?: unknown }>) {
  return {
    type: "assistant" as const,
    id: newMessageId(),
    text: "",
    toolCalls: calls.map((call) => ({ ...call, arguments: call.arguments ?? {} })),
    createdAt: new Date().toISOString(),
  };
}

async function seedStack(danglingCount: number): Promise<Stack> {
  const stack = makeStack();
  await stack.app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "reconcile-budget", exportedAt: "2026-11-16T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotA(),
  });
  const session = await stack.app.service.createSession({ notebookIds: [] });
  await stack.app.service.setReviewLevel(session.id, "full_allow");
  const calls = Array.from({ length: danglingCount }, (_, index) => ({
    id: `dangling-${index + 1}`,
    // 第一条故意用一个不存在的记录：工具执行失败也必须计入已用工具（与正常循环口径一致）。
    name: index === 0 ? "getMistakeDetail" : "getMistakeStats",
    arguments: index === 0 ? { recordId: `${F.DISCOVERY_NOTEBOOK_O}:missingNote` } : {},
  }));
  await stack.app.store.append(session.id, danglingAssistant(calls));
  return { ...stack, sessionId: session.id };
}

describe("v2.16 §11.3 / H1-T48：恢复路径共享 Run 预算", () => {
  test("多个 dangling + maxToolCalls=1：只执行 1 个，其余记拒绝且不占额度；到上限可续", async () => {
    const { app, model, sessionId } = await seedStack(3);
    model.reset();
    const result = await app.service.sendMessage(sessionId, "req-reconcile-limit", "继续上次运行", {
      budget: budget({ maxToolCalls: 1 }),
    });
    assert.equal(result.status, "limit_reached", JSON.stringify(result));
    assert.equal(result.finishReason, "iteration_limit");
    assert.equal(result.continuable, true);
    assert.equal(result.budget?.maxToolCalls, 1);
    assert.equal(result.budget?.usedToolCalls, 1);
    assert.equal(model.assistantCalls, 0, "达到工具上限后不再请求模型/额外工具");

    const calls = app.runStore.listToolCalls(result.runId!);
    assert.equal(calls.length, 3, JSON.stringify(calls));
    const executed = calls.filter((call) => call.executionStatus === "executed");
    const failed = calls.filter((call) => call.executionStatus === "error");
    const denied = calls.filter((call) => call.executionStatus === "denied");
    assert.equal(executed.length, 0);
    assert.equal(failed.length, 1, "失败的恢复执行仍计入已用工具");
    assert.equal(denied.length, 2, "超出上限的悬空调用记拒绝，不执行");
    assert.ok(denied.every((call) => call.policyStatus === "limit_exceeded"), JSON.stringify(denied));

    // 续答：剩余没有悬空调用，模型直接收尾；新 Run 预算独立计数。
    model.reset();
    model.enqueueMany([{ text: "恢复完成", toolCalls: [] }]);
    const continued = await app.service.continueTurn(sessionId, "req-reconcile-continue");
    assert.equal(continued.status, "completed", JSON.stringify(continued));
    assert.equal(continued.budget?.usedToolCalls, 0);
    assert.equal(model.assistantCalls, 1);
  });

  test("取消优先于恢复执行：不产生模型/工具调用", async () => {
    const { app, model, sessionId } = await seedStack(2);
    model.reset();
    const controller = new AbortController();
    controller.abort();
    const result = await app.service.sendMessage(sessionId, "req-reconcile-cancel", "取消", {
      budget: budget(),
      signal: controller.signal,
    });
    assert.equal(result.finishReason, "cancelled");
    assert.equal(model.assistantCalls, 0);
    assert.equal(app.runStore.listToolCalls(result.runId!).length, 0);
  });

  test("共享总时限已到：恢复不执行工具，终态 timeout", async () => {
    const { app, model, sessionId } = await seedStack(2);
    model.reset();
    const result = await app.service.sendMessage(sessionId, "req-reconcile-timeout", "超时", {
      budget: budget({ maxDurationMs: 0 }),
    });
    assert.equal(result.status, "limit_reached", JSON.stringify(result));
    assert.equal(result.finishReason, "timeout");
    assert.equal(model.assistantCalls, 0);
    assert.equal(app.runStore.listToolCalls(result.runId!).length, 0);
  });

  test("Reviewer await 后再次检查共享总时限：超时不再执行工具", async () => {
    const { app, model, sessionId } = await seedStack(1);
    // 恢复调用需要审核：provenance 档下新数据访问仍需 Reviewer。
    await app.service.setReviewLevel(sessionId, "provenance");
    model.reset();
    model.behavior = async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { approved: true, reason: "慢审核" };
    };
    const result = await app.service.sendMessage(sessionId, "req-reconcile-reviewer-timeout", "继续", {
      budget: budget({ maxDurationMs: 300 }),
    });
    assert.equal(result.status, "limit_reached", JSON.stringify(result));
    assert.equal(result.finishReason, "timeout");
    assert.equal(model.reviewerCalls, 1, "Reviewer 已被 await");
    assert.equal(app.runStore.listToolCalls(result.runId!).length, 0, "超时后不再执行工具");
    assert.equal(result.budget?.usedToolCalls, 0);
  });
});
