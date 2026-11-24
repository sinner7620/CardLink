import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { CitationResolver, escapeLinkText } from "../../src/application/citation-resolver.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { StatisticEvidence, TurnEvidence } from "../../src/domain/evidence.ts";
import type { SessionScope } from "../../src/domain/session.ts";

let app: HarnessApp;
let resolver: CitationResolver;
let snapshotId: string;
const SCOPE: SessionScope = { notebookIds: ["bookA0000000000000000000000000001"] };
const A1 = "bookA0000000000000000000000000001:noteA001";

before(async () => {
  app = makeApp();
  ({ snapshotId } = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "citation-fixture", exportedAt: "2026-11-15T08:00:00+08:00",
    isFullSnapshot: true, records: snapshot1(),
  }));
  resolver = new CitationResolver(app.repository);
});

function evidenceWith(recordIds: string[], statistics: StatisticEvidence[] = []): TurnEvidence {
  return { snapshotId, dataAsOf: "2026-11-15T08:00:00Z", recordIds, statistics };
}

describe("P4（v2.4 §10.1.1）：CitationResolver", () => {
  test("CR1: 有效引用（本轮已读）→ available 卡片引用 + 标题来自 CardLink 数据 + display 重写为标题链接", async () => {
    const text = `建议优先复习 {{card:ref_1|${A1}}}。`;
    const result = await resolver.resolve(text, evidenceWith([A1]), SCOPE);
    assert.equal(result.citations.length, 1);
    const citation = result.citations[0];
    assert.equal(citation.type, "card");
    assert.equal(citation.available, true);
    assert.equal((citation as { ref: string }).ref, "ref_1");
    assert.match((citation as { title: string }).title, /错题/);
    assert.ok((citation as { title: string }).title.length > 0);
    assert.ok(!/bookA0000000000000000000000000001/.test(result.displayText.replace("card:" + A1, "")), "正文不应残留内部标记");
    assert.match(result.displayText, /\[《[^》]+》\]\(card:[^)]+\)/);
  });

  test("CR2: 伪造 recordId（不在本轮证据）→ available:false，正文降级且不泄露内部 ID", async () => {
    const fake = "bookA0000000000000000000000000001:noteFAKE99";
    const text = `建议复习 {{card:ref_1|${fake}}}。`;
    const result = await resolver.resolve(text, evidenceWith([]), SCOPE);
    const citation = result.citations[0];
    assert.equal(citation.available, false);
    assert.match(result.displayText, /引用不可用/);
    assert.ok(!result.displayText.includes(fake), "降级文本不得泄露内部 ID");
    assert.ok(!result.displayText.includes("ref_1"), "降级文本不得残留引用标记");
  });

  test("CR3: 存在但不在授权范围（scope 之外读取伪造）→ available:false", async () => {
    // B 笔记本记录在 fixture 中存在，但 scope 只授权 bookA
    const outside = "bookB0000000000000000000000000001:noteB001";
    const text = `跨范围引用 {{card:ref_1|${outside}}}。`;
    const result = await resolver.resolve(text, evidenceWith([outside]), SCOPE);
    assert.equal(result.citations[0].available, false);
    assert.match(result.displayText, /引用不可用/);
  });

  test("CR4: 统计数值按具体工具结果和字段渲染，拒绝跨结果、非法路径和伪造链接", async () => {
    const statistics = [
      { evidenceId: "ev_whole", ref: "s1", toolCallId: "all", toolName: "getMistakeStats", data: { totalRecords: 100, dueCount: 0 } },
      { evidenceId: "ev_filtered", toolCallId: "filtered", toolName: "getMistakeStats", data: { totalRecords: 12 } },
    ];
    const ok = await resolver.resolve(
      "总计 {{stat:ref_1|s1|totalRecords}} 道，筛选后 {{stat:ref_2|ev_filtered|totalRecords}} 道，到期 {{stat:ref_3|ev_whole|dueCount}} 道。",
      evidenceWith([], statistics), SCOPE,
    );
    assert.equal(ok.unverifiedStatistics, 0);
    assert.match(ok.displayText, /\[100\]\(stat:ev_whole\).*\[12\]\(stat:ev_filtered\).*\[0\]\(stat:ev_whole\)/);

    const bad = await resolver.resolve(
      "共 99 道错题 [99](stat:ev_whole) {{stat:ref_1|ev_filtered|dueCount}} {{stat:ref_2|ev_previous|totalRecords}} {{stat:ref_3|ev_whole|constructor}} {{stat:ref_4|snap-x@2026-11-15T08:00:00Z}}",
      evidenceWith([], statistics), SCOPE,
    );
    assert.ok(bad.citations.every((citation) => !citation.available));
    assert.match(bad.displayText, /数值未核验/);
    assert.match(bad.displayText, /统计来源不可用/);
    assert.doesNotMatch(bad.displayText, /\]\(stat:/);
  });

  test("模型直接生成的卡片链接在原 Run 快照校验，忽略模型自拟的标题", async () => {
    const local = makeApp();
    const records = snapshot1();
    const original = await local.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "direct-card", exportedAt: "2026-11-15T07:00:00Z", isFullSnapshot: true, records,
    });
    await local.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "direct-card", exportedAt: "2026-11-15T08:00:00Z", isFullSnapshot: true, records: records.slice(1),
    });
    const direct = new CitationResolver(local.repository);
    const text = `[模型自拟标题](card:${A1})`;
    const evidence = { ...evidenceWith([A1]), snapshotId: original.snapshotId };
    const valid = await direct.resolve(text, evidence, SCOPE);
    assert.equal(valid.citations[0]?.available, true);
    assert.match(valid.displayText, /\[《错题[^》]+》\]\(card:/);
    assert.doesNotMatch(valid.displayText, /模型自拟标题/);
    const unavailable = await direct.resolve(text, { ...evidence, recordIds: [] }, SCOPE);
    assert.equal(unavailable.citations[0]?.available, false);
    assert.doesNotMatch(unavailable.displayText, /card:/);
  });

  test("Markdown 表格的转义竖线、空格标记和重复编号均独立核对实际证据", async () => {
    const evidence = evidenceWith([A1], [
      {
        evidenceId: "ev_ranking", ref: "s1", toolCallId: "rank", toolName: "queryMistakes",
        data: { records: [{ verifiedReviewCount: 7 }], reviewCoverage: { matchingRecords: 11 } },
      },
      { evidenceId: "ev_totals", ref: "s2", toolCallId: "totals", toolName: "getMistakeStats", data: { levelCounts: { "0": 9, "1": 2 } } },
    ]);
    const text = [
      "| 题目 | 复习次数 |",
      "| --- | --- |",
      `| {{card:ref_2\\|${A1}}} | {{stat:ref_2\\|s1\\|data.records[0].verifiedReviewCount}} |`,
      "不会 {{stat:ref_2 s2 data.levelCounts[0]}} 道，匹配 {{stat:ref_2 s1 reviewCoverage.matchingRecords}} 道。",
      "错绑 {{stat:ref_2 s1 levelCounts.0}} 道。",
    ].join("\n");
    const resolved = await resolver.resolve(text, evidence, SCOPE);
    assert.match(resolved.displayText, /\| \[《[^》]+》\]\(card:[^)]+\) \| \[7\]\(stat:ev_ranking\) \|/);
    assert.match(resolved.displayText, /\[9\]\(stat:ev_totals\)/);
    assert.match(resolved.displayText, /\[11\]\(stat:ev_ranking\)/);
    assert.match(resolved.displayText, /错绑 （统计来源不可用）/);
    assert.doesNotMatch(resolved.displayText, /\{\{/);
    assert.equal(resolved.unverifiedStatistics, 1);
  });

  test("排名表中的已核验引用可在总结中按编号和完整题名复用", async () => {
    const [first, second] = snapshot1();
    const evidence = evidenceWith([first.recordId, second.recordId], [
      { evidenceId: "ev_rank", ref: "s1", toolCallId: "rank", toolName: "queryMistakes", data: { records: [{ verifiedReviewCount: 7 }] } },
    ]);
    const text = [
      "先看 {{card:ref_1}}。",
      "| 题名 | 复习次数 |",
      "| --- | --- |",
      `| {{card:ref_1 ${first.recordId}}} | {{stat:ref_2 s1 records.0.verifiedReviewCount}} |`,
      `优先关注 {{card:ref_1}} 和 {{card:ref_3 《${second.sourceTitle}》}}，表中记录复习 {{stat:ref_2}} 次。`,
    ].join("\n");
    const result = await resolver.resolve(text, evidence, SCOPE);
    assert.equal(result.unresolved, 0);
    assert.equal(result.unverifiedStatistics, 0);
    assert.equal(result.displayText.split(`(card:${first.recordId})`).length - 1, 3);
    assert.ok(result.displayText.includes(`(card:${second.recordId})`));
    assert.equal(result.displayText.split("[7](stat:ev_rank)").length - 1, 2);
    assert.equal(result.citations.length, 3);
  });

  test("同编号指向两张卡片或同题名有两条证据时，短引用保持不可用", async () => {
    const local = makeApp();
    const [first, second, unread] = snapshot1();
    const sameTitle = "同一道题的两条记录";
    const { snapshotId: localSnapshotId } = await local.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "ambiguous-title", exportedAt: "2026-11-15T07:00:00Z", isFullSnapshot: true,
      records: [{ ...first, sourceTitle: sameTitle }, { ...second, sourceTitle: sameTitle }, unread],
    });
    const text = `{{card:ref_1 ${first.recordId}}} {{card:ref_1 ${second.recordId}}} {{card:ref_1}} {{card:ref_3 ${sameTitle}}} {{card:ref_5 ${unread.sourceTitle}}}`;
    const result = await new CitationResolver(local.repository).resolve(
      text,
      { ...evidenceWith([first.recordId, second.recordId]), snapshotId: localSnapshotId },
      SCOPE,
    );
    assert.equal(result.unresolved, 3);
    assert.equal(result.displayText.match(/\]\(card:/g)?.length, 2);
  });

  test("CR5: 同一 ref 重复使用 → 同一替换一致；裸 recordId 改写为同一标题引用", async () => {
    const text = `{{card:ref_1|${A1}}} 与 {{card:ref_1|${A1}}} 再次出现；裸 ID ${A1}。`;
    const result = await resolver.resolve(text, evidenceWith([A1]), SCOPE);
    // 三处指向同一记录 → 复用同一 DTO，不产生重复引用条目
    assert.equal(result.citations.length, 1);
    const matches = result.displayText.match(/\[《[^》]+》\]\(card:/g) ?? [];
    assert.equal(matches.length, 3);
    assert.ok(!result.displayText.includes(`裸 ID ${A1}`), "裸 recordId 不得在正文中原文出现（链接目标除外）");
    assert.equal(result.unresolved, 0);
  });

  test("CR5b: 裸 recordId 在本轮证据内 → 点击引用可用；正文其余部分保持原样", async () => {
    const text = `建议复习 ${A1}，先看题干。`;
    const result = await resolver.resolve(text, evidenceWith([A1]), SCOPE);
    const citation = result.citations.find((c) => c.type === "card") as { recordId?: string; available?: boolean } | undefined;
    assert.ok(citation);
    assert.equal(citation?.recordId, A1);
    assert.equal(citation?.available, true);
    assert.match(result.displayText, /^建议复习 \[《[^》]+》\]\(card:[^)]+\)，先看题干。$/);
  });

  test("CR5c: 裸 recordId 可解析但未经本轮证据 → 标题 + 未校验来源，且不生成可点击引用", async () => {
    const result = await resolver.resolve(`参考 ${A1}。`, evidenceWith([]), SCOPE);
    assert.match(result.displayText, /《[^》]+》（未校验来源）/);
    assert.ok(!result.displayText.includes(A1), "未核验引用不得泄露内部 ID");
    assert.equal(result.citations.length, 0);
    assert.equal(result.unresolved, 1);
  });

  test("CR5d: 无法解析的裸 recordId → 脱敏占位，不泄露 ID", async () => {
    const ghost = "bookA0000000000000000000000000001:noteGONE999";
    const result = await resolver.resolve(`疑似 ${ghost} 不存在。`, evidenceWith([]), SCOPE);
    assert.match(result.displayText, /无法识别的卡片引用/);
    assert.ok(!result.displayText.includes(ghost));
    assert.equal(result.unresolved, 1);
  });

  test("CR5e: 代码块与行内代码里的 ID 不改写（示例文本保持原样）", async () => {
    const text = `示例：\`${A1}\` 与\n\n\`\`\`\n${A1}\n\`\`\`\n\n正文结束。`;
    const result = await resolver.resolve(text, evidenceWith([A1]), SCOPE);
    assert.equal(result.displayText, text);
    assert.equal(result.citations.length, 0);
  });

  test("CR8: 卡片标题按 Markdown 链接文本转义（含 [] 与换行）", () => {
    assert.equal(escapeLinkText("a[b]c"), "a\\[b\\]c");
    assert.equal(escapeLinkText("甲|乙"), "甲\\|乙");
    assert.equal(escapeLinkText("line1\nline2"), "line1 line2");
    assert.equal(escapeLinkText("反斜杠\\结尾"), "反斜杠\\\\结尾");
  });

  test("CR6: 无标记文本原样通过", async () => {
    const text = "普通回答，没有引用标记。";
    const result = await resolver.resolve(text, evidenceWith([]), SCOPE);
    assert.equal(result.displayText, text);
    assert.deepEqual(result.citations, []);
  });

  test("CR7: AgentService 集成——最终消息落库为重写文本，TurnResult 携带 citations 与 rawText", async () => {
    const { FakeModelClient } = await import("../../src/adapters/model/fake-model-client.ts");
    const { InMemorySessionStore } = await import("../fixtures/in-memory-stores.ts");
    const { AgentService } = await import("../../src/application/agent-service.ts");
    const { AssistantRole } = await import("../../src/application/assistant-role.ts");
    const { ReviewerRole } = await import("../../src/application/reviewer-role.ts");
    const { ContextBuilder } = await import("../../src/application/context-builder.ts");
    const { PolicyGuard } = await import("../../src/application/policy-guard.ts");
    const { ToolExecutor } = await import("../../src/application/tool-executor.ts");
    const { EvidenceValidator } = await import("../../src/application/evidence-validator.ts");
    const { makeToolCall } = await import("../helpers/harness.ts");
    const SETTING = { provider: "test", model: "fake", effort: "low" as const, timeoutMs: 1000, maxOutputTokens: 1024 };
    const localApp = app;
    // 分页顺序不保证按 recordId 排列：先探测 queryMistakes 实际返回的第一条 recordId，
    // 再据此脚本化最终回答（保证该记录真实进入本轮证据）。
    const queryArgs = { notebookIds: ["bookA0000000000000000000000000001"], limit: 5 };
    const probe = await localApp.registry.get("queryMistakes")!.run(
      queryArgs,
      {
        sessionId: "probe-cr7",
        scope: { notebookIds: ["bookA0000000000000000000000000001"] },
        snapshotId: (await localApp.repository.getLatestSnapshotMeta())?.snapshotId ?? "none",
        signal: { get aborted() { return false } },
      } as never,
    ) as { data?: { records?: Array<{ recordId: string }> } };
    const firstRecordId = probe.data?.records?.[0]?.recordId ?? A1;
    assert.ok(firstRecordId);
    const model = new FakeModelClient();
    const store = new InMemorySessionStore();
    const queryCall = makeToolCall("queryMistakes", queryArgs);
    model.enqueueMany([
      { text: "查询", toolCalls: [{ id: queryCall.id, name: "queryMistakes", arguments: queryCall.arguments }] },
      { approved: true, reason: "ok" },
      { text: `建议复习 {{card:ref_1|${firstRecordId}}}。`, toolCalls: [] },
    ]);
    const builder = new ContextBuilder();
    const service = new AgentService({
      store, model,
      assistant: new AssistantRole(builder, localApp.registry.definitions()),
      reviewer: new ReviewerRole(builder, localApp.registry),
      guard: new PolicyGuard(localApp.registry, 8),
      executor: new ToolExecutor(localApp.registry, 3000),
      evidenceValidator: new EvidenceValidator(localApp.repository),
      auditLog: { record: async () => {} } as never,
      repository: localApp.repository,
      citationResolver: resolver,
      config: { maxIterations: 4, maxToolCallsPerTurn: 8 },
      assistantSetting: SETTING,
      reviewerSetting: SETTING,
    });
    const session = await service.createSession({ notebookIds: ["bookA0000000000000000000000000001"] });
    const result = await service.sendMessage(session.id, "req-cr7", "哪些错题要复习？");
    assert.equal(result.status, "completed");
    const citation = (result.citations ?? []).find((c) => c.type === "card");
    assert.ok(citation, "结果应携带 citations");
    assert.equal((citation as { available: boolean }).available, true);
    assert.equal((citation as { recordId: string }).recordId, firstRecordId);
    // 会话消息落库为重写后的展示文本（不含标记）
    const stored = await store.get(session.id);
    const lastAssistant = stored?.messages.filter((m) => m.type === "assistant").at(-1) as { text?: string } | undefined;
    assert.ok(lastAssistant);
    assert.ok(!lastAssistant.text?.includes("{{card:"), "落库文本不得含引用标记");
    assert.match(lastAssistant.text ?? "", /\[《/);
    // 原始回答保留在 TurnResult（turn_results/审计层持久化）
    assert.match(result.rawText ?? "", /\{\{card:ref_1\|/);
  });
});
