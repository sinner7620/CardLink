import type { ModelCapabilities } from "../../domain/model-capabilities.ts";

/** v2.5 §5.2：模型能力持久化（用户覆盖 + 估算校准）。 */
export type ModelCapabilitiesRow = ModelCapabilities & {
  /** 实际 prompt_tokens / 估算输入 token 的指数移动平均，限幅 0.5–2.0。 */
  calibrationRatio?: number;
};

export interface ModelCapabilitiesStore {
  get(providerId: string, modelId: string): ModelCapabilitiesRow | null;
  list(): ModelCapabilitiesRow[];
  upsert(capabilities: ModelCapabilities): void;
  /** 校准系数写入；无能力行时以保守默认创建一行（source='default'），不冒充用户配置。 */
  setCalibration(providerId: string, modelId: string, ratio: number): void;
}

export class InMemoryModelCapabilitiesStore implements ModelCapabilitiesStore {
  private readonly rows = new Map<string, ModelCapabilitiesRow>();

  private key(providerId: string, modelId: string): string {
    return `${providerId}::${modelId}`;
  }

  get(providerId: string, modelId: string): ModelCapabilitiesRow | null {
    const row = this.rows.get(this.key(providerId, modelId));
    return row ? { ...row } : null;
  }

  list(): ModelCapabilitiesRow[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  upsert(capabilities: ModelCapabilities): void {
    const key = this.key(capabilities.providerId, capabilities.modelId);
    const existing = this.rows.get(key);
    this.rows.set(key, { ...capabilities, calibrationRatio: existing?.calibrationRatio });
  }

  setCalibration(providerId: string, modelId: string, ratio: number): void {
    const key = this.key(providerId, modelId);
    const existing = this.rows.get(key);
    if (existing) {
      this.rows.set(key, { ...existing, calibrationRatio: ratio });
      return;
    }
    this.rows.set(key, {
      providerId,
      modelId,
      contextWindowTokens: 32 * 1024,
      maxOutputTokens: 8 * 1024,
      supportsToolCalls: true,
      supportsUsage: false,
      tokenEstimatorId: "heuristic-v1",
      source: "default",
      calibrationRatio: ratio,
    });
  }
}
