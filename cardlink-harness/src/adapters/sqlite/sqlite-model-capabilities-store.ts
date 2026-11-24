import type { ModelCapabilitiesRow, ModelCapabilitiesStore } from "../../application/ports/model-capabilities-store.ts";
import type { CapabilitySource, ModelCapabilities } from "../../domain/model-capabilities.ts";
import type { SqlDriver } from "./db.ts";

interface CapabilityRow {
  provider_id: string;
  model_id: string;
  context_window_tokens: number;
  max_output_tokens: number;
  supports_tool_calls: number;
  supports_usage: number;
  token_estimator_id: string;
  source: string;
  calibration_ratio: number | null;
  updated_at: string;
}

function toRow(row: CapabilityRow): ModelCapabilitiesRow {
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    contextWindowTokens: Number(row.context_window_tokens),
    maxOutputTokens: Number(row.max_output_tokens),
    supportsToolCalls: row.supports_tool_calls === 1,
    supportsUsage: row.supports_usage === 1,
    tokenEstimatorId: row.token_estimator_id,
    source: row.source as CapabilitySource,
    calibrationRatio: row.calibration_ratio ?? undefined,
  };
}

/** v2.5 §5.2：模型能力与估算校准持久化（按 provider+model 唯一）。 */
export class SqliteModelCapabilitiesStore implements ModelCapabilitiesStore {
  constructor(private readonly driver: SqlDriver) {}

  get(providerId: string, modelId: string): ModelCapabilitiesRow | null {
    const row = this.driver.rows(
      "SELECT * FROM model_capabilities WHERE provider_id = ? AND model_id = ?",
      [providerId, modelId],
    )[0] as unknown as CapabilityRow | undefined;
    return row ? toRow(row) : null;
  }

  list(): ModelCapabilitiesRow[] {
    const rows = this.driver.rows("SELECT * FROM model_capabilities ORDER BY provider_id, model_id") as unknown as CapabilityRow[];
    return rows.map(toRow);
  }

  upsert(capabilities: ModelCapabilities): void {
    // 保留既有校准系数（用户改窗口不应清空估算校准）。
    this.driver.exec(
      `INSERT INTO model_capabilities(
         provider_id, model_id, context_window_tokens, max_output_tokens,
         supports_tool_calls, supports_usage, token_estimator_id, source, calibration_ratio, updated_at
       ) VALUES(?,?,?,?,?,?,?,?,NULL,?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET
         context_window_tokens = excluded.context_window_tokens,
         max_output_tokens = excluded.max_output_tokens,
         supports_tool_calls = excluded.supports_tool_calls,
         supports_usage = excluded.supports_usage,
         token_estimator_id = excluded.token_estimator_id,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      [
        capabilities.providerId,
        capabilities.modelId,
        capabilities.contextWindowTokens,
        capabilities.maxOutputTokens,
        capabilities.supportsToolCalls ? 1 : 0,
        capabilities.supportsUsage ? 1 : 0,
        capabilities.tokenEstimatorId,
        capabilities.source,
        new Date().toISOString(),
      ],
    );
  }

  /**
   * 校准系数写入。无能力行时写入保守默认（source='default'）——只承载校准，
   * 不会被误认为用户配置（Registry 仅在 source='user' 时采用该行能力）。
   */
  setCalibration(providerId: string, modelId: string, ratio: number): void {
    const now = new Date().toISOString();
    this.driver.exec(
      `INSERT INTO model_capabilities(
         provider_id, model_id, context_window_tokens, max_output_tokens,
         supports_tool_calls, supports_usage, token_estimator_id, source, calibration_ratio, updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET calibration_ratio = excluded.calibration_ratio, updated_at = excluded.updated_at`,
      [providerId, modelId, 32 * 1024, 8 * 1024, 1, 0, "heuristic-v1", "default", ratio, now],
    );
  }
}
