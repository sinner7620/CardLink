import { getLocalDataByKey, setLocalDataByKey } from "marginnote"
import type { MistakeRecord } from "./mistake-domain"

const STORAGE_KEY = "mn4-answer-matcher.manual-review-queue.v1"

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function validIds(records: Record<string, MistakeRecord>, now: Date): string[] {
  const saved = getLocalDataByKey(STORAGE_KEY) as { day?: string; ids?: unknown } | undefined
  if (saved?.day !== localDay(now) || !Array.isArray(saved.ids)) return []
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return [...new Set(saved.ids.filter((id): id is string => typeof id === "string" && !!id))]
    .filter(id => {
      const record = records[id]
      return record && record.sourceAvailable !== false && !record.reviewCompleted &&
        new Date(record.nextReviewAt).getTime() < startToday
    })
}

/** The native mistake store is complete even while the Web panel receives only its first page. */
export function manualTodayIds(records: Record<string, MistakeRecord>, now = new Date()): string[] {
  return validIds(records, now)
}

export function addOverdueToToday(records: Record<string, MistakeRecord>, count: number, now = new Date()): { ids: string[]; addedCount: number } {
  const current = validIds(records, now)
  const selected = new Set(current)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const pool = Object.values(records).filter(record =>
    record.sourceAvailable !== false && !record.reviewCompleted &&
    new Date(record.nextReviewAt).getTime() < startToday && !selected.has(record.recordId)
  )
  const target = Math.max(0, Math.min(5, Math.floor(Number(count) || 0)))
  for (let index = 0; index < target && index < pool.length; index++) {
    const pick = index + Math.floor(Math.random() * (pool.length - index))
    ;[pool[index], pool[pick]] = [pool[pick], pool[index]]
  }
  const added = pool.slice(0, target).map(record => record.recordId)
  if (added.length) setLocalDataByKey({ day: localDay(now), ids: [...current, ...added] }, STORAGE_KEY)
  return { ids: [...current, ...added], addedCount: added.length }
}

export function removeFromManualToday(recordId: string, records: Record<string, MistakeRecord>, now = new Date()): void {
  const current = validIds(records, now)
  if (!current.includes(recordId)) return
  setLocalDataByKey({ day: localDay(now), ids: current.filter(id => id !== recordId) }, STORAGE_KEY)
}
