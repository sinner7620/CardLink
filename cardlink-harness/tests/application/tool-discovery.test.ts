import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { buildCompactionSummary } from "../../src/application/compaction-service.ts";
import { newAssistantMessage, newToolResult, newUserMessage } from "../../src/domain/message.ts";
import * as F from "../fixtures/discovery-data.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { ToolEnvelope } from "../../src/domain/evidence.ts";

/**
 * v2.13 §9.2：数据发现与正文分段。
 * 覆盖关键词检索（跨快照命中差异、符号字面量、逐页完整、旧正文不被搜回）、
 * recordIds 批量交集、detail 分段读取与 getReviewHistory 的排序/分页/时间过滤。
 */

let app: HarnessApp;
let snapshotA: string;
let snapshotB: string;

const ALL = { notebookIds: [] as string[] };

before(async () => {
  app = makeApp();
  const first = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "discovery", exportedAt: "2026-11-10T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotA(),
  });
  snapshotA = first.snapshotId;
  const second = await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "discovery", exportedAt: "2026-11-16T08:00:00+08:00",
    isFullSnapshot: true, records: F.discoverySnapshotB(),
  });
  snapshotB = second.snapshotId;
  assert.notEqual(snapshotA, snapshotB);
});

async function runAt(
  snapshotId: string,
  name: string,
  args: unknown,
  scope: { notebookIds: string[] } = ALL,
): Promise<ToolEnvelope> {
  const tool = app.registry.get(name);
  assert.ok(tool, `工具 ${name} 未注册`);
  return (await tool.run(args, {
    sessionId: "discovery-session",
    scope,
    snapshotId,
    signal: new AbortController().signal,
  })) as ToolEnvelope;
}

type PageData = {
  records: Array<Record<string, unknown>>;
  nextCursor?: string;
  missingRecordIds?: string[];
};

function idsOf(page: ToolEnvelope): string[] {
  return (page.data as PageData).records.map((record) => String(record.recordId));
}

async function collectAll(query: Record<string, unknown>, snapshotId = snapshotB, limit = 1): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const envelope = await runAt(snapshotId, "queryMistakes", { ...query, limit, ...(cursor ? { cursor } : {}) });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const page = envelope.data as PageData;
    ids.push(...page.records.map((record) => String(record.recordId)));
    cursor = page.nextCursor;
    if (!cursor) return ids;
  }
  throw new Error("分页未终止");
}

describe("v2.13 §9.2: queryMistakes 关键词检索", () => {
  test("中文连续子串命中随锁定快照变化，另一学习集同样命中，旧 OCR 正文不被搜回", async () => {
    const inA = await collectAll({ contentQuery: "傅里叶变换" }, snapshotA, 50);
    const inB = await collectAll({ contentQuery: "傅里叶变换" }, snapshotB, 50);
    assert.deepEqual(inA.sort(), [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_N1].sort());
    assert.deepEqual(inB.sort(), [F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N1].sort());
    assert.notDeepEqual(inA, inB, "两个快照的命中集合不同");

    // 手工修订优先：被修订替代的旧 OCR 片段不得命中。
    const oldFragment = await runAt(snapshotB, "queryMistakes", { contentQuery: "旧版正文" });
    assert.deepEqual(idsOf(oldFragment), []);
    const revised = await runAt(snapshotB, "queryMistakes", { contentQuery: "拉普拉斯反变换求法" });
    assert.deepEqual(idsOf(revised), [F.DISCOVERY_RECORD_N2], "修订后的正文参与匹配");
  });

  test("ASCII 大小写不敏感，中文与空格保持字面量", async () => {
    const lower = await collectAll({ contentQuery: "fourier" }, snapshotB, 50);
    const upper = await collectAll({ contentQuery: "FOURIER" }, snapshotB, 50);
    assert.deepEqual(lower.sort(), upper.sort(), "仅 ASCII 折叠");
    assert.ok(lower.includes(F.DISCOVERY_RECORD_M4) && lower.includes(F.DISCOVERY_RECORD_N1));

    const spaced = await runAt(snapshotB, "queryMistakes", { contentQuery: "傅里叶 变换" });
    assert.deepEqual(idsOf(spaced), [], "空格是字面量，不做分词或去空白匹配");
  });

  test("% _ 引号与 MATCH/NEAR 运算符字样按字面量处理，且走 SQL 绑定", async () => {
    const percent = await collectAll({ contentQuery: "%" }, snapshotB, 50);
    assert.deepEqual(percent.sort(), [F.DISCOVERY_RECORD_M3, F.DISCOVERY_RECORD_N1].sort(), "% 不是通配符");
    const hundred = await collectAll({ contentQuery: "100%" }, snapshotB, 50);
    assert.deepEqual(hundred.sort(), percent.sort());

    const underscore = await collectAll({ contentQuery: "a_b" }, snapshotB, 50);
    assert.deepEqual(underscore, [F.DISCOVERY_RECORD_N1], "_ 不是单字符通配符");
    const single = await collectAll({ contentQuery: "_" }, snapshotB, 50);
    assert.deepEqual(single, [F.DISCOVERY_RECORD_N1]);

    const quoted = await runAt(snapshotB, "queryMistakes", { contentQuery: '"引号"' });
    assert.deepEqual(idsOf(quoted), [F.DISCOVERY_RECORD_N1]);

    // 全文检索语法字样不得被解释为查询语法（否则 MATCH 路径会报错或误命中）。
    for (const needle of ["NEAR(", "AND", "OR", "MATCH", "*", '"引号" AND']) {
      const envelope = await runAt(snapshotB, "queryMistakes", { contentQuery: needle });
      assert.equal(envelope.ok, true, `${needle} 不应导致工具失败: ${JSON.stringify(envelope.error)}`);
    }
    const near = await runAt(snapshotB, "queryMistakes", { contentQuery: "NEAR(" });
    assert.deepEqual(idsOf(near), [F.DISCOVERY_RECORD_M3]);
  });

  test("与等级/范围/排序同用，逐页完整且无重复", async () => {
    const all = await collectAll({ contentQuery: "变换" }, snapshotB, 1);
    assert.deepEqual(all.slice().sort(), [
      F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N1, F.DISCOVERY_RECORD_N2,
    ].sort());
    assert.equal(new Set(all).size, all.length, "逐页无重复");
    assert.deepEqual(all, await collectAll({ contentQuery: "变换" }, snapshotB, 3), "分页大小不改变结果集合与顺序");

    const level1 = await runAt(snapshotB, "queryMistakes", { contentQuery: "变换", level: 1 });
    assert.deepEqual(idsOf(level1).sort(), [F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N2].sort());
    // 断言：等级过滤沿用现有语义
    assert.ok((level1.data as PageData).records.every((record) => record.level === 1));

    const scoped = await runAt(snapshotB, "queryMistakes", { contentQuery: "变换" }, F.DISCOVERY_SCOPE_MN);
    assert.deepEqual(idsOf(scoped).sort(), [F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N1, F.DISCOVERY_RECORD_N2].sort());
    const onlyN = await runAt(snapshotB, "queryMistakes", { contentQuery: "变换" }, { notebookIds: [F.DISCOVERY_NOTEBOOK_N] });
    assert.deepEqual(idsOf(onlyN).sort(), [F.DISCOVERY_RECORD_N1, F.DISCOVERY_RECORD_N2].sort());

    const sorted = await runAt(snapshotB, "queryMistakes", { contentQuery: "变换", orderBy: "dueAtAsc", limit: 50 });
    assert.equal(sorted.ok, true);
    assert.equal(idsOf(sorted).length, 3, "关键词与排序同用仍取交集");
  });

  test("结果不含题干/答案全文，证据 recordIds 与可见记录一致", async () => {
    const envelope = await runAt(snapshotB, "queryMistakes", { contentQuery: "长篇题干与答案" });
    assert.equal(envelope.ok, true);
    const records = (envelope.data as PageData).records;
    assert.equal(records.length, 1);
    const serialized = JSON.stringify(records);
    assert.ok(!serialized.includes("第0步"), "命中结果不得带出正文");
    assert.equal("questionText" in records[0]!, false);
    assert.equal("answerText" in records[0]!, false);
    assert.deepEqual(envelope.evidence.recordIds, idsOf(envelope));
    assert.equal(envelope.evidence.snapshotId, snapshotB);
  });

  test("游标绑定查询指纹：换快照、换筛选、篡改一律拒绝，旧游标路径不受影响", async () => {
    const first = await runAt(snapshotB, "queryMistakes", { contentQuery: "变换", limit: 2 });
    const cursor = (first.data as PageData).nextCursor;
    assert.ok(cursor);

    await assert.rejects(
      runAt(snapshotB, "queryMistakes", { contentQuery: "变换", level: 1, limit: 2, cursor }),
      /游标与当前查询条件或快照不匹配/,
    );
    await assert.rejects(
      runAt(snapshotB, "queryMistakes", { contentQuery: "Fourier", limit: 2, cursor }),
      /游标与当前查询条件或快照不匹配/,
    );
    await assert.rejects(
      runAt(snapshotA, "queryMistakes", { contentQuery: "变换", limit: 2, cursor }),
      /游标与当前查询条件或快照不匹配/,
    );
    await assert.rejects(
      runAt(snapshotB, "queryMistakes", { contentQuery: "变换", limit: 2, cursor: `${cursor}tampered` }),
      /游标/,
    );

    // 旧路径（无 contentQuery/recordIds）继续使用原游标格式。
    const legacyFirst = await runAt(snapshotB, "queryMistakes", { limit: 3 });
    const legacyCursor = (legacyFirst.data as PageData).nextCursor;
    assert.ok(legacyCursor);
    const legacySecond = await runAt(snapshotB, "queryMistakes", { limit: 3, cursor: legacyCursor });
    assert.equal(legacySecond.ok, true);
    assert.equal(idsOf(legacySecond).length, 3);
    assert.equal(idsOf(legacyFirst).some((id) => idsOf(legacySecond).includes(id)), false);
  });

  test("contentQuery 校验：空串与超长被拒绝", async () => {
    await assert.rejects(runAt(snapshotB, "queryMistakes", { contentQuery: "   " }), /1\.\.128/);
    await assert.rejects(runAt(snapshotB, "queryMistakes", { contentQuery: "x".repeat(129) }), /1\.\.128/);
    const guard = new PolicyGuard(app.registry, 8);
    const denied = guard.check(
      { id: "bad-empty", name: "queryMistakes", arguments: { contentQuery: "" } },
      ALL,
      0,
    );
    assert.equal(denied.ok, false, "空 contentQuery 应被实际模型 Schema 拒绝");
  });
});

describe("v2.13 §9.2: queryMistakes recordIds 批量元数据", () => {
  test("批量 3 道、重复项去重、证据 ID 一一对应且包络有界", async () => {
    const envelope = await runAt(snapshotB, "queryMistakes", {
      recordIds: [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_N1],
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const page = envelope.data as PageData;
    assert.equal(page.records.length, 3, "重复 ID 去重");
    assert.deepEqual(page.missingRecordIds, []);
    assert.deepEqual(idsOf(envelope).sort(), [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N1].sort());
    assert.deepEqual(envelope.evidence.recordIds, idsOf(envelope), "证据 ID 与返回记录一一对应");
    for (const record of page.records) {
      assert.equal("questionText" in record, false);
      assert.equal("answerText" in record, false);
      assert.equal(typeof record.sourceTitle, "string");
      assert.equal(typeof record.level, "number");
    }
    assert.ok(JSON.stringify(envelope).length < 4000, "3 条元数据包络有界");
  });

  test("混合不可见 ID 统一列入 missingRecordIds，不区分不存在与越权", async () => {
    const envelope = await runAt(
      snapshotB,
      "queryMistakes",
      { recordIds: [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_O1, "bookZ0000000000000000000000000001:noteZ999"] },
      { notebookIds: [F.DISCOVERY_NOTEBOOK_M] },
    );
    const page = envelope.data as PageData;
    assert.deepEqual(idsOf(envelope), [F.DISCOVERY_RECORD_M1]);
    assert.deepEqual(page.missingRecordIds, [F.DISCOVERY_RECORD_O1, "bookZ0000000000000000000000000001:noteZ999"]);
    assert.deepEqual(envelope.evidence.recordIds, [F.DISCOVERY_RECORD_M1]);
  });

  test("超过 10 项被实际 Schema 拒绝；与关键词/等级取交集", async () => {
    const tooMany = Array.from({ length: 11 }, (_, index) => `bookM0000000000000000000000000001:noteX${index}`);
    const guard = new PolicyGuard(app.registry, 8);
    const denied = guard.check({ id: "too-many", name: "queryMistakes", arguments: { recordIds: tooMany } }, ALL, 0);
    assert.equal(denied.ok, false, "实际模型 Schema 拒绝超过 10 项");
    await assert.rejects(runAt(snapshotB, "queryMistakes", { recordIds: tooMany }), /最多 10 项/);

    const intersection = await runAt(snapshotB, "queryMistakes", {
      recordIds: [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_M2],
      level: 1,
    });
    assert.deepEqual(idsOf(intersection), [F.DISCOVERY_RECORD_M2], "批量与等级筛选取交集");
  });
});

describe("v2.13 §9.2: getMistakeDetail content 分段", () => {
  test("中文 + emoji 跨边界按码点拼回全文，不切断代理对", async () => {
    const full = Array.from(F.LONG_QUESTION).length;
    let offset = 0;
    let assembled = "";
    let segments = 0;
    for (let guard = 0; guard < 2000; guard++) {
      const envelope = await runAt(snapshotB, "getMistakeDetail", {
        recordId: F.DISCOVERY_RECORD_M5,
        content: { field: "question", offset, limit: 7 },
      });
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      const segment = (envelope.data as { contentSegment: Record<string, unknown> }).contentSegment;
      assert.equal(segment.available, true);
      assert.equal(segment.totalLength, full, "总长按码点计，小于 UTF-16 长度");
      assembled += String(segment.text);
      segments++;
      const nextOffset = segment.nextOffset;
      if (nextOffset === undefined) break;
      assert.equal(typeof nextOffset, "number");
      offset = nextOffset as number;
    }
    assert.ok(segments > 1);
    assert.equal(assembled, F.LONG_QUESTION, "分段拼回与原文逐字符一致");
    assert.ok(full < F.LONG_QUESTION.length, "码点总数小于 UTF-16 码元总数（含 emoji）");
  });

  test("两个字段不串，且分段模式不通过 record 带出其他正文", async () => {
    const question = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_M5,
      content: { field: "question", offset: 0, limit: 12 },
    });
    const qData = question.data as { contentSegment: Record<string, unknown>; record: Record<string, unknown> };
    assert.equal(qData.contentSegment.field, "question");
    assert.equal(String(qData.contentSegment.text).startsWith("第0步"), true);
    assert.equal("questionText" in qData.record, false, "分段模式 record 不带题干");
    assert.equal("answerText" in qData.record, false, "分段模式 record 不带答案");
    assert.equal(String(qData.contentSegment.text).includes("答案要点"), false);

    const answer = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_M5,
      content: { field: "answer", offset: 0, limit: 4000 },
    });
    const aData = answer.data as { contentSegment: Record<string, unknown> };
    assert.equal(aData.contentSegment.field, "answer");
    assert.equal(aData.contentSegment.nextOffset, undefined, "末段省略 nextOffset");
    assert.equal(aData.contentSegment.text, "答案要点：先换元，再分段积分，最后核对符号。");
    assert.equal(JSON.stringify(answer).includes(F.LONG_QUESTION.slice(0, 20)), false, "答案片段不夹带题干");
    assert.deepEqual(answer.evidence.recordIds, [F.DISCOVERY_RECORD_M5]);
  });

  test("缺失答案、无正文、越界偏移与跨 scope 可区分", async () => {
    const noAnswer = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_M6,
      content: { field: "answer" },
    });
    const missing = (noAnswer.data as { contentSegment: Record<string, unknown> }).contentSegment;
    assert.equal(missing.available, false);
    assert.equal(missing.reason, "answer_not_projected");
    assert.equal(missing.text, undefined);
    assert.equal(missing.source, undefined, "未投影答案不返回来源 ID");

    const noText = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_N2,
      content: { field: "question", offset: 0, limit: 10 },
    });
    const questionSegment = (noText.data as { contentSegment: Record<string, unknown> }).contentSegment;
    assert.equal(questionSegment.available, true, "N2 使用手工修订后的有效题干");
    assert.equal(String(questionSegment.text).startsWith("拉普拉斯反变换"), true, "手工修订优先");

    const beyond = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_M6,
      content: { field: "question", offset: 9999, limit: 10 },
    });
    const beyondSegment = (beyond.data as { contentSegment: Record<string, unknown> }).contentSegment;
    assert.equal(beyondSegment.available, true);
    assert.equal(beyondSegment.outOfRange, true);
    assert.equal(beyondSegment.text, "");
    assert.equal(beyondSegment.totalLength, Array.from("题干：求 f(x)=x^2 的导数。").length);
    assert.equal(beyondSegment.nextOffset, undefined);

    const outOfScope = await runAt(
      snapshotB,
      "getMistakeDetail",
      { recordId: F.DISCOVERY_RECORD_M5, content: { field: "answer" } },
      { notebookIds: [F.DISCOVERY_NOTEBOOK_N] },
    );
    assert.equal(outOfScope.ok, false);
    assert.equal(outOfScope.error?.code, "not_found");
  });

  test("分段参数校验与旧 includeText 截断回归", async () => {
    const guard = new PolicyGuard(app.registry, 8);
    for (const bad of [
      { recordId: F.DISCOVERY_RECORD_M5, content: { field: "transcript" } },
      { recordId: F.DISCOVERY_RECORD_M5, content: { field: "question", offset: -1 } },
      { recordId: F.DISCOVERY_RECORD_M5, content: { field: "question", limit: 4001 } },
      { recordId: F.DISCOVERY_RECORD_M5, content: { field: "question", extra: true } },
    ]) {
      assert.equal(guard.check({ id: "bad", name: "getMistakeDetail", arguments: bad }, ALL, 0).ok, false);
    }

    const legacy = await runAt(snapshotB, "getMistakeDetail", { recordId: F.DISCOVERY_RECORD_M5, includeText: true });
    const record = (legacy.data as { record: Record<string, unknown> }).record;
    assert.equal(String(record.questionText).length, 4000, "旧路径仍截断到 4000 字符");
    assert.equal(legacy.truncated, true);
    const withoutText = await runAt(snapshotB, "getMistakeDetail", { recordId: F.DISCOVERY_RECORD_M5 });
    assert.equal((withoutText.data as { record: Record<string, unknown> }).record.questionText, undefined);
    assert.ok((withoutText.data as { record: Record<string, unknown> }).record.questionTextOmitted !== undefined);
  });

  test("答案缺少可定位来源（notebookId + rootId）时不分段发送正文", async () => {
    const unlocatable = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_M7,
      content: { field: "answer" },
    });
    assert.equal(unlocatable.ok, true);
    const segment = (unlocatable.data as { contentSegment: Record<string, unknown> }).contentSegment;
    assert.equal(segment.available, false);
    assert.equal(segment.reason, "answer_source_unlocatable");
    assert.equal(segment.text, undefined, "不可定位来源时不返回正文");
    assert.equal(segment.source, undefined);
    assert.equal(JSON.stringify(unlocatable).includes("存在投影正文但无来源绑定"), false);

    // 旧的整条读取路径保持既有行为（兼容）。
    const legacy = await runAt(snapshotB, "getMistakeDetail", { recordId: F.DISCOVERY_RECORD_M7 });
    assert.equal(
      (legacy.data as { record: Record<string, unknown> }).record.answerText,
      "答案：存在投影正文但无来源绑定。",
    );

    // 可定位来源的答案照常返回片段与来源 ID。
    const locatable = await runAt(snapshotB, "getMistakeDetail", {
      recordId: F.DISCOVERY_RECORD_M5,
      content: { field: "answer" },
    });
    const answerSegment = (locatable.data as { contentSegment: Record<string, unknown> }).contentSegment;
    assert.equal(answerSegment.available, true);
    assert.deepEqual(answerSegment.source, {
      notebookId: "bookA0000000000000000000000000009",
      noteId: "answerRootM005",
    });
  });
});

describe("v2.13 §9.2: 紧凑游标与分页边界（验收回退修复）", () => {
  test("长中文标题/分类 + 长合法 ID：游标长度固定、经真实 Schema 回传并准确翻页", async () => {
    const first = await runAt(snapshotB, "queryMistakes", { contentQuery: F.DISCOVERY_NEEDLE, limit: 1 });
    const page1 = first.data as PageData;
    assert.equal(page1.records.length, 1);
    assert.equal(page1.records[0]!.recordId, F.DISCOVERY_RECORD_LONG, "长分类键排序在首位");
    const cursor = page1.nextCursor;
    assert.ok(cursor);
    assert.ok(cursor.length < 512, `游标必须 < 512：实际 ${cursor.length}`);

    // 游标只含指纹/锚点/校验值：不含分类或标题文本。
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["c", "f", "r", "v"]);
    assert.equal(payload.r, F.DISCOVERY_RECORD_LONG);
    assert.equal(cursor.includes(Buffer.from("超长中文标题", "utf8").toString("base64url")), false);

    // 经实际模型 Schema（PolicyGuard，cursor.maxLength=512）接受后继续翻页。
    const guard = new PolicyGuard(app.registry, 8);
    const check = guard.check(
      { id: "page2", name: "queryMistakes", arguments: { contentQuery: F.DISCOVERY_NEEDLE, limit: 1, cursor } },
      ALL,
      0,
    );
    assert.equal(check.ok, true, JSON.stringify(check));

    const second = await runAt(snapshotB, "queryMistakes", { contentQuery: F.DISCOVERY_NEEDLE, limit: 1, cursor });
    const page2 = second.data as PageData;
    assert.equal(page2.records[0]!.recordId, F.DISCOVERY_RECORD_T2);
    const third = await runAt(snapshotB, "queryMistakes", {
      contentQuery: F.DISCOVERY_NEEDLE, limit: 1, cursor: page2.nextCursor,
    });
    const page3 = third.data as PageData;
    assert.equal(page3.records[0]!.recordId, F.DISCOVERY_RECORD_T3);
    assert.equal(page3.nextCursor, undefined);
    const all = [page1, page2, page3].flatMap((page) => page.records.map((record) => String(record.recordId)));
    assert.equal(new Set(all).size, 3, "逐页无重复");
    assert.deepEqual(second.evidence.recordIds, [F.DISCOVERY_RECORD_T2]);
    assert.deepEqual(third.evidence.recordIds, [F.DISCOVERY_RECORD_T3]);
  });

  test("dueAtAsc / reviewCountDesc 的游标同样紧凑且可回传", async () => {
    const guard = new PolicyGuard(app.registry, 8);
    for (const orderBy of ["dueAtAsc", "reviewCountDesc"] as const) {
      const args = { contentQuery: F.DISCOVERY_NEEDLE, orderBy, limit: 1 };
      const first = await runAt(snapshotB, "queryMistakes", args);
      assert.equal(first.ok, true, JSON.stringify(first.error));
      const firstPage = first.data as PageData;
      const cursor = firstPage.nextCursor;
      assert.ok(cursor, `${orderBy} 应给出游标`);
      assert.ok(cursor.length < 512, `${orderBy} 游标长度 ${cursor.length}`);
      assert.equal(
        guard.check({ id: "p2", name: "queryMistakes", arguments: { ...args, cursor } }, ALL, 0).ok,
        true,
        `${orderBy} 游标应通过实际 Schema`,
      );
      const second = await runAt(snapshotB, "queryMistakes", { ...args, cursor });
      const secondPage = second.data as PageData;
      assert.equal(idsOf(first).some((id) => idsOf(second).includes(id)), false, `${orderBy} 后续页不重复`);
      assert.ok(idsOf(second).length > 0, `${orderBy} 后续页有内容`);
    }
    // reviewCountDesc 的锚点是最多可核实复习的记录。
    const ranked = await runAt(snapshotB, "queryMistakes", { contentQuery: F.DISCOVERY_NEEDLE, orderBy: "reviewCountDesc", limit: 1 });
    assert.equal(idsOf(ranked)[0], F.DISCOVERY_RECORD_LONG, "5 次可核实复习排第一");
    const nextRanked = await runAt(snapshotB, "queryMistakes", {
      contentQuery: F.DISCOVERY_NEEDLE, orderBy: "reviewCountDesc", limit: 1, cursor: (ranked.data as PageData).nextCursor,
    });
    assert.equal(idsOf(nextRanked)[0], F.DISCOVERY_RECORD_T2, "3 次可核实复习排第二");
  });

  test("recordIds 分页时 missingRecordIds 只列真正未匹配的 ID", async () => {
    const scope = { notebookIds: [F.DISCOVERY_NOTEBOOK_M, F.DISCOVERY_NOTEBOOK_N] };
    const bogus = "bookZ0000000000000000000000000001:noteZ999";
    const requested = [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N1, F.DISCOVERY_RECORD_O1, bogus];
    const expectedMissing = [F.DISCOVERY_RECORD_O1, bogus];

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const envelope = await runAt(snapshotB, "queryMistakes", { recordIds: requested, limit: 1, ...(cursor ? { cursor } : {}) }, scope);
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      const data = envelope.data as PageData;
      assert.equal(data.records.length, 1, `第 ${page + 1} 页只返回 1 条`);
      assert.deepEqual(data.missingRecordIds, expectedMissing, `第 ${page + 1} 页的 missingRecordIds 不随分页变化`);
      seen.push(String(data.records[0]!.recordId));
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen.sort(), [F.DISCOVERY_RECORD_M1, F.DISCOVERY_RECORD_M2, F.DISCOVERY_RECORD_N1].sort());
    assert.equal(new Set(seen).size, 3, "三页各一条且不重复");
  });
});

describe("v2.13 §9.2/§11.1: 分段正文不进入历史压缩摘要", () => {
  test("回答引用了题干分段时，摘要不写原文（保留完成状态与证据）", () => {
    const privateText = "题干第 7 步：计算∫f(x)dx，注意😀与🙂符号。";
    const summary = buildCompactionSummary([
      newUserMessage("读一下这道题的题干"),
      newAssistantMessage("", [{ id: "seg", name: "getMistakeDetail", arguments: { recordId: F.DISCOVERY_RECORD_M5, content: { field: "question", offset: 0, limit: 40 } } }]),
      newToolResult("seg", "ok", {
        ok: true,
        tool: "getMistakeDetail",
        data: { record: { recordId: F.DISCOVERY_RECORD_M5 }, contentSegment: { field: "question", text: privateText } },
        evidence: { recordIds: [F.DISCOVERY_RECORD_M5], snapshotId: "snap-seg", dataAsOf: "2026-11-16T00:00:00Z" },
      }),
      newAssistantMessage(`这段题干是：${privateText}`, []),
    ]);
    assert.equal(summary.includes(privateText), false, "分段原文不得进入摘要");
    assert.equal(summary.includes("注意😀与🙂符号"), false);
    assert.match(summary, /已答复/);
    assert.match(summary, /getMistakeDetail\(ok\)/);
    assert.equal(summary.includes(F.DISCOVERY_RECORD_M5), true, "证据 recordId 仍保留");
  });
});

