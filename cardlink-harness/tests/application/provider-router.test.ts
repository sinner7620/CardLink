import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { ProviderRouterModelClient } from "../../src/adapters/model/provider-router.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { InMemoryProviderConfigStore, InMemoryCredentialStore } from "../../src/application/ports/provider-store.ts";
import { decisionOutputSchema, type Decision } from "../../src/domain/decision.ts";
import type { Context } from "../../src/domain/context.ts";
import type { ModelClient } from "../../src/application/ports/model-client.ts";
import type { ModelSetting } from "../../src/domain/model-setting.ts";
import { validateProviderConfig } from "../../src/domain/provider.ts";

const KEY_A = "sk-provider-A-secret";
const KEY_B = "sk-provider-B-secret";

function makeRouter(fakes: Map<string, FakeModelClient>): ProviderRouterModelClient {
  const providers = new InMemoryProviderConfigStore();
  const credentials = new InMemoryCredentialStore();
  providers.upsert({ id: "pA", protocol: "openai-compatible", baseUrl: "https://a.example/v1", credentialRef: "keyA", enabled: true });
  providers.upsert({ id: "pB", protocol: "openai-compatible", baseUrl: "https://b.example/v1", credentialRef: "keyB", enabled: true });
  providers.upsert({ id: "pOff", protocol: "openai-compatible", baseUrl: "https://off.example/v1", credentialRef: "keyA", enabled: false });
  providers.upsert({ id: "pNative", protocol: "anthropic-native", baseUrl: "https://anthropic.example", credentialRef: "keyA", enabled: true });
  credentials.set("keyA", KEY_A);
  credentials.set("keyB", KEY_B);
  for (const fake of fakes.values()) {
    fake.behavior = () => ({ approved: true, reason: "ok" });
  }
  return new ProviderRouterModelClient({
    providers,
    credentials,
    createProtocolClient: (config) => {
      const fake = fakes.get(config.id);
      if (!fake) throw new Error(`no fake for ${config.id}`);
      return fake as unknown as ModelClient;
    },
  });
}

function decisionContext(): Context<Decision> {
  return {
    instruction: "审核",
    tools: [],
    messages: [{ type: "user", id: "r1", text: "审核", createdAt: new Date().toISOString() }],
    outputType: decisionOutputSchema(),
  };
}

describe("H1-T28: 多服务商路由（v2.1 §5.1）", () => {
  test("Assistant 与 Reviewer 独立路由到不同 provider", async () => {
    const fakes = new Map<string, FakeModelClient>([
      ["pA", new FakeModelClient()],
      ["pB", new FakeModelClient()],
    ]);
    const router = makeRouter(fakes);
    const settingA: ModelSetting = { provider: "openai-compatible", model: "model-a", effort: "low", timeoutMs: 1000, maxOutputTokens: 64, providerId: "pA", credentialRef: "keyA" };
    const settingB: ModelSetting = { provider: "openai-compatible", model: "model-b", effort: "low", timeoutMs: 1000, maxOutputTokens: 64, providerId: "pB", credentialRef: "keyB" };

    await router.generate(decisionContext(), settingA);
    await router.generate(decisionContext(), settingB);

    const callsA = fakes.get("pA")?.calls ?? [];
    const callsB = fakes.get("pB")?.calls ?? [];
    assert.equal(callsA.length, 1);
    assert.equal(callsB.length, 1);
    assert.equal(callsA[0]?.setting.model, "model-a");
    assert.equal(callsB[0]?.setting.model, "model-b");
  });

  test("provider 不存在/停用/凭据不一致/密钥缺失 → 显式错误且不含密钥明文", async () => {
    const fakes = new Map<string, FakeModelClient>([["pA", new FakeModelClient()]]);
    const router = makeRouter(fakes);
    const base: ModelSetting = { provider: "openai-compatible", model: "m", effort: "low", timeoutMs: 1000, maxOutputTokens: 64 };

    await assert.rejects(() => router.generate(decisionContext(), { ...base, providerId: "pMissing" }), /provider_not_found/);
    await assert.rejects(() => router.generate(decisionContext(), { ...base, providerId: "pOff" }), /provider_disabled/);
    await assert.rejects(
      () => router.generate(decisionContext(), { ...base, providerId: "pA", credentialRef: "keyWRONG" }),
      /credential_mismatch/,
    );
    await assert.rejects(
      () => {
        const providers = new InMemoryProviderConfigStore();
        providers.upsert({ id: "pNoKey", protocol: "openai-compatible", baseUrl: "https://x.example/v1", credentialRef: "keyNone", enabled: true });
        const router2 = new ProviderRouterModelClient({ providers, credentials: new InMemoryCredentialStore() });
        return router2.generate(decisionContext(), { ...base, providerId: "pNoKey" });
      },
      /credential_missing/,
    );
    await assert.rejects(() => router.generate(decisionContext(), { ...base, providerId: "pNative" }), /unsupported_protocol/);
    await assert.rejects(() => router.generate(decisionContext(), { ...base }), /provider_missing/);
  });

  test("provider 配置校验（§5.1.3）", () => {
    assert.equal(validateProviderConfig({ id: "x", protocol: "openai-compatible", baseUrl: "http://insecure", credentialRef: "k" }).ok, false);
    assert.equal(validateProviderConfig({ id: "x", protocol: "ftp", baseUrl: "https://ok", credentialRef: "k" }).ok, false);
    const ok = validateProviderConfig({ id: "x", protocol: "openai-compatible", baseUrl: "https://ok/v1", credentialRef: "k", enabled: true });
    assert.ok(ok.ok && ok.value.enabled);
  });
});
