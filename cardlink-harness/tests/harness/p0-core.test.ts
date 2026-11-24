import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  compareStatsForRecords,
  probeCore,
  probeHttps,
  probeSqlite,
  startRunStateProbe,
  getRunStateProbe,
} from "../../src/harness/p0-core.ts";
import { NodeSqliteDriver } from "../../src/adapters/sqlite/driver.ts";
import type { MinimalSqlDriver } from "../../src/harness/p0-core.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { endOfLocalDay } from "../../src/application/statistics-engine.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

describe("H1-P0 探针核心（开发机协议级验证）", () => {
  test("P0.1 核心探针：Promise/async/JSON", async () => {
    const result = await probeCore();
    assert.equal(result.ok, true, JSON.stringify(result.steps));
    assert.ok(result.steps.every((s) => s.ok));
  });

  test("P0.2 SQLite 探针：事务回滚/UNIQUE/持久化（临时文件库）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h1-p0-"));
    const dbPath = path.join(dir, "p0.sqlite");
    const result = await probeSqlite((p) => openDatabase(p) as unknown as MinimalSqlDriver, dbPath);
    assert.equal(result.ok, true, JSON.stringify(result.steps));
    const names = result.steps.map((s) => s.name);
    assert.ok(names.includes("事务回滚不半写"));
    assert.ok(names.includes("UNIQUE 约束生效"));
    assert.ok(names.includes("持久化（关闭重开）"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("P0.2 SQLite 探针：写入失败路径如实记录（套件 ok=false）", async () => {
    // 打不开的路径 → 全套件失败但不抛出（真机上表现为可见的失败步骤）。
    const result = await probeSqlite(() => {
      throw new Error("模拟桥接失败");
    }, "unused");
    assert.equal(result.ok, false);
    assert.ok(result.steps.some((s) => !s.ok));
  });

  test("P0.3 HTTPS 探针：echo/超时（注入假 HTTP 通道）", async () => {
    const calls: Array<{ method: string; url: string; options?: { timeoutMs?: number } }> = [];
    const fakeHttp = async (method: string, url: string, options?: { timeoutMs?: number }) => {
      calls.push({ method, url, options });
      if (url.includes("/bearer/")) return { status: 200, json: { authenticated: true, token: "p0-probe" } };
      if (url.includes("/delay/")) throw new Error("请求超时（timeout）");
      return { status: 200 };
    };
    const result = await probeHttps(fakeHttp as never);
    assert.equal(result.ok, true, JSON.stringify(result.steps));
    assert.equal(calls.length, 3);
    assert.ok(calls[0]?.options?.timeoutMs === 20000);
    assert.equal(calls[2]?.options?.timeoutMs, 800);
  });

  test("P0.3 HTTPS 探针：端点失败 → 步骤失败、套件不通过", async () => {
    const fakeHttp = async (method: string, url: string) => {
      void method;
      if (url.includes("/bearer/")) throw new Error("网络不可达");
      return { status: 200 };
    };
    const result = await probeHttps(fakeHttp as never);
    assert.equal(result.ok, false);
  });

  test("P0.6 数据口径对照：Fixture 上 Harness 与插件口径并列输出", () => {
    // 排除时区口径特例记录（SPECIAL_INDEX），两种时区下 dueCount 均应稳定为 23。
    const records = snapshot1()
      .filter((r) => r.nextReviewAt !== "2026-11-13T01:00:00+08:00")
      .map((r) => ({ ...r }) as unknown as Array<Record<string, unknown>>[number]);
    const now = new Date("2026-11-12T22:00:00+08:00");
    const stats = compareStatsForRecords(records as Array<Record<string, unknown>>, now, endOfLocalDay);
    assert.equal(stats.total, 99);
    assert.equal(stats.harnessDue, 23);
    assert.equal(stats.pluginDue, 23, "两种口径在本机时区下应一致");
    assert.equal(stats.availableRecords, 96, '特例记录（来源可用）已排除，97-1=96');
    assert.equal(stats.reviewedHarness, 55);
    assert.equal(stats.currentLevelReviewCountSum, 90);
    assert.equal(stats.totalReviewActions, 90);
    assert.deepEqual(stats.levelCounts, { "0": 40, "1": 35, "2": 24, unknown: 0 });
  });

  test("P0.4 异步运行状态机：阶段推进至 finished", async () => {
    const { runId } = startRunStateProbe();
    let probe = getRunStateProbe(runId);
    const deadline = Date.now() + 4000;
    while (probe?.status !== "finished" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      probe = getRunStateProbe(runId);
    }
    assert.equal(probe?.status, "finished");
    assert.equal(probe?.phase, "finished");
    assert.ok((probe?.steps.length ?? 0) >= 5);
  });
});
