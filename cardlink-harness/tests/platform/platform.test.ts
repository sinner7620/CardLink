import { strict as assert } from "node:assert";
import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import { test, describe } from "node:test";

import { sha256Hex, utf8Bytes } from "../../src/platform/sha256.ts";
import { encodeBase64Url, decodeBase64Url, utf8Decode } from "../../src/platform/base64url.ts";
import { randomUUID } from "../../src/platform/uuid.ts";

/**
 * P4-0 跨环境等价（GPT 建议 §集成验收「跨环境 Hash」）：
 * 平台层纯 JS 实现必须与 node:crypto 字节一致——snapshotId/contentHash/argsHash
 * 因此在 Node（开发回归）与 JSB（设备）间稳定，历史样本不因实现切换漂移。
 */
describe("P4-0: 平台层跨环境等价", () => {
  const vectors = [
    "",
    "abc",
    "hello world",
    "中文内容与 ASCII 混排 123",
    "emoji 😀 surrogate pair",
    JSON.stringify({ args: { limit: 20, subject: "数学" }, name: "queryMistakes" }),
    "x".repeat(1000),
    "line1\nline2\r\nline3",
  ];

  for (const [index, vector] of vectors.entries()) {
    test(`sha256Hex 与 node:crypto 字节一致（向量 ${index}）`, () => {
      const expected = createHash("sha256").update(vector, "utf8").digest("hex");
      assert.equal(sha256Hex(vector), expected);
    });
  }

  test("utf8Bytes 与 Buffer.from(utf8) 字节一致", () => {
    const text = "数学·错题分析 😀";
    assert.deepEqual(utf8Bytes(text), [...Buffer.from(text, "utf8")]);
  });

  test("base64url 与 Buffer 编码一致且往返无损（含游标元组形态）", () => {
    const samples = ["", "a", "ab", "abc", "数学", "{\"category\":\"[\\\"数学\\\"]\",\"title\":\"错题 1\",\"createdAt\":\"2026-11-12T08:00:00.000Z\",\"recordId\":\"bookA:note1\"}"];
    for (const text of samples) {
      const expected = Buffer.from(text, "utf8").toString("base64url");
      assert.equal(encodeBase64Url(utf8Bytes(text)), expected);
      assert.equal(utf8Decode(decodeBase64Url(expected)), text);
    }
  });

  test("randomUUID 为合法 v4 格式且不重复", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = randomUUID();
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(id);
    }
    assert.equal(seen.size, 200);
    void nodeRandomUUID;
  });
});
