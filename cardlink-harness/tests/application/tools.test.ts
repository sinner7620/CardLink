import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp, makeToolCall } from "../helpers/harness.ts";
import { SyncService } from "../../src/application/sync-service.ts";
import { buildFixtureRecord, snapshot1, FIXTURE_STATS_TIME_SH, FIXTURE_TIMEZONE_SH } from "../fixtures/fixture-data.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { ToolEnvelope } from "../../src/domain/evidence.ts";

let app: HarnessApp;
const ALL = { notebookIds: [] };
const ONLY_A = { notebookIds: ["bookA0000000000000000000000000001"] };

before(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
});

async function runTool(name: string, args: unknown, scope: { notebookIds: string[] } = ALL): Promise<ToolEnvelope> {
  const tool = app.registry.get(name);
  assert.ok(tool, `工具 ${name} 未注册`);
  // §6.2 运行锁定：ctx.snapshotId 是运行开始时解析的真实快照（与 AgentService 一致）。
  const meta = await app.repository.getLatestSnapshotMeta();
  const envelope = (await tool.run(args, {
    sessionId: "test-session",
    scope,
    snapshotId: meta?.snapshotId ?? "none",
    signal: new AbortController().signal,
  })) as ToolEnvelope;
  return envelope;
}

describe("P2: 五个只读工具（§9 / T08 / T10）", () => {
  test("注册表恰好包含白名单五个工具", () => {
    assert.deepEqual(
      app.registry.names().sort(),
      ["getMistakeDetail", "getMistakeStats", "getReviewHistory", "listWeakPoints", "queryMistakes"].sort(),
    );
    assert.equal(app.registry.size(), 5);
  });

  test("queryMistakes：分页/等级过滤/范围", async () => {
    const meta = await app.repository.getLatestSnapshotMeta();
    assert.ok(meta);
    const page1 = await runTool("queryMistakes", { limit: 30 });
    assert.equal(page1.ok, true);
    const data1 = page1.data as { records: Array<{ recordId: string }>; nextCursor?: string };
    assert.equal(data1.records.length, 30);
    assert.ok(data1.nextCursor);
    assert.equal(page1.evidence.snapshotId, meta.snapshotId, "证据回传数据库快照 ID");
    assert.ok(page1.evidence.recordIds?.length === 30);

    const page2 = await runTool("queryMistakes", { limit: 30, cursor: data1.nextCursor });
    const data2 = page2.data as { records: Array<{ recordId: string }> };
    assert.equal(data2.records.length > 0, true);
    assert.notEqual(data2.records[0]?.recordId, data1.records[0]?.recordId);

    const level0 = await runTool("queryMistakes", { level: 0, limit: 50 });
    assert.equal((level0.data as { records: Array<{ level?: number }> }).records.every((r) => r.level === 0), true);

    const onlyA = await runTool("queryMistakes", { limit: 50 }, ONLY_A);
    assert.equal((onlyA.data as { records: Array<{ sourceNotebookId: string }> }).records.every((r) => r.sourceNotebookId.startsWith("bookA")), true);
  });

  test("getMistakeDetail：用户自定义字段完整保留（G7）；OCR 手改优先", async () => {
    // i=2 → textMode 2（ocr.manualText 用户修订）
    const withManual = await runTool("getMistakeDetail", { recordId: "bookA0000000000000000000000000001:noteA003", includeText: true });
    assert.equal(withManual.ok, true);
    assert.equal(String((withManual.data as { record: Record<string, unknown> }).record.questionText).includes("用户修订"), true, "manual_text 用户修订应优先于 ocr/effective");

    const withTags = await runTool("getMistakeDetail", { recordId: "bookA0000000000000000000000000001:noteA001", includeText: true });
    assert.equal(withTags.ok, true);
    const rec = (withTags.data as { record: Record<string, unknown> }).record;
    assert.deepEqual(rec.manualCategories, ["自定义标签A"]);
    assert.deepEqual(rec.reasonTags, ["计算粗心"]);
    assert.equal(rec.favorite, true);
    assert.equal(rec.errorReasons !== undefined, true);
    assert.equal(rec.level, 0);
    assert.equal(rec.textStatus, "complete");

    const noText = await runTool("getMistakeDetail", { recordId: "bookA0000000000000000000000000001:noteA001" });
    const recNoText = (noText.data as { record: Record<string, unknown> }).record;
    assert.equal(recNoText.questionText === undefined, true, "includeText=false 不返回题干正文");
    assert.ok(recNoText.questionTextOmitted !== undefined);

    const missing = await runTool("getMistakeDetail", { recordId: "bookB0000000000000000000000000001:noteB040", includeText: true });
    assert.equal(((missing.data as { record: Record<string, unknown> }).record).textStatus, "missing", "T08: OCR 缺失显式 missing");
    assert.equal(((missing.data as { record: Record<string, unknown> }).record).questionText, undefined);

    const notFound = await runTool("getMistakeDetail", { recordId: "bookX0000000000000000000000000001:nope999" });
    assert.equal(notFound.ok, false);
    assert.equal(notFound.error?.code, "not_found");
  });

  test("getMistakeStats：确定性统计 + 证据", async () => {
    const stats = await runTool("getMistakeStats", { statsTime: FIXTURE_STATS_TIME_SH, timezone: FIXTURE_TIMEZONE_SH });
    assert.equal(stats.ok, true);
    const data = stats.data as { totalMistakes: number; dueCount: number };
    assert.equal(data.totalMistakes, 100);
    assert.equal(data.dueCount, 22);
    assert.ok(stats.evidence.snapshotId);
  });

  test("未掌握排名一次返回可核实次数，支持并列分页且列表正文按需读取", async () => {
    const args = { unmastered: true, orderBy: "reviewCountDesc" };
    const first = await runTool("queryMistakes", args, ONLY_A);
    const data = first.data as { records: Array<{ recordId: string; level: number; verifiedReviewCount: number }>; nextCursor: string; reviewCoverage: unknown };
    assert.equal(data.records.length, 10);
    assert.deepEqual(data.reviewCoverage, { matchingRecords: 59, recordsWithHistory: 59 });
    assert.ok(data.records.every((record) => record.level < 2 && !("questionText" in record) && !("answerText" in record)));
    assert.deepEqual(data.records.map((record) => record.verifiedReviewCount), [4, 4, 4, 4, 4, 2, 2, 2, 2, 2]);
    assert.deepEqual(first.evidence.recordIds, data.records.map((record) => record.recordId));
    const second = await runTool("queryMistakes", { ...args, cursor: data.nextCursor }, ONLY_A);
    const more = (second.data as typeof data).records;
    assert.equal(more.length, 10);
    assert.equal(more[0]?.recordId, buildFixtureRecord(35).recordId);
    assert.ok(more.every((record) => !first.evidence.recordIds?.includes(record.recordId)));
    const general = await runTool("queryMistakes", { limit: 50 });
    assert.ok((general.data as typeof data).records.every((record) => !("questionText" in record) && !("answerText" in record)));
  });

  test("到期查询使用半开区间，排除不可用与完成的记录，同时间分页稳定", async () => {
    const args = {
      dueFrom: "2026-11-12T09:00:00+08:00",
      dueBefore: "2026-11-13T01:00:00+08:00",
      orderBy: "dueAtAsc",
      limit: 11,
    };
    const first = await runTool("queryMistakes", args);
    const data = first.data as { records: Array<{ recordId: string }>; nextCursor: string };
    const second = await runTool("queryMistakes", { ...args, cursor: data.nextCursor });
    const ids = [...data.records, ...(second.data as typeof data).records].map((record) => record.recordId);
    assert.equal(new Set(ids).size, 22);
    assert.equal(ids.length, 22);
    for (const i of [37, 43, 99]) assert.ok(!ids.includes(buildFixtureRecord(i).recordId));
    await assert.rejects(runTool("queryMistakes", { ...args, dueBefore: args.dueFrom }), /开始时间必须早于结束时间/);
  });

  test("统计报表按授权范围去重错因，并按复习发生时间统计动作与题数", async () => {
    const reasons = await runTool("getMistakeStats", { report: "errorReasons" }, ONLY_A);
    const reasonsData = reasons.data as { matchingRecords: number; reasons: Array<{ key: string; recordCount: number }> };
    assert.equal(reasonsData.matchingRecords, 59);
    const scoped = snapshot1().filter((record) => ONLY_A.notebookIds.includes(record.sourceNotebookId));
    const carelessRecords = scoped.filter((record) => record.history?.some((event) => event.errorReason?.key === "careless"));
    assert.equal(reasonsData.reasons.find((reason) => reason.key === "careless")?.recordCount, carelessRecords.length);
    assert.equal(reasons.evidence.snapshotId, (await app.repository.getLatestSnapshotMeta())?.snapshotId);

    const activity = await runTool("getMistakeStats", {
      report: "reviewActivity",
      reviewFrom: "2026-11-04T00:00:00+08:00",
      reviewBefore: "2026-11-04T02:00:00+08:00",
      timezone: FIXTURE_TIMEZONE_SH,
    }, ONLY_A);
    const activityData = activity.data as { verifiedReviewCount: number; reviewedRecordCount: number; lastReviewedAt: string };
    assert.equal(activityData.verifiedReviewCount, 2);
    assert.equal(activityData.reviewedRecordCount, 2);
    assert.equal(activityData.lastReviewedAt, "2026-11-03T17:00:00.000Z");
    assert.equal(activity.evidence.snapshotId, reasons.evidence.snapshotId);
  });

  test("getReviewHistory：mark/review 事件、limit、缺失标明", async () => {
    // i=0 已复习（history 2 条：mark + review）
    const history = await runTool("getReviewHistory", { recordId: "bookA0000000000000000000000000001:noteA001" });
    assert.equal(history.ok, true);
    const data = history.data as { events: Array<{ eventType: string; at: string }>; total: number; historyMissing: boolean };
    assert.equal(data.total, 2);
    assert.equal(data.events[0]?.eventType, "mark");
    assert.equal(data.events.filter((e) => e.eventType === "review").length, 1);
    assert.equal(data.historyMissing, false);

    const markOnly = await runTool("getReviewHistory", { recordId: "bookW0000000000000000000000000001:noteA060" });
    assert.equal(markOnly.ok, true);
    const markData = markOnly.data as { events: Array<{ eventType: string }>; total: number; historyMissing: boolean };
    assert.equal(markData.total, 1, "未复习记录仅有入册标记");
    assert.equal(markData.historyMissing, false);

    const notFound = await runTool("getReviewHistory", { recordId: "bookB0000000000000000000000000001:noteB001" }, ONLY_A);
    assert.equal(notFound.ok, false);
  });

  test("T10: 无知识点标签时 listWeakPoints 返回 insufficient_labels", async () => {
    const wp = await runTool("listWeakPoints", {});
    assert.equal(wp.ok, true);
    const data = wp.data as { status: string; distribution: Array<{ path: string[]; count: number; note: string }> };
    assert.equal(data.status, "insufficient_labels");
    assert.ok(data.distribution.length > 0);
    assert.ok(data.distribution.every((d) => d.note.includes("非知识点")));
  });
});
