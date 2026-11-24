import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { InMemorySessionStore } from "../fixtures/in-memory-stores.ts";
import { AgentService } from "../../src/application/agent-service.ts";
import { newUserMessage } from "../../src/domain/message.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { SessionSummary } from "../../src/application/ports/session-store.ts";

/** S7 用：一条最小 tool_result（验证导出不包含工具明细）。 */
function newToolResultStub() {
  return {
    type: "tool_result" as const,
    id: "exp-t1",
    toolCallId: "call-x",
    status: "ok" as const,
    content: { ok: true, tool: "queryMistakes", data: { records: [] }, evidence: { snapshotId: "s", dataAsOf: "x" } },
    createdAt: new Date().toISOString(),
  };
}

let app: HarnessApp;

before(async () => {
  app = makeApp();
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "fixture", exportedAt: "2026-11-12T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  });
});

describe("P0（v2.4 §13.1）：会话删除/重命名/搜索/摘要", () => {
  test("S1: 重命名——标题持久化、摘要可见；非法标题拒绝", async () => {
    const service = app.service;
    const session = await service.createSession({ notebookIds: [] });
    await service.renameSession(session.id, "泰勒展开错题分析");
    const stored = await service.getSession(session.id);
    assert.equal(stored?.title, "泰勒展开错题分析");
    const summaries = await service.listSessionSummaries(50);
    const found = summaries.find((s) => s.id === session.id);
    assert.ok(found);
    assert.equal(found?.title, "泰勒展开错题分析");

    await assert.rejects(() => service.renameSession(session.id, "   "), /标题/);
    await assert.rejects(() => service.renameSession(session.id, ""), /标题/);
    await assert.rejects(() => service.renameSession(session.id, "x".repeat(129)), /标题/);
    await assert.rejects(() => service.renameSession("no-such", "标题"), /会话不存在/);
  });

  test("S2: 软删除——列表消失、get 仍可读（deletedAt 置位）、消息/运行/审计行保留", async () => {
    const service = app.service;
    const session = await service.createSession({ notebookIds: [] });
    await app.store.append(session.id, newUserMessage("要删除的消息"));
    await app.runStore.startRun("run-s2", session.id, "snap", "req-s2");
    await service.deleteSession(session.id);

    const summaries = await service.listSessionSummaries(50);
    assert.ok(!summaries.some((s) => s.id === session.id));

    // get 仍返回（审计可回溯）；deletedAt 置位
    const stored = await service.getSession(session.id);
    assert.ok(stored);
    assert.ok(stored?.deletedAt);
    // 消息行保留
    assert.equal(stored?.messages.length, 1);
    // 运行行保留
    assert.ok(app.runStore.get("run-s2"));

    // 已删除会话不出现在 list()
    const listed = await app.store.list(50);
    assert.ok(!listed.some((s) => s.id === session.id));

    // 重复删除幂等
    await service.deleteSession(session.id);
  });

  test("S8: 彻底删除——物理清除会话/消息/运行行；软删除后仍可彻底删除；幂等", async () => {
    const service = app.service;
    const session = await service.createSession({ notebookIds: [] });
    await app.store.append(session.id, newUserMessage("彻底删除的消息"));
    await app.runStore.startRun("run-s8", session.id, "snap", "req-s8");

    await service.purgeSession(session.id);
    assert.equal(await service.getSession(session.id), null);
    assert.equal(app.db.rows("SELECT 1 FROM sessions WHERE session_id = ?", [session.id]).length, 0);
    assert.equal(app.db.rows("SELECT 1 FROM session_events WHERE session_id = ?", [session.id]).length, 0);
    assert.equal(app.db.rows("SELECT 1 FROM runs WHERE session_id = ?", [session.id]).length, 0);
    assert.equal(app.runStore.get("run-s8"), null);

    // 软删除 → 彻底删除（保留期后清理的等价路径）
    const soft = await service.createSession({ notebookIds: [] });
    await service.deleteSession(soft.id);
    await service.purgeSession(soft.id);
    assert.equal(await service.getSession(soft.id), null);

    // 幂等：重复彻底删除不报错
    await service.purgeSession(session.id);
  });

  test("S3: 摘要列表——messageCount 正确、按 updatedAt 倒序、不携带消息体", async () => {
    const service = app.service;
    const a = await service.createSession({ notebookIds: [] });
    const b = await service.createSession({ notebookIds: [] });
    // 时间戳间隔：避免同毫秒平局影响 updatedAt 排序断言
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.store.append(a.id, newUserMessage("A 的第一条"));
    await app.store.append(a.id, newUserMessage("A 的第二条"));
    // b 无消息

    const summaries = await service.listSessionSummaries(50);
    const sa = summaries.find((s) => s.id === a.id);
    const sb = summaries.find((s) => s.id === b.id);
    assert.ok(sa && sb);
    assert.equal(sa.messageCount, 2);
    assert.equal(sb.messageCount, 0);
    // a 被追加过 → updatedAt 更新 → 排在 b 前
    const idxA = summaries.findIndex((s) => s.id === a.id);
    const idxB = summaries.findIndex((s) => s.id === b.id);
    assert.ok(idxA < idxB, "updatedAt 新的会话应排在前面");
    // 不加载消息体
    assert.ok(!("messages" in sa));
    assert.equal(sa.reviewLevel, "provenance");
  });

  test("S4: 搜索——标题与首条用户消息预览匹配；无命中返回空", async () => {
    const service = app.service;
    const t = await service.createSession({ notebookIds: [] });
    await service.renameSession(t.id, "泰勒展开求极限");
    const p = await service.createSession({ notebookIds: [] });
    await app.store.append(p.id, newUserMessage("帮我分析泛函分析入门题"));

    // 关键词避开 S1 的"泰勒展开错题分析"
    const byTitle = await service.listSessionSummaries(50, "求极限");
    assert.deepEqual(byTitle.map((s) => s.id), [t.id]);
    const byPreview = await service.listSessionSummaries(50, "泛函");
    assert.deepEqual(byPreview.map((s) => s.id), [p.id]);
    const none = await service.listSessionSummaries(50, "不存在的关键词xyz");
    assert.deepEqual(none, []);
  });

  test("S5: 迁移 v8/v9——title/deleted_at/finish_reason 列存在，旧数据兼容", () => {
    const cols = app.db.rows("PRAGMA table_info(sessions)").map((r) => String((r as { name: string }).name));
    assert.ok(cols.includes("title"), "sessions.title 列缺失");
    assert.ok(cols.includes("deleted_at"), "sessions.deleted_at 列缺失");
    const runCols = app.db.rows("PRAGMA table_info(runs)").map((r) => String((r as { name: string }).name));
    assert.ok(runCols.includes("finish_reason"), "runs.finish_reason 列缺失");
  });

  test("S7: 导出 Markdown——标题化引用、剔除技术链接与工具 JSON（§13.1）", async () => {
    const service = app.service;
    const session = await service.createSession({ notebookIds: ["bookA0000000000000000000000000001"] });
    await service.renameSession(session.id, "导出测试会话");
    const A1 = "bookA0000000000000000000000000001:noteA001";
    await app.store.append(session.id, newUserMessage("哪些错题要复习？"));
    // v2.4 协议回答（card:/stat: 链接）+ 旧式裸 recordId（已知标题 → 替换）
    await app.store.append(session.id, {
      type: "assistant", id: "exp-a1",
      text: `建议复习 [《错题 1：一元二次方程》](card:${A1})。统计见 [统计](stat:snap1@x)。旧引用 ${A1}。`,
      toolCalls: [], createdAt: new Date().toISOString(),
    });
    await app.store.append(session.id, newToolResultStub());
    const result = await service.exportSessionMarkdown(session.id);
    assert.match(result.markdown, /# CardLink AI 分析会话/);
    assert.match(result.markdown, /导出测试会话/);
    assert.match(result.markdown, /哪些错题要复习？/);
    assert.match(result.markdown, /《错题 1：一元二次方程》/);
    // 技术链接/标记剔除
    assert.ok(!/\]\(card:/.test(result.markdown), "导出不得保留 card: 链接");
    assert.ok(!/\]\(stat:/.test(result.markdown), "导出不得保留 stat: 链接");
    assert.ok(!/\{\{card:/.test(result.markdown), "导出不得残留引用标记");
    // 已知标题的裸 recordId → 标题替换
    assert.ok(!result.markdown.includes(A1), "已知标题的 recordId 应被标题替换");
    assert.match(result.markdown, /旧引用 错题 1：一元二次方程/);
    // 工具结果 JSON 不导出
    assert.ok(!result.markdown.includes("tool_result"), "工具结果明细不导出");
    // 不存在会话
    await assert.rejects(() => service.exportSessionMarkdown("no-such"), /会话不存在/);
  });

  test("S6: InMemoryStore 与 SQLite 摘要契约一致", async () => {
    const mem = new InMemorySessionStore();
    const memService = new AgentService({
      store: mem, model: {} as never, assistant: {} as never, reviewer: {} as never,
      guard: {} as never, executor: {} as never, evidenceValidator: {} as never,
      auditLog: {} as never, repository: app.repository,
      config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
      assistantSetting: {} as never, reviewerSetting: {} as never,
    });
    const s = await memService.createSession({ notebookIds: [] });
    await mem.append(s.id, newUserMessage("内存摘要"));
    await memService.renameSession(s.id, "内存标题");
    const summaries = await memService.listSessionSummaries(10);
    const found: SessionSummary | undefined = summaries.find((x) => x.id === s.id);
    assert.ok(found);
    assert.equal(found.title, "内存标题");
    assert.equal(found.messageCount, 1);
    assert.equal(found.lastPreview, "内存摘要");
    await memService.deleteSession(s.id);
    assert.deepEqual(await memService.listSessionSummaries(10), []);
  });
});
