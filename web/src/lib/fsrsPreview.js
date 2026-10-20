import { applyFeedback, amendErrorDetails, correctLastFeedback, DEFAULT_FSRS_OPTIONS, importProgress, previewFeedback, validateOptions } from "../../../src/fsrs-domain"

// Browser demo uses the real scheduling domain, with a separate in-memory store.
const state = { options: { ...DEFAULT_FSRS_OPTIONS }, records: {} }
export function fsrsPreview(command, payload, sources) {
  for (const source of sources) if (!state.records[source.recordId]) state.records[source.recordId] = importProgress(source, new Date())
  if (command === "initialize") return
  if (command === "fsrsSnapshot") return { options: state.options, records: sources.map(source => {
    const p = state.records[source.recordId]
    return { ...source, tags: source.manualCategories || [], progress: { ...p, history: p.history.slice(-1) },
      historyCount: p.history.length, errorReasonKeys: [...new Set(p.history.flatMap(event => event.errorReasons || []))],
      nextReviewAt: p.card?.due || p.initialDue, preview: p.paused ? [] : previewFeedback(p, state.options) }
  }) }
  if (command === "fsrsGetOptions") return { ...state.options }
  if (command === "fsrsSaveOptions") { state.options = validateOptions(payload); return { saved: true } }
  const p = state.records[payload?.recordId]
  if (!p) throw new Error("题目不存在")
  if (command === "fsrsHistory") return p.history
  if (command === "fsrsCorrectFeedback") return state.records[p.recordId] = correctLastFeedback(p, payload.eventId, payload.revision, payload.rating)
  if (command === "fsrsReview") return state.records[p.recordId] = applyFeedback(p, state.options, { ...payload, id: payload.eventId })
  if (command === "fsrsAmendErrors") return state.records[p.recordId] = amendErrorDetails(p, payload.eventId, payload.revision, payload.errorReasons, payload.errorNote)
  if (command === "fsrsPause") {
    if (p.revision !== payload.revision) throw new Error("状态已变化")
    return state.records[p.recordId] = { ...p, revision: p.revision + 1, paused: payload.paused }
  }
  throw new Error("未知智能复习命令")
}
