import {
  delay,
  genNSURL,
  getLocalDataByKey,
  MN,
  showHUD,
  saveFile,
  setLocalDataByKey,
  writeTextFile
} from "marginnote"
import { noteReferenceUrl } from "./note-link"
import { loadMatcherSettings } from "./settings"
import { cardLinkTempPath, ensureStorageDirectory } from "./storage-paths"

const RUNTIME_DEBUG_MAX_LINES = 2000
const RUNTIME_DEBUG_STORAGE_KEY = "mn4-answer-matcher.runtime-debug.v1"
const PENDING_NAVIGATION_STORAGE_KEY = "mn4-answer-matcher.pending-navigation.v1"
const PENDING_NAVIGATION_MAX_AGE_MS = 30_000

interface NavigationDebugState {
  runId: string
  startedAtMs: number
  noteId: string
  notebookId?: string
  focusCalls: number
  lines: string[]
}

interface PendingNavigation {
  runId: string
  noteId: string
  notebookId?: string
  createdAtMs: number
  enterFocusMode?: boolean
}

export interface OpenNoteInMindMapOptions {
  enterFocusMode?: boolean
}

function savePendingNavigation(target: PendingNavigation, persist = false): void {
  self.pendingMistakeNavigation = target
  if (persist) {
    try {
      setLocalDataByKey(target, PENDING_NAVIGATION_STORAGE_KEY)
    } catch {
      // The originating async retry remains available when persistence fails.
    }
  }
}

function clearPendingNavigation(runId?: string): void {
  const current = self.pendingMistakeNavigation as PendingNavigation | undefined
  if (!runId || !current || current.runId === runId) self.pendingMistakeNavigation = undefined
  try {
    const stored = getLocalDataByKey(PENDING_NAVIGATION_STORAGE_KEY) as PendingNavigation | undefined
    if (!runId || !stored || stored.runId === runId) {
      setLocalDataByKey("", PENDING_NAVIGATION_STORAGE_KEY)
    }
  } catch {
    // Clearing a tiny expired handoff record is best-effort.
  }
}

function pendingNavigation(): PendingNavigation | undefined {
  const memory = self.pendingMistakeNavigation as PendingNavigation | undefined
  if (memory?.runId && memory?.noteId) return memory
  try {
    const stored = getLocalDataByKey(PENDING_NAVIGATION_STORAGE_KEY) as PendingNavigation | undefined
    if (
      stored &&
      typeof stored === "object" &&
      typeof stored.runId === "string" &&
      typeof stored.noteId === "string" &&
      Number.isFinite(stored.createdAtMs) &&
      Date.now() - stored.createdAtMs <= PENDING_NAVIGATION_MAX_AGE_MS
    ) {
      self.pendingMistakeNavigation = stored
      return stored
    }
  } catch {
    // Invalid or unavailable handoff data is treated as absent.
  }
  clearPendingNavigation()
  return undefined
}

function noteIdOf(value: any): string {
  return String(value?.noteId ?? value?.noteid ?? value?.id ?? value?.note?.noteId ?? "").trim()
}

function currentControllerState(): {
  currentNotebookId: string
  controllerNotebookId: string
  focusNoteId: string
  visibleFocusNoteId: string
  mindmapSelectionCount: number
  mindmapSelectionIds: string[]
} {
  const controller = MN.notebookController
  let mindmapSelectionCount = -1
  let mindmapSelectionIds: string[] = []
  try {
    const selectedViews = (controller as any)?.mindmapView?.selViewLst
    const values = selectedViews ? Array.from(selectedViews) : []
    mindmapSelectionCount = selectedViews ? values.length : -1
    mindmapSelectionIds = values.map(noteIdOf).filter(Boolean)
  } catch {
    mindmapSelectionCount = -1
  }
  return {
    currentNotebookId: String(MN.currnetNotebookId ?? ""),
    controllerNotebookId: String(controller?.notebookId ?? ""),
    focusNoteId: noteIdOf(controller?.focusNote),
    visibleFocusNoteId: noteIdOf(controller?.visibleFocusNote),
    mindmapSelectionCount,
    mindmapSelectionIds
  }
}

function debugState(): NavigationDebugState | undefined {
  return self.mistakeNavigationDebug as NavigationDebugState | undefined
}

// 调试日志改为内存环形缓冲（P3-5）：此前每条日志都全量读+写一次存储 JSON，
// 调试模式下可感知卡顿；现在仅在导出时落盘一次。
let runtimeLogBuffer: string[] | undefined

function runtimeDebugLines(): string[] {
  if (runtimeLogBuffer) return runtimeLogBuffer
  try {
    const stored = getLocalDataByKey(RUNTIME_DEBUG_STORAGE_KEY)
    const parsed = typeof stored === "string" && stored ? JSON.parse(stored) : []
    runtimeLogBuffer = Array.isArray(parsed)
      ? parsed.slice(-RUNTIME_DEBUG_MAX_LINES).filter((line): line is string => typeof line === "string").map(line => line.slice(0, 2000))
      : []
  } catch {
    runtimeLogBuffer = []
  }
  return runtimeLogBuffer
}

function pushRuntimeDebugLine(scope: string, message: string): void {
  if (!loadMatcherSettings().debugModeEnabled) return
  try {
    const lines = runtimeDebugLines()
    lines.push(`${new Date().toISOString()} [${scope}] ${message}`)
    if (lines.length > RUNTIME_DEBUG_MAX_LINES) {
      lines.splice(0, lines.length - RUNTIME_DEBUG_MAX_LINES)
    }
  } catch {
    // Diagnostic recording must never affect plugin behavior.
  }
}

/**
 * 统一异常捕获：MN.error（控制台）与运行日志（导出可见）一次调用同时落，
 * 修复此前"只调 MN.error、导出日志里找不到异常"的断层。
 */
export function captureDiagnosticError(error: unknown, scope: string, detail = ""): void {
  try {
    MN.error(error)
  } catch {
    // 控制台输出失败不影响日志记录
  }
  const message = error instanceof Error
    ? error.message + "\n" + String(error.stack || "").slice(0, 400)
    : String(error ?? "")
  recordRuntimeState(scope, "异常", (detail ? detail + " " : "") + message.slice(0, 500))
}

/**
 * 文本脱敏：保留长度与稳定指纹（可判断两次日志是否同卡），不暴露内容本身。
 */
export function maskText(value: unknown): string {
  const text = String(value ?? "")
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  return text.length + "字#" + hash.toString(16).padStart(8, "0")
}

export function recordRuntimeState(scope: string, label: string, detail = ""): void {
  if (!loadMatcherSettings().debugModeEnabled) return
  try {
    const state = currentControllerState()
    const message =
      `${label}` +
      ` currentNotebook=${state.currentNotebookId || "(空)"}` +
      ` controllerNotebook=${state.controllerNotebookId || "(空)"}` +
      ` focus=${state.focusNoteId || "(空)"}` +
      ` visibleFocus=${state.visibleFocusNoteId || "(空)"}` +
      ` sel=${state.mindmapSelectionCount >= 0 ? state.mindmapSelectionCount : "?"}` +
      (detail ? ` ${detail}` : "")
    pushRuntimeDebugLine(scope, message)
    try {
      console.log(`[MN4 运行诊断][${scope}] ${message}`)
    } catch {
      // Console logging is optional.
    }
  } catch (error) {
    pushRuntimeDebugLine(scope, `${label} 状态读取失败=${String(error)}${detail ? ` ${detail}` : ""}`)
  }
}

function debugLog(message: string): void {
  if (!loadMatcherSettings().debugModeEnabled) return
  const state = debugState()
  const elapsed = state ? Math.max(0, Date.now() - state.startedAtMs) : 0
  const line = `[+${elapsed}ms]${state?.runId ? ` [run=${state.runId}]` : ""} ${message}`
  if (state) state.lines.push(line)
  pushRuntimeDebugLine("跳转", line)
  try {
    console.log(`[MN4 错题跳转] ${line}`)
  } catch {
    // Runtime debug logging must never affect navigation.
  }
}

function logControllerState(label: string): void {
  const state = currentControllerState()
  debugLog(
    `${label} currentNotebook=${state.currentNotebookId || "(空)"}` +
    ` controllerNotebook=${state.controllerNotebookId || "(空)"}` +
    ` focus=${state.focusNoteId || "(空)"}` +
    ` visibleFocus=${state.visibleFocusNoteId || "(空)"}` +
    ` sel=${state.mindmapSelectionCount >= 0 ? state.mindmapSelectionCount : "?"}`
  )
}

function activeNavigationRunId(): string {
  try {
    return String(self.mn4NavigationRunId ?? "")
  } catch {
    return ""
  }
}

function isNavigationRunActive(runId: string): boolean {
  return Boolean(runId) && activeNavigationRunId() === runId
}

function startNavigationDebug(noteId: string, notebookId?: string): string {
  const previousRunId = activeNavigationRunId()
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  self.mn4NavigationRunId = runId
  if (previousRunId && previousRunId !== runId) {
    pushRuntimeDebugLine("跳转", `[run=${previousRunId}] 旧定位请求被新请求取消`)
  }
  if (loadMatcherSettings().debugModeEnabled) {
    self.mistakeNavigationDebug = {
      runId,
      startedAtMs: Date.now(),
      noteId,
      notebookId,
      focusCalls: 0,
      lines: []
    } satisfies NavigationDebugState
  } else {
    self.mistakeNavigationDebug = undefined
  }
  debugLog(`开始定位 version=${__APP_VERSION__} noteId=${noteId} notebookId=${notebookId || "(未指定)"}`)
  debugLog(`目标卡片存在=${Boolean(MN.db.getNoteById(noteId))}`)
  logControllerState("初始状态")
  return runId
}

type BookToMindMapSyncState = "on" | "off" | "unknown"

interface SyncStateProbe {
  state: BookToMindMapSyncState
  source: string
  raw: string
  error?: string
}

function logValue(value: unknown): string {
  try {
    if (value === undefined) return "undefined"
    if (value === null) return "null"
    if (typeof value === "object") return JSON.stringify(value)
    return String(value)
  } catch {
    return String(value)
  }
}

function normalizeSyncState(value: unknown): BookToMindMapSyncState {
  if (value === true || value === 1 || value === "1" || value === "true") return "on"
  if (value === false || value === 0 || value === "0" || value === "false") return "off"
  try {
    if (value && typeof value === "object" && "boolValue" in value) {
      const bridged = typeof (value as any).boolValue === "function"
        ? (value as any).boolValue()
        : (value as any).boolValue
      return normalizeSyncState(bridged)
    }
  } catch {
    // Continue as unknown when an Objective-C bridge value cannot be read.
  }
  return "unknown"
}

function bookToMindMapSyncState(): SyncStateProbe {
  let priorError = ""
  try {
    if (typeof MNCommand !== "undefined" && typeof MNCommand.canSyncBookToMindMap === "function") {
      const checked = MNCommand.canSyncBookToMindMap()
      const state = normalizeSyncState(checked)
      if (state !== "unknown") {
        return { state, source: "MNCommand.canSyncBookToMindMap", raw: logValue(checked) }
      }
      priorError = `MNCommandRaw=${logValue(checked)}`
    }
  } catch (error) {
    priorError = `MNCommand=${String(error)}`
    // MN Utils is optional; fall through to the host command state when possible.
  }
  try {
    const app = MN.app as any
    const window = self.window ?? MN.currentWindow ?? app?.focusWindow
    const command = app?.queryCommandWithKeyFlagsInWindow?.("SyncBookToMindMap", 0, window)
    const checked = typeof command?.checked === "function" ? command.checked() : command?.checked
    return {
      state: normalizeSyncState(checked),
      source: "MN.app.queryCommandWithKeyFlagsInWindow",
      raw: logValue(checked),
      error: priorError || undefined
    }
  } catch (error) {
    priorError = `${priorError}${priorError ? "; " : ""}hostCommand=${String(error)}`
    // Unknown state must retain the public API path.
  }
  return { state: "unknown", source: "unavailable", raw: "undefined", error: priorError || undefined }
}

// 官方文档钦定的脑图卡片聚焦入口：滚动 + 高亮合一（cookbook/focus-note-in-mindmap）。
function focusNoteInMindmapByOfficialApi(noteId: string): void {
  MN.studyController.focusNoteInMindMapById(noteId)
}

export type MindMapFocusModeResult = "focused" | "unavailable" | "failed"

export async function focusNoteInMindMapFocusMode(noteId: string): Promise<MindMapFocusModeResult> {
  const target = MN.db.getNoteById(noteId)
  const controller = MN.notebookController as any
  if (!target || typeof controller?.changeFocusToNote !== "function") {
    debugLog(`无法进入焦点模式 target=${Boolean(target)} changeFocus=${typeof controller?.changeFocusToNote}`)
    return "unavailable"
  }
  try {
    controller.changeFocusToNote(target)
    debugLog("已将目标卡片设为脑图焦点根节点")
    // changeFocusToNote 会重建焦点脑图与画布；必须等布局完成后再执行官方
    // 定位，否则先前的滚动位置会被重建过程覆盖，部分卡片无法居中。
    await delay(0.08)
    focusNoteInMindmapByOfficialApi(noteId)
    await delay(0.06)
    // 焦点模式会清空普通选中态，focusNote / visibleFocusNote 不保证继续指向
    // 根卡片，不能复用普通定位的 isTargetFocused 判据。原生切焦与定位均未
    // 抛错即视为已派发；最终视图效果由 MarginNote 接管。
    debugLog("已进入焦点模式并在布局完成后重新派发目标卡片定位")
    return "focused"
  } catch (error) {
    debugLog(`进入目标卡片焦点模式或重新居中失败=${String(error)}`)
    return "failed"
  }
}

export type FloatMindMapFocusResult = "dispatched" | "unavailable" | "failed"

interface FloatMindMapFrameSnapshot {
  container: any
  frame: { x: number; y: number; width: number; height: number }
}

function belongsToCurrentStudyView(view: any): boolean {
  try {
    const studyView = MN.studyController?.view
    let cursor = view
    while (cursor) {
      if (cursor === studyView) return true
      cursor = cursor.superview
    }
  } catch {
    return false
  }
  return false
}

function cachedFloatMindMapView(): any {
  try {
    const cached = self.answerNativeFloatMindMapView
    if (cached?.superview && belongsToCurrentStudyView(cached)) return cached
    const fromMNUtil = typeof MNUtil !== "undefined" ? (MNUtil as any).floatMindMapView : undefined
    if (fromMNUtil?.superview && belongsToCurrentStudyView(fromMNUtil)) return fromMNUtil
  } catch {
    // 继续尝试从当前视图树中识别。
  }
  return undefined
}

function visibleView(view: any): boolean {
  if (!view?.superview) return false
  let cursor = view
  while (cursor) {
    if (cursor.hidden) return false
    cursor = cursor.superview
  }
  return true
}

function discoverFloatMindMapView(): any {
  const cached = cachedFloatMindMapView()
  if (cached) return cached
  try {
    const controller = MN.studyController as any
    const root = controller?.view
    const mainMindMap = controller?.notebookController?.mindmapView
    if (!root) return undefined
    const queue = Array.from(root.subviews || []) as any[]
    let inspected = 0
    while (queue.length && inspected < 800) {
      const candidate = queue.shift()
      inspected += 1
      if (!candidate) continue
      if (candidate !== mainMindMap) {
        try {
          if (candidate.mindmapNodes !== undefined || candidate.selViewLst !== undefined) {
            self.answerNativeFloatMindMapView = candidate
            return candidate
          }
        } catch {
          // 部分原生 UIView 不接受未知属性读取。
        }
      }
      try { queue.push(...Array.from(candidate.subviews || [])) } catch { /* bridge-safe traversal */ }
    }
  } catch {
    // 未识别到视图时保留原生 API 的默认行为。
  }
  return undefined
}

function topLevelFloatContainer(floatView: any): any {
  const studyView = MN.studyController?.view
  let container = floatView
  while (container?.superview && container.superview !== studyView) container = container.superview
  return container?.superview === studyView ? container : undefined
}

/**
 * AddonLib 在真机识别过浮动脑图后会留下 floatMindMapView。它不是稳定公开接口，
 * 因此这里只在对象已存在时保存其顶层容器 frame；无法识别时完全不碰宿主布局。
 */
function captureFloatMindMapFrame(): FloatMindMapFrameSnapshot | undefined {
  try {
    const studyView = MN.studyController?.view
    let container = discoverFloatMindMapView()
    if (!studyView || !container || !visibleView(container)) return
    container = topLevelFloatContainer(container)
    if (!container) return
    const frame = container.frame
    if (![frame?.x, frame?.y, frame?.width, frame?.height].every(Number.isFinite)) return
    return {
      container,
      frame: { x: Number(frame.x), y: Number(frame.y), width: Number(frame.width), height: Number(frame.height) }
    }
  } catch {
    return
  }
}

function restoreFloatMindMapFrame(snapshot: FloatMindMapFrameSnapshot | undefined): void {
  try {
    if (!snapshot) return
    const currentContainer = topLevelFloatContainer(discoverFloatMindMapView()) ?? snapshot.container
    if (currentContainer?.superview) currentContainer.frame = snapshot.frame
  } catch {
    // 未公开宿主视图可能随版本变化；位置恢复失败不能阻断答案定位。
  }
}

/**
 * MarginNote 4 runtime API for its native floating card-source window.
 * The method is present in the host/AddonLib but absent from the public npm
 * typings, so it must remain capability-detected. The host exposes no readable
 * float-focus state; successful dispatch means the method existed and returned
 * without throwing, while device validation remains the final confirmation.
 */
export async function focusNoteInFloatMindMap(noteId: string): Promise<FloatMindMapFocusResult> {
  const controller = MN.studyController as any
  const focus = controller?.focusNoteInFloatMindMapById
  if (typeof focus !== "function") {
    recordRuntimeState("答案浮窗", "运行时接口不可用", `answerNoteId=${noteId}`)
    return "unavailable"
  }
  try {
    const existingFloatView = discoverFloatMindMapView()
    if (self.answerNativeFloatLastNoteId === noteId && visibleView(existingFloatView)) {
      recordRuntimeState("答案浮窗", "浮窗已显示目标答案，跳过重复聚焦", `answerNoteId=${noteId}`)
      return "dispatched"
    }
    const frameSnapshot = captureFloatMindMapFrame()
    focus.call(controller, noteId)
    await delay(0.12)
    restoreFloatMindMapFrame(frameSnapshot)
    discoverFloatMindMapView()
    self.answerNativeFloatLastNoteId = noteId
    recordRuntimeState("答案浮窗", "已派发浮窗聚焦", `answerNoteId=${noteId}`)
    return "dispatched"
  } catch (error) {
    captureDiagnosticError(error, "答案浮窗", `answerNoteId=${noteId}`)
    return "failed"
  }
}

const LOCATE_SYNC_OFF_HINT =
  "跳转失败，请检查脑图文档同步模式是否已设为“双向同步”或者“从文档定位到脑图”"

const LOCATE_TIMEOUT_HINT = "已发出跳转请求，但 MarginNote 暂未完成响应，请稍候后重试"

const LOCATE_FOCUS_MODE_HINT = "已定位目标卡片，但未能进入焦点模式，请稍后重试"

function isTargetFocused(noteId: string): boolean {
  const state = currentControllerState()
  return state.focusNoteId === noteId ||
    state.visibleFocusNoteId === noteId ||
    state.mindmapSelectionIds.includes(noteId)
}

async function waitForTargetFocus(noteId: string, runId: string, attempts: number): Promise<boolean> {
  for (let index = 0; index < attempts; index++) {
    if (!isNavigationRunActive(runId)) return false
    if (isTargetFocused(noteId)) return true
    await delay(index < 3 ? 0.05 : 0.12)
  }
  return isTargetFocused(noteId)
}

type FocusResult = "focused" | "sync-off" | "failed"

async function focusWithFallback(noteId: string, runId: string): Promise<FocusResult> {
  focusNoteInMindmapByOfficialApi(noteId)
  debugLog("已派发官方聚焦 focusNoteInMindMapById")
  if (await waitForTargetFocus(noteId, runId, 5)) return "focused"

  const sync = bookToMindMapSyncState()
  debugLog(`官方聚焦未落地；同步开关 source=${sync.source} raw=${sync.raw} 判定=${sync.state}`)
  if (sync.state === "off") return "sync-off"

  // locateexp.4：仅在官方 focus 真实失败后恢复 UI 状态，不把同步开关当作成功判据。
  const notebookId = String(MN.currnetNotebookId ?? "")
  try {
    if (typeof MNUtil?.setUIStatusByConfigAsync === "function") {
      await MNUtil.setUIStatusByConfigAsync({ topicid: notebookId, mapsellst: [noteId] })
      debugLog("官方聚焦未落地，已尝试恢复脑图 UI 状态")
    }
  } catch (error) {
    debugLog(`恢复脑图 UI 状态失败=${String(error)}`)
  }
  if (await waitForTargetFocus(noteId, runId, 3)) return "focused"
  try {
    if (typeof MNUtil?.selectNotesInMindmap === "function") {
      await MNUtil.selectNotesInMindmap([noteId], false)
      debugLog("UI 状态恢复未落地，已尝试选择目标卡片")
    }
  } catch (error) {
    debugLog(`选择目标卡片失败=${String(error)}`)
  }
  return await waitForTargetFocus(noteId, runId, 4) ? "focused" : "failed"
}

export function consumePendingLocateHint(): string | undefined {
  const hint = typeof self.mn4PendingLocateHint === "string" ? self.mn4PendingLocateHint : undefined
  self.mn4PendingLocateHint = undefined
  return hint
}

async function locateJumpInCurrentStudySet(
  noteId: string,
  runId: string,
  enterFocusMode = false
): Promise<string | undefined> {
  const result = await focusWithFallback(noteId, runId)
  if (result === "focused") {
    debugLog("已确认目标卡片成为焦点或选中项")
    if (enterFocusMode) {
      const focusModeResult = await focusNoteInMindMapFocusMode(noteId)
      if (focusModeResult !== "focused") {
        clearPendingNavigation(runId)
        return LOCATE_FOCUS_MODE_HINT
      }
    }
    clearPendingNavigation(runId)
    return undefined
  }
  clearPendingNavigation(runId)
  return result === "sync-off" ? LOCATE_SYNC_OFF_HINT : LOCATE_TIMEOUT_HINT
}

async function locateJumpCrossStudySet(
  noteId: string,
  notebookId: string,
  runId: string,
  enterFocusMode: boolean
): Promise<string | undefined> {
  // 持久化接力记录：MarginNote 真机可能在 openURL 返回 false 后仍完成学习集切换，
  // 切换完成由 notebookWillOpen → completePendingNoteNavigation 接力聚焦。
  savePendingNavigation({ runId, noteId, notebookId, createdAtMs: Date.now(), enterFocusMode }, true)
  // 跨学习集跳转会触发宿主切换笔记本；记录时间戳供面板恢复时跳过一次自动
  // 刷新——跳转不改变错题数据，恢复触发的 load() 属于多余刷新且会让列表
  // 滚动位置丢失（消费与清除在 WebAddon.shouldSuppressPanelReload）。
  self.mn4LocateJumpStartedAtMs = Date.now()
  const url = noteReferenceUrl(noteId)
  debugLog(`跨学习集，派发唯一官方 openURL=${url}`)
  try {
    MN.app.openURL(genNSURL(url, true))
  } catch (error) {
    debugLog(`openURL 抛错=${String(error)}`)
  }
  for (let index = 0; index < 30; index++) {
    if (!isNavigationRunActive(runId)) return undefined
    if (String(MN.currnetNotebookId ?? "") === notebookId) {
      debugLog("已确认切换到目标学习集")
      return locateJumpInCurrentStudySet(noteId, runId, enterFocusMode)
    }
    await delay(0.1)
  }
  debugLog("等待目标学习集超时；保留 pending 供 notebookWillOpen 延迟接力")
  return LOCATE_TIMEOUT_HINT
}

export async function openNoteInMindMap(
  noteId: string,
  notebookId?: string,
  options: OpenNoteInMindMapOptions = {}
): Promise<string | undefined> {
  if (!noteId) throw new Error("目标卡片缺少 noteId")
  if (!MN.db.getNoteById(noteId)) throw new Error("目标卡片不存在或尚未同步")

  const actualNotebookId = String((MN.db.getNoteById(noteId) as any)?.notebookId ?? notebookId ?? "").trim()
  const activePending = pendingNavigation()
  if (activePending && isNavigationRunActive(activePending.runId)) {
    return "上一条定位请求仍在处理中，请稍候"
  }
  const runId = startNavigationDebug(noteId, actualNotebookId || undefined)
  if (actualNotebookId && String(MN.currnetNotebookId ?? "") !== actualNotebookId) {
    // 跨学习集：先派发链接完成切换，聚焦由 notebookWillOpen 接力执行
    return await locateJumpCrossStudySet(noteId, actualNotebookId, runId, options.enterFocusMode === true)
  }
  // 官方跳转指令 + 同步开关检测：关闭时面板顶栏下提示检查关联模式
  return await locateJumpInCurrentStudySet(noteId, runId, options.enterFocusMode === true)
}

export async function completePendingNoteNavigation(openedNotebookId?: string): Promise<void> {
  const target = pendingNavigation()
  debugLog(`notebookWillOpen openedNotebookId=${openedNotebookId || "(空)"}`)
  if (!target) {
    debugLog("notebookWillOpen 时没有 pending 目标")
    return
  }
  if (target.notebookId && openedNotebookId && target.notebookId !== openedNotebookId) {
    debugLog(`忽略非目标学习集 opened=${openedNotebookId} target=${target.notebookId}`)
    return
  }
  if (activeNavigationRunId() !== target.runId) {
    self.mn4NavigationRunId = target.runId
    debugLog(`从跨学习集接力记录恢复定位 run=${target.runId}`)
  }
  if (!isNavigationRunActive(target.runId)) {
    debugLog(`忽略已取消的 pending 定位 run=${target.runId}`)
    return
  }

  await delay(0.2)
  // 学习集切换完成后由接力派发官方聚焦；同步关闭时同样提示检查关联模式。
  const hint = await locateJumpInCurrentStudySet(target.noteId, target.runId, target.enterFocusMode === true)
  if (hint) self.mn4PendingLocateHint = hint
}

function runtimeLogText(): string {
  const state = debugState()
  // 导出只复制已记录的事件，不在用户点击时同步遍历原生选中视图。
  const runtimeLines = runtimeDebugLines().slice()
  const header = [
    "MN4 插件运行调试日志",
    `version=${__APP_VERSION__}`,
    `exportedAt=${new Date().toISOString()}`
  ]
  const output = [
    ...header,
    "",
    "=== 全局运行事件时间线 ===",
    ...(runtimeLines.length ? runtimeLines : ["暂无运行事件记录。"])
  ]
  if (!state) {
    return [...output, "", "=== 最近一次定位原题 ===", "暂无定位原题运行记录。"].join("\n")
  }
  return [
    ...output,
    "",
    "=== 最近一次定位原题 ===",
    `startedAt=${new Date(state.startedAtMs).toISOString()}`,
    `targetNoteId=${state.noteId}`,
    `targetNotebookId=${state.notebookId || ""}`,
    `focusCalls=${state.focusCalls}`,
    "",
    ...state.lines
  ].join("\n")
}

let runtimeLogExportPending = false
export function exportNavigationRuntimeLog(): { saved: true; filename: string } {
  if (!loadMatcherSettings().debugModeEnabled) throw new Error("请先开启调试模式")
  if (runtimeLogExportPending) throw new Error("日志保存面板正在打开，请勿重复导出")
  const started = Date.now()
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
  const filename = `MN4运行日志-${__APP_VERSION__}-${stamp}.txt`
  const directory = cardLinkTempPath("logs")
  if (!directory || !ensureStorageDirectory(directory)) throw new Error("运行日志临时目录不可用")
  const path = `${directory}/${filename}`
  writeTextFile(path, `\uFEFF${runtimeLogText()}`)
  pushRuntimeDebugLine("日志", `生成并写入完成 durationMs=${Date.now() - started}`)
  runtimeLogExportPending = true
  // 恢复 beta.2 的直接保存调用，不再人为延迟或追加 HUD 桥往返。
  try {
      pushRuntimeDebugLine("日志", `调用系统保存面板 elapsedMs=${Date.now() - started}`)
      saveFile(path, "public.plain-text")
      pushRuntimeDebugLine("日志", `系统保存调用返回 elapsedMs=${Date.now() - started}`)
  } catch (error) {
      pushRuntimeDebugLine("日志", `保存面板调起失败 ${String(error)}`)
      throw error
  } finally {
      runtimeLogExportPending = false
  }
  return { saved: true, filename }
}

export function clearNavigationRuntimeLog(): void {
  try {
    runtimeLogBuffer = []
    setLocalDataByKey("", RUNTIME_DEBUG_STORAGE_KEY)
    self.mistakeNavigationDebug = undefined
  } catch {
    // Clearing diagnostics must never affect plugin behavior.
  }
}
