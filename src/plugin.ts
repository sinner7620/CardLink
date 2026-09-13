import {
  delay,
  defineEventHandlers,
  defineLifecycleHandlers,
  eventObserverController,
  genNSURL,
  HUDController,
  MN,
  NodeNote,
  popup,
  select,
  showHUD
} from "marginnote"
import { answerCandidatesForDisplay, distinctAnswers, excludeAnswerNoteId, filterSelectionToAnchorGroup } from "./domain"
import { findAnswersForQuestion } from "./answer-lookup"
import {
  createAnswerToolbar,
  destroyAnswerToolbar,
  hideAnswerToolbar,
  hideMistakeLevelDropdown,
  showAnswerToolbar,
  updateMistakeToolbarTitle,
  toggleMistakeLevelDropdown
} from "./floating-toolbar"
import {
  answerCardHtml,
  answerIndexUpdatedAt,
  answerText,
  clearIndex,
  findAnswerByReference,
  IndexedAnswer,
  refreshIndex
} from "./matcher"
import {
  answerOnlyBindingScopes,
  bindingKey,
  BindingTarget,
  RegexMatchingRules,
  getBinding,
  getBindingForMode,
  loadBindings,
    normalizeBinding,
    removeBinding,
    removeBindingScope,
    saveBindings,
  setBinding,
  targetForMode
} from "./store"
import { validateRegexMatchingRules } from "./regex-matching"
import { loadMatcherSettings, saveMatcherSettings } from "./settings"
import { isCardToolbarEnabled } from "./card-toolbar-state"
export { isCardToolbarEnabled, setCardToolbarEnabled } from "./card-toolbar-state"
import { mindMapRoot, nodeIdentifier, MAIN_MINDMAP_SCOPE_ID } from "./mindmap-scope"
import { collectChildMindMapNoteIds, mindMapScopeIdForNote } from "./mindmap-candidate"
import { buildOrderedPairingForBinding } from "./ordered-pairing"
import {
  closeAnswerCard,
  syncAnswerCandidatesControl,
  onAnswerCardPan,
  onAnswerCardResize,
  onAnswerControlPress,
  onAnswerControlRelease,
  refreshAnswerCard,
  showAnswerCard,
  syncAnswerCardWindowControlSide
} from "./answer-card-view"
import { checkForUpdates, scheduleAutomaticUpdateCheck } from "./updater"
import { scheduleTelemetryReport } from "./telemetry"
import { isMindMapNotebook, notebookNotes } from "./note-tree"
import { chooseNotebook, closeNotebookPicker, onNotebookPickerAction } from "./notebook-picker"
import { completePendingNoteNavigation, recordRuntimeState , captureDiagnosticError , maskText } from "./note-navigation"
import { describeError } from "./error-messages"
import {
  ensureMnutilsEntrance,
  onMnutilsEntranceClick,
  onMnutilsEntranceLongPress,
  onMnutilsEntrancePan,
  removeMnutilsEntrance
} from "./mnutils-entrance"
import {
  chooseMistakeLevel,
  closeMistakeLevelPicker,
  onMistakeLevelPickerAction
} from "./level-picker"
import {
  bindMistakeNotebook,
  legacyMistakeTagMigrationCompleted,
  rememberLegacyMistakeTagMigration,
  markQuestionAsMistake,
  markQuestionsAsMistakes,
  mistakeAnswerContext,
  mistakeRecordForSourceQuestion,
  openLinkedMistakeOrSource,
  openMistakeDirectory,
  openMistakeRecord,
  openMistakeReviewCenter,
  repairAndOrganizeMistakes,
  scheduleMistakeReviewReminder,
  startMistakeReminderTimer,
  stopMistakeReminderTimer
} from "./mistake-manager"

declare const PopupMenu: {
  currentMenu(): {
    visible?: boolean
    targetWinRect?: { x: number; y: number; width: number; height: number }
  } | undefined
}

const events = ["PopupMenuOnNote", "ClosePopupMenuOnNote"] as const
export const eventObservers = eventObserverController([...events])
const FORMAL_BETA_CONFLICT_NOTICE_KEY = "marginnote.extension.mn4-answer-matcher.formal-beta-conflict-notice.v1"

async function remindFormalBetaConflict(): Promise<void> {
  // 渠道看构建配置而非版本号：正式项目内 2.3.3-beta.N 版本号也属于正式渠道，
  // 需要继续提醒关闭旧独立 Beta，避免两套插件同时处理同一数据。
  if (__MN_CHANNEL__ !== "stable") return
  try {
    const defaults = NSUserDefaults.standardUserDefaults()
    if (defaults.boolForKey(FORMAL_BETA_CONFLICT_NOTICE_KEY)) return
    await delay(0.6)
    await popup({
      title: "正式版不能与 Beta 版同时启用",
      message:
        "正式版与 Beta 版会访问同一套答案绑定和错题数据。请先在 MarginNote 插件管理中关闭或卸载“CardLink Beta”，然后只保留当前正式版。两版同时启用可能造成重复处理和界面冲突。",
      buttons: ["我已了解"],
      canCancel: false,
      multiLine: true
    })
    defaults.setObjectForKey(true, FORMAL_BETA_CONFLICT_NOTICE_KEY)
    defaults.synchronize()
  } catch (error) {
    captureDiagnosticError(error, "生命周期", "正式版/Beta 共存提醒失败")
  }
}

function currentNotebookId(): string | undefined {
  return MN.currnetNotebookId
}

function notebookTitle(notebookId: string): string {
  return MN.db.getNotebookById(notebookId)?.title?.trim() || "未命名脑图"
}

function selectedQuestions(): NodeNote[] {
  // 面板可能在脑图视图就绪前启动（如冷启动自动恢复后立即刷新桥接）：
  // 此时没有脑图选择，getSelectedNodes 会访问未就绪的 mindmapView.selViewLst
  // 并抛出 JS 异常导致整个 dashboard 失败——按语义返回空选择。
  const selected = MN.notebookController?.mindmapView ? NodeNote.getSelectedNodes() : []
  if (selected.length) return selected
  if (self.lastClickedNote) return [new NodeNote(self.lastClickedNote)]
  const focus = MN.notebookController?.focusNote
  return focus ? [new NodeNote(focus)] : []
}

function selectedQuestion(): NodeNote | undefined {
  return selectedQuestions()[0]
}

function selectedMistakeQuestions(notebookId: string): NodeNote[] {
  const selected = selectedQuestions()
  if (!selected.length) return selected

  // MarginNote can retain selections in two mind maps shown in the same study
  // set. The side button belongs to one card, so that card is the selection
  // anchor; cards still selected in the bound answer map must not become
  // mistakes as a side effect.
  const anchorNoteId = String(
    self.answerToolbarNoteId ?? self.lastClickedNote?.noteId ?? MN.notebookController?.focusNote?.noteId ?? ""
  ).trim()
  const anchor = selected.find(node => String(node.note?.noteId ?? "").trim() === anchorNoteId) ?? selected[0]
  const anchorRootId = nodeIdentifier(mindMapRoot(anchor))
  const answerOnlyScopes = answerOnlyBindingScopes(loadBindings())
  if (answerOnlyScopes.has(notebookId) || answerOnlyScopes.has(bindingKey(notebookId, anchorRootId))) {
    return []
  }
  const sameMindMap = filterSelectionToAnchorGroup(
    selected,
    anchor,
    node => nodeIdentifier(mindMapRoot(node))
  )

  const sourceRootNodeId = sourceMindMapId(notebookId, anchor)
  const storedTarget = bindingForSource(notebookId, sourceRootNodeId)
  const answerTarget = storedTarget && effectiveAnswerTarget(storedTarget)
  if (!answerTarget || answerTarget.notebookId !== notebookId) return sameMindMap

  return sameMindMap.filter(node => {
    if (node === anchor) return true
    try {
      const noteId = String(node.note?.noteId ?? "").trim()
      return !findAnswerByReference(answerTarget, noteId, nodeIdentifier(node))
    } catch {
      // A missing/stale answer index must not block legitimate mistake marking;
      // the mind-map boundary above still prevents the reported cross-map leak.
      return true
    }
  })
}

function parsePopupWinRect(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (typeof value !== "string") return
  try {
    const values = JSON.parse(`[${value.replace(/[{}]/g, "")}]`) as number[]
    if (values.length !== 4 || values.some(item => !Number.isFinite(item))) return
    return { x: values[0], y: values[1], width: values[2], height: values[3] }
  } catch {
    return
  }
}

function samePopupTarget(
  expected: { x: number; y: number; width: number; height: number } | undefined,
  actual: { x: number; y: number; width: number; height: number } | undefined
): boolean {
  if (!expected || !actual) return false
  const tolerance = 2
  return Math.abs(expected.x - actual.x) <= tolerance &&
    Math.abs(expected.y - actual.y) <= tolerance &&
    Math.abs(expected.width - actual.width) <= tolerance &&
    Math.abs(expected.height - actual.height) <= tolerance
}

function isCurrentNotePopupStillVisible(): boolean {
  try {
    const menu = PopupMenu.currentMenu()
    if (!menu?.visible) return false

    const expectedTarget = self.answerToolbarTargetRect as
      | { x: number; y: number; width: number; height: number }
      | undefined
    if (samePopupTarget(expectedTarget, menu.targetWinRect)) return true

    // targetWinRect should normally identify the current note popup. The
    // focus-note fallback covers MarginNote builds where that rect is briefly
    // unavailable while the new popup is being installed.
    const focus = MN.notebookController?.visibleFocusNote ?? MN.notebookController?.focusNote
    const focusNoteId = focus?.noteId
    return Boolean(focusNoteId && self.answerToolbarNoteId && focusNoteId === self.answerToolbarNoteId)
  } catch {
    return false
  }
}

interface MindMapCandidate extends BindingTarget {
  title: string
}

function mindMapTitle(node: NodeNote): string {
  return node.title?.trim() || "未命名脑图"
}

function childMapIdsForNotebook(notebookId: string): string[] {
  const notebook = MN.db.getNotebookById(notebookId)
  return notebook ? collectChildMindMapNoteIds(notebookNotes(notebook)) : []
}

function sourceMindMap(
  notebookId = currentNotebookId(),
  question = selectedQuestion()
): { notebookId: string; rootNodeId: string; title: string } | undefined {
  if (!notebookId || !question) return undefined
  const rootNodeId = mindMapScopeIdForNote(question.note, childMapIdsForNotebook(notebookId))
  if (rootNodeId === MAIN_MINDMAP_SCOPE_ID) return { notebookId, rootNodeId, title: "主脑图" }
  const rootNote = MN.db.getNoteById(rootNodeId)
  if (rootNote) {
    try {
      return { notebookId, rootNodeId, title: mindMapTitle(new NodeNote(rootNote, notebookId)) }
    } catch {
      // Fall through to the selected note title if the child-map root is damaged.
    }
  }
  return { notebookId, rootNodeId, title: question.title?.trim() || "未命名子脑图" }
}

function sourceMindMapId(notebookId: string, question: NodeNote): string {
  return sourceMindMap(notebookId, question)?.rootNodeId ?? nodeIdentifier(mindMapRoot(question))
}

async function mindMapCandidates(notebookId: string): Promise<MindMapCandidate[]> {
  const notebook = MN.db.getNotebookById(notebookId)
  if (!notebook) return []
  const notebookName = notebook.title?.trim() || "未命名学习集"
  const candidates: MindMapCandidate[] = [{
    notebookId,
    rootNodeId: MAIN_MINDMAP_SCOPE_ID,
    rootTitle: "主脑图",
    title: `${notebookName} › 主脑图`
  }]
  const childMapIds = collectChildMindMapNoteIds(notebookNotes(notebook))
  for (let index = 0; index < childMapIds.length; index++) {
    const rootNodeId = childMapIds[index]
    const rootNote = MN.db.getNoteById(rootNodeId)
    let rootTitle = "未命名子脑图"
    if (rootNote) {
      try {
        rootTitle = mindMapTitle(new NodeNote(rootNote, notebookId))
      } catch (error) {
        captureDiagnosticError(error, "生命周期")
      }
    }
    candidates.push({
      notebookId,
      rootNodeId,
      rootTitle,
      title: `${notebookName} › ${rootTitle}`
    })
    if (index % 80 === 79) await delay(0.01)
  }
  return candidates
}

function targetTitle(target: BindingTarget): string {
  if (!target.rootNodeId) return notebookTitle(target.notebookId)
  return `${notebookTitle(target.notebookId)} › ${target.rootTitle || "已绑定脑图"}`
}

function scopedBindingEnabled(): boolean {
  return loadMatcherSettings().allowSameStudySetMindMap
}

function bindingForSource(notebookId: string, rootNodeId?: string): BindingTarget | undefined {
  return getBindingForMode(loadBindings(), notebookId, rootNodeId, scopedBindingEnabled())
}

function effectiveAnswerTarget(target: BindingTarget): BindingTarget {
  return targetForMode(target, scopedBindingEnabled())
}

function matchingModeLabel(target?: BindingTarget): string {
  if (target?.matchMode === "parent-order") {
    return `章节顺序配对（${target.orderedPairing?.pairs.length ?? 0} 张）`
  }
  if (target?.matchMode === "regex") return "正则规则匹配"
  return "完整标题匹配"
}

/**
 * 统一选择器：Mac 走系统选择器（chooseNotebook），iPad 走编号 select。
 * 三处绑定/候选选择此前各写一遍双分支样板，收敛到此。
 */
async function pickFromList<T>(items: T[], options: {
  title: (item: T, index: number) => string
  selectTitle: string
  selectMessage: string
}): Promise<T | undefined> {
  if (!items.length) return undefined
  if (MN.isMac) {
    const selected = await chooseNotebook(items.map((item, index) => ({
      id: String(index),
      title: options.title(item, index)
    })))
    if (!selected) return undefined
    return items[Number(selected.id)]
  }
  const result = await select(
    items.map((item, index) => `${index + 1}. ${options.title(item, index)}`),
    options.selectTitle,
    options.selectMessage,
    true
  )
  return result.index >= 0 ? items[result.index] : undefined
}

async function bindAnswerStudySet(questionNotebookId: string): Promise<void> {
  const notebooks = (MN.db.allNotebooks() ?? []).filter(
    item => item.topicId && item.topicId !== questionNotebookId && isMindMapNotebook(item)
  )
  if (!notebooks.length) return showHUD("没有可绑定的其他学习集")
  const selected = await pickFromList(notebooks, {
    title: item => item.title?.trim() || "未命名学习集",
    selectTitle: "绑定答案学习集",
    selectMessage: "将索引所选学习集内的全部卡片"
  })
  if (!selected) return
  const answerNotebookId = selected.topicId!
  const bindings = loadBindings()
  bindings[questionNotebookId] = answerNotebookId
  saveBindings(bindings)
  HUDController.show("正在建立答案索引，请稍候…")
  await delay(0.08)
  let refreshResult
  try {
    refreshResult = await refreshIndex(answerNotebookId)
  } finally {
    HUDController.hidden()
  }
  const warning = refreshResult.brokenLinks || refreshResult.skippedCards
    ? `；忽略 ${refreshResult.brokenLinks} 个失效引用、${refreshResult.skippedCards} 张异常卡片`
    : ""
  showHUD(`已绑定「${notebookTitle(answerNotebookId)}」，索引全部 ${refreshResult.indexedCards} 张卡片${warning}`, 4)
}

export async function bindAnswerNotebook(
  targetQuestionNotebookId?: string,
  targetQuestion?: NodeNote
): Promise<void> {
  const questionNotebookId = targetQuestionNotebookId ?? currentNotebookId()
  if (!questionNotebookId) return showHUD("请先打开题目脑图")
  if (!scopedBindingEnabled()) return bindAnswerStudySet(questionNotebookId)
  const source = sourceMindMap(questionNotebookId, targetQuestion ?? selectedQuestion())
  if (!source) return showHUD("请先选中当前题目脑图中的任一卡片")
  const notebooks = (MN.db.allNotebooks() ?? []).filter(
    item => item.topicId && isMindMapNotebook(item)
  )
  if (!notebooks.length) return showHUD("没有可绑定的学习集")

  // Mac/iPad 标注文案统一为「（当前）」
  const selected = await pickFromList(notebooks, {
    title: item => item.topicId === source.notebookId
      ? `${item.title?.trim() || "未命名学习集"}（当前）`
      : item.title?.trim() || "未命名学习集",
    selectTitle: "选择答案所在学习集",
    selectMessage: "答案脑图可以位于当前学习集"
  })
  if (!selected) return
  const targetNotebookId = selected.topicId!

  HUDController.show("正在读取该学习集的脑图，请稍候…")
  await delay(0.05)
  let scanned: MindMapCandidate[]
  try {
    scanned = await mindMapCandidates(targetNotebookId)
  } finally {
    HUDController.hidden()
  }
  const candidates = scanned.filter(
    item => item.notebookId !== source.notebookId || item.rootNodeId !== source.rootNodeId
  )
  if (!candidates.length) return showHUD("没有可绑定的其他脑图")

  const target = await pickFromList(candidates, {
    title: item => item.title,
    selectTitle: "绑定答案脑图",
    selectMessage: "请选择与当前题目脑图对应的答案脑图"
  })
  if (!target) return
  const bindings = loadBindings()
  setBinding(bindings, source.notebookId, source.rootNodeId, {
    notebookId: target.notebookId,
    rootNodeId: target.rootNodeId,
    rootTitle: target.rootTitle
  })
  saveBindings(bindings)
  HUDController.show("正在建立答案索引，请稍候…")
  await delay(0.08)
  let refreshResult
  try {
    refreshResult = await refreshIndex(target)
  } finally {
    HUDController.hidden()
  }
  const warning = refreshResult.brokenLinks || refreshResult.skippedCards
    ? `；忽略 ${refreshResult.brokenLinks} 个失效引用、${refreshResult.skippedCards} 张异常卡片`
    : ""
  showHUD(`已绑定「${target.title}」，索引 ${refreshResult.indexedCards} 张卡片${warning}`, 4)
}

function issuePreview(
  issues: ReturnType<typeof buildOrderedPairingForBinding>["issues"]
): string {
  if (!issues.length) return ""
  const lines = issues.slice(0, 8).map(issue => {
    if (issue.reason === "count") {
      return `• ${issue.title}：题目 ${issue.sourceCount} / 答案 ${issue.answerCount}`
    }
    if (issue.reason === "ambiguous") return `• ${issue.title}：存在重名父节点`
    return `• ${issue.title}：答案侧没有同名父节点`
  })
  const remaining = issues.length - lines.length
  return `\n\n未自动配对：\n${lines.join("\n")}${remaining > 0 ? `\n• 另有 ${remaining} 个父节点` : ""}`
}

function pairPreview(
  previews: ReturnType<typeof buildOrderedPairingForBinding>["previews"]
): string {
  const lines = previews.slice(0, 6).map(item =>
    `• ${item.parentTitle} 第 ${item.position + 1} 张：` +
    `${item.questionTitle || "未命名题目"} → ${item.answerTitle || "未命名答案"}`
  )
  const remaining = previews.length - lines.length
  return lines.length
    ? `\n\n配对预览：\n${lines.join("\n")}${remaining > 0 ? `\n• 另有 ${remaining} 组配对` : ""}`
    : ""
}

export interface AnswerMatchingSettingsData {
  mode: "title" | "parent-order" | "regex"
  label: string
  bound: boolean
  scopedBinding: boolean
  pairs: number
  matchedGroups: number
  regexRules: RegexMatchingRules
  debugModeEnabled: boolean
}

export function answerMatchingSettingsData(): AnswerMatchingSettingsData {
  const settings = loadMatcherSettings()
  const notebookId = currentNotebookId()
  const source = sourceMindMap()
  const target = notebookId ? bindingForSource(notebookId, source?.rootNodeId) : undefined
  return {
    mode: target?.matchMode === "parent-order"
      ? "parent-order"
      : target?.matchMode === "regex"
        ? "regex"
        : "title",
    label: matchingModeLabel(target),
    bound: Boolean(target),
    scopedBinding: settings.allowSameStudySetMindMap,
    pairs: target?.orderedPairing?.pairs.length ?? 0,
    matchedGroups: target?.orderedPairing?.matchedGroups ?? 0,
    regexRules: target?.regexRules ?? {
      questionPattern: "",
      answerPattern: ""
    },
    debugModeEnabled: settings.debugModeEnabled
  }
}

function saveMatchingTarget(
  bindings: ReturnType<typeof loadBindings>,
  questionNotebookId: string,
  sourceRootNodeId: string | undefined,
  target: BindingTarget
): void {
  if (scopedBindingEnabled()) {
    if (!sourceRootNodeId) throw new Error("请先选中当前题目脑图中的任一卡片")
    setBinding(bindings, questionNotebookId, sourceRootNodeId, target)
  } else {
    bindings[questionNotebookId] = target
  }
  saveBindings(bindings)
}

export function saveRegexMatchingRules(
  questionPattern: string,
  answerPattern: string
): { saved: true; mode: "regex" } {
  const questionNotebookId = currentNotebookId()
  if (!questionNotebookId) throw new Error("请先打开题目脑图")
  const source = sourceMindMap()
  if (scopedBindingEnabled() && !source) {
    throw new Error("请先选中当前题目脑图中的任一卡片")
  }
  const bindings = loadBindings()
  const target = getBindingForMode(
    bindings,
    questionNotebookId,
    source?.rootNodeId,
    scopedBindingEnabled()
  )
  if (!target) throw new Error("请先绑定答案脑图")
  const regexRules = {
    questionPattern: String(questionPattern ?? "").trim(),
    answerPattern: String(answerPattern ?? "").trim()
  }
  const validation = validateRegexMatchingRules(regexRules)
  if (!validation.valid) throw new Error(validation.error || "正则规则无效")
  saveMatchingTarget(bindings, questionNotebookId, source?.rootNodeId, {
    ...target,
    matchMode: "regex",
    regexRules
  })
  showHUD("已保存并启用独立正则规则匹配", 4)
  notifyWorkbenchDataChanged()
  return { saved: true, mode: "regex" }
}

export function setScopedBindingEnabled(enabled: boolean): void {
  saveMatcherSettings({ allowSameStudySetMindMap: enabled })
  showHUD(
    enabled
      ? "已开启：可为每个题目脑图绑定具体答案脑图，包括同一学习集内的脑图"
      : "已关闭：恢复按整个答案学习集绑定",
    4
  )
  notifyWorkbenchDataChanged()
}

export async function configureAnswerMatching(): Promise<void> {
  const questionNotebookId = currentNotebookId()
  if (!questionNotebookId) return showHUD("请先打开题目脑图")
  const source = sourceMindMap()
  if (scopedBindingEnabled() && !source) {
    return showHUD("请先选中当前题目脑图中的任一卡片")
  }
  const bindings = loadBindings()
  const currentTarget = getBindingForMode(
    bindings,
    questionNotebookId,
    source?.rootNodeId,
    scopedBindingEnabled()
  )
  if (!currentTarget) return showHUD("请先绑定答案脑图")
  const mode = await select(
    [
      "完整标题匹配（默认）",
      "父节点标题匹配＋子卡片顺序",
      "独立正则规则匹配"
    ],
    "设置答案匹配方式",
    `当前：${matchingModeLabel(currentTarget)}`,
    true
  )
  if (mode.index < 0) return
  if (mode.index === 0) {
    const { matchMode: _mode, orderedPairing: _pairing, ...base } = currentTarget
    saveMatchingTarget(bindings, questionNotebookId, source?.rootNodeId, {
      ...base,
      matchMode: "title"
    })
    showHUD("已切换为完整标题匹配")
    notifyWorkbenchDataChanged()
    return
  }
  if (mode.index === 2) {
    saveMatchingTarget(bindings, questionNotebookId, source?.rootNodeId, {
      ...currentTarget,
      matchMode: "regex"
    })
    showHUD(
      currentTarget.regexRules
        ? "已切换为独立正则规则匹配"
        : "已选择正则规则匹配，请在工作台设置中填写题目规则和答案规则",
      4
    )
    notifyWorkbenchDataChanged()
    return
  }
  if (!scopedBindingEnabled()) {
    const confirmation = await popup({
      title: "需要具体脑图绑定",
      message:
        "“父节点标题＋子卡片顺序”需要把题目脑图绑定到一棵具体的答案脑图。是否现在开启具体脑图绑定？",
      buttons: ["取消", "开启"],
      canCancel: true
    })
    if (confirmation.buttonIndex === 1) {
      setScopedBindingEnabled(true)
      showHUD("已开启具体脑图绑定，请先绑定或更换答案脑图", 4)
    }
    return
  }
  if (!source || !currentTarget.rootNodeId) return showHUD("请先绑定具体答案脑图")
  HUDController.show("正在分析两个脑图的父节点与子卡片顺序…")
  await delay(0.05)
  let result: ReturnType<typeof buildOrderedPairingForBinding>
  try {
    result = buildOrderedPairingForBinding(
      questionNotebookId,
      source.rootNodeId,
      currentTarget
    )
  } finally {
    HUDController.hidden()
  }
  if (!result.pairing.pairs.length) {
    return popup({
      title: "没有可安全配对的章节",
      message: `没有找到“父标题唯一且两侧子卡片数量相同”的章节。${issuePreview(result.issues)}`,
      buttons: ["知道了"],
      canCancel: true,
      multiLine: true
    }).then(() => undefined)
  }
  const confirmation = await popup({
    title: "确认启用章节顺序配对",
    message:
      `找到 ${result.pairing.matchedGroups} 个对应父节点，可固定配对 ${result.pairing.pairs.length} 张卡片。\n` +
      "父标题会忽略“第几部分/章/节”等前缀，并允许唯一的包含匹配；只有两侧直接子卡片数量相同的章节会参与，其他章节继续回退到完整标题匹配。" +
      pairPreview(result.previews) +
      issuePreview(result.issues),
    buttons: ["取消", "启用并固定配对"],
    canCancel: true,
    multiLine: true
  })
  if (confirmation.buttonIndex !== 1) return

  HUDController.show("正在刷新答案索引并保存固定配对…")
  await delay(0.05)
  try {
    await refreshIndex(currentTarget)
  } finally {
    HUDController.hidden()
  }
  setBinding(bindings, questionNotebookId, source.rootNodeId, {
    ...currentTarget,
    matchMode: "parent-order",
    orderedPairing: result.pairing
  })
  saveBindings(bindings)
  showHUD(
    `已启用章节顺序配对：${result.pairing.matchedGroups} 个父节点，${result.pairing.pairs.length} 张卡片`,
    4
  )
  notifyWorkbenchDataChanged()
}

function debugObjectKeys(value: any): string {
  try {
    return value && typeof value === "object" ? Object.keys(value).slice(0, 40).join(",") : ""
  } catch (error) {
    return `读取失败:${String(error)}`
  }
}

function debugBridgeValue(value: any, key: string, method: "valueForKey" | "objectForKey"): unknown {
  try {
    return typeof value?.[method] === "function" ? value[method](key) : undefined
  } catch {
    return undefined
  }
}

function debugTextLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0
}

function debugId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function recordAnswerCardDiagnostics(questionTitle: string, answer: IndexedAnswer): void {
  // 诊断含逐条评论扫描与 DB 查询（最多 40 条 LinkNote × 2 次查询），仅在调试模式下执行，
  // 避免每次展示答案都付出与渲染无关的查询成本。
  if (!loadMatcherSettings().debugModeEnabled) return
  try {
    const note = MN.db.getNoteById(answer.noteId)
    recordRuntimeState(
      "答案匹配",
      "准备渲染答案卡片",
      `question=${maskText(questionTitle)} answerNoteId=${answer.noteId} answerNodeId=${answer.id} answerExists=${Boolean(note)}`
    )
    if (!note) return

    let comments: any[] = []
    try {
      comments = Array.from((note as any).comments ?? [])
    } catch (error) {
      recordRuntimeState("答案匹配", "读取 comments 失败", `answerNoteId=${answer.noteId} error=${String(error)}`)
      return
    }

    let childCount = -1
    try {
      childCount = Array.from((note as any).childNotes ?? []).length
    } catch {
      childCount = -1
    }
    recordRuntimeState(
      "答案匹配",
      "答案卡片结构",
      `answerNoteId=${answer.noteId} title=${maskText((note as any).noteTitle)} comments=${comments.length}` +
        ` childNotes=${childCount} excerptPic=${Boolean((note as any).excerptPic)}` +
        ` excerptTextLength=${debugTextLength((note as any).excerptText)}`
    )

    comments.slice(0, 40).forEach((comment, index) => {
      let type = ""
      try {
        type = String(comment?.type ?? "")
      } catch {
        type = "(读取失败)"
      }
      const noteid = debugId(comment?.noteid)
      recordRuntimeState(
        "答案匹配",
        `comment#${index + 1}`,
        `type=${type || "(空)"} noteid=${noteid || "(空)"} keys=${debugObjectKeys(comment) || "(无)"}`
      )
      if (type !== "LinkNote") return

      const directText = comment?.q_htext
      const kvcText = debugBridgeValue(comment, "q_htext", "valueForKey")
      const objectText = debugBridgeValue(comment, "q_htext", "objectForKey")
      const directPic = comment?.q_hpic
      const kvcPic = debugBridgeValue(comment, "q_hpic", "valueForKey")
      const objectPic = debugBridgeValue(comment, "q_hpic", "objectForKey")
      const pic = directPic ?? kvcPic ?? objectPic
      const directPaint = pic?.paint
      const kvcPaint = debugBridgeValue(pic, "paint", "valueForKey")
      const objectPaint = debugBridgeValue(pic, "paint", "objectForKey")
      const paint = debugId(directPaint) || debugId(kvcPaint) || debugId(objectPaint)
      let mediaExists = false
      if (paint) {
        try {
          mediaExists = Boolean(MN.db.getMediaByHash(paint))
        } catch {
          mediaExists = false
        }
      }
      let linkedExists = false
      if (noteid) {
        try {
          linkedExists = Boolean(MN.db.getNoteById(noteid))
        } catch {
          linkedExists = false
        }
      }
      recordRuntimeState(
        "答案匹配",
        `LinkNote#${index + 1}`,
        `commentKVC=${typeof comment?.valueForKey === "function"} commentObjectForKey=${typeof comment?.objectForKey === "function"}` +
          ` directTextLength=${debugTextLength(directText)}` +
          ` kvcTextLength=${debugTextLength(kvcText)} objectTextLength=${debugTextLength(objectText)}` +
          ` directPic=${Boolean(directPic)} kvcPic=${Boolean(kvcPic)} objectPic=${Boolean(objectPic)}` +
          ` picKVC=${typeof pic?.valueForKey === "function"} picObjectForKey=${typeof pic?.objectForKey === "function"}` +
          ` picKeys=${debugObjectKeys(pic) || "(无)"}` +
          ` directPaintExists=${Boolean(debugId(directPaint))}` +
          ` kvcPaintExists=${Boolean(debugId(kvcPaint))} objectPaintExists=${Boolean(debugId(objectPaint))}` +
          ` mediaExists=${mediaExists} linkedNoteExists=${linkedExists}`
      )
    })
  } catch (error) {
    recordRuntimeState("答案匹配", "答案卡片诊断失败", `answerNoteId=${answer.noteId} error=${String(error)}`)
  }
}

async function showAnswer(questionTitle: string, answer: IndexedAnswer, candidates: IndexedAnswer[] = []): Promise<void> {
  recordAnswerCardDiagnostics(questionTitle, answer)
  // 候选清单与题名存到 addon 上：点击长条后由 MarginNote 原生 select 弹窗选择。
  self.answerCardCandidates = candidates
  self.answerCardQuestionTitle = questionTitle
  showAnswerCard(answerCardHtml(answer, questionTitle))
  syncAnswerCandidatesControl(
    candidates.map(candidate => ({
      id: candidate.id,
      title: candidate.titles[0] || "未命名卡片",
      standard: candidate.tags.some(tag => tag === "标准答案")
    })),
    candidates.findIndex(candidate => candidate.id === answer.id)
  )
}

/** 候选长条点击：复用 beta.61 的 MarginNote 原生多答案选择弹窗。 */
export async function onChooseAnswerCandidate(): Promise<void> {
  await runSafely(async () => {
    const candidates = distinctAnswers((self.answerCardCandidates || []) as IndexedAnswer[])
    if (candidates.length < 2) return
    const options = candidates.map((candidate, index) => {
      const standard = candidate.tags.some(tag => tag === "标准答案") ? " ★标准答案" : ""
      const path = [...candidate.pathTitles].reverse().join(" / ")
      const preview = answerText(candidate).replace(/\s+/g, " ").slice(0, 42)
      return `${index + 1}. ${path ? `${path} / ` : ""}${candidate.titles[0] || "未命名卡片"}${standard}${preview ? ` · ${preview}` : ""}`
    })
    const selected = await select(
      options,
      `找到 ${candidates.length} 个答案`,
      "请选择要展示的答案卡片",
      true
    )
    const answer = candidates[selected.index]
    if (answer) await showAnswer(self.answerCardQuestionTitle || "", answer, candidates)
  })
}

/** 插件使用说明网页入口。 */
export const PLUGIN_GUIDE_URL = "https://my.feishu.cn/wiki/VZgUw4yvSizKWFkMEvecctXvn2g"

export async function openPluginGuide(): Promise<{ opened: boolean }> {
  if (!PLUGIN_GUIDE_URL) {
    showHUD("插件说明链接尚未配置", 3)
    return { opened: false }
  }
  try {
    MN.app.openURL(genNSURL(PLUGIN_GUIDE_URL, true))
    return { opened: true }
  } catch (error) {
    recordRuntimeState("插件", "打开说明网页失败", String(error))
    showHUD(`打开说明网页失败：${describeError(error)}`, 3)
    return { opened: false }
  }
}

export function onCloseAnswerCard(): void {
  closeAnswerCard()
}

export function onRefreshAnswerCard(): void {
  refreshAnswerCard()
}

export function onPanelCloseButtonSideChanged(side: unknown): void {
  syncAnswerCardWindowControlSide(side)
}

export { onAnswerCardPan, onAnswerCardResize, onAnswerControlPress, onAnswerControlRelease }
export { onNotebookPickerAction }
export { onMistakeLevelPickerAction }

interface AnswerLookupContext {
  questionNotebookId: string
  question: NodeNote
  lookupQuestion: NodeNote
  mistakeContext: ReturnType<typeof mistakeAnswerContext> | undefined
  sourceNotebookId: string
  sourceRootNodeId: string
  answerTarget: BindingTarget | undefined
  questionTitle: string
  titles: string[]
  path: string[]
}

/**
 * 答案查找与工作台共用的上下文装配（评审 C 高危项）：
 * 错题上下文解析 → 存储目标解析（含错题记录回退）→ 标题/路径归一。
 * 此前两处各写一遍，规则漂移会导致"工具栏能查到、工作台查不到"。
 */
function resolveAnswerLookupContext(): ({ error: string; context?: undefined } | { error?: undefined } & AnswerLookupContext) {
  const questionNotebookId = currentNotebookId()
  if (!questionNotebookId) return { error: "请先打开题目脑图" }
  const question = selectedQuestion()
  if (!question) return { error: "请先选中一张题目卡片" }
  const mistakeContext = mistakeAnswerContext(question, questionNotebookId)
  const lookupQuestion = mistakeContext?.sourceQuestion ?? question
  const sourceNotebookId = mistakeContext?.record.sourceNotebookId ?? questionNotebookId
  const sourceRootNodeId = sourceMindMapId(sourceNotebookId, lookupQuestion)
  const storedTarget = bindingForSource(sourceNotebookId, sourceRootNodeId) ??
    (mistakeContext?.record.answerNotebookId
      ? {
          notebookId: mistakeContext.record.answerNotebookId,
          rootNodeId: mistakeContext.record.answerRootNodeId
        }
      : undefined)
  const questionTitle = question.title?.trim() || "未命名题目"
  let titles = [questionTitle]
  let path: string[] = mistakeContext?.record.sourcePathTitles ?? []
  try {
    titles = Array.from(new Set([questionTitle, ...lookupQuestion.titles.map(title => title.trim())])).filter(Boolean)
    path = lookupQuestion.ancestorNodes.map(node => node.title?.trim()).filter(Boolean) as string[]
  } catch {
    // 已迁移错题卡使用存储里的来源元数据兜底
  }
  return {
    questionNotebookId,
    question,
    lookupQuestion,
    mistakeContext,
    sourceNotebookId,
    sourceRootNodeId,
    answerTarget: storedTarget && effectiveAnswerTarget(storedTarget),
    questionTitle,
    titles,
    path
  }
}

function answerNoteExists(answer: IndexedAnswer): boolean {
  // 桥接查询异常时按存在处理：瞬时错误不应误判为卡片失效。
  try {
    return Boolean(MN.db.getNoteById(answer.noteId))
  } catch {
    return true
  }
}

export async function findCurrentAnswer(allowIndexRetry = true): Promise<void> {
  const resolved = resolveAnswerLookupContext()
  if (resolved.error !== undefined) return showHUD(resolved.error)
  const { questionNotebookId, lookupQuestion, mistakeContext } = resolved
  const bindingSourceNotebookId = resolved.sourceNotebookId
  const sourceRootNodeId = resolved.sourceRootNodeId
  const questionTitle = resolved.questionTitle
  recordRuntimeState(
    "答案匹配",
    "开始查找答案",
    `questionNoteId=${String(lookupQuestion.note?.noteId ?? "")} questionTitle=${lookupQuestion.title?.trim() || ""}` +
      ` sourceNotebookId=${bindingSourceNotebookId} sourceRootNodeId=${sourceRootNodeId}`
  )
  const answerTarget = resolved.answerTarget
  if (!answerTarget) {
    recordRuntimeState(
      "答案匹配",
      "未找到答案绑定",
      `sourceNotebookId=${bindingSourceNotebookId} sourceRootNodeId=${sourceRootNodeId}`
    )
    const shouldBind = await popup({
      title: "尚未绑定答案脑图",
      message: mistakeContext
        ? `原题脑图「${mistakeContext.record.sourceNotebookTitle}」还没有对应的答案脑图。`
        : "当前脑图还没有对应的答案脑图。",
      buttons: ["取消", "立即绑定"],
      canCancel: true
    })
    if (shouldBind.buttonIndex === 1) await bindAnswerNotebook(bindingSourceNotebookId, lookupQuestion)
    return
  }

  const rawMatches = findAnswersForQuestion(
    answerTarget,
    lookupQuestion,
    resolved.titles,
    resolved.path
  )
  const questionNoteId = String(lookupQuestion.note?.noteId ?? "").trim()
  const matches = distinctAnswers(excludeAnswerNoteId(rawMatches, questionNoteId))
  recordRuntimeState(
    "答案匹配",
    "匹配结果",
    `targetNotebookId=${answerTarget.notebookId} targetRootNodeId=${answerTarget.rootNodeId || "(整个学习集)"}` +
      ` mode=${answerTarget.matchMode || "title"} rawMatchCount=${rawMatches.length} matchCount=${matches.length}` +
      ` filteredSelf=${rawMatches.length - matches.length}` +
      ` matches=${matches.slice(0, 12).map(item => `${item.noteId}:${item.titles[0] || "未命名"}`).join("|") || "(无)"}`
  )
  if (!matches.length) {
    const notFoundMessage = answerTarget.matchMode === "parent-order"
      ? `当前卡片没有固定顺序配对，也未找到同标题答案：${questionTitle}`
      : answerTarget.matchMode === "regex"
        ? `题目规则未提取到可匹配键，或答案规则没有对应结果：${questionTitle}`
        : `未找到同标题答案：${questionTitle}`
    if (!allowIndexRetry) return showHUD(`${notFoundMessage}；刷新索引后仍未匹配到答案`, 4)
    const updatedAt = answerIndexUpdatedAt(answerTarget)
    const updatedText = updatedAt && !Number.isNaN(new Date(updatedAt).getTime())
      ? new Date(updatedAt).toLocaleString("zh-CN", { hour12: false })
      : "尚未记录"
    const retry = await popup({
      title: "没有匹配到答案",
      message: `${notFoundMessage}\n索引更新时间：${updatedText}`,
      buttons: ["取消", "刷新索引后重试"],
      canCancel: true
    })
    if (retry.buttonIndex !== 1) return
    HUDController.show("正在刷新答案索引并重试…")
    try {
      await refreshIndex(answerTarget)
    } finally {
      HUDController.hidden()
    }
    return findCurrentAnswer(false)
  }
  // 候选答案默认打开排序后的第一个（路径匹配分最高），不再弹窗打断；
  // 全部候选随窗口顶部下拉条提供切换。
  const answer = matches[0]
  if (answer) {
    recordRuntimeState("答案匹配", "最终选择答案", `answerNoteId=${answer.noteId} answerNodeId=${answer.id} candidates=${matches.length}`)
    await showAnswer(questionTitle, answer, answerCandidatesForDisplay(matches, resolved.path))
  }
}

async function runSafely(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    captureDiagnosticError(error, "生命周期")
    showHUD(`答案匹配失败：${describeError(error)}`, 4)
  }
}

export async function onAnswerToolbarClick(): Promise<void> {
  hideAnswerToolbar()
  await runSafely(findCurrentAnswer)
}

async function markSelectedQuestions(level?: number): Promise<void> {
  hideAnswerToolbar()
  try {
    const notebookId = currentNotebookId()
    const questions = notebookId ? selectedMistakeQuestions(notebookId) : []
    if (!notebookId || !questions.length) return showHUD("请先选中题目卡片")
    const previous = questions.length === 1
      ? mistakeRecordForSourceQuestion(questions[0], notebookId)
      : undefined
    const selectedLevel = level === undefined
      ? await chooseMistakeLevel(previous?.level, questions.length)
      : level as 0 | 1 | 2
    if (selectedLevel === undefined) return
    if (questions.length === 1) {
      const record = await markQuestionAsMistake(questions[0], notebookId, selectedLevel)
      if (!record) return
    } else {
      const result = await markQuestionsAsMistakes(questions, notebookId, selectedLevel)
      const summary = [`新增 ${result.added} 道`, `更新 ${result.updated} 道`]
      if (result.failed) summary.push(`失败 ${result.failed} 道`)
      showHUD(`批量标记完成：${summary.join("，")}`, 5)
    }
    notifyWorkbenchDataChanged()
  } catch (error) {
    captureDiagnosticError(error, "生命周期")
    showHUD(`错题摘录失败：${describeError(error)}`, 5)
  }
}

export async function onMistakeToolbarClick(): Promise<void> {
  if (self.answerToolbar && !self.answerToolbar.hidden) {
    toggleMistakeLevelDropdown()
    return
  }
  await markSelectedQuestions()
}

export async function onMistakeLevel0Click(): Promise<void> {
  hideMistakeLevelDropdown()
  await markSelectedQuestions(0)
}

export async function onMistakeLevel1Click(): Promise<void> {
  hideMistakeLevelDropdown()
  await markSelectedQuestions(1)
}

export async function onMistakeLevel2Click(): Promise<void> {
  hideMistakeLevelDropdown()
  await markSelectedQuestions(2)
}

function notifyWorkbenchDataChanged(): void {
  try {
    const webView = self.webController?.webView
    if (webView) {
      webView.evaluateJavaScript(
        "typeof window.__onNativeDataChanged==='function'&&window.__onNativeDataChanged()",
        () => undefined
      )
    }
  } catch {
    // The workbench may not have been opened yet; it loads fresh data when shown.
  }
}
export { notifyWorkbenchDataChanged }

export interface AnswerWorkbenchCandidate {
  id: string
  title: string
  path: string
  html: string
}

export interface AnswerWorkbenchData {
  questionTitle: string
  sourceNotebookTitle: string
  answerNotebookTitle?: string
  status: "ready" | "unbound" | "not-found"
  candidates: AnswerWorkbenchCandidate[]
}

export function answerWorkbenchData(): AnswerWorkbenchData {
  const resolved = resolveAnswerLookupContext()
  if (resolved.error !== undefined) throw new Error(resolved.error)
  const { question, lookupQuestion, mistakeContext, sourceNotebookId, answerTarget, questionTitle, titles, path } = resolved
  if (!answerTarget) {
    return {
      questionTitle,
      sourceNotebookTitle: notebookTitle(sourceNotebookId),
      status: "unbound",
      candidates: []
    }
  }
  // 工作台是同步桥接命令，不做整库重建；仅剔除已删除的答案卡，
  // 避免一张失效卡片让整个 candidates 组装（含卡片 HTML 渲染）中断。
  const matches = findAnswersForQuestion(answerTarget, lookupQuestion, titles, path)
    .filter(answerNoteExists)
  return {
    questionTitle,
    sourceNotebookTitle: notebookTitle(sourceNotebookId),
    answerNotebookTitle: scopedBindingEnabled()
      ? targetTitle(answerTarget)
      : notebookTitle(answerTarget.notebookId),
    status: matches.length ? "ready" : "not-found",
    candidates: matches.map(answer => ({
      id: answer.noteId,
      title: answer.titles[0] || "答案卡片",
      path: answer.pathTitles.filter(Boolean).join(" › "),
      html: answerCardHtml(answer, questionTitle)
    }))
  }
}

export async function onMistakeLinkToolbarClick(): Promise<void> {
  hideAnswerToolbar()
  try {
    const notebookId = currentNotebookId()
    const question = selectedQuestion()
    if (!notebookId || !question) return showHUD("请先选中一张题目或错题卡片")
    await openLinkedMistakeOrSource(question, notebookId)
  } catch (error) {
    captureDiagnosticError(error, "生命周期")
    showHUD(`卡片跳转失败：${describeError(error)}`, 5)
  }
}

export async function refreshCurrentIndex(): Promise<void> {
  const questionNotebookId = currentNotebookId()
  if (!questionNotebookId) return showHUD("请先打开题目脑图")
  const source = sourceMindMap()
  if (scopedBindingEnabled() && !source) return showHUD("请先选中当前脑图中的任一卡片")
  const storedTarget = bindingForSource(questionNotebookId, source?.rootNodeId)
  const answerTarget = storedTarget && effectiveAnswerTarget(storedTarget)
  if (!answerTarget) return showHUD("当前脑图尚未绑定答案脑图")
  HUDController.show("正在重建答案索引，请稍候…")
  await delay(0.08)
  let result
  try {
    result = await refreshIndex(answerTarget)
  } finally {
    HUDController.hidden()
  }
  const warning = result.brokenLinks || result.skippedCards
    ? `；忽略 ${result.brokenLinks} 个失效引用、${result.skippedCards} 张异常卡片`
    : ""
  showHUD(`答案索引已刷新：${result.indexedCards} 张卡片${warning}`, 4)
}

export async function unbindCurrent(): Promise<void> {
  const questionNotebookId = currentNotebookId()
  if (!questionNotebookId) return showHUD("请先打开题目脑图")
  const source = sourceMindMap()
  if (scopedBindingEnabled() && !source) return showHUD("请先选中当前脑图中的任一卡片")
  const bindings = loadBindings()
  // 分辨绑定实际存放在哪个键上：scoped 键（当前脑图）还是笔记本级键（整个学习集）。
  const scopedTarget = source?.rootNodeId
    ? getBinding(bindings, questionNotebookId, source.rootNodeId)
    : undefined
  const exactScopedTarget = scopedTarget && source?.rootNodeId
    ? normalizeBinding(bindings[bindingKey(questionNotebookId, source.rootNodeId)])
    : undefined
  const notebookLevel = normalizeBinding(bindings[questionNotebookId])
  const storedTarget = scopedBindingEnabled()
    ? exactScopedTarget ?? notebookLevel
    : notebookLevel ?? exactScopedTarget ?? scopedTarget
  const answerTarget = storedTarget && effectiveAnswerTarget(storedTarget)
  if (!answerTarget) return showHUD("当前脑图没有绑定")
  const result = await popup({
    title: "解除绑定",
    message: scopedBindingEnabled()
      ? `题目脑图：${source?.title || "当前脑图"}\n答案脑图：${targetTitle(answerTarget)}`
      : `题目学习集：${notebookTitle(questionNotebookId)}\n答案学习集：${notebookTitle(answerTarget.notebookId)}`,
    buttons: ["取消", "解除绑定"],
    canCancel: true,
    multiLine: true
  })
  if (result.buttonIndex !== 1) return
  // 键删除与实际存储位置对称，避免残留键继续回退生效造成"假解除"（P3-8）：
  // - 未开启 scoped：解除整个学习集 = 笔记本级键 + 全部 scoped 键一并移除；
  // - 开启 scoped：删除 scoped 键后，笔记本级键仍会作为回退绑定当前脑图，
  //   必须一并移除——否则 HUD 报已解除、答案仍按回退匹配（假解除）。
  if (!scopedBindingEnabled()) {
    removeBindingScope(bindings, questionNotebookId)
  } else {
    if (exactScopedTarget && source?.rootNodeId) {
      removeBinding(bindings, questionNotebookId, source.rootNodeId)
    }
    if (notebookLevel) {
      removeBinding(bindings, questionNotebookId)
      showHUD("已解除当前脑图的答案绑定（笔记本级回退绑定一并移除）")
      saveBindings(bindings)
      clearIndex(answerTarget)
      return
    }
  }
  saveBindings(bindings)
  clearIndex(answerTarget)
  showHUD("已解除当前脑图的答案绑定")
}

export async function openMenu(): Promise<void> {
  const questionNotebookId = currentNotebookId()
  if (!questionNotebookId) return showHUD("请先打开一个脑图")
  const source = sourceMindMap()
  const answerTarget = bindingForSource(questionNotebookId, source?.rootNodeId)
  const scoped = scopedBindingEnabled()
  const binding = answerTarget
    ? scoped ? targetTitle(answerTarget) : notebookTitle(answerTarget.notebookId)
    : "未绑定"
  // 标签→动作映射表：增删菜单项不再依赖魔法索引
  const menuActions: Array<[string, () => void | Promise<void>]> = [
    ["查找当前卡片答案", () => runSafely(findCurrentAnswer)],
    ["标记错题级别", () => onMistakeToolbarClick()],
    ["错题统计与到期复习", () => openMistakeReviewCenter()],
    ["打开错题浏览窗口", () => { (self as any).toggleWebPanel?.() }],
    ["定位当前错题原题", async () => {
      const question = selectedQuestion()
      if (!question) showHUD("请先选中一张题目或错题卡片")
      else await openLinkedMistakeOrSource(question, questionNotebookId)
    }],
    ["刷新错题分类索引", () => repairAndOrganizeMistakes()],
    [scoped ? "绑定/更换具体答案脑图" : "绑定/更换答案学习集", () => runSafely(bindAnswerNotebook)],
    ["刷新答案索引", () => runSafely(refreshCurrentIndex)],
    [`设置匹配方式：${matchingModeLabel(answerTarget)}`, () => runSafely(configureAnswerMatching)],
    [`同学习集脑图绑定：${scoped ? "已开启" : "已关闭"}`, () => setScopedBindingEnabled(!scoped)],
    ["检查插件更新", () => checkForUpdates(true)],
    ["解除当前答案绑定", () => runSafely(unbindCurrent)]
  ]
  const result = await select(
    menuActions.map(([label]) => label),
    "答案匹配",
    `当前答案绑定：${binding}`,
    true
  )
  const action = menuActions[result.index]?.[1]
  if (action) await action()
}

/** 集中激活既有观察器和后台服务；卡片侧边按钮开关不影响这些服务。 */
function activatePluginRuntime(): void {
  eventObservers.remove()
  eventObservers.add()
  scheduleAutomaticUpdateCheck()
  scheduleTelemetryReport()
  scheduleMistakeReviewReminder()
  startMistakeReminderTimer()
}

function activatePluginAfterMigration(): void {
  if (self.mistakeMigrationReady) return
  self.mistakeMigrationReady = true
  activatePluginRuntime()
}

export const lifecycle = defineLifecycleHandlers({
  instanceMethods: {
    sceneWillConnect() {
      recordRuntimeState("生命周期", "sceneWillConnect 开始")
      self.addon = {
        key: __MN_CHANNEL__ === "beta" ? "cardlink-beta" : "cardlink",
        title: __MN_CHANNEL__ === "beta" ? "CardLink Beta" : "CardLink"
      }
      self.lastClickedNote = undefined
      self.answerToolbar = createAnswerToolbar()
      self.answerToolbarShownAt = 0
      self.answerToolbarNoteId = undefined
      self.answerToolbarTargetRect = undefined
      self.mistakeMigrationReady = false
      eventObservers.remove()
      // Startup only restores the normal plugin services. Legacy-tag detection
      // is deliberately deferred until the user explicitly opens the web panel.
      activatePluginAfterMigration()
      void remindFormalBetaConflict()
      recordRuntimeState("生命周期", "sceneWillConnect 完成")
    },
    notebookWillOpen(notebookId: string) {
      recordRuntimeState("生命周期", "notebookWillOpen 开始", `openedNotebookId=${notebookId}`)
      if (self.mistakeMigrationReady) {
        eventObservers.remove()
        eventObservers.add()
      }
      ensureMnutilsEntrance()
      void completePendingNoteNavigation(notebookId)
      recordRuntimeState("生命周期", "notebookWillOpen 调度完成", `openedNotebookId=${notebookId}`)
    },
    notebookWillClose() {
      recordRuntimeState("生命周期", "notebookWillClose 开始")
      eventObservers.remove()
      self.lastClickedNote = undefined
      self.answerToolbarNoteId = undefined
      self.answerToolbarTargetRect = undefined
      hideAnswerToolbar()
      closeAnswerCard()
      closeNotebookPicker()
      closeMistakeLevelPicker()
      recordRuntimeState("生命周期", "notebookWillClose 完成")
    },
    sceneDidDisconnect() {
      recordRuntimeState("生命周期", "sceneDidDisconnect 开始")
      eventObservers.remove()
      removeMnutilsEntrance()
      destroyAnswerToolbar()
      clearIndex()
      closeAnswerCard()
      closeNotebookPicker()
      closeMistakeLevelPicker()
      stopMistakeReminderTimer()
      recordRuntimeState("生命周期", "sceneDidDisconnect 完成")
    }
  },
  classMethods: {
    applicationWillEnterForeground() {
      if (!self.mistakeMigrationReady) return
      recordRuntimeState("生命周期", "applicationWillEnterForeground 开始")
      scheduleAutomaticUpdateCheck()
      scheduleTelemetryReport()
      scheduleMistakeReviewReminder()
      recordRuntimeState("生命周期", "applicationWillEnterForeground 完成")
    },
    addonWillDisconnect() {
      removeMnutilsEntrance()
      destroyAnswerToolbar()
      clearIndex()
    }
  }
})

export { ensureMnutilsEntrance, onMnutilsEntranceClick, onMnutilsEntranceLongPress, onMnutilsEntrancePan }

export const handlers = defineEventHandlers<(typeof events)[number]>({
  onPopupMenuOnNote(sender) {
    if (self.window !== MN.currentWindow) return
    if (!isCardToolbarEnabled()) return
    const note = sender.userInfo?.note
    const winRect = (sender.userInfo as any).winRect
    self.lastClickedNote = note
    self.answerToolbarNoteId = note?.noteId
    self.answerToolbarTargetRect = parsePopupWinRect(winRect)
    const notebookId = currentNotebookId()
    const existingMistake = note && notebookId
      ? mistakeRecordForSourceQuestion(new NodeNote(note, notebookId), notebookId)
      : undefined
    updateMistakeToolbarTitle(Boolean(existingMistake))
    showAnswerToolbar(winRect)
  },
  async onClosePopupMenuOnNote() {
    if (self.window !== MN.currentWindow) return
    const shownAt = self.answerToolbarShownAt
    await delay(0.15)
    if (shownAt !== self.answerToolbarShownAt) return
    if (self.mistakeLevelDropdown && !self.mistakeLevelDropdown.hidden) return
    if (isCurrentNotePopupStillVisible()) return
    self.answerToolbarNoteId = undefined
    self.answerToolbarTargetRect = undefined
    hideAnswerToolbar()
  }
})

export function queryAddonCommandStatus() {
  return currentNotebookId()
    ? { image: "logo.png", object: self, selector: "openMenu:", checked: false }
    : null
}
