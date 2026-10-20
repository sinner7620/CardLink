import { delay, MN, NodeNote, select, showHUD } from "marginnote"
import { clipperSnapshot, recordClipperTool, saveClipperSetting, saveClipperAnswerSetting, configureClipperTitleFormat } from "./question-clipper"
import { openClipperQuickMenu, onClipperEnd, onClipperBindMother, onClipperResetQuestion, onClipperEditTitle } from "./mnutils-entrance"
import {
  answerMatchingSettingsData,
  managedAnswerBindings,
  updateManagedAnswerBinding,
  deleteManagedAnswerBinding,
  addManagedAnswerBindingColor,
  refreshManagedAnswerBinding,
  chooseManagedAnswerMindMap,
  chooseCurrentAnswerBinding,
  isCardToolbarEnabled,
  setCardToolbarEnabled,
  answerWorkbenchDataWithIndexRecovery,
  recoverAnswerIndexError,
  executeCardMenuCommand,
  bindAnswerNotebook,
  configureAnswerMatching,
  eventObservers,
  handlers,
  lifecycle,
  onAnswerReviewOutsideTap,
  onAnswerCardPan,
  onAnswerCardResize,
  onAnswerControlPress,
  onAnswerControlRelease,
  onChooseAnswerCandidate,
  onAnswerToolbarClick,
  onAnswerToolbarSingleTap,
  onAnswerToolbarLongPress,
  onCloseAnswerCard,
  onLocateAnswerCard,
  openPluginGuide,
  onRefreshAnswerCard,
  onPanelCloseButtonSideChanged,
  onMistakeLinkToolbarClick,
  onMistakeToolbarClick,
  onMistakeLevel0Click,
  onMistakeLevel1Click,
  onMistakeLevel2Click,
  ensureMnutilsEntrance,
  onMnutilsEntranceClick,
  onMnutilsEntranceLongPress,
  onMnutilsEntrancePan,
  onMnutilsQuickMenuDismiss,
  onMnutilsQuickMenuWindowTap,
  onMnutilsQuickMenuOpenPanel,
  onMnutilsQuickMenuFilter,
  onMnutilsQuickMenuSelectAll,
  onMnutilsQuickMenuToggleQuestion,
  onMnutilsQuickMenuToggleBranch,
  onMnutilsQuickMenuStart,
  onMnutilsQuickMenuModePress,
  notifyWorkbenchDataChanged,
  onMistakeLevelPickerAction,
  onNotebookPickerAction,
  openMenu,
  refreshCurrentIndex,
  saveRegexMatchingRules,
  setScopedBindingEnabled,
  startReviewMode,
  onReviewModeIndex,
  onReviewModePrevious,
  onReviewModeNext,
  onReviewModeExit,
  onReviewModeControlPress,
  onReviewModeControlRelease,
  onReviewModeControlHover,
  onReviewModePan,
  onReviewModeResult,
  onReviewModeExpand, onReviewModeBranch, onReviewModeQueuePick, onReviewModeToolbarResult,
  unbindCurrent
} from "./plugin"
import {
  deleteMistakeTag,
  beginMistakeWorkbenchTransfer,
  addManualTodayOverdue,
  getManualTodayIds,
  changeMistakeLevelById,
  continueMistakeWorkbenchTransfer,
  legacyMistakeTagMigrationCompleted,
  markQuestionAsMistake,
  mistakeDetailById,
  mistakeHandwritingTarget,
  mistakeQuestionById,
  mistakeWorkbenchRevision,
  refreshMistakeList,
  migrateLegacyMistakeFavorites,
  openSourceByMistakeId,
  removeMistakesByIds,
  removeMistakeById,
  repairAndOrganizeMistakes,
  rememberLegacyMistakeTagMigration,
  reviewMistakeById,
  reviewMistakesByIds,
  resumeMistakeReviewById,
  saveMistakeReviewCurves,
  setMistakeFavoriteById,
  setMistakeCategoryById
} from "./mistake-manager"
import { checkForUpdates, configureUpdatePath, setDebugUpdateDownloads, setDebugAutoInstallUpdates, showUpdateStatus } from "./updater"
import { runTelemetryConnectivityTest } from "./telemetry"
import { exportMistakes, previewMistakeExport, cancelMistakeExportPreparation } from "./mistake-export"
import { captureDiagnosticError, clearNavigationRuntimeLog, consumePendingLocateHint, exportNavigationRuntimeLog, focusNoteInFloatMindMap, recordRuntimeState } from "./note-navigation"
import { presentError } from "./error-messages"
import { CardLinkError } from "./errors"
import { isAnswerIndexError } from "./answer-index-recovery"
import { loadMatcherSettings, saveMatcherSettings } from "./settings"
import { aiBridge, isAICommand, aiRuntimeEnabled } from "./ai-subsystem"

function selectedNode(): NodeNote | undefined {
  // 冷启动时脑图视图可能尚未就绪，getSelectedNodes 会因此抛错——跳过该来源走回退。
  const selected = MN.notebookController?.mindmapView ? NodeNote.getSelectedNodes() : []
  if (selected.length) return selected[0]
  if (self.lastClickedNote) return new NodeNote(self.lastClickedNote)
  const focus = MN.notebookController?.focusNote
  return focus ? new NodeNote(focus) : undefined
}

function sceneFeatures(owner?: any): { scenePanel: boolean; handwriting: boolean } {
  const scene = (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__
  const enabled = loadMatcherSettings().sceneWorkbenchEnabled && !!scene && scene.enabled(owner ?? self)
  return { scenePanel: enabled, handwriting: enabled }
}

async function bridgeInternal(command: string, payload: any, owner?: any): Promise<any> {
  if (command === "setReviewAlgorithm") {
    if (!loadMatcherSettings().debugModeEnabled) throw new CardLinkError("debugModeRequired")
    if (!["fixed", "fsrs"].includes(payload?.algorithm)) throw new Error("无效的复习算法")
    if ((owner ?? self)?.cardLinkReviewMode) throw new Error("请先退出当前复习，再切换算法")
    if (payload.algorithm === "fsrs") (await import("./fsrs-service")).initializeFsrs()
    saveMatcherSettings({ debugReviewAlgorithm: payload.algorithm })
    return { algorithm: payload.algorithm }
  }
  if (command.startsWith("fsrs")) {
    const settings = loadMatcherSettings()
    if (!settings.debugModeEnabled || settings.debugReviewAlgorithm !== "fsrs") throw new CardLinkError("debugModeRequired")
    return (await import("./fsrs-service")).fsrsCommand(command, payload)
  }
  if (command === "startFsrsReviewMode") {
    const settings = loadMatcherSettings()
    if (!settings.debugModeEnabled || settings.debugReviewAlgorithm !== "fsrs") throw new CardLinkError("debugModeRequired")
    const snapshot = (await import("./fsrs-service")).fsrsSnapshot()
    const ids = new Set(Array.isArray(payload?.recordIds) ? payload.recordIds : [])
    const items = snapshot.records.filter(item => ids.has(item.recordId) && !item.progress.paused).map(item => ({ ...item,
      level: item.progress.legacyLevel, reviewCount: item.historyCount, fsrsProgress: item.progress,
      lastReviewedAt: item.progress.card?.last_review }))
    return startReviewMode(items, owner ?? self, "fsrs")
  }
  if (command === "cardMenuCommand") {
    if (!(globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__?.enabled(owner ?? self)) throw new Error("卡片菜单命令要求软件450及以上且处于场景页面")
    return executeCardMenuCommand(payload?.id, payload?.noteID, owner)
  }
  if (command === "aiConfirmDevelopmentWarning" || command === "aiGetSettings" || command === "aiListReports" || command === "aiGetReport" ||
    command === "aiGetJob" || command === "aiPreviewAnalysis" || command === "aiStartAnalysis" ||
    command === "aiOpenEvidence" || command === "aiCancelJob" || command === "aiListStudySets" || command === "aiListMistakeStudySets" ||
    command === "aiSaveSettings" || command === "aiSetCredential" || command === "aiClearCredential" || command === "aiTestProvider" || command === "aiTestMinerU" ||
    command === "aiGetCacheStats" || command === "aiListPreparedQuestions" || command === "aiGetPreparedQuestion" || command === "aiClearOCRCache" || command === "aiDeleteReport" || command === "aiRunDueSchedules" ||
    command === "aiStartQuestionPreparation" || command === "aiGetQuestionPreparationJob" || command === "aiGetPreparationQuestion" ||
    command === "aiSubmitPreparationImage" || command === "aiFailPreparationQuestion" || command === "aiAdvanceQuestionPreparation" || command === "aiCancelQuestionPreparation" ||
    isAICommand(command)) return aiBridge(command, payload)
  if (command === "uiConstants") {
    // P1-7：原生共享常量 → web CSS 变量（--mn-topbar-height 由前端写入）
    const constants = (globalThis as any).__MNAM_UI_CONSTANTS__
    return constants ? { titleHeight: constants.TITLE_HEIGHT } : { titleHeight: 56 }
  }
  if (command === "runtimeLog") {
    // 前端诊断通道：超时/解析失败/全局异常写入同一份环形缓冲（容量有限，只记事件不记内容）
    recordRuntimeState("前端", String(payload?.event || "log"), String(payload?.detail || "").slice(0, 400))
    return { logged: true }
  }

  if (command === "dashboard") {
    return {
      version: __APP_VERSION__,
      reviewAlgorithm: loadMatcherSettings().debugModeEnabled && loadMatcherSettings().debugReviewAlgorithm === "fsrs" ? "fsrs" : "fixed",
      features: sceneFeatures(owner),
      locateHint: consumePendingLocateHint(),
      mistakeRefreshConsentRequired: !legacyMistakeTagMigrationCompleted(),
      mistakes: beginMistakeWorkbenchTransfer(),
      manualTodayIds: getManualTodayIds(),
      matching: answerMatchingSettingsData(),
      clipper: clipperSnapshot(owner ?? self),
      answerBindings: managedAnswerBindings(),
      // AI 运行时门闸：总开关关闭时 Web 不装载 AI 模块、不发送任何 AI 命令。
      aiEnabled: aiRuntimeEnabled()
    }
  }
  if (command === "bindingSettingsSnapshot") return {
    clipper: clipperSnapshot(owner ?? self),
    matching: answerMatchingSettingsData(),
    answerBindings: managedAnswerBindings()
  }
  if (command === "answer") return answerWorkbenchDataWithIndexRecovery()
  if (command === "acceptMistakeRefreshConsent") {
    await repairAndOrganizeMistakes()
    rememberLegacyMistakeTagMigration()
    return { accepted: true }
  }
  if (command === "mistakes") return beginMistakeWorkbenchTransfer()
  if (command === "mistakesRevision") return { revision: mistakeWorkbenchRevision() }
  if (command === "refreshMistakeList") return refreshMistakeList()
  if (command === "mistakesPage") {
    return continueMistakeWorkbenchTransfer(String(payload?.transferId ?? ""), Number(payload?.offset ?? 0))
  }
  if (command === "addManualTodayOverdue") return addManualTodayOverdue(Number(payload?.count ?? 0))
  if (command === "markMistake") {
    return onMistakeToolbarClick()
  }
  if (command === "findCurrentAnswer") return onAnswerToolbarClick()
  if (command === "startReviewMode") return startReviewMode(payload?.records, owner ?? self)
  if (command === "openPluginGuide") return openPluginGuide()
  if (command === "bindAnswerNotebook") return bindAnswerNotebook()
  if (command === "chooseCurrentAnswerBinding") return chooseCurrentAnswerBinding()
  if (command === "openClipperMode") { openClipperQuickMenu(owner ?? self); return clipperSnapshot(owner ?? self) }
  if (command === "recordClipperTool") { recordClipperTool(String(payload?.slot ?? ""), owner ?? self); return clipperSnapshot(owner ?? self) }
  if (command === "setClipperAnswer") { saveClipperAnswerSetting(payload?.enabled === true, owner ?? self); return clipperSnapshot(owner ?? self) }
  if (command === "setClipperTitle") { saveClipperSetting(payload?.enabled === true, owner ?? self); return clipperSnapshot(owner ?? self) }
  if (command === "configureClipperTitleFormat") { await configureClipperTitleFormat(owner ?? self); return clipperSnapshot(owner ?? self) }
  if (command === "chooseClipperAnswerPosition") {
    await select(["子卡片（当前）"], "答案位置", "摘录的答案放在题目子卡片中", true)
    return clipperSnapshot(owner ?? self)
  }
  if (command === "updateManagedAnswerBinding") return updateManagedAnswerBinding(String(payload?.key ?? ""), payload?.changes ?? {})
  if (command === "deleteManagedAnswerBinding") return deleteManagedAnswerBinding(String(payload?.key ?? ""))
  if (command === "addManagedAnswerBindingColor") return addManagedAnswerBindingColor(String(payload?.key ?? ""))
  if (command === "refreshManagedAnswerBinding") return refreshManagedAnswerBinding(String(payload?.key ?? ""))
  if (command === "chooseManagedAnswerMindMap") return chooseManagedAnswerMindMap(String(payload?.key ?? ""), payload?.activateMixed === true)
  if (command === "setPersonalSetting") {
    const key = String(payload?.key ?? "")
    if (key === "sceneWorkbenchEnabled" && typeof payload?.value === "boolean") saveMatcherSettings({ sceneWorkbenchEnabled: payload.value })
    else if (key === "subcardAnswerDisplay" && ["reveal", "window"].includes(payload?.value)) saveMatcherSettings({ subcardAnswerDisplay: payload.value })
    else if (key === "boundHandwritingDisplay" && ["always", "doubleTap"].includes(payload?.value)) saveMatcherSettings({ boundHandwritingDisplay: payload.value })
    else if (key === "mistakeListDisplay" && ["always", "autoHide"].includes(payload?.value)) saveMatcherSettings({ mistakeListDisplay: payload.value })
    else if (key === "entranceDefaultMode" && ["practice", "clipper"].includes(payload?.value)) saveMatcherSettings({ entranceDefaultMode: payload.value })
    else if (key === "answerMaskStyle" && ["dark", "light"].includes(payload?.value)) saveMatcherSettings({ answerMaskStyle: payload.value })
    else if (key === "answerMaskColor" && /^#[0-9a-f]{6}$/i.test(String(payload?.value ?? ""))) saveMatcherSettings({ answerMaskColor: payload.value, answerMaskImage: "" })
    else if (key === "answerMaskImage" && (payload?.value === "" || (typeof payload?.value === "string" && /^data:image\/(?:png|jpeg|webp);base64,/.test(payload.value) && payload.value.length <= 400000))) saveMatcherSettings({ answerMaskImage: payload.value })
    else if (key === "autoCollapseComments") saveMatcherSettings({ autoCollapseComments: payload?.value === true })
    else if (key === "reviewExpandedCommentCount" && Number.isInteger(payload?.value) && payload.value >= 0 && payload.value <= 10) saveMatcherSettings({ reviewExpandedCommentCount: payload.value })
    else throw new Error("无效的个性设置")
    return answerMatchingSettingsData()
  }
  if (command === "chooseReviewCommentCount") {
    await delay(0.08)
    const current = loadMatcherSettings().reviewExpandedCommentCount
    const choice = await select(
      Array.from({ length: 11 }, (_, count) => `默认展开 ${count} 条${count === current ? "（当前）" : ""}`),
      "卡片评论自动折叠",
      "选择待复习题目预览默认展开的评论数量",
      true
    )
    if (choice.index >= 0 && choice.index <= 10) saveMatcherSettings({ reviewExpandedCommentCount: choice.index })
    return answerMatchingSettingsData()
  }
  if (command === "setScopedBinding") return setScopedBindingEnabled(payload?.enabled === true)
  if (command === "configureAnswerMatching") return configureAnswerMatching()
  if (command === "saveRegexMatchingRules") {
    return saveRegexMatchingRules(
      String(payload?.questionPattern ?? ""),
      String(payload?.answerPattern ?? "")
    )
  }
  if (command === "refreshAnswerIndex") return refreshCurrentIndex()
  if (command === "unbindAnswerNotebook") return unbindCurrent()
  if (command === "openCurrentMistakeSource") return onMistakeLinkToolbarClick()
  if (command === "mistakeDetail") {
    const recordId = String(payload?.recordId ?? "")
    const content = payload?.content === "question" || payload?.content === "answers" ? payload.content : "all"
    let detail = mistakeDetailById(recordId, content)
    if (detail.answerStatus === "index-missing") {
      const record = detail.record
      const note = MN.db.getNoteById(record.sourceNoteId)
      if (note) {
        const recovery = await recoverAnswerIndexError(new CardLinkError("indexNotReady"), {
          notebookId: record.sourceNotebookId,
          question: new NodeNote(note, record.sourceNotebookId),
          target: record.answerNotebookId ? { notebookId: record.answerNotebookId, rootNodeId: record.answerRootNodeId } : undefined
        })
        if (recovery === "refreshed" || recovery === "rebound") detail = mistakeDetailById(recordId, content)
      }
    }
    return { ...detail, handwritingAvailable: sceneFeatures(owner).handwriting }
  }
  if (command === "openMistakeHandwriting") {
    const target = mistakeHandwritingTarget(String(payload?.recordId ?? ""))
    if (!sceneFeatures(owner).handwriting) throw new Error("请先在设置 → 关于插件开启“场景面板与整卡手写”，并在软件4.5.0及以上的场景面板内使用")
    return target
  }
  if (command === "mistakeQuestion") return mistakeQuestionById(String(payload?.recordId ?? ""))
  if (command === "setMistakeFavorite") return setMistakeFavoriteById(String(payload?.recordId ?? ""), payload?.favorite === true)
  if (command === "migrateLegacyFavorites") return migrateLegacyMistakeFavorites(payload?.titles)
  if (command === "openSource") return openSourceByMistakeId(String(payload?.recordId ?? ""))
  if (command === "openMistakeAnswer") {
    const answerNoteId = String(payload?.answerNoteId ?? "").trim()
    if (!answerNoteId) return { locateHint: "当前错题没有可定位的答案卡片" }
    const result = await focusNoteInFloatMindMap(answerNoteId)
    return result === "dispatched" ? {}
      : { locateHint: result === "unavailable" ? "当前 MarginNote 版本不支持在浮窗中定位答案卡片" : "答案卡片浮窗定位失败，请稍后重试" }
  }
  if (command === "chooseSourceLocateMode") {
    await delay(0.08)
    const current = loadMatcherSettings().sourceLocateMode
    const choice = await select(
      [`仅定位${current === "locate" ? "（当前）" : ""}`, `定位并聚焦${current === "focus" ? "（当前）" : ""}`],
      "定位原题方式",
      "选择复习模式外定位原题时的操作",
      true
    )
    const mode = choice.index === 0 ? "locate" : choice.index === 1 ? "focus" : current
    if (mode !== current) saveMatcherSettings({ sourceLocateMode: mode })
    return { mode }
  }
  if (command === "reviewMistake") return reviewMistakeById(String(payload?.recordId ?? ""), Number(payload?.level) as any)
  if (command === "changeMistakeLevel") return changeMistakeLevelById(String(payload?.recordId ?? ""), Number(payload?.level) as any)
  if (command === "reviewMistakes" || command === "changeMistakeLevels") return reviewMistakesByIds(payload?.recordIds, Number(payload?.level) as any)
  if (command === "resumeMistakeReview") return resumeMistakeReviewById(String(payload?.recordId ?? ""))
  if (command === "saveMistakeReviewCurves") return saveMistakeReviewCurves(payload?.curves)
  if (command === "setMistakeCategory") {
    return setMistakeCategoryById(
      String(payload?.recordId ?? ""),
      payload?.categories ?? String(payload?.category ?? "")
    )
  }
  if (command === "deleteMistakeTag") return deleteMistakeTag(String(payload?.tag ?? ""))
  if (command === "removeMistake") {
    await removeMistakeById(String(payload?.recordId ?? ""))
    return { removed: true }
  }
  if (command === "removeMistakes") return removeMistakesByIds(payload?.recordIds)
  if (command === "repairMistakes") return repairAndOrganizeMistakes()
  if (command === "exportMistakes") return exportMistakes(payload || { format: "md" })
  if (command === "previewMistakeExport") return previewMistakeExport(payload || { format: "pdf" })
  if (command === "cancelMistakeExportPreparation") return cancelMistakeExportPreparation()
  if (command === "exportRuntimeLog") return exportNavigationRuntimeLog()
  if (command === "testTelemetryConnectivity") {
    if (!loadMatcherSettings().debugModeEnabled) throw new CardLinkError("debugModeRequired")
    return runTelemetryConnectivityTest()
  }
  if (command === "setDebugMode") {
    const enabled = payload?.enabled === true
    if (!enabled && (owner ?? self)?.cardLinkReviewMode?.algorithm === "fsrs") throw new Error("请先退出智能复习，再关闭调试模式")
    saveMatcherSettings({ debugModeEnabled: enabled })
    if (!enabled) clearNavigationRuntimeLog()
    showHUD(enabled ? "调试模式已开启" : "调试模式已关闭，运行日志已清空", 3)
    return { enabled, algorithm: enabled && loadMatcherSettings().debugReviewAlgorithm === "fsrs" ? "fsrs" : "fixed" }
  }
  if (command === "checkUpdates") return checkForUpdates(true)
  if (command === "setDebugUpdateDownloads") return setDebugUpdateDownloads(payload?.enabled === true)
  if (command === "setDebugAutoInstallUpdates") return setDebugAutoInstallUpdates(payload?.enabled === true)
  if (command === "showUpdateStatus") return showUpdateStatus()
  if (command === "legacyMenu") return openMenu()
  if (command === "notify") return showHUD(String(payload?.message ?? ""), 3)
  throw new Error(`未知工作台命令：${command}`)
}

/**
 * 桥接统一观测层：每个命令记录 traceId、耗时、载荷/响应字节数与异常（仅调试模式写入环形缓冲）。
 * 不记录 payload/response 内容本身，避免日志携带错题正文。
 */
async function bridge(command: string, payload: any, owner?: any): Promise<any> {
  const traceId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const startedAt = Date.now()
  const debug = loadMatcherSettings().debugModeEnabled
  if (debug) {
    let payloadBytes = -1
    try { payloadBytes = JSON.stringify(payload ?? null)?.length || 0 } catch { /* 循环结构忽略 */ }
    recordRuntimeState("桥接", "bridge.start", `trace=${traceId} cmd=${command} payloadBytes=${payloadBytes}`)
  }
  try {
    const result = await bridgeInternal(command, payload, owner)
    if (debug) {
      let responseBytes = -1
      try { responseBytes = JSON.stringify(result ?? null)?.length || 0 } catch { /* 循环结构忽略 */ }
      recordRuntimeState("桥接", "bridge.end", `trace=${traceId} cmd=${command} durationMs=${Date.now() - startedAt} responseBytes=${responseBytes}`)
    }
    return result
  } catch (error) {
    captureDiagnosticError(error, "桥接", `trace=${traceId} cmd=${command} durationMs=${Date.now() - startedAt}`)
    // 后台 AI/导出保持只读失败语义；交互查答案和卡片菜单允许用户主动恢复。
    if (command === "cardMenuCommand" && isAnswerIndexError(error)) {
      const note = MN.db.getNoteById(String(payload?.noteID ?? ""))
      const recovery = await recoverAnswerIndexError(error, note ? {
        notebookId: String(note.notebookId || MN.currnetNotebookId || ""), question: new NodeNote(note)
      } : undefined)
      if (recovery !== undefined) return { cancelled: true }
    }
    // 码化错误在此换成表内用户文案并携带 code；未码化错误原样透传给信封
    throw presentError(error)
  }
}

;(globalThis as any).__MN_ANSWER_CORE_GLOBAL__ = {
  configureUpdatePath,
  bridge,
  eventObservers,
  handlers,
  lifecycle,
  notifyWorkbenchDataChanged,
  annotationLog: (event: string, detail: string) => recordRuntimeState("手写", event, detail),
  sceneWorkbenchEnabled: () => loadMatcherSettings().sceneWorkbenchEnabled,
  cardToolbar: { isEnabled: isCardToolbarEnabled, setEnabled: setCardToolbarEnabled },
  instanceMethods: {
    onClipperEnd, onClipperBindMother, onClipperResetQuestion, onClipperEditTitle,
    onAnswerToolbarClick,
    onAnswerToolbarSingleTap,
    onAnswerToolbarLongPress,
    onChooseAnswerCandidate,
    onMistakeToolbarClick,
    onMistakeLevel0Click,
    onMistakeLevel1Click,
    onMistakeLevel2Click,
    onMistakeLevelPickerAction,
    onMistakeLinkToolbarClick,
    onNotebookPickerAction,
    onCloseAnswerCard,
    onLocateAnswerCard,
    onRefreshAnswerCard,
    onPanelCloseButtonSideChanged,
    onAnswerReviewOutsideTap,
    onAnswerCardPan,
    onAnswerCardResize,
    onAnswerControlPress,
    onAnswerControlRelease,
    openMenu,
    ensureMnutilsEntrance,
    onMnutilsEntranceClick,
    onMnutilsEntranceLongPress,
    onMnutilsEntrancePan,
    onMnutilsQuickMenuDismiss,
    onMnutilsQuickMenuWindowTap,
    onMnutilsQuickMenuOpenPanel,
    onMnutilsQuickMenuFilter,
    onMnutilsQuickMenuSelectAll,
    onMnutilsQuickMenuToggleQuestion,
    onMnutilsQuickMenuToggleBranch,
    onMnutilsQuickMenuStart,
  onMnutilsQuickMenuModePress,
    onReviewModeIndex,
    onReviewModePrevious,
    onReviewModeNext,
    onReviewModeExit,
    onReviewModeControlPress,
    onReviewModeControlRelease,
    onReviewModeControlHover,
    onReviewModePan,
    onReviewModeResult,
  onReviewModeExpand, onReviewModeBranch, onReviewModeQueuePick, onReviewModeToolbarResult,
  }
}
