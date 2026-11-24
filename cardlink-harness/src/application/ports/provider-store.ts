import { randomUUID } from "../../platform/uuid.ts";
import type { ModelProviderConfig } from "../../domain/provider.ts";

/**
 * v2.1 §5.1.2：Provider 配置与密钥分离。
 * 配置（不含密钥明文）可持久化；密钥经 credentialRef 间接索引。
 */
export interface ProviderConfigStore {
  get(id: string): ModelProviderConfig | undefined;
  list(): ModelProviderConfig[];
  upsert(config: ModelProviderConfig): void;
  remove(id: string): void;
}

/** 内存实现（会话级）；持久化形态待 Keychain/P0 验证后另建适配器。 */
export class InMemoryProviderConfigStore implements ProviderConfigStore {
  private readonly map = new Map<string, ModelProviderConfig>();

  get(id: string): ModelProviderConfig | undefined {
    const c = this.map.get(id);
    return c ? { ...c } : undefined;
  }

  list(): ModelProviderConfig[] {
    return [...this.map.values()].map((c) => ({ ...c }));
  }

  upsert(config: ModelProviderConfig): void {
    this.map.set(config.id, { ...config });
  }

  remove(id: string): void {
    this.map.delete(id);
  }
}

/**
 * v2.1 §12：密钥仅存内存（会话级 BYOK），不落盘、不进日志/审计/会话库；
 * Keychain 通道待 P0 验证后另建适配器。
 */
export interface ModelCredentialStore {
  resolve(credentialRef: string): string | undefined;
  set(credentialRef: string, apiKey: string): void;
  clear(credentialRef: string): void;
  refs(): string[];
  revision(credentialRef: string): string | undefined;
  getVerification(credentialRef: string, model: string): boolean | null;
  recordVerification(credentialRef: string, revision: string, model: string, reachable: boolean): void;
}

export class InMemoryCredentialStore implements ModelCredentialStore {
  private readonly map = new Map<string, { apiKey: string; revision: string; verification: Map<string, boolean> }>();

  resolve(credentialRef: string): string | undefined {
    return this.map.get(credentialRef)?.apiKey;
  }

  set(credentialRef: string, apiKey: string): void {
    if (!apiKey.trim()) throw new Error("密钥不能为空");
    this.map.set(credentialRef, { apiKey, revision: randomUUID(), verification: new Map() });
  }

  clear(credentialRef: string): void {
    this.map.delete(credentialRef);
  }

  refs(): string[] {
    return [...this.map.keys()];
  }

  revision(credentialRef: string): string | undefined {
    return this.map.get(credentialRef)?.revision;
  }

  getVerification(credentialRef: string, model: string): boolean | null {
    return this.map.get(credentialRef)?.verification.get(model) ?? null;
  }

  recordVerification(credentialRef: string, revision: string, model: string, reachable: boolean): void {
    const entry = this.map.get(credentialRef);
    if (entry?.revision === revision) entry.verification.set(model, reachable);
  }
}
