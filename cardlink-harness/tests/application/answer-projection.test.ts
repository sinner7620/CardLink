import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import type { ToolEnvelope } from "../../src/domain/evidence.ts";
import type { SnapshotExportPayload } from "../../src/adapters/cardlink/snapshot-importer.ts";

/**
 * v2.16 §6.1/§9.2 / H1-T44：设备答案正文投影的持久化与读取边界。
 *
 * 插件侧投影（真实索引 + 精确绑定）由 `src/answer-projection.ts` 的纯函数单测覆盖；
 * 这里按插件 `withAnswerProjection()` 的实际输出形态构造快照载荷，验证：
 * 持久化、A/B 快照隔离、默认详情与 Reviewer 不泄漏、同轮窄分段可读、缺失/歧义/越权。
 */

const NOTEBOOK_MAIN = "bookMain000000000000000000000001";
const NOTEBOOK_ANS = "bookAns0000000000000000000000002";
const NOTEBOOK_OTHER_ANS = "bookAns0000000000000000000000003";

function record(recordId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const [notebookId, noteId] = recordId.split(":");
  return {
    recordId,
    sourceNotebookId: notebookId,
    sourceNoteId: noteId,
    sourceAvailable: true,
    sourceTitle: `题目 ${noteId}`,
    sourceNotebookTitle: "数学",
    sourcePathTitles: ["第一章"],
    categoryPath: ["数学", "第一章"],
    manualCategories: [],
    customTags: [],
    reasonTags: ["计算"],
    favorite: false,
    errorReasons: [{ key: "计算", label: "计算错误" }],
    level: 0,
    reviewCount: 1,
    reviewCompleted: false,
    nextReviewAt: "2026-11-20T00:00:00.000Z",
    lastReviewedAt: "2026-11-16T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
    history: [{ at: "2026-11-01T00:00:00.000Z", level: 0 }],
    ocr: { effectiveText: `题干 ${noteId}`, status: "complete" },
    ...overrides,
  };
}

const R1 = `${NOTEBOOK_MAIN}:noteR1`;
const R2 = `${NOTEBOOK_MAIN}:noteR2`;
const R3 = `${NOTEBOOK_MAIN}:noteR3`;
const R4 = `${NOTEBOOK_MAIN}:noteR4`;
const R5 = `${NOTEBOOK_MAIN}:noteR5`;

const PROJECTED_V1 = "答案-V1-唯一匹配卡片正文-秘密片段";
const PROJECTED_V2 = "答案-V2-修改后的答案正文-秘密片段";

function snapshot(answerText: string, exportedAt: string): SnapshotExportPayload {
  return {
    schemaVersion: 1,
    sourceId: "cardlink-plugin",
    exportedAt,
    isFullSnapshot: true,
    records: [
      record(R1, {
        answerText,
        answerTextOrigin: "answer_card",
        answerSourceNotebookId: NOTEBOOK_ANS,
        answerSourceNoteId: "ansNoteR1",
        answerStatus: "projected",
        // 绑定根仍然存在，但只是答案脑图根，不能被当答案笔记。
        answerNotebookId: NOTEBOOK_ANS,
        answerRootNodeId: "ansRootNode1",
      }),
      // 多候选，插件侧已判定不唯一 → 不可用。
      record(R2, { answerStatus: "unavailable", answerReason: "answer_ambiguous" }),
      // 绑定存在但无匹配卡片。
      record(R3, { answerStatus: "unavailable", answerReason: "answer_not_found" }),
      // 来源在不同答案学习集（用于 scope 越权）。
      record(R4, {
        answerText: "答案-另一个答案学习集",
        answerTextOrigin: "answer_card",
        answerSourceNotebookId: NOTEBOOK_OTHER_ANS,
        answerSourceNoteId: "ansNoteR4",
        answerStatus: "projected",
      }),
      // 旧导入：有正文 + 旧来源字段（绑定根语义按旧口径读取，保持旧响应）。
      record(R5, {
        answerText: "旧导入答案正文",
        answerNotebookId: NOTEBOOK_ANS,
        answerRootNodeId: "ansRootNode1",
      }),
    ],
  } as SnapshotExportPayload;
}

let app: HarnessApp;
let snapshotA: string;
let snapshotB: string;

const ALL = { notebookIds: [] as string[] };

before(async () => {
  app = makeApp();
  snapshotA = (await app.syncService.importSnapshot(snapshot(PROJECTED_V1, "2026-11-16T08:00:00+08:00"))).snapshotId;
  snapshotB = (await app.syncService.importSnapshot(snapshot(PROJECTED_V2, "2026-11-17T08:00:00+08:00"))).snapshotId;
  assert.notEqual(snapshotA, snapshotB);
});

async function detail(
  snapshotId: string,
  args: Record<string, unknown>,
  scope: { notebookIds: string[] } = ALL,
): Promise<ToolEnvelope> {
  const tool = app.registry.get("getMistakeDetail");
  assert.ok(tool, "getMistakeDetail 未注册");
  return (await tool.run(args, {
    sessionId: "answer-projection-session",
    scope,
    snapshotId,
    signal: new AbortController().signal,
  })) as ToolEnvelope;
}

type Segment = { available: boolean; reason?: string; text?: string; source?: { notebookId: string; noteId: string } };
type DetailData = { record: Record<string, unknown>; contentSegment?: Segment };

describe("v2.16 §6.1 / H1-T44：设备答案正文投影", () => {
  test("显式 answer 分段读取唯一匹配的答案正文与实际答案笔记来源", async () => {
    const envelope = await detail(snapshotB, { recordId: R1, content: { field: "answer", offset: 0, limit: 4000 } });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const data = envelope.data as DetailData;
    assert.equal(data.contentSegment?.available, true);
    assert.equal(data.contentSegment?.text, PROJECTED_V2);
    assert.deepEqual(data.contentSegment?.source, { notebookId: NOTEBOOK_ANS, noteId: "ansNoteR1" });
    assert.notDeepEqual(data.contentSegment?.source, { notebookId: NOTEBOOK_ANS, noteId: "ansRootNode1" });
    assert.equal("answerText" in data.record, false, "分段模式 record 不带答案正文");
    assert.equal("questionText" in data.record, false, "分段模式 record 不带题干正文");
  });

  test("默认详情与旧 includeText 不自动发送设备新增答案正文", async () => {
    for (const args of [{ recordId: R1 }, { recordId: R1, includeText: true }]) {
      const envelope = await detail(snapshotB, args);
      assert.equal(envelope.ok, true);
      const data = envelope.data as DetailData;
      assert.equal("answerText" in data.record, false, `默认路径不应带出答案：${JSON.stringify(args)}`);
      assert.equal(typeof data.record.answerTextOmitted, "number");
      assert.equal(JSON.stringify(envelope).includes(PROJECTED_V2), false, "任何默认字段都不得夹带答案正文");
      assert.equal(data.record.answerTextOrigin, "answer_card");
    }
  });

  test("旧导入答案保持旧响应行为（默认 record 带 answerText，旧来源口径不变）", async () => {
    const envelope = await detail(snapshotB, { recordId: R5 });
    const data = envelope.data as DetailData;
    assert.equal(data.record.answerText, "旧导入答案正文");
    const segment = (await detail(snapshotB, { recordId: R5, content: { field: "answer" } })).data as DetailData;
    assert.equal(segment.contentSegment?.available, true);
    assert.deepEqual(segment.contentSegment?.source, { notebookId: NOTEBOOK_ANS, noteId: "ansRootNode1" });
  });

  test("多候选/无匹配显式不可用，不猜也不返回正文", async () => {
    const ambiguous = (await detail(snapshotB, { recordId: R2, content: { field: "answer" } })).data as DetailData;
    assert.equal(ambiguous.contentSegment?.available, false);
    assert.equal(ambiguous.contentSegment?.reason, "answer_ambiguous");
    assert.equal(ambiguous.contentSegment?.text, undefined);
    const notFound = (await detail(snapshotB, { recordId: R3, content: { field: "answer" } })).data as DetailData;
    assert.equal(notFound.contentSegment?.reason, "answer_not_found");
    const absent = (await detail(snapshotB, { recordId: R3 })).data as DetailData;
    assert.equal("answerText" in absent.record, false);
  });

  test("答案来源不在会话 scope → answer_source_out_of_scope，不返回正文", async () => {
    const inScope = await detail(snapshotB, { recordId: R4, content: { field: "answer" } }, { notebookIds: [NOTEBOOK_MAIN, NOTEBOOK_OTHER_ANS] });
    assert.equal((inScope.data as DetailData).contentSegment?.available, true);
    const outOfScope = await detail(snapshotB, { recordId: R4, content: { field: "answer" } }, { notebookIds: [NOTEBOOK_MAIN] });
    const segment = (outOfScope.data as DetailData).contentSegment;
    assert.equal(segment?.available, false);
    assert.equal(segment?.reason, "answer_source_out_of_scope");
    assert.equal(JSON.stringify(outOfScope).includes("答案-另一个答案学习集"), false);
  });

  test("A/B 快照隔离：旧快照保留旧答案，新快照读新答案", async () => {
    const oldRecord = await app.repositoryV2.get(snapshotA, R1, ALL);
    const newRecord = await app.repositoryV2.get(snapshotB, R1, ALL);
    assert.equal(oldRecord?.answerText, PROJECTED_V1);
    assert.equal(newRecord?.answerText, PROJECTED_V2);
    const oldDetail = (await detail(snapshotA, { recordId: R1, content: { field: "answer" } })).data as DetailData;
    assert.equal(oldDetail.contentSegment?.text, PROJECTED_V1);
  });
});

describe("v2.16 / H1-T44：同轮下钻、Reviewer 不泄漏、旧运行锁定", () => {
  test("strict 档下钻可读；Reviewer 上下文与默认工具结果不含答案正文；旧 Run 结果不变", async () => {
    const driver = openDatabase(":memory:");
    const model = new FakeModelClient();
    const stack = createHarnessApp(
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
    const first = await stack.syncService.importSnapshot(snapshot(PROJECTED_V1, "2026-11-16T08:00:00+08:00"));
    const session = await stack.service.createSession({ notebookIds: [] });
    await stack.service.setReviewLevel(session.id, "strict");

    model.enqueueMany([
      { text: "读答案分段", toolCalls: [{ id: "seg-1", name: "getMistakeDetail", arguments: { recordId: R1, content: { field: "answer", offset: 0, limit: 4000 } } }] },
      { approved: true, reason: "单题下钻与请求一致" },
      { text: "答案要点见分段。", toolCalls: [] },
    ]);
    const result = await stack.service.sendMessage(session.id, "req-answer-a", "读这道题的答案");
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.ok(result.runId);

    // Reviewer 只看到最小上下文：不含答案正文。
    const reviewerContext = model.calls.find((call) => call.context.outputType.name === "tool_call_decision")?.context;
    assert.ok(reviewerContext);
    assert.equal(JSON.stringify(reviewerContext).includes(PROJECTED_V1), false, "Reviewer 不得收到答案正文");
    assert.equal(JSON.stringify(reviewerContext).includes("秘密片段"), false);

    const calls = stack.runStore.listToolCalls(result.runId!);
    const executed = calls.find((call) => call.toolCallId === "seg-1");
    assert.equal(executed?.executionStatus, "executed");
    const envelope = JSON.parse(executed?.resultJson ?? "{}") as { data?: DetailData };
    assert.equal(envelope.data?.contentSegment?.text, PROJECTED_V1);
    assert.equal(executed?.reviewerApproved, true, "strict 档真实审核");

    // 默认详情工具结果同样不夹带答案正文。
    model.enqueueMany([
      { text: "看元数据", toolCalls: [{ id: "meta-1", name: "getMistakeDetail", arguments: { recordId: R1 } }] },
      { approved: true, reason: "只读元数据" },
      { text: "已查看。", toolCalls: [] },
    ]);
    const second = await stack.service.sendMessage(session.id, "req-answer-b", "看一下题目元数据");
    assert.equal(second.status, "completed");
    const metaCall = stack.runStore.listToolCalls(second.runId!).find((call) => call.toolCallId === "meta-1");
    assert.equal((metaCall?.resultJson ?? "").includes(PROJECTED_V1), false, "默认详情结果不得含答案正文");

    // 导入 B（答案修改）后：旧 Run 的记录与证据仍指向 A 的正文。
    await stack.syncService.importSnapshot(snapshot(PROJECTED_V2, "2026-11-17T08:00:00+08:00"));
    const oldCall = stack.runStore.listToolCalls(result.runId!).find((call) => call.toolCallId === "seg-1");
    assert.equal((oldCall?.resultJson ?? "").includes(PROJECTED_V1), true, "旧 Run 结果保持 A 快照正文");
    assert.equal(stack.runStore.get(result.runId!)?.snapshotId, first.snapshotId, "Run 锁定 A 快照");
    const latest = (await stack.registry.get("getMistakeDetail")!.run(
      { recordId: R1, content: { field: "answer" } },
      { sessionId: session.id, scope: { notebookIds: [] }, snapshotId: (await stack.repositoryV2.latestSnapshotId())!, signal: new AbortController().signal },
    )) as ToolEnvelope;
    assert.equal((latest.data as DetailData).contentSegment?.text, PROJECTED_V2);
  });
});
