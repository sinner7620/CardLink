import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { StatisticsEngine } from "../../src/application/statistics-engine.ts";
import { statisticValue } from "../../src/application/statistic-evidence.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import type { ToolEnvelope } from "../../src/domain/evidence.ts";
import type { ReviewLevel } from "../../src/domain/session.ts";
import * as F from "../fixtures/repeated-review-data.ts";

/**
 * v2.18 §9.4 / H1-T49：跨题错因复习历史报表。
 * 手算对照：只计可核实 review + 非空错因键，≥2 笔入榜，半开窗口、同分排序、limit/截断、
 * 覆盖与缺失说明、跨 scope/同名不同 ID、A/B 快照隔离、统计引用与两段 reviewActivity。
 */

let app: HarnessApp;
let snapshotA: string;

type RecordRow = {
  recordId: string;
  eventCount: number;
  lastEventAt?: string;
  errorKeys: Array<{ key: string; label: string; eventCount: number }>;
  errorKeyCount: number;
};

type Report = {
  report: "repeatedReviewErrors";
  snapshotId: string;
  dataAsOf: string;
  matchingRecords: number;
  reviewCoverage: { matchingRecords: number; recordsWithHistory: number };
  reviewedRecordsInWindow: number;
  recordsWithQualifyingEvents: number;
  totalMatchedRecords: number;
  totalQualifyingEvents: number;
  window: { from?: string; before?: string };
  records: RecordRow[];
  truncated: boolean;
  omittedRecords: number;
  interpretation: string;
  notes: string[];
};

before(async () => {
  app = makeAppWithModel();
  const imported = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "repeated-review", exportedAt: "2026-11-18T08:00:00+08:00",
    isFullSnapshot: true, records: F.repeatedReviewSnapshot(),
  });
  snapshotA = imported.snapshotId;
});

function makeAppWithModel(model?: FakeModelClient, toolProtocolVersion: 1 | 2 = 1): HarnessApp {
  return createHarnessApp(
    {
      bind: "127.0.0.1", port: 0, httpToken: "t",
      model: {
        provider: "openai-compatible", baseUrl: "https://unused/v1", apiKey: "unused", name: "unused",
        reviewerName: "", effortAssistant: "medium", effortReviewer: "low",
        timeoutMs: 3000, maxOutputTokens: 1024, providerId: "p1", credentialRef: "k1",
      },
      storage: { database: ":memory:" },
      limits: { maxIterations: 8, maxToolCallsPerTurn: 8, toolTimeoutMs: 3000, contextBudgetChars: 0 },
    },
    { driver: openDatabase(":memory:"), ...(model ? { model } : {}), toolProtocolVersion },
  );
}

async function report(
  args: Record<string, unknown>,
  scope: { notebookIds: string[] } = F.REPEATED_SCOPE_AB,
  targetApp: HarnessApp = app,
  snapshotId: string = snapshotA,
): Promise<ToolEnvelope & { data: Report }> {
  const tool = targetApp.registry.get("getMistakeStats");
  assert.ok(tool, "getMistakeStats 未注册");
  const envelope = (await tool.run(args, {
    sessionId: "repeated-session",
    scope,
    snapshotId,
    signal: new AbortController().signal,
  })) as ToolEnvelope;
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
  return envelope as ToolEnvelope & { data: Report };
}

function ids(data: Report): string[] {
  return data.records.map((record) => record.recordId);
}

describe("v2.18 §9.4 / H1-T49：跨题错因复习历史", () => {
  test("最近窗口手算：只计可核实 review + 非空错因，≥2 笔入榜且计数/覆盖正确", async () => {
    const envelope = await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT, limit: 20 });
    const data = envelope.data;
    assert.equal(data.snapshotId, snapshotA);
    assert.equal(typeof data.dataAsOf, "string");
    assert.equal(data.matchingRecords, 10, "A+B scope 内 10 条记录（R07 越权不计）");
    assert.equal(data.reviewCoverage.matchingRecords, 10);
    assert.equal(data.reviewCoverage.recordsWithHistory, 9, "R05 无历史");
    assert.equal(data.reviewedRecordsInWindow, 9, "窗口内有复习（不要求错因）的题数");
    assert.equal(data.recordsWithQualifyingEvents, 7);
    assert.equal(data.totalQualifyingEvents, 11, "R01×3 + R06×2 + R08×2 + R02×1 + R03×1 + R12×1");
    assert.equal(data.totalMatchedRecords, 3);
    assert.equal(data.truncated, false);
    assert.equal(data.omittedRecords, 0);
    assert.deepEqual(ids(data), [F.REPEATED_R01, F.REPEATED_R08, F.REPEATED_R06]);
    const first = data.records[0]!;
    assert.equal(first.eventCount, 3);
    assert.equal(first.lastEventAt, "2026-11-10T00:00:00.000Z");
    assert.equal(first.errorKeyCount, 2);
    assert.deepEqual(first.errorKeys, [
      { key: "K1", label: "计算", eventCount: 2 },
      { key: "K2", label: "符号", eventCount: 1 },
    ]);
    assert.match(data.interpretation, /多次复习记录带错因/);
    assert.match(data.interpretation, /不代表实际答错/);
    assert.equal(JSON.stringify(data).includes("反复记录错因 A"), false, "不返回题干/标题正文");
    assert.equal("questionText" in first, false);
    assert.equal("answerText" in first, false);
    assert.deepEqual(data.notes, []);
  });

  test("半开区间：恰好等于 reviewFrom 计入、等于 reviewBefore 排除；单次不入榜", async () => {
    const recent = (await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT })).data;
    assert.equal(ids(recent).includes(F.REPEATED_R09), false, "窗口上界事件被排除，只有 1 笔");
    assert.equal(ids(recent).includes(F.REPEATED_R03), false, "单次带错因不入榜");
    assert.equal(ids(recent).includes(F.REPEATED_R12), false, "mark 不计，只剩 1 笔");

    const all = (await report({ report: "repeatedReviewErrors" })).data;
    assert.equal(ids(all).includes(F.REPEATED_R09), true, "不限窗口时两端事件都计入");
    assert.equal(all.records.find((row) => row.recordId === F.REPEATED_R09)?.eventCount, 2);
    assert.equal(ids(all).includes(F.REPEATED_R02), true, "跨窗口总计两笔");
    assert.deepEqual(ids(all), [F.REPEATED_R01, F.REPEATED_R02, F.REPEATED_R08, F.REPEATED_R09, F.REPEATED_R06]);
    assert.equal(all.totalMatchedRecords, 5);

    // 单端窗口：仅 reviewFrom 时上界不限（R09 两端都计入）；仅 reviewBefore 时下界不限（含更早事件）。
    const fromOnly = (await report({ report: "repeatedReviewErrors", reviewFrom: F.REPEATED_RECENT.reviewFrom })).data;
    assert.equal(fromOnly.totalMatchedRecords, 4);
    assert.equal(fromOnly.records.find((row) => row.recordId === F.REPEATED_R09)?.eventCount, 2);
    const beforeOnly = (await report({ report: "repeatedReviewErrors", reviewBefore: F.REPEATED_RECENT.reviewBefore })).data;
    assert.equal(beforeOnly.totalMatchedRecords, 4);
    assert.equal(beforeOnly.records.find((row) => row.recordId === F.REPEATED_R02)?.eventCount, 2);
  });

  test("无错因/空键/无历史/单次：不虚报，notes 明确覆盖不足", async () => {
    // 11-03 窗口：R04 有一笔无错因复习 + R10 一笔空键复习 → 有复习但无合格错因。
    const noReason = (await report({
      report: "repeatedReviewErrors",
      reviewFrom: "2026-11-03T00:00:00.000Z",
      reviewBefore: "2026-11-04T00:00:00.000Z",
    })).data;
    assert.equal(noReason.reviewedRecordsInWindow, 2);
    assert.equal(noReason.recordsWithQualifyingEvents, 0);
    assert.equal(noReason.totalMatchedRecords, 0);
    assert.deepEqual(noReason.records, []);
    assert.ok(noReason.notes.some((note) => note.includes("没有任何一笔带非空错因键")), JSON.stringify(noReason.notes));

    // 只有一个合格事件：形成覆盖但不入榜。
    const single = (await report({
      report: "repeatedReviewErrors",
      reviewFrom: "2026-11-01T00:00:00.000Z",
      reviewBefore: "2026-11-02T00:00:00.000Z",
    })).data;
    assert.equal(single.recordsWithQualifyingEvents, 1);
    assert.equal(single.totalMatchedRecords, 0);
    assert.deepEqual(single.records, []);
    assert.ok(single.notes.some((note) => note.includes("至少两笔")), JSON.stringify(single.notes));

    // 空数据：结构保留，明确 data insufficient。
    const empty = (await report({ report: "repeatedReviewErrors", subject: "不存在的分类" })).data;
    assert.equal(empty.matchingRecords, 0);
    assert.equal(empty.totalMatchedRecords, 0);
    assert.deepEqual(empty.records, []);
    assert.ok(empty.notes.some((note) => note.includes("没有错题记录")), JSON.stringify(empty.notes));

    // 缺少历史：R05 计入分母但不计入 recordsWithHistory / 窗口覆盖。
    const recent = (await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT })).data;
    assert.equal(recent.matchingRecords - recent.reviewCoverage.recordsWithHistory, 1, "R05 无历史");
  });

  test("窗口内无可核实复习与窗口有复习但无有效错因必须区分（notes）", async () => {
    const noEvents = (await report({
      report: "repeatedReviewErrors",
      reviewFrom: "2026-12-01T00:00:00.000Z",
      reviewBefore: "2026-12-10T00:00:00.000Z",
    })).data;
    assert.equal(noEvents.reviewedRecordsInWindow, 0);
    assert.equal(noEvents.recordsWithQualifyingEvents, 0);
    assert.ok(noEvents.notes.some((note) => note.includes("窗口内没有可核实的复习事件")), JSON.stringify(noEvents.notes));
    assert.equal(noEvents.notes.some((note) => note.includes("带非空错因键")), false, "不得把空窗口说成有复习但无错因");

    const noReason = (await report({
      report: "repeatedReviewErrors",
      reviewFrom: "2026-11-03T00:00:00.000Z",
      reviewBefore: "2026-11-04T00:00:00.000Z",
    })).data;
    assert.ok(noReason.reviewedRecordsInWindow > 0);
    assert.equal(noReason.recordsWithQualifyingEvents, 0);
    assert.ok(noReason.notes.some((note) => note.includes("有可核实复习事件") && note.includes("没有任何一笔带非空错因键")), JSON.stringify(noReason.notes));
  });

  test("空白集合与 JS String.trim 对齐：\\t\\n/全角空格/NBSP 不计，边缘空白同键合并", async () => {
    const stack = makeAppWithModel();
    const imported = await stack.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "repeated-whitespace", exportedAt: "2026-11-18T08:00:00+08:00",
      isFullSnapshot: true, records: F.repeatedWhitespaceSnapshot(),
    });
    const data = (await report(
      { report: "repeatedReviewErrors" },
      F.REPEATED_SCOPE_ALL,
      stack,
      imported.snapshotId,
    )).data;
    assert.equal(data.matchingRecords, 3);
    assert.equal(data.totalQualifyingEvents, 4, "W1 两笔 + W3 两笔；W2 的全角/TAB 空白键不计");
    assert.equal(data.totalMatchedRecords, 2);
    assert.deepEqual(ids(data), [F.REPEATED_W1, F.REPEATED_W3]);
    assert.deepEqual(data.records[0]?.errorKeys, [{ key: "K1", label: "计算", eventCount: 2 }], "边缘空白同键合并");
    assert.equal(data.records[0]?.errorKeyCount, 1);
    assert.deepEqual(data.records[1]?.errorKeys, [{ key: "K2", label: "符号", eventCount: 2 }], "NBSP 同键合并");
    assert.equal(ids(data).includes(F.REPEATED_W2), false, "纯空白键不入榜");
  });

  test("同分按 recordId 升序；limit 有界并给出截断；errorKeys 最多 5 项", async () => {
    const limited = (await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT, limit: 2 })).data;
    assert.deepEqual(ids(limited), [F.REPEATED_R01, F.REPEATED_R08]);
    assert.equal(limited.totalMatchedRecords, 3);
    assert.equal(limited.truncated, true);
    assert.equal(limited.omittedRecords, 1);

    const tooLarge = await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT, limit: 51 }).then(
      () => assert.fail("limit 51 应被拒绝"),
      (error: Error) => error,
    );
    assert.match(tooLarge.message, /limit/);
    const badWindow = await report({ report: "repeatedReviewErrors", reviewFrom: "2026-11-20T00:00:00.000Z", reviewBefore: "2026-10-20T00:00:00.000Z" }).then(
      () => assert.fail("倒置窗口应被拒绝"),
      (error: Error) => error,
    );
    assert.match(badWindow.message, /开始时间必须早于结束时间/);
    const windowOnG2 = await report({ reviewFrom: F.REPEATED_RECENT.reviewFrom }).then(
      () => assert.fail("常规统计不接受复习窗口"),
      (error: Error) => error,
    );
    assert.match(windowOnG2.message, /仅适用于/);
  });

  test("跨 scope 与同名不同 ID 学习集隔离；A/B 快照隔离", async () => {
    const scoped = (await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT }, F.REPEATED_SCOPE_AB)).data;
    assert.equal(ids(scoped).includes(F.REPEATED_R07), false);
    assert.equal(ids(scoped).includes(F.REPEATED_R06), true, "同名但不同 ID 的 B 学习集仍可见");

    const all = (await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT }, F.REPEATED_SCOPE_ALL)).data;
    assert.equal(all.matchingRecords, 11);
    assert.equal(all.totalMatchedRecords, 4);
    assert.deepEqual(ids(all), [F.REPEATED_R01, F.REPEATED_R07, F.REPEATED_R08, F.REPEATED_R06]);

    // 快照 B：R01 再增加一笔近期 K1；旧快照 A 的报表保持原值。
    const changed = F.repeatedReviewSnapshot().map((record) => record.recordId === F.REPEATED_R01
      ? {
          ...record,
          history: [
            ...(record.history ?? []),
            { at: "2026-11-12T00:00:00.000Z", level: 0, errorReason: { key: "K1", label: "计算" } },
          ],
        }
      : record);
    const b = await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "repeated-review", exportedAt: "2026-11-19T08:00:00+08:00",
      isFullSnapshot: true, records: changed,
    });
    assert.notEqual(b.snapshotId, snapshotA);
    const latest = (await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT }, F.REPEATED_SCOPE_AB, app, b.snapshotId)).data;
    assert.equal(latest.records[0]!.eventCount, 4);
    assert.equal(latest.records[0]!.errorKeys[0]!.eventCount, 3);

    const pinnedA = new StatisticsEngine(app.repository.forSnapshot(snapshotA));
    const old = await pinnedA.getReport({
      filter: { report: "repeatedReviewErrors", ...F.REPEATED_RECENT },
      scope: F.REPEATED_SCOPE_AB,
    });
    assert.equal((old as typeof latest).records[0]!.eventCount, 3, "旧快照不受新导入影响");
  });

  test("无效时间事件不计入（raw_json 投影层），有效两笔仍可入榜", async () => {
    const stack = makeAppWithModel();
    const only = F.repeatedReviewSnapshot().filter((record) => record.recordId === F.REPEATED_R01);
    const imported = await stack.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "repeated-raw", exportedAt: "2026-11-18T08:00:00+08:00",
      isFullSnapshot: true, records: only,
    });
    stack.db.exec(
      "UPDATE mistake_projection_v2 SET raw_json = ? WHERE snapshot_id = ? AND record_id = ?",
      [JSON.stringify({ history: [
        { at: "2026-09-01T00:00:00.000Z", level: 0 },
        { at: "2026-11-01T00:00:00.000Z", level: 0, errorReason: { key: "K1", label: "计算" } },
        { at: "not-a-date", level: 0, errorReason: { key: "K1", label: "计算" } },
        { at: "2026-11-03T00:00:00.000Z", level: 0, errorReason: { key: "K1", label: "计算" } },
        { at: "2026-11-04T00:00:00.000Z", level: 0, errorReason: { key: "   ", label: "空白" } },
      ] }), imported.snapshotId, F.REPEATED_R01],
    );
    const data = (await report({ report: "repeatedReviewErrors" }, F.REPEATED_SCOPE_ALL, stack, imported.snapshotId)).data;
    assert.equal(data.totalMatchedRecords, 1);
    assert.equal(data.totalQualifyingEvents, 2, "无效时间与空白键不计");
    assert.equal(data.records[0]?.eventCount, 2);
    assert.equal(data.records[0]?.lastEventAt, "2026-11-03T00:00:00.000Z");
  });

  test("两段 reviewActivity 对比与统计数字引用白名单", async () => {
    const recent = (await report({ report: "reviewActivity", ...F.REPEATED_RECENT })).data as unknown as {
      verifiedReviewCount: number; reviewedRecordCount: number; lastReviewedAt?: string;
    };
    const previous = (await report({ report: "reviewActivity", ...F.REPEATED_PREVIOUS })).data as unknown as {
      verifiedReviewCount: number; reviewedRecordCount: number; lastReviewedAt?: string;
    };
    assert.equal(recent.verifiedReviewCount, 15);
    assert.equal(recent.reviewedRecordCount, 9);
    assert.equal(recent.lastReviewedAt, "2026-11-10T00:00:00.000Z");
    assert.equal(previous.verifiedReviewCount, 2, "前 30 天：R01 与 R02 各一笔");
    assert.equal(previous.reviewedRecordCount, 2);
    assert.equal(previous.lastReviewedAt, "2026-10-05T00:00:00.000Z");

    const envelope = await report({ report: "repeatedReviewErrors", ...F.REPEATED_RECENT });
    const evidence = {
      evidenceId: "ev-repeated",
      toolCallId: "call-repeated",
      toolName: "getMistakeStats",
      data: envelope.data,
    };
    const label = (path: string) => statisticValue(evidence as never, path);
    assert.equal(label("totalMatchedRecords")?.value, 3);
    assert.equal(label("totalMatchedRecords")?.label, "达到门槛的题数");
    assert.equal(label("totalQualifyingEvents")?.value, 11);
    assert.equal(label("reviewedRecordsInWindow")?.value, 9);
    assert.equal(label("recordsWithQualifyingEvents")?.value, 7);
    assert.equal(label("matchingRecords")?.value, 10);
    assert.equal(label("records.0.eventCount")?.value, 3);
    assert.equal(label("records.0.eventCount")?.label, "该题带错因复习事件数");
    assert.equal(label("records.0.errorKeys.0.eventCount")?.value, 2);
    assert.equal(label("records.0.lastEventAt"), null);
    assert.equal(label("records.0.eventCount.extra"), null);
    assert.deepEqual(envelope.evidence.recordIds, [F.REPEATED_R01, F.REPEATED_R08, F.REPEATED_R06]);
  });

  test("v1/v2 两种协议装配都可调用同一报表，PolicyGuard Schema 生效", async () => {
    for (const version of [1, 2] as const) {
      const stack = makeAppWithModel(undefined, version);
      const imported = await stack.syncService.importSnapshot({
        schemaVersion: 1, sourceId: "repeated-review", exportedAt: "2026-11-18T08:00:00+08:00",
        isFullSnapshot: true, records: F.repeatedReviewSnapshot(),
      });
      const definition = stack.registry.get("getMistakeStats")!.definition;
      const reportSchema = (definition.parameters as { properties: { report: { enum: string[] } } }).properties.report;
      assert.ok(reportSchema.enum.includes("repeatedReviewErrors"), `协议 v${version} Schema 缺少新报表`);
      const envelope = await report(
        { report: "repeatedReviewErrors", ...F.REPEATED_RECENT },
        F.REPEATED_SCOPE_AB,
        stack,
        imported.snapshotId,
      );
      assert.equal(envelope.data.totalMatchedRecords, 3);
      assert.equal(stack.registry.names().includes("getMistakeStats"), true);
    }
  });

  test("假模型端到端：三档审核下查询、证据 recordId、（溯源）下钻与经核验回答", async () => {
    for (const level of ["provenance", "strict", "full_allow"] as ReviewLevel[]) {
      const model = new FakeModelClient();
      const stack = makeAppWithModel(model);
      await stack.syncService.importSnapshot({
        schemaVersion: 1, sourceId: "repeated-review", exportedAt: "2026-11-18T08:00:00+08:00",
        isFullSnapshot: true, records: F.repeatedReviewSnapshot(),
      });
      const session = await stack.service.createSession({ notebookIds: [F.REPEATED_NOTEBOOK_A, F.REPEATED_NOTEBOOK_B] });
      await stack.service.setReviewLevel(session.id, level);

      const queue: unknown[] = [
        { text: "先查反复错因", toolCalls: [
          { id: "repeat-bad", name: "getMistakeStats", arguments: { report: "repeatedReviewErrors", ...F.REPEATED_RECENT, limit: 51 } },
          { id: "repeat-stats", name: "getMistakeStats", arguments: { report: "repeatedReviewErrors", ...F.REPEATED_RECENT, limit: 5 } },
        ] },
      ];
      if (level !== "full_allow") queue.push({ approved: true, reason: "只读统计与请求一致" });
      // 用榜单返回的 recordId 下钻单题历史：provenance 档可溯源免审，strict 档仍需审核。
      queue.push({ text: "看这道题最近历史", toolCalls: [{ id: "repeat-history", name: "getReviewHistory", arguments: { recordId: F.REPEATED_R01, order: "desc", limit: 3 } }] });
      if (level === "strict") queue.push({ approved: true, reason: "strict 档下钻也审核" });
      queue.push({
        text: `反复记录错因的题见 {{card:ref_1 ${F.REPEATED_R01}}}，最近窗口共 {{stat:ref_2 s1 totalMatchedRecords}} 道题达到门槛。`,
        toolCalls: [],
      });
      model.enqueueMany(queue);

      const result = await stack.service.sendMessage(session.id, `req-repeated-${level}`, "最近30天哪些题反复记录了错因？");
      assert.equal(result.status, "completed", `${level}: ${JSON.stringify(result)}`);
      assert.ok(result.runId);
      const expectedReviewer = level === "strict" ? 2 : level === "provenance" ? 1 : 0;
      assert.equal(model.reviewerCalls, expectedReviewer, `${level} 审核次数`);
      const calls = stack.runStore.listToolCalls(result.runId!);
      const bad = calls.find((call) => call.toolCallId === "repeat-bad");
      assert.equal(bad?.policyStatus, "invalid_args", "非法 limit 由确定性门拒绝");
      assert.equal(bad?.executionStatus, "not_executed");
      assert.equal(bad?.reviewerApproved, undefined, "非法参数不进入 Reviewer");
      const executed = calls.filter((call) => call.executionStatus === "executed");
      assert.deepEqual(executed.map((call) => call.toolCallId).sort(), ["repeat-history", "repeat-stats"]);
      const statsCall = executed.find((call) => call.toolCallId === "repeat-stats")!;
      const statsEnvelope = JSON.parse(statsCall.resultJson ?? "{}") as {
        evidence?: { snapshotId?: string; dataAsOf?: string; recordIds?: string[] };
        data?: Report;
      };
      assert.deepEqual(statsEnvelope.evidence?.recordIds, [F.REPEATED_R01, F.REPEATED_R08, F.REPEATED_R06]);
      assert.equal(statsEnvelope.evidence?.snapshotId, stack.runStore.get(result.runId!)?.snapshotId);
      assert.equal(statsEnvelope.evidence?.dataAsOf, (await stack.repository.getLatestSnapshotMeta())?.dataAsOf);
      assert.equal(statsEnvelope.data?.totalMatchedRecords, 3);
      const evidenceRow = JSON.parse(statsCall.evidenceJson ?? "{}") as { evidenceId?: string; snapshotId?: string };
      assert.ok(evidenceRow.evidenceId, "统计调用落证据行");
      assert.equal(evidenceRow.snapshotId, statsEnvelope.evidence?.snapshotId);
      assert.match(result.message ?? "", /反复记录错因 A/, "引用解析为真实标题");
      assert.ok(result.evidenceRefs?.includes(F.REPEATED_R01));
      assert.ok(result.evidenceRefs?.some((ref) => ref.startsWith("stat:")), "统计数字引用进入证据");
      if (level === "provenance") {
        const audit = stack.db.rows(
          "SELECT tool_call_id, reviewer_approved, reviewer_reason FROM tool_audit WHERE session_id = ? AND tool_call_id = ?",
          [session.id, "repeat-history"],
        ) as Array<{ tool_call_id: string; reviewer_approved: number | null; reviewer_reason: string | null }>;
        assert.equal(audit[0]?.reviewer_approved, null, "溯源下钻免审不冒充已审核");
        assert.equal(audit[0]?.reviewer_reason, "tier_skip: provenance");
      }
    }
  });
});
