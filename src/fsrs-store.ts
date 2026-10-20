import type { FsrsProgress, FsrsOptions } from "./fsrs-domain"
import { DEFAULT_FSRS_OPTIONS, validateOptions } from "./fsrs-domain"

export const FSRS_STORAGE_KEY = "mn4-answer-matcher.fsrs.v1"
export interface FsrsState { version: 1; options: FsrsOptions; records: Record<string, FsrsProgress> }
export interface FsrsStorage { read(): unknown; write(serialized: string): void; readBackup(): unknown; backup(serialized: string): void }

function decode(value: unknown): FsrsState | undefined {
  if (value === undefined || value === null || value === "") return
  const state = typeof value === "string" ? JSON.parse(value) : value
  if (state?.version !== 1 || !state.records || typeof state.records !== "object" || Array.isArray(state.records)) throw new Error("智能复习存储格式无效")
  validateOptions(state.options)
  for (const [id, record] of Object.entries(state.records) as Array<[string, FsrsProgress]>) {
    if (!record || record.recordId !== id || !Number.isInteger(record.revision) || record.revision < 0 ||
      ![0, 1, 2].includes(record.legacyLevel) || typeof record.paused !== "boolean" || !Array.isArray(record.history) ||
      !Number.isFinite(Date.parse(record.initialDue))) throw new Error("智能复习记录无效")
    if (record.card && (!Number.isFinite(Date.parse(record.card.due)) || !Number.isFinite(record.card.stability) ||
      !Number.isFinite(record.card.difficulty))) throw new Error("智能复习记忆状态无效")
  }
  return state
}

/** No module-level reads; construct only behind the debug + algorithm gate. */
export function createFsrsStore(storage: FsrsStorage) {
  let cached: FsrsState | undefined
  function load(): FsrsState {
    if (cached) return cached
    let failure: unknown
    try { const primary = decode(storage.read()); if (primary) return cached = primary } catch (error) { failure = error }
    try { const backup = decode(storage.readBackup()); if (backup) return cached = backup } catch (error) { failure = error }
    if (failure) throw new Error("智能复习数据损坏，已停止写入；固定曲线数据不受影响")
    return cached = { version: 1, options: { ...DEFAULT_FSRS_OPTIONS }, records: {} }
  }
  function save(state: FsrsState): void {
    const serialized = JSON.stringify(state)
    decode(serialized)
    storage.write(serialized)
    if (storage.read() !== serialized) throw new Error("智能复习保存未确认，请重试")
    cached = state
    // Main write is durable; a backup failure must not invite another review event.
    try { storage.backup(serialized) } catch { /* primary remains the authoritative copy */ }
  }
  return { load, save }
}
