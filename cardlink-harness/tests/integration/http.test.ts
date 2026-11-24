import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import * as http from "node:http";

import { makeApp } from "../helpers/harness.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp, type HarnessApp } from "../../src/bootstrap.ts";
import { loadConfig } from "../../src/config.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { createHttpServer } from "../../src/adapters/http/routes.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

let app: HarnessApp;
let server: http.Server;
let baseUrl = "";
const TOKEN = "test-token-123";
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

function assistantOutput(text: string, toolCalls: Array<{ id: string; name: string; arguments?: unknown }>): unknown {
  return { text, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments ?? {} })) };
}

before(async () => {
  const model = new FakeModelClient();
  model.behavior = (ctx) => {
    if (ctx.outputType.name === "assistant_message") {
      const hasToolResult = ctx.messages.some((m) => m.type === "tool_result");
      return hasToolResult
        ? { text: "统计结果：共 100 道错题。", toolCalls: [] }
        : { text: "查统计", toolCalls: [{ id: "http-call-1", name: "getMistakeStats", arguments: {} }] };
    }
    return { approved: true, reason: "ok" };
  };
  const config = loadConfig({
    H1_MODEL_BASE_URL: "http://127.0.0.1:1/v1",
    H1_MODEL_API_KEY: "test-key",
    H1_MODEL_NAME: "test-model",
    H1_HTTP_TOKEN: TOKEN,
    H1_CORS_ORIGIN: "http://127.0.0.1:7310",
    H1_DB_PATH: ":memory:",
  });
  app = createHarnessApp(config, { driver: openDatabase(config.storage.database), model });
  server = createHttpServer(app);
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

async function post(path: string, body: unknown, headers: Record<string, string> = HEADERS): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

async function get(path: string, headers: Record<string, string> = HEADERS): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, json: await res.json() };
}

describe("P4: HTTP API（§13）", () => {
  test("会话游标可逐页遍历，末页没有游标", async () => {
    const ids = [];
    for (let n = 0; n < 3; ++n) {
      const created = await post("/h1/sessions", { scope: { notebookIds: [] } });
      ids.push((created.json as { sessionId: string }).sessionId);
    }
    const readPage = async (cursor?: string) => {
      const { json } = await get(`/h1/sessions?${new URLSearchParams({ limit: "2", ...(cursor ? { cursor } : {}) })}`);
      return json as { sessions: Array<{ id: string }>; nextCursor?: string };
    };
    const first = await readPage();
    assert.ok(first.nextCursor);
    const second = await readPage(first.nextCursor);
    assert.equal(second.nextCursor, undefined);
    assert.deepEqual(
      [...first.sessions, ...second.sessions].map((session) => session.id).sort(),
      ids.sort(),
    );
  });

  test("健康检查无需令牌", async () => {
    const { status, json } = await get("/h1/health", {});
    assert.equal(status, 200);
    assert.equal((json as { ok: boolean }).ok, true);
  });

  test("无令牌/错令牌 → 401", async () => {
    const { status } = await get("/h1/sessions", {});
    assert.equal(status, 401);
    const bad = await get("/h1/sessions", { Authorization: "Bearer wrong" });
    assert.equal(bad.status, 401);
  });

  test("非允许 Origin 被拒", async () => {
    const { status } = await post("/h1/sessions", { scope: { notebookIds: [] } }, { ...HEADERS, Origin: "http://evil.example" });
    assert.equal(status, 403);
  });

  test("快照导入 + 会话创建 + 消息发送 + requestId 重放（T12）", async () => {
    const imported = await post("/h1/import/cardlink-snapshot", {
      schemaVersion: 1, sourceId: "http-fixture", exportedAt: "2026-11-12T08:00:00+08:00",
      isFullSnapshot: true, records: snapshot1(),
    });
    assert.equal(imported.status, 200);
    assert.equal((imported.json as { inserted: number }).inserted, 100);

    const created = await post("/h1/sessions", { scope: { notebookIds: [] } });
    assert.equal(created.status, 200);
    const sessionId = (created.json as { sessionId: string }).sessionId;

    const send1 = await post(`/h1/sessions/${sessionId}/messages`, { requestId: "r1", text: "统计如何？" });
    assert.equal(send1.status, 200);
    const result1 = send1.json as { status: string; message?: string };
    assert.equal(result1.status, "completed");
    assert.ok(result1.message?.includes("100"));

    const send2 = await post(`/h1/sessions/${sessionId}/messages`, { requestId: "r1", text: "统计如何？" });
    assert.deepEqual(send2.json, send1.json, "同 requestId 返回缓存结果");

    const detail = await get(`/h1/sessions/${sessionId}`);
    assert.equal((detail.json as { messages: unknown[] }).messages.length, 4);
  });

  test("非法会话/未知端点 → 404；非法消息 → error", async () => {
    const miss = await get("/h1/sessions/nope");
    assert.equal(miss.status, 404);
    const bad = await post(`/h1/sessions/nope/messages`, { requestId: "r", text: "x" });
    assert.equal(bad.status, 200);
    assert.equal((bad.json as { status: string }).status, "error");
    const unknown = await get("/h1/unknown");
    assert.equal(unknown.status, 404);
  });

  test("导入非法载荷 → 422 + 诊断", async () => {
    const { status, json } = await post("/h1/import/cardlink-snapshot", { schemaVersion: 9 });
    assert.equal(status, 422);
    assert.equal((json as { error: { code: string } }).error.code, "snapshot_invalid");
  });
});
