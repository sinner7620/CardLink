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
import { snapshot1 } from "../fixtures/fixture-data.ts";
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

function buildService(opts: {
  model?: FakeModelClient;
  store?: InMemorySessionStore;
  audit?: InMemoryAuditLog;
  maxIterations?: number;
} = {}): { service: AgentService; model: FakeModelClient; audit: InMemoryAuditLog; store: InMemorySessionStore } {
  const model = opts.model ?? new FakeModelClient();
  const store = opts.store ?? new InMemorySessionStore();
  const audit = opts.audit ?? new InMemoryAuditLog();
  const builder = new ContextBuilder();
  const service = new AgentService({
    store,
    model,
    assistant: new AssistantRole(builder, app.registry.definitions()),
    reviewer: new ReviewerRole(builder, app.registry),
    guard: new PolicyGuard(app.registry, 8),
    executor: new ToolExecutor(app.registry, 3000),
    evidenceValidator: new EvidenceValidator(app.repository),
    auditLog: audit,
    repository: app.repository,
    config: { maxIterations: opts.maxIterations ?? 4, maxToolCallsPerTurn: 8 },
    assistantSetting: SETTING,
    reviewerSetting: SETTING,
  });
  return { service, model, audit, store };
}

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }> = []): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

describe("P0（v2.4 §11.1）：继续生成 continueTurn", () => {
  test("C1: 迭代上限后续答 → 工具不重复执行，最终完成", async () => {
    const { service, model, audit } = buildService({ maxIterations: 1 });
    const session = await service.createSession({ notebookIds: [] });
    const call = makeToolCall("queryMistakes", { limit: 5 });
    model.enqueueMany([
      assistantOutput("", [{ id: call.id, name: "queryMistakes" }]),
      { approved: true, reason: "溯源链正常" },
    ]);
    const first = await service.sendMessage(session.id, "req-c1", "列出到期错题");
    assert.equal(first.finishReason, "iteration_limit");
    const auditsBefore = audit.rows.filter((r) => r.executionStatus === "executed").length;
    assert.equal(auditsBefore, 1);

    // 续答：模型给出最终回答（不再请求工具）
    model.reset();
    model.enqueue(assistantOutput("到期错题共 N 条。"));
    const second = await service.continueTurn(session.id, "req-c1-cont");
    assert.equal(second.status, "completed");
    assert.equal(second.finishReason, "completed");
    // 已执行工具未被重复执行（审计行数不变）
    const auditsAfter = audit.rows.filter((r) => r.executionStatus === "executed").length;
    assert.equal(auditsAfter, auditsBefore);
    // 会话收尾状态
    const stored = await service.getSession(session.id);
    assert.equal(stored?.status, "completed");
  });

  test("C2: 输出截断（纯文本）后续答 → 合成“继续”消息进上下文但不落库", async () => {
    const { service, model, store } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({ finishReason: "output_limit", value: assistantOutput("前半段回答") });
    await service.sendMessage(session.id, "req-c2", "问题");

    model.reset();
    let capturedContext: unknown = null;
    model.behavior = (context) => {
      capturedContext = context;
      return assistantOutput("后半段回答");
    };
    const second = await service.continueTurn(session.id, "req-c2-cont");
    assert.equal(second.status, "completed");

    // 合成继续消息进入模型上下文（最后一条，user 角色，含“继续”）
    const ctx = capturedContext as { messages: Array<{ type: string; text?: string }> } | null;
    assert.ok(ctx);
    const last = ctx.messages.at(-1);
    assert.ok(last && last.type === "user" && typeof last.text === "string" && last.text.includes("继续"));

    // 不落库：会话消息不含合成消息；两条 assistant 消息（截断 + 续答）都保留
    const stored = await store.get(session.id);
    assert.ok(stored);
    assert.ok(!stored.messages.some((m) => m.type === "user" && (m as { text?: string }).text?.includes("继续生成未完成")));
    const assistantTexts = stored.messages.filter((m) => m.type === "assistant").map((m) => (m as { text?: string }).text);
    assert.deepEqual(assistantTexts, ["前半段回答", "后半段回答"]);
  });

  test("C3: 最后一条是 tool_result 时续答 → 不注入合成消息", async () => {
    const { service, model } = buildService({ maxIterations: 1 });
    const session = await service.createSession({ notebookIds: [] });
    const call = makeToolCall("queryMistakes", { limit: 5 });
    model.enqueueMany([
      assistantOutput("", [{ id: call.id, name: "queryMistakes" }]),
      { approved: true, reason: "溯源链正常" },
    ]);
    await service.sendMessage(session.id, "req-c3", "问题");

    model.reset();
    let capturedContext: unknown = null;
    model.behavior = (context) => {
      capturedContext = context;
      return assistantOutput("根据工具结果回答。");
    };
    const second = await service.continueTurn(session.id, "req-c3-cont");
    assert.equal(second.status, "completed");
    const ctx = capturedContext as { messages: Array<{ type: string }> } | null;
    assert.ok(ctx);
    assert.equal(ctx.messages.at(-1)?.type, "tool_result");
  });

  test("C4: continueTurn 会话不存在 → 结构化错误", async () => {
    const { service } = buildService();
    await assert.rejects(
      () => service.continueTurn("no-such-session", "req-c4"),
      /会话不存在/,
    );
  });

  test("C5: 已删除会话拒绝续答与新消息", async () => {
    const { service } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    await service.deleteSession(session.id);
    await assert.rejects(() => service.sendMessage(session.id, "req-c5", "问题"), /已删除/);
    await assert.rejects(() => service.continueTurn(session.id, "req-c5-cont"), /已删除/);
  });

  test("C6: requestId 幂等——同一 requestId 重复续答返回缓存结果", async () => {
    const { service, model } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({ finishReason: "output_limit", value: assistantOutput("前半段") });
    await service.sendMessage(session.id, "req-c6", "问题");
    model.reset();
    model.enqueue(assistantOutput("后半段"));
    const a = await service.continueTurn(session.id, "req-c6-cont");
    const b = await service.continueTurn(session.id, "req-c6-cont");
    assert.equal(a.status, "completed");
    assert.deepEqual(b, a);
    // 模型只被调用一次（第二次命中缓存）
    assert.equal(model.assistantCalls, 1);
  });
});
