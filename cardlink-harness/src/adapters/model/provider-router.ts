import type { Context } from "../../domain/context.ts";
import type { ModelClient, ModelClientDetailed, ModelReply } from "../../application/ports/model-client.ts";
import { requestModel } from "../../application/ports/model-client.ts";
import type { ModelSetting } from "../../domain/model-setting.ts";
import type { ModelProviderConfig } from "../../domain/provider.ts";
import type { ModelCredentialStore, ProviderConfigStore } from "../../application/ports/provider-store.ts";
import { OpenAiCompatibleModelClient } from "./provider-client.ts";

export type RouterDeps = {
  providers: ProviderConfigStore;
  credentials: ModelCredentialStore;
  /** 协议客户端工厂（测试注入 Fake）；默认按 protocol 构造 OpenAI 兼容客户端。 */
  createProtocolClient?: (config: ModelProviderConfig, apiKey: string) => ModelClient;
};

export type RouterErrorCode =
  | "provider_missing"
  | "provider_not_found"
  | "provider_disabled"
  | "credential_mismatch"
  | "credential_missing"
  | "unsupported_protocol";

/**
 * v2.1 §5.1.2：ProviderRouterModelClient —— 按 setting.providerId 路由到协议适配器。
 * AgentService 不出现提供方名称或 URL 判断分支；密钥只在适配器内使用，不进错误信息。
 * v2.4 §5：实现可选 detailed 路由（协议客户端不支持 detailed 时按 completed 如实降级）。
 */
export class ProviderRouterModelClient implements ModelClient, ModelClientDetailed {
  constructor(private readonly deps: RouterDeps) {}

  private async route<T>(context: Context<T>, setting: ModelSetting): Promise<{ client: ModelClient; context: Context<T> }> {
    if (!setting.providerId) {
      throw new Error("provider_missing: ModelSetting.providerId 缺失（路由器要求）");
    }
    const config = this.deps.providers.get(setting.providerId);
    if (!config) throw new Error(`provider_not_found: ${setting.providerId}`);
    if (!config.enabled) throw new Error(`provider_disabled: ${setting.providerId}`);
    if (setting.credentialRef && setting.credentialRef !== config.credentialRef) {
      throw new Error(`credential_mismatch: 角色 credentialRef 与 Provider 配置不一致`);
    }
    const apiKey = this.deps.credentials.resolve(config.credentialRef);
    if (apiKey === undefined) {
      throw new Error(`credential_missing: ${config.credentialRef} 未配置密钥`);
    }
    // H1 首期仅实现 openai-compatible 协议适配器（§5.1.1）；协议检查先于任何工厂调用。
    if (config.protocol !== "openai-compatible") {
      throw new Error(`unsupported_protocol: ${config.protocol}（H1 首期仅 openai-compatible）`);
    }
    const client = this.deps.createProtocolClient
      ? this.deps.createProtocolClient(config, apiKey)
      : new OpenAiCompatibleModelClient({ baseUrl: config.baseUrl, apiKey, provider: config.id });
    return { client, context };
  }

  async generate<T>(context: Context<T>, setting: ModelSetting): Promise<T> {
    const { client, context: ctx } = await this.route(context, setting);
    return client.generate(ctx, setting);
  }

  async generateDetailed<T>(context: Context<T>, setting: ModelSetting): Promise<ModelReply<T>> {
    const { client, context: ctx } = await this.route(context, setting);
    return requestModel(client, ctx, setting, undefined, true);
  }

  async generateWithSignal<T>(context: Context<T>, setting: ModelSetting, signal: AbortSignal): Promise<ModelReply<T>> {
    const { client, context: ctx } = await this.route(context, setting);
    return requestModel(client, ctx, setting, signal, true);
  }
}
