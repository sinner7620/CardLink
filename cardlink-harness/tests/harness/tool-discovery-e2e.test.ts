import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import * as F from "../fixtures/discovery-data.ts";
import type { ReviewLevel } from "../../src/domain/session.ts";

/**
 * v2.13 §9.2 / H1-T43：新参数走实际模型 Schema、PolicyGuard 与 ToolExecutor 的端到端闭环。
 * 场景：按内容检索 → 分页 → 单题分段读题干 → 最近几次复习 → 带证据的回答。
 */

const BAD_CALLS = [
  { id: "bad-empty-query", name: "queryMistakes", arguments: { contentQuery: "" } },
  { id: "bad-too-many-ids", name: "queryMistakes", arguments: { recordIds: Array.from({ length: 11 }, (_, index) => `bookM0000000000000000000000000001:n${index}`) } },
  { id: "bad-segment", name: "getMistakeDetail", arguments: { recordId: F.DISCOVERY_RECORD_M1, content: { field: "question", limit: 4001 } } },
];

function makeStack(): { app: HarnessApp; model: FakeModelClient } {
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
      limits: { maxIterations: 6, maxToolCallsPerTurn: 8, toolTimeoutMs: 3000, contextBudgetChars: 0 },
    },
    { driver, model },
  );
  return { app, model };
}

type Scenario = {
  app: HarnessApp;
  model: FakeModelClient;
  result: { status: string; message?: string; evidenceRefs?: string[]; runId?: string };
  sessionId: string;
  snapshotId: string;
};

async function runScenario(level: ReviewLevel): Promise<Scenario> {
  const { app, model } = makeStack();
  const imported = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "discovery-e2e", exportedAt: "2026-11-16T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotA(),
  });
  const snapshotId = imported.snapshotId;
  const session = await app.service.createSession({ notebookIds: [] });
  if (level !== "provenance") await app.service.setReviewLevel(session.id, level);

  const queue: unknown[] = [
    { text: "先按内容检索", toolCalls: [...BAD_CALLS, { id: "e2e-q1", name: "queryMistakes", arguments: { contentQuery: " 傅里叶变换 ", limit: 2 } }] },
  ];
  if (level !== "full_allow") queue.push({ approved: true, reason: "内容检索与请求一致" });
  queue.push({
    text: "读这道题的题干",
    toolCalls: [{ id: "e2e-d1", name: "getMistakeDetail", arguments: { recordId: F.DISCOVERY_RECORD_M1, content: { field: "question", offset: 0, limit: 12 } } }],
  });
  if (level === "strict") queue.push({ approved: true, reason: "strict 档下钻也审核" });
  queue.push({
    text: "看最近几次复习",
    toolCalls: [{ id: "e2e-h1", name: "getReviewHistory", arguments: { recordId: F.DISCOVERY_RECORD_M1, order: "desc", limit: 1 } }],
  });
  if (level === "strict") queue.push({ approved: true, reason: "strict 档下钻也审核" });
  queue.push({
    text: `按内容找到{{card:ref_1 ${F.DISCOVERY_RECORD_M1}}}，题干首段与最近一次复习见上。`,
    toolCalls: [],
  });
  model.enqueueMany(queue);
  const result = (await app.service.sendMessage(session.id, `req-discovery-${level}`, "找一下傅里叶变换的题，读题干和最近一次复习")) as Scenario["result"];
  return { app, model, result, sessionId: session.id, snapshotId };
}

describe("v2.13 §9.2 / H1-T43: 新工具路径端到端（FakeModel）", () => {
  test("工具真实执行、链式单题证据引用、同一 run 快照锁定", async () => {
    const { app, model, result, sessionId, snapshotId } = await runScenario("provenance");
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.ok(result.runId);

    // 只有 queryMistakes（新数据访问）经过 Reviewer；两次单题下钻按 provenance 档免审。
    assert.equal(model.reviewerCalls, 1);

    // 三个新参数调用都真实执行并落 tool_calls；非法用法由确定性门拒绝。
    const calls = app.runStore.listToolCalls(result.runId!);
    const executed = calls.filter((call) => call.executionStatus === "executed");
    const denied = calls.filter((call) => call.executionStatus !== "executed");
    const byName = new Map(executed.map((call) => [call.toolName, call]));
    assert.deepEqual([...byName.keys()].sort(), ["getMistakeDetail", "getReviewHistory", "queryMistakes"], JSON.stringify(calls));
    assert.ok(executed.every((call) => call.policyStatus === "pass"));
    assert.equal(denied.length, BAD_CALLS.length, "非法新参数不执行");
    assert.ok(denied.every((call) => call.policyStatus === "invalid_args"));
    const detail = JSON.parse(byName.get("getMistakeDetail")!.resultJson ?? "{}") as {
      data?: { contentSegment?: { field?: string; text?: string }; record?: Record<string, unknown> };
      evidence?: { recordIds?: string[]; snapshotId?: string };
    };
    assert.equal(detail.data?.contentSegment?.field, "question");
    assert.ok((detail.data?.contentSegment?.text ?? "").length > 0);
    assert.equal("questionText" in (detail.data?.record ?? {}), false, "分段模式不带完整题干");
    const history = JSON.parse(byName.get("getReviewHistory")!.resultJson ?? "{}") as {
      data?: { order?: string; events?: Array<{ at?: string }> };
    };
    assert.equal(history.data?.order, "desc");
    assert.equal(history.data?.events?.length, 1);

    // 同一 run 快照锁定：运行记录与全部已执行工具结果指向同一快照。
    assert.equal(app.runStore.get(result.runId!)?.snapshotId, snapshotId);
    for (const call of executed) {
      const envelope = JSON.parse(call.resultJson ?? "{}") as { evidence?: { snapshotId?: string } };
      assert.equal(envelope.evidence?.snapshotId, snapshotId);
      assert.ok(call.evidenceJson, "成功调用落证据行");
      const evidenceRow = JSON.parse(call.evidenceJson ?? "{}") as { snapshotId?: string };
      assert.equal(evidenceRow.snapshotId, snapshotId);
    }

    // 链式证据引用：列表读到的 recordId 是单题下钻的证据来源，最终回答引用同一 recordId。
    const listResult = JSON.parse(byName.get("queryMistakes")!.resultJson ?? "{}") as { evidence?: { recordIds?: string[] } };
    assert.ok(listResult.evidence?.recordIds?.includes(F.DISCOVERY_RECORD_M1));
    assert.deepEqual(detail.evidence?.recordIds, [F.DISCOVERY_RECORD_M1]);
    assert.ok(result.evidenceRefs?.includes(F.DISCOVERY_RECORD_M1));
    assert.match(result.message ?? "", /《傅里叶变换的基本性质》/, "引用被解析为真实标题");

    // 确定性门仍拒绝新参数的非法用法（与档位无关）。
    const audit = app.auditLog.listBySession(sessionId);
    const byId = new Map(audit.map((row) => [row.toolCallId, row]));
    for (const bad of BAD_CALLS) {
      const row = byId.get(bad.id);
      assert.ok(row, `${bad.id} 应有审计行`);
      assert.equal(row?.policyStatus, "invalid_args");
      assert.equal(row?.executionStatus, "not_executed");
    }
    assert.equal(byId.get("e2e-q1")?.reviewerApproved, true);
    const skipped = app.db.rows(
      "SELECT tool_call_id, reviewer_approved, reviewer_reason, execution_status FROM tool_audit WHERE session_id = ?",
      [sessionId],
    ) as Array<{ tool_call_id: string; reviewer_approved: number | null; reviewer_reason: string | null; execution_status: string }>;
    const skippedRow = skipped.find((row) => row.tool_call_id === "e2e-d1");
    assert.equal(skippedRow?.execution_status, "executed");
    assert.equal(skippedRow?.reviewer_approved, null, "免审调用不冒充已审核");
    assert.equal(skippedRow?.reviewer_reason, "tier_skip: provenance");
  });

  test("strict 档对新路径同样全部双审，full_allow 档仅确定性门", async () => {
    const strict = await runScenario("strict");
    assert.equal(strict.result.status, "completed");
    assert.equal(strict.model.reviewerCalls, 3, "strict：列表 + 两次下钻全部审核");

    const allowed = await runScenario("full_allow");
    assert.equal(allowed.result.status, "completed");
    assert.equal(allowed.model.reviewerCalls, 0, "full_allow：Reviewer 零调用");
    const calls = allowed.app.runStore.listToolCalls(allowed.result.runId!);
    assert.equal(calls.filter((call) => call.executionStatus === "executed").length, 3);
    const audit = allowed.app.auditLog.listBySession(allowed.sessionId);
    assert.deepEqual(audit.filter((row) => row.policyStatus === "invalid_args").length, BAD_CALLS.length);
    for (const row of audit.filter((row) => row.executionStatus === "executed")) {
      assert.equal(row.reviewerApproved, undefined, "免审/完全允许都不冒充已审核");
    }
  });
});
