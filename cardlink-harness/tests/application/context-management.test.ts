import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { openDatabase, NodeSqliteDriver } from "../../src/adapters/sqlite/node-driver.ts";
import { migrate } from "../../src/adapters/sqlite/db.ts";
import { estimateContextInput } from "../../src/application/token-estimator.ts";
import { newUserMessage } from "../../src/domain/message.ts";
import { AgentService } from "../../src/application/agent-service.ts";
import { AssistantRole } from "../../src/application/assistant-role.ts";
import { ReviewerRole } from "../../src/application/reviewer-role.ts";
import { ContextBuilder } from "../../src/application/context-builder.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { ToolExecutor } from "../../src/application/tool-executor.ts";
import { EvidenceValidator } from "../../src/application/evidence-validator.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

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

/** 直接向会话追加 N 轮大体积工具结果（绕过用户输入长度校验，模拟长会话）。 */
let seedSeq = 0;
async function seedLongSession(sessionId: string, turns: number, fillerChars = 5000, localApp = app): Promise<void> {
  // 每批使用唯一前缀：消息 id 在生产中为 UUID，重复 id 会干扰压缩切点定位。
  const prefix = `seed${++seedSeq}`;
  for (let i = 0; i < turns; i++) {
    const at = new Date(Date.now() + i * 1000).toISOString();
    await localApp.store.append(sessionId, { type: "user", id: `${prefix}-u-${i}`, text: `第 ${i + 1} 轮：请分析相关错题。`, createdAt: at });
    await localApp.store.append(sessionId, {
      type: "assistant",
      id: `${prefix}-a-${i}`,
      text: "我查询一下。",
      toolCalls: [{ id: `${prefix}-call-${i}`, name: "queryMistakes", arguments: { limit: 5 } }],
      createdAt: at,
    });
    await localApp.store.append(sessionId, {
      type: "tool_result",
      id: `${prefix}-t-${i}`,
      toolCallId: `${prefix}-call-${i}`,
      status: "ok",
      content: {
        ok: true,
        tool: "queryMistakes",
        data: { records: [{ recordId: `bookA0000000000000000000000001:note${String(i).padStart(3, "0")}` }], nextCursor: null },
        evidence: {
          recordIds: [`bookA0000000000000000000000001:note${String(i).padStart(3, "0")}`],
          snapshotId: "snap-long",
          dataAsOf: "2026-11-15T00:00:00Z",
        },
        filler: "x".repeat(fillerChars),
      },
      createdAt: at,
    });
  }
}

/** 独立装配：共享 app 的存储/能力/压缩，模型可脚本化。 */
let serviceSeq = 0;
function buildLocalService(model: FakeModelClient, modelId = `unknown-model-${++serviceSeq}`, localApp = app): AgentService {
  const builder = new ContextBuilder();
  return new AgentService({
    store: localApp.store,
    model,
    assistant: new AssistantRole(builder, localApp.registry.definitions()),
    reviewer: new ReviewerRole(builder, localApp.registry),
    guard: new PolicyGuard(localApp.registry, 8),
    executor: new ToolExecutor(localApp.registry, 3000),
    evidenceValidator: new EvidenceValidator(localApp.repository),
    auditLog: localApp.auditLog,
    repository: localApp.repository,
    evidenceStore: localApp.evidenceStore,
    runStore: localApp.runStore,
    capabilities: localApp.capabilities,
    compactions: localApp.compactions,
    config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
    // 保守默认 32K/8K 下，16K 输出请求被限制为 8K。
    assistantSetting: { provider: "test-provider", model: modelId, effort: "low", timeoutMs: 1000, maxOutputTokens: 16384 },
    reviewerSetting: { provider: "test-provider", model: modelId, effort: "low", timeoutMs: 1000, maxOutputTokens: 1024 },
  });
}

describe("v2.5 §5.2/§11.1：用量、预算与持久化压缩（AgentService）", () => {
  test("U1: 服务商返回用量 → estimated=false 并落 Run 记录", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({ finishReason: "completed", usage: { promptTokens: 120, completionTokens: 30 }, value: assistantOutput("完整回答") });
    const result = await service.sendMessage(session.id, "req-u1", "问题", { runId: "run-u1" });
    assert.equal(result.usage?.estimated, false);
    assert.equal(result.usage?.promptTokens, 120);
    assert.equal(result.usage?.completionTokens, 30);
    assert.equal(result.usage?.totalTokens, 150);
    assert.ok(result.context);
    assert.ok((result.context?.inputBudgetTokens ?? 0) > 0);
    const run = app.runStore.get("run-u1");
    assert.equal(run?.usage?.totalTokens, 150);
  });

  test("U2: 服务商不返回用量 → estimated=true，不伪造精确值", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    model.enqueue(assistantOutput("回答"));
    const result = await service.sendMessage(session.id, "req-u2", "问题");
    assert.equal(result.usage?.estimated, true);
    assert.ok((result.usage?.promptTokens ?? 0) > 0);
  });

  test("U3: 估算器按 provider+model 校准并持久化", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model, "calibration-model");
    const session = await service.createSession({ notebookIds: [] });
    model.enqueueDetailed({ finishReason: "completed", usage: { promptTokens: 100, completionTokens: 10 }, value: assistantOutput("ok") });
    await service.sendMessage(session.id, "req-u3", "问题");
    const resolved = app.capabilities.resolve("test-provider", "calibration-model");
    assert.ok((resolved.calibrationRatio ?? 0) > 0);
  });

  test("C1: 长会话预算压缩——摘要进入 instruction、记录持久化、原文不删", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 30);
    const beforeMessages = (await service.getSession(session.id))?.messages.length ?? 0;

    model.enqueue(assistantOutput("分析完成"));
    const result = await service.sendMessage(session.id, "req-c1", "继续分析");
    assert.equal(result.status, "completed");

    const firstCall = model.calls[0]?.context;
    assert.ok(firstCall);
    assert.match(firstCall?.instruction ?? "", /\[历史压缩\]/);
    // 摘要不伪装用户消息
    assert.ok(!(firstCall?.messages ?? []).some((m) => m.type === "user" && String((m as { text?: string }).text).startsWith("[历史压缩]")));
    // 压缩记录可查询（持久化）
    assert.ok(app.compactionStore.count(session.id) >= 1);
    const latest = app.compactionStore.latest(session.id);
    assert.ok(latest);
    const stored = await service.getSession(session.id);
    // 原文不删：既有消息仍在 + 本轮 user/assistant 追加
    assert.ok((stored?.messages.length ?? 0) > beforeMessages);
    assert.ok(stored?.messages.some((m) => m.id === latest?.firstKeptMessageId));
    // 上下文用量回传
    assert.ok((result.context?.inputBudgetTokens ?? 0) > 0);
    assert.ok((result.context?.compactionCount ?? 0) >= 1);
    // 摘要不是证据：必须明确要求重新查询统计
    assert.match(firstCall?.instruction ?? "", /不是新的证据/);
    // 压缩记录锁定本次运行的快照（而非工具结果自报的快照）
    assert.ok(latest.snapshotId);
    assert.equal(latest.triggerReason, "budget");
    assert.equal(latest.lastCompressedSequenceNo, stored?.messages.findIndex((m) => m.id === latest.firstKeptMessageId));
    assert.equal(latest.summaryHash, createHash("sha256").update(latest.summary).digest("hex"));
    assert.equal(result.context?.compactionStatus, "compacted");
    assert.equal(result.context?.compactionTriggerTokens, 17408);
    assert.equal(model.calls[0]?.setting.maxOutputTokens, 8192);
    assert.equal(latest.tokensAfter, estimateContextInput(firstCall));
    const { id, createdAt, ...duplicate } = latest;
    const saved = app.compactions.record(duplicate);
    assert.equal(saved.inserted, false);
    assert.equal(saved.record.id, id);
    assert.equal(app.compactionStore.count(session.id), 1);
    const audits = app.db.rows("SELECT args_summary FROM tool_audit WHERE session_id = ? AND tool_name = ?", [session.id, "context_compaction"]);
    assert.equal(audits.length, 1);
    assert.doesNotMatch(String(audits[0]?.args_summary), /用户请求|请分析相关错题/);
  });

  test("C1b: 多次连续压缩——新记录覆盖更长前缀，摘要保留更早轮次", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 30);
    model.enqueue(assistantOutput("第一次"));
    const initial = await service.sendMessage(session.id, "req-c1b-1", "分析");
    const firstCount = app.compactionStore.count(session.id);
    const first = app.compactionStore.latest(session.id);
    assert.ok(first);

    // 将有效输入增长到软阈值与硬上限之间，验证无需等到硬上限才推进切点。
    assert.ok(initial.context?.compactionTriggerTokens);
    const growth = initial.context.compactionTriggerTokens - initial.context.estimatedInputTokens + 500;
    await app.store.append(session.id, newUserMessage("新".repeat(growth)));
    model.enqueue(assistantOutput("第二次"));
    const next = await service.sendMessage(session.id, "req-c1b-2", "继续");
    const secondCount = app.compactionStore.count(session.id);
    assert.ok(secondCount > firstCount, `应产生新的压缩记录：${firstCount} → ${secondCount}`);
    const latest = app.compactionStore.latest(session.id);
    assert.ok(latest);
    assert.notEqual(latest.firstKeptMessageId, first.firstKeptMessageId);
    assert.ok((latest.tokensBefore ?? 0) > initial.context.compactionTriggerTokens);
    assert.ok((latest.tokensBefore ?? Infinity) < initial.context.inputBudgetTokens);
    assert.equal(next.context?.compactionStatus, "compacted");
    // v2.5.1：摘要按切点前原文重算，不嵌套旧摘要（避免层层膨胀）。
    assert.ok(!(latest?.summary ?? "").includes("更早轮次摘要"));
    assert.ok((latest?.summary.length ?? 0) < (first?.summary.length ?? 0) * 3);
  });

  test("C1c: 连续工具调用在软阈值内复用摘要和切点", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 30);
    model.enqueue(assistantOutput("第一次"));
    await service.sendMessage(session.id, "req-c1c-1", "分析");
    const countAfterFirst = app.compactionStore.count(session.id);
    const first = app.compactionStore.latest(session.id);
    assert.ok(first);

    await service.setReviewLevel(session.id, "full_allow");
    model.reset().enqueueMany([
      assistantOutput("查询", [{ id: "first", name: "queryMistakes", arguments: { limit: 1 } }]),
      assistantOutput("统计", [{ id: "second", name: "getMistakeStats" }]),
      assistantOutput("第二次"),
    ]);
    const result = await service.sendMessage(session.id, "req-c1c-2", "继续");
    assert.equal(result.status, "completed");
    assert.equal(result.context?.compactionStatus, "reused");
    assert.equal(model.assistantCalls, 3);
    for (const { context } of model.calls) {
      assert.ok(context.instruction.endsWith(first.summary));
      assert.equal(context.messages[0]?.id, first.firstKeptMessageId);
      const calls = context.messages.flatMap((m) => m.type === "assistant" ? m.toolCalls.map((c) => c.id) : []);
      const results = context.messages.flatMap((m) => m.type === "tool_result" ? [m.toolCallId] : []);
      assert.deepEqual(results, calls);
    }
    assert.equal(app.compactionStore.count(session.id), countAfterFirst);
  });

  test("C2: 从 v10 SQLite 文件重启后复用原有摘要与切点", async (t) => {
    const folder = mkdtempSync(join(tmpdir(), "cardlink-compaction-"));
    const file = join(folder, "harness.sqlite");
    let db = openDatabase(file);
    t.after(() => {
      db.close?.();
      rmSync(folder, { recursive: true, force: true });
    });
    const firstApp = createHarnessApp(app.config, { driver: db });
    const model = new FakeModelClient().enqueue(assistantOutput("第一次"));
    const service = buildLocalService(model, "restart-model", firstApp);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 30, 5000, firstApp);
    await service.sendMessage(session.id, "req-c2a", "分析");
    const original = firstApp.compactionStore.latest(session.id);
    assert.ok(original);
    // 模拟 b19 留下的 v10 表结构：按 v10 参考库自动移除 v11+ 的加法列/新表，
    // 这样后续版本继续走加法迁移时该回归不会被新的列名写死（真实 v10 库没有这些对象）。
    const reference = new NodeSqliteDriver(new DatabaseSync(":memory:"));
    migrate(reference, 10);
    const referenceTables = reference.rows("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => String(row.name)).filter((name) => !name.startsWith("sqlite_"));
    const referenceSet = new Set(referenceTables);
    const currentTables = db.rows("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => String(row.name)).filter((name) => !name.startsWith("sqlite_"));
    for (const table of currentTables) {
      if (table !== "schema_migrations" && !referenceSet.has(table)) db.exec(`DROP TABLE IF EXISTS "${table}"`);
    }
    for (const table of referenceTables) {
      const referenceColumns = new Set(
        reference.rows(`PRAGMA table_info("${table}")`).map((row) => String(row.name)),
      );
      const currentColumns = db.rows(`PRAGMA table_info("${table}")`).map((row) => String(row.name));
      for (const column of currentColumns) {
        if (!referenceColumns.has(column)) db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      }
    }
    db.exec("DELETE FROM schema_migrations WHERE version >= 11;");
    db.close?.();

    db = openDatabase(file);
    const reopened = createHarnessApp(app.config, { driver: db });
    const prior = reopened.compactionStore.latest(session.id);
    assert.equal(prior?.summaryHash, undefined);
    const model2 = new FakeModelClient().enqueue(assistantOutput("第二次"));
    const restarted = buildLocalService(model2, "restart-model", reopened);
    const next = await restarted.continueTurn(session.id, "req-c2b");
    const context = model2.calls[0]?.context;
    assert.ok(context);
    assert.ok(context.instruction.endsWith(original.summary));
    assert.equal(context.messages[0]?.id, original.firstKeptMessageId);
    assert.equal(next.context?.compactionStatus, "reused");
    assert.equal(next.context?.estimatedInputTokens, estimateContextInput(context));
    assert.equal(reopened.compactionStore.count(session.id), 1);
    assert.equal(reopened.compactionStore.latest(session.id)?.id, original.id);
  });

  test("C3: 服务商 context_limit → 压缩后重试一次并成功", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 12);
    model.enqueueMany([
      new Error("provider_error(400): This model's maximum context length is 8192 tokens"),
      assistantOutput("压缩后成功"),
    ]);
    const result = await service.sendMessage(session.id, "req-c3", "分析");
    assert.equal(result.status, "completed");
    assert.equal(model.assistantCalls, 2);
    const retryContext = model.calls[1]?.context.instruction ?? "";
    assert.match(retryContext, /\[历史压缩\]/);
    assert.ok(estimateContextInput(model.calls[1].context) < estimateContextInput(model.calls[0].context));
    assert.equal(app.compactionStore.latest(session.id)?.triggerReason, "context_limit");
  });

  test("C4: context_limit 重试后仍失败 → finishReason=context_limit，不标完成", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 12);
    model.enqueueMany([
      new Error("provider_error(400): maximum context length exceeded"),
      new Error("provider_error(400): maximum context length exceeded"),
    ]);
    const result = await service.sendMessage(session.id, "req-c4", "分析");
    assert.equal(result.finishReason, "context_limit");
    assert.notEqual(result.status, "completed");
    assert.equal(model.assistantCalls, 2);
  });

  test("C4b: 工具返回后再次服务商超限，同轮不会重试第二次", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 8, 3500);
    await service.setReviewLevel(session.id, "full_allow");
    const overflow = new Error("provider_error(400): maximum context length exceeded");
    model.enqueueMany([
      overflow,
      assistantOutput("继续查询", [{ id: "lookup", name: "queryMistakes", arguments: { limit: 1 } }]),
      overflow,
    ]);
    const result = await service.sendMessage(session.id, "req-c4b", "分析");
    assert.equal(result.finishReason, "context_limit");
    assert.equal(model.assistantCalls, 3);
    assert.equal(app.compactionStore.count(session.id), 1);
    assert.equal(app.compactionStore.latest(session.id)?.triggerReason, "context_limit");
  });

  test("模型从 128K 切到 32K，按新预算重新评估", async () => {
    app.capabilities.setUserOverride({
      providerId: "test-provider", modelId: "wide", contextWindowTokens: 131072, maxOutputTokens: 8192,
    });
    const wideModel = new FakeModelClient().enqueue(assistantOutput("宽窗口"));
    const wide = buildLocalService(wideModel, "wide");
    const session = await wide.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 20, 3500);
    const first = await wide.sendMessage(session.id, "wide", "分析");
    assert.equal(first.context?.compactionStatus, "none");

    const narrowModel = new FakeModelClient().enqueue(assistantOutput("窄窗口"));
    const narrow = buildLocalService(narrowModel, "narrow");
    const result = await narrow.sendMessage(session.id, "narrow", "继续");
    assert.equal(result.context?.compactionTriggerTokens, 17408);
    assert.equal(result.context?.compactionStatus, "compacted");
    assert.equal(app.compactionStore.count(session.id), 1);
  });

  test("预算估算采用裁剪过的工具结果，单轮超硬上限时不调用模型", async () => {
    const model = new FakeModelClient().enqueue(assistantOutput("继续"));
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 12, 14000);
    const first = await service.sendMessage(session.id, "tool-truncation", "分析");
    assert.equal(first.context?.compactionStatus, "none");
    assert.equal(first.context?.estimatedInputTokens, estimateContextInput(model.calls[0].context));
    assert.ok(model.calls[0].context.messages.some((m) => m.type === "tool_result" && (m.content as { contentTruncated?: boolean }).contentTruncated));

    const singleTurn = await service.createSession({ notebookIds: [] });
    await seedLongSession(singleTurn.id, 1, 90000);
    const blocked = await service.continueTurn(singleTurn.id, "oversized");
    assert.equal(blocked.error?.code, "context_budget_insufficient");
    assert.equal(blocked.context?.compactionStatus, "insufficient");
    assert.equal(model.assistantCalls, 1);
    assert.equal(app.compactionStore.count(singleTurn.id), 0);
  });

  test("C5: 小会话不压缩（预算内保留原文）", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 5, 100);
    model.enqueue(assistantOutput("ok"));
    await service.sendMessage(session.id, "req-c5", "分析");
    const instruction = model.calls[0]?.context.instruction ?? "";
    assert.ok(!instruction.includes("[历史压缩]"));
  });

  test("C6: 彻底删除会话时压缩记录随之清除（模型能力保留）", async () => {
    const model = new FakeModelClient();
    const service = buildLocalService(model);
    const session = await service.createSession({ notebookIds: [] });
    await seedLongSession(session.id, 30);
    model.enqueue(assistantOutput("ok"));
    await service.sendMessage(session.id, "req-c6", "分析");
    assert.ok(app.compactionStore.count(session.id) >= 1);
    await service.purgeSession(session.id);
    assert.equal(app.compactionStore.count(session.id), 0);
  });
});
