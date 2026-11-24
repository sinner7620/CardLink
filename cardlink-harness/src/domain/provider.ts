import type { Effort } from "./model-setting.ts";

/** v2.1 §5.1：ProviderId 是配置标识，不等于模型厂商名称。 */
export type ProviderId = string;

export type ProviderProtocol = "openai-compatible" | "anthropic-native" | "gemini-native";

export type ModelProviderConfig = {
  id: ProviderId;
  protocol: ProviderProtocol;
  /** 精确 HTTPS 地址，经用户确认和安全校验；不得自动拼接任意 URL。 */
  baseUrl: string;
  /** 密钥引用（不是密钥明文）。 */
  credentialRef: string;
  enabled: boolean;
};

export type RoleName = "assistant" | "reviewer";

export type ModelRoleSetting = {
  providerId: ProviderId;
  model: string;
  credentialRef: string;
  /** 可选抽象；厂商不支持时由适配器按显式可测的能力映射处理（§5.1.4.5）。 */
  effort?: Effort;
  /** 仅审核角色使用，表示启用时跟随默认助手。 */
  followsAssistant?: boolean;
  temperature?: number;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type ModelRoleConfig = {
  assistant: ModelRoleSetting;
  reviewer: ModelRoleSetting;
};

export function validateProviderConfig(config: unknown): { ok: true; value: ModelProviderConfig } | { ok: false; reason: string } {
  const c = config as Partial<ModelProviderConfig> | null;
  if (!c || typeof c !== "object") return { ok: false, reason: "Provider 配置必须是对象" };
  if (typeof c.id !== "string" || !c.id.trim()) return { ok: false, reason: "provider.id 缺失" };
  if (c.protocol !== "openai-compatible" && c.protocol !== "anthropic-native" && c.protocol !== "gemini-native") {
    return { ok: false, reason: `provider.protocol 非法: ${String(c.protocol)}` };
  }
  if (typeof c.baseUrl !== "string" || !/^https:\/\//.test(c.baseUrl)) {
    return { ok: false, reason: "provider.baseUrl 必须是 https:// 地址" };
  }
  if (typeof c.credentialRef !== "string" || !c.credentialRef.trim()) return { ok: false, reason: "provider.credentialRef 缺失" };
  return {
    ok: true,
    value: { id: c.id.trim(), protocol: c.protocol, baseUrl: c.baseUrl, credentialRef: c.credentialRef, enabled: c.enabled !== false },
  };
}

/** Official DeepSeek Chat Completions capability, never inferred for custom gateways. */
export function supportedReasoningEfforts(config: ModelProviderConfig | undefined, model: string): readonly Effort[] {
  if (!config || config.protocol !== "openai-compatible" || !/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl)) return [];
  return ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash"].includes(model) ? ["low", "high", "max"] : [];
}
