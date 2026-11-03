import { getLocalDataByKey, setLocalDataByKey, isfileExists, readJSON, writeTextFile, MN } from "marginnote"
import { loadMatcherSettings } from "./settings"
import { loadMistakeState } from "./mistake-store"
import { isolatedReviewContent, syncMistakeReasonTags } from "./mistake-manager"
import { cardLinkDocumentPath, ensureStorageDirectory } from "./storage-paths"
import { createFsrsStore, FSRS_STORAGE_KEY } from "./fsrs-store"
import { applyFeedback, amendErrorDetails, correctLastFeedback, importProgress, previewFeedback, validateOptions, ERROR_REASONS, type Feedback } from "./fsrs-domain"

function assertEnabled(requireActive = true): void {
  const settings = loadMatcherSettings()
  if (!settings.debugModeEnabled || (requireActive && settings.debugReviewAlgorithm !== "fsrs")) throw new Error("请在调试模式中开启 FSRS 智能复习")
}
function backupPath(): string {
  if (!MN.app.documentPath) throw new Error("文档目录不可用")
  const root = cardLinkDocumentPath("backups")
  ensureStorageDirectory(root)
  return `${root}/FSRS智能复习备份.json`
}
const store = createFsrsStore({
  read: () => getLocalDataByKey(FSRS_STORAGE_KEY),
  write: value => setLocalDataByKey(value, FSRS_STORAGE_KEY),
  readBackup: () => { const path = backupPath(); return isfileExists(path) ? readJSON(path) : undefined },
  backup: value => writeTextFile(backupPath(), value)
})

/** Seed once, without copying ambiguous old history or touching any fixed record. */
export function initializeFsrs(): void {
  assertEnabled(false)
  const state = store.load(), records = { ...state.records }
  const now = new Date()
  let changed = false
  for (const source of Object.values(loadMistakeState().records)) {
    if (!records[source.recordId]) { records[source.recordId] = importProgress(source, now); changed = true }
  }
  if (changed) store.save({ ...state, records })
}
export function fsrsSnapshot() {
  assertEnabled()
  initializeFsrs()
  const state = store.load(), now = new Date()
  return { options: state.options, records: Object.values(loadMistakeState().records).filter(source => source.sourceAvailable !== false).map(source => {
    const progress = state.records[source.recordId]
    return { recordId: source.recordId, sourceNoteId: source.sourceNoteId, sourceNotebookId: source.sourceNotebookId,
      sourceRootNodeId: source.sourceRootNodeId, sourceTitle: source.sourceTitle, sourceNotebookTitle: source.sourceNotebookTitle,
      sourceRootTitle: source.sourceRootTitle, sourcePathTitles: source.sourcePathTitles,
      tags: source.manualCategories || [], historyCount: progress.history.length,
      errorReasonKeys: [...new Set(progress.history.flatMap(event => event.errorReasons || []))],
      progress: { ...progress, history: progress.history.slice(-1) }, nextReviewAt: progress.card?.due || progress.initialDue,
      preview: progress.paused ? [] : previewFeedback(progress, state.options, now) }
  }) }
}
export function fsrsCommand(command: string, payload: any): any {
  assertEnabled()
  if (command === "fsrsSnapshot") return fsrsSnapshot()
  const state = store.load()
  if (command === "fsrsGetOptions") return { ...state.options }
  if (command === "fsrsSaveOptions") {
    store.save({ ...state, options: validateOptions(payload) })
    return { saved: true }
  }
  const id = String(payload?.recordId || ""), progress = state.records[id]
  if (!progress || !loadMistakeState().records[id]) throw new Error("错题记录不存在，请刷新")
  if (command === "fsrsContent") return isolatedReviewContent(id)
  if (command === "fsrsHistory") return progress.history
  if (command === "fsrsPreview") return previewFeedback(progress, state.options)
  let next = progress
  if (command === "fsrsReview") {
    next = applyFeedback(progress, state.options, { id: String(payload?.eventId || ""), revision: payload?.revision,
      rating: payload?.rating as Feedback, errorReasons: payload?.errorReasons, errorNote: payload?.errorNote })
  } else if (command === "fsrsCorrectFeedback") {
    next = correctLastFeedback(progress, String(payload?.eventId || ""), payload?.revision, payload?.rating)
  } else if (command === "fsrsAmendErrors") {
    next = amendErrorDetails(progress, String(payload?.eventId || ""), payload?.revision, payload?.errorReasons, payload?.errorNote)
  } else if (command === "fsrsPause") {
    if (payload?.revision !== progress.revision || typeof payload?.paused !== "boolean") throw new Error("状态已变化，请刷新后重试")
    next = { ...progress, paused: payload.paused, revision: progress.revision + 1 }
  } else throw new Error("未知智能复习命令")
  if (next !== progress) {
    if (command !== 'fsrsPause') {
      const last = next.history[next.history.length - 1]
      const reasons: Array<{ key: string; label: string }> = (last?.errorReasons || []).map(key => ({ key, label: ERROR_REASONS[key] }))
      if (last?.errorNote?.startsWith('错因：') && !reasons.length) reasons.push({ key: 'custom', label: last.errorNote.slice(3) })
      syncMistakeReasonTags(id, reasons)
    }
    store.save({ ...state, records: { ...state.records, [id]: next } })
  }
  return next
}
