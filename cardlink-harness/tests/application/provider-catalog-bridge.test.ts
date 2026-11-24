import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { makeApp } from "../helpers/harness.ts";
import { createBridgeHandler, InMemoryRoleConfigStore, type BridgeResult } from "../../src/adapters/bridge/commands.ts";
import { InMemoryCredentialStore, InMemoryProviderConfigStore } from "../../src/application/ports/provider-store.ts";
import type { ModelCatalog } from "../../src/adapters/model/model-catalog.ts";
import type { ModelProviderConfig } from "../../src/domain/provider.ts";

/**
 * v2.3 §5.1.6：`harness.listProviderModels` 桥命令。
 * WebView 只能给 providerId；URL/密钥/协议都由已保存配置决定，回包不含密钥。
 */

const KEY = "sk-catalog-test-key-9c1f";

function makeHandler(options: { catalog?: (config: ModelProviderConfig, apiKey: string) => Promise<ModelCatalog> } = {}) {
  const app = makeApp();
  const providers = new InMemoryProviderConfigStore();
  const credentials = new InMemoryCredentialStore();
  const handler = createBridgeHandler({
    service: app.service,
    repository: app.repository,
    providers,
    credentials,
    roles: new InMemoryRoleConfigStore(),
    modelCatalog: options.catalog,
  });
  return { handler, providers, credentials };
}

const enabledProvider: ModelProviderConfig = {
  id: "cardlink-device",
  protocol: "openai-compatible",
  baseUrl: "https://api.deepseek.com",
  credentialRef: "device-key",
  enabled: true,
};

describe("§5.1.6 harness.listProviderModels", () => {
  test("provider 不存在 / 未保存密钥 / 已停用 / 协议不支持", async () => {
    const { handler, providers, credentials } = makeHandler();

    const missing = await handler("harness.listProviderModels", { providerId: "nope" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error?.code, "provider_not_found");

    providers.upsert(enabledProvider);
    const noKey = await handler("harness.listProviderModels", { providerId: enabledProvider.id });
    assert.equal(noKey.ok, false);
    assert.equal(noKey.error?.code, "credential_missing");

    credentials.set("device-key", KEY);
    providers.upsert({ ...enabledProvider, enabled: false });
    const disabled = await handler("harness.listProviderModels", { providerId: enabledProvider.id });
    assert.equal(disabled.ok, false);
    assert.equal(disabled.error?.code, "provider_disabled");

    providers.upsert({ ...enabledProvider, protocol: "anthropic-native" as ModelProviderConfig["protocol"] });
    const unsupported = await handler("harness.listProviderModels", { providerId: enabledProvider.id });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.error?.code, "unsupported_protocol");
  });

  test("成功路径：只回模型目录与时间，不含密钥", async () => {
    let receivedConfig: ModelProviderConfig | undefined;
    let receivedKey: string | undefined;
    const { handler, providers, credentials } = makeHandler({
      catalog: async (config, apiKey) => {
        receivedConfig = config;
        receivedKey = apiKey;
        return {
          models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner", ownedBy: "deepseek" }],
          fetchedAt: "2026-11-14T18:00:00.000Z",
          source: "network",
        };
      },
    });
    providers.upsert(enabledProvider);
    credentials.set("device-key", KEY);

    const result: BridgeResult = await handler("harness.listProviderModels", { providerId: enabledProvider.id });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      providerId: enabledProvider.id,
      models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner", ownedBy: "deepseek" }],
      fetchedAt: "2026-11-14T18:00:00.000Z",
      source: "network",
    });
    assert.equal(receivedConfig?.baseUrl, "https://api.deepseek.com");
    assert.equal(receivedKey, KEY);
    assert.ok(!JSON.stringify(result).includes(KEY), "回包不得包含密钥明文");
  });

  test("目录抓取失败被包装为结构化错误，且不泄露密钥", async () => {
    const { handler, providers, credentials } = makeHandler({
      catalog: async () => {
        throw new Error("credential_invalid: 密钥被服务商拒绝（HTTP 401）");
      },
    });
    providers.upsert(enabledProvider);
    credentials.set("device-key", KEY);

    const result = await handler("harness.listProviderModels", { providerId: enabledProvider.id });
    assert.equal(result.ok, false);
    assert.match(result.error?.message ?? "", /credential_invalid/);
    assert.ok(!JSON.stringify(result).includes(KEY), "错误回包不得包含密钥明文");
  });

  test("providerId 缺失按未知 provider 处理（不猜测默认值）", async () => {
    const { handler, providers, credentials } = makeHandler();
    providers.upsert(enabledProvider);
    credentials.set("device-key", KEY);
    const result = await handler("harness.listProviderModels", {});
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "provider_not_found");
  });
});
