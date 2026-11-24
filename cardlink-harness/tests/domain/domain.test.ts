import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { RECORD_ID_PATTERN, extractRecordIdCandidates } from "../../src/domain/mistake.ts";
import { decisionOutputSchema } from "../../src/domain/decision.ts";
import { assistantMessageOutputSchema } from "../../src/domain/assistant-output.ts";
import { validateUserText } from "../../src/domain/message.ts";
import { validateSessionScope } from "../../src/domain/session.ts";
import { endOfLocalDay, assertTimeZone } from "../../src/application/statistics-engine.ts";

describe("domain: recordId", () => {
  test("recordId 形态 = sourceNotebookId:sourceNoteId", () => {
    const id = "bookA0000000000000000000000000001:noteA001";
    assert.ok(RECORD_ID_PATTERN.test(id));
    assert.ok(!RECORD_ID_PATTERN.test("https://example.com/a:b"));
    assert.ok(!RECORD_ID_PATTERN.test("short:x"));
  });

  test("从文本提取疑似 recordId 供证据校验", () => {
    const text = "错题 bookA0000000000000000000000000001:noteA001 与 bookB0000000000000000000000000001:noteB002 相关，链接 https://x.y/a:b 忽略";
    const found = extractRecordIdCandidates(text);
    assert.ok(found.includes("bookA0000000000000000000000000001:noteA001"));
    assert.ok(found.includes("bookB0000000000000000000000000001:noteB002"));
    assert.ok(!found.some((f) => f.includes("x.y")));
  });
});

describe("domain: 输出 Schema 运行时校验", () => {
  test("Decision schema：approved/reason 必填且类型正确", () => {
    const schema = decisionOutputSchema();
    assert.deepEqual(schema.parse({ approved: true, reason: "与请求相关" }), { approved: true, reason: "与请求相关" });
    assert.throws(() => schema.parse({ approved: "yes", reason: "x" }));
    assert.throws(() => schema.parse({ approved: true }));
  });

  test("AssistantMessage schema：填充元数据并限制工具调用数", () => {
    const schema = assistantMessageOutputSchema();
    const parsed = schema.parse({ text: "结论", toolCalls: [{ id: "t1", name: "getMistakeStats", arguments: {} }] });
    assert.equal(parsed.type, "assistant");
    assert.equal(parsed.text, "结论");
    assert.equal(parsed.toolCalls.length, 1);
    assert.ok(parsed.createdAt);
    assert.throws(() => schema.parse({ text: "x", toolCalls: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: "queryMistakes" })) }));
    assert.throws(() => schema.parse({ toolCalls: [] }));
  });
});

describe("domain: 输入校验", () => {
  test("用户消息长度与空值（§10.1）", () => {
    assert.equal(validateUserText("  查询统计 ").ok, true);
    assert.equal(validateUserText("").ok, false);
    assert.equal(validateUserText("x".repeat(8001)).ok, false);
  });

  test("Session scope 校验", () => {
    const ok = validateSessionScope({ notebookIds: ["bookA0000000000000000000000000001"], subject: "数学" });
    assert.ok(ok.ok);
    assert.equal(validateSessionScope({ notebookIds: "x" }).ok, false);
    assert.equal(validateSessionScope({ notebookIds: Array.from({ length: 65 }, () => "a") }).ok, false);
  });
});

describe("application: 到期口径（§12）", () => {
  test("本地当日 24:00 边界（Asia/Shanghai）", () => {
    assertTimeZone("Asia/Shanghai");
    const statsTime = new Date("2026-11-12T22:00:00+08:00");
    const boundary = endOfLocalDay(statsTime, "Asia/Shanghai");
    assert.equal(boundary.toISOString(), "2026-11-12T16:00:00.000Z"); // = 2026-11-13 00:00+08
  });

  test("UTC 时区边界", () => {
    const boundary = endOfLocalDay(new Date("2026-11-12T06:00:00Z"), "UTC");
    assert.equal(boundary.toISOString(), "2026-11-13T00:00:00.000Z");
  });

  test("非法时区显式报错", () => {
    assert.throws(() => assertTimeZone("Not/AZone"));
  });
});
