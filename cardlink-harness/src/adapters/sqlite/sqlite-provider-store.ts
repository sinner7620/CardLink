import type { ModelProviderConfig } from "../../domain/provider.ts";
import type { ProviderConfigStore, ModelCredentialStore } from "../../application/ports/provider-store.ts";
import type { RoleConfigStore } from "../../application/ports/role-config-store.ts";
import type { ModelRoleConfig, ModelRoleSetting, RoleName } from "../../domain/provider.ts";
import type { SqlDriver } from "./db.ts";
import { encodeBase64Url, decodeBase64Url, utf8Decode } from "../../platform/base64url.ts";
import { utf8Bytes } from "../../platform/sha256.ts";
import { randomUUID } from "../../platform/uuid.ts";

/**
 * §5.1.3 + §12.2 修订（2026-11-14，用户决策）：Provider 配置 / 角色模型 / 密钥
 * 持久化到 Harness 专用 SQLite。密钥以每安装随机密钥做流加密**混淆**存储——
 * 防 CSV 式常规泄露，非 Keychain 级强加密；UI 明示存储方式，提供清除入口。
 */

const PROVIDERS_SQL = "SELECT provider_id, config_json FROM model_providers";

function safeParse<T>(text: string | undefined | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export class SqliteProviderConfigStore implements ProviderConfigStore {
  constructor(private readonly driver: SqlDriver) {}

  get(id: string): ModelProviderConfig | undefined {
    const row = this.driver.rows("SELECT config_json FROM model_providers WHERE provider_id = ?", [id])[0] as
      | { config_json: string }
      | undefined;
    const config = safeParse<ModelProviderConfig | null>(row?.config_json ?? null, null);
    return config ? { ...config } : undefined;
  }

  list(): ModelProviderConfig[] {
    return (this.driver.rows(PROVIDERS_SQL) as unknown as Array<{ provider_id: string; config_json: string }>)
      .map((row) => safeParse<ModelProviderConfig | null>(row.config_json, null))
      .filter((c): c is ModelProviderConfig => c !== null)
      .map((c) => ({ ...c }));
  }

  upsert(config: ModelProviderConfig): void {
    this.driver.exec(
      "INSERT INTO model_providers(provider_id, config_json, updated_at) VALUES(?,?,?) ON CONFLICT(provider_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at",
      [config.id, JSON.stringify(config), new Date().toISOString()],
    );
  }

  remove(id: string): void {
    this.driver.exec("DELETE FROM model_providers WHERE provider_id = ?", [id]);
  }
}

export class SqliteRoleConfigStore implements RoleConfigStore {
  constructor(private readonly driver: SqlDriver) {}

  get(role: RoleName): ModelRoleSetting | null {
    const row = this.driver.rows("SELECT setting_json FROM model_roles WHERE role = ?", [role])[0] as
      | { setting_json: string }
      | undefined;
    const setting = safeParse<ModelRoleSetting | null>(row?.setting_json ?? null, null);
    return setting ? { ...setting } : null;
  }

  set(role: RoleName, setting: ModelRoleSetting): void {
    this.driver.exec(
      "INSERT INTO model_roles(role, setting_json, updated_at) VALUES(?,?,?) ON CONFLICT(role) DO UPDATE SET setting_json = excluded.setting_json, updated_at = excluded.updated_at",
      [role, JSON.stringify(setting), new Date().toISOString()],
    );
  }

  activate(settings: ModelRoleConfig): void {
    this.driver.transaction(() => {
      for (const role of ["assistant", "reviewer"] as const) {
        const previous = this.get(role);
        if (previous) this.recordAuthorization(role, previous.providerId);
        this.recordAuthorization(role, settings[role].providerId);
        this.set(role, settings[role]);
      }
    });
  }

  private recordAuthorization(role: RoleName, providerId: string): void {
    this.driver.exec("INSERT OR IGNORE INTO model_role_authorizations(role, provider_id) VALUES(?,?)", [role, providerId]);
  }

  isAuthorized(role: RoleName, providerId: string): boolean {
    return this.get(role)?.providerId === providerId || this.driver.rows(
      "SELECT 1 FROM model_role_authorizations WHERE role = ? AND provider_id = ?", [role, providerId],
    ).length > 0;
  }
}

/** 每安装随机密钥：首次生成并存 device_secret（同一库内——混淆而非强加密，§12.2 修订明示）。 */
function deviceSecret(driver: SqlDriver): string {
  const row = driver.rows("SELECT secret FROM device_secret WHERE id = 1")[0] as { secret: string } | undefined;
  if (row?.secret) return row.secret;
  const secret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  driver.exec("INSERT INTO device_secret(id, secret) VALUES(1, ?) ON CONFLICT(id) DO NOTHING", [secret]);
  const written = driver.rows("SELECT secret FROM device_secret WHERE id = 1")[0] as { secret: string } | undefined;
  return written?.secret ?? secret;
}

/** 流加密混淆：XOR(密钥字节, 安装密钥循环) → Base64URL。仅防常规泄露，非强加密。 */
function obfuscate(plain: string, secret: string): string {
  const keyBytes = utf8Bytes(secret);
  const dataBytes = utf8Bytes(plain);
  const out = dataBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]!);
  return encodeBase64Url(out);
}

function deobfuscate(encoded: string, secret: string): string {
  const dataBytes = decodeBase64Url(encoded);
  const keyBytes = utf8Bytes(secret);
  return utf8Decode(dataBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]!));
}

export class SqliteCredentialStore implements ModelCredentialStore {
  constructor(private readonly driver: SqlDriver) {}

  resolve(credentialRef: string): string | undefined {
    const row = this.driver.rows("SELECT secret_enc FROM model_credentials WHERE credential_ref = ?", [credentialRef])[0] as
      | { secret_enc: string }
      | undefined;
    if (!row) return undefined;
    try {
      const plain = deobfuscate(row.secret_enc, deviceSecret(this.driver));
      return plain || undefined;
    } catch {
      return undefined;
    }
  }

  set(credentialRef: string, apiKey: string): void {
    if (!apiKey.trim()) throw new Error("密钥不能为空");
    const secret = deviceSecret(this.driver);
    this.driver.exec(
      "INSERT INTO model_credentials(credential_ref, secret_enc, updated_at, revision) VALUES(?,?,?,?) ON CONFLICT(credential_ref) DO UPDATE SET secret_enc = excluded.secret_enc, updated_at = excluded.updated_at, revision = excluded.revision",
      [credentialRef, obfuscate(apiKey, secret), new Date().toISOString(), randomUUID()],
    );
  }

  clear(credentialRef: string): void {
    this.driver.exec("DELETE FROM model_credentials WHERE credential_ref = ?", [credentialRef]);
  }

  revision(credentialRef: string): string | undefined {
    const row = this.driver.rows("SELECT revision FROM model_credentials WHERE credential_ref = ?", [credentialRef])[0];
    return typeof row?.revision === "string" ? row.revision : undefined;
  }

  getVerification(credentialRef: string, model: string): boolean | null {
    const row = this.driver.rows(
      `SELECT c.reachable FROM model_connection_checks c JOIN model_credentials k
        ON c.credential_ref = k.credential_ref AND c.revision = k.revision
        WHERE c.credential_ref = ? AND c.model = ?`,
      [credentialRef, model],
    )[0];
    return row ? Number(row.reachable) === 1 : null;
  }

  recordVerification(credentialRef: string, revision: string, model: string, reachable: boolean): void {
    this.driver.exec(
      `INSERT INTO model_connection_checks(credential_ref, model, revision, reachable)
       SELECT credential_ref, ?, revision, ? FROM model_credentials WHERE credential_ref = ? AND revision = ?
       ON CONFLICT(credential_ref, model) DO UPDATE SET revision = excluded.revision, reachable = excluded.reachable`,
      [model, reachable ? 1 : 0, credentialRef, revision],
    );
  }

  refs(): string[] {
    return (this.driver.rows("SELECT credential_ref FROM model_credentials") as unknown as Array<{ credential_ref: string }>).map(
      (r) => r.credential_ref,
    );
  }
}
