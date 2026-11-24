import { sha256Hex } from "../content-fingerprint.ts"

/**
 * v2.16 §6.3：本地错题源投影指纹（纯函数，无宿主 API）。
 *
 * 只覆盖**轻量可读**的本地投影：错题记录集合（含等级/错因/复习状态/用户标签/答案绑定）
 * 与 OCR 行（增删改）。不读取学习集卡片、不渲染笔记、不使用 TTL 或最新 updatedAt 冒充检测。
 * 答案卡片正文的变化没有可靠的轻量信号，因此不进入指纹，由调用方在状态中如实标注
 * `answerChanges: 'not_tracked'`（需同步刷新，不谎报 current）。
 */

export type SourceRecordLike = {
  recordId?: unknown
  level?: unknown
  reasonTags?: unknown
  errorReasons?: unknown
  reviewCompleted?: unknown
  nextReviewAt?: unknown
  reviewCount?: unknown
  favorite?: unknown
  manualCategories?: unknown
  manualCategory?: unknown
  customTags?: unknown
  answerNotebookId?: unknown
  answerRootNodeId?: unknown
}

export type SourceOcrRowLike = {
  record_id?: unknown
  manual_text?: unknown
  effective_text?: unknown
  ocr_text?: unknown
  status?: unknown
}

export type SourceBindingLike = {
  notebookId?: unknown
  rootNodeId?: unknown
}

export type SourceFingerprintInput = {
  records: SourceRecordLike[]
  ocrRows?: SourceOcrRowLike[]
  bindings?: SourceBindingLike[]
}

export type SourceFingerprint = {
  fingerprint: string
  counts: { records: number; ocrRows: number; bindings: number }
  tracked: {
    recordSet: true
    level: true
    reasons: true
    reviewState: true
    manualTags: true
    ocrText: true
    answerBinding: true
    answerCardText: false
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean {
  return value === true
}

/** 错因取结构化 errorReasons 的 key 与 reasonTags 的并集，排序后比较（集合语义）。 */
function reasonsOf(record: SourceRecordLike): string[] {
  const reasons = new Set<string>()
  for (const tag of textList(record.reasonTags)) {
    if (tag.trim()) reasons.add(tag.trim())
  }
  if (Array.isArray(record.errorReasons)) {
    for (const item of record.errorReasons) {
      const key = typeof item === "object" && item !== null ? (item as { key?: unknown }).key : undefined
      if (typeof key === "string" && key.trim()) reasons.add(`error:${key.trim()}`)
    }
  }
  return [...reasons].sort()
}

function recordProjection(record: SourceRecordLike): unknown[] {
  return [
    text(record.recordId),
    numberOrNull(record.level),
    reasonsOf(record),
    bool(record.reviewCompleted),
    text(record.nextReviewAt),
    numberOrNull(record.reviewCount),
    bool(record.favorite),
    textList(record.manualCategories),
    text(record.manualCategory),
    textList(record.customTags),
    text(record.answerNotebookId),
    text(record.answerRootNodeId),
  ]
}

function ocrProjection(row: SourceOcrRowLike): unknown[] {
  return [
    text(row.record_id),
    text(row.manual_text),
    text(row.effective_text),
    text(row.ocr_text),
    text(row.status),
  ]
}

function bindingProjection(binding: SourceBindingLike): unknown[] {
  return [text(binding.notebookId), text(binding.rootNodeId)]
}

/** 确定性指纹：记录按 recordId、OCR 按 record_id、绑定按 notebook/root 排序后再哈希。 */
export function sourceFingerprint(input: SourceFingerprintInput): SourceFingerprint {
  const records = [...(input.records ?? [])]
    .map(recordProjection)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  const ocrRows = [...(input.ocrRows ?? [])]
    .map(ocrProjection)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  const bindings = [...(input.bindings ?? [])]
    .map(bindingProjection)
    .sort((a, b) => `${a[0]}\u0000${a[1]}`.localeCompare(`${b[0]}\u0000${b[1]}`))
  const fingerprint = sha256Hex(JSON.stringify({ v: 1, records, ocrRows, bindings }))
  return {
    fingerprint,
    counts: { records: records.length, ocrRows: ocrRows.length, bindings: bindings.length },
    tracked: {
      recordSet: true,
      level: true,
      reasons: true,
      reviewState: true,
      manualTags: true,
      ocrText: true,
      answerBinding: true,
      answerCardText: false,
    },
  }
}
