import { delay, MN, NodeNote, popup, setTimeInterval, showHUD, UndoManager } from "marginnote"
import type { MbBookNote } from "marginnote"
import { renderCardHtml } from "./card-html"
import { answerCardHtml, refreshIndex } from "./matcher"
import { findAnswersForQuestion } from "./answer-lookup"
import {
  answerOnlyBindingScopes,
  BindingTarget,
  getBindingForMode,
  loadBindings,
  targetForMode
} from "./store"
import { collectChildMindMapNoteIds, MAIN_MINDMAP_SCOPE_ID, mindMapScopeIdForNote } from "./mindmap-candidate"
import { loadMatcherSettings, normalizeMistakeReviewCurves, saveMatcherSettings } from "./settings"
import {
  compareMistakeRecords,
  automaticCategoryPath,
  categoryPathPrefixes,
  createMistakeRecord,
  isDue,
  isMistakeLevel,
  LEVEL_DESCRIPTIONS,
  manualTagsOf,
  MistakeLevel,
  MistakeReviewCurves,
  MistakeRecord,
  mistakeCategoryLabel,
  reviewMistake,
  resumeMistakeReview,
  sourceRecordKey
} from "./mistake-domain"
import {
  loadMistakeState,
  archiveMistakeRecords,
  recordForSource,
  removeMistakeRecord,
  saveMistakeState,
  upsertMistakeRecord
} from "./mistake-store"
import { openNoteInMindMap, recordRuntimeState , captureDiagnosticError } from "./note-navigation"
import { scopeKey } from "./scope-key"
import {
  cleanMistakeTags,
  hasLegacyManagedMistakeTag,
  isManagedMistakeTag,
  mistakeSourceTags,
  mistakeStateFromSourceTags,
  withoutMistakeSourceTags
} from "./mistake-tags"
import { isMindMapNotebook, notebookNotes } from "./note-tree"

const LAST_REMINDER_KEY = "marginnote.extension.mn4-answer-matcher.mistake-reminder.v2"
const REMINDER_THROTTLE = 6 * 60 * 60 * 1000

function userManualTags(record: Pick<MistakeRecord, "manualCategories" | "manualCategory"> | undefined): string[] {
  return cleanMistakeTags(manualTagsOf(record)).filter(tag => !isManagedMistakeTag(tag))
}
// v4 intentionally ignores the v3 marker: beta.3/beta.5 could mark the check
// complete after a transient zero-result read before the database was ready.
function legacyLevelTagMigrationKey(): string {
  return "marginnote.extension.mn4-answer-matcher.mistake-level-refresh.accepted.v1"
}

// v2 marks the tag-scheme migration: managed tags move to 错题_不会/不熟/掌握
// and the standalone 错题 tag is retired. Both waves must be accepted before
// the consent prompt stops showing, so users who already accepted the level
// migration get exactly one more consent for the tag rewrite.
function tagSchemeMigrationKey(): string {
  return "marginnote.extension.mn4-answer-matcher.mistake-tag-scheme.accepted.v1"
}

export function legacyMistakeTagMigrationCompleted(): boolean {
  try {
    const defaults = NSUserDefaults.standardUserDefaults()
    return defaults.boolForKey(legacyLevelTagMigrationKey()) && defaults.boolForKey(tagSchemeMigrationKey())
  } catch {
    return false
  }
}

export function rememberLegacyMistakeTagMigration(): void {
  const defaults = NSUserDefaults.standardUserDefaults()
  defaults.setBoolForKey(true, legacyLevelTagMigrationKey())
  defaults.setBoolForKey(true, tagSchemeMigrationKey())
  defaults.synchronize()
}

function noteId(note: MbBookNote | any): string {
  return String(note?.noteId ?? note?.noteid ?? note?.id ?? note?.note?.noteId ?? "").trim()
}

function notebookTitle(notebookId: string): string {
  return MN.db.getNotebookById(notebookId)?.title?.trim() || "未命名脑图"
}

function pathTitles(question: NodeNote): string[] {
  try {
    return question.ancestorNodes.map(node => node.title?.trim()).filter(Boolean) as string[]
  } catch {
    return []
  }
}

// 批处理内对同一学习集的子脑图扫描结果做缓存：collectChildMindMapNoteIds 需要遍历
// 整个笔记本，逐题调用会造成 O(n²)；在每次批量入口开始时清空以保证新鲜度。
const childMapIdsCache = new Map<string, string[]>()

function childMapIdsForNotebook(notebookId: string): string[] {
  const cached = childMapIdsCache.get(notebookId)
  if (cached) return cached
  const notebook = MN.db.getNotebookById(notebookId)
  const ids = collectChildMindMapNoteIds(notebookNotes(notebook))
  if (childMapIdsCache.size >= 32) childMapIdsCache.clear()
  childMapIdsCache.set(notebookId, ids)
  return ids
}

function clearChildMapIdsCache(): void {
  childMapIdsCache.clear()
}

function sourceMindMapInfo(question: NodeNote, notebookId: string): { rootNodeId: string; rootTitle: string } {
  const childMapIds = childMapIdsForNotebook(notebookId)
  const rootNodeId = mindMapScopeIdForNote(question.note, childMapIds)
  if (rootNodeId === MAIN_MINDMAP_SCOPE_ID) return { rootNodeId, rootTitle: "主脑图" }
  const rootNote = MN.db.getNoteById(rootNodeId)
  const rootTitle = rootNote ? new NodeNote(rootNote, notebookId).title?.trim() || "未命名子脑图" : "未命名子脑图"
  return { rootNodeId, rootTitle }
}

function answerBinding(sourceNotebookId: string, sourceRootNodeId: string): BindingTarget | undefined {
  const bindings = loadBindings()
  const scoped = loadMatcherSettings().allowSameStudySetMindMap
  const target = getBindingForMode(bindings, sourceNotebookId, sourceRootNodeId, scoped)
  return target && targetForMode(target, scoped)
}

/**
 * 防御式回读卡片标签：真机上个别评论对象可能不可读（NSNull 等），
 * 逐条容错；整个评论列表不可读时返回 undefined 表示"无法校验"，
 * 调用方据此选择乐观提交而不是误判写入失败。
 */
function readSourceTags(note: MbBookNote): string[] | undefined {
  try {
    const tags: string[] = []
    for (const comment of note.comments ?? []) {
      try {
        if (comment?.type === "TextNote" && typeof comment.text === "string" && comment.text.startsWith("#")) {
          tags.push(...comment.text.split(/\s+/).filter(part => part.startsWith("#")).map(part => part.slice(1)))
        }
      } catch {
        // 部分评论不可读也不能证明托管标签不存在。
        return undefined
      }
    }
    return tags
  } catch (error) {
    recordRuntimeState("标签", "回读评论失败", `error=${String(error)}`)
    return undefined
  }
}

type TagWriteStatus = "verified" | "unverified" | "failed"

function combineTagWriteStatus(left: TagWriteStatus, right: TagWriteStatus): TagWriteStatus {
  if (left === "failed" || right === "failed") return "failed"
  if (left === "unverified" || right === "unverified") return "unverified"
  return "verified"
}

function applySourceTags(record: MistakeRecord, previousCategories?: string[]): TagWriteStatus {
  recordRuntimeState("标签", "applySourceTags 前", `targetNoteId=${record.sourceNoteId} notebookId=${record.sourceNotebookId}`)
  const note = MN.db.getNoteById(record.sourceNoteId)
  if (!note) {
    recordRuntimeState("标签", "applySourceTags 目标卡片不存在", `targetNoteId=${record.sourceNoteId}`)
    return "failed"
  }
  const node = new NodeNote(note, record.sourceNotebookId)
  node.tags = mistakeSourceTags(node.tags, record.level, userManualTags(record), previousCategories)
  node.tidyupTags()
  const written = readSourceTags(note)
  const status: TagWriteStatus = written === undefined
    ? "unverified"
    : mistakeStateFromSourceTags(written).level === record.level ? "verified" : "failed"
  recordRuntimeState("标签", "applySourceTags 完成", `targetNoteId=${record.sourceNoteId} status=${status} readback=${written === undefined ? "不可用" : "正常"}`)
  return status
}

function removeSourceTags(record: MistakeRecord): TagWriteStatus {
  recordRuntimeState("标签", "removeSourceTags 前", `targetNoteId=${record.sourceNoteId} notebookId=${record.sourceNotebookId}`)
  const note = MN.db.getNoteById(record.sourceNoteId)
  if (!note) {
    recordRuntimeState("标签", "removeSourceTags 目标卡片不存在", `targetNoteId=${record.sourceNoteId}`)
    return "failed"
  }
  const node = new NodeNote(note, record.sourceNotebookId)
  node.tags = withoutMistakeSourceTags(node.tags, userManualTags(record))
  node.tidyupTags()
  const written = readSourceTags(note)
  const status: TagWriteStatus = written === undefined
    ? "unverified"
    : !mistakeStateFromSourceTags(written).isMistake ? "verified" : "failed"
  recordRuntimeState("标签", "removeSourceTags 完成", `targetNoteId=${record.sourceNoteId} status=${status} readback=${written === undefined ? "不可用" : "正常"}`)
  return status
}

function syncManualTagsFromSource(
  record: MistakeRecord,
  curves: MistakeReviewCurves = loadMatcherSettings().mistakeReviewCurves
): { record: MistakeRecord; changed: boolean; cancelled: boolean } {
  const note = MN.db.getNoteById(record.sourceNoteId)
  if (!note) return { record, changed: false, cancelled: false }
  // 标签即身份（产品决策）：卡片托管标签被移除 = 取消错题。
  // 使用防御式回读：卡片评论不可读（undefined）时跳过判定，避免读取抖动误删记录。
  // 恢复扫描长期证明跨学习集（含未打开）的标签读取可靠，故不再要求学习集处于打开状态。
  const written = readSourceTags(note)
  if (written === undefined) return { record, changed: false, cancelled: false }
  const tagState = mistakeStateFromSourceTags(written)
  let synced = record
  if (tagState.isMistake && !synced.tagsWrittenAt) {
    // 卡片上现在带着托管标签，即视为写入成功过（引导旧记录进入标签即身份语义）。
    synced = { ...synced, tagsWrittenAt: new Date().toISOString() }
  }
  if (!tagState.isMistake) {
    recordRuntimeState("标签反向同步", "卡片托管标签已被移除，判定为取消错题", `targetNoteId=${record.sourceNoteId}`)
    return { record, changed: false, cancelled: true }
  }
  const sourceTags = tagState.customTags
  const storedTags = userManualTags(record)
  const customChanged = !(sourceTags.length === storedTags.length && sourceTags.every((tag, index) => tag === storedTags[index]))
  if (tagState.level !== undefined && tagState.level !== record.level) {
    // 用户在 MarginNote 内直接改了三档等级标签：与面板内改等级走同一推算，采纳为记录等级。
    recordRuntimeState("标签反向同步", "采纳 MarginNote 内的等级变化", `targetNoteId=${record.sourceNoteId} level=${tagState.level}`)
    synced = reviewMistake(synced, tagState.level, new Date(), curves)
  }
  if (customChanged) {
    recordRuntimeState(
      "标签反向同步",
      "检测到 MarginNote 标签变化",
      `targetNoteId=${record.sourceNoteId} storedTags=${storedTags.join("|") || "(空)"} sourceTags=${sourceTags.join("|") || "(空)"}`
    )
    synced = {
      ...synced,
      manualCategories: sourceTags,
      manualCategory: sourceTags[0],
      updatedAt: new Date().toISOString()
    }
  }
  return { record: synced, changed: synced !== record, cancelled: false }
}

function persistSources(notebookIds: Iterable<string>): void {
  const uniqueIds = Array.from(new Set(notebookIds)).filter(Boolean)
  if (!uniqueIds.length) return
  // 官方 Database 指南："savedb 慎用，默认由系统自动管理"。不再在每次标签
  // 变更后整库落盘，仅标记受影响学习集的同步脏位；repair 等整库级操作后
  // 才显式 savedb 一次。
  for (const notebookId of uniqueIds) {
    recordRuntimeState("标签持久化", "setNotebookSyncDirty", `notebookId=${notebookId}`)
    MN.db.setNotebookSyncDirty(notebookId)
  }
}

interface SourceTagTask {
  notebookId: string
  run: () => TagWriteStatus
}

/**
 * Per the official notes-and-database guide, an undo group must be anchored to
 * the notebook that owns the modified notes, and that notebook must receive the
 * refresh notification.
 *
 * Device testing showed MarginNote may skip the undo-group closure entirely for
 * a notebook that is not currently open (or when no notebook is open), so every
 * task also re-runs directly when the closure was never executed, and a task
 * only counts as committed after its post-write verification passed. Skipping
 * the closure loses undo registration for that notebook; a lost write would
 * silently resurrect records instead, so correctness wins.
 *
 * Returns the notebook ids whose writes verified; callers must treat a missing
 * notebook id as "the tags were not written".
 */
function commitSourceTagTasks(actionName: string, tasks: SourceTagTask[]): string[] {
  const valid = tasks.filter(task => task.notebookId)
  const committed: string[] = []
  for (const task of valid) {
    let executed = false
    let status: TagWriteStatus = "failed"
    try {
      recordRuntimeState("标签事务", "撤销组前", `notebookId=${task.notebookId} action=${actionName}`)
      UndoManager.sharedInstance().undoGrouping(actionName, task.notebookId, () => {
        executed = true
        status = task.run()
        recordRuntimeState("标签事务", "撤销组内完成", `notebookId=${task.notebookId} action=${actionName} status=${status}`)
      })
    } catch (error) {
      recordRuntimeState("标签事务", "撤销组异常", `notebookId=${task.notebookId} action=${actionName} error=${String(error)}`)
      captureDiagnosticError(error, "错题管理")
    }
    if (!executed) {
      try {
        status = task.run()
        recordRuntimeState("标签事务", "撤销组未执行，已直写", `notebookId=${task.notebookId} action=${actionName} status=${status}`)
      } catch (error) {
        recordRuntimeState("标签事务", "直写失败", `notebookId=${task.notebookId} action=${actionName} error=${String(error)}`)
        captureDiagnosticError(error, "错题管理")
        status = "failed"
      }
    }
    if (status !== "verified") {
      recordRuntimeState("标签事务", status === "unverified" ? "写入无法回读，视为未提交" : "写入校验未通过，视为未提交", `notebookId=${task.notebookId} action=${actionName}`)
      continue
    }
    MN.app.refreshAfterDBChanged(task.notebookId)
    committed.push(task.notebookId)
  }
  persistSources(committed)
  return committed
}

function withTagsWritten(record: MistakeRecord): MistakeRecord {
  return { ...record, tagsWrittenAt: new Date().toISOString() }
}

function refreshRecord(record: MistakeRecord): MistakeRecord {
  const note = MN.db.getNoteById(record.sourceNoteId)
  if (!note) return { ...record, sourceAvailable: false }
  const actualNotebookId = String((note as any).notebookId ?? record.sourceNotebookId).trim() || record.sourceNotebookId
  const node = new NodeNote(note, actualNotebookId)
  const sourceMap = sourceMindMapInfo(node, actualNotebookId)
  const sourcePathTitles = pathTitles(node)
  const sourceRootNodeId = sourceMap.rootNodeId
  const binding = answerBinding(actualNotebookId, sourceRootNodeId)
  return {
    ...record,
    recordId: sourceRecordKey(actualNotebookId, record.sourceNoteId),
    sourceAvailable: true,
    sourceNotebookId: actualNotebookId,
    sourceNotebookTitle: notebookTitle(actualNotebookId),
    sourceRootNodeId,
    sourceRootTitle: sourceMap.rootTitle,
    sourceTitle: node.title?.trim() || record.sourceTitle || "未命名错题",
    sourcePathTitles,
    categoryPath: [notebookTitle(actualNotebookId), ...sourcePathTitles],
    answerNotebookId: binding?.notebookId ?? record.answerNotebookId,
    answerRootNodeId: binding?.rootNodeId ?? record.answerRootNodeId
  }
}

function mergeIndexedRecords(a: MistakeRecord, b: MistakeRecord): MistakeRecord {
  const history = [...a.history, ...b.history]
    .filter((item, index, all) => all.findIndex(other => other.at === item.at && other.level === item.level) === index)
    .sort((left, right) => left.at.localeCompare(right.at))
  const scheduleSource = a.reviewCount > b.reviewCount ||
    (a.reviewCount === b.reviewCount && String(a.updatedAt) > String(b.updatedAt)) ? a : b
  const createdAt = String(a.createdAt) < String(b.createdAt) ? a.createdAt : b.createdAt
  return {
    ...b,
    level: scheduleSource.level,
    reviewCount: Math.max(a.reviewCount, b.reviewCount, history.length),
    lastReviewedAt: scheduleSource.lastReviewedAt,
    nextReviewAt: scheduleSource.nextReviewAt,
    reviewCompleted: a.reviewCompleted === true || b.reviewCompleted === true,
    favorite: a.favorite === true || b.favorite === true,
    createdAt,
    updatedAt: String(a.updatedAt) > String(b.updatedAt) ? a.updatedAt : b.updatedAt,
    history
  }
}

export interface MistakeTagRecoveryResult {
  scanned: number
  found: number
  added: number
  existing: number
  failed: number
}

function isAnswerOnlyMistakeScope(
  scopes: Set<string>,
  notebookId: string,
  rootNodeId?: string
): boolean {
  return scopes.has(notebookId) || scopes.has(scopeKey({ notebookId, rootNodeId }))
}


let tagRecoveryQueue: Promise<void> = Promise.resolve()

async function recoverMistakesFromSourceTagsInternal(): Promise<MistakeTagRecoveryResult> {
  // 已迁移为手动触发：仅随「刷新错题分类索引」执行，无自动调度与节流。
  clearChildMapIdsCache()
  recordRuntimeState("标签恢复", "恢复扫描开始（手动）")
  const state = loadMistakeState()
  const curves = loadMatcherSettings().mistakeReviewCurves
  const answerOnlyScopes = answerOnlyBindingScopes(loadBindings())
  const candidates = (MN.db.allNotebooks() ?? []).filter(isMindMapNotebook)

  let scanned = 0
  let found = 0
  let added = 0
  let existing = 0
  let failed = 0

  for (const notebook of candidates as any[]) {
    const sourceNotebookId = String(notebook?.topicId ?? "").trim()
    if (!sourceNotebookId) continue
    const notes = notebookNotes(notebook)

    for (let index = 0; index < notes.length; index++) {
      const note = notes[index]
      if (!note) continue
      scanned++
      try {
        const question = new NodeNote(note, sourceNotebookId)
        const tagState = mistakeStateFromSourceTags(question.tags)
        if (!tagState.isMistake) continue

        const sourceNoteId = noteId(note)
        if (!sourceNoteId) continue
        const recordId = sourceRecordKey(sourceNotebookId, sourceNoteId)
        const sourceMap = sourceMindMapInfo(question, sourceNotebookId)
        const sourceRootNodeId = sourceMap.rootNodeId
        if (isAnswerOnlyMistakeScope(answerOnlyScopes, sourceNotebookId, sourceRootNodeId)) continue
        found++
        if (state.records[recordId]) {
          existing++
          continue
        }
        const binding = answerBinding(sourceNotebookId, sourceRootNodeId)
        const sourcePathTitles = pathTitles(question)
        const manualCategories = tagState.customTags
        const sourceNotebookTitle = notebook.title?.trim() || notebookTitle(sourceNotebookId)
        const record = createMistakeRecord({
          sourceNoteId,
          sourceNotebookId,
          sourceNotebookTitle,
          sourceRootNodeId,
          sourceRootTitle: sourceMap.rootTitle,
          sourceTitle: question.title?.trim() || "未命名错题",
          sourcePathTitles,
          categoryPath: [sourceNotebookTitle, ...sourcePathTitles],
          manualCategories,
          manualCategory: manualCategories[0],
          answerNotebookId: binding?.notebookId,
          answerRootNodeId: binding?.rootNodeId,
          level: tagState.level ?? 0
        }, new Date(), curves)
        // 记录由卡片标签恢复而来，卡片托管标签确实存在过。
        upsertMistakeRecord(state, withTagsWritten(record))
        added++
      } catch (error) {
        failed++
        captureDiagnosticError(error, "错题管理")
      }

      if (index % 40 === 39) await delay(0.01)
    }
  }

  if (added) saveMistakeState(state)
  const result = { scanned, found, added, existing, failed }
  recordRuntimeState("标签恢复", "恢复扫描结束", `scanned=${scanned} found=${found} added=${added} existing=${existing} failed=${failed}`)
  return result
}

/**
 * 从 MarginNote 已同步的卡片标签重建缺失的错题记录。
 * 只补充不存在的记录，不删除或覆盖已有复习历史。
 */
/**
 * 手动触发的全量标签恢复（已从自动调度迁移）：仅随「刷新错题分类索引」执行，
 * 串行排队避免与批量操作并发扫描。
 */
export function recoverMistakesFromTags(): Promise<MistakeTagRecoveryResult> {
  const task = tagRecoveryQueue.then(() => recoverMistakesFromSourceTagsInternal())
  tagRecoveryQueue = task.then(() => undefined, () => undefined)
  return task
}
function recordById(recordId: string): MistakeRecord {
  const record = loadMistakeState().records[recordId]
  if (!record) throw new Error("错题记录不存在")
  return record
}

export async function markQuestionAsMistake(
  question: NodeNote,
  sourceNotebookId: string,
  requestedLevel?: MistakeLevel
): Promise<MistakeRecord | undefined> {
  const sourceNoteId = noteId(question.note)
  if (!sourceNoteId) throw new Error("所选卡片没有 noteId，无法标记")
  const state = loadMistakeState()
  const previous = recordForSource(state, sourceNotebookId, sourceNoteId)
  const now = new Date()
  const sourceMap = sourceMindMapInfo(question, sourceNotebookId)
  const sourceRootNodeId = sourceMap.rootNodeId
  const binding = answerBinding(sourceNotebookId, sourceRootNodeId)
  const metadata = {
    sourceNoteId,
    sourceNotebookId,
    sourceNotebookTitle: notebookTitle(sourceNotebookId),
    sourceRootNodeId,
    sourceRootTitle: sourceMap.rootTitle,
    sourceTitle: question.title?.trim() || "未命名错题",
    sourcePathTitles: pathTitles(question),
    categoryPath: [notebookTitle(sourceNotebookId), ...pathTitles(question)],
    answerNotebookId: binding?.notebookId,
    answerRootNodeId: binding?.rootNodeId,
    level: requestedLevel ?? previous?.level ?? 0 as MistakeLevel
  }
  // 卡片侧边改等级与其他入口统一：已有记录按一次复测确认由 reviewMistake 推算，
  // 复测次数、下次复测时间与复测历史同步推进，而不是只改等级字段。
  const record = previous
    ? {
        ...reviewMistake(
          previous,
          metadata.level as MistakeLevel,
          now,
          loadMatcherSettings().mistakeReviewCurves
        ),
        ...metadata
      }
    : createMistakeRecord(metadata, now, loadMatcherSettings().mistakeReviewCurves)
  upsertMistakeRecord(state, record)
  saveMistakeState(state)
  const committed = commitSourceTagTasks("标记错题", [{
    notebookId: sourceNotebookId,
    run: () => applySourceTags(record, userManualTags(previous))
  }])
  if (!committed.length) {
    // 标签没写进卡片就不保留记录：否则下一次反向同步会把它当作"卡片没有托管
    // 标签"而取消，用户只会看到标记凭空消失。
    if (previous) upsertMistakeRecord(state, previous)
    else removeMistakeRecord(state, record.recordId)
    saveMistakeState(state)
    showHUD("标记错题失败：未能写入原题标签，请打开原题所在学习集后重试", 5)
    return previous
  }
  upsertMistakeRecord(state, withTagsWritten(record))
  saveMistakeState(state)

  showHUD(previous ? "已确认为错题复测，记录与复习计划已更新" : "已标记为错题，可在错题浏览窗口中查看", 4)
  return record
}

export interface BatchMistakeResult {
  added: number
  updated: number
  failed: number
  records: MistakeRecord[]
}

/**
 * Mark the current mind-map selection as mistakes in one database transaction.
 * Existing records are refreshed without losing their review history.
 */
export async function markQuestionsAsMistakes(
  questions: NodeNote[],
  sourceNotebookId: string,
  requestedLevel: MistakeLevel
): Promise<BatchMistakeResult> {
  const state = loadMistakeState()
  const curves = loadMatcherSettings().mistakeReviewCurves
  const seen = new Set<string>()
  const prepared: Array<{
    record: MistakeRecord
    previous?: MistakeRecord
  }> = []
  let failed = 0

  for (const question of questions) {
    try {
      const sourceNoteId = noteId(question.note)
      if (!sourceNoteId) throw new Error("所选卡片没有 noteId，无法标记")
      if (seen.has(sourceNoteId)) continue
      seen.add(sourceNoteId)

      const previous = recordForSource(state, sourceNotebookId, sourceNoteId)
      const now = new Date()
      const sourceMap = sourceMindMapInfo(question, sourceNotebookId)
      const sourceRootNodeId = sourceMap.rootNodeId
      const binding = answerBinding(sourceNotebookId, sourceRootNodeId)
      const metadata = {
        sourceNoteId,
        sourceNotebookId,
        sourceNotebookTitle: notebookTitle(sourceNotebookId),
        sourceRootNodeId,
        sourceRootTitle: sourceMap.rootTitle,
        sourceTitle: question.title?.trim() || "未命名错题",
        sourcePathTitles: pathTitles(question),
        categoryPath: [notebookTitle(sourceNotebookId), ...pathTitles(question)],
        answerNotebookId: binding?.notebookId,
        answerRootNodeId: binding?.rootNodeId,
        level: requestedLevel
      }
      const record = previous
        ? {
            // 与其他入口统一：已有记录按一次复测确认推进复习计划。
            ...reviewMistake(previous, requestedLevel, now, curves),
            ...metadata
          }
        : createMistakeRecord(metadata, now, curves)
      prepared.push({ record, previous })
    } catch (error) {
      failed++
      captureDiagnosticError(error, "错题管理")
    }
  }

  let committedAll = false
  if (prepared.length) {
    committedAll = commitSourceTagTasks("批量标记错题", [{
      notebookId: sourceNotebookId,
      run: () => {
        let status: TagWriteStatus = "verified"
        for (const { record, previous } of prepared) {
          status = combineTagWriteStatus(status, applySourceTags(record, userManualTags(previous)))
        }
        return status
      }
    }]).length > 0
    if (committedAll) {
      for (const { record } of prepared) upsertMistakeRecord(state, withTagsWritten(record))
      saveMistakeState(state)
    } else {
      failed += prepared.length
    }
  }

  const succeeded = committedAll ? prepared : []
  return {
    added: succeeded.filter(item => !item.previous).length,
    updated: succeeded.filter(item => Boolean(item.previous)).length,
    failed,
    records: succeeded.map(item => item.record)
  }
}

export function mistakeRecordForSourceQuestion(
  question: NodeNote,
  currentNotebookId: string
): MistakeRecord | undefined {
  return recordForSource(loadMistakeState(), currentNotebookId, noteId(question.note))
}

export function mistakeRecordForQuestion(
  question: NodeNote,
  currentNotebookId: string
): MistakeRecord | undefined {
  return mistakeRecordForSourceQuestion(question, currentNotebookId)
}

export interface MistakeAnswerContext {
  record: MistakeRecord
  sourceQuestion?: NodeNote
}

export function mistakeAnswerContext(
  question: NodeNote,
  currentNotebookId: string
): MistakeAnswerContext | undefined {
  const record = mistakeRecordForSourceQuestion(question, currentNotebookId)
  if (!record) return
  const source = MN.db.getNoteById(record.sourceNoteId)
  return { record, sourceQuestion: source ? new NodeNote(source, record.sourceNotebookId) : undefined }
}

/**
 * 所有更改等级的入口（待复习确认按钮、详情侧下拉、批量更改）统一走这里：
 * 档位相同按一次复测确认推进，档位不同重置复习序列；复习计划只由 reviewMistake 推算。
 */
async function confirmMistakeLevel(recordId: string, level: MistakeLevel): Promise<MistakeRecord> {
  if (!isMistakeLevel(Number(level))) throw new Error("错题等级必须为不会、不熟或掌握")
  const state = loadMistakeState()
  const stored = state.records[recordId]
  if (!stored) throw new Error("错题记录不存在")
  const synced = syncManualTagsFromSource(stored)
  if (synced.cancelled) {
    archiveMistakeRecords([stored])
    removeMistakeRecord(state, recordId)
    saveMistakeState(state)
    throw new Error("该错题的标签已在 MarginNote 内被移除，记录已同步取消")
  }
  const previous = synced.record
  const record = reviewMistake(
    previous,
    Number(level) as MistakeLevel,
    new Date(),
    loadMatcherSettings().mistakeReviewCurves
  )
  const committed = commitSourceTagTasks("错题复习", [{
    notebookId: record.sourceNotebookId,
    run: () => applySourceTags(record)
  }])
  if (!committed.length) {
    throw new Error("复习失败：未能写入原题标签，请打开原题所在学习集后重试")
  }
  upsertMistakeRecord(state, withTagsWritten(record))
  saveMistakeState(state)
  return record
}

export function reviewMistakeById(recordId: string, level: MistakeLevel): Promise<MistakeRecord> {
  return confirmMistakeLevel(recordId, level)
}

export function changeMistakeLevelById(recordId: string, level: MistakeLevel): Promise<MistakeRecord> {
  return confirmMistakeLevel(recordId, level)
}

export async function resumeMistakeReviewById(recordId: string): Promise<MistakeRecord> {
  const state = loadMistakeState()
  const previous = state.records[recordId]
  if (!previous) throw new Error("错题记录不存在")
  const record = resumeMistakeReview(previous, new Date(), loadMatcherSettings().mistakeReviewCurves)
  upsertMistakeRecord(state, record)
  saveMistakeState(state)
  return record
}

export interface BatchMistakeChangeResult {
  changed: number
  missing: number
  records: MistakeRecord[]
}

function uniqueRecordIds(recordIds: unknown): string[] {
  if (!Array.isArray(recordIds)) return []
  return Array.from(new Set(recordIds.map(String).map(id => id.trim()).filter(Boolean)))
}

export async function reviewMistakesByIds(
  recordIds: unknown,
  level: MistakeLevel
): Promise<BatchMistakeChangeResult> {
  if (!isMistakeLevel(Number(level))) throw new Error("错题等级必须为不会、不熟或掌握")
  const ids = uniqueRecordIds(recordIds)
  if (!ids.length) throw new Error("请至少选择一道错题")
  const state = loadMistakeState()
  const curves = loadMatcherSettings().mistakeReviewCurves
  const now = new Date()
  const changedRecords: MistakeRecord[] = []
  const cancelledRecords: MistakeRecord[] = []
  let missing = 0

  for (const recordId of ids) {
    const previous = state.records[recordId]
    if (!previous) {
      missing++
      continue
    }
    const synced = syncManualTagsFromSource(previous, curves)
    if (synced.cancelled) { cancelledRecords.push(previous); missing++; continue }
    changedRecords.push(reviewMistake(synced.record, Number(level) as MistakeLevel, now, curves))
  }

  archiveMistakeRecords(cancelledRecords)
  for (const record of cancelledRecords) removeMistakeRecord(state, record.recordId)
  let records: MistakeRecord[] = []

  if (changedRecords.length) {
    const buckets = new Map<string, MistakeRecord[]>()
    for (const record of changedRecords) {
      const bucket = buckets.get(record.sourceNotebookId) ?? []
      bucket.push(record)
      buckets.set(record.sourceNotebookId, bucket)
    }
    const committedIds = commitSourceTagTasks("批量复习错题", [...buckets].map(([notebookId, bucketRecords]) => ({
      notebookId,
      run: () => {
        let status: TagWriteStatus = "verified"
        for (const record of bucketRecords) {
          status = combineTagWriteStatus(status, applySourceTags(record))
        }
        return status
      }
    })))
    const committed = new Set(committedIds)
    records = changedRecords.filter(record => committed.has(record.sourceNotebookId))
    // 标签写入未验证通过的学习集不落记录，保持记录与卡片一致。
    for (const record of records) upsertMistakeRecord(state, withTagsWritten(record))
    const blocked = changedRecords.length - records.length
    if (blocked) {
      showHUD(`${blocked} 道错题复习失败：未能写入原题标签，记录已保留原状态`, 5)
    }
  }
  if (changedRecords.length || cancelledRecords.length) saveMistakeState(state)
  return { changed: records.length, missing, records }
}

export async function setMistakeCategoryById(recordId: string, categories: string | string[]): Promise<MistakeRecord> {
  const state = loadMistakeState()
  const previous = state.records[recordId]
  if (!previous) throw new Error("错题记录不存在")
  const manualCategories = cleanMistakeTags(categories).filter(tag => !isManagedMistakeTag(tag))
  const record = {
    ...previous,
    manualCategories,
    manualCategory: manualCategories[0],
    updatedAt: new Date().toISOString()
  }
  const previousTags = userManualTags(previous)
  const committed = commitSourceTagTasks("修改错题分类", [{
    notebookId: record.sourceNotebookId,
    run: () => applySourceTags(record, previousTags)
  }])
  if (!committed.length) {
    throw new Error("修改分类失败：未能写入原题标签，请打开原题所在学习集后重试")
  }
  upsertMistakeRecord(state, withTagsWritten(record))
  saveMistakeState(state)
  if (manualCategories.length || previousTags.length) {
    const settings = loadMatcherSettings()
    saveMatcherSettings({
      mistakeCustomCategories: Array.from(new Set([
        ...settings.mistakeCustomCategories,
        ...previousTags,
        ...manualCategories
      ]))
    })
  }
  return record
}

export async function deleteMistakeTag(tagValue: string): Promise<{ tag: string; changed: number }> {
  const tag = cleanMistakeTags(tagValue)[0]
  if (!tag) throw new Error("标签不能为空")

  const state = loadMistakeState()
  const changedRecords: Array<{ previousTags: string[]; record: MistakeRecord }> = []
  const now = new Date().toISOString()

  for (const previous of Object.values(state.records)) {
    const previousTags = userManualTags(previous)
    if (!previousTags.includes(tag)) continue
    const manualCategories = previousTags.filter(item => item !== tag)
    const record: MistakeRecord = {
      ...previous,
      manualCategories,
      manualCategory: manualCategories[0],
      updatedAt: now
    }
    upsertMistakeRecord(state, record)
    changedRecords.push({ previousTags, record })
  }

  if (changedRecords.length) saveMistakeState(state)

  const settings = loadMatcherSettings()
  saveMatcherSettings({
    mistakeCustomCategories: settings.mistakeCustomCategories.filter(item => item !== tag)
  })

  if (changedRecords.length) {
    const buckets = new Map<string, Array<{ previousTags: string[]; record: MistakeRecord }>>()
    for (const item of changedRecords) {
      const bucket = buckets.get(item.record.sourceNotebookId) ?? []
      bucket.push(item)
      buckets.set(item.record.sourceNotebookId, bucket)
    }
    commitSourceTagTasks("删除错题标签", [...buckets].map(([notebookId, bucket]) => ({
      notebookId,
      run: () => {
        let status: TagWriteStatus = "verified"
        for (const { previousTags, record } of bucket) {
          status = combineTagWriteStatus(status, applySourceTags(record, previousTags))
        }
        return status
      }
    })))
  }

  return { tag, changed: changedRecords.length }
}

export async function removeMistakeById(recordId: string): Promise<void> {
  const state = loadMistakeState()
  const record = state.records[recordId]
  if (!record) return
  // Remove the source tags first and only delete the record when the write
  // actually committed: otherwise the recovery scan would see the leftover
  // tags and resurrect the mistake on the next pass.
  const committed = commitSourceTagTasks("取消错题", [{
    notebookId: record.sourceNotebookId,
    run: () => removeSourceTags(record)
  }])
  if (!committed.length) {
    showHUD("取消错题失败：未能在原题所在学习集写入标签变更，请打开该学习集后重试", 5)
    return
  }
  removeMistakeRecord(state, recordId)
  saveMistakeState(state)
}

export interface MistakeWorkbenchRecord extends MistakeRecord {
  noteAvailable: boolean
  categoryLabel: string
  categoryKeys: string[]
}

export interface MistakeWorkbenchData {
  revision: string
  records: MistakeWorkbenchRecord[]
  dueCount: number
  todayDueCount: number
  levelCounts: number[]
  categories: Array<{ key: string; name: string; depth: number; count: number }>
  migratedFromLegacy: number
  reviewCurves: MistakeReviewCurves
  customCategories: string[]
}

export interface MistakeWorkbenchPage extends MistakeWorkbenchData {
  transferId: string
  totalCount: number
  nextOffset?: number
  recordsComplete: boolean
}

const WORKBENCH_PAGE_SIZE = 25
const WORKBENCH_TRANSFER_TTL_MS = 60000
const MAX_WORKBENCH_TRANSFERS = 4
interface WorkbenchTransfer {
  id: string
  createdAt: number
  lastUsedAt: number
  data: MistakeWorkbenchData
}
const workbenchTransfers = new Map<string, WorkbenchTransfer>()
let workbenchDataCache: { revision: string; settingsKey: string; data: MistakeWorkbenchData } | undefined

function pruneWorkbenchTransfers(now: number): void {
  for (const [id, transfer] of workbenchTransfers) {
    if (now - transfer.lastUsedAt > WORKBENCH_TRANSFER_TTL_MS) workbenchTransfers.delete(id)
  }
  while (workbenchTransfers.size >= MAX_WORKBENCH_TRANSFERS) {
    const oldest = [...workbenchTransfers.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
    if (!oldest) break
    workbenchTransfers.delete(oldest.id)
  }
}

/** Lightweight identity for the persisted list; it does not build previews,
 * aggregate categories or transfer records across the native bridge. */
export function mistakeWorkbenchRevision(): string {
  let hash = 2166136261
  const records = loadMistakeState().records
  const ids = Object.keys(records).sort()
  for (const id of ids) {
    const text = `${id}\u001f${records[id].updatedAt || ""}\u001e`
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `${ids.length}:${(hash >>> 0).toString(36)}`
}

export function mistakeWorkbenchData(): MistakeWorkbenchData {
  const state = loadMistakeState()
  const matcherSettings = loadMatcherSettings()
  const revision = mistakeWorkbenchRevision()
  const settingsKey = JSON.stringify([
    matcherSettings.mistakeCustomCategories,
    matcherSettings.mistakeReviewCurves
  ])
  if (workbenchDataCache?.revision === revision && workbenchDataCache.settingsKey === settingsKey) {
    return workbenchDataCache.data
  }
  let migratedFromLegacy = 0
  // 普通 UI 刷新只读持久化快照，不再逐题 getNoteById/回读标签。完整一致性
  // 检查留给打开详情、复习写入和“刷新错题分类索引”等显式流程。
  const records = Object.values(state.records).map(stored => {
    if (stored.legacyMistakeNoteId) migratedFromLegacy++
    const automaticOptions = categoryPathPrefixes(automaticCategoryPath(stored))
    const visibleManualTags = userManualTags(stored)
    const manualOptions = visibleManualTags.map(tag => ({
      key: `manual:${tag}`,
      label: `自定义 › ${tag}`,
      depth: 0
    }))
    return {
      ...stored,
      manualCategories: visibleManualTags,
      manualCategory: visibleManualTags[0],
      noteAvailable: stored.sourceAvailable !== false,
      categoryLabel: mistakeCategoryLabel(stored),
      categoryKeys: [...automaticOptions, ...manualOptions].map(option => option.key)
    }
  }).sort(compareMistakeRecords)
  const categoryCounts = new Map<string, { key: string; name: string; depth: number; count: number }>()
  for (const record of records) {
    const options = [
      ...categoryPathPrefixes(automaticCategoryPath(record)),
      ...userManualTags(record).map(tag => ({
        key: `manual:${tag}`,
        label: `自定义 › ${tag}`,
        depth: 0
      }))
    ]
    for (const option of options) {
      const previous = categoryCounts.get(option.key)
      categoryCounts.set(option.key, {
        key: option.key,
        name: option.label,
        depth: option.depth,
        count: (previous?.count ?? 0) + 1
      })
    }
  }
  const savedCategories = cleanMistakeTags(matcherSettings.mistakeCustomCategories).filter(tag => !isManagedMistakeTag(tag))
  // workbenchData 是读函数：标签集合仅在内存中合并返回，不在此处写设置，
  // 避免面板刷新/提醒轮询触发设置写放大。
  const customCategories = Array.from(new Set([
    ...savedCategories,
    ...records.flatMap(record => userManualTags(record))
  ])).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const endToday = startToday + 86400000
  const data = {
    revision,
    records,
    dueCount: records.filter(record => record.noteAvailable && isDue(record)).length,
    todayDueCount: records.filter(record => {
      const dueAt = new Date(record.nextReviewAt).getTime()
      return record.noteAvailable && !record.reviewCompleted && dueAt >= startToday && dueAt < endToday
    }).length,
    levelCounts: [0, 1, 2].map(level => records.filter(record => record.level === level).length),
    categories: [...categoryCounts.values()],
    migratedFromLegacy,
    reviewCurves: matcherSettings.mistakeReviewCurves,
    customCategories
  }
  workbenchDataCache = { revision, settingsKey, data }
  return data
}

function mistakeWorkbenchPage(data: MistakeWorkbenchData, transferId: string, offset: number): MistakeWorkbenchPage {
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const records = data.records.slice(safeOffset, safeOffset + WORKBENCH_PAGE_SIZE)
  const consumed = safeOffset + records.length
  const recordsComplete = consumed >= data.records.length
  return {
    ...data,
    records,
    transferId,
    totalCount: data.records.length,
    nextOffset: recordsComplete ? undefined : consumed,
    recordsComplete
  }
}

/**
 * 面板只在首个桥响应中传输一页记录；剩余记录由 Web 端在首屏绘制后续传。
 * 汇总数据和完整记录快照仅计算一次，避免每页重复读取与排序。
 */
export function beginMistakeWorkbenchTransfer(): MistakeWorkbenchPage {
  const data = mistakeWorkbenchData()
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  pruneWorkbenchTransfers(now)
  workbenchTransfers.set(id, { id, createdAt: now, lastUsedAt: now, data })
  return mistakeWorkbenchPage(data, id, 0)
}

export function continueMistakeWorkbenchTransfer(transferId: string, offset: number): MistakeWorkbenchPage {
  const now = Date.now()
  for (const [id, candidate] of workbenchTransfers) {
    if (now - candidate.lastUsedAt > WORKBENCH_TRANSFER_TTL_MS) workbenchTransfers.delete(id)
  }
  const transfer = workbenchTransfers.get(transferId)
  if (!transfer) {
    throw new Error("错题数据分页已失效，请刷新")
  }
  transfer.lastUsedAt = now
  // Map 插入顺序同时作为 LRU 顺序；触达的链路移到末尾。
  workbenchTransfers.delete(transferId)
  workbenchTransfers.set(transferId, transfer)
  return mistakeWorkbenchPage(transfer.data, transfer.id, offset)
}

export async function removeMistakesByIds(recordIds: unknown): Promise<BatchMistakeChangeResult> {
  const ids = uniqueRecordIds(recordIds)
  if (!ids.length) throw new Error("请至少选择一道错题")
  const state = loadMistakeState()
  const records: MistakeRecord[] = []
  let missing = 0

  for (const recordId of ids) {
    const record = state.records[recordId]
    if (!record) {
      missing++
      continue
    }
    records.push(record)
  }

  if (records.length) {
    const buckets = new Map<string, MistakeRecord[]>()
    for (const record of records) {
      const bucket = buckets.get(record.sourceNotebookId) ?? []
      bucket.push(record)
      buckets.set(record.sourceNotebookId, bucket)
    }
    const committedIds = commitSourceTagTasks("批量取消错题", [...buckets].map(([notebookId, bucketRecords]) => ({
      notebookId,
      run: () => {
        let status: TagWriteStatus = "verified"
        for (const record of bucketRecords) {
          status = combineTagWriteStatus(status, removeSourceTags(record))
        }
        return status
      }
    })))
    const committed = new Set(committedIds)
    const removedRecords = records.filter(record => committed.has(record.sourceNotebookId))
    // 只删除标签确实被清掉的记录；未提交的学习集保留记录，避免恢复扫描复活错题。
    for (const record of removedRecords) removeMistakeRecord(state, record.recordId)
    saveMistakeState(state)
    const blocked = records.length - removedRecords.length
    if (blocked) {
      showHUD(`${blocked} 道错题取消失败：其原题学习集的标签未能写入，记录已保留`, 5)
    }
    return { changed: removedRecords.length, missing, records: removedRecords }
  }
  return { changed: 0, missing, records: [] }
}

export function saveMistakeReviewCurves(value: unknown): MistakeReviewCurves {
  const curves = normalizeMistakeReviewCurves(value)
  saveMatcherSettings({ mistakeReviewCurves: curves })
  showHUD("已保存错题复习天数；将在新标记或完成复习后生效", 4)
  return curves
}

export function setMistakeFavoriteById(recordId: string, favorite: boolean): MistakeRecord {
  const state = loadMistakeState()
  const previous = state.records[recordId]
  if (!previous) throw new Error("错题记录不存在")
  const record: MistakeRecord = {
    ...previous,
    favorite: favorite === true,
    updatedAt: new Date().toISOString()
  }
  upsertMistakeRecord(state, record)
  saveMistakeState(state)
  return record
}

/** 旧版按标题收藏：仅标题唯一时迁移，避免把同名题一起收藏。 */
export function migrateLegacyMistakeFavorites(titles: unknown): { migrated: number; ambiguous: number } {
  const cleanTitles = Array.isArray(titles)
    ? Array.from(new Set(titles.map(String).map(title => title.trim()).filter(Boolean)))
    : []
  if (!cleanTitles.length) return { migrated: 0, ambiguous: 0 }
  const state = loadMistakeState()
  const records = Object.values(state.records)
  let migrated = 0
  let ambiguous = 0
  for (const title of cleanTitles) {
    const matches = records.filter(record => record.sourceTitle === title)
    if (matches.length !== 1) {
      if (matches.length > 1) ambiguous++
      continue
    }
    const record = matches[0]
    if (record.favorite) continue
    state.records[record.recordId] = { ...record, favorite: true }
    migrated++
  }
  if (migrated) saveMistakeState(state)
  return { migrated, ambiguous }
}

function media(hash: string): string | undefined {
  try {
    const value = MN.db.getMediaByHash(hash)?.base64Encoding()
    return value ? String(value) : undefined
  } catch {
    return undefined
  }
}

/** 作用域感知的取卡解析：先查当前打开的学习集，再按需回退到目标学习集的卡片映射。 */
type ScopedNoteResolver = (notebookId: string, noteId: string) => MbBookNote | undefined

const currentDbNoteResolver: ScopedNoteResolver = (_notebookId, noteId) => MN.db.getNoteById(noteId)

function questionHtml(record: MistakeRecord, resolveNote: ScopedNoteResolver = currentDbNoteResolver): string {
  const note = resolveNote(record.sourceNotebookId, record.sourceNoteId)
  if (!note) throw new Error("原题卡片不存在或尚未同步")
  return renderCardHtml(note, "错题原题", id => resolveNote(record.sourceNotebookId, id), media, media)
}

export interface MistakeDetailData {
  record: MistakeWorkbenchRecord
  questionHtml: string
  answers: Array<{ id: string; title: string; path: string; html: string }>
  answerStatus: "ready" | "unbound" | "not-found" | "index-missing"
}

export interface MistakeQuestionData {
  questionHtml: string
}

/**
 * 待复习批量展开专用的轻量读取。
 *
 * 这里只渲染原题，不执行答案索引查询与全部答案 HTML 生成，避免“展开全部”
 * 把每一道题都升级成昂贵的完整详情请求。答案按钮仍按需走 mistakeDetail。
 */
export function mistakeQuestionById(recordId: string): MistakeQuestionData {
  const record = loadMistakeState().records[recordId]
  if (!record) throw new Error("错题记录不存在")
  return { questionHtml: questionHtml(record) }
}

/**
 * 答案候选提取的共享内核：详情视图与 AI 只读快照都从这里取答案，
 * 保证两处绑定回退、匹配与渲染规则一致（评审 C 高危项的同源要求）。
 * 答案卡片可能位于非当前学习集，渲染经 resolveNote 解析。
 */
function answerCandidatesForRecord(record: MistakeRecord, node: NodeNote, resolveNote: ScopedNoteResolver = currentDbNoteResolver): {
  answers: MistakeDetailData["answers"]
  answerStatus: MistakeDetailData["answerStatus"]
  lookupDurationMs: number
  answerHtmlDurationMs: number
} {
  const binding = answerBinding(record.sourceNotebookId, sourceMindMapInfo(node, record.sourceNotebookId).rootNodeId)
  const answerTarget = binding ?? (record.answerNotebookId
    ? { notebookId: record.answerNotebookId, rootNodeId: record.answerRootNodeId }
    : undefined)
  if (!answerTarget) return { answers: [], answerStatus: "unbound", lookupDurationMs: 0, answerHtmlDurationMs: 0 }
  try {
    const lookupStartedAt = Date.now()
    const titles = Array.from(new Set([record.sourceTitle, ...node.titles.map(title => title.trim())])).filter(Boolean)
    const matches = findAnswersForQuestion(answerTarget, node, titles, pathTitles(node))
    const lookupDurationMs = Date.now() - lookupStartedAt
    const answerHtmlStartedAt = Date.now()
    const answers = matches.map(answer => ({ id: answer.noteId, title: answer.titles[0] || "答案卡片",
      path: answer.pathTitles.filter(Boolean).join(" › "), html: answerCardHtml(answer, record.sourceTitle,
        noteId => resolveNote(answerTarget.notebookId, noteId)) }))
    const answerStatus: MistakeDetailData["answerStatus"] = answers.length ? "ready" : "not-found"
    return { answers, answerStatus, lookupDurationMs, answerHtmlDurationMs: Date.now() - answerHtmlStartedAt }
  } catch (error) {
    return { answers: [], answerStatus: String(error).includes("索引") ? "index-missing" : "not-found", lookupDurationMs: 0, answerHtmlDurationMs: 0 }
  }
}

export interface MistakeContentData {
  questionHtml: string
  answers: Array<{ id: string; title: string; path: string; html: string }>
}

export interface MistakeContentReader {
  read(recordId: string): MistakeContentData
  readQuestion(recordId: string): MistakeQuestionData
}

/**
 * AI 子系统专用的只读内容提取器（QuestionSnapshot 最小形态）：
 * 不刷新记录、不同步标签、绝不写错题库——AI 批量读取不得触发 saveMistakeState。
 *
 * MN.db.getNoteById 只覆盖当前打开的学习集；按科目批量分析针对绑定学习集，
 * 当前打开的可能不是题目所在学习集。因此卡片解析先走当前库，未命中再按
 * 学习集建立一次性 id→卡片映射（refreshIndex 同源模式），映射在读取器
 * 生命周期内缓存，一次批量分析每学习集至多构建一遍。
 */
export function createMistakeContentReader(): MistakeContentReader {
  const notebookNoteIndex = new Map<string, Map<string, MbBookNote>>()
  const resolveNote: ScopedNoteResolver = (notebookId, noteId) => {
    const current = MN.db.getNoteById(noteId)
    if (current) return current
    let index = notebookNoteIndex.get(notebookId)
    if (!index) {
      index = new Map()
      try {
        for (const note of notebookNotes(MN.db.getNotebookById(notebookId))) {
          const id = String((note as { noteId?: unknown })?.noteId ?? "").trim()
          if (id) index.set(id, note)
        }
      } catch {
        // 学习集不可读时索引保持为空，卡片按不存在处理并由失败原因统计。
      }
      notebookNoteIndex.set(notebookId, index)
    }
    return index.get(noteId)
  }
  return {
    readQuestion(recordId: string): MistakeQuestionData {
      const record = loadMistakeState().records[recordId]
      if (!record) throw new Error("错题记录不存在")
      return { questionHtml: questionHtml(record, resolveNote) }
    },
    read(recordId: string): MistakeContentData {
      const record = loadMistakeState().records[recordId]
      if (!record) throw new Error("错题记录不存在")
      const note = resolveNote(record.sourceNotebookId, record.sourceNoteId)
      if (!note) throw new Error("原题卡片不存在或尚未同步")
      const node = new NodeNote(note, record.sourceNotebookId)
      const { answers } = answerCandidatesForRecord(record, node, resolveNote)
      return { questionHtml: questionHtml(record, resolveNote), answers }
    }
  }
}

export function mistakeDetailById(recordId: string): MistakeDetailData {
  const detailStartedAt = Date.now()
  const state = loadMistakeState()
  const stored = state.records[recordId]
  if (!stored) throw new Error("错题记录不存在")
  const synced = syncManualTagsFromSource(refreshRecord(stored))
  if (synced.cancelled) {
    archiveMistakeRecords([stored])
    removeMistakeRecord(state, recordId)
    saveMistakeState(state)
    throw new Error("该错题的标签已在 MarginNote 内被移除，记录已同步取消")
  }
  const record = synced.record
  if (synced.changed) {
    upsertMistakeRecord(state, record)
    saveMistakeState(state)
  }
  const note = MN.db.getNoteById(record.sourceNoteId)
  if (!note) throw new Error("原题卡片不存在或尚未同步")
  const node = new NodeNote(note, record.sourceNotebookId)
  const { answers, answerStatus, lookupDurationMs, answerHtmlDurationMs } = answerCandidatesForRecord(record, node)
  const questionHtmlStartedAt = Date.now()
  const renderedQuestionHtml = questionHtml(record)
  const questionHtmlDurationMs = Date.now() - questionHtmlStartedAt
  const detail = {
    record: {
      ...record,
      noteAvailable: true,
      categoryLabel: mistakeCategoryLabel(record),
      categoryKeys: [
        ...categoryPathPrefixes(automaticCategoryPath(record)).map(option => option.key),
        ...userManualTags(record).map(tag => `manual:${tag}`)
      ]
    },
    questionHtml: renderedQuestionHtml,
    answers,
    answerStatus
  }
  // 分段耗时：定位"详情慢"究竟是记录解析、答案匹配还是 HTML 生成
  recordRuntimeState("桥接", "mistakeDetail 分段", `durationMs=${Date.now() - detailStartedAt} lookupMs=${lookupDurationMs} answerHtmlMs=${answerHtmlDurationMs} questionHtmlMs=${questionHtmlDurationMs} htmlBytes=${detail.questionHtml?.length || 0} answers=${answers.length} status=${answerStatus}`)
  return detail
}

export async function openSourceByMistakeId(recordId: string): Promise<{ locateHint?: string }> {
  const record = recordById(recordId)
  const locateHint = await openNoteInMindMap(record.sourceNoteId, record.sourceNotebookId)
  return locateHint ? { locateHint } : {}
}

export async function openMistakeById(recordId: string): Promise<{ locateHint?: string }> {
  return openSourceByMistakeId(recordId)
}

export async function openMistakeRecord(record: MistakeRecord): Promise<void> {
  await openNoteInMindMap(record.sourceNoteId, record.sourceNotebookId)
}

export async function openLinkedMistakeOrSource(question: NodeNote, currentNotebookId: string): Promise<void> {
  const record = mistakeRecordForSourceQuestion(question, currentNotebookId)
  if (!record) return showHUD("该卡片尚未标记为错题", 3)
  await openMistakeRecord(record)
}


// 刷新只采纳卡片事实；旧元数据不能反向创造标签或凭同名迁移身份。
export async function repairAndOrganizeMistakes(): Promise<void> {
  clearChildMapIdsCache()
  const tagScan = await recoverMistakesFromTags()
  const state = loadMistakeState()
  const scopes = answerOnlyBindingScopes(loadBindings())
  const archived: MistakeRecord[] = []
  const updates = new Map<string, MistakeRecord>()
  const legacyTagRewrites: MistakeRecord[] = []
  const migratedIds = new Set<string>()
  let missing = 0
  let unreadable = 0
  let available = 0
  for (const stored of Object.values(state.records)) {
    const note = MN.db.getNoteById(stored.sourceNoteId)
    if (!note) { missing++; updates.set(stored.recordId, { ...stored, sourceAvailable: false }); continue }
    const tags = readSourceTags(note)
    if (tags === undefined) { unreadable++; continue }
    const record = refreshRecord(stored)
    if (!mistakeStateFromSourceTags(tags).isMistake ||
        isAnswerOnlyMistakeScope(scopes, record.sourceNotebookId, record.sourceRootNodeId)) {
      archived.push(stored)
    } else {
      const refreshed = syncManualTagsFromSource(record).record
      if (stored.recordId !== refreshed.recordId) migratedIds.add(stored.recordId)
      const existing = updates.get(refreshed.recordId) ?? state.records[refreshed.recordId]
      updates.set(refreshed.recordId, existing && existing.recordId !== stored.recordId
        ? mergeIndexedRecords(existing, refreshed)
        : refreshed)
      if (hasLegacyManagedMistakeTag(tags)) legacyTagRewrites.push(refreshed)
      available++
    }
    if ((updates.size + archived.length) % 40 === 0) await delay(0.01)
  }
  // 先归档后移除；归档失败中止，避免丢失复测历史。归档不参与自动恢复。
  archiveMistakeRecords(archived)
  for (const record of archived) removeMistakeRecord(state, record.recordId)
  for (const recordId of migratedIds) removeMistakeRecord(state, recordId)
  for (const record of updates.values()) upsertMistakeRecord(state, record)
  saveMistakeState(state)
  let rewritten = 0
  if (legacyTagRewrites.length) {
    const buckets = new Map<string, MistakeRecord[]>()
    for (const record of legacyTagRewrites) {
      const bucket = buckets.get(record.sourceNotebookId) ?? []
      bucket.push(record)
      buckets.set(record.sourceNotebookId, bucket)
    }
    const committed = new Set(commitSourceTagTasks("迁移旧错题标签", [...buckets].map(([notebookId, records]) => ({
      notebookId,
      run: () => {
        let status: TagWriteStatus = "verified"
        for (const record of records) status = combineTagWriteStatus(status, applySourceTags(record))
        return status
      }
    }))))
    rewritten = legacyTagRewrites.filter(record => committed.has(record.sourceNotebookId)).length
  }
  const summary = `有效 ${available} 道，新收编 ${tagScan.added} 道，迁移旧标签 ${rewritten} 道，归档 ${archived.length} 条；原卡不可用 ${missing} 条，标签不可读 ${unreadable} 条（保留）`
  recordRuntimeState("标签整理", "按卡片标签刷新完成", summary)
  showHUD(`错题索引已整理：${summary}。`, 6)
}

export async function bindMistakeNotebook(): Promise<string | undefined> {
  showHUD("新版使用虚拟错题库，不再需要绑定或复制到总错题脑图", 5)
  return undefined
}

export async function openMistakeDirectory(): Promise<void> {
  showHUD("请打开插件窗口，在“错题浏览”中按分类查找", 4)
}

export async function openMistakeReviewCenter(): Promise<void> {
  const data = mistakeWorkbenchData()
  await popup({
    title: "错题统计",
    message: `共 ${data.records.length} 道 · 到期 ${data.dueCount} 道\n${data.levelCounts.map((count, level) => `${LEVEL_DESCRIPTIONS[level as MistakeLevel]} ${count}`).join(" · ")}`,
    buttons: ["关闭"],
    canCancel: true,
    multiLine: true
  })
}

function dueRecords(): MistakeRecord[] {
  // 提醒轮询只需要到期计数：轻量遍历记录，不跑完整 mistakeWorkbenchData
  // （那会逐条读卡解析标签、重算分类并排序）。
  const state = loadMistakeState()
  return Object.values(state.records).filter(record =>
    record.reviewCompleted !== true &&
    MN.db.getNoteById(record.sourceNoteId) !== undefined &&
    isDue(record)
  )
}

function reminderRecentlyShown(): boolean {
  try {
    return Date.now() - NSUserDefaults.standardUserDefaults().doubleForKey(LAST_REMINDER_KEY) < REMINDER_THROTTLE
  } catch {
    return false
  }
}

function rememberReminder(): void {
  try {
    const defaults = NSUserDefaults.standardUserDefaults()
    defaults.setDoubleForKey(Date.now(), LAST_REMINDER_KEY)
    defaults.synchronize()
  } catch {
    // Optional throttle only.
  }
}

export async function checkMistakeReviewReminder(): Promise<void> {
  if (reminderRecentlyShown()) return
  const due = dueRecords()
  if (!due.length) return
  rememberReminder()
  showHUD(`有 ${due.length} 道错题到期，请在错题浏览窗口中复习`, 5)
}

export function scheduleMistakeReviewReminder(): void {
  void delay(5).then(checkMistakeReviewReminder).catch(error => captureDiagnosticError(error, "错题管理"))
}

let reminderTimerGeneration = 0

export function startMistakeReminderTimer(): void {
  const generation = ++reminderTimerGeneration
  self.mistakeReminderTimer?.invalidate?.()
  self.mistakeReminderTimer = undefined
  void setTimeInterval(30 * 60, () => void checkMistakeReviewReminder())
    .then(timer => {
      // stopMistakeReminderTimer may run while the timer promise is still
      // resolving; discard the late timer instead of leaking it.
      if (reminderTimerGeneration !== generation) {
        timer?.invalidate?.()
        return
      }
      self.mistakeReminderTimer = timer
    })
    .catch(error => captureDiagnosticError(error, "错题管理"))
}

export function stopMistakeReminderTimer(): void {
  reminderTimerGeneration++
  self.mistakeReminderTimer?.invalidate?.()
  self.mistakeReminderTimer = undefined
}

export function mistakeRecordId(notebookId: string, sourceNoteId: string): string {
  return sourceRecordKey(notebookId, sourceNoteId)
}
