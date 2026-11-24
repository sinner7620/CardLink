import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp, makeToolCall } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { InMemorySessionStore, InMemoryAuditLog } from "../fixtures/in-memory-stores.ts";
import { AgentService } from "../../src/application/agent-service.ts";
import { AssistantRole } from "../../src/application/assistant-role.ts";
import { ReviewerRole } from "../../src/application/reviewer-role.ts";
import { ContextBuilder } from "../../src/application/context-builder.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { ToolExecutor } from "../../src/application/tool-executor.ts";
import { EvidenceValidator } from "../../src/application/evidence-validator.ts";
import { CitationResolver } from "../../src/application/citation-resolver.ts";
import { ToolRegistry } from "../../src/application/tool-registry.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { ModelSetting } from "../../src/domain/model-setting.ts";
import type { FinishReason } from "../../src/domain/finish-reason.ts";

const SETTING: ModelSetting = { provider: "test", model: "fake", effort: "low", timeoutMs: 1000, maxOutputTokens: 1024 };

let app: HarnessApp;

before(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
});

/** v2.4 §11.1：截断工具结果桩——同名白名单工具返回 truncated 包络（仅本测试注册表使用）。 */
function registryWithTruncatedQuery(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "queryMistakes",
      description: "测试桩：返回 truncated 包络",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      resultSchema: {},
      permission: "mistakes:read",
    },
    run: async (_args, ctx) => ({
      ok: true,
      tool: "queryMistakes",
      data: { records: [], nextCursor: null },
      evidence: { snapshotId: ctx.snapshotId, dataAsOf: new Date().toISOString() },
      truncated: true,
    }),
  });
  return registry;
}

function buildService(opts: {
  model?: FakeModelClient;
  store?: InMemorySessionStore;
  audit?: InMemoryAuditLog;
  registry?: ToolRegistry;
  maxIterations?: number;
} = {}): { service: AgentService; model: FakeModelClient; audit: InMemoryAuditLog; store: InMemorySessionStore } {
  const model = opts.model ?? new FakeModelClient();
  const store = opts.store ?? new InMemorySessionStore();
  const audit = opts.audit ?? new InMemoryAuditLog();
  const builder = new ContextBuilder();
  const registry = opts.registry ?? app.registry;
  const service = new AgentService({
    store,
    model,
    assistant: new AssistantRole(builder, registry.definitions()),
    reviewer: new ReviewerRole(builder, registry),
    guard: new PolicyGuard(registry, 8),
    executor: new ToolExecutor(registry, 3000),
    evidenceValidator: new EvidenceValidator(app.repository),
    auditLog: audit,
    repository: app.repository,
    runStore: app.runStore,
    citationResolver: new CitationResolver(app.repository),
    config: { maxIterations: opts.maxIterations ?? 4, maxToolCallsPerTurn: 8 },
    assistantSetting: SETTING,
    reviewerSetting: SETTING,
  });
  return { service, model, audit, store };
}

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }> = []): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

describe("P0（v2.4 §11.1）：FinishReason 细分", () => {
  test("F1: 正常完成 → completed，continuable 为假", async () => {
    const { service, model } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueue(assistantOutput("完整回答"));
    const result = await service.sendMessage(session.id, "req-f1", "问题");
    assert.equal(result.status, "completed");
    assert.equal(result.finishReason, "completed");
    assert.notEqual(result.continuable, true);
  });

  test("F2: 输出截断（finish_reason=length，纯文本）→ limit_reached + continuable，已生成内容保留", async () => {
    const { service, model, store } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({ finishReason: "output_limit", value: assistantOutput("这是被截断的部分回答") });
    const result = await service.sendMessage(session.id, "req-f2", "问题");
    // b19-1：纯文本截断不是"完成"——会话与结果都不得标为 completed。
    assert.equal(result.status, "limit_reached");
    assert.equal(result.finishReason, "output_limit");
    assert.equal(result.continuable, true);
    // 已生成内容保留：截断文本已持久化为 assistant 消息
    const stored = await store.get(session.id);
    const last = stored?.messages.at(-1);
    assert.equal(last?.type, "assistant");
    assert.equal((last as { text?: string })?.text, "这是被截断的部分回答");
    // 会话状态为 interrupted（可续答），消息上带 finishReason 供重开会话后提示
    assert.equal(stored?.status, "interrupted");
    assert.equal((last as { finishReason?: string })?.finishReason, "output_limit");
  });

  test("F2b: 截断文本中的引用标记同样被解析（不把 {{card:…}} 原样落库）", async () => {
    const { service, model, store } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({
      finishReason: "output_limit",
      value: assistantOutput("建议复习 {{card:ref_1|bookA0000000000000000000000000001:noteFAKE99}}，但"),
    });
    const result = await service.sendMessage(session.id, "req-f2b", "问题");
    assert.equal(result.status, "limit_reached");
    const stored = await store.get(session.id);
    const last = stored?.messages.filter((m) => m.type === "assistant").at(-1) as { text?: string } | undefined;
    assert.ok(last);
    assert.ok(!last.text?.includes("{{card:"), "截断回答不得残留引用标记");
    assert.match(last.text ?? "", /引用不可用/);
  });

  test("F3: 输出截断且带工具调用 → 工具调用整体作废不执行（Pi 教训），output_limit", async () => {
    const { service, model, audit } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    const call = makeToolCall("queryMistakes", { limit: 5 });
    model.enqueueDetailed({ finishReason: "output_limit", value: assistantOutput("先查数据", [{ id: call.id, name: "queryMistakes" }]) });
    const result = await service.sendMessage(session.id, "req-f3", "问题");
    assert.equal(result.finishReason, "output_limit");
    assert.equal(result.continuable, true);
    assert.notEqual(result.status, "completed");
    // 截断消息里的调用不得执行：无审计行、无工具结果
    assert.equal(audit.rows.length, 0);
    const stored = await store_get(service, session.id);
    assert.ok(!stored.messages.some((m) => m.type === "tool_result"));
  });

  test("F4: 迭代上限 → iteration_limit + continuable", async () => {
    const { service, model } = buildService({ maxIterations: 1 });
    const session = await service.createSession({ notebookIds: [] });
    const call = makeToolCall("queryMistakes", { limit: 5 });
    model.enqueueMany([
      assistantOutput("", [{ id: call.id, name: "queryMistakes" }]),
      { approved: true, reason: "溯源链正常" },
    ]);
    const result = await service.sendMessage(session.id, "req-f4", "问题");
    assert.equal(result.status, "limit_reached");
    assert.equal(result.finishReason, "iteration_limit");
    assert.equal(result.continuable, true);
  });

  test("F5: 迭代上限且最后工具结果被截断 → tool_result_truncated", async () => {
    const { service, model } = buildService({ registry: registryWithTruncatedQuery(), maxIterations: 1 });
    const session = await service.createSession({ notebookIds: [] });
    const call = makeToolCall("queryMistakes", {});
    model.enqueueMany([
      assistantOutput("", [{ id: call.id, name: "queryMistakes" }]),
      { approved: true, reason: "溯源链正常" },
    ]);
    const result = await service.sendMessage(session.id, "req-f5", "问题");
    assert.equal(result.status, "limit_reached");
    assert.equal(result.finishReason, "tool_result_truncated");
    assert.equal(result.continuable, true);
  });

  test("F6: 模型调用超时 → timeout", async () => {
    const { service, model } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueue(new Error("model_timeout: 超过 30000ms"));
    const result = await service.sendMessage(session.id, "req-f6", "问题");
    assert.equal(result.status, "error");
    assert.equal(result.finishReason, "timeout");
    assert.equal(result.continuable, true);
  });

  test("F7: 服务商错误 → provider_error", async () => {
    const { service, model } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueue(new Error("provider_error(401): invalid api key"));
    const result = await service.sendMessage(session.id, "req-f7", "问题");
    assert.equal(result.status, "error");
    assert.equal(result.finishReason, "provider_error");
    assert.equal(result.continuable, true);
  });

  test("F8: 单轮上下文无法继续压缩 → context_limit，不原样重试", async () => {
    const { service, model } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueue(new Error("provider_error(400): This model's maximum context length is 8192 tokens"));
    const result = await service.sendMessage(session.id, "req-f8", "问题");
    assert.equal(result.finishReason, "context_limit");
    assert.equal(model.assistantCalls, 1);
  });

  test("F9: 用户取消 → cancelled + continuable", async () => {
    const { service } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    const result = await service.sendMessage(session.id, "req-f9", "问题", { cancelCheck: () => true });
    assert.equal(result.status, "error");
    assert.equal(result.finishReason, "cancelled");
    assert.equal(result.continuable, true);
  });

  test("F10: finishReason 落入 Run 记录（runStore.finish 携带）", async () => {
    const { service, model } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({ finishReason: "output_limit", value: assistantOutput("截断") });
    const result = await service.sendMessage(session.id, "req-f10", "问题", { runId: "run-f10" });
    const record = app.runStore.get("run-f10");
    assert.ok(record);
    assert.equal(record?.finishReason, "output_limit");
    assert.equal(result.finishReason, "output_limit");
  });
});

/** 辅助：从 service 读会话（经 store）。 */
async function store_get(service: AgentService, sessionId: string) {
  const session = await service.getSession(sessionId);
  assert.ok(session);
  return session;
}
