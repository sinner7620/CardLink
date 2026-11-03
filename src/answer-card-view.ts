import { createWindowSurface, setWindowFrame } from "./window-opacity"
import { MN } from "marginnote"
import { loadMatcherSettings } from "./settings"
import { loadAnswerPreview } from "./answer-preview-mode"
import { answerReviewControlsHtml, REVIEW_CONTROL_WIDTH, REVIEW_CONTROL_HEIGHT, REVIEW_COLLAPSED_WIDTH, REVIEW_VISUAL_INSET, REVIEW_LEVEL_NAMES } from "./answer-review-controls"
import { defaultAnswerFrame, freePositionFrame, isFrameFullyOutside } from "./answer-card-layout"
import { pauseControlSurface, syncControlSurface } from "./native-control-surface"
import {
  createWindowControlButton,
  createWindowControlIcon,
  styleWindowControlCapsule,
  answerControlBarLayout,
  normalizeWindowControlSide,
  storedWindowControlSide,
  ANSWER_BAR_DRAG_STRIP_HEIGHT,
  ANSWER_BAR_TOP_OFFSET,
  ANSWER_BAR_SIDE_INSET,
  type WindowControlSide
} from "./window-controls"

const ANSWER_WINDOW_Z_POSITION = 100000
const ANSWER_WINDOW_FRONT_INTERVAL = 0.25

function loadAnswerCardDocument(owner: any): void {
  loadAnswerPreview(owner.answerCardWebView, owner.answerCardHtml, "native")
}

/** UIWebView 加载后可能重置内部内容层底色，只清理评分绘制层，不改答案正文。 */
function clearAnswerReviewBackground(owner: any = self): void {
  const visual = owner.answerCardReviewControls
  if (!visual) return
  const clear = (view: any): void => {
    view.opaque = false
    view.backgroundColor = UIColor.clearColor()
    for (const child of Array.from(view.subviews ?? []) as any[]) clear(child)
  }
  clear(visual)
  // 某些宿主桥接不在 subviews 列表中暴露 scrollView。
  if (visual.scrollView) clear(visual.scrollView)
}

function detachAnswerReviewDismiss(owner: any = self): void {
  if (owner.answerReviewDismissHost && owner.answerReviewDismissTap) {
    owner.answerReviewDismissHost.removeGestureRecognizer(owner.answerReviewDismissTap)
  }
  owner.answerReviewDismissHost = undefined
  owner.answerReviewDismissTap = undefined
}

export function collapseAnswerReviewSelection(): void {
  self.answerReviewExpanded = false
  syncAnswerReviewControls()
}

/** Expand the entire capsule first; the next feedback choice commits immediately. */
export function selectAnswerReviewLevel(level: number): boolean {
  if (self.cardLinkReviewMode?.purpose === 'practice') return false
  if (self.cardLinkReviewMode?.writingMode === 'annotation' || self.cardLinkReviewMode?.writingMode === 'handwriting') return false
  if (self.answerReviewExpanded && level >= 0 && level <= (self.cardLinkReviewMode?.algorithm === "fsrs" ? 3 : 2)) return true
  self.answerReviewExpanded = true
  syncAnswerReviewControls()
  return false
}

export function onAnswerReviewOutsideTap(sender: UITapGestureRecognizer): void {
  if (!self.answerReviewExpanded || !self.answerCardView || self.answerCardView.hidden) return
  const point = sender.locationInView(self.answerCardView)
  const insideButton = [self.answerCardReviewToggleButton, ...(self.answerCardReviewButtons || [])].some((button: any) => {
    const f = button.frame
    return !button.hidden && point.x >= f.x && point.x <= f.x + f.width && point.y >= f.y && point.y <= f.y + f.height
  })
  if (!insideButton) collapseAnswerReviewSelection()
}

/** 答案所属题目与冻结队列当前题一致时，才允许写入复测结果。 */
export function syncAnswerReviewControls(owner: any = self): void {
  const view = owner.answerCardView
  if (!view) return
  const current = owner.cardLinkReviewMode
  if ((current?.purpose === 'practice' || current?.writingMode === 'annotation' || current?.writingMode === 'handwriting')) {
    owner.answerReviewExpanded = false
    owner.answerReviewSelectionContext = undefined
    pauseControlSurface(owner.answerCardReviewControls)
    if (owner.answerCardReviewControls) owner.answerCardReviewControls.hidden = true
    for (const button of [owner.answerCardReviewToggleButton, ...(owner.answerCardReviewButtons || [])]) {
      if (button) { button.hidden = true; button.enabled = false }
    }
    detachAnswerReviewDismiss(owner)
    if (owner.answerCardWebView) owner.answerCardWebView.frame = { x: 0, y: 0, width: view.frame.width, height: view.frame.height }
    return
  }
  const intelligent = current?.algorithm === "fsrs"
  const feedbackNames = intelligent ? ["不会", "不熟", "良好", "掌握"] : REVIEW_LEVEL_NAMES
  if (owner.answerCardReviewControls && owner.answerReviewAlgorithm !== intelligent) {
    pauseControlSurface(owner.answerCardReviewControls)
    owner.answerCardReviewControls.removeFromSuperview()
    owner.answerCardReviewToggleButton?.removeFromSuperview()
    owner.answerCardReviewButtons?.forEach((button: any) => button.removeFromSuperview())
    owner.answerCardReviewControls = undefined
  }
  owner.answerReviewAlgorithm = intelligent
  const item = current?.items[current.index]
  const visible = Boolean(item && item.sourceNoteId === owner.answerCardQuestionNoteId &&
    item.sourceNotebookId === owner.answerCardQuestionNotebookId)
  const context = visible ? item.recordId : undefined
  if (context !== owner.answerReviewSelectionContext || !visible || view.hidden) owner.answerReviewExpanded = false
  owner.answerReviewSelectionContext = context
  if (!owner.answerCardReviewControls) {
    const controls = new UIWebView({ x: 0, y: 0, width: REVIEW_CONTROL_WIDTH, height: REVIEW_CONTROL_HEIGHT })
    const visual = controls as any
    visual.autoresizingMask = 0
    visual.opaque = false
    visual.backgroundColor = UIColor.clearColor()
    visual.userInteractionEnabled = false
    visual.accessibilityElementsHidden = true
    visual.scrollView.opaque = false
    visual.scrollView.backgroundColor = UIColor.clearColor()
    visual.scrollView.scrollEnabled = false
    visual.scrollView.bounces = false
    visual.scrollView.userInteractionEnabled = false
    visual.scrollView.contentInsetAdjustmentBehavior = 2
    view.addSubview(controls)
    owner.answerCardReviewControls = controls
    const toggle = UIButton.buttonWithType(0)
    toggle.backgroundColor = UIColor.clearColor()
    ;(toggle as any).tag = -1
    ;(toggle as any).accessibilityLabel = "展开复习反馈"
    toggle.addTargetActionForControlEvents(owner, "onReviewModeResult:", 1 << 6)
    view.addSubview(toggle)
    owner.answerCardReviewToggleButton = toggle
    owner.answerCardReviewButtons = feedbackNames.map((_label, level) => {
      const button = UIButton.buttonWithType(0)
      button.backgroundColor = UIColor.clearColor()
      ;(button as any).tag = level
      button.addTargetActionForControlEvents(owner, "onReviewModeResult:", 1 << 6)
      view.addSubview(button)
      return button
    })
  }
  const expanded = owner.answerReviewExpanded === true
  // The feedback capsule stays at the corner opposite the window controls.
  const bar = answerControlBarLayout(view.frame.width, storedWindowControlSide(), Boolean(owner.answerCandidatesButton && !owner.answerCandidatesButton.hidden)).bar
  // Keep the drawing viewport fixed across toggle; CSS animates the capsule width.
  const controlWidth = Math.min(REVIEW_CONTROL_WIDTH * feedbackNames.length / 3, view.frame.width - bar.width - 20)
  const visibleWidth = expanded ? controlWidth : REVIEW_COLLAPSED_WIDTH
  const left = storedWindowControlSide() === "left"
    ? view.frame.width - ANSWER_BAR_SIDE_INSET - controlWidth
    : ANSWER_BAR_SIDE_INSET
  const top = ANSWER_BAR_TOP_OFFSET
  const hitLeft = storedWindowControlSide() === "left" ? view.frame.width - ANSWER_BAR_SIDE_INSET - visibleWidth : ANSWER_BAR_SIDE_INSET
  if (owner.answerCardWebView) {
    owner.answerCardWebView.frame = { x: 0, y: 0, width: view.frame.width, height: view.frame.height }
  }
  clearAnswerReviewBackground(owner)
  owner.answerCardReviewControls.frame = { x: left - REVIEW_VISUAL_INSET, y: top - REVIEW_VISUAL_INSET, width: controlWidth + REVIEW_VISUAL_INSET * 2, height: REVIEW_CONTROL_HEIGHT + REVIEW_VISUAL_INSET * 2 }
  owner.answerCardReviewControls.hidden = !visible
  const enabled = visible && !current?.navigating && !current?.submitting
  const toggle = owner.answerCardReviewToggleButton
  toggle.frame = { x: hitLeft, y: top, width: REVIEW_COLLAPSED_WIDTH, height: REVIEW_CONTROL_HEIGHT }
  toggle.hidden = !visible || expanded
  toggle.enabled = enabled
  const hints = feedbackNames.map(() => '')
  owner.answerCardReviewButtons.forEach((button: any, level: number) => {
    button.frame = { x: left + level * controlWidth / feedbackNames.length, y: top, width: controlWidth / feedbackNames.length, height: REVIEW_CONTROL_HEIGHT }
    button.hidden = !visible || !expanded
    button.enabled = enabled && expanded
    button.accessibilityLabel = '复习结果：' + feedbackNames[level] + hints[level]
  })
  if (visible && !view.hidden) syncControlSurface(owner.answerCardReviewControls, {
    html: () => answerReviewControlsHtml(storedWindowControlSide() === "right", intelligent),
    method: "setReviewSelection", rootId: "capsule",
    args: [expanded, Boolean(enabled), controlWidth, storedWindowControlSide() === "right", hints],
    active: () => Boolean(view.superview) && !view.hidden && !owner.answerCardReviewControls.hidden,
    onReady: () => clearAnswerReviewBackground(owner)
  })
  else pauseControlSurface(owner.answerCardReviewControls)
  const host = visible && !view.hidden ? ((MN.studyController.view as any).window || MN.studyController.view) : undefined
  if (host !== owner.answerReviewDismissHost) {
    detachAnswerReviewDismiss(owner)
    if (host) {
      const tap = new UITapGestureRecognizer(owner, "onAnswerReviewOutsideTap:")
      tap.cancelsTouchesInView = false
      host.addGestureRecognizer(tap)
      owner.answerReviewDismissTap = tap
      owner.answerReviewDismissHost = host
    }
  }
}

function keepAnswerCardInFront(owner: any = self): void {
  const view = owner.answerCardView
  if (!view || view.hidden || !view.superview) return
  clearAnswerReviewBackground(owner)
  view.layer.zPosition = ANSWER_WINDOW_Z_POSITION
  view.superview.bringSubviewToFront?.(view)
}

function stopAnswerCardFrontCorrection(owner: any = self): void {
  owner.answerCardFrontTimer?.invalidate?.()
  owner.answerCardFrontTimer = undefined
}

function startAnswerCardFrontCorrection(owner: any = self): void {
  stopAnswerCardFrontCorrection(owner)
  keepAnswerCardInFront(owner)
  owner.answerCardFrontTimer = NSTimer.scheduledTimerWithTimeInterval(
    ANSWER_WINDOW_FRONT_INTERVAL,
    true,
    () => keepAnswerCardInFront(owner)
  )
}

function layoutAnswerCardWindowControls(width: number, side: WindowControlSide = storedWindowControlSide(), owner: any = self): void {
  if (!owner.answerCardView) return
  syncAnswerReviewControls(owner)
  const candidatesVisible = Boolean(owner.answerCandidatesButton && !owner.answerCandidatesButton.hidden)
  const frames = answerControlBarLayout(width, side, candidatesVisible)
  owner.answerCardControlBar.frame = frames.bar
  owner.answerCardCloseButton.frame = frames.close
  owner.answerCardLocateButton.frame = frames.locate
  owner.answerCardRefreshButton.frame = frames.refresh
  // 拖动区覆盖顶部整条：关闭/刷新/候选控件叠于其上（可点），其余区域拖动窗口
  if (owner.answerCardDragArea) owner.answerCardDragArea.frame = { x: 0, y: 0, width, height: ANSWER_BAR_DRAG_STRIP_HEIGHT }
  if (owner.answerCandidatesButton) {
    owner.answerCandidatesButton.frame = frames.candidates
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
  currentIndex: number, owner: any = self
): void {
  if (!owner.answerCardView || !owner.answerCandidatesButton) return
  const count = candidates.length
  if (count < 2) {
    owner.answerCandidatesButton.hidden = true
    layoutAnswerCardWindowControls(owner.answerCardView.frame.width, undefined, owner)
    return
  }
  const safeIndex = currentIndex >= 0 && currentIndex < count ? currentIndex : 0
  owner.answerCandidatesButton.setTitleForState(String(safeIndex + 1), 0)
  owner.answerCandidatesButton.hidden = false
  layoutAnswerCardWindowControls(owner.answerCardView.frame.width, undefined, owner)
}

export function showAnswerCard(html: string, owner: any = self): void {
  owner.answerReviewExpanded = false
  const host = MN.studyController.view
  const hostFrame = host.bounds
  const defaultFrame = defaultAnswerFrame(hostFrame.width, hostFrame.height)
  const defaultWidth = defaultFrame.width, defaultHeight = defaultFrame.height

  if (!owner.answerCardView) {
    const container = createWindowSurface(defaultFrame)
    container.backgroundColor = UIColor.whiteColor()
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
    const dragGesture = new UIPanGestureRecognizer(owner, "onAnswerCardPan:")
    dragArea.addGestureRecognizer(dragGesture)
    container.addSubview(dragArea)

    // 悬浮条初始帧取自同一布局函数（双控件形态），创建与重排永远同源。
    const initialBar = answerControlBarLayout(defaultWidth, storedWindowControlSide(), false).bar
    const controlBar = new UIView(initialBar)
    styleWindowControlCapsule(controlBar)
    container.addSubview(controlBar)

    const closeButton = createWindowControlButton("✕", "onCloseAnswerCard:", undefined, owner)
    controlBar.addSubview(closeButton)

    const locateButton = createWindowControlButton("↗", "onLocateAnswerCard:", undefined, owner)
    controlBar.addSubview(locateButton)

    const refreshButton = createWindowControlButton("", "onRefreshAnswerCard:", undefined, owner)
    ;(refreshButton as any).accessibilityLabel = "复原答案窗口"
    refreshButton.addSubview(createWindowControlIcon())
    controlBar.addSubview(refreshButton)

    // 候选答案控件：使用悬浮条的选中态，仅显示当前候选序号，多候选时才显示。
    // 尺寸/圆角与关闭、刷新控件完全一致（同为 UIButton，默认字号一致），仅底色不同。
    const candidatesButton = createWindowControlButton("", "onChooseAnswerCandidate:", true, owner)
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
    const resizeGesture = new UIPanGestureRecognizer(owner, "onAnswerCardResize:")
    resizeHandle.addGestureRecognizer(resizeGesture)
    container.addSubview(resizeHandle)

    owner.answerCardView = container
    owner.answerCardWebView = webView
    owner.answerCardCloseButton = closeButton
    owner.answerCardLocateButton = locateButton
    owner.answerCardRefreshButton = refreshButton
    owner.answerCandidatesButton = candidatesButton
    owner.answerCardControlBar = controlBar
    owner.answerCardDragArea = dragArea
    owner.answerCardResizeHandle = resizeHandle
  }

  const previous = owner.answerCardView.frame
  const preserved = freePositionFrame(previous)
  // A deliberately parked, partially off-screen window keeps its position.
  // If it was moved completely away, looking up an answer again recovers it.
  const frame = isFrameFullyOutside(preserved, hostFrame) ? defaultFrame : preserved
  const { width, height } = frame
  owner.answerCardView.frame = frame
  owner.answerCardWebView.frame = { x: 0, y: 0, width, height }
  layoutAnswerCardWindowControls(width, undefined, owner)
  owner.answerCardResizeHandle.frame = { x: width - 52, y: height - 52, width: 44, height: 44 }
  owner.answerCardHtml = html
  loadAnswerCardDocument(owner)
  owner.answerCardView.hidden = false
  if (!owner.answerCardView.superview) host.addSubview(owner.answerCardView)
  syncAnswerReviewControls(owner)
  startAnswerCardFrontCorrection(owner)
}

export function closeAnswerCard(): void {
  pauseControlSurface(self.answerCardReviewControls)
  self.answerReviewExpanded = false
  detachAnswerReviewDismiss()
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
  setWindowFrame(self.answerCardView, next)
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
  if (!self.answerCardView) return
  const translation = (sender as any).translationInView(host)
  ;(sender as any).setTranslationInView({ x: 0, y: 0 }, host)
  layoutAnswerCard({
    ...self.answerCardView.frame,
    x: self.answerCardView.frame.x + translation.x,
    y: self.answerCardView.frame.y + translation.y
  })
}

export function onAnswerCardResize(sender: UIPanGestureRecognizer): void {
  const host = MN.studyController.view
  if (!self.answerCardView) return
  const translation = (sender as any).translationInView(host)
  ;(sender as any).setTranslationInView({ x: 0, y: 0 }, host)
  layoutAnswerCard({
    ...self.answerCardView.frame,
    width: self.answerCardView.frame.width + translation.x,
    height: self.answerCardView.frame.height + translation.y
  })
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
  syncAnswerReviewControls()
  if (!view.superview) MN.studyController.view.addSubview(view)
  startAnswerCardFrontCorrection()
}

/** 答案窗口刷新：同时恢复默认位置/尺寸，并重新载入当前答案。 */
export function refreshAnswerCard(): void {
  if (!self.answerCardView) return
  resetAnswerCardPosition()
  if (self.answerCardHtml) {
    loadAnswerCardDocument(self)
  }
}
