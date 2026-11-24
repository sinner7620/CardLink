import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { InMemorySessionStore, InMemoryAuditLog } from "../fixtures/in-memory-stores.ts";
import { AgentService } from "../../src/application/agent-service.ts";
import { AssistantRole } from "../../src/application/assistant-role.ts";
import { ReviewerRole } from "../../src/application/reviewer-role.ts";
import { ContextBuilder } from "../../src/application/context-builder.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { ToolExecutor } from "../../src/application/tool-executor.ts";
import { EvidenceValidator } from "../../src/application/evidence-validator.ts";
import { SyncService } from "../../src/application/sync-service.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";
import {
  collectSessionRecordIds,
  effectiveReviewLevel,
  provenanceHitOf,
  shouldReview,
  summarizeCallChain,
} from "../../src/application/review-policy.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { Session } from "../../src/domain/session.ts";
import type { ToolResult } from "../../src/domain/message.ts";
import type { ModelSetting } from "../../src/domain/model-setting.ts";

const RECORD_A1 = "bookA0000000000000000000000000001:noteA001";
// queryMistakes(limit:5) 首页首个 recordId（fixture 标题字符串序，仓储排序行为由仓储测试钉住）。
const RECORD_FIRST_PAGE = "bookA0000000000000000000000000001:noteA010";
const UNKNOWN_RECORD = "bookZ0000000000000000000000000009:noteXYZ999";
const SETTING: ModelSetting = { provider: "test", model: "fake", effort: "low", timeoutMs: 1000, maxOutputTokens: 1024 };

let app: HarnessApp;

before(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "fixture", exportedAt: "2026-11-14T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
});

function buildService(opts: {
  model?: FakeModelClient;
  store?: InMemorySessionStore;
  audit?: InMemoryAuditLog;
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
    config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
    assistantSetting: SETTING,
    reviewerSetting: SETTING,
  });
  return { service, model, audit, store };
}

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }>): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

describe("v2.2 §10.1: 审核档位判定（纯函数）", () => {
  test("溯源集合收集自 tool_result 包络证据字段", () => {
    const messages = [
      { type: "user", id: "u1", text: "q", createdAt: "t" },
      { type: "tool_result", id: "t1", toolCallId: "c1", status: "ok", createdAt: "t",
        content: { ok: true, tool: "queryMistakes", evidence: { recordIds: [RECORD_A1], snapshotId: "s", dataAsOf: "d" } } },
      { type: "tool_result", id: "t2", toolCallId: "c2", status: "denied", createdAt: "t",
        content: { ok: false, tool: "getMistakeDetail", error: { code: "denied", message: "x" } } },
    ] as Session["messages"];
    const ids = collectSessionRecordIds(messages);
    assert.ok(ids.has(RECORD_A1));
    assert.equal(ids.size, 1);
  });

  test("provenance 档：下钻且可溯源免审；不可溯源/新访问仍审；strict 全审；full_allow 全免", () => {
    const provenance = new Set([RECORD_A1]);
    const detail = { name: "getMistakeDetail", arguments: { recordId: RECORD_A1 } };
    const novelDetail = { name: "getMistakeDetail", arguments: { recordId: UNKNOWN_RECORD } };
    const query = { name: "queryMistakes", arguments: { limit: 5 } };

    assert.deepEqual(shouldReview(detail, provenance, "provenance"), { review: false, skipReason: "tier_skip: provenance" });
    assert.deepEqual(shouldReview(novelDetail, provenance, "provenance"), { review: true });
    assert.deepEqual(shouldReview(query, provenance, "provenance"), { review: true });
    assert.deepEqual(shouldReview(detail, provenance, "strict"), { review: true });
    assert.deepEqual(shouldReview(query, new Set(), "full_allow"), { review: false, skipReason: "tier_skip: full_allow" });
  });

  test("缺省档位为 provenance；溯源命中判定对无 recordId 参数返回 undefined", () => {
    assert.equal(effectiveReviewLevel({}), "provenance");
    assert.equal(effectiveReviewLevel({ reviewLevel: "strict" }), "strict");
    assert.equal(provenanceHitOf({ name: "queryMistakes", arguments: {} }, new Set([RECORD_A1])), undefined);
    assert.equal(provenanceHitOf({ name: "getMistakeDetail", arguments: { recordId: RECORD_A1 } }, new Set([RECORD_A1])), true);
    assert.equal(provenanceHitOf({ name: "getMistakeDetail", arguments: { recordId: "x" } }, new Set([RECORD_A1])), false);
    assert.ok(summarizeCallChain([
      { type: "tool_result", id: "t1", toolCallId: "c1", status: "ok", createdAt: "t",
        content: { ok: true, tool: "queryMistakes", evidence: { snapshotId: "s", dataAsOf: "d" } } },
    ] as Session["messages"]).includes("queryMistakes(ok)"));
  });
});

describe("v2.2 §10.1: AgentService 三档行为（H1-T28/T29/T30）", () => {
  test("H1-T28: provenance 档（默认）——同轮下钻已返回 recordId 免审，不可溯源仍审", async () => {
    const { service, model, audit } = buildService();
    // queryMistakes 返回首页（含 RECORD_FIRST_PAGE）；随后的 getMistakeDetail(RECORD_FIRST_PAGE) 免审；
    // getMistakeDetail(UNKNOWN_RECORD) 是新读取，仍经 Reviewer。
    model.enqueueMany([
      assistantOutput("先查列表", [
        { id: "q1", name: "queryMistakes", arguments: { limit: 5 } },
        { id: "d1", name: "getMistakeDetail", arguments: { recordId: RECORD_FIRST_PAGE, includeText: true } },
        { id: "d2", name: "getMistakeDetail", arguments: { recordId: UNKNOWN_RECORD } },
      ]),
      { approved: true, reason: "列表查询与请求一致" },
      { approved: true, reason: "新记录读取与请求一致" },
      assistantOutput("完成。", []),
    ]);
    const session = await service.createSession({ notebookIds: [] });
    const result = await service.sendMessage(session.id, "req-t28", "看看错题和第一条的详情");
    assert.equal(result.status, "completed");
    assert.equal(model.reviewerCalls, 2, "溯源下钻免审：仅 queryMistakes 与未知 recordId 各审一次");
    const skipped = audit.byToolCallId("d1")[0];
    assert.ok(skipped && skipped.executionStatus === "executed");
    assert.equal(skipped?.reviewerApproved, undefined, "免审调用不得冒充已审核");
    assert.equal(skipped?.reviewerReason, "tier_skip: provenance");
    const reviewed = audit.byToolCallId("d2")[0];
    assert.ok(reviewed && reviewed.reviewerApproved === true, "不可溯源的新读取仍经审核");
  });

  test("H1-T28: provenance 档——跨轮下钻上轮返回的 recordId 免审", async () => {
    const { service, model, store } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    // 第一轮：queryMistakes（审核后执行）
    model.enqueueMany([
      assistantOutput("查列表", [{ id: "q2", name: "queryMistakes", arguments: { limit: 5 } }]),
      { approved: true, reason: "ok" },
      assistantOutput("列表如上。", []),
    ]);
    const turn1 = await service.sendMessage(session.id, "req-t28b-1", "我有哪些错题？");
    assert.equal(turn1.status, "completed");
    // 第二轮：下钻第一轮返回的记录——免审
    model.enqueueMany([
      assistantOutput("读详情", [{ id: "d3", name: "getMistakeDetail", arguments: { recordId: RECORD_FIRST_PAGE } }]),
      assistantOutput("详情如下。", []),
    ]);
    const turn2 = await service.sendMessage(session.id, "req-t28b-2", "读第一条的详情");
    assert.equal(turn2.status, "completed");
    assert.equal(model.reviewerCalls, 1, "跨轮溯源免审：仅第一轮 queryMistakes 审核");
    const after = await store.get(session.id) as Session;
    const detailResult = after.messages.find((m): m is ToolResult => m.type === "tool_result" && m.toolCallId === "d3");
    assert.ok(detailResult && detailResult.status === "ok");
  });

  test("H1-T28: strict 档——溯源可及的下钻仍然双审", async () => {
    const { service, model, store } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    await store.setReviewLevel(session.id, "strict");
    model.enqueueMany([
      assistantOutput("查列表", [{ id: "q3", name: "queryMistakes", arguments: { limit: 5 } }]),
      { approved: true, reason: "ok" },
      assistantOutput("读详情", [{ id: "d4", name: "getMistakeDetail", arguments: { recordId: RECORD_FIRST_PAGE } }]),
      { approved: true, reason: "strict 档下钻也审核" },
      assistantOutput("完成。", []),
    ]);
    const result = await service.sendMessage(session.id, "req-t28c", "查一下");
    assert.equal(result.status, "completed");
    assert.equal(model.reviewerCalls, 2, "strict 档全部双审");
  });

  test("H1-T29: full_allow 档——Reviewer 零参与，确定性门照常拦截", async () => {
    const { service, model, audit, store } = buildService();
    const session = await service.createSession({ notebookIds: ["bookA0000000000000000000000000001"] });
    await store.setReviewLevel(session.id, "full_allow");
    model.enqueueMany([
      assistantOutput("连查带越权", [
        { id: "ok-1", name: "getMistakeStats", arguments: {} },
        { id: "ok-2", name: "getMistakeDetail", arguments: { recordId: RECORD_A1, includeText: true } },
        { id: "bad-scope", name: "queryMistakes", arguments: { notebookIds: ["bookZ0000000000000000000000000001"] } },
        { id: "bad-tool", name: "executeSQL", arguments: { sql: "DELETE FROM mistake_projection" } },
        { id: "bad-args", name: "getMistakeDetail", arguments: { recordId: RECORD_A1, evilExtra: 1 } },
      ]),
      assistantOutput("汇总。", []),
    ]);
    const result = await service.sendMessage(session.id, "req-t29", "全面分析");
    assert.equal(result.status, "completed");
    assert.equal(model.reviewerCalls, 0, "完全允许档 Reviewer 不参与");
    const executed = audit.byToolCallId("ok-1")[0];
    assert.ok(executed && executed.executionStatus === "executed" && executed.reviewerApproved === undefined);
    assert.equal(audit.byToolCallId("ok-2")[0]?.reviewerReason, "tier_skip: full_allow");
    const scopeRow = audit.byToolCallId("bad-scope")[0];
    assert.ok(scopeRow && scopeRow.policyStatus === "scope_escape" && scopeRow.executionStatus === "denied");
    const toolRow = audit.byToolCallId("bad-tool")[0];
    assert.ok(toolRow && toolRow.policyStatus === "unknown_tool");
    const argsRow = audit.byToolCallId("bad-args")[0];
    assert.ok(argsRow && argsRow.policyStatus === "invalid_args");
  });

  test("H1-T30: setReviewLevel 校验非法值、持久化档位，旧会话按默认读取", async () => {
    const { service, store } = buildService();
    const session = await service.createSession({ notebookIds: [] });
    await assert.rejects(() => service.setReviewLevel(session.id, "yolo"), /reviewLevel/);
    await assert.rejects(() => service.setReviewLevel("missing-session", "strict"), /会话不存在/);
    const set = await service.setReviewLevel(session.id, "full_allow");
    assert.equal(set.reviewLevel, "full_allow");
    const after = await store.get(session.id) as Session;
    assert.equal(after.reviewLevel, "full_allow");
    // 旧会话（存储行无档位）经 service 读取时按默认 provenance 生效
    const legacy = await service.createSession({ notebookIds: [] });
    const raw = await store.get(legacy.id) as Session;
    raw.reviewLevel = undefined;
    await store.create(raw);
    assert.equal(effectiveReviewLevel((await store.get(legacy.id)) as Session), "provenance");
  });
});
