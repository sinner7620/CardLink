import {
  capabilitiesKey,
  defaultCapabilities,
  validateUserCapabilities,
  type ModelCapabilities,
} from "../domain/model-capabilities.ts";
import { DEFAULT_TOKEN_ESTIMATOR } from "./token-estimator.ts";
import type { ModelCapabilitiesRow, ModelCapabilitiesStore } from "./ports/model-capabilities-store.ts";

/**
 * v2.5 §5.2：模型能力登记（ModelCapabilitiesRegistry）。
 *
 * 优先级 user > verified > provider > default。预置表只按**精确模型 id** 命中；
 * 不根据模型名做模糊推断——未知模型一律走 §5.2 的保守默认，并允许用户覆盖。
 * 预置值仅代表仓库当前核对的公开能力，服务商调整后以用户覆盖为准。
 */
const VERIFIED_PRESETS: ReadonlyArray<Omit<ModelCapabilities, "providerId" | "source">> = [
  { modelId: "gpt-4o", contextWindowTokens: 128000, maxOutputTokens: 16384, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
  { modelId: "gpt-4o-mini", contextWindowTokens: 128000, maxOutputTokens: 16384, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
  { modelId: "deepseek-chat", contextWindowTokens: 65536, maxOutputTokens: 8192, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
  { modelId: "deepseek-reasoner", contextWindowTokens: 65536, maxOutputTokens: 8192, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
  { modelId: "qwen-plus", contextWindowTokens: 131072, maxOutputTokens: 8192, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
  { modelId: "qwen-max", contextWindowTokens: 32768, maxOutputTokens: 8192, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
  { modelId: "glm-4-plus", contextWindowTokens: 131072, maxOutputTokens: 4096, supportsToolCalls: true, supportsUsage: true, tokenEstimatorId: "heuristic-v1" },
];

const PRESETS = new Map(VERIFIED_PRESETS.map((preset) => [preset.modelId.toLowerCase(), preset]));

const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 2.0;

export type ResolvedCapabilities = {
  capabilities: ModelCapabilities;
  calibrationRatio?: number;
};

export class ModelCapabilitiesRegistry {
  private readonly memoryCalibration = new Map<string, number>();

  constructor(private readonly store?: ModelCapabilitiesStore) {}

  /** 生效能力：用户覆盖 > 预置 > 保守默认；校准系数独立返回。 */
  resolve(providerId: string, modelId: string): ResolvedCapabilities {
    const pid = providerId.trim() || "unknown";
    const mid = modelId.trim() || "unknown";
    const row = this.store?.get(pid, mid) ?? null;
    let capabilities: ModelCapabilities | undefined;
    if (row?.source === "user") capabilities = row;
    if (!capabilities) {
      const preset = PRESETS.get(mid.toLowerCase());
      if (preset) capabilities = { ...preset, providerId: pid, source: "verified" };
    }
    if (!capabilities) capabilities = defaultCapabilities(pid, mid);
    const calibration =
      row?.calibrationRatio ?? this.memoryCalibration.get(capabilitiesKey(pid, mid));
    return {
      capabilities: { ...capabilities, providerId: pid, modelId: mid },
      calibrationRatio: calibration,
    };
  }

  list(): ModelCapabilitiesRow[] {
    return this.store?.list() ?? [];
  }

  /** 用户覆盖（UI/harness.setModelCapabilities）。 */
  setUserOverride(input: unknown): ModelCapabilities {
    const checked = validateUserCapabilities(input, DEFAULT_TOKEN_ESTIMATOR.id);
    if (!checked.ok) throw new Error(checked.reason);
    this.store?.upsert(checked.value);
    return checked.value;
  }

  /**
   * 用服务商返回的真实 prompt_tokens 校准估算器。
   * EMA(0.3)，限幅 0.5–2.0，防止单次异常值把预算打偏。
   */
  observeUsage(
    providerId: string,
    modelId: string,
    estimatedPromptTokens: number,
    actualPromptTokens: number | undefined,
  ): number | undefined {
    if (!Number.isFinite(estimatedPromptTokens) || estimatedPromptTokens <= 0) return undefined;
    if (!Number.isFinite(actualPromptTokens) || (actualPromptTokens as number) <= 0) return undefined;
    const pid = providerId.trim() || "unknown";
    const mid = modelId.trim() || "unknown";
    const key = capabilitiesKey(pid, mid);
    const previous = this.store?.get(pid, mid)?.calibrationRatio ?? this.memoryCalibration.get(key);
    const raw = (actualPromptTokens as number) / estimatedPromptTokens;
    const clamped = Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, raw));
    const next = previous ? previous * 0.7 + clamped * 0.3 : clamped;
    const rounded = Math.round(next * 1000) / 1000;
    this.memoryCalibration.set(key, rounded);
    this.store?.setCalibration(pid, mid, rounded);
    return rounded;
  }
}
