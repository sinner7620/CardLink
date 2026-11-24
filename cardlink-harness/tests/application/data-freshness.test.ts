import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { judgeFreshness } from "../../src/application/data-freshness.ts";
import { createBridgeHandler } from "../../src/adapters/bridge/commands.ts";
import { loadConfig } from "../../src/config.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

/**
 * v2.16 §6.3 / H1-T45：本地源新鲜度判定与基线持久化。
 * - current 需要「指纹一致 + 基线快照就是最新快照」两个条件；
 * - 无基线/无法计算指纹 → unknown；
 * - 同步失败不改基线；并发导入使基线落后 → stale；
 * - 基线跨进程（重启）从 SQLite 读取，旧 Run 仍锁定原快照。
 */

let dir: string;
let dbPath: string;
let app: HarnessApp;

function configFor(path: string) {
  return loadConfig({
    H1_MODEL_BASE_URL: "http://127.0.0.1:1/v1",
    H1_MODEL_API_KEY: "unused",
    H1_MODEL_NAME: "test-model",
    H1_HTTP_TOKEN: "t",
    H1_DB_PATH: path,
  });
}

before(() => {
  // 工作树内的临时目录（本机沙箱禁止在系统 Temp 下创建目录）。
  dir = join(process.cwd(), "tmp", `freshness-${Date.now().toString(36)}`);
  mkdirSync(dir, { recursive: true });
  dbPath = join(dir, "h1.sqlite");
  app = createHarnessApp(configFor(dbPath), { driver: openDatabase(dbPath) });
});

after(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 文件句柄未释放时跳过清理 */ }
});

describe("v2.16 §6.3 / H1-T45：新鲜度判定（纯函数）", () => {
  const baseline = { fingerprint: "fp-A", snapshotId: "snap-A", updatedAt: "2026-11-16T00:00:00.000Z" };

  test("current 需要指纹与快照同时一致；指纹/快照任一不同即 stale", () => {
    assert.equal(judgeFreshness({ baseline, currentFingerprint: "fp-A", latestSnapshotId: "snap-A" }).status, "current");
    assert.deepEqual(
      judgeFreshness({ baseline, currentFingerprint: "fp-B", latestSnapshotId: "snap-A" }),
      { status: "stale", reason: "fingerprint_mismatch: 本地错题/OCR/答案绑定已变化" },
    );
    assert.deepEqual(
      judgeFreshness({ baseline, currentFingerprint: "fp-A", latestSnapshotId: "snap-B" }),
      { status: "stale", reason: "snapshot_advanced: 最新快照不是基线记录的那一版" },
    );
  });

  test("旧安装无基线/运行时无法计算指纹 → unknown，不谎称 current", () => {
    assert.equal(judgeFreshness({ baseline: null, currentFingerprint: "fp-A", latestSnapshotId: "snap-A" }).status, "unknown");
    assert.equal(judgeFreshness({ baseline, latestSnapshotId: "snap-A" }).status, "unknown");
  });
});

describe("v2.16 §6.3 / H1-T45：基线持久化与同步失败", () => {
  test("成功导入后才写基线；同步失败不更新基线；重启后一致", async () => {
    const first = await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "cardlink-plugin", exportedAt: "2026-11-16T08:00:00+08:00",
      isFullSnapshot: true, records: snapshot1(),
    });
    app.sourceBaseline.set("cardlink-plugin", "fp-A", first.snapshotId);
    assert.equal(app.sourceBaseline.get("cardlink-plugin")?.snapshotId, first.snapshotId);

    // 同步失败（校验拒绝）：base 不变。
    await assert.rejects(app.syncService.importSnapshot({ schemaVersion: 99 }));
    assert.deepEqual(app.sourceBaseline.get("cardlink-plugin"), {
      sourceId: "cardlink-plugin", fingerprint: "fp-A", snapshotId: first.snapshotId,
      updatedAt: app.sourceBaseline.get("cardlink-plugin")!.updatedAt,
    });

    // 本地数据变化 → stale；成功导入 B 并写基线 → current。
    assert.equal(judgeFreshness({
      baseline: app.sourceBaseline.get("cardlink-plugin"),
      currentFingerprint: "fp-B",
      latestSnapshotId: first.snapshotId,
    }).status, "stale");
    const second = await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "cardlink-plugin", exportedAt: "2026-11-17T08:00:00+08:00",
      isFullSnapshot: true, records: snapshot1().map((record) => ({ ...record, level: 2 })),
    });
    assert.notEqual(second.snapshotId, first.snapshotId);
    app.sourceBaseline.set("cardlink-plugin", "fp-B", second.snapshotId);
    assert.equal(judgeFreshness({
      baseline: app.sourceBaseline.get("cardlink-plugin"),
      currentFingerprint: "fp-B",
      latestSnapshotId: second.snapshotId,
    }).status, "current");

    // 并发导入（另一处导入 C，但不属于本机源基线）→ snapshot_advanced → stale。
    const concurrent = await app.syncService.importSnapshot({
      schemaVersion: 1, sourceId: "other-export", exportedAt: "2026-11-17T09:00:00+08:00",
      isFullSnapshot: true, records: snapshot1(),
    });
    assert.equal(judgeFreshness({
      baseline: app.sourceBaseline.get("cardlink-plugin"),
      currentFingerprint: "fp-B",
      latestSnapshotId: concurrent.snapshotId,
    }).status, "stale");

    // 旧 Run 仍可读其锁定快照（A），最新视图是 C。
    const recordId = String(snapshot1()[0]!.recordId);
    const oldRecord = await app.repository.forSnapshot(first.snapshotId).getById(recordId, { notebookIds: [] });
    assert.equal(oldRecord?.snapshotId, first.snapshotId, "旧 Run/证据锁定原快照");

    // 重启：新连接读取同一 SQLite 文件的基线，判定一致。
    const restarted = createHarnessApp(configFor(dbPath), { driver: openDatabase(dbPath) });
    const restored = restarted.sourceBaseline.get("cardlink-plugin");
    assert.equal(restored?.fingerprint, "fp-B");
    assert.equal(restored?.snapshotId, second.snapshotId);
  });

  test("桥接只读回显：桌面运行时无法计算本地源指纹 → unknown，答案正文标记 not_tracked", async () => {
    const handler = createBridgeHandler({
      service: app.service,
      repository: app.repository,
      runStore: app.runStore,
      sourceBaseline: app.sourceBaseline,
    });
    const result = await handler("harness.getDataFreshness");
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { status: string; answerChanges: string; reason?: string; snapshotId: string; baselineSnapshotId?: string };
    assert.equal(data.status, "unknown");
    assert.equal(data.answerChanges, "not_tracked");
    assert.match(data.reason ?? "", /source_fingerprint_unavailable/);
    assert.equal(data.baselineSnapshotId, app.sourceBaseline.get("cardlink-plugin")?.snapshotId);
  });
});
