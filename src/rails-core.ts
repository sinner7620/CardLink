import { MN, NodeNote, showHUD } from "marginnote"
import {
  answerMatchingSettingsData,
  isCardToolbarEnabled,
  setCardToolbarEnabled,
  answerWorkbenchData,
  bindAnswerNotebook,
  configureAnswerMatching,
  eventObservers,
  handlers,
  lifecycle,
  onAnswerCardPan,
  onAnswerCardResize,
  onAnswerControlPress,
  onAnswerControlRelease,
  onChooseAnswerCandidate,
  onAnswerToolbarClick,
  onCloseAnswerCard,
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
  notifyWorkbenchDataChanged,
  onMistakeLevelPickerAction,
  onNotebookPickerAction,
  openMenu,
  refreshCurrentIndex,
  saveRegexMatchingRules,
  setScopedBindingEnabled,
  unbindCurrent
} from "./plugin"
import {
  deleteMistakeTag,
  beginMistakeWorkbenchTransfer,
  changeMistakeLevelById,
  continueMistakeWorkbenchTransfer,
  legacyMistakeTagMigrationCompleted,
  markQuestionAsMistake,
  mistakeDetailById,
  mistakeQuestionById,
  mistakeWorkbenchRevision,
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
import { checkForUpdates } from "./updater"
import { runTelemetryConnectivityTest } from "./telemetry"
import { exportMistakes, previewMistakeExport, cancelMistakeExportPreparation } from "./mistake-export"
import { captureDiagnosticError, clearNavigationRuntimeLog, consumePendingLocateHint, exportNavigationRuntimeLog, recordRuntimeState } from "./note-navigation"
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

async function bridgeInternal(command: string, payload: any): Promise<any> {
  if (command === "aiConfirmDevelopmentWarning" || command === "aiGetSettings" || command === "aiListReports" || command === "aiGetReport" ||
    command === "aiGetJob" || command === "aiPreviewAnalysis" || command === "aiStartAnalysis" ||
    command === "aiOpenEvidence" || command === "aiCancelJob" || command === "aiListStudySets" || command === "aiListMistakeStudySets" ||
    command === "aiSaveSettings" || command === "aiSetCredential" || command === "aiTestProvider" || command === "aiTestMinerU" ||
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
      locateHint: consumePendingLocateHint(),
      mistakeRefreshConsentRequired: !legacyMistakeTagMigrationCompleted(),
      mistakes: beginMistakeWorkbenchTransfer(),
      matching: answerMatchingSettingsData(),
      // AI 运行时门闸：总开关关闭时 Web 不装载 AI 模块、不发送任何 AI 命令。
      aiEnabled: aiRuntimeEnabled()
    }
  }
  if (command === "answer") return answerWorkbenchData()
  if (command === "acceptMistakeRefreshConsent") {
    await repairAndOrganizeMistakes()
    rememberLegacyMistakeTagMigration()
    return { accepted: true }
  }
  if (command === "mistakes") return beginMistakeWorkbenchTransfer()
  if (command === "mistakesRevision") return { revision: mistakeWorkbenchRevision() }
  if (command === "mistakesPage") {
    return continueMistakeWorkbenchTransfer(String(payload?.transferId ?? ""), Number(payload?.offset ?? 0))
  }
  if (command === "markMistake") {
    return onMistakeToolbarClick()
  }
  if (command === "findCurrentAnswer") return onAnswerToolbarClick()
  if (command === "openPluginGuide") return openPluginGuide()
  if (command === "bindAnswerNotebook") return bindAnswerNotebook()
  if (command === "setScopedBinding") {
    return setScopedBindingEnabled(payload?.enabled === true)
  }
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
  if (command === "mistakeDetail") return mistakeDetailById(String(payload?.recordId ?? ""))
  if (command === "mistakeQuestion") return mistakeQuestionById(String(payload?.recordId ?? ""))
  if (command === "setMistakeFavorite") return setMistakeFavoriteById(String(payload?.recordId ?? ""), payload?.favorite === true)
  if (command === "migrateLegacyFavorites") return migrateLegacyMistakeFavorites(payload?.titles)
  if (command === "openSource") return openSourceByMistakeId(String(payload?.recordId ?? ""))
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
    if (!loadMatcherSettings().debugModeEnabled) throw new Error("请先开启调试模式")
    return runTelemetryConnectivityTest()
  }
  if (command === "setDebugMode") {
    const enabled = payload?.enabled === true
    saveMatcherSettings({ debugModeEnabled: enabled })
    if (!enabled) clearNavigationRuntimeLog()
    showHUD(enabled ? "调试模式已开启" : "调试模式已关闭，运行日志已清空", 3)
    return { enabled }
  }
  if (command === "checkUpdates") return checkForUpdates(true)
  if (command === "legacyMenu") return openMenu()
  if (command === "notify") return showHUD(String(payload?.message ?? ""), 3)
  throw new Error(`未知工作台命令：${command}`)
}

/**
 * 桥接统一观测层：每个命令记录 traceId、耗时、载荷/响应字节数与异常（仅调试模式写入环形缓冲）。
 * 不记录 payload/response 内容本身，避免日志携带错题正文。
 */
async function bridge(command: string, payload: any): Promise<any> {
  const traceId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const startedAt = Date.now()
  const debug = loadMatcherSettings().debugModeEnabled
  if (debug) {
    let payloadBytes = -1
    try { payloadBytes = JSON.stringify(payload ?? null)?.length || 0 } catch { /* 循环结构忽略 */ }
    recordRuntimeState("桥接", "bridge.start", `trace=${traceId} cmd=${command} payloadBytes=${payloadBytes}`)
  }
  try {
    const result = await bridgeInternal(command, payload)
    if (debug) {
      let responseBytes = -1
      try { responseBytes = JSON.stringify(result ?? null)?.length || 0 } catch { /* 循环结构忽略 */ }
      recordRuntimeState("桥接", "bridge.end", `trace=${traceId} cmd=${command} durationMs=${Date.now() - startedAt} responseBytes=${responseBytes}`)
    }
    return result
  } catch (error) {
    captureDiagnosticError(error, "桥接", `trace=${traceId} cmd=${command} durationMs=${Date.now() - startedAt}`)
    throw error
  }
}

;(globalThis as any).__MN_ANSWER_CORE_GLOBAL__ = {
  bridge,
  eventObservers,
  handlers,
  lifecycle,
  notifyWorkbenchDataChanged,
  cardToolbar: { isEnabled: isCardToolbarEnabled, setEnabled: setCardToolbarEnabled },
  instanceMethods: {
    onAnswerToolbarClick,
    onChooseAnswerCandidate,
    onMistakeToolbarClick,
    onMistakeLevel0Click,
    onMistakeLevel1Click,
    onMistakeLevel2Click,
    onMistakeLevelPickerAction,
    onMistakeLinkToolbarClick,
    onNotebookPickerAction,
    onCloseAnswerCard,
    onRefreshAnswerCard,
    onPanelCloseButtonSideChanged,
    onAnswerCardPan,
    onAnswerCardResize,
    onAnswerControlPress,
    onAnswerControlRelease,
    openMenu,
    ensureMnutilsEntrance,
    onMnutilsEntranceClick,
    onMnutilsEntranceLongPress,
    onMnutilsEntrancePan,
  }
}
