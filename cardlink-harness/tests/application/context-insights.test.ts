import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { AgentService } from "../../src/application/agent-service.ts";
import { AssistantRole } from "../../src/application/assistant-role.ts";
import { ReviewerRole } from "../../src/application/reviewer-role.ts";
import { ContextBuilder } from "../../src/application/context-builder.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { ToolExecutor } from "../../src/application/tool-executor.ts";
import { EvidenceValidator } from "../../src/application/evidence-validator.ts";
import { estimateContextInput } from "../../src/application/token-estimator.ts";
import { RequestTelemetryService } from "../../src/application/request-telemetry-service.ts";
import { InMemoryRequestTelemetryStore } from "../../src/application/ports/request-telemetry-store.ts";
import { InMemoryModelRateStore } from "../../src/application/ports/model-rate-store.ts";
import { requestCost, validateModelRate, type RequestTokenBreakdown } from "../../src/domain/request-telemetry.ts";
import { newUserMessage } from "../../src/domain/message.ts";
import { createBridgeHandler } from "../../src/adapters/bridge/commands.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

/**
 * v2.14 §22：上下文用量遥测与本地费用估算。
 * 覆盖：多次 Assistant 调用、准备未发送/失败/取消、压缩关联与趋势、序号去重、
 * 服务商实报/实报 0/混合/缺失、零费用/无费率/换模型与费率变更、跨午夜与币种隔离、
 * 旧库迁移、会话隔离与删除、分页上限、正文与密钥不落库。
 */

let app: HarnessApp;

before(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
});

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }> = []): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

let modelSeq = 0;
/** 独立装配（模型可脚本化）；默认接真实 SQLite 遥测表。 */
function buildService(
  model: FakeModelClient,
  options: { modelId?: string; telemetry?: RequestTelemetryService; app?: HarnessApp } = {},
): AgentService {
  const local = options.app ?? app;
  const builder = new ContextBuilder();
  const modelId = options.modelId ?? `insight-model-${++modelSeq}`;
  return new AgentService({
    store: local.store,
    model,
    assistant: new AssistantRole(builder, local.registry.definitions()),
    reviewer: new ReviewerRole(builder, local.registry),
    guard: new PolicyGuard(local.registry, 8),
    executor: new ToolExecutor(local.registry, 3000),
    evidenceValidator: new EvidenceValidator(local.repository),
    auditLog: local.auditLog,
    repository: local.repository,
    evidenceStore: local.evidenceStore,
    runStore: local.runStore,
    capabilities: local.capabilities,
    compactions: local.compactions,
    telemetry: options.telemetry ?? local.telemetry,
    config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
    assistantSetting: {
      provider: "test-provider", providerId: "test-provider", model: modelId,
      effort: "low", timeoutMs: 1000, maxOutputTokens: 16384,
    },
    reviewerSetting: {
      provider: "test-provider", providerId: "test-provider", model: modelId,
      effort: "low", timeoutMs: 1000, maxOutputTokens: 1024,
    },
  });
}

const breakEvenBudget = {
  inputBudgetTokens: 10000,
  outputBudgetTokens: 1000,
  reservedTokens: 100,
  compactionTriggerTokens: 8500,
};

function fixedBreakdown(total = 200): RequestTokenBreakdown {
  return {
    instructionTokens: 100,
    compactionTokens: 0,
    toolDefinitionTokens: 50,
    messageTokens: 42,
    toolResultTokens: 0,
    overheadTokens: 8,
    totalTokens: total,
  };
}

let seedSeq = 0;
async function seedLongSession(sessionId: string, turns: number, fillerChars = 5000): Promise<void> {
  const prefix = `insight-seed${++seedSeq}`;
  for (let i = 0; i < turns; i++) {
    const at = new Date(Date.now() + i * 1000).toISOString();
    await app.store.append(sessionId, newUserMessage(`第 ${i + 1} 轮：请分析相关错题。`));
    await app.store.append(sessionId, {
      type: "assistant", id: `${prefix}-a-${i}`, text: "我查询一下。",
      toolCalls: [{ id: `${prefix}-call-${i}`, name: "queryMistakes", arguments: { limit: 5 } }],
      createdAt: at,
    });
    await app.store.append(sessionId, {
      type: "tool_result", id: `${prefix}-t-${i}`, toolCallId: `${prefix}-call-${i}`, status: "ok",
      content: {
        ok: true, tool: "queryMistakes",
        data: { records: [{ recordId: `bookA0000000000000000000000001:/note${String(i).padStart(3, "0")}` }], nextCursor: null },
        evidence: { recordIds: [`bookA0000000000000000000000001:/note${String(i).padStart(3, "0")}`], snapshotId: "snap-long", dataAsOf: "2026-11-15T00:00:00Z" },
        filler: "x".repeat(fillerChars),
      },
      createdAt: at,
    });
  }
}

describe("v2.14 §22：请求用量遥测", () => {
  test("T1: 多轮工具调用——每次真实请求一行，序号/分项/预算自洽", async () => {
    const model = new FakeModelClient();
    const service = buildService(model, { modelId: "breakdown-model" });
    const session = await service.createSession({ notebookIds: [] });
    await service.setReviewLevel(session.id, "full_allow");
    model.enqueueMany([
      assistantOutput("查询", [{ id: "t1-c1", name: "queryMistakes", arguments: { limit: 1 } }]),
      assistantOutput("统计", [{ id: "t1-c2", name: "getMistakeStats" }]),
      assistantOutput("完成"),
    ]);
    const result = await service.sendMessage(session.id, "req-t1", "分析", { runId: "run-t1" });
    assert.equal(result.status, "completed");

    const rows = app.telemetryStore.listBySession(session.id, 10, 0);
    assert.equal(rows.length, 3);
    assert.equal(model.assistantCalls, 3);
    const chrono = [...rows].reverse();
    assert.deepEqual(chrono.map((row) => row.requestSeq), [1, 2, 3]);
    for (const [index, row] of chrono.entries()) {
      assert.equal(row.sessionId, session.id);
      assert.equal(row.runId, "run-t1");
      assert.equal(row.providerId, "test-provider");
      assert.equal(row.modelId, "breakdown-model");
      assert.equal(row.outcome, "delivered");
      assert.equal(row.attempt, 1);
      const parts = row.breakdown;
      // 分项之和 == 总额 == 该次实际发送视图的估算（同一估算器；无校准系数时相同）
      assert.equal(
        parts.totalTokens,
        parts.instructionTokens + parts.compactionTokens + parts.toolDefinitionTokens +
          parts.messageTokens + parts.toolResultTokens + parts.overheadTokens,
      );
      assert.equal(parts.totalTokens, estimateContextInput(model.calls[index]!.context));
      assert.ok(parts.toolDefinitionTokens > 0, "工具定义必须计入输入");
      assert.ok(row.budget.inputBudgetTokens > 0);
      assert.equal(row.budget.outputBudgetTokens, 8192);
    }
    // 工具结果进入第二、三次请求的输入
    assert.equal(chrono[0]!.breakdown.toolResultTokens, 0);
    assert.ok(chrono[1]!.breakdown.toolResultTokens > 0);
    // 服务商未返回用量 → 两段都是估算，且不伪造实报值
    for (const row of chrono) {
      assert.equal(row.promptSource, "estimated");
      assert.equal(row.completionSource, "estimated");
      assert.equal(row.reportedPromptTokens, undefined);
      assert.equal(row.usageEstimated, true);
    }

    const insights = app.telemetry.sessionInsights(session.id, { limit: 10 });
    assert.equal(insights.requestCount, 3);
    assert.equal(insights.requests.length, 3);
    // 倒序：最新在前；最旧一条没有更早请求 → 无增量
    assert.deepEqual(insights.requests.map((item) => item.requestSeq), [3, 2, 1]);
    assert.equal(insights.requests[0]!.deltaInputTokens, insights.requests[0]!.breakdown.totalTokens - insights.requests[1]!.breakdown.totalTokens);
    assert.equal(insights.requests[2]!.deltaInputTokens, null);
    assert.equal(insights.totals.delivered, 3);
    assert.equal(insights.totals.requests, 3);
    // 分项累计与请求分项一致
    const sumTotal = insights.requests.reduce((sum, item) => sum + item.breakdown.totalTokens, 0);
    assert.equal(insights.totals.breakdown.totalTokens, sumTotal);
  });

  test("T2: 服务商实报、实报 0、混合与完全缺失分别标注", async () => {
    const telemetry = new RequestTelemetryService({ store: app.telemetryStore, rates: app.modelRates });
    const model = new FakeModelClient();
    const service = buildService(model, { modelId: "usage-model", telemetry });
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueMany([
      { finishReason: "completed", usage: { promptTokens: 0, completionTokens: 0 }, value: assistantOutput("零用量") },
      { finishReason: "completed", usage: { promptTokens: 321 }, value: assistantOutput("只有 prompt") },
      assistantOutput("完全没有用量"),
    ]);
    await service.sendMessage(session.id, "req-t2a", "一", { runId: "run-t2a" });
    await service.sendMessage(session.id, "req-t2b", "二", { runId: "run-t2b" });
    await service.sendMessage(session.id, "req-t2c", "三", { runId: "run-t2c" });

    const rows = app.telemetryStore.listBySession(session.id, 10, 0).reverse();
    assert.equal(rows.length, 3);
    // 实报 0：是"已计价的实际零值"，不是缺失
    assert.equal(rows[0]!.reportedPromptTokens, 0);
    assert.equal(rows[0]!.reportedCompletionTokens, 0);
    assert.equal(rows[0]!.promptSource, "provider");
    assert.equal(rows[0]!.completionSource, "provider");
    assert.equal(rows[0]!.promptTokens, 0);
    assert.equal(rows[0]!.usageEstimated, false);
    // 混合：prompt 实报，completion 估算补齐并标记
    assert.equal(rows[1]!.reportedPromptTokens, 321);
    assert.equal(rows[1]!.promptSource, "provider");
    assert.equal(rows[1]!.reportedCompletionTokens, undefined);
    assert.equal(rows[1]!.completionSource, "estimated");
    assert.ok((rows[1]!.completionTokens ?? 0) > 0);
    assert.equal(rows[1]!.usageEstimated, true);
    // 缺失：两段都估算，实报字段为 undefined（不写成 0）
    assert.equal(rows[2]!.promptSource, "estimated");
    assert.equal(rows[2]!.reportedPromptTokens, undefined);
    assert.equal(rows[2]!.reportedCompletionTokens, undefined);

    const insights = telemetry.sessionInsights(session.id);
    assert.equal(insights.totals.promptEstimated, 1);
    assert.equal(insights.totals.completionEstimated, 2);
    assert.equal(insights.totals.promptMissing, 0);
  });

  test("T3: 幂等键去重——同一 (session, run, seq) 只落一行", async () => {
    const store = new InMemoryRequestTelemetryStore();
    const record = {
      sessionId: "s-dedupe",
      runId: "run-d",
      requestSeq: 1,
      attempt: 1,
      providerId: "p",
      modelId: "m",
      createdAt: new Date().toISOString(),
      outcome: "sent" as const,
      breakdown: fixedBreakdown(),
      budget: breakEvenBudget,
      compaction: null,
      usageEstimated: false,
      rate: null,
    };
    assert.equal(store.insertIfAbsent(record), true);
    assert.equal(store.insertIfAbsent({ ...record, modelId: "other" }), false);
    assert.equal(store.countBySession("s-dedupe"), 1);
    assert.equal(store.listBySession("s-dedupe", 5, 0)[0]?.modelId, "m");

    // SQLite 适配器同语义
    assert.equal(app.telemetryStore.insertIfAbsent(record), true);
    assert.equal(app.telemetryStore.insertIfAbsent(record), false);
    assert.equal(app.telemetryStore.countBySession("s-dedupe"), 1);
    app.telemetryStore.purgeSession("s-dedupe");
    assert.equal(app.telemetryStore.countBySession("s-dedupe"), 0);
  });

  test("T4: 准备未发送（预算不足）→ not_sent，无用量、不计费用", async () => {
    const model = new FakeModelClient().enqueue(assistantOutput("不应被调用"));
    const service = buildService(model, { modelId: "not-sent-model" });
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 1, 90000);
    const result = await service.continueTurn(session.id, "req-not-sent", { runId: "run-not-sent" });
    assert.equal(result.error?.code, "context_budget_insufficient");
    assert.equal(model.assistantCalls, 0);

    const rows = app.telemetryStore.listBySession(session.id, 10, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.outcome, "not_sent");
    assert.equal(rows[0]!.errorCode, "context_budget_insufficient");
    assert.equal(rows[0]!.promptTokens, undefined);
    assert.equal(rows[0]!.completionTokens, undefined);
    assert.ok(rows[0]!.breakdown.totalTokens > rows[0]!.budget.inputBudgetTokens);
    // 未发送不计费用，也不进入费用分组
    const insights = app.telemetry.sessionInsights(session.id);
    assert.equal(insights.cost.session.length, 0);
    assert.equal(insights.totals.notSent, 1);
    assert.equal(insights.totals.breakdown.totalTokens, 0, "未发送的构建不计入输入累计");
    assert.equal(requestCost(rows[0]!), null);
  });

  test("T5: 调用失败 → failed + 原因码，费率存在也不推算费用", async () => {
    const rates = new InMemoryModelRateStore();
    rates.upsert({ providerId: "test-provider", model: "failing-model", currency: "CNY", inputPerMillion: 2, outputPerMillion: 8, updatedAt: new Date().toISOString() });
    const telemetry = new RequestTelemetryService({ store: app.telemetryStore, rates });
    const model = new FakeModelClient().enqueue(new Error("provider_error(500): upstream down"));
    const service = buildService(model, { modelId: "failing-model", telemetry });
    const session = await service.createSession({ notebookIds: [] });
    const result = await service.sendMessage(session.id, "req-fail", "分析", { runId: "run-fail" });
    assert.notEqual(result.status, "completed");

    const rows = app.telemetryStore.listBySession(session.id, 10, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.outcome, "failed");
    assert.equal(rows[0]!.errorCode, "provider_error");
    assert.equal(rows[0]!.promptTokens, undefined);
    assert.equal(requestCost(rows[0]!), null);
    const insights = telemetry.sessionInsights(session.id);
    assert.equal(insights.totals.failed, 1);
    assert.equal(insights.cost.session.length, 1);
    assert.equal(insights.cost.session[0]!.currency, "CNY");
    assert.equal(insights.cost.session[0]!.amount, null, "用量缺失时金额未知，不显示 0");
    assert.equal(insights.cost.session[0]!.missingUsageRequests, 1);
    assert.equal(insights.cost.session[0]!.pricedRequests, 0);
  });

  test("T6: 用户取消 → cancelled", async () => {
    const model = new FakeModelClient();
    const state = { abort: false };
    model.behavior = () => {
      state.abort = true;
      throw new Error("model_cancelled");
    };
    const service = buildService(model, { modelId: "cancel-model" });
    const session = await service.createSession({ notebookIds: [] });
    const result = await service.sendMessage(session.id, "req-cancel", "分析", {
      runId: "run-cancel",
      cancelCheck: () => state.abort,
    });
    assert.equal(result.finishReason, "cancelled");
    const rows = app.telemetryStore.listBySession(session.id, 10, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.outcome, "cancelled");
    assert.equal(rows[0]!.errorCode, "cancelled");
    assert.equal(requestCost(rows[0]!), null);
  });

  test("T7: 压缩关联——本轮新建 applied=true，复用 applied=false 且指向同一记录", async () => {
    const model = new FakeModelClient();
    const service = buildService(model, { modelId: "compaction-model" });
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 30);
    model.enqueue(assistantOutput("第一次"));
    await service.sendMessage(session.id, "req-c1", "分析", { runId: "run-c1" });
    const first = app.telemetryStore.listBySession(session.id, 10, 0)[0]!;
    assert.ok(first.compaction, "压缩后应记录关联");
    assert.equal(first.compaction!.applied, true);
    assert.equal(first.compaction!.triggerReason, "budget");
    assert.ok(first.breakdown.compactionTokens > 0, "摘要 token 单列");
    const compactionId = first.compaction!.id;
    assert.ok(compactionId);

    model.enqueue(assistantOutput("第二次"));
    await service.sendMessage(session.id, "req-c2", "继续", { runId: "run-c2" });
    const second = app.telemetryStore.listBySession(session.id, 10, 0)[0]!;
    assert.equal(second.compaction!.applied, false);
    assert.equal(second.compaction!.id, compactionId);
    // 复用同一摘要：摘要 token 不变，趋势点由分项变化体现（本轮新增问答使输入增长）
    assert.equal(second.breakdown.compactionTokens, first.breakdown.compactionTokens);
    const insights = app.telemetry.sessionInsights(session.id);
    const newest = insights.requests[0]!;
    assert.equal(typeof newest.deltaInputTokens, "number");
    assert.equal(newest.deltaInputTokens, newest.breakdown.totalTokens - insights.requests[1]!.breakdown.totalTokens);
  });
  test("T8: 服务商超限 → 两次真实请求（首次 failed、重试 attempt=2），不重复计费", async () => {
    const model = new FakeModelClient();
    const service = buildService(model, { modelId: "retry-model" });
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 12);
    model.enqueueMany([
      new Error("provider_error(400): This model's maximum context length is 8192 tokens"),
      assistantOutput("压缩后成功"),
    ]);
    const result = await service.sendMessage(session.id, "req-retry", "分析", { runId: "run-retry" });
    assert.equal(result.status, "completed");
    const rows = app.telemetryStore.listBySession(session.id, 10, 0).reverse();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.attempt), [1, 2]);
    assert.deepEqual(rows.map((row) => row.requestSeq), [1, 2]);
    assert.equal(rows[0]!.outcome, "failed");
    assert.equal(rows[0]!.errorCode, "context_limit");
    assert.equal(rows[0]!.promptTokens, undefined, "首次超限没有可确认用量");
    assert.equal(rows[1]!.outcome, "delivered");
    assert.equal(rows[1]!.compaction?.applied, true);
    const insights = app.telemetry.sessionInsights(session.id);
    assert.equal(insights.totals.failed, 1);
    assert.equal(insights.totals.delivered, 1);
    // 未配置费率：金额未知，失败那次单列为用量缺失
    assert.equal(insights.cost.session.length, 1);
    const bucket = insights.cost.session[0]!;
    assert.equal(bucket.currency, null);
    assert.equal(bucket.amount, null);
    assert.equal(bucket.pricedRequests, 0);
    assert.equal(bucket.missingUsageRequests, 1);
    assert.equal(bucket.requests, 2);
  });
});

describe("v2.14 §22：本地费用与日历聚合", () => {
  test("F1: 费率快照、费率变更、零费率、无费率、跨午夜与币种隔离", () => {
    const store = new InMemoryRequestTelemetryStore();
    const rates = new InMemoryModelRateStore();
    let clock = new Date(2026, 10, 15, 23, 59, 30);
    const telemetry = new RequestTelemetryService({ store, rates, now: () => clock });
    const sessionId = "s-cost";
    const begin = (modelId: string, seq: number) =>
      telemetry.beginCall({
        sessionId, runId: "run-cost", requestSeq: seq, attempt: 1,
        providerId: "p1", modelId, outcome: "sent",
        breakdown: fixedBreakdown(), budget: breakEvenBudget, compaction: null,
      });

    telemetry.setRate({ providerId: "p1", model: "m-cny", currency: "cny", inputPerMillion: 2, outputPerMillion: 8 });
    begin("m-cny", 1);
    telemetry.completeCall({ sessionId, runId: "run-cost", requestSeq: 1 }, {
      outcome: "delivered", promptTokens: 1_000_000, promptSource: "provider",
      completionTokens: 250_000, completionSource: "provider",
      reportedPromptTokens: 1_000_000, reportedCompletionTokens: 250_000, usageEstimated: false,
    });

    // 跨午夜后换模型与费率（币种不同）：历史行保留原快照
    clock = new Date(2026, 10, 16, 0, 0, 30);
    telemetry.setRate({ providerId: "p1", model: "m-cny", currency: "usd", inputPerMillion: 1, outputPerMillion: 4 });
    begin("m-cny", 2);
    telemetry.completeCall({ sessionId, runId: "run-cost", requestSeq: 2 }, {
      outcome: "delivered", promptTokens: 1_000_000, promptSource: "provider",
      completionTokens: 0, completionSource: "provider",
      reportedPromptTokens: 1_000_000, reportedCompletionTokens: 0, usageEstimated: false,
    });

    // 零费率（免费模型）：金额 0 但仍是"已计价"
    telemetry.setRate({ providerId: "p1", model: "m-free", currency: "CNY", inputPerMillion: 0, outputPerMillion: 0 });
    begin("m-free", 3);
    telemetry.completeCall({ sessionId, runId: "run-cost", requestSeq: 3 }, {
      outcome: "delivered", promptTokens: 5000, promptSource: "provider",
      completionTokens: 1000, completionSource: "provider", usageEstimated: false,
    });

    // 未配置费率
    begin("m-unknown", 4);
    telemetry.completeCall({ sessionId, runId: "run-cost", requestSeq: 4 }, {
      outcome: "delivered", promptTokens: 1000, promptSource: "estimated",
      completionTokens: 100, completionSource: "estimated", usageEstimated: true,
    });

    const rows = store.listBySession(sessionId, 10, 0);
    const bySeq = new Map(rows.map((row) => [row.requestSeq, row]));
    const firstCost = requestCost(bySeq.get(1)!);
    assert.equal(firstCost?.currency, "CNY");
    assert.equal(firstCost?.amount, 4, "1M×2 + 0.25M×8 = 4 CNY（历史快照不受后续改价影响）");
    const secondCost = requestCost(bySeq.get(2)!);
    assert.equal(secondCost?.currency, "USD");
    assert.equal(secondCost?.amount, 1);
    const freeCost = requestCost(bySeq.get(3)!);
    assert.equal(freeCost?.amount, 0, "零费率是有效零费用");
    assert.equal(freeCost?.currency, "CNY");
    assert.equal(requestCost(bySeq.get(4)!), null, "无费率 → 金额未知");

    const insights = telemetry.sessionInsights(sessionId, {
      now: new Date(2026, 10, 16, 9, 0, 0),
      days: 2,
      limit: 10,
    });
    // 会话口径：按币种分组，不混币
    const currencies = insights.cost.session.map((bucket) => bucket.currency);
    assert.deepEqual(currencies, ["CNY", "USD", null], "未配置费率的请求单列且排在最后");
    const cny = insights.cost.session.find((bucket) => bucket.currency === "CNY")!;
    assert.equal(cny.amount, 4, "CNY 只累计 CNY 请求（含零费率 0）");
    assert.equal(cny.pricedRequests, 2);
    const usd = insights.cost.session.find((bucket) => bucket.currency === "USD")!;
    assert.equal(usd.amount, 1);
    assert.equal(usd.pricedRequests, 1);
    const unpriced = insights.cost.session.find((bucket) => bucket.currency === null)!;
    assert.equal(unpriced.amount, null);
    assert.equal(unpriced.unpricedRequests, 1);

    // 本地日历：两天两个桶，跨午夜的行落在各自日期
    assert.equal(insights.cost.days.length, 2);
    assert.deepEqual(insights.cost.days.map((day) => day.date), ["2026-11-15", "2026-11-16"]);
    const firstDay = insights.cost.days[0]!;
    const firstDayCurrencies = firstDay.buckets.map((bucket) => bucket.currency);
    assert.deepEqual(firstDayCurrencies, ["CNY"], "跨午夜前的请求只计入前一天");
    assert.equal(firstDay.buckets[0]!.amount, 4);
    // 今日（第二天的本地日历）只含第二天的 3 条
    assert.equal(insights.cost.today.reduce((sum, bucket) => sum + bucket.requests, 0), 3);
    assert.equal(insights.cost.today.find((bucket) => bucket.currency === "USD")?.amount, 1);

    // 费率校验
    assert.equal(validateModelRate({ providerId: "p", model: "m", currency: "元", inputPerMillion: 1, outputPerMillion: 1 }).ok, false);
    assert.equal(validateModelRate({ providerId: "p", model: "m", currency: "CNY", inputPerMillion: -1, outputPerMillion: 1 }).ok, false);
    assert.equal(validateModelRate({ providerId: "p", model: "m", currency: "CNY", inputPerMillion: "", outputPerMillion: 1 }).ok, false);
    assert.equal(validateModelRate({ providerId: "p", model: "m", currency: "CNY", inputPerMillion: "0", outputPerMillion: 1 }).ok, true);
  });

  test("F2: 分页有界、倒序，越界参数被钳制", () => {
    const store = new InMemoryRequestTelemetryStore();
    const telemetry = new RequestTelemetryService({ store, now: () => new Date(2026, 10, 16, 12, 0, 0) });
    const sessionId = "s-page";
    for (let seq = 1; seq <= 60; seq++) {
      telemetry.beginCall({
        sessionId, runId: "run-page", requestSeq: seq, attempt: 1,
        providerId: "p", modelId: "m", outcome: "sent",
        breakdown: fixedBreakdown(100 + seq), budget: breakEvenBudget, compaction: null,
      });
    }
    const clamped = telemetry.sessionInsights(sessionId, { limit: 500, offset: -5 });
    assert.equal(clamped.limit, 50);
    assert.equal(clamped.offset, 0);
    assert.equal(clamped.requests.length, 50);
    assert.equal(clamped.requestCount, 60);
    assert.equal(clamped.hasMore, true);

    const page2 = telemetry.sessionInsights(sessionId, { limit: 50, offset: 50 });
    assert.equal(page2.requests.length, 10);
    assert.equal(page2.hasMore, false);
    // 页内每条（除最旧一条）都能算出与上一条的增量；最旧一条没有更早请求 → 无增量
    assert.equal(typeof page2.requests[0]!.deltaInputTokens, "number");
    assert.equal(page2.requests[page2.requests.length - 1]!.deltaInputTokens, null);
    // 值域钳制
    const huge = telemetry.sessionInsights(sessionId, { days: 999, offset: 100000 });
    assert.equal(huge.windowDays, 30);
    assert.equal(huge.offset, 500);

    // 增长/跌落双向趋势：压缩后输入回落时 delta 为负
    const dropStore = new InMemoryRequestTelemetryStore();
    const dropTelemetry = new RequestTelemetryService({ store: dropStore, now: () => new Date(2026, 10, 16, 12, 0, 0) });
    const dropSession = "s-drop";
    dropTelemetry.beginCall({
      sessionId: dropSession, runId: "run-drop", requestSeq: 1, attempt: 1, providerId: "p", modelId: "m",
      outcome: "sent", breakdown: fixedBreakdown(900), budget: breakEvenBudget, compaction: null,
    });
    dropTelemetry.beginCall({
      sessionId: dropSession, runId: "run-drop", requestSeq: 2, attempt: 2, providerId: "p", modelId: "m",
      outcome: "sent", breakdown: fixedBreakdown(300), budget: breakEvenBudget,
      compaction: { id: "cmp-1", applied: true, triggerReason: "context_limit" },
    });
    const drop = dropTelemetry.sessionInsights(dropSession);
    assert.equal(drop.requests[0]!.deltaInputTokens, -600);
    assert.equal(drop.requests[0]!.attempt, 2, "重试尝试保留 attempt 序号");
    assert.equal(drop.requests[0]!.compaction!.triggerReason, "context_limit");
  });
});

describe("v2.14 §22：生命周期与迁移", () => {
  test("M1: 旧库（v12）升级后可用；历史请求不回填", async (t) => {
    const folder = mkdtempSync(join(tmpdir(), "cardlink-telemetry-migration-"));
    const file = join(folder, "harness.sqlite");
    let db = openDatabase(file);
    t.after(() => {
      db.close?.();
      rmSync(folder, { recursive: true, force: true });
    });
    const first = createHarnessApp(app.config, { driver: db });
    const model = new FakeModelClient().enqueue(assistantOutput("旧库请求"));
    const service = buildService(model, { modelId: "migration-model", app: first });
    const session = await service.createSession({ notebookIds: [] });
    await service.sendMessage(session.id, "req-old", "分析", { runId: "run-old" });
    assert.equal(first.telemetryStore.countBySession(session.id), 1);

    // 模拟 v12 旧库：移除 v13 新增表与迁移记录
    db.exec(`
      DROP TABLE assistant_requests;
      DROP TABLE model_rates;
      DELETE FROM schema_migrations WHERE version >= 13;
    `);
    db.close?.();

    db = openDatabase(file);
    const reopened = createHarnessApp(app.config, { driver: db });
    // 升级后表可用，但旧请求没有明细 → 不回填假数据
    assert.equal(reopened.telemetryStore.countBySession(session.id), 0);
    const empty = reopened.telemetry.sessionInsights(session.id);
    assert.equal(empty.requestCount, 0);
    assert.deepEqual(empty.requests, []);
    assert.equal(empty.cost.session.length, 0);
    // 新调用可正常记录
    const model2 = new FakeModelClient().enqueue(assistantOutput("新库请求"));
    const restarted = buildService(model2, { modelId: "migration-model", app: reopened });
    await restarted.continueTurn(session.id, "req-new", { runId: "run-new" });
    assert.equal(reopened.telemetryStore.countBySession(session.id), 1);
    reopened.telemetry.setRate({ providerId: "test-provider", model: "migration-model", currency: "CNY", inputPerMillion: 1, outputPerMillion: 2 });
    assert.equal(reopened.telemetry.getRate("test-provider", "migration-model")?.currency, "CNY");
  });

  test("M2: 会话隔离；软删除保留遥测，彻底删除清除", async () => {
    const model = new FakeModelClient();
    const service = buildService(model, { modelId: "isolation-model" });
    const sessionA = await service.createSession({ notebookIds: [] });
    const sessionB = await service.createSession({ notebookIds: [] });
    model.enqueueMany([assistantOutput("A"), assistantOutput("B")]);
    await service.sendMessage(sessionA.id, "req-a", "A", { runId: "run-a" });
    await service.sendMessage(sessionB.id, "req-b", "B", { runId: "run-b" });

    const insightsA = app.telemetry.sessionInsights(sessionA.id);
    const insightsB = app.telemetry.sessionInsights(sessionB.id);
    assert.equal(insightsA.requestCount, 1);
    assert.equal(insightsB.requestCount, 1);
    assert.equal(insightsA.requests[0]!.runId, "run-a");
    assert.equal(insightsB.requests[0]!.runId, "run-b");

    // 软删除：会话从列表消失，但遥测与审计同生命周期保留
    await service.deleteSession(sessionA.id);
    assert.equal(app.telemetryStore.countBySession(sessionA.id), 1);
    assert.equal(app.telemetry.sessionInsights(sessionA.id).requestCount, 1);

    // 彻底删除：遥测随之清除
    await service.purgeSession(sessionA.id);
    assert.equal(app.telemetryStore.countBySession(sessionA.id), 0);
    assert.equal(app.telemetry.sessionInsights(sessionA.id).requestCount, 0);
    assert.equal(app.telemetryStore.countBySession(sessionB.id), 1);
  });

  test("M3: 不复制正文、OCR 与密钥（只存计量元数据）", async () => {
    const secret = "sk-telemetry-should-not-appear";
    const privateText = "用户原题 OCR 正文不得复制";
    const model = new FakeModelClient();
    const service = buildService(model, { modelId: "privacy-model" });
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueMany([
      assistantOutput("查询", [{ id: "privacy-call", name: "getMistakeDetail", arguments: { recordId: "bookA0000000000000000000000001:/noteP01", includeText: true } }]),
      assistantOutput(`结论：${privateText} ${secret}`),
    ]);
    await service.setReviewLevel(session.id, "full_allow");
    await service.sendMessage(session.id, `req-privacy-${privateText}`, "分析", { runId: "run-privacy" });
    const dump = JSON.stringify(app.db.rows("SELECT * FROM assistant_requests WHERE session_id = ?", [session.id]));
    assert.ok(dump.length > 0);
    assert.doesNotMatch(dump, new RegExp(privateText));
    assert.doesNotMatch(dump, new RegExp(secret));
    // 也不存压缩摘要正文
    assert.doesNotMatch(dump, /历史压缩/);
  });
});

describe("v2.14 §22：桥命令（只读查询与本地费率）", () => {
  test("B1: 查询校验、费率读写与列表", async () => {
    const handler = createBridgeHandler({
      service: app.service,
      repository: app.repository,
      runStore: app.runStore,
      telemetry: app.telemetry,
    });
    const missing = await handler("harness.getContextInsights", {});
    assert.equal(missing.ok, false);
    assert.equal(missing.error?.code, "invalid_args");
    const unknown = await handler("harness.getContextInsights", { sessionId: "nope-session" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error?.code, "not_found");

    const session = await app.service.createSession({ notebookIds: [] });
    const empty = await handler("harness.getContextInsights", { sessionId: session.id, limit: 5 });
    assert.equal(empty.ok, true);
    const data = empty.data as { requestCount: number; limit: number; cost: { scope: string } };
    assert.equal(data.requestCount, 0);
    assert.equal(data.limit, 5);
    assert.equal(data.cost.scope, "assistant_requests");

    const set = await handler("harness.setModelRate", {
      providerId: "cardlink-device", model: "deepseek-chat", currency: "cny", inputPerMillion: 2, outputPerMillion: 8,
    });
    assert.equal(set.ok, true);
    const get = await handler("harness.getModelRate", { providerId: "cardlink-device", model: "DeepSeek-Chat" });
    assert.equal(get.ok, true);
    assert.equal((get.data as { rate: { currency: string } }).rate.currency, "CNY");
    const list = await handler("harness.listModelRates", {});
    assert.equal(list.ok, true);
    assert.ok((list.data as unknown[]).length >= 1);

    const invalid = await handler("harness.setModelRate", {
      providerId: "cardlink-device", model: "deepseek-chat", currency: "元", inputPerMillion: 1, outputPerMillion: 1,
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error?.code, "invalid_args");

    const cleared = await handler("harness.clearModelRate", { providerId: "cardlink-device", model: "deepseek-chat" });
    assert.equal(cleared.ok, true);
    assert.equal((cleared.data as { cleared: boolean }).cleared, true);
    const after = await handler("harness.getModelRate", { providerId: "cardlink-device", model: "deepseek-chat" });
    assert.equal((after.data as { rate: unknown }).rate, null);
  });

  test("B2: 未装配遥测时命令显式不可用（不静默返回空数据）", async () => {
    const handler = createBridgeHandler({ service: app.service, repository: app.repository });
    const res = await handler("harness.getContextInsights", { sessionId: "x" });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, "not_available");
  });
});
