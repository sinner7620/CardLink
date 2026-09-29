import { MN } from "marginnote"
import { freePositionFrame, isFrameFullyOutside } from "./answer-card-layout"
import {
  createWindowControlButton,
  answerControlBarLayout,
  normalizeWindowControlSide,
  storedWindowControlSide,
  ANSWER_BAR_DRAG_STRIP_HEIGHT,
  type WindowControlSide
} from "./window-controls"

const ANSWER_WINDOW_Z_POSITION = 100000
const ANSWER_WINDOW_FRONT_INTERVAL = 0.25

function keepAnswerCardInFront(): void {
  const view = self.answerCardView
  if (!view || view.hidden || !view.superview) return
  view.layer.zPosition = ANSWER_WINDOW_Z_POSITION
  view.superview.bringSubviewToFront?.(view)
}

function stopAnswerCardFrontCorrection(): void {
  self.answerCardFrontTimer?.invalidate?.()
  self.answerCardFrontTimer = undefined
}

function startAnswerCardFrontCorrection(): void {
  stopAnswerCardFrontCorrection()
  keepAnswerCardInFront()
  self.answerCardFrontTimer = NSTimer.scheduledTimerWithTimeInterval(
    ANSWER_WINDOW_FRONT_INTERVAL,
    true,
    keepAnswerCardInFront
  )
}

function layoutAnswerCardWindowControls(width: number, side: WindowControlSide = storedWindowControlSide()): void {
  if (!self.answerCardView) return
  const candidatesVisible = Boolean(self.answerCandidatesButton && !self.answerCandidatesButton.hidden)
  const frames = answerControlBarLayout(width, side, candidatesVisible)
  self.answerCardControlBar.frame = frames.bar
  self.answerCardCloseButton.frame = frames.close
  self.answerCardLocateButton.frame = frames.locate
  self.answerCardRefreshButton.frame = frames.refresh
  // 拖动区覆盖顶部整条：关闭/刷新/候选控件叠于其上（可点），其余区域拖动窗口
  if (self.answerCardDragArea) self.answerCardDragArea.frame = { x: 0, y: 0, width, height: ANSWER_BAR_DRAG_STRIP_HEIGHT }
  if (self.answerCandidatesButton) {
    self.answerCandidatesButton.frame = frames.candidates
  }
}

function reducedMotionEnabled(): boolean {
  try {
    const accessibility = (globalThis as any).UIAccessibility
    return accessibility?.isReduceMotionEnabled?.() === true || accessibility?.isReduceMotionEnabled === true
  } catch (_) {
    return false
  }
}

/** 以布局函数的标准帧为基准缩放整枚胶囊，避免多次按压累积几何误差。 */
function applyAnswerControlJellyScale(scaleX: number, scaleY: number): void {
  if (!self.answerCardView || !self.answerCardControlBar) return
  const width = Number(self.answerCardView.frame.width)
  const candidatesVisible = Boolean(self.answerCandidatesButton && !self.answerCandidatesButton.hidden)
  const frames = answerControlBarLayout(width, storedWindowControlSide(), candidatesVisible)
  const scaledWidth = frames.bar.width * scaleX
  const scaledHeight = frames.bar.height * scaleY
  self.answerCardControlBar.frame = {
    x: frames.bar.x + (frames.bar.width - scaledWidth) / 2,
    y: frames.bar.y + (frames.bar.height - scaledHeight) / 2,
    width: scaledWidth,
    height: scaledHeight
  }
  const scaleSlot = (slot: { x: number; y: number; width: number; height: number }) => ({
    x: slot.x * scaleX,
    y: slot.y * scaleY,
    width: slot.width * scaleX,
    height: slot.height * scaleY
  })
  self.answerCardCloseButton.frame = scaleSlot(frames.close)
  self.answerCardLocateButton.frame = scaleSlot(frames.locate)
  self.answerCardRefreshButton.frame = scaleSlot(frames.refresh)
  if (self.answerCandidatesButton) self.answerCandidatesButton.frame = scaleSlot(frames.candidates)
}

function animateAnswerControlJelly(scaleX: number, scaleY: number): Promise<unknown> {
  const update = () => applyAnswerControlJellyScale(scaleX, scaleY)
  if (reducedMotionEnabled() || typeof MNUtil.animate !== "function") {
    update()
    return Promise.resolve()
  }
  return Promise.resolve(MNUtil.animate(update))
}

/** 任一按钮按下时，整枚胶囊先横向收紧、纵向鼓起。 */
export function onAnswerControlPress(): void {
  const token = Number(self.answerControlJellyToken || 0) + 1
  self.answerControlJellyToken = token
  void animateAnswerControlJelly(0.94, 1.08)
}

/** 松手后做两段过冲并回到标准帧，形成克制的果冻回弹。 */
export function onAnswerControlRelease(): void {
  const token = Number(self.answerControlJellyToken || 0) + 1
  self.answerControlJellyToken = token
  if (reducedMotionEnabled()) {
    applyAnswerControlJellyScale(1, 1)
    return
  }
  void animateAnswerControlJelly(1.04, 0.96)
    .then(() => token === self.answerControlJellyToken && animateAnswerControlJelly(0.985, 1.02))
    .then(() => token === self.answerControlJellyToken && animateAnswerControlJelly(1, 1))
}

/** 同步悬浮条内候选控件的标题/可见性；点击后由原生选择弹窗承接。 */
export function syncAnswerCandidatesControl(
  candidates: Array<{ id: string; title: string; standard: boolean }>,
  currentIndex: number
): void {
  if (!self.answerCardView || !self.answerCandidatesButton) return
  const count = candidates.length
  if (count < 2) {
    self.answerCandidatesButton.hidden = true
    layoutAnswerCardWindowControls(self.answerCardView.frame.width)
    return
  }
  const safeIndex = currentIndex >= 0 && currentIndex < count ? currentIndex : 0
  self.answerCandidatesButton.setTitleForState(String(safeIndex + 1), 0)
  self.answerCandidatesButton.hidden = false
  layoutAnswerCardWindowControls(self.answerCardView.frame.width)
}

export function showAnswerCard(html: string): void {
  const host = MN.studyController.view
  const hostFrame = host.bounds
  const defaultWidth = Math.max(280, Math.min(620, hostFrame.width - 24))
  const defaultHeight = Math.max(320, Math.min(720, hostFrame.height - 56))
  const defaultFrame = {
    x: Math.max(12, (hostFrame.width - defaultWidth) / 2),
    y: Math.max(20, (hostFrame.height - defaultHeight) / 2),
    width: defaultWidth,
    height: defaultHeight
  }

  if (!self.answerCardView) {
    const container = new UIView(defaultFrame)
    container.layer.cornerRadius = 12
    container.layer.masksToBounds = false
    const layer = container.layer as any
    layer.shadowColor = UIColor.blackColor()
    layer.shadowOffset = { width: 0, height: 3 }
    layer.shadowRadius = 10
    layer.shadowOpacity = 0.35

    const webView = new UIWebView({ x: 0, y: 0, width: defaultWidth, height: defaultHeight })
    webView.scalesPageToFit = false
    webView.autoresizingMask = (1 << 1) | (1 << 4)
    webView.layer.cornerRadius = 12
    webView.layer.masksToBounds = true
    container.addSubview(webView)

    // 顶部整条都是拖动区：先加入（垫在控件底层），关闭/刷新/候选控件叠于其上——
    // 控件本身可点，控件之间的空隙与留白都能拖动窗口。
    const dragArea = new UIView({ x: 0, y: 0, width: defaultWidth, height: ANSWER_BAR_DRAG_STRIP_HEIGHT })
    dragArea.autoresizingMask = 0
    dragArea.backgroundColor = UIColor.blackColor().colorWithAlphaComponent(0.001)
    // 构造器 (target, action) 即完成注册；再调 addTargetAction 会重复注册导致回调双发。
    const dragGesture = new UIPanGestureRecognizer(self, "onAnswerCardPan:")
    dragArea.addGestureRecognizer(dragGesture)
    container.addSubview(dragArea)

    // 悬浮条初始帧取自同一布局函数（双控件形态），创建与重排永远同源。
    const initialBar = answerControlBarLayout(defaultWidth, storedWindowControlSide(), false).bar
    const controlBar = new UIView(initialBar)
    controlBar.backgroundColor = UIColor.colorWithHexString("#fcfcfd").colorWithAlphaComponent(0.96)
    controlBar.layer.cornerRadius = initialBar.height / 2
    controlBar.layer.masksToBounds = false
    const controlBarLayer = controlBar.layer as any
    controlBarLayer.shadowColor = UIColor.blackColor()
    controlBarLayer.shadowOffset = { width: 0, height: 4 }
    controlBarLayer.shadowRadius = 9
    controlBarLayer.shadowOpacity = 0.18
    container.addSubview(controlBar)

    const closeButton = createWindowControlButton("✕", "onCloseAnswerCard:")
    controlBar.addSubview(closeButton)

    const locateButton = createWindowControlButton("↗", "onLocateAnswerCard:")
    controlBar.addSubview(locateButton)

    const refreshButton = createWindowControlButton("↻", "onRefreshAnswerCard:")
    controlBar.addSubview(refreshButton)

    // 候选答案控件：使用悬浮条的选中态，仅显示当前候选序号，多候选时才显示。
    // 尺寸/圆角与关闭、刷新控件完全一致（同为 UIButton，默认字号一致），仅底色不同。
    const candidatesButton = createWindowControlButton("", "onChooseAnswerCandidate:", true)
    candidatesButton.hidden = true
    controlBar.addSubview(candidatesButton)

    const resizeHandle = UIButton.buttonWithType(0)
    resizeHandle.frame = {
      x: defaultWidth - 52,
      y: defaultHeight - 52,
      width: 44,
      height: 44
    }
    resizeHandle.autoresizingMask = (1 << 0) | (1 << 3)
    resizeHandle.setTitleForState("↘", 0)
    resizeHandle.setTitleColorForState(UIColor.whiteColor(), 0)
    resizeHandle.backgroundColor = UIColor.blackColor().colorWithAlphaComponent(0.5)
    resizeHandle.layer.cornerRadius = 12
    resizeHandle.layer.masksToBounds = true
    const resizeGesture = new UIPanGestureRecognizer(self, "onAnswerCardResize:")
    resizeHandle.addGestureRecognizer(resizeGesture)
    container.addSubview(resizeHandle)

    self.answerCardView = container
    self.answerCardWebView = webView
    self.answerCardCloseButton = closeButton
    self.answerCardLocateButton = locateButton
    self.answerCardRefreshButton = refreshButton
    self.answerCandidatesButton = candidatesButton
    self.answerCardControlBar = controlBar
    self.answerCardDragArea = dragArea
    self.answerCardResizeHandle = resizeHandle
  }

  const previous = self.answerCardView.frame
  const preserved = freePositionFrame(previous)
  // A deliberately parked, partially off-screen window keeps its position.
  // If it was moved completely away, looking up an answer again recovers it.
  const frame = isFrameFullyOutside(preserved, hostFrame) ? defaultFrame : preserved
  const { width, height } = frame
  self.answerCardView.frame = frame
  self.answerCardWebView.frame = { x: 0, y: 0, width, height }
  layoutAnswerCardWindowControls(width)
  self.answerCardResizeHandle.frame = { x: width - 52, y: height - 52, width: 44, height: 44 }
  self.answerCardHtml = html
  ;(self.answerCardWebView as any).loadHTMLStringBaseURL(html, null)
  self.answerCardView.hidden = false
  if (!self.answerCardView.superview) host.addSubview(self.answerCardView)
  startAnswerCardFrontCorrection()
}

export function closeAnswerCard(): void {
  if (self.answerCardView) self.answerCardView.hidden = true
  stopAnswerCardFrontCorrection()
}

/** 设置切换时仅重排已创建的答案窗口；不会创建、显示或复位窗口。 */
export function syncAnswerCardWindowControlSide(side: unknown): void {
  if (!self.answerCardView) return
  layoutAnswerCardWindowControls(
    self.answerCardView.frame.width,
    normalizeWindowControlSide(side)
  )
}

function layoutAnswerCard(frame: any): void {
  // Position is intentionally unrestricted, so the answer can be parked away
  // from the writing area. Only the minimum usable size is retained.
  const next = freePositionFrame(frame)
  self.answerCardView.frame = next
  self.answerCardWebView.frame = { x: 0, y: 0, width: next.width, height: next.height }
  layoutAnswerCardWindowControls(next.width)
  self.answerCardResizeHandle.frame = {
    x: next.width - 52,
    y: next.height - 52,
    width: 44,
    height: 44
  }
}

export function onAnswerCardPan(sender: UIPanGestureRecognizer): void {
  const host = MN.studyController.view
  if (sender.state === 1) {
    const location = sender.locationInView(host)
    const frame = self.answerCardView.frame
    self.answerCardDragOffset = { x: location.x - frame.x, y: location.y - frame.y }
  }
  const offset = self.answerCardDragOffset
  if (!offset) return
  const location = sender.locationInView(host)
  layoutAnswerCard({
    ...self.answerCardView.frame,
    x: location.x - offset.x,
    y: location.y - offset.y
  })
  if (sender.state === 3 || sender.state === 4 || sender.state === 5) {
    self.answerCardDragOffset = undefined
  }
}

export function onAnswerCardResize(sender: UIPanGestureRecognizer): void {
  const host = MN.studyController.view
  if (sender.state === 1) {
    self.answerCardResizeStart = {
      location: sender.locationInView(host),
      frame: { ...self.answerCardView.frame }
    }
  }
  const start = self.answerCardResizeStart
  if (!start) return
  const location = sender.locationInView(host)
  layoutAnswerCard({
    ...start.frame,
    width: start.frame.width + location.x - start.location.x,
    height: start.frame.height + location.y - start.location.y
  })
  if (sender.state === 3 || sender.state === 4 || sender.state === 5) {
    self.answerCardResizeStart = undefined
  }
}

/** 答案查询窗口位置复原：回到 showAnswerCard 的居中默认帧。 */
export function resetAnswerCardPosition(): void {
  const view = self.answerCardView
  if (!view) return
  const hostFrame = MN.studyController.view.bounds
  const width = Math.max(280, Math.min(620, hostFrame.width - 24))
  const height = Math.max(320, Math.min(720, hostFrame.height - 56))
  layoutAnswerCard({
    x: Math.max(12, (hostFrame.width - width) / 2),
    y: Math.max(20, (hostFrame.height - height) / 2),
    width,
    height
  })
  view.hidden = false
  if (!view.superview) MN.studyController.view.addSubview(view)
  startAnswerCardFrontCorrection()
}

/** 答案窗口刷新：同时恢复默认位置/尺寸，并重新载入当前答案。 */
export function refreshAnswerCard(): void {
  if (!self.answerCardView) return
  resetAnswerCardPosition()
  if (self.answerCardHtml) {
    ;(self.answerCardWebView as any).loadHTMLStringBaseURL(self.answerCardHtml, null)
  }
}
