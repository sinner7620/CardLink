import type { ModelRate } from "../../domain/request-telemetry.ts";

/**
 * v2.14 §22：手动费率存储（H1 元数据，与密钥/Provider 凭据分离）。
 * 按 `providerId + model` 唯一；币种随费率保存，聚合时不混币。
 */
export interface ModelRateStore {
  get(providerId: string, model: string): ModelRate | null;
  upsert(rate: ModelRate): void;
  clear(providerId: string, model: string): void;
  /** 有界列表（设置页展示已配置费率）；按更新时间倒序。 */
  list(limit: number): ModelRate[];
}

function keyOf(providerId: string, model: string): string {
  return `${providerId.trim().toLowerCase()}\u0000${model.trim().toLowerCase()}`;
}

/** 测试/无持久化装配用内存实现。 */
export class InMemoryModelRateStore implements ModelRateStore {
  private readonly rows = new Map<string, ModelRate>();

  get(providerId: string, model: string): ModelRate | null {
    const row = this.rows.get(keyOf(providerId, model));
    return row ? { ...row } : null;
  }

  upsert(rate: ModelRate): void {
    this.rows.set(keyOf(rate.providerId, rate.model), { ...rate });
  }

  clear(providerId: string, model: string): void {
    this.rows.delete(keyOf(providerId, model));
  }

  list(limit: number): ModelRate[] {
    return [...this.rows.values()]
      .sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }
}
