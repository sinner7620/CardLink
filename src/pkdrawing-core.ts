// R3：PencilKit PKDrawing 解码器唯一实现（插件 TS 侧与 webview 画布脚本共用）。
// 数据格式说明与致谢见 pkdrawing-renderer.ts 头注释（libfreeform）。
import { decodeBase64Bytes } from "./base64"

export interface Field { n: number; w: number; v: number | Uint8Array }
export interface Point { x: number; y: number; width: number }
export interface Stroke { points: Point[]; color: string }

function unsigned(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0
  for (let index = 0; index < length; index++) value = value * 256 + bytes[offset + index]
  return value
}

function ascii(bytes: Uint8Array, offset: number, length: number, wide = false): string {
  let value = ""
  for (let index = 0; index < length; index++) value += String.fromCharCode(wide ? unsigned(bytes, offset + index * 2, 2) : bytes[offset + index])
  return value
}

function binaryPlist(bytes: Uint8Array): any {
  if (bytes.length < 40 || ascii(bytes, 0, 8) !== "bplist00") throw new Error("invalid-bplist")
  const trailer = bytes.length - 32
  const offsetSize = bytes[trailer + 6]
  const refSize = bytes[trailer + 7]
  const count = unsigned(bytes, trailer + 8, 8)
  const top = unsigned(bytes, trailer + 16, 8)
  const table = unsigned(bytes, trailer + 24, 8)
  if (!offsetSize || !refSize || count > 100000 || table >= bytes.length) throw new Error("invalid-bplist-trailer")
  const offsets = Array.from({ length: count }, (_, index) => unsigned(bytes, table + index * offsetSize, offsetSize))
  const cache: any[] = []
  function objectLength(position: number, info: number): [number, number] {
    if (info < 15) return [info, position]
    const marker = bytes[position++]
    const size = Math.pow(2, marker & 15)
    if (marker >> 4 !== 1 || size > 8) throw new Error("invalid-bplist-length")
    return [unsigned(bytes, position, size), position + size]
  }
  function parse(index: number): any {
    if (cache[index] !== undefined) return cache[index]
    let position = offsets[index]
    const marker = bytes[position++]
    const kind = marker >> 4
    const info = marker & 15
    let result: any
    if (kind === 0) result = info === 8 ? false : info === 9 ? true : null
    else if (kind === 1) result = unsigned(bytes, position, Math.pow(2, info))
    else if (kind === 2) {
      const size = Math.pow(2, info)
      const view = new DataView(bytes.buffer, bytes.byteOffset + position, size)
      result = size === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false)
    } else if (kind === 3) result = new DataView(bytes.buffer, bytes.byteOffset + position, 8).getFloat64(0, false)
    else if (kind === 4 || kind === 5 || kind === 6) {
      const [length, start] = objectLength(position, info)
      result = kind === 4 ? bytes.slice(start, start + length) : ascii(bytes, start, length, kind === 6)
    } else if (kind === 8) result = { uid: unsigned(bytes, position, info + 1) }
    else if (kind === 10) {
      const [length, start] = objectLength(position, info)
      result = []
      cache[index] = result
      for (let item = 0; item < length; item++) result.push(parse(unsigned(bytes, start + item * refSize, refSize)))
    } else if (kind === 13) {
      const [length, start] = objectLength(position, info)
      result = {}
      cache[index] = result
      const values = start + length * refSize
      for (let item = 0; item < length; item++) result[String(parse(unsigned(bytes, start + item * refSize, refSize)))] = parse(unsigned(bytes, values + item * refSize, refSize))
    } else throw new Error("unsupported-bplist-object")
    cache[index] = result
    return result
  }
  return parse(top)
}

/** 从 "wrd" 裸流或 NSKeyedArchiver 归档中取出 drawing 数据。 */
export function drawingData(encoded: string): Uint8Array {
  const raw = decodeBase64Bytes(encoded)
  if (raw[0] === 119 && raw[1] === 114 && raw[2] === 100) return raw
  function unarchive(bytes: Uint8Array): any {
    const archive = binaryPlist(bytes)
    const objects = archive?.$objects
    const rootRef = archive?.$top?.root
    if (!objects || typeof rootRef?.uid !== "number") throw new Error("missing-archive-root")
    const resolve = (value: any) => value && typeof value.uid === "number" ? objects[value.uid] : value
    const root = resolve(rootRef)
    if (root?.["NS.data"] instanceof Uint8Array) return root["NS.data"]
    if (root?.["NS.keys"] && root?.["NS.objects"]) {
      const dictionary: any = {}
      root["NS.keys"].forEach((key: any, index: number) => { dictionary[String(resolve(key))] = resolve(root["NS.objects"][index]) })
      return dictionary
    }
    return root
  }
  const first = unarchive(raw)
  if (first instanceof Uint8Array && first[0] === 119 && first[1] === 114 && first[2] === 100) return first
  const second = first instanceof Uint8Array ? unarchive(first) : first
  const content = second?.drawing2 || second?.drawing1
  if (!(content instanceof Uint8Array)) throw new Error("missing-drawing-data")
  return content
}

export function fields(bytes: Uint8Array, start = 0): Field[] {
  const output: Field[] = []
  let position = start
  function varint(): number {
    let value = 0
    let multiplier = 1
    let byte = 0
    do {
      if (position >= bytes.length) throw new Error("truncated-varint")
      byte = bytes[position++]
      value += (byte & 127) * multiplier
      multiplier *= 128
    } while (byte & 128)
    return value
  }
  while (position < bytes.length) {
    const key = varint()
    const n = Math.floor(key / 8)
    const w = key & 7
    let value: number | Uint8Array
    if (w === 0) value = varint()
    else if (w === 1) { value = bytes.slice(position, position + 8); position += 8 }
    else if (w === 2) { const length = varint(); value = bytes.slice(position, position + length); position += length }
    else if (w === 5) { value = bytes.slice(position, position + 4); position += 4 }
    else throw new Error("unsupported-wire-type")
    output.push({ n, w, v: value })
  }
  return output
}

export function all(items: Field[], n: number): Field[] { return items.filter(item => item.n === n) }
export function one(items: Field[], n: number): Field | undefined { const found = all(items, n); return found[found.length - 1] }
export function f32(value: Uint8Array, offset = 0): number { return new DataView(value.buffer, value.byteOffset + offset, 4).getFloat32(0, true) }

/** 解码 "wrd" 流为笔迹（点已应用变换，颜色为 rgba() 字符串）。 */
export function decodeStrokes(raw: Uint8Array): Stroke[] {
  if (raw[0] !== 119 || raw[1] !== 114 || raw[2] !== 100) throw new Error("invalid-drawing-header")
  const root = fields(raw, 3)
  const colors = all(root, 4).map(item => {
    const colorField = one(fields(item.v as Uint8Array), 1)
    if (!colorField || colorField.w !== 2) return "rgba(25,25,25,1)"
    const rgba = fields(colorField.v as Uint8Array)
    const values = [1, 2, 3, 4].map((n, index) => {
      const field = one(rgba, n)
      return field?.w === 5 ? f32(field.v as Uint8Array) : index === 3 ? 1 : 0
    })
    const scale = Math.max(values[0], values[1], values[2]) <= 1.01 ? 255 : 1
    return `rgba(${Math.round(values[0] * scale)},${Math.round(values[1] * scale)},${Math.round(values[2] * scale)},${Math.max(0, Math.min(1, values[3]))})`
  })
  const strokes: Stroke[] = []
  for (const strokeField of all(root, 5)) {
    const stroke = fields(strokeField.v as Uint8Array)
    const ink = one(stroke, 4)
    const path = one(stroke, 5)
    const transformField = one(stroke, 7)
    if (!path) continue
    const pathFields = fields(path.v as Uint8Array)
    const count = Number(one(pathFields, 3)?.v || 0)
    const packed = one(pathFields, 7)?.v as Uint8Array
    if (!count || !packed) continue
    const stride = packed.length / count
    if (![12, 14, 16, 18, 20, 22].includes(stride)) continue
    const transform = [1, 0, 0, 1, 0, 0]
    if (transformField) {
      const transformFields = fields(transformField.v as Uint8Array)
      for (let index = 1; index <= 6; index++) {
        const value = one(transformFields, index)
        if (value?.w === 5) transform[index - 1] = f32(value.v as Uint8Array)
      }
    }
    const points: Point[] = []
    for (let index = 0; index < count; index++) {
      const offset = index * stride
      const x = f32(packed, offset)
      const y = f32(packed, offset + 4)
      const width = stride >= 16 ? Math.abs(f32(packed, offset + 12)) : 2
      points.push({ x: transform[0] * x + transform[2] * y + transform[4], y: transform[1] * x + transform[3] * y + transform[5], width: Number.isFinite(width) && width > 0 && width < 100 ? width : 2 })
    }
    if (points.length) strokes.push({ points, color: colors[Number(ink?.v || 0)] || "rgba(25,25,25,1)" })
  }
  return strokes
}
