export const EFFORTS = ["none", "minimal", "low", "medium", "high", "max"] as const;

export type Effort = (typeof EFFORTS)[number];

export type ModelSetting = {
  provider: string;
  model: string;
  effort: Effort;
  timeoutMs: number;
  maxOutputTokens: number;
  /** v2.1 §5.1：Provider 路由标识（ProviderRouterModelClient 必需；直连客户端忽略）。 */
  providerId?: string;
  /** v2.1 §5.1：密钥引用；必须与 Provider 配置的 credentialRef 一致，否则 credential_mismatch。 */
  credentialRef?: string;
  /** 可选抽象（§5.1.4.5）：厂商不支持时适配器按显式映射处理。 */
  temperature?: number;
};

export function isEffort(v: unknown): v is Effort {
  return typeof v === "string" && (EFFORTS as readonly string[]).includes(v);
}

export function assertModelSetting(s: ModelSetting): void {
  if (!s.provider?.trim()) throw new Error("ModelSetting.provider 缺失");
  if (!s.model?.trim()) throw new Error("ModelSetting.model 缺失");
  if (!isEffort(s.effort)) throw new Error(`ModelSetting.effort 非法: ${String(s.effort)}`);
  if (!Number.isFinite(s.timeoutMs) || s.timeoutMs <= 0) throw new Error("ModelSetting.timeoutMs 非法");
  if (!Number.isFinite(s.maxOutputTokens) || s.maxOutputTokens <= 0) throw new Error("ModelSetting.maxOutputTokens 非法");
}
