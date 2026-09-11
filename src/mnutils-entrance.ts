import { showHUD } from "marginnote"
import { resetAnswerCardPosition } from "./answer-card-view"
import { UI_COLORS } from "./ui-tokens"

const ENTRANCE_SIZE = 44
const EDGE_MARGIN = 18
const INITIAL_TOP = 64

type DockEdge = "left" | "right" | "top" | "bottom"

interface EntranceDock {
  edge: DockEdge
  ratio: number
}

function mnutilsButtonAvailable(): boolean {
  try {
    return typeof MNButton !== "undefined" && typeof MNUtil !== "undefined"
  } catch {
    return false
  }
}

function windowSize(window: any): { width: number; height: number } {
  const width = Number(window?.bounds?.width ?? window?.frame?.width ?? 0)
  const height = Number(window?.bounds?.height ?? window?.frame?.height ?? 0)
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0
  }
}

function clampEntranceFrame(button: any): void {
  const window = button?.button?.superview ?? button?.window
  const { width, height } = windowSize(window)
  if (width <= 0 || height <= 0) return
  const frame = button.frame
  const x = Math.min(Math.max(Number(frame.x), EDGE_MARGIN), Math.max(EDGE_MARGIN, width - ENTRANCE_SIZE - EDGE_MARGIN))
  const y = Math.min(Math.max(Number(frame.y), EDGE_MARGIN), Math.max(EDGE_MARGIN, height - ENTRANCE_SIZE - EDGE_MARGIN))
  button.frame = { x, y, width: ENTRANCE_SIZE, height: ENTRANCE_SIZE }
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function dockedFrame(window: any, dock: EntranceDock): any {
  const { width, height } = windowSize(window)
  const horizontalRange = Math.max(0, width - ENTRANCE_SIZE - EDGE_MARGIN * 2)
  const verticalRange = Math.max(0, height - ENTRANCE_SIZE - EDGE_MARGIN * 2)
  if (dock.edge === "left" || dock.edge === "right") {
    return {
      x: dock.edge === "left" ? EDGE_MARGIN : width - ENTRANCE_SIZE - EDGE_MARGIN,
      y: EDGE_MARGIN + verticalRange * clampRatio(dock.ratio),
      width: ENTRANCE_SIZE,
      height: ENTRANCE_SIZE
    }
  }
  return {
    x: EDGE_MARGIN + horizontalRange * clampRatio(dock.ratio),
    y: dock.edge === "top" ? EDGE_MARGIN : height - ENTRANCE_SIZE - EDGE_MARGIN,
    width: ENTRANCE_SIZE,
    height: ENTRANCE_SIZE
  }
}

function nearestDock(button: any, window: any): EntranceDock {
  const { width, height } = windowSize(window)
  const frame = button.frame
  const distances: Record<DockEdge, number> = {
    left: Math.abs(Number(frame.x)),
    right: Math.abs(width - Number(frame.x) - ENTRANCE_SIZE),
    top: Math.abs(Number(frame.y) - EDGE_MARGIN),
    bottom: Math.abs(height - Number(frame.y) - ENTRANCE_SIZE - EDGE_MARGIN)
  }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((closest, candidate) =>
    distances[candidate] < distances[closest] ? candidate : closest
  )
  const ratio = edge === "left" || edge === "right"
    ? (Number(frame.y) - EDGE_MARGIN) / Math.max(1, height - ENTRANCE_SIZE - EDGE_MARGIN * 2)
    : (Number(frame.x) - EDGE_MARGIN) / Math.max(1, width - ENTRANCE_SIZE - EDGE_MARGIN * 2)
  return { edge, ratio: clampRatio(ratio) }
}

function applyDock(button: any, window: any, dock: EntranceDock, animated: boolean): void {
  const target = dockedFrame(window, dock)
  const update = () => { button.frame = target }
  if (animated && typeof MNUtil.animate === "function") {
    self.mnutilsEntranceAnimating = true
    Promise.resolve(MNUtil.animate(update)).then(() => {
      self.mnutilsEntranceAnimating = false
      button.frame = target
    }, () => {
      self.mnutilsEntranceAnimating = false
      button.frame = target
    })
  } else {
    update()
  }
}

/** MN Utils 可用时，在当前窗口右上方创建独立的插件入口；缺失时静默跳过。 */
export function ensureMnutilsEntrance(): void {
  if (!mnutilsButtonAvailable()) return
  try {
    const window = MNUtil.currentWindow ?? self.window
    if (!window) return
    const existing = self.mnutilsEntranceBall
    if (existing?.window === window && existing?.superview) {
      if (!self.mnutilsEntranceDragging && !self.mnutilsEntranceAnimating) {
        const dock = self.mnutilsEntranceDock as EntranceDock | undefined
        dock ? applyDock(existing, window, dock, false) : clampEntranceFrame(existing)
      }
      return
    }
    existing?.removeFromSuperview?.()
    const { width, height } = windowSize(window)
    if (width <= 0 || height <= 0) return

    const button = MNButton.new({
      color: UI_COLORS.grayFill,
      radius: ENTRANCE_SIZE / 2,
      alpha: 0.72
    }, window)
    button.alpha = 0.72
    if (button.button) button.button.alpha = 0.72
    button.frame = {
      x: width - ENTRANCE_SIZE - EDGE_MARGIN,
      y: Math.min(INITIAL_TOP, Math.max(EDGE_MARGIN, height - ENTRANCE_SIZE - EDGE_MARGIN)),
      width: ENTRANCE_SIZE,
      height: ENTRANCE_SIZE
    }
    // self.path 在 JSB 运行时里是 undefined，图标因此加载失败只剩蓝底；
    // 插件目录存在 self.mainPath（sceneWillConnect 时由 JSB.newAddon(mainPath) 赋值）。
    button.setImage(`${self.mainPath}/logo.png`, 2)
    // MNButton 的公开用法是静态 helper，并把底层 UIButton 作为第一个参数；
    // 实例方法在真机上不会安装长按识别器。
    button.addClickAction(self, "onMnutilsEntranceClick:")
    button.addPanGesture(self, "onMnutilsEntrancePan:")
    MNButton.addLongPressGesture(button.button ?? button, self, "onMnutilsEntranceLongPress:", 1)
    window.bringSubviewToFront?.(button.button)
    self.mnutilsEntranceBall = button
    self.mnutilsEntranceDock = self.mnutilsEntranceDock ?? {
      edge: "right",
      ratio: clampRatio((Number(button.frame.y) - EDGE_MARGIN) / Math.max(1, height - ENTRANCE_SIZE - EDGE_MARGIN * 2))
    }
    applyDock(button, window, self.mnutilsEntranceDock, false)
  } catch (error) {
    try { console.log("MNButton 第二入口创建失败:", String(error)) } catch { /* optional */ }
  }
}

export function removeMnutilsEntrance(): void {
  try { self.mnutilsEntranceBall?.removeFromSuperview?.() } catch { /* optional dependency */ }
  self.mnutilsEntranceBall = undefined
  self.mnutilsEntranceDragging = false
  self.mnutilsEntranceAnimating = false
  self.mnutilsEntranceDragOffset = undefined
}

export function onMnutilsEntranceClick(_sender: any): void {
  try {
    if (Date.now() - Number(self.mnutilsEntranceSuppressClick ?? 0) < 1500) {
      self.mnutilsEntranceSuppressClick = 0
      return
    }
    // 只走已经用于主工具栏的稳定面板生命周期。beta.64 新增的自绘原生
    // 快捷菜单是单击独有的崩溃面，且重复实现了设置页已有的控制入口。
    const panel = __MNAM_WEB_PANEL_GLOBAL__
    const controller = self.webController
    if (panel.isVisible?.(controller)) panel.hidePanel(controller, true)
    else panel.showPanel(controller)
    const study = Application.sharedInstance().studyController(self.window)
    study?.refreshAddonCommands?.()
  } catch (error) {
    try { console.log("MNButton 第二入口打开快捷菜单失败:", String(error)) } catch { /* optional */ }
  }
}

/** 长按/快捷菜单触发：面板与答案窗口分别判断、互不阻断。
 *  v61 缺陷修复：此前面板不可见时直接 return，答案窗口复位永远执行不到。 */
function performEntranceReset(): void {
  try {
    let restored = false
    try {
      const controller = self.webController
      // 预载的 WebView 也可能隐藏；只复位实际打开的窗口。
      if (controller && controller.webView && __MNAM_WEB_PANEL_GLOBAL__.isVisible(controller)) {
        const result = __MNAM_WEB_PANEL_GLOBAL__.resetFrame(controller)
        restored = result?.reset === true || restored
      }
    } catch (error) {
      try { console.log("插件面板位置复原失败:", String(error)) } catch { /* optional */ }
    }
    try {
      if (self.answerCardView && !self.answerCardView.hidden && self.answerCardView.superview) {
        resetAnswerCardPosition()
        restored = true
      }
    } catch (error) {
      try { console.log("答案窗口位置复原失败:", String(error)) } catch { /* optional */ }
    }
    showHUD(restored ? "已复原插件面板与答案窗口位置" : "没有可复原的窗口", 3)
  } catch (error) {
    try { console.log("MNButton 第二入口长按复位失败:", String(error)) } catch { /* optional */ }
  }
}

export function onMnutilsEntranceLongPress(sender: any): void {
  try {
    // 与 MNButton 官方示例一致，只响应 UIGestureRecognizerState.began。
    if (!sender || sender.state !== 1) return
    self.mnutilsEntranceSuppressClick = Date.now()
    performEntranceReset()
  } catch (error) {
    try { console.log("MNButton 第二入口长按复位失败:", String(error)) } catch { /* optional */ }
  }
}

export function onMnutilsEntrancePan(sender: any): void {
  const button = self.mnutilsEntranceBall
  if (!button) return
  try {
    const state = Number(sender?.state)
    const window = button.button?.superview ?? button.window ?? self.window ?? MNUtil.currentWindow
    if (!window) return
    const location = sender.locationInView?.(window)
    if (!location) return
    const frame = button.frame
    if (state === 1) {
      self.mnutilsEntranceDragging = true
      self.mnutilsEntranceDock = undefined
      self.mnutilsEntranceDragOffset = {
        x: Number(location.x) - Number(frame.x),
        y: Number(location.y) - Number(frame.y)
      }
      return
    }
    const offset = self.mnutilsEntranceDragOffset
    if (!offset) return
    button.frame = {
      x: Number(location.x) - Number(offset.x),
      y: Number(location.y) - Number(offset.y),
      width: ENTRANCE_SIZE,
      height: ENTRANCE_SIZE
    }
    clampEntranceFrame(button)
    if (state === 3 || state === 4 || state === 5) {
      self.mnutilsEntranceDragging = false
      self.mnutilsEntranceDragOffset = undefined
      const dock = nearestDock(button, window)
      self.mnutilsEntranceDock = dock
      applyDock(button, window, dock, true)
    }
  } catch (error) {
    self.mnutilsEntranceDragging = false
    self.mnutilsEntranceDragOffset = undefined
    try { console.log("MNButton 第二入口拖动失败:", String(error)) } catch { /* optional */ }
  }
}
