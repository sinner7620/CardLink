import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import {
  fetchProviderModels,
  MODEL_CATALOG_MAX_ENTRIES,
  type ModelCatalog,
} from "../../src/adapters/model/model-catalog.ts";
import type { ModelHttpRequest, ModelHttpTransport } from "../../src/adapters/model/transport.ts";

/**
 * v2.3 §5.1.6：在线模型目录。
 * 只验证「请求形态 + 响应解析 + 错误码」，不发起真实网络请求。
 */

function transportReturning(response: { status: number; json?: unknown }, capture?: ModelHttpRequest[]): ModelHttpTransport {
  return async (request) => {
    capture?.push(request);
    return response;
  };
}

describe("§5.1.6 模型目录", () => {
  test("GET {baseUrl}/models，带 Bearer 头，解析 data[].id 与 owned_by", async () => {
    const requests: ModelHttpRequest[] = [];
    const catalog = await fetchProviderModels(
      { baseUrl: "https://api.deepseek.com/", apiKey: "sk-test-key", provider: "p1" },
      {
        transport: transportReturning(
          { status: 200, json: { object: "list", data: [{ id: "deepseek-chat", owned_by: "deepseek" }, { id: "deepseek-reasoner" }] } },
          requests,
        ),
        now: new Date("2026-11-14T10:00:00.000Z"),
      },
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "https://api.deepseek.com/models");
    assert.equal(requests[0].headers.Authorization, "Bearer sk-test-key");
    assert.equal(requests[0].body, undefined);
    assert.deepEqual(catalog.models, [
      { id: "deepseek-chat", ownedBy: "deepseek" },
      { id: "deepseek-reasoner" },
    ]);
    assert.equal(catalog.fetchedAt, "2026-11-14T10:00:00.000Z");
    assert.equal(catalog.source, "network");
  });

  test("兼容 {models:[string]} 与裸数组，去重保序", async () => {
    const fromModels = await fetchProviderModels(
      { baseUrl: "https://example.com/v1", apiKey: "k" },
      { transport: transportReturning({ status: 200, json: { models: ["b", "a", "b"] } }) },
    );
    assert.deepEqual(fromModels.models.map((m) => m.id), ["b", "a"]);

    const fromArray = await fetchProviderModels(
      { baseUrl: "https://example.com/v1", apiKey: "k" },
      { transport: transportReturning({ status: 200, json: [{ id: "x" }, { name: "y" }, { id: "" }] }) },
    );
    assert.deepEqual(fromArray.models.map((m) => m.id), ["x", "y"]);
  });

  test("401/403 → credential_invalid；404 → models_unsupported；429 → rate_limited", async () => {
    const run = (status: number) =>
      fetchProviderModels({ baseUrl: "https://example.com/v1", apiKey: "k" }, { transport: transportReturning({ status }) });

    await assert.rejects(() => run(401), /credential_invalid/);
    await assert.rejects(() => run(403), /credential_invalid/);
    await assert.rejects(() => run(404), /models_unsupported/);
    await assert.rejects(() => run(429), /rate_limited/);
    await assert.rejects(() => run(500), /model_catalog_failed/);
  });

  test("非 https、空密钥、无法识别的响应、空列表都 fail-closed", async () => {
    await assert.rejects(
      () => fetchProviderModels({ baseUrl: "http://api.example.com", apiKey: "k" }),
      /provider_base_url_not_https/,
    );
    await assert.rejects(
      () => fetchProviderModels({ baseUrl: "https://api.example.com", apiKey: "  " }),
      /credential_missing/,
    );
    await assert.rejects(
      () => fetchProviderModels({ baseUrl: "https://api.example.com", apiKey: "k" }, { transport: transportReturning({ status: 200, json: { object: "list" } }) }),
      /models_unsupported/,
    );
    await assert.rejects(
      () => fetchProviderModels({ baseUrl: "https://api.example.com", apiKey: "k" }, { transport: transportReturning({ status: 200, json: { data: [] } }) }),
      /models_unsupported/,
    );
  });

  test("条数上限被截断", async () => {
    const many = Array.from({ length: MODEL_CATALOG_MAX_ENTRIES + 40 }, (_, i) => ({ id: `m-${i}` }));
    const catalog: ModelCatalog = await fetchProviderModels(
      { baseUrl: "https://api.example.com", apiKey: "k" },
      { transport: transportReturning({ status: 200, json: { data: many } }) },
    );
    assert.equal(catalog.models.length, MODEL_CATALOG_MAX_ENTRIES);
  });
});
