import type { ModelRateStore } from "../../application/ports/model-rate-store.ts";
import type { ModelRate } from "../../domain/request-telemetry.ts";
import type { SqlDriver } from "./db.ts";

interface RateRow {
  provider_id: string;
  model_id: string;
  currency: string;
  input_per_million: number | string;
  output_per_million: number | string;
  updated_at: string;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toRate(row: RateRow): ModelRate {
  return {
    providerId: row.provider_id,
    model: row.model_id,
    currency: row.currency,
    inputPerMillion: num(row.input_per_million),
    outputPerMillion: num(row.output_per_million),
    updatedAt: row.updated_at,
  };
}

/**
 * v2.14 §22：手动费率持久化（H1 自有 SQLite，与密钥/Provider 凭据分离）。
 * 查找大小写不敏感（模型名大小写易变），写入按实际输入保留原样。
 */
export class SqliteModelRateStore implements ModelRateStore {
  constructor(private readonly driver: SqlDriver) {}

  get(providerId: string, model: string): ModelRate | null {
    const row = this.driver.rows(
      "SELECT * FROM model_rates WHERE provider_id = ? COLLATE NOCASE AND model_id = ? COLLATE NOCASE LIMIT 1",
      [providerId.trim(), model.trim()],
    )[0] as unknown as RateRow | undefined;
    return row ? toRate(row) : null;
  }

  upsert(rate: ModelRate): void {
    this.driver.transaction(() => {
      this.driver.exec(
        "DELETE FROM model_rates WHERE provider_id = ? COLLATE NOCASE AND model_id = ? COLLATE NOCASE",
        [rate.providerId.trim(), rate.model.trim()],
      );
      this.driver.exec(
        "INSERT INTO model_rates(provider_id, model_id, currency, input_per_million, output_per_million, updated_at) VALUES(?,?,?,?,?,?)",
        [
          rate.providerId.trim(),
          rate.model.trim(),
          rate.currency,
          rate.inputPerMillion,
          rate.outputPerMillion,
          rate.updatedAt,
        ],
      );
    });
  }

  clear(providerId: string, model: string): void {
    this.driver.exec(
      "DELETE FROM model_rates WHERE provider_id = ? COLLATE NOCASE AND model_id = ? COLLATE NOCASE",
      [providerId.trim(), model.trim()],
    );
  }

  list(limit: number): ModelRate[] {
    const rows = this.driver.rows(
      "SELECT * FROM model_rates ORDER BY updated_at DESC LIMIT ?",
      [Math.max(1, Math.min(200, Math.floor(limit)))],
    ) as unknown as RateRow[];
    return rows.map(toRate);
  }
}
