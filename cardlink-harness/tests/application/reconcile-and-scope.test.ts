import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { createHarnessApp } from "../../src/bootstrap.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { InMemoryRoleConfigStore } from "../../src/application/ports/role-config-store.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { makeApp, makeToolCall } from "../helpers/harness.ts";
import { newMessageId } from "../../src/domain/message.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

/**
 * b11 修正回归：
 * ① 恢复路径（reconcile）此前直接用基础 reviewerSetting（设备上 model 为空 →
 *    reviewer_failed: ModelSetting.model 缺失 → 工具被拒），必须同样应用角色配置覆盖；
 * ② 审核者上下文的会话范围表述：空 notebookIds = 全部笔记本（未限定），
 *    原始 JSON 空数组会被审核者模型误读为"无授权"而错误拒绝只读查询。
 */

function assistantWithToolCall(call: { id: string; name: string; arguments?: unknown }) {
  return {
    type: "assistant" as const,
    id: newMessageId(),
    text: "",
    toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments ?? {} }],
    createdAt: new Date().toISOString(),
  };
}

describe("b11: 恢复路径角色覆盖 + 空范围表述", () => {
  test("悬空调用恢复时,审核者调用应用角色配置的模型", async () => {
    const driver = openDatabase(":memory:");
    const roles = new InMemoryRoleConfigStore();
    roles.set("reviewer", { providerId: "p1", model: "reviewer-role-model", credentialRef: "k1", timeoutMs: 5000, maxOutputTokens: 512 });
    const model = new FakeModelClient();
    const app = createHarnessApp(
      { bind: "127.0.0.1", port: 0, httpToken: "t",
        // 设备形态:基础装配的 model 为空(路由+角色覆盖提供真实模型)
        model: { provider: "openai-compatible", baseUrl: "", apiKey: "", name: "", reviewerName: "", effortAssistant: "medium", effortReviewer: "low", timeoutMs: 5000, maxOutputTokens: 512, providerId: "p1", credentialRef: "k1" },
        storage: { database: ":memory:" },
        limits: { maxIterations: 4, maxToolCallsPerTurn: 8, toolTimeoutMs: 3000, contextBudgetChars: 0 } },
      { driver, model, roleConfigStore: roles },
    );
    await app.syncService.importSnapshot({ schemaVersion: 1, sourceId: "fx", exportedAt: "2026-11-14T08:00:00+08:00", isFullSnapshot: true, records: snapshot1() });
    const session = await app.service.createSession({ notebookIds: [] });
    // 制造悬空调用(模拟崩溃残留:assistant 发起工具调用但无终结结果)
    await app.store.append(session.id, assistantWithToolCall(makeToolCall("getMistakeStats", {})));
    model.enqueueMany([
      { approved: true, reason: "ok" },                    // 恢复路径 Reviewer
      { text: "统计完成。", toolCalls: [] },                // 主循环 Assistant
    ]);
    const result = await app.service.sendMessage(session.id, "req-b11", "继续", {});
    assert.equal(result.status, "completed", JSON.stringify(result));
    // 恢复路径的审核者调用必须带角色配置的模型(修复前:model 为空 → assertModelSetting 抛)
    const reviewerCalls = model.calls.filter((c) => c.context.outputType.name === "tool_call_decision");
    assert.ok(reviewerCalls.length >= 1);
    assert.equal(reviewerCalls[0]!.setting.model, "reviewer-role-model", "恢复路径审核者应用角色模型");
  });

  test("审核者上下文:空范围表述为全部笔记本,而非空数组 JSON", async () => {
    const app = makeApp();
    const session = await app.service.createSession({ notebookIds: [] });
    const builder = app.registry ? null : null;
    void builder;
    const { ContextBuilder } = await import("../../src/application/context-builder.ts");
    const builder2 = new ContextBuilder();
    const definition = { name: "queryMistakes", description: "查询错题", parameters: {}, resultSchema: {}, permission: "mistakes:read" as const };
    const ctx = builder2.buildReviewerContext(
      { id: session.id, messages: [], createdAt: session.createdAt, updatedAt: session.updatedAt, scope: { notebookIds: [] }, snapshotId: "s", status: "active" },
      makeToolCall("queryMistakes", {}),
      definition,
      { notebookIds: [] },
    );
    const text = ctx.messages[0]?.type === "user" ? ctx.messages[0].text : "";
    assert.match(text, /全部笔记本/);
    assert.ok(!text.includes('{"notebookIds":[]}'), "不得再给模型原始空数组");
    const nonEmpty = builder2.buildReviewerContext(
      { id: session.id, messages: [], createdAt: session.createdAt, updatedAt: session.updatedAt, scope: { notebookIds: ["bookA"] }, snapshotId: "s", status: "active" },
      makeToolCall("queryMistakes", {}),
      definition,
      { notebookIds: ["bookA"] },
    );
    const text2 = nonEmpty.messages[0]?.type === "user" ? nonEmpty.messages[0].text : "";
    assert.match(text2, /授权笔记本 ID: bookA/);
  });
});
