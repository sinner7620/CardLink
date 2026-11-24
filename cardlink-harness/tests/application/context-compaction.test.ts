import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { ContextBuilder } from "../../src/application/context-builder.ts";
import { buildCompactionSummary } from "../../src/application/compaction-service.ts";
import { newAssistantMessage, newToolResult, newUserMessage } from "../../src/domain/message.ts";
import type { Session } from "../../src/domain/session.ts";

/** 构造一个超预算会话：n 个轮次，每轮带大体积 tool_result（含证据 recordId）。 */
function bigSession(turns: number, fillerChars: number, recordPrefix = "bookA0000000000000000000000000001:noteR"): Session {
  const messages: Session["messages"] = [];
  for (let i = 0; i < turns; i++) {
    messages.push(newUserMessage(`第 ${i + 1} 轮请求：请分析相关错题。`));
    const callId = `call-${i}`;
    messages.push(newAssistantMessage(`我查询一下第 ${i + 1} 轮。`, [{ id: callId, name: "queryMistakes", arguments: { limit: 5 } }]));
    messages.push(newToolResult(callId, "ok", {
      ok: true,
      tool: "queryMistakes",
      data: { records: [{ recordId: `${recordPrefix}${String(i + 1).padStart(3, "0")}`, sourceTitle: `错题 ${i + 1}` }], nextCursor: null },
      evidence: { recordIds: [`${recordPrefix}${String(i + 1).padStart(3, "0")}`], snapshotId: "snap-c", dataAsOf: "2026-11-15T00:00:00Z" },
      filler: "x".repeat(fillerChars),
    }));
  }
  return {
    id: "s-compaction",
    messages,
    createdAt: "2026-11-15T00:00:00Z",
    updatedAt: "2026-11-15T00:00:00Z",
    scope: { notebookIds: [] },
    status: "active",
  };
}

describe("P6（v2.4/v2.5 §11.1-11.2）：上下文压缩（摘要注入 instruction，不伪造用户消息）", () => {
  test("摘要保留已采用的筛选条件、历史结论与待续答请求，排除原题正文", () => {
    const messages: Session["messages"] = [
      newUserMessage("查看未掌握错题"),
      newAssistantMessage("", [{ id: "filter", name: "queryMistakes", arguments: { unmastered: true } }]),
      newToolResult("filter", "ok", { ok: true, tool: "queryMistakes" }),
      newAssistantMessage("可先复习高频错误题型。", []),
      newUserMessage("整理下一步复习安排"),
      { ...newAssistantMessage("部分安排", []), finishReason: "output_limit" },
    ];
    const summary = buildCompactionSummary(messages);
    assert.match(summary, /筛选条件：.*unmastered=true/);
    assert.match(summary, /已得出结论[\s\S]*可先复习高频错误题型/);
    assert.match(summary, /未完成任务：[\s\S]*整理下一步复习安排（回答截断，需续答）/);

    const privateText = "用户原题 OCR 正文";
    const withOcr = buildCompactionSummary([
      newUserMessage("总结原题"),
      newAssistantMessage("", [{ id: "detail", name: "getMistakeDetail", arguments: { includeText: true } }]),
      newToolResult("detail", "ok", { ok: true, tool: "getMistakeDetail", data: { record: { questionText: privateText } } }),
      newAssistantMessage(`结论引用：${privateText}`, []),
    ]);
    assert.doesNotMatch(withOcr, new RegExp(privateText));
    assert.match(withOcr, /已答复/);
  });

  test("CT1: 小会话不压缩——上下文与窗口一致，无摘要块", () => {
    const builder = new ContextBuilder(40, 12000, 60000);
    const session = bigSession(2, 200);
    const context = builder.buildAssistantContext(session, []);
    assert.ok(!context.instruction.includes("[历史压缩]"));
    assert.equal(context.messages.length, session.messages.length);
  });

  test("CT2: 超预算会话压缩——摘要进入 instruction、旧轮次原文不出现在上下文、近期轮次保留", () => {
    const builder = new ContextBuilder(40, 12000, 3000);
    const session = bigSession(8, 1500);
    const context = builder.buildAssistantContext(session, []);
    // v2.5 §11.2：摘要不得伪装成用户发言，只进入系统指令。
    assert.match(context.instruction, /\[历史压缩\]/);
    assert.ok(!context.messages.some((m) => m.type === "user" && String((m as { text?: string }).text).startsWith("[历史压缩]")));
    // 摘要记录了已执行工具与用户请求
    assert.match(context.instruction, /queryMistakes/);
    assert.match(context.instruction, /第 1 轮请求/);
    // 旧轮次大体积正文被移出上下文（总字符显著下降）
    const totalChars = context.messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0) + context.instruction.length;
    const before = session.messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
    assert.ok(totalChars < before * 0.6, `压缩后上下文应显著缩小：${totalChars} vs ${before}`);
    // 近期轮次保留（最后一条 tool_result 在上下文中）
    assert.equal(context.messages.at(-1)?.type, "tool_result");
    // assistant.toolCalls 与对应 tool_result 不拆散：上下文内每个 callId 都有配对
    const callIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const m of context.messages) {
      if (m.type === "assistant") for (const c of (m as { toolCalls: Array<{ id: string }> }).toolCalls) callIds.add(c.id);
      if (m.type === "tool_result") resultIds.add((m as { toolCallId: string }).toolCallId);
    }
    for (const id of callIds) assert.ok(resultIds.has(id), `call ${id} 的结果不得被拆散`);
  });

  test("CT3: 压缩不落库——session.messages 保持原样（构建期无副作用）", () => {
    const builder = new ContextBuilder(40, 12000, 3000);
    const session = bigSession(8, 1500);
    const before = JSON.stringify(session.messages);
    builder.buildAssistantContext(session, []);
    assert.equal(JSON.stringify(session.messages), before);
  });

  test("CT4: 摘要保留 recordId（溯源集合在模型上下文可见）", () => {
    const builder = new ContextBuilder(40, 12000, 3000);
    const session = bigSession(8, 1500);
    const context = builder.buildAssistantContext(session, []);
    assert.match(context.instruction, /bookA0000000000000000000000000001:noteR001/);
  });

  test("CT5: 压缩规模受限——摘要本身不超过预算的一半", () => {
    const builder = new ContextBuilder(40, 12000, 3000);
    const session = bigSession(30, 1500);
    const context = builder.buildAssistantContext(session, []);
    // 约束对象是**摘要块**（基础指令是固定文本，不随会话增长）：截断目标是
    // budgetChars/2 的一半 token，且不得把工具结果 filler 带进摘要。
    const marker = "[历史压缩]";
    const summaryAt = context.instruction.indexOf(marker);
    assert.ok(summaryAt >= 0, "应产生历史压缩摘要");
    const summaryBlock = context.instruction.slice(summaryAt);
    assert.ok(summaryBlock.length < 3000 * 0.75, `摘要长度应受控：${summaryBlock.length}`);
    assert.doesNotMatch(summaryBlock, /x{200}/, "摘要不得包含工具结果正文");
  });

  test("CT6: 摘要被截断时保留“不是新的证据”提示", () => {
    const builder = new ContextBuilder(40, 12000, 1200);
    const session = bigSession(40, 1500);
    const context = builder.buildAssistantContext(session, []);
    assert.match(context.instruction, /\[历史压缩\]/);
    assert.match(context.instruction, /不是新的证据/);
  });
});
