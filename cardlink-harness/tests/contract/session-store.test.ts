import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import type { Session } from "../../src/domain/session.ts";
import type { SessionStore } from "../../src/application/ports/session-store.ts";
import { InMemorySessionStore } from "../fixtures/in-memory-stores.ts";
import { SqliteSessionStore } from "../../src/adapters/sqlite/sqlite-session-store.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";

function makeSession(id: string): Session {
  const now = new Date().toISOString();
  return {
    id,
    messages: [],
    createdAt: now,
    updatedAt: now,
    scope: { notebookIds: [] },
    status: "active",
  };
}

/** 共享契约套件（T01/T17）：同一套断言跑内存 FakeStore 与 SQLite Store。 */
function sessionStoreContract(name: string, make: () => SessionStore): void {
  describe(`SessionStore contract: ${name}`, () => {
    test("create/get 往返一致", async () => {
      const store = make();
      const session = makeSession(`s-${Math.random().toString(36).slice(2)}`);
      await store.create(session);
      const loaded = await store.get(session.id);
      assert.ok(loaded);
      assert.equal(loaded.id, session.id);
      assert.deepEqual(loaded.scope, session.scope);
      assert.equal(loaded.status, "active");
      assert.equal(await store.get("missing"), null);
    });

    test("append 消息顺序不丢不重（T01）", async () => {
      const store = make();
      const session = makeSession(`s-${Math.random().toString(36).slice(2)}`);
      await store.create(session);
      for (let i = 0; i < 5; i++) {
        await store.append(session.id, { type: "user", id: `m${i}`, text: `消息${i}`, createdAt: new Date().toISOString() });
      }
      const loaded = (await store.get(session.id)) as Session;
      assert.equal(loaded.messages.length, 5);
      assert.deepEqual(
        loaded.messages.map((m) => (m as { id: string }).id),
        ["m0", "m1", "m2", "m3", "m4"],
      );
    });

    test("append 不存在的会话报错", async () => {
      const store = make();
      await assert.rejects(() =>
        store.append("nope", { type: "user", id: "m", text: "x", createdAt: new Date().toISOString() }),
      );
    });

    test("setStatus 更新状态；不存在时报错；列表完整", async () => {
      const store = make();
      const a = makeSession("a");
      const b = makeSession("b");
      await store.create(a);
      await store.create(b);
      await store.setStatus(a.id, "completed");
      assert.equal((await store.get(a.id))?.status, "completed");
      await assert.rejects(() => store.setStatus("nope", "completed"));
      const list = await store.list(10);
      assert.equal(list.length, 2);
      assert.deepEqual(
        list.map((s) => s.id).sort(),
        ["a", "b"].sort(),
      );
    });

    test("turn 结果幂等存取（T12，SQLite 特有，Fake 也支持）", async () => {
      const store = make() as SessionStore & {
        saveTurnResult?: (s: string, r: string, x: unknown) => Promise<void>;
        loadTurnResult?: (s: string, r: string) => Promise<unknown>;
      };
      if (!store.saveTurnResult || !store.loadTurnResult) return;
      const session = makeSession("t12");
      await store.create(session);
      await store.saveTurnResult(session.id, "req-1", { status: "completed", message: "ok" });
      await store.saveTurnResult(session.id, "req-1", { status: "completed", message: "应被忽略" });
      assert.deepEqual(await store.loadTurnResult(session.id, "req-1"), { status: "completed", message: "ok" });
      assert.equal(await store.loadTurnResult(session.id, "req-2"), null);
    });
  });
}

sessionStoreContract("in-memory (FakeStore)", () => new InMemorySessionStore());
sessionStoreContract("sqlite", () => new SqliteSessionStore(openDatabase(":memory:")));
