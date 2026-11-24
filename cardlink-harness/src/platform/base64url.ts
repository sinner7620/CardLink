/**
 * 平台层（P4-0）：字节级 Base64URL 编解码，纯 JS（无 Buffer/TextEncoder）。
 * Node 与 JSB 同代码同输出；用于游标等 URL 安全编码（§9 分页游标）。
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

export function encodeBase64Url(bytes: ArrayLike<number>): string {
  const out: string[] = []
  let buffer = 0
  let bits = 0
  for (let index = 0; index < bytes.length; index++) {
    buffer = (buffer << 8) | (bytes[index]! & 0xff)
    bits += 8
    while (bits >= 6) {
      bits -= 6
      out.push(ALPHABET[(buffer >>> bits) & 63]!)
    }
  }
  if (bits > 0) {
    out.push(ALPHABET[(buffer << (6 - bits)) & 63]!)
  }
  // Base64URL 无填充（RFC 4648 §5）。
  return out.join("")
}

/** 字节 → UTF-8 字符串（JSB 无 TextDecoder；与 utf8Bytes 互逆）。 */
export function utf8Decode(bytes: ArrayLike<number>): string {
  let out = ""
  let index = 0
  const n = bytes.length
  while (index < n) {
    const b0 = bytes[index]!
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
      index++
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[index + 1]! & 0x3f))
      index += 2
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[index + 1]! & 0x3f) << 6) | (bytes[index + 2]! & 0x3f))
      index += 3
    } else {
      const codePoint = ((b0 & 0x07) << 18) | ((bytes[index + 1]! & 0x3f) << 12) | ((bytes[index + 2]! & 0x3f) << 6) | (bytes[index + 3]! & 0x3f)
      const offset = codePoint - 0x10000
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff))
      index += 4
    }
  }
  return out
}

export function decodeBase64Url(text: string): number[] {
  const clean = String(text || "").replace(/=+$/, "")
  if (/[^A-Za-z0-9\-_]/.test(clean)) throw new Error("invalid-base64url-character")
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of clean) {
    buffer = (buffer << 6) | ALPHABET.indexOf(character)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return bytes
}
