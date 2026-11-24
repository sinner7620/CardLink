import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import * as http from "node:http";

import { OpenAiCompatibleModelClient } from "../../src/adapters/model/provider-client.ts";
import { fetchTransport } from "../../src/adapters/model/transport.ts";
import { assistantMessageOutputSchema } from "../../src/domain/assistant-output.ts";
import { decisionOutputSchema, type Decision } from "../../src/domain/decision.ts";
import type { AssistantMessage } from "../../src/domain/message.ts";
import { newAssistantMessage, newToolResult, newUserMessage } from "../../src/domain/message.ts";
import type { Context } from "../../src/domain/context.ts";
import type { ModelSetting } from "../../src/domain/model-setting.ts";

const SETTING: ModelSetting = { provider: "openai-compatible", model: "stub-model", effort: "medium", timeoutMs: 1500, maxOutputTokens: 512 };

let server: http.Server;
let baseUrl = "";
const seenBodies: Array<Record<string, unknown>> = [];

/** 本地 stub OpenAI 服务器（协议级测试，T16：真实适配器接入而应用层不变）。 */
before(async () => {
  let assistantTurns = 0;
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      seenBodies.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (Array.isArray(body.tools) && (body.tools as unknown[]).length > 0) {
        // Assistant 调用：第一轮返回 tool_calls，第二轮返回最终文本
        const turn = assistantTurns++;
        if (turn === 0) {
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: "查统计",
                tool_calls: [{ id: "stub-1", type: "function", function: { name: "getMistakeStats", arguments: '{"level":0}' } }],
              },
            }],
          }));
        } else {
          res.end(JSON.stringify({ choices: [{ message: { content: "统计完成", tool_calls: [] } }] }));
        }
        return;
      }
      // Reviewer 调用：返回 JSON 决策
      res.end(JSON.stringify({ choices: [{ message: { content: '{"approved": true, "reason": "ok"}' } }] }));
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});

after(() => server.close());

function assistantContext(): Context<AssistantMessage> {
  return {
    instruction: "测试指令",
    tools: [{
      name: "getMistakeStats", description: "统计", parameters: { type: "object", properties: {}, additionalProperties: false },
      resultSchema: {}, permission: "mistakes:read",
    }],
    messages: [{ type: "user", id: "m1", text: "查询", createdAt: new Date().toISOString() }],
    outputType: assistantMessageOutputSchema(),
  };
}

describe("P3: OpenAI 兼容适配器（协议级，T16 配套）", () => {
  test("历史重放在服务商协议上分别配对，悬空结果不会跨轮误配", async () => {
    const call = { id: "same", name: "getMistakeStats", arguments: {} };
    const context = assistantContext();
    context.messages.push(
      newAssistantMessage("", [call]),
      newUserMessage("继续查询"),
      newAssistantMessage("", [call, call]),
      newToolResult(call.id, "ok", { cachedResult: { ok: true } }),
      newToolResult("orphan", "error", { error: true }),
    );
    const client = new OpenAiCompatibleModelClient({
      baseUrl, apiKey: "fixture", provider: "stub",
      transport: async ({ body }) => {
        const sent = JSON.parse(body!).messages.slice(2);
        assert.deepEqual(sent.map((message: { role: string }) => message.role), ["assistant", "tool", "user", "assistant", "tool"]);
        const first = sent[0].tool_calls[0].id;
        const second = sent[3].tool_calls[0].id;
        assert.notEqual(first, second);
        assert.equal(sent[3].tool_calls.length, 1);
        assert.equal(sent[1].tool_call_id, first);
        assert.equal(sent[4].tool_call_id, second);
        assert.deepEqual(JSON.parse(sent[1].content), { status: "interrupted" });
        assert.deepEqual(JSON.parse(sent[4].content), { cachedResult: { ok: true } });
        return { status: 200, json: { choices: [{ message: { content: "已结束" } }] } };
      },
    });
    assert.equal((await client.generate(context, SETTING)).text, "已结束");
  });

  test("有凭据的重定向不发第二跳，用户信号关闭在途 HTTP", { timeout: 4000 }, async () => {
    let redirectTargetHits = 0;
    let enteredSlow!: () => void;
    let closedSlow!: () => void;
    const entered = new Promise<void>((resolve) => { enteredSlow = resolve; });
    const closed = new Promise<void>((resolve) => { closedSlow = resolve; });
    const stub = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(307, { Location: "/target" }).end();
      } else if (req.url === "/target") {
        redirectTargetHits++;
        res.end("{}");
      } else {
        res.once("close", closedSlow);
        enteredSlow();
      }
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
    const request = { method: "GET" as const, headers: { Authorization: "Bearer fixture" }, timeoutMs: 10_000 };
    try {
      assert.equal((await fetchTransport({ ...request, url: `${origin}/redirect` })).status, 307);
      assert.equal(redirectTargetHits, 0);
      const controller = new AbortController();
      const result = fetchTransport({ ...request, url: `${origin}/slow`, signal: controller.signal });
      await entered;
      controller.abort();
      await assert.rejects(result, /model_cancelled/);
      await closed;
    } finally {
      stub.closeAllConnections();
      stub.close();
    }
  });

  test("工具调用响应映射为 AssistantMessage；effort 显式映射", async () => {
    const client = new OpenAiCompatibleModelClient({ baseUrl, apiKey: "stub-key", provider: "stub" });
    const message = await client.generate(assistantContext(), SETTING);
    assert.equal(message.type, "assistant");
    assert.equal(message.toolCalls.length, 1);
    assert.equal(message.toolCalls[0]?.name, "getMistakeStats");
    assert.deepEqual(message.toolCalls[0]?.arguments, { level: 0 });

    const assistantBody = seenBodies[0] as { reasoning_effort?: string; tools?: unknown[]; messages?: Array<{ role: string }> };
    assert.equal(assistantBody.reasoning_effort, "high", "medium → high 显式映射");
    assert.ok(Array.isArray(assistantBody.tools) && assistantBody.tools.length === 1);
    assert.equal(assistantBody.messages?.[0]?.role, "system");
  });

  test("Reviewer 上下文（无 tools）解析 JSON 决策", async () => {
    const client = new OpenAiCompatibleModelClient({ baseUrl, apiKey: "stub-key", provider: "stub" });
    const context: Context<Decision> = {
      instruction: "审核",
      tools: [],
      messages: [{ type: "user", id: "r1", text: "审核调用", createdAt: new Date().toISOString() }],
      outputType: decisionOutputSchema(),
    };
    const decision = await client.generate(context, SETTING);
    assert.deepEqual(decision, { approved: true, reason: "ok" });
    const reviewerBody = seenBodies[1] as { tools?: unknown[] };
    assert.equal(reviewerBody.tools === undefined, true, "Reviewer 不得暴露工具");
  });

  test("provider 错误显式抛出（不静默）", async () => {
    const failing = http.createServer((req, res) => {
      void req;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Insufficient balance" } }));
    });
    await new Promise<void>((r) => failing.listen(0, "127.0.0.1", () => r()));
    const port = (failing.address() as { port: number }).port;
    const client = new OpenAiCompatibleModelClient({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "stub-key", provider: "stub" });
    await assert.rejects(
      () => client.generate(assistantContext(), { ...SETTING, timeoutMs: 1500 }),
      (e: Error) => e.message.includes("provider_error(429)"),
    );
    failing.close();
  });

  test("超时显式报错（model_timeout）", async () => {
    const slow = http.createServer((req, res) => {
      void req;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      }, 800);
    });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", () => r()));
    const port = (slow.address() as { port: number }).port;
    const client = new OpenAiCompatibleModelClient({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "k", provider: "stub" });
    await assert.rejects(
      () => client.generate(assistantContext(), { ...SETTING, timeoutMs: 150 }),
      (e: Error) => e.message.includes("model_timeout"),
    );
    slow.close();
  });

  test("未配置 effort 映射目标 → unsupported_effort（§5）", async () => {
    const client = new OpenAiCompatibleModelClient({
      baseUrl, apiKey: "stub-key", provider: "stub",
      effortMap: { none: "low" }, includeReasoningEffort: true,
    });
    // max 未在自定义映射中 → 显式错误而非静默传参
    await assert.rejects(
      () => client.generate(assistantContext(), { ...SETTING, effort: "max" }),
      (e: Error) => e.message.includes("unsupported_effort"),
    );
  });
});
