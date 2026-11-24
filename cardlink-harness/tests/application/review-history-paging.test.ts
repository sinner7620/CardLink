import { strict as assert } from "node:assert";
import { test, describe, before } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { PolicyGuard } from "../../src/application/policy-guard.ts";
import { encodeBase64Url, decodeBase64Url, utf8Decode } from "../../src/platform/base64url.ts";
import { utf8Bytes } from "../../src/platform/sha256.ts";
import { sha256Hex } from "../../src/platform/sha256.ts";
import type { HarnessApp } from "../../src/bootstrap.ts";
import type { VersionedSnapshotRecord } from "../../src/application/ports/versioned-mistake-repository.ts";
import type { ToolEnvelope } from "../../src/domain/evidence.ts";

/**
 * v2.13 §9.2：getReviewHistory 的 order/cursor/reviewFrom/reviewBefore。
 * 历史以原始偏移量字符串写入 v2 投影（不经导入器归一化），
 * 因此"按实际发生时间"与"按字符串字面顺序"的差异可被直接测出。
 */

const NOTEBOOK = "bookH0000000000000000000000000001";
const OTHER_NOTEBOOK = "bookK0000000000000000000000000001";
const RECORD_HEAVY = `${NOTEBOOK}:noteH001`;
const RECORD_SECOND = `${NOTEBOOK}:noteH002`;
const RECORD_EMPTY = `${NOTEBOOK}:noteH003`;
const RECORD_SCOPED = `${OTHER_NOTEBOOK}:noteK001`;

/** 130 条事件：mark + 混合偏移量的 3 条 + 同时间戳一对 + 批量补齐。 */
function heavyHistory(): Array<{ at: string; level: 0 | 1 | 2 | null }> {
  const events: Array<{ at: string; level: 0 | 1 | 2 | null }> = [
    { at: "2026-10-01T09:00:00+08:00", level: 0 }, // 0 mark
    { at: "2026-10-02T09:00:00+08:00", level: 0 }, // 1 = 2026-10-02T01:00Z
    { at: "2026-10-02T02:30:00Z", level: 1 }, // 2 = 02:30Z（字符串序会排到 1 之前）
    { at: "2026-10-02T10:00:00+05:30", level: 1 }, // 3 = 04:30Z
    { at: "2026-10-03T00:00:00Z", level: 2 }, // 4
    { at: "2026-10-03T00:00:00Z", level: 2 }, // 5 与 4 同一时间戳
  ];
  for (let index = 0; events.length < 130; index++) {
    events.push({ at: new Date(Date.UTC(2026, 9, 4) + index * 3_600_000).toISOString(), level: 2 });
  }
  return events;
}

function v2Record(
  recordId: string,
  notebookId: string,
  history: Array<{ at: string; level: 0 | 1 | 2 | null }>,
): VersionedSnapshotRecord {
  const noteId = recordId.slice(recordId.indexOf(":") + 1);
  return {
    recordId,
    sourceNotebookId: notebookId,
    sourceNoteId: noteId,
    sourceAvailable: true,
    level: 2,
    currentLevelReviewCount: Math.max(0, history.length - 1),
    reviewCompleted: false,
    favorite: false,
    categoryPath: ["复习历史"],
    manualCategories: [],
    customTags: [],
    reasonTags: [],
    errorReasons: [],
    sourceTitle: `历史记录 ${noteId}`,
    sourceNotebookTitle: "复习历史",
    sourcePathTitles: [],
    ocr: { origin: "none", status: "complete" },
    sourcePayload: { history },
    history,
    contentHash: "",
  };
}

async function importRecords(
  app: HarnessApp,
  sourceRevision: string,
  records: VersionedSnapshotRecord[],
): Promise<string> {
  const result = await app.repositoryV2.applySnapshot({
    manifest: {
      sourceId: "history-fixture",
      sourceRevision,
      importedAt: new Date().toISOString(),
      scope: { notebookIds: [] },
      complete: true,
    },
    records,
  });
  return result.snapshotId;
}

async function runHistory(app: HarnessApp, snapshotId: string, args: unknown, scope = { notebookIds: [] as string[] }): Promise<ToolEnvelope> {
  const tool = app.registry.get("getReviewHistory");
  assert.ok(tool);
  return (await tool.run(args, {
    sessionId: "history-session",
    scope,
    snapshotId,
    signal: new AbortController().signal,
  })) as ToolEnvelope;
}

type HistoryData = {
  events: Array<{ id: string; at: string; eventType: string }>;
  total: number;
  totalMatching: number;
  historyMissing: boolean;
  order: string;
  nextCursor?: string;
};

async function pageAll(
  app: HarnessApp,
  snapshotId: string,
  args: Record<string, unknown>,
  limit: number,
): Promise<HistoryData["events"]> {
  const events: HistoryData["events"] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const envelope = await runHistory(app, snapshotId, { ...args, limit, ...(cursor ? { cursor } : {}) });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    const data = envelope.data as HistoryData;
    events.push(...data.events);
    cursor = data.nextCursor;
    if (!cursor) return events;
  }
  throw new Error("历史分页未终止");
}

let app: HarnessApp;
let snapshotId: string;

before(async () => {
  app = makeApp();
  snapshotId = await importRecords(app, "r1", [
    v2Record(RECORD_HEAVY, NOTEBOOK, heavyHistory()),
    v2Record(RECORD_SECOND, NOTEBOOK, [
      { at: "2026-10-01T09:00:00+08:00", level: 0 },
      { at: "2026-10-04T09:00:00+08:00", level: 1 },
    ]),
    v2Record(RECORD_EMPTY, NOTEBOOK, []),
    v2Record(RECORD_SCOPED, OTHER_NOTEBOOK, [{ at: "2026-10-05T09:00:00+08:00", level: 0 }]),
  ]);
});

describe("v2.13 §9.2: getReviewHistory 排序、分页与时间过滤", () => {
  test("默认旧调用保持一致：升序、50 条、total/historyMissing 字段", async () => {
    const envelope = await runHistory(app, snapshotId, { recordId: RECORD_HEAVY });
    const data = envelope.data as HistoryData;
    assert.equal(data.events.length, 50);
    assert.equal(data.total, 130);
    assert.equal(data.totalMatching, 130);
    assert.equal(data.historyMissing, false);
    assert.equal(data.order, "asc");
    assert.equal(data.events[0]!.eventType, "mark");
    assert.equal(data.events.filter((event) => event.eventType === "mark").length, 1, "mark 仍区别于 review");
    assert.equal(envelope.truncated, true);
  });

  test(">100 条历史逐页完整、无重复，desc 正好是 asc 的逆序", async () => {
    const asc = await pageAll(app, snapshotId, { recordId: RECORD_HEAVY }, 37);
    const desc = await pageAll(app, snapshotId, { recordId: RECORD_HEAVY, order: "desc" }, 37);
    assert.equal(asc.length, 130);
    assert.equal(desc.length, 130);
    assert.equal(new Set(asc.map((event) => event.id)).size, 130, "逐页无重复");
    assert.deepEqual(desc.map((event) => event.id), asc.map((event) => event.id).reverse(), "desc 为 asc 逆序");
    const times = asc.map((event) => Date.parse(event.at));
    assert.deepEqual(times, [...times].sort((left, right) => left - right), "升序按实际发生时间");
    assert.equal(asc[0]!.eventType, "mark");
    assert.equal(desc[desc.length - 1]!.eventType, "mark", "desc 中入册标记在最后");
  });

  test("不同 offset 时区按实际时刻排序，同时间戳按事件序号稳定 tie-break", async () => {
    const asc = await pageAll(app, snapshotId, { recordId: RECORD_HEAVY }, 50);
    const ids = asc.map((event) => event.id);
    // 字符串字面顺序会是 :2,:1,:3；按实际时刻必须是 :1,:2,:3。
    assert.deepEqual(ids.slice(1, 4), [`${RECORD_HEAVY}:1`, `${RECORD_HEAVY}:2`, `${RECORD_HEAVY}:3`]);
    assert.deepEqual(ids.slice(4, 6), [`${RECORD_HEAVY}:4`, `${RECORD_HEAVY}:5`], "同一时间戳按序号升序");
    const desc = await pageAll(app, snapshotId, { recordId: RECORD_HEAVY, order: "desc" }, 50);
    const descIds = desc.map((event) => event.id);
    const ascPair = descIds.indexOf(`${RECORD_HEAVY}:5`);
    assert.equal(descIds[ascPair + 1], `${RECORD_HEAVY}:4`, "同一时间戳在 desc 中反序");
  });

  test("reviewFrom（含）/reviewBefore（不含）按发生时间过滤", async () => {
    const envelope = await runHistory(app, snapshotId, {
      recordId: RECORD_HEAVY,
      order: "asc",
      limit: 100,
      reviewFrom: "2026-10-02T02:00:00Z",
      reviewBefore: "2026-10-02T05:00:00Z",
    });
    const data = envelope.data as HistoryData;
    assert.equal(data.total, 130, "total 仍为该题全部历史条数");
    assert.equal(data.totalMatching, 2);
    assert.deepEqual(data.events.map((event) => event.id), [`${RECORD_HEAVY}:2`, `${RECORD_HEAVY}:3`]);
    await assert.rejects(
      runHistory(app, snapshotId, {
        recordId: RECORD_HEAVY,
        reviewFrom: "2026-10-02T05:00:00Z",
        reviewBefore: "2026-10-02T02:00:00Z",
      }),
      /开始时间必须早于结束时间/,
    );
  });

  test("游标绑定记录、排序、快照与时间过滤；篡改被拒绝", async () => {
    const first = await runHistory(app, snapshotId, { recordId: RECORD_HEAVY, order: "desc", limit: 10 });
    const cursor = (first.data as HistoryData).nextCursor;
    assert.ok(cursor);

    await assert.rejects(
      runHistory(app, snapshotId, { recordId: RECORD_SECOND, order: "desc", limit: 10, cursor }),
      /游标/,
    );
    await assert.rejects(
      runHistory(app, snapshotId, { recordId: RECORD_HEAVY, order: "asc", limit: 10, cursor }),
      /游标/,
    );
    await assert.rejects(
      runHistory(app, snapshotId, {
        recordId: RECORD_HEAVY, order: "desc", limit: 10, cursor, reviewFrom: "2026-10-02T00:00:00Z",
      }),
      /游标/,
    );
    // 篡改：改变位置键 → 校验和不符；改变过滤指纹 → 与当前请求不匹配。
    const tamper = (patch: (payload: Record<string, unknown>) => void): string => {
      const payload = JSON.parse(utf8Decode(decodeBase64Url(cursor!))) as Record<string, unknown>;
      patch(payload);
      return encodeBase64Url(utf8Bytes(JSON.stringify(payload)));
    };
    await assert.rejects(
      runHistory(app, snapshotId, {
        recordId: RECORD_HEAVY, order: "desc", limit: 10,
        cursor: tamper((payload) => {
          const key = payload.t as [number | null, number];
          key[1] = key[1] + 1;
        }),
      }),
      /游标/,
    );
    await assert.rejects(
      runHistory(app, snapshotId, {
        recordId: RECORD_HEAVY, order: "desc", limit: 10,
        cursor: tamper((payload) => { payload.k = "000000000000000000000000"; }),
      }),
      /游标/,
    );

    // 校验和正确但锚点不存在的游标同样被拒（锚点必须真实存在于同记录/同快照的历史中）。
    const realPayload = JSON.parse(utf8Decode(decodeBase64Url(cursor!))) as { k: string };
    const forgedAnchor = [null, 9999];
    const forged = encodeBase64Url(utf8Bytes(JSON.stringify({
      v: 2, k: realPayload.k, t: forgedAnchor, c: sha256Hex(JSON.stringify([2, realPayload.k, forgedAnchor])).slice(0, 16),
    })));
    await assert.rejects(
      runHistory(app, snapshotId, { recordId: RECORD_HEAVY, order: "desc", limit: 10, cursor: forged }),
      /锚点无效/,
    );

    // 换成新快照后旧游标同样失效（跨快照复用被拒）。
    const other = makeApp();
    const oldSnapshot = await importRecords(other, "s1", [v2Record(RECORD_HEAVY, NOTEBOOK, heavyHistory())]);
    const oldPage = await runHistory(other, oldSnapshot, { recordId: RECORD_HEAVY, order: "desc", limit: 10 });
    const oldCursor = (oldPage.data as HistoryData).nextCursor;
    assert.ok(oldCursor);
    const newSnapshot = await importRecords(other, "s2", [
      v2Record(RECORD_HEAVY, NOTEBOOK, [...heavyHistory(), { at: "2026-11-01T00:00:00Z", level: 2 }]),
    ]);
    assert.notEqual(newSnapshot, oldSnapshot);
    await assert.rejects(
      runHistory(other, newSnapshot, { recordId: RECORD_HEAVY, order: "desc", limit: 10, cursor: oldCursor }),
      /游标/,
    );
  });

  test("缺失历史、跨 scope 与非法 order 显式处理", async () => {
    const empty = await runHistory(app, snapshotId, { recordId: RECORD_EMPTY });
    const emptyData = empty.data as HistoryData;
    assert.equal(emptyData.total, 0);
    assert.equal(emptyData.historyMissing, true);

    const scoped = await runHistory(app, snapshotId, { recordId: RECORD_SCOPED }, { notebookIds: [NOTEBOOK] });
    assert.equal(scoped.ok, false);
    assert.equal(scoped.error?.code, "not_found");

    await assert.rejects(runHistory(app, snapshotId, { recordId: RECORD_HEAVY, order: "newest" }), /asc 或 desc/);
  });

  test("紧凑游标：长度为常数，最大合法 ID 也能真实回传并逐页准确", async () => {
    // §5 RecordId 形态的最长合法值：两段各 127 字符。
    const longNotebook = `bookL${"0".repeat(122)}`;
    const longNote = `noteL${"1".repeat(122)}`;
    const longId = `${longNotebook}:${longNote}`;
    const localApp = makeApp();
    const localSnapshot = await importRecords(localApp, "long-id", [v2Record(longId, longNotebook, heavyHistory())]);

    const first = await runHistory(localApp, localSnapshot, { recordId: longId, order: "desc", limit: 20 });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const firstData = first.data as HistoryData;
    const cursor = firstData.nextCursor;
    assert.ok(cursor);
    assert.ok(cursor.length < 128, `游标长度应为常数级（实际 ${cursor.length}）`);
    assert.equal(first.truncated, undefined, "新分页分支不置 truncated");

    // 游标只含绑定指纹/锚点/校验值，不含记录或快照 ID 明文。
    const payload = Buffer.from(cursor, "base64url").toString("utf8");
    assert.equal(payload.includes(longNotebook), false);
    assert.equal(payload.includes(localSnapshot), false);
    const guard = new PolicyGuard(localApp.registry, 8);
    assert.equal(
      guard.check({ id: "h2", name: "getReviewHistory", arguments: { recordId: longId, order: "desc", limit: 20, cursor } }, { notebookIds: [] }, 0).ok,
      true,
      "游标应通过实际 Schema",
    );

    const second = await runHistory(localApp, localSnapshot, { recordId: longId, order: "desc", limit: 20, cursor });
    const secondData = second.data as HistoryData;
    assert.equal(second.ok, true);
    assert.equal(secondData.events.length, 20);
    assert.equal(secondData.events[0]!.id, `${longId}:${129 - 20}`, "第二页从第 21 条（倒序）继续");

    const pages = await pageAll(localApp, localSnapshot, { recordId: longId, order: "desc" }, 20);
    assert.equal(pages.length, 130);
    assert.equal(new Set(pages.map((event) => event.id)).size, 130, "最大 ID 下逐页无重复");
    assert.equal(pages[129]!.eventType, "mark");
  });

  test("旧无参数调用保留 truncated 兼容标记，新参数分支只用 nextCursor", async () => {
    const legacy = await runHistory(app, snapshotId, { recordId: RECORD_HEAVY });
    assert.equal((legacy.data as HistoryData).events.length, 50);
    assert.equal(legacy.truncated, true, "旧调用：历史条数 > limit 时保持原标记");

    const desc = await runHistory(app, snapshotId, { recordId: RECORD_HEAVY, order: "desc" });
    assert.equal(desc.truncated, undefined, "新分支不置 truncated");
    assert.ok((desc.data as HistoryData).nextCursor, "分页由 nextCursor 表达");

    const ranged = await runHistory(app, snapshotId, { recordId: RECORD_HEAVY, reviewFrom: "2026-10-01T00:00:00Z" });
    assert.equal(ranged.truncated, undefined, "时间过滤分支同样不置 truncated");
  });
});
