import { isfileExists } from "marginnote"
import { decodeBase64Utf8 } from "./base64"
import { sha256Hex } from "./content-fingerprint"
import { cardLinkDocumentRoot, ensureStorageDirectory } from "./storage-paths"

export interface Draft {
  sequence: number
  digest: string
  answer: any
  raw: string
  settings?: Record<string, unknown>
}

export interface AnswerInkImage {
  image: string
  width: number
  height: number
}

export interface Publication extends AnswerInkImage {
  version: 1
  sequence: number
  draftDigest: string
  imageHash: string
  state: "local" | "pending" | "verified" | "failed"
  outstanding?: string
}

function path(group: string, suffix: string, create = false): string {
  const root = cardLinkDocumentRoot()
  if (!root) throw new Error("无法访问批注目录")
  const directory = root + "/answer-ink"
  if (create && !ensureStorageDirectory(directory)) throw new Error("无法建立批注目录")
  return directory + "/" + group + suffix
}

function read(file: string): string | undefined {
  if (!isfileExists(file)) return undefined
  const data = NSData.dataWithContentsOfFile(file)
  return decodeBase64Utf8(String(data.base64Encoding()))
}

function write(file: string, content: string): void {
  const data = NSData.dataWithStringEncoding(content, 4)
  if (!data?.writeToFileAtomically(file, true) ||
      String(NSData.dataWithContentsOfFile(file)?.base64Encoding()) !== String(data.base64Encoding())) {
    throw new Error("批注文件写入或回读失败")
  }
}

export function validateAnswer(answer: any): void {
  if (!answer || !Number.isInteger(answer.height) || answer.height < 1 ||
      !Array.isArray(answer.strokes) || answer.strokes.length > 20000 || !Array.isArray(answer.styles) ||
      answer.strokes.length !== answer.styles.length || !answer.strokes.every((s: any) => Array.isArray(s) && s.length > 0 &&
        s.every((p: any) => Array.isArray(p) && p.length === 4 && p.every(Number.isFinite) && p[2] >= 0 && p[2] <= 1)) ||
      !answer.styles.every((s: any) => s && (s.engine === "goodnotes-ink-v2" || s.engine === undefined ||
          (s.engine === "drawesome-highlighter-v1" && s.kind === "marker" && s.pressure === false)) &&
        Number.isFinite(s.size) && s.size > 0 && typeof s.pressure === "boolean" && /^#[0-9a-f]{6}$/i.test(s.color) &&
        (s.anchor === undefined || (s.anchor && typeof s.anchor.key === "string" && s.anchor.key.length > 0 && s.anchor.key.length <= 256 &&
          Array.isArray(s.anchor.rect) && s.anchor.rect.length === 4 && s.anchor.rect.every(Number.isFinite) &&
          s.anchor.rect[2] > 0 && s.anchor.rect[3] > 0)))) {
    throw new Error("批注数据无效")
  }
}


function decodeDraft(raw: string): Draft {
  const record = JSON.parse(raw)
  if (![1, 2, 3].includes(record.version)) throw new Error("批注文件版本无法读取")
  validateAnswer(record.answer)
  let answer = record.answer
  if (record.version === 1) {
    const { width, height, strokes, styles } = answer
    const scale = typeof width === "number" && width > 0 ? 1000 / width : 1
    answer = { height: Math.ceil(height * scale),
      styles: styles.map((style: any) => style.inputScale ? { ...style, inputScale: style.inputScale / scale } : style),
      strokes: strokes.map((stroke: number[][]) => stroke.map(([x, y, pressure, time]) => [x * scale, y * scale, pressure, time])) }
  }
  const digest = sha256Hex(JSON.stringify(answer))
  if (record.version === 3 && (record.digest !== digest || !Number.isSafeInteger(record.sequence) || record.sequence < 1)) {
    throw new Error("批注文件校验失败")
  }
  return { answer, digest, sequence: record.version === 3 ? record.sequence : 0, settings: record.settings, raw }
}

export function loadDraft(group: string, verified?: Draft): Draft | undefined {
  try {
    const raw = read(path(group, ".json"))
    if (raw !== undefined) return raw === verified?.raw ? verified : decodeDraft(raw)
  } catch (error) {
    const backup = read(path(group, ".previous.json"))
    if (backup !== undefined) return decodeDraft(backup)
    throw error
  }
  const backup = read(path(group, ".previous.json"))
  return backup === undefined ? undefined : decodeDraft(backup)
}

export function saveDraft(group: string, answer: any, verified?: Draft): Draft {
  validateAnswer(answer)
  const previous = loadDraft(group, verified)
  const serialized = JSON.stringify(answer)
  const digest = sha256Hex(serialized)
  if (previous?.digest === digest) return previous
  if (previous && previous.digest !== verified?.digest) throw new Error("同一答案卡已有更新的草稿，请重新打开后再编辑")
  if (previous) write(path(group, ".previous.json", true), previous.raw)
  const sequence = (previous?.sequence ?? 0) + 1
  const raw = `{"version":3,"sequence":${sequence},"digest":"${digest}","answer":${serialized}}`
  write(path(group, ".json", true), raw)
  return { sequence, digest, answer, raw }
}

export function loadPublication(group: string): Publication | undefined {
  const raw = read(path(group, ".publication.json"))
  if (raw === undefined) return undefined
  const record = JSON.parse(raw)
  if (record.version !== 1 || !["local", "pending", "verified", "failed"].includes(record.state) ||
      !Number.isSafeInteger(record.sequence) || !isAnswerInkPng(record) ||
      record.imageHash !== sha256Hex(record.image) || !/^[a-f0-9]{64}$/.test(record.draftDigest) ||
      (record.outstanding !== undefined && !/^[a-f0-9]{64}$/.test(record.outstanding))) {
    throw new Error("批注发布记录校验失败")
  }
  return record
}

export function hasAnswerInkPublication(group: string): boolean {
  return isfileExists(path(group, ".publication.json"))
}

export function savePublication(group: string, record: Publication): void {
  write(path(group, ".publication.json", true), JSON.stringify(record))
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
export function pngDimensions(image: unknown): { width: number; height: number } | undefined {
  if (typeof image !== "string" || image.length > 16000000 ||
      !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(image)) return undefined
  const value = image.slice(22, 54)
  if (value.length !== 32) return undefined
  const bytes: number[] = []
  for (let i = 0; i < value.length; i += 4) {
    const packed = [...value.slice(i, i + 4)].reduce((sum, char) => sum * 64 + alphabet.indexOf(char), 0)
    bytes.push(packed >>> 16, (packed >>> 8) & 255, packed & 255)
  }
  if (bytes.slice(8, 16).join(",") !== "0,0,0,13,73,72,68,82") return undefined
  const integer = (start: number) => bytes.slice(start, start + 4).reduce((sum, byte) => sum * 256 + byte, 0)
  const width = integer(16), height = integer(20)
  if (width < 1 || width > 3000 || height < 1 || height > 6000) return undefined
  return { width, height }
}

export function isAnswerInkPng(value: any): boolean {
  const dimensions = pngDimensions(value?.image)
  return !!dimensions && dimensions.width === value.width && dimensions.height === value.height
}
