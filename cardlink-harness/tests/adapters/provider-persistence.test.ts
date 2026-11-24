import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { migrate } from "../../src/adapters/sqlite/db.ts";
import { SqliteSessionStore } from "../../src/adapters/sqlite/sqlite-session-store.ts";
import { openDatabase, type SqlDriver } from "../../src/adapters/sqlite/node-driver.ts";
import { SqliteCredentialStore, SqliteProviderConfigStore, SqliteRoleConfigStore } from "../../src/adapters/sqlite/sqlite-provider-store.ts";

/**
 * §12.2 修订（2026-11-14，用户决策）：Provider/角色/密钥持久化到 Harness SQLite。
 * 密钥为每安装随机密钥流加密混淆存储——防常规泄露，非强加密；重启后可直接使用。
 */

function makeDb(): SqlDriver {
  return openDatabase(":memory:");
}

describe("§12.2 修订: Provider/角色/密钥持久化", () => {
  test("Provider 配置跨实例（重启语义）保留", () => {
    const driver = makeDb();
    const first = new SqliteProviderConfigStore(driver);
    first.upsert({ id: "p1", protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", credentialRef: "k1", enabled: true });
    // 模拟重启：同一数据库、新实例
    const second = new SqliteProviderConfigStore(driver);
    const got = second.get("p1");
    assert.ok(got);
    assert.equal(got.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(got.credentialRef, "k1");
    assert.equal(second.list().length, 1);
  });

  test("密钥混淆存储：原始表不含明文，resolve 往返一致", () => {
    const driver = makeDb();
    const store = new SqliteCredentialStore(driver);
    const apiKey = "sk-deepseek-test-key-中文😀";
    store.set("k1", apiKey);

    const raw = (driver.rows("SELECT secret_enc FROM model_credentials WHERE credential_ref = 'k1'")[0] as { secret_enc: string }).secret_enc;
    assert.ok(!raw.includes("sk-deepseek"), "混淆后不含明文前缀");
    assert.ok(!raw.includes("test-key"), "混淆后不含明文片段");

    // 重启语义：新实例（同一驱动）可解析
    const second = new SqliteCredentialStore(driver);
    assert.equal(second.resolve("k1"), apiKey);
    assert.equal(second.resolve("missing"), undefined);
    assert.deepEqual(second.refs(), ["k1"]);
  });

  test("clear 删除持久化密钥；空密钥拒绝", () => {
    const driver = makeDb();
    const store = new SqliteCredentialStore(driver);
    store.set("k1", "sk-abc");
    store.clear("k1");
    assert.equal(store.resolve("k1"), undefined);
    assert.throws(() => store.set("k1", "  "), /密钥不能为空/);
  });

  test("角色配置持久化", () => {
    const driver = makeDb();
    const first = new SqliteRoleConfigStore(driver);
    first.set("assistant", { providerId: "p1", model: "deepseek-chat", credentialRef: "k1", timeoutMs: 60000, maxOutputTokens: 2048 });
    const second = new SqliteRoleConfigStore(driver);
    const got = second.get("assistant");
    assert.ok(got);
    assert.equal(got.model, "deepseek-chat");
    assert.equal(second.get("reviewer"), null);
  });

  test("device_secret 首次生成后稳定（混淆密钥跨重启一致）", () => {
    const driver = makeDb();
    const s1 = new SqliteCredentialStore(driver);
    s1.set("k1", "sk-persist");
    // 直接读原始混淆值对比（两次 obfuscate 同 secret 同输出）
    const raw1 = (driver.rows("SELECT secret_enc FROM model_credentials WHERE credential_ref = 'k1'")[0] as { secret_enc: string }).secret_enc;
    s1.set("k1", "sk-persist");
    const raw2 = (driver.rows("SELECT secret_enc FROM model_credentials WHERE credential_ref = 'k1'")[0] as { secret_enc: string }).secret_enc;
    assert.equal(raw1, raw2, "同一安装密钥下同一明文混淆结果一致");
  });
});

test("v15 用迁移时的生效配置绑定旧会话", async () => {
  const db = openDatabase(":memory:", 14);
  try {
    const defaults = new SqliteRoleConfigStore(db);
    const oldRole = { providerId: "p1", model: "old-model", credentialRef: "k1", timeoutMs: 60000, maxOutputTokens: 2048 };
    defaults.set("assistant", oldRole);
    const now = new Date().toISOString();
    db.exec("INSERT INTO sessions(session_id, created_at, updated_at, status, scope_json) VALUES(?,?,?,?,?)",
      ["legacy", now, now, "active", JSON.stringify({ notebookIds: [] })]);
    migrate(db);
    defaults.set("assistant", { ...oldRole, model: "next-model" });
    const sessionStore = new SqliteSessionStore(db);
    assert.deepEqual((await sessionStore.get("legacy"))?.assistantModel, oldRole);
  } finally {
    db.close?.();
  }
});

test("连接测试记录只在对应模型和密钥版本下有效", () => {
  const db = makeDb();
  try {
    const credentials = new SqliteCredentialStore(db);
    credentials.set("key", "first-version");
    const firstRevision = credentials.revision("key");
    assert.ok(firstRevision);
    credentials.recordVerification("key", firstRevision, "m1", true);
    assert.equal(new SqliteCredentialStore(db).getVerification("key", "m1"), true);
    assert.equal(credentials.getVerification("key", "m2"), null);
    credentials.set("key", "second-version");
    const secondRevision = credentials.revision("key");
    assert.ok(secondRevision);
    assert.notEqual(secondRevision, firstRevision);
    assert.equal(credentials.getVerification("key", "m1"), null);
    credentials.recordVerification("key", secondRevision, "m1", false);
    credentials.recordVerification("key", firstRevision, "m1", true);
    assert.equal(credentials.getVerification("key", "m1"), false);
    credentials.clear("key");
    assert.equal(credentials.getVerification("key", "m1"), null);
  } finally {
    db.close?.();
  }
});
