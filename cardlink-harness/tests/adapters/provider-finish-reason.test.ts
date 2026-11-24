import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { OpenAiCompatibleModelClient } from "../../src/adapters/model/provider-client.ts";
import { assistantMessageOutputSchema } from "../../src/domain/assistant-output.ts";
import { decisionOutputSchema } from "../../src/domain/decision.ts";
import type { AssistantMessage } from "../../src/domain/message.ts";
import type { Decision } from "../../src/domain/decision.ts";
import type { ModelHttpResponse, ModelHttpTransport } from "../../src/adapters/model/transport.ts";
import type { Context } from "../../src/domain/context.ts";
import type { ModelSetting } from "../../src/domain/model-setting.ts";

const SETTING: ModelSetting = { provider: "test", model: "m", effort: "low", timeoutMs: 1000, maxOutputTokens: 256, providerId: "p", credentialRef: "c" };

function transportWith(payload: unknown): { transport: ModelHttpTransport; requests: unknown[] } {
  const requests: unknown[] = [];
  const transport: ModelHttpTransport = async (request) => {
    requests.push(request);
    return { status: 200, json: payload } as ModelHttpResponse;
  };
  return { transport, requests };
}

function assistantContext(): Context<AssistantMessage> {
  return {
    instruction: "测试",
    tools: [],
    messages: [{ type: "user", id: "u1", text: "hi", createdAt: new Date().toISOString() }],
    outputType: assistantMessageOutputSchema(),
  };
}

function decisionContext(): Context<Decision> {
  return {
    instruction: "测试",
    tools: [],
    messages: [{ type: "user", id: "u1", text: "hi", createdAt: new Date().toISOString() }],
    outputType: decisionOutputSchema(),
  };
}

function chatPayload(finishReason: string, content: string, usage?: unknown): unknown {
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
    ...(usage !== undefined ? { usage } : {}),
  };
}

describe("P0（v2.4 §5）：provider finish_reason 解析（generateDetailed）", () => {
  test("P1: finish_reason=length → output_limit + usage 透传", async () => {
    const { transport } = transportWith(chatPayload("length", "部分输出", { prompt_tokens: 120, completion_tokens: 256 }));
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const reply = await client.generateDetailed(assistantContext(), SETTING);
    assert.equal(reply.finishReason, "output_limit");
    assert.deepEqual(reply.usage, { promptTokens: 120, completionTokens: 256 });
    assert.equal(reply.value.text, "部分输出");
  });

  test("P2: finish_reason=stop → completed", async () => {
    const { transport } = transportWith(chatPayload("stop", "完成"));
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const reply = await client.generateDetailed(assistantContext(), SETTING);
    assert.equal(reply.finishReason, "completed");
  });

  test("P3: finish_reason=tool_calls → 消息级 completed（循环层处理）", async () => {
    const payload = {
      choices: [{
        message: { role: "assistant", content: null, tool_calls: [{ id: "tc1", type: "function", function: { name: "queryMistakes", arguments: "{}" } }] },
        finish_reason: "tool_calls",
      }],
    };
    const { transport } = transportWith(payload);
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const reply = await client.generateDetailed(assistantContext(), SETTING);
    assert.equal(reply.finishReason, "completed");
    assert.equal(reply.value.toolCalls.length, 1);
  });

  test("P4: finish_reason=content_filter → provider_error", async () => {
    const { transport } = transportWith(chatPayload("content_filter", ""));
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const reply = await client.generateDetailed(assistantContext(), SETTING);
    assert.equal(reply.finishReason, "provider_error");
  });

  test("P5: 未知 finish_reason → completed（不伪造）", async () => {
    const { transport } = transportWith(chatPayload("some_new_reason", "x"));
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const reply = await client.generateDetailed(assistantContext(), SETTING);
    assert.equal(reply.finishReason, "completed");
  });

  test("P6: 旧 generate() 契约不变（返回解析值）", async () => {
    const { transport } = transportWith(chatPayload("stop", "照常"));
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const value = await client.generate(assistantContext(), SETTING);
    assert.equal((value as { text: string }).text, "照常");
  });

  test("P7: Decision 上下文同样返回 finishReason（reviewer 忽略）", async () => {
    const { transport } = transportWith(chatPayload("stop", "{\"approved\":true,\"reason\":\"ok\"}"));
    const client = new OpenAiCompatibleModelClient({ baseUrl: "https://api.test/v1", apiKey: "k", provider: "t", transport });
    const reply = await client.generateDetailed(decisionContext(), SETTING);
    assert.equal(reply.finishReason, "completed");
    assert.equal((reply.value as { approved: boolean }).approved, true);
  });
});
