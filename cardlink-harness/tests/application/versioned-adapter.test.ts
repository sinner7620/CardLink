import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import { makeApp, makeToolCall } from "../helpers/harness.ts";

import { AgentService } from "../../src/application/agent-service.ts";
import { AssistantRole } from "../../src/application/assistant-role.ts";
import { ReviewerRole } from "../../src/application/reviewer-role.ts";
import { ContextBuilder } from "../../src/application/context-builder.ts";
import { EvidenceValidator } from "../../src/application/evidence-validator.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { ToolExecutor } from "../../src/application/tool-executor.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createBridgeHandler } from "../../src/adapters/bridge/commands.ts";
import { pluginBackup, snapshot1, EXPECTED_AFTER_SNAPSHOT1 } from "../fixtures/fixture-data.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import { openDatabase, type SqlDriver } from "../../src/adapters/sqlite/node-driver.ts";
import { VersionedSqliteMistakeRepository } from "../../src/adapters/sqlite/versioned-mistake-repository.ts";
import type { VersionedImportPayload, VersionedSnapshotRecord } from "../../src/application/ports/versioned-mistake-repository.ts";

let app: HarnessApp;
beforeEach(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1,
    sourceId: "fixture",
    exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true,
    records: snapshot1().slice(0, 6),
  });
});

/** 与 makeApp 同装配，但模型换 Fake（证据闭环不依赖真实模型端点）。 */
function buildServiceWithFakeModel(model: FakeModelClient): AgentService {
  const builder = new ContextBuilder();
  return new AgentService({
    store: app.store,
    model,
    assistant: new AssistantRole(builder, app.registry.definitions()),
    reviewer: new ReviewerRole(builder, app.registry),
    guard: new PolicyGuard(app.registry, 8),
    executor: new ToolExecutor(app.registry, 3000),
    evidenceValidator: new EvidenceValidator(app.repository),
    auditLog: app.auditLog,
    repository: app.repository,
    evidenceStore: app.evidenceStore,
    runStore: app.runStore,
    config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
    assistantSetting: { provider: "test", model: "fake", effort: "low", timeoutMs: 3000, maxOutputTokens: 1024 },
    reviewerSetting: { provider: "test", model: "fake", effort: "low", timeoutMs: 3000, maxOutputTokens: 1024 },
  });
}

describe("版本化存储接入主链路（§6.2/§21.2）", () => {
  test("migration v5：带复习历史的版本化导入不再触发外键失败，事件入库", async () => {
    const driver: SqlDriver = openDatabase(":memory:");
    const repo = new VersionedSqliteMistakeRepository(driver);
    const payload: VersionedImportPayload = {
      manifest: { sourceId: "probe", sourceRevision: "", importedAt: new Date().toISOString(), scope: { notebookIds: [] }, complete: true },
      records: [
        {
          recordId: "bookA:note1", sourceNotebookId: "bookA", sourceNoteId: "note1",
          sourceAvailable: true, level: 1, currentLevelReviewCount: 2, reviewCompleted: false,
          favorite: false, categoryPath: ["数学"], manualCategories: [], customTags: [], reasonTags: [],
          errorReasons: [], sourceTitle: "t", sourceNotebookTitle: "数学", sourcePathTitles: [],
          ocr: { origin: "none", status: "missing" }, sourcePayload: {},
          history: [
            { at: "2026-11-01T00:00:00.000Z", level: 1 },
            { at: "2026-11-05T00:00:00.000Z", level: 2 },
          ],
          contentHash: "",
        },
      ],
    };
    const result = await repo.applySnapshot(payload);
    assert.equal(result.inserted, 1);
    const events = driver.rows("SELECT COUNT(*) AS n FROM review_events WHERE record_id = 'bookA:note1'")[0] as { n: number };
    assert.equal(events.n, 2, "mark + review 两条事件");
    // G2 复习动作数可从该快照的历史分辨。
    const stats = await repo.stats(result.snapshotId, {}, { notebookIds: [] }, new Date(), "Asia/Shanghai");
    assert.equal(stats.totalReviewActions, 1);
    assert.equal(stats.reviewEventCount, 1);
  });

  test("forSnapshot 运行锁定：钉住旧快照后导入新版本，读取不漂移", async () => {
    const latestBefore = (await app.repository.getLatestSnapshotMeta())?.snapshotId as string;
    const pinned = app.repository.forSnapshot(latestBefore);

    // 钉住视图读到的 meta 必须是钉住版本
    const pinnedMeta = await pinned.getLatestSnapshotMeta();
    assert.equal(pinnedMeta?.snapshotId, latestBefore);

    // 导入新完整快照（仅 1 条，latest 视图随之切换）
    await app.syncService.importSnapshot({
      schemaVersion: 1,
      sourceId: "fixture",
      exportedAt: "2026-11-13T08:00:00+08:00",
      isFullSnapshot: true,
      records: [snapshot1()[0]],
    });

    const latestAfter = (await app.repository.getLatestSnapshotMeta())?.snapshotId as string;
    assert.notEqual(latestAfter, latestBefore, "latest 视图已切到新版本");
    assert.equal((await pinned.getLatestSnapshotMeta())?.snapshotId, latestBefore, "钉住视图仍锁定旧快照");

    const pinnedPage = await pinned.query({ limit: 50 }, { notebookIds: [] });
    assert.equal(pinnedPage.snapshotId, latestBefore);
    assert.equal(pinnedPage.records.length, 6, "钉住视图数据 = 导入前状态");

    const latestPage = await app.repository.query({ limit: 50 }, { notebookIds: [] });
    assert.equal(latestPage.snapshotId, latestAfter);
    assert.equal(latestPage.records.length, 1);

    // 统计也按钉住版本计算
    const pinnedStats = await pinned.getStats({}, { notebookIds: [] }, "2026-11-20T15:59:59.999Z");
    assert.equal(pinnedStats.snapshotId, latestBefore);
    assert.equal(pinnedStats.totalRecords, 6);
    assert.equal(pinnedStats.totalReviewActions, 6, "另一快照中的同一记录不能重复计入");
    const activity = await pinned.getReport({ report: "reviewActivity" }, { notebookIds: [] });
    assert.equal(activity.snapshotId, latestBefore);
    assert.equal(activity.report, "reviewActivity");
    assert.equal(activity.verifiedReviewCount, 6);
  });

  test("钉住视图统计走引擎口径（dueBoundary 覆盖生效）", async () => {
    const latest = (await app.repository.getLatestSnapshotMeta())?.snapshotId as string;
    const pinned = app.repository.forSnapshot(latest);
    // 100 条基准的子集不与基准比对，仅验证 dueBoundary 参数被如实采用：
    const stats = await pinned.getStats({}, { notebookIds: [] }, "2030-01-01T00:00:00.000Z");
    assert.equal(stats.params.dueBoundary, "2030-01-01T00:00:00.000Z");
    assert.equal(stats.dueCount, 5, "远期边界下全部来源可用且未完成复习的记录到期");
  });

  test("增量导入拒绝过期基线，最新快照保留完整记录", async () => {
    const records = snapshot1();
    const sourceId = "delta-fixture";
    const first = await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId, exportedAt: "2026-11-12T08:00:00+08:00",
      isFullSnapshot: true, records: records.slice(0, 2),
    });
    const latest = await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId, exportedAt: "2026-11-13T08:00:00+08:00",
      isFullSnapshot: true, records: records.slice(0, 3),
    });
    await assert.rejects(() => app.syncService.importSnapshot({
      schemaVersion: 1, sourceId, exportedAt: "2026-11-14T08:00:00+08:00",
      isFullSnapshot: false, baseRevision: first.snapshotId, records: records.slice(4, 5),
    }), /base_revision_mismatch/);
    assert.equal(await app.repositoryV2.latestSnapshotId(), latest.snapshotId);
    const snapshot = await app.repositoryV2.getSnapshot(latest.snapshotId);
    assert.equal(snapshot?.recordCount, 3);
  });

  test("排名和复习活动区分缺失历史、仅入册和可核实复习", async () => {
    const [observed, missing, marked] = snapshot1();
    assert.ok(observed && missing && marked?.history?.[0]);
    const { snapshotId } = await app.syncService.importSnapshot({
      schemaVersion: 1,
      sourceId: "review-coverage",
      exportedAt: "2026-11-15T08:00:00+08:00",
      isFullSnapshot: true,
      records: [
        observed,
        { ...missing, reviewCount: 99, history: [] },
        { ...marked, history: [marked.history[0], { at: "now", level: 0 }] },
      ],
    });
    const pinned = app.repository.forSnapshot(snapshotId);
    const scope = { notebookIds: [] };
    const ranked = await pinned.query({ unmastered: true, orderBy: "reviewCountDesc" }, scope);
    assert.deepEqual(ranked.records.map((record) => [record.recordId, record.verifiedReviewCount]), [[observed.recordId, 1]]);
    assert.deepEqual(ranked.reviewCoverage, { matchingRecords: 3, recordsWithHistory: 2 });
    const report = await pinned.getReport({ report: "reviewActivity" }, scope);
    assert.equal(report.report, "reviewActivity");
    assert.equal(report.verifiedReviewCount, 1);
    assert.deepEqual(report.reviewCoverage, ranked.reviewCoverage);
  });

  test("G7 原始字段无损：插件备份经 SyncService 落库后 raw_json 保留源字段", async () => {
    const backup = pluginBackup();
    const result = await app.syncService.importSnapshot(backup);
    assert.equal(result.inserted, 2);
    const recordId = Object.keys(backup.records)[0] as string;
    const row = app.db.rows("SELECT raw_json FROM mistake_projection_v2 WHERE record_id = ?", [recordId])[0] as { raw_json: string };
    const raw = JSON.parse(row.raw_json) as Record<string, unknown>;
    assert.equal(raw.recordId, recordId);
    assert.ok(Array.isArray(raw.manualCategories), "用户自定义分类保留");
    assert.ok(Array.isArray(raw.reasonTags), "错因标签保留");
    assert.ok(raw.favorite !== undefined, "收藏状态保留");
  });

  test("工具数据读取按 ctx.snapshotId 钉住（与包络口径一致）", async () => {
    const meta = (await app.repository.getLatestSnapshotMeta())?.snapshotId as string;
    const tool = app.registry.get("getMistakeDetail")!;
    const envelope = (await tool.run(
      { recordId: "bookA0000000000000000000000000001:noteX999" },
      { sessionId: "s", scope: { notebookIds: [] }, snapshotId: meta, signal: new AbortController().signal },
    )) as { ok: boolean };
    assert.equal(envelope.ok, false, "锁定快照内不存在的记录显式 not_found，不回落 latest");
  });
});

describe("证据表落地（§7 / G5）", () => {
  test("执行成功的工具结果落证据行；harness.getEvidence 可回溯；未执行调用无证据", async () => {
    const model = new FakeModelClient();
    model.enqueueMany([
      { text: "查统计", toolCalls: [makeToolCall("getMistakeStats", {})] },
      { approved: true, reason: "ok" },
      { text: `统计完成 ${EXPECTED_AFTER_SNAPSHOT1.totalMistakes}`, toolCalls: [] },
    ]);
    const service = buildServiceWithFakeModel(model);
    const session = await service.createSession({ notebookIds: [] });
    const result = await service.sendMessage(session.id, "req-ev-1", "统计一下", { runId: "run-ev-1" });
    assert.equal(result.status, "completed");

    const rows = app.db.rows("SELECT * FROM evidence WHERE run_id = 'run-ev-1'") as unknown as Array<{
      evidence_id: string; run_id: string; snapshot_id: string; source_type: string; source_ref: string; result_hash: string;
    }>;
    assert.equal(rows.length, 1, "仅 getMistakeStats 一条证据");
    assert.equal(rows[0]!.source_type, "tool_result");
    assert.ok(rows[0]!.source_ref.length > 0, "source_ref = toolCallId");

    // tool_calls.evidence_json 携带 evidenceId（UI 可点击引用）
    const call = app.db.rows("SELECT evidence_json FROM tool_calls WHERE run_id = 'run-ev-1'")[0] as { evidence_json: string | null };
    assert.ok(call.evidence_json);
    const evidenceId = (JSON.parse(call.evidence_json) as { evidenceId: string }).evidenceId;
    assert.equal(evidenceId, rows[0]!.evidence_id);

    // 桥接命令回溯
    const handler = createBridgeHandler({
      service: app.service,
      repository: app.repository,
      runStore: app.runStore,
      evidenceStore: app.evidenceStore,
    });
    const found = await handler("harness.getEvidence", { evidenceId });
    assert.equal(found.ok, true);
    assert.equal((found.data as { runId: string }).runId, "run-ev-1");
    const missing = await handler("harness.getEvidence", { evidenceId: "ev_none" });
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "not_found");
  });

  test("被拒绝/未执行的调用不产生证据行", async () => {
    const model = new FakeModelClient();
    model.enqueueMany([
      { text: "试试越权", toolCalls: [makeToolCall("runShell", { cmd: "ls" })] },
      { text: "被拒绝了", toolCalls: [] },
    ]);
    const service = buildServiceWithFakeModel(model);
    const session = await service.createSession({ notebookIds: [] });
    const result = await service.sendMessage(session.id, "req-ev-2", "越权测试", { runId: "run-ev-2" });
    assert.equal(result.status, "completed");
    const rows = app.db.rows("SELECT COUNT(*) AS n FROM evidence WHERE run_id = 'run-ev-2'")[0] as { n: number };
    assert.equal(rows.n, 0, "unknown_tool 未执行 → 无证据");
  });
});
