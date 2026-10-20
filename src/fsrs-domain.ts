import { createEmptyCard, fsrs, type Card, type Grade, FSRSVersion, StrategyMode, GenSeedStrategyWithCardId } from "ts-fsrs"

/** FSRS is deliberately independent of MistakeRecord and its three-level schedule. */
export const FEEDBACK_NAMES = ["不会", "不熟", "良好", "掌握"] as const
export const ERROR_REASONS = {
  concept: "概念不清", formula: "公式遗忘", approach: "思路受阻",
  calculation: "计算失误", reading: "审题遗漏", time: "时间不足"
} as const
export type Feedback = 1 | 2 | 3 | 4
export interface FsrsOptions { retention: number; maximumInterval: number; fuzz: boolean }
export const DEFAULT_FSRS_OPTIONS: FsrsOptions = { retention: 0.9, maximumInterval: 36500, fuzz: true }
export type SavedCard = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string }
export interface ReviewEvent {
  id: string; at: string; rating: Feedback
  errorReasons?: Array<keyof typeof ERROR_REASONS>; errorNote?: string
  before?: SavedCard; after: SavedCard; options: FsrsOptions; engine: string
}
export interface FsrsProgress {
  recordId: string; revision: number; importedAt: string
  legacyLevel: 0 | 1 | 2; initialDue: string; paused: boolean
  card?: SavedCard; history: ReviewEvent[]
}
export function validFeedback(value: unknown): value is Feedback {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4
}
export function validateOptions(value: unknown): FsrsOptions {
  const v = value as FsrsOptions
  if (!v || !Number.isFinite(v.retention) || v.retention < 0.7 || v.retention > 0.97 ||
    !Number.isInteger(v.maximumInterval) || v.maximumInterval < 1 || v.maximumInterval > 36500 || typeof v.fuzz !== "boolean") {
    throw new Error("保持率须为 70%–97%，最大间隔须为 1–36500 天")
  }
  return { retention: v.retention, maximumInterval: v.maximumInterval, fuzz: v.fuzz }
}
export function errorDetails(reasons?: unknown, note?: unknown): Pick<ReviewEvent, "errorReasons" | "errorNote"> {
  if (reasons !== undefined && (!Array.isArray(reasons) || reasons.some(v => !Object.prototype.hasOwnProperty.call(ERROR_REASONS, v)))) throw new Error("无效的错因")
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) throw new Error("错因备注最多 500 字")
  return { errorReasons: reasons === undefined ? undefined : [...new Set(reasons as Array<keyof typeof ERROR_REASONS>)], errorNote: (note as string | undefined)?.trim() }
}
export function importProgress(source: { recordId: string; level: 0 | 1 | 2; nextReviewAt: string; reviewCompleted?: boolean }, now: Date): FsrsProgress {
  if (!Number.isFinite(Date.parse(source.nextReviewAt))) throw new Error("原复习日期无效，未迁入")
  return { recordId: source.recordId, revision: 0, importedAt: now.toISOString(), legacyLevel: source.level,
    initialDue: source.nextReviewAt, paused: source.reviewCompleted === true, history: [] }
}
function scheduler(options: FsrsOptions) {
  const value = validateOptions(options)
  return fsrs({ request_retention: value.retention, maximum_interval: value.maximumInterval,
    enable_fuzz: value.fuzz, enable_short_term: false, learning_steps: [], relearning_steps: [] })
    .useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId("recordId"))
}
function readCard(progress: FsrsProgress, now: Date): Card & { recordId: string } {
  return { ...(progress.card ? { ...progress.card, due: new Date(progress.card.due),
    last_review: progress.card.last_review ? new Date(progress.card.last_review) : undefined } : createEmptyCard(now)), recordId: progress.recordId }
}
function saveCard(card: Card): SavedCard {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() }
}
export function previewFeedback(progress: FsrsProgress, options: FsrsOptions, now = new Date()) {
  const outcomes = scheduler(options).repeat(readCard(progress, now), now)
  return ([1, 2, 3, 4] as Feedback[]).map(rating => ({ rating, label: FEEDBACK_NAMES[rating - 1],
    due: outcomes[rating].card.due.toISOString(), days: outcomes[rating].card.scheduled_days }))
}
export function applyFeedback(progress: FsrsProgress, options: FsrsOptions, input: {
  id: string; revision: number; rating: Feedback; errorReasons?: unknown; errorNote?: unknown
}, now = new Date()): FsrsProgress {
  if (!validFeedback(input.rating) || !input.id || input.id.length > 120) throw new Error("无效的复习反馈")
  if (progress.history.some(event => event.id === input.id)) return progress
  if (progress.revision !== input.revision) throw new Error("复习状态已变化，请刷新后重试")
  if (progress.paused) throw new Error("请先恢复此题的智能复习")
  if (progress.card?.last_review && now.getTime() < Date.parse(progress.card.last_review)) throw new Error("当前时间早于上次复习，请检查设备时间")
  const details = errorDetails(input.errorReasons, input.errorNote)
  const result = scheduler(options).next(readCard(progress, now), now, input.rating as Grade)
  const card = saveCard(result.card)
  const event: ReviewEvent = { id: input.id, at: now.toISOString(), rating: input.rating, ...details,
    before: progress.card, after: card, options: { ...options }, engine: FSRSVersion }
  return { ...progress, revision: progress.revision + 1, card, history: [...progress.history, event] }
}
export function amendErrorDetails(progress: FsrsProgress, eventId: string, revision: number, reasons: unknown, note: unknown): FsrsProgress {
  if (revision !== progress.revision) throw new Error("复习状态已变化，请刷新后重试")
  if (!progress.history.some(event => event.id === eventId)) throw new Error("复习记录不存在")
  const details = errorDetails(reasons, note)
  return { ...progress, revision: progress.revision + 1,
    history: progress.history.map(event => event.id === eventId ? { ...event, ...details } : event) }
}

/** Recompute the latest event at its original time, without adding a repetition. */
export function correctLastFeedback(progress: FsrsProgress, eventId: string, revision: number, rating: Feedback): FsrsProgress {
  if (revision !== progress.revision) throw new Error("复习状态已变化，请刷新后重试")
  const last = progress.history[progress.history.length - 1]
  if (!last || last.id !== eventId) throw new Error("只能更正最后一次反馈")
  if (!validFeedback(rating)) throw new Error("无效的复习反馈")
  if (last.engine !== FSRSVersion) throw new Error("算法版本已变化，不能重算旧反馈")
  const restored = { ...progress, card: last.before, paused: false, history: progress.history.slice(0, -1) }
  const corrected = applyFeedback(restored, last.options, { id: last.id, revision, rating,
    errorReasons: last.errorReasons, errorNote: last.errorNote }, new Date(last.at))
  return { ...corrected, paused: progress.paused }
}
