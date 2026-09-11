import test from "node:test"
import assert from "node:assert/strict"
import { sha256Hex, utf8Bytes } from "../src/content-fingerprint"

test("SHA-256 与 FIPS 180-4 测试向量一致", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  assert.equal(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  )
  // 一百万个 'a'：跨 64 字节块边界与消息长度高低位分段写法的回归。
  assert.equal(
    sha256Hex("a".repeat(1_000_000)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
  )
})

test("SHA-256 对 UTF-8 多字节内容稳定且区分微小差异", () => {
  const cjk = sha256Hex("二重积分·积分区域")
  assert.equal(cjk, sha256Hex("二重积分·积分区域"))
  assert.notEqual(cjk, sha256Hex("二重积分·积分区域 "))
  assert.notEqual(sha256Hex("a"), sha256Hex("ab"))
  // 代理对（非 BMP 字符）按 UTF-8 四字节序列编码。
  assert.equal(utf8Bytes("𝑥").length, 4)
})
