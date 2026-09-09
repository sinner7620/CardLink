// R10：base64 编解码与图片魔数判断的唯一实现。
// 此前 mistake-export / pkdrawing-svg / card-html / card-markdown 各有一份手写副本。

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** 宽容解码为字节：接受 data: 前缀、URL-safe 变体（-/_）与任意空白。 */
export function decodeBase64Bytes(value: string): Uint8Array {
  const text = String(value || "").replace(/^data:[^,]+,/, "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "")
  if (!text || text.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(text)) throw new Error("invalid-base64")
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of text) {
    if (character === "=") break
    const index = BASE64_ALPHABET.indexOf(character)
    if (index < 0) throw new Error("invalid-base64-character")
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }
  return new Uint8Array(bytes)
}

/** ASCII/Latin-1 字符串 → base64（用于 SVG data URI 等纯字节场景）。 */
export function encodeBase64Ascii(value: string): string {
  let result = ""
  for (let offset = 0; offset < value.length; offset += 3) {
    const a = value.charCodeAt(offset) & 255
    const hasB = offset + 1 < value.length
    const hasC = offset + 2 < value.length
    const bits = (a << 16) | ((hasB ? value.charCodeAt(offset + 1) : 0) << 8) | (hasC ? value.charCodeAt(offset + 2) : 0)
    result += BASE64_ALPHABET[bits >> 18 & 63] + BASE64_ALPHABET[bits >> 12 & 63] + (hasB ? BASE64_ALPHABET[bits >> 6 & 63] : "=") + (hasC ? BASE64_ALPHABET[bits & 63] : "=")
  }
  return result
}

/** base64 → Latin-1 字符串（文本型 base64，如 UTF-8 已在外层编好的内容）。 */
export function decodeBase64Ascii(value: string): string {
  let output = ""
  for (const byte of decodeBase64Bytes(value)) output += String.fromCharCode(byte)
  return output
}

/** 按文件头魔数判断 base64 图片的 MIME 类型。 */
export function imageMimeFromBase64(value: string, fallback = "image/png"): string {
  const base64 = String(value || "").replace(/\s/g, "")
  if (base64.startsWith("iVBOR")) return "image/png"
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("R0lGOD")) return "image/gif"
  if (base64.startsWith("UklGR")) return "image/webp"
  return fallback
}

/** 从 data: URI 或裸 base64 推断文件扩展名（card-markdown 用）。 */
export function imageExtensionFromSource(source: string): string {
  const base64 = String(source || "").split(",").pop()?.replace(/\s/g, "") || ""
  const fallback = /^data:image\/jpe?g/i.test(String(source || "")) ? "image/jpeg" : "image/png"
  const mime = imageMimeFromBase64(base64, fallback)
  return mime === "image/jpeg" ? "jpg" : mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : "png"
}
