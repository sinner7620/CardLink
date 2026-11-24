import { createWindowSurface, setWindowFrame } from "./window-opacity"
import { reviewToolbarHorizontal, reviewToolbarTrackingFrame, reviewToolbarLayout, reviewToolbarCount, clampReviewToolbarCore, reviewToolbarDragGeometry, reviewToolbarDropFrame, type ReviewToolbarEdge } from "./review-toolbar-layout"
import { select, showHUD } from "marginnote"
import { startPracticeMode, onReviewModeExit, goToPracticeQuestion } from "./review-mode"
import { resetAnswerCardPosition } from "./answer-card-view"
import { UI_COLORS } from "./ui-tokens"
import { showPluginPanel } from "./plugin-panel"
import { styleQuickMenuSurface, styleAnnotationReviewSurface } from "./quick-menu-surface"
import { loadMatcherSettings } from "./settings"
import { recordRuntimeState } from "./note-navigation"
import { collectQuestionTree, questionIdsInTree, selectedQuestionIds, type QuestionTreeNode } from "./quick-menu-selection"
import { MN, NodeNote } from "marginnote"
import { MAIN_MINDMAP_SCOPE_ID, mindMapScopeIdForNote } from "./mindmap-candidate"
import { navigateSameMapPractice, sameMapPracticeActive, sameMapPracticeQuestionIds, sameMapPracticeCurrentQuestionId, stopSameMapPractice } from "./same-map-practice"
import { quickMenuGeometry, type QuickMenuGeometry } from "./quick-menu-geometry"
import { loadBindings } from "./store"
import { getBindingForMode, usesSubcardAnswers } from "./binding"
import { bindClipperMother, clipperModeActive, clipperSnapshot, enterClipperMode, exitClipperMode, toggleClipperRunning, resetClipperQuestion, editClipperQuestionTitle } from "./question-clipper"

import { clipperProgressHtml } from "./clipper-quick-menu"

const ENTRANCE_SIZE = 44
const EDGE_MARGIN = 18
const INITIAL_TOP = 64
const ENTRANCE_DOCK_KEY = "marginnote.extension.mn4-answer-matcher.entrance-dock.v1"
const TREE_EXPANSION_KEY = "marginnote.extension.mn4-answer-matcher.question-tree-expansion.v1."
const QUICK_MENU_WIDTH = 272
const QUICK_MENU_HEIGHT = 122
const QUICK_MENU_LIST_MAX_HEIGHT = 520
const QUICK_MENU_INSET = 12
const QUICK_MENU_LIST_TOP = 122
const QUICK_MENU_LIST_CHROME = QUICK_MENU_LIST_TOP + QUICK_MENU_INSET
const QUICK_MENU_TRANSITION_SECONDS = 0.38
// MNUtil.animate uses UIKit's default ease-in-out curve.
const QUICK_MENU_SHELL_TRANSITION_SECONDS = 0.24
const QUICK_MENU_BALL_TRANSITION_SECONDS = 0.08
const REVIEW_TOOLBAR_DRAG_MIN_DISTANCE = 44

type ViewFrame = { x: number; y: number; width: number; height: number }

interface QuickMenu {
  owner: any
  window: any
  windowSize: { width: number; height: number }
  dismissTap: UITapGestureRecognizer
  ball: any
  content: UIView
  controls: UIView
  startButton: UIButton
  closeButton: UIButton
  segment: UIView
  segmentVisual: UIWebView
  filterButton: UIButton
  allButton: UIButton
  customAllButton?: UIButton
  listContainer?: UIView
  tree: QuestionTreeNode[]
  selectedIds: Set<string>
  expandedIds: Set<string>
  expansionScope?: string
  rowIds: string[]
  visibleRows: QuestionTreeNode[]
  scroll?: UIScrollView
  mode: "filter" | "all" | "queue" | "selected"
  selectedCardIds: Set<string>
  selectionScope?: string
  selectDescendants?: boolean
  questionColorIndex?: number
  maskAnswers?: boolean
  collapsedFrame: ViewFrame
  expandedFrame: ViewFrame
  geometry: QuickMenuGeometry
  desiredWidth: number
  desiredHeight: number
  open: boolean
  generation: number
  modePicker?: { view: UIView; rows: UILabel[]; frame: ViewFrame; start: { x: number; y: number }; selected: number }
  clipControls?: UIView
  clipColor?: UIView
  clipState?: string
  clipTitle?: UILabel
  clipEnd?: UIButton
  clipMother?: UIButton
  clipReset?: UIButton
  reviewDrag?: { point: { x: number; y: number }; displacement: { x: number; y: number }; transformed: boolean; edge: ReviewToolbarEdge; nearEdge: boolean; phase: 'tracking' | 'settling'; hoverTimer?: { invalidate(): void }; hovering?: boolean; preview: UIView; grip: UIButton; generation: number; revision: number; lastMoveAt: number; slowSamples: number; transition?: Promise<void>; full: ViewFrame; homeCore: ViewFrame; homeHorizontal: boolean }
  reviewOpening?: boolean
  reviewAnimation?: { finish(): void }
  reviewControls?: UIView
  reviewOrigin?: { x: number; y: number }
  reviewCore?: ViewFrame
  reviewHorizontal?: boolean
}

let practiceQueueSnapshot: { tree: QuestionTreeNode[]; questionIds: string[]; expansionScope: string } | undefined

function restoreTreeExpansion(menu: QuickMenu, scope: string): void {
  if (menu.expansionScope === scope) return
  menu.expansionScope = scope
  let saved: unknown
  try {
    const raw = NSUserDefaults.standardUserDefaults().objectForKey(TREE_EXPANSION_KEY + scope)
    if (typeof raw === "string") saved = JSON.parse(raw)
  } catch {}
  // 空数组代表用户全部收起，不能与尚无保存记录混为一谈。
  menu.expandedIds = new Set(Array.isArray(saved) && saved.every(id => typeof id === "string")
    ? saved : menu.tree.map(root => root.id))
}

function rememberTreeExpansion(menu: QuickMenu): void {
  if (!menu.expansionScope) return
  const defaults = NSUserDefaults.standardUserDefaults()
  defaults.setObjectForKey(JSON.stringify([...menu.expandedIds]), TREE_EXPANSION_KEY + menu.expansionScope)
  defaults.synchronize()
}

type DockEdge = "left" | "right" | "top" | "bottom"

interface EntranceDock {
  edge: DockEdge
  ratio: number
}

function storedDock(): EntranceDock | undefined {
  try {
    const raw = NSUserDefaults.standardUserDefaults().objectForKey(ENTRANCE_DOCK_KEY)
    if (typeof raw !== "string") return
    const value = JSON.parse(raw)
    if (!["left", "right", "top", "bottom"].includes(value?.edge)) return
    const ratio = Number(value?.ratio)
    if (!Number.isFinite(ratio)) return
    return { edge: value.edge, ratio: clampRatio(ratio) }
  } catch {
    return
  }
}

function rememberDock(dock: EntranceDock): void {
  const defaults = NSUserDefaults.standardUserDefaults()
  defaults.setObjectForKey(JSON.stringify(dock), ENTRANCE_DOCK_KEY)
  defaults.synchronize()
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

function reducedMotionEnabled(): boolean {
  try {
    const accessibility = (globalThis as any).UIAccessibility
    return accessibility?.isReduceMotionEnabled?.() === true || accessibility?.isReduceMotionEnabled === true
  } catch {
    return false
  }
}

function geometryFor(ball: ViewFrame, window: any, desiredWidth: number, desiredHeight: number, owner: any = self): QuickMenuGeometry {
  const edge = (owner.mnutilsEntranceDock as EntranceDock | undefined)?.edge ?? nearestDock({ frame: ball }, window).edge
  const size = windowSize(window), desired = { width: desiredWidth, height: desiredHeight }
  let geometry = quickMenuGeometry(ball, size, desired, edge)
  if (owner.cardLinkReviewEntranceRender && geometry.maxHeight < desiredHeight && ball.y > size.height - ball.y - ball.height) {
    geometry = quickMenuGeometry(ball, size, desired, "bottom")
  }
  if (owner.cardLinkReviewEntranceRender) {
    // Keep all seven controls reachable when the anchor is near a screen edge.
    const width = Math.min(desiredWidth, size.width - 12), height = Math.min(desiredHeight, size.height - 12)
    geometry.frame = {
      x: Math.max(6, Math.min(geometry.expandLeft ? ball.x + ball.width + 12 - width : ball.x - 12, size.width - width - 6)),
      y: Math.max(6, Math.min(geometry.expandUp ? ball.y + ball.height + 12 - height : ball.y - 12, size.height - height - 6)),
      width, height
    }
  }
  return geometry
}

function menuLabel(title: string, frame: any, size: number, color: string): UILabel {
  const Label = UILabel as any
  const label = new Label(frame) as UILabel
  label.text = title
  label.font = UIFont.systemFontOfSize(size)
  label.textColor = UIColor.colorWithHexString(color)
  return label
}

function menuButton(title: string, frame: ViewFrame, selector: string, owner: any = self): UIButton {
  const button = UIButton.buttonWithType(0)
  button.frame = frame
  button.layer.cornerRadius = frame.height / 2
  button.layer.masksToBounds = true
  button.setTitleForState(title, 0)
  button.setTitleColorForState(UIColor.colorWithHexString("#30343b"), 0)
  if (button.titleLabel) button.titleLabel.font = UIFont.systemFontOfSize(15)
  button.addTargetActionForControlEvents(owner, selector, 1 << 6)
  return button
}

function quickMenuSegmentHtml(mode: "all" | "queue" | "selected"): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
    :root{--ease-main:cubic-bezier(0.32,0.72,0,1);--accent:${UI_COLORS.accent};--muted:#6e6e73;--track:${UI_COLORS.grayFill}6b}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
    .track{position:relative;width:100%;height:42px;padding:3px;border-radius:21px;background:var(--track);display:flex;align-items:center}
    .slider{position:absolute;top:3px;left:3px;width:calc((100% - 6px)/2);height:36px;border-radius:18px;background:#fff;transform:translateX(100%);transition:transform 0.45s var(--ease-main)}
    .label{position:relative;z-index:1;width:50%;text-align:center;font:15px -apple-system,BlinkMacSystemFont,sans-serif;line-height:36px;color:var(--muted);transition:color 0.28s ease 0.06s}
    .track[data-mode="filter"] .slider,.track[data-mode="queue"] .slider,.track[data-selection="true"][data-mode="all"] .slider{transform:translateX(0)}
    .track[data-mode="filter"] .filter,.track[data-selection="false"][data-mode="all"] .all,.track[data-mode="selected"] .all,.track[data-mode="queue"] .filter{color:var(--accent)}
    .track[data-mode="queue"] .filter{width:100%}.track[data-mode="queue"] .all{display:none}.track[data-mode="queue"] .slider{width:calc(100% - 6px)}
    .customTitle{display:block;transition:opacity .28s ease,transform .45s var(--ease-main)}
    .sub{position:absolute;inset:0;display:flex;opacity:0;transform:scale(.8);transition:opacity .28s ease,transform .45s var(--ease-main)}
    .sub span{position:relative;width:50%;font-size:13px;color:var(--muted)}
    .sub i{position:absolute;inset:3px auto 3px 3px;width:calc(50% - 3px);border-radius:16px;background:var(--track);transition:transform .45s var(--ease-main)}
    .track[data-selection="true"]:not([data-mode="selected"]) .customTitle{opacity:0;transform:scale(.8)}
    .track[data-selection="true"]:not([data-mode="selected"]) .sub{opacity:1;transform:scale(1)}
    .track[data-mode="all"] .sub i{transform:translateX(100%)}
    .track[data-mode="all"] .sub .subAll,.track[data-mode="filter"] .sub .subFilter{color:var(--accent)}
    @media(prefers-reduced-motion:reduce){.slider,.label,.customTitle,.sub,.sub i{transition:none}}
  </style></head><body><div class="track" data-mode="${mode}" data-selection="${mode === "selected"}"><div class="slider"></div><div class="label filter"><span class="customTitle">${mode === "queue" ? "当前做题队列" : mode === "selected" ? "自定义" : "筛选"}</span><div class="sub"><i></i><span class="subFilter">筛选</span><span class="subAll">全选</span></div></div><div class="label all">${mode === "selected" ? "当前选中" : "全选"}</div></div>
  <script>window.setQuickMenuMode=function(mode){var track=document.querySelector('.track');track.dataset.mode=mode;if(track.dataset.selection!=='true')track.querySelector('.customTitle').textContent=mode==='queue'?'当前做题队列':'筛选'}</script></body></html>`
}

function quickMenuSegmentVisual(width: number, mode: "all" | "queue" | "selected"): UIWebView {
  const view = new UIWebView({ x: 0, y: 0, width, height: 42 })
  const bridged = view as any
  bridged.opaque = false
  bridged.backgroundColor = UIColor.clearColor()
  bridged.scrollView.opaque = false
  bridged.scrollView.backgroundColor = UIColor.clearColor()
  bridged.scrollView.scrollEnabled = false
  bridged.scrollView.bounces = false
  // These are fixed-size visual layers, not scrollable document content. Prevent
  // UIKit safe-area insets from shifting the HTML when docked near the top bar.
  bridged.scrollView.contentInsetAdjustmentBehavior = 2
  bridged.scrollView.contentInset = { top: 0, left: 0, bottom: 0, right: 0 }
  bridged.scrollView.scrollIndicatorInsets = { top: 0, left: 0, bottom: 0, right: 0 }
  bridged.scrollView.contentOffset = { x: 0, y: 0 }
  bridged.scrollView.userInteractionEnabled = false
  bridged.userInteractionEnabled = false
  bridged.accessibilityElementsHidden = true
  bridged.layer.cornerRadius = 21
  bridged.layer.masksToBounds = true
  bridged.loadHTMLStringBaseURL(quickMenuSegmentHtml(mode), null)
  return view
}

// cancelsTouchesInView alone does not prevent another recognizer from defeating
// this tap. Observe canvas taps alongside the host's native drawing gestures.
let quickMenuTapDelegate: any
function quickMenuDismissDelegate(): any {
  if (!quickMenuTapDelegate) {
    const Delegate = JSB.defineClass("CardLinkQuickMenuTapDelegate : UIViewController <UIGestureRecognizerDelegate>", {
      gestureRecognizerShouldRecognizeSimultaneouslyWithGestureRecognizer(_gesture: any, _other: any) { return true }
    }, {})
    quickMenuTapDelegate = Delegate.new()
  }
  return quickMenuTapDelegate
}

function createQuickMenu(ball: any, window: any, collapsedFrame: ViewFrame, geometry: QuickMenuGeometry, owner: any = self): QuickMenu {
  const expandedFrame = geometry.frame
  const dismissTap = new UITapGestureRecognizer(owner, "onMnutilsQuickMenuWindowTap:")
  dismissTap.cancelsTouchesInView = false
  dismissTap.delaysTouchesBegan = false
  dismissTap.delaysTouchesEnded = false
  dismissTap.delegate = quickMenuDismissDelegate()
  window.addGestureRecognizer(dismissTap)
  const content = createWindowSurface(collapsedFrame)
  content.backgroundColor = UIColor.clearColor()
  content.layer.cornerRadius = ENTRANCE_SIZE / 2
  content.layer.masksToBounds = true
  ;(content as any).userInteractionEnabled = false
  const controls = new UIView({ x: expandedFrame.x - collapsedFrame.x, y: expandedFrame.y - collapsedFrame.y, width: expandedFrame.width, height: expandedFrame.height })
  controls.backgroundColor = UIColor.clearColor()
  ;(controls as any).userInteractionEnabled = false
  content.addSubview(controls)
  const headerY = geometry.expandUp ? expandedFrame.height - 56 : QUICK_MENU_INSET
  const startButton = menuButton(sameMapPracticeActive() ? "结束做题" : "开始做题",
    { x: 64, y: headerY, width: Math.max(0, expandedFrame.width - 128), height: 44 }, "onMnutilsQuickMenuStart:", owner)
  startButton.backgroundColor = UIColor.colorWithHexString(UI_COLORS.accent)
  startButton.setTitleColorForState(UIColor.whiteColor(), 0)
  const modePress = new UILongPressGestureRecognizer(owner, "onMnutilsQuickMenuModePress:")
  modePress.minimumPressDuration = .45
  modePress.cancelsTouchesInView = true
  startButton.addGestureRecognizer(modePress)
  controls.addSubview(startButton)
  const closeButton = menuButton("×", { x: geometry.expandLeft ? QUICK_MENU_INSET : expandedFrame.width - 56, y: headerY, width: 44, height: 44 }, "onMnutilsQuickMenuDismiss:", owner)
  if (closeButton.titleLabel) closeButton.titleLabel.font = UIFont.systemFontOfSize(26)
  closeButton.setTitleColorForState(UIColor.colorWithHexString("#30343b"), 0)
  closeButton.backgroundColor = UIColor.colorWithHexString(UI_COLORS.grayFill).colorWithAlphaComponent(0.48)
  controls.addSubview(closeButton)

  const segment = new UIView({ x: QUICK_MENU_INSET, y: geometry.expandUp ? expandedFrame.height - 110 : 68, width: expandedFrame.width - QUICK_MENU_INSET * 2, height: 42 })
  segment.backgroundColor = UIColor.clearColor()
  segment.layer.cornerRadius = 21
  segment.layer.masksToBounds = true
  const selectedCardIds = new Set<string>(MN.notebookController?.mindmapView
    ? NodeNote.getSelectedNodes().map(node => String(node.note?.noteId ?? "")).filter(Boolean) : [])
  const initialMode = sameMapPracticeActive() ? "queue" : selectedCardIds.size ? "selected" : "all"
  const segmentVisual = quickMenuSegmentVisual(expandedFrame.width - QUICK_MENU_INSET * 2, initialMode)
  segment.addSubview(segmentVisual)
  const filterButton = menuButton("", { x: 3, y: 0, width: (expandedFrame.width - QUICK_MENU_INSET * 2 - 6) / 2, height: 42 }, "onMnutilsQuickMenuFilter:", owner)
  filterButton.backgroundColor = UIColor.clearColor()
  segment.addSubview(filterButton)
  const allButton = menuButton("", { x: 3 + (expandedFrame.width - QUICK_MENU_INSET * 2 - 6) / 2, y: 0, width: (expandedFrame.width - QUICK_MENU_INSET * 2 - 6) / 2, height: 42 }, "onMnutilsQuickMenuSelectAll:", owner)
  allButton.backgroundColor = UIColor.clearColor()
  segment.addSubview(allButton)
  let customAllButton: UIButton | undefined
  if (selectedCardIds.size && initialMode === "selected") {
    customAllButton = menuButton("", { x: 0, y: 0, width: 0, height: 42 }, "onMnutilsQuickMenuSelectAll:", owner)
    customAllButton.tag = 1
    customAllButton.backgroundColor = UIColor.clearColor()
    customAllButton.hidden = true
    segment.addSubview(customAllButton)
  }
  controls.addSubview(segment)
  window.addSubview(content)
  window.bringSubviewToFront?.(ball.button)
  return {
    owner, window, windowSize: windowSize(window), dismissTap, ball, content, controls, startButton, closeButton, segment, segmentVisual, filterButton, allButton, customAllButton,
    tree: [], selectedIds: new Set(), expandedIds: new Set(), rowIds: [], visibleRows: [], mode: initialMode, selectedCardIds,
    collapsedFrame, expandedFrame, geometry, desiredWidth: QUICK_MENU_WIDTH, desiredHeight: QUICK_MENU_HEIGHT, open: false, generation: 0
  }
}

function activeMindMapNotes(): { notebookId: string; scopeId: string; notes: any[]; anchor?: any } | undefined {
  const notebookId = String(MN.currnetNotebookId ?? "").trim()
  if (!notebookId) return
  const nodes = Array.from(MN.notebookController?.mindmapView?.mindmapNodes ?? []) as any[]
  if (!nodes.length) return
  const bindings = loadBindings()
  const roots = Object.keys(bindings).filter(key => key.startsWith(`${notebookId}::root::`))
    .map(key => key.slice(`${notebookId}::root::`.length))
  const knownRoots = new Set(roots)
  const scopeOf = (node: any): string => {
    let cursor = node
    const seen = new Set<any>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const scope = mindMapScopeIdForNote(cursor.note, roots)
      if (scope !== MAIN_MINDMAP_SCOPE_ID) return scope
      const id = String(cursor.note?.noteId ?? "")
      if (knownRoots.has(id)) return id
      cursor = cursor.parentNode
    }
    return MAIN_MINDMAP_SCOPE_ID
  }
  const selected = NodeNote.getSelectedNodes()
  const anchor = selected[0]?.note ?? MN.notebookController?.focusNote ?? self.lastClickedNote
  const anchorNode = nodes.find(node => String(node.note?.noteId ?? "") === String(anchor?.noteId ?? "")) ?? nodes[0]
  const scopeId = scopeOf(anchorNode)
  const scoped = nodes.filter(node => scopeOf(node) === scopeId)
  const byId = new Map(scoped.map(node => [String(node.note?.noteId ?? ""), {
    noteId: node.note?.noteId, noteTitle: node.note?.noteTitle, colorIndex: node.note?.colorIndex,
    parentNote: undefined as any
  }]))
  for (const node of scoped) {
    const id = String(node.note?.noteId ?? "")
    const parentId = String(node.parentNode?.note?.noteId ?? node.note?.parentNote?.noteId ?? "")
    const note = byId.get(id)
    if (note && parentId) note.parentNote = byId.get(parentId)
  }
  return { notebookId, scopeId, notes: [...byId.values()], anchor }
}

function readQuickMenuQuestions(menu: QuickMenu): boolean {
  if (sameMapPracticeActive() && practiceQueueSnapshot) {
    menu.tree = practiceQueueSnapshot.tree
    restoreTreeExpansion(menu, practiceQueueSnapshot.expansionScope)
    menu.selectedIds = new Set(practiceQueueSnapshot.questionIds)
    updateStartTitle(menu)
    return true
  }
  if (!sameMapPracticeActive()) practiceQueueSnapshot = undefined
  const context = activeMindMapNotes()
  if (!context) {
    recordRuntimeState("悬浮菜单", "questions.unavailable", "没有可读取的当前脑图")
    showHUD("请先打开脑图", 2)
    return false
  }
  const contextKey = JSON.stringify([context.notebookId, context.scopeId])
  if (menu.mode === "selected") {
    if (menu.selectionScope && menu.selectionScope !== contextKey) {
      showHUD("脑图已切换，请重新打开悬浮菜单选择题目", 3)
      return false
    }
    menu.selectionScope = contextKey
  }
  const bindings = loadBindings()
  const binding = getBindingForMode(bindings, context.notebookId, context.scopeId, loadMatcherSettings().allowSameStudySetMindMap)
  const answerMindMapOnly = !!binding && binding.selectionMode !== "mixed" && binding.designatedAnswer !== "subcard"
  menu.selectDescendants = !answerMindMapOnly
  const colors = answerMindMapOnly ? [] : [...new Set([...(loadMatcherSettings().globalQuestionColors ?? []), ...(binding?.questionColors ?? [])])]
  if (!colors.length && !sameMapPracticeActive() && (binding?.designatedAnswer === "subcard" || binding?.selectionMode === "mixed")) {
    recordRuntimeState("悬浮菜单", "questions.unavailable", `scope=${context.scopeId} reason=no-question-colors`)
    showHUD("请先在答案配置中筛选题目卡片颜色", 3)
    return false
  }
  menu.questionColorIndex = colors[0]
  menu.maskAnswers = usesSubcardAnswers(binding ? { ...binding, questionColors: colors } : binding, colors[0])
  const inCurrentMap = new Set(context.notes.map(note => String(note.noteId ?? "").trim()))
  menu.tree = collectQuestionTree(context.notes, sameMapPracticeActive() || !colors.length ? undefined : colors,
    note => inCurrentMap.has(String(note.noteId ?? "").trim()), { excludeQuestionDescendants: menu.maskAnswers === true })
  restoreTreeExpansion(menu, JSON.stringify([context.notebookId, context.scopeId]))
  const available = new Set(questionIdsInTree(menu.tree))
  menu.selectedIds = sameMapPracticeActive()
    ? new Set(sameMapPracticeQuestionIds().filter(id => available.has(id)))
    : menu.mode === "selected" ? new Set(selectedQuestionIds(menu.tree, menu.selectedCardIds, menu.selectDescendants))
      : menu.mode === "all" ? available : new Set([...menu.selectedIds].filter(id => available.has(id)))
  const colorCounts = new Map<string, number>()
  context.notes.forEach(note => {
    const color = typeof note.colorIndex === "number" ? String(note.colorIndex) : `unreadable:${typeof note.colorIndex}`
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
  })
  recordRuntimeState("悬浮菜单", "questions.ready", `scope=${context.scopeId} colors=${colors.join(",")} visible=${context.notes.length} available=${available.size} selected=${menu.selectedIds.size} mode=${menu.mode} answer=${menu.maskAnswers ? "subcard" : "mindmap"} cardColors=${JSON.stringify([...colorCounts])} selectedCards=${menu.selectedCardIds.size}`)
  updateStartTitle(menu)
  return true
}

function updateStartTitle(menu: QuickMenu): void {
  if (clipperModeActive(menu.owner)) return
  const running = sameMapPracticeActive()
  menu.startButton.backgroundColor = UIColor.colorWithHexString(running ? UI_COLORS.stop : UI_COLORS.accent)
  menu.startButton.setTitleForState(running
    ? "结束做题"
    : `开始做题${menu.selectedIds.size ? ` · ${menu.selectedIds.size}` : ""}`, 0)
}

function visibleQuestionRows(menu: QuickMenu): Array<{ node: QuestionTreeNode; depth: number }> {
  const rows: Array<{ node: QuestionTreeNode; depth: number }> = []
  const visit = (nodes: QuestionTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth })
      if (node.children.length && menu.expandedIds.has(node.id)) visit(node.children, depth + 1)
    }
  }
  visit(menu.tree, 0)
  return rows
}

function updateSegmentSelection(menu: QuickMenu): void {
  ;(menu.filterButton as any).accessibilityLabel = menu.mode === "selected" ? "自定义" : "筛选"
  ;(menu.allButton as any).accessibilityLabel = menu.customAllButton ? "当前选中" : "全选"
  if (menu.customAllButton) (menu.customAllButton as any).accessibilityLabel = "全选"
  ;(menu.segmentVisual as any).evaluateJavaScript(`window.setQuickMenuMode(${JSON.stringify(menu.mode)})`, () => {})
}

function layoutQuickMenu(menu: QuickMenu, geometry: QuickMenuGeometry, resizeShell = true): void {
  const frame = geometry.frame
  if (menu.reviewControls && !menu.reviewDrag) styleReviewMenuShell(menu)
  const width = Math.max(0, frame.width - QUICK_MENU_INSET * 2)
  const listHeight = Math.max(0, frame.height - QUICK_MENU_LIST_CHROME)
  const listY = geometry.expandUp ? QUICK_MENU_INSET : QUICK_MENU_LIST_TOP
  const headerY = geometry.expandUp ? frame.height - 56 : QUICK_MENU_INSET
  if (resizeShell) setQuickMenuShell(menu, frame, menu.reviewControls ? 20 : 18)
  menu.controls.frame = { x: frame.x - menu.content.frame.x, y: frame.y - menu.content.frame.y, width: frame.width, height: frame.height }
  menu.startButton.frame = { x: 64, y: headerY, width: Math.max(0, frame.width - 128), height: 44 }
  menu.closeButton.frame = { x: geometry.expandLeft ? QUICK_MENU_INSET : frame.width - 56, y: headerY, width: 44, height: 44 }
  menu.segment.frame = { x: QUICK_MENU_INSET, y: geometry.expandUp ? frame.height - 110 : 68, width, height: 42 }
  menu.segmentVisual.frame = { x: 0, y: 0, width, height: 42 }
  const half = Math.max(0, (width - 6) / 2)
  menu.allButton.frame = { x: 3 + half, y: 0, width: half, height: 42 }
  const nestedCustom = !!menu.customAllButton && menu.mode !== "selected" && menu.mode !== "queue"
  menu.filterButton.frame = { x: 3, y: 0, width: menu.mode === "queue" ? width - 6 : nestedCustom ? half / 2 : half, height: 42 }
  if (menu.customAllButton) {
    menu.customAllButton.hidden = !nestedCustom
    menu.customAllButton.frame = { x: 3 + half / 2, y: 0, width: half / 2, height: 42 }
  }
  menu.allButton.hidden = menu.mode === "queue"
  if (menu.listContainer) menu.listContainer.frame = { x: QUICK_MENU_INSET, y: listY, width, height: listHeight }
  if (menu.scroll) {
    menu.scroll.frame = { x: 0, y: 0, width, height: listHeight }
    menu.scroll.contentSize = { width, height: Math.max(listHeight, menu.visibleRows.length * 42) }
  }
  if (menu.clipControls) layoutClipperMenu(menu)
  if (menu.reviewControls) {
    menu.reviewControls.frame = { x: 4, y: 4, width: Math.max(0, frame.width - 8), height: Math.max(0, frame.height - 8) }
    menu.owner.cardLinkReviewEntranceRender?.(menu.reviewControls)
  }
}

function layoutClipperMenu(menu: QuickMenu): void {
  const width = menu.expandedFrame.width, controlsWidth = width - 128
  const headerY = menu.geometry.expandUp ? menu.expandedFrame.height - 56 : QUICK_MENU_INSET
  const titleY = menu.geometry.expandUp ? headerY - 24 : 62
  const progressY = menu.geometry.expandUp ? titleY - 34 : 84
  const infoY = menu.geometry.expandUp ? progressY - 42 : 126
  menu.clipControls!.frame = { x: 64, y: headerY, width: controlsWidth, height: 44 }
  const snapshot = clipperSnapshot(menu.owner)
  menu.clipColor!.frame = { x: 0, y: 0, width: snapshot.started && !snapshot.running ? 0 : controlsWidth, height: 44 }
  menu.closeButton.frame = { ...menu.closeButton.frame, y: headerY }
  menu.segment.frame = { x: 12, y: progressY, width: width - 24, height: 30 }
  menu.segment.layer.cornerRadius = 15
  menu.segmentVisual.frame = { x: 0, y: 0, width: width - 24, height: 30 }
  menu.segmentVisual.layer.cornerRadius = 15
  menu.clipTitle!.frame = { x: 20, y: titleY, width: width - 40, height: 20 }
  const inset = snapshot.started ? 3 : 0
  menu.startButton.frame = { x: 64 + inset, y: headerY + inset, width: snapshot.started ? (controlsWidth - 6) / 2 : controlsWidth, height: 44 - inset * 2 }
  menu.startButton.layer.cornerRadius = menu.startButton.frame.height / 2
  menu.clipEnd!.frame = { x: 64 + controlsWidth / 2, y: headerY + 3, width: (controlsWidth - 6) / 2, height: 38 }
  menu.clipEnd!.hidden = !snapshot.started
  ;(menu.clipEnd as any).alpha = snapshot.started ? 1 : 0
  menu.filterButton.hidden = true; menu.allButton.hidden = true
  const half = (width - 32) / 2
  menu.clipMother!.frame = { x: 12, y: infoY, width: half, height: 30 }
  menu.clipReset!.frame = { x: 20 + half, y: infoY, width: half, height: 30 }
}

function refreshClipperMenu(owner: any = self): void {
  const menu = owner.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open || !menu.clipControls || !clipperModeActive(owner)) return
  const snapshot = clipperSnapshot(owner)
  const script = "window.updateClip&&window.updateClip(" + JSON.stringify(snapshot) + ")"
  ;(menu.segmentVisual as any).evaluateJavaScript(script, () => {})
  const updateControls = () => {
    menu.clipControls!.backgroundColor = UIColor.colorWithHexString(UI_COLORS.stop)
    menu.startButton.setTitleForState(snapshot.started ? snapshot.running ? "暂停" : "继续" : "开始摘题", 0)
    menu.startButton.backgroundColor = snapshot.started ? snapshot.running ? UIColor.whiteColor() : UIColor.colorWithHexString(UI_COLORS.stop) : UIColor.colorWithHexString(UI_COLORS.accent)
    menu.startButton.setTitleColorForState(snapshot.started && snapshot.running ? UIColor.colorWithHexString(UI_COLORS.accent) : UIColor.whiteColor(), 0)
    if (menu.startButton.titleLabel) menu.startButton.titleLabel.font = UIFont.systemFontOfSize(snapshot.started ? 13 : 15)
    menu.clipEnd!.backgroundColor = snapshot.running ? UIColor.colorWithHexString(UI_COLORS.accent) : UIColor.whiteColor()
    menu.clipEnd!.setTitleColorForState(snapshot.running ? UIColor.whiteColor() : UIColor.colorWithHexString(UI_COLORS.stop), 0)
    layoutQuickMenu(menu, menu.geometry, false)
  }
  const state = `${snapshot.started}:${snapshot.running}`
  if (menu.clipState !== undefined && menu.clipState !== state) void animateQuickMenuUpdate(updateControls, QUICK_MENU_TRANSITION_SECONDS)
  else updateControls()
  menu.clipState = state
  ;(menu.clipTitle as any).userInteractionEnabled = snapshot.started
  menu.clipTitle!.text = snapshot.title || (snapshot.excerptTitle ? "等待摘录标题" : "等待摘录题目")
  menu.clipMother!.setTitleForState(snapshot.motherTitle || "绑定母卡", 0)
  menu.clipMother!.backgroundColor = UIColor.colorWithHexString(snapshot.motherId ? UI_COLORS.accent : UI_COLORS.grayFill).colorWithAlphaComponent(snapshot.motherId ? 1 : .48)
  menu.clipMother!.setTitleColorForState(snapshot.motherId ? UIColor.whiteColor() : UIColor.colorWithHexString("#6e6e73"), 0)
  // State/loading refreshes must not jump the shell to its final animation frame.
}

function prepareClipperMenu(menu: QuickMenu): void {
  const snapshot = clipperSnapshot(menu.owner)
  const visual = new UIView({ x: 64, y: 12, width: menu.expandedFrame.width - 128, height: 44 })
  visual.layer.cornerRadius = 22
  visual.layer.masksToBounds = true
  ;(visual as any).userInteractionEnabled = false
  menu.clipControls = visual
  menu.clipColor = new UIView({ x: 0, y: 0, width: menu.expandedFrame.width - 128, height: 44 })
  menu.clipColor.backgroundColor = UIColor.colorWithHexString(UI_COLORS.accent)
  menu.clipColor.layer.cornerRadius = 22
  visual.addSubview(menu.clipColor)
  menu.controls.addSubview(visual)
  ;(menu.controls as any).bringSubviewToFront(menu.startButton)
  menu.clipEnd = menuButton("结束", { x: 0, y: 0, width: 69, height: 38 }, "onClipperEnd:", menu.owner)
  menu.clipEnd.backgroundColor = UIColor.colorWithHexString(UI_COLORS.accent)
  menu.clipEnd.setTitleColorForState(UIColor.whiteColor(), 0)
  if (menu.clipEnd.titleLabel) menu.clipEnd.titleLabel.font = UIFont.systemFontOfSize(13)
  menu.controls.addSubview(menu.clipEnd)
  ;(menu.segmentVisual as any).loadHTMLStringBaseURL(clipperProgressHtml(snapshot), null)
  menu.clipTitle = menuLabel("", { x: 20, y: 62, width: menu.expandedFrame.width - 40, height: 20 }, 12, "#6e6e73")
  menu.clipTitle.textAlignment = 1
  menu.clipTitle.backgroundColor = UIColor.clearColor()
  ;(menu.clipTitle as any).userInteractionEnabled = false
  menu.clipTitle.addGestureRecognizer(new UITapGestureRecognizer(menu.owner, "onClipperEditTitle:"))
  ;(menu.clipTitle as any).lineBreakMode = 4
  menu.controls.addSubview(menu.clipTitle)
  menu.clipMother = menuButton("绑定母卡", { x: 0, y: 0, width: 120, height: 30 }, "onClipperBindMother:", menu.owner)
  menu.clipMother.backgroundColor = UIColor.colorWithHexString(UI_COLORS.grayFill).colorWithAlphaComponent(.48)
  if (menu.clipMother.titleLabel) {
    menu.clipMother.titleLabel.font = UIFont.systemFontOfSize(12)
    ;(menu.clipMother.titleLabel as any).lineBreakMode = 4
  }
  menu.controls.addSubview(menu.clipMother)
  menu.clipReset = menuButton("重置本题", { x: 0, y: 0, width: 120, height: 30 }, "onClipperResetQuestion:", menu.owner)
  menu.clipReset.backgroundColor = UIColor.colorWithHexString(UI_COLORS.grayFill).colorWithAlphaComponent(.48)
  menu.clipReset.setTitleColorForState(UIColor.colorWithHexString("#6e6e73"), 0)
  if (menu.clipReset.titleLabel) menu.clipReset.titleLabel.font = UIFont.systemFontOfSize(12)
  menu.controls.addSubview(menu.clipReset)
  refreshClipperMenu(menu.owner)
  NSTimer.scheduledTimerWithTimeInterval(.25, false, () => refreshClipperMenu(menu.owner))
  NSTimer.scheduledTimerWithTimeInterval(.7, false, () => refreshClipperMenu(menu.owner))
}

export function openClipperQuickMenu(owner: any = self): void {
  ensureMnutilsEntrance(owner)
  const button = owner.mnutilsEntranceBall
  const window = button?.button?.superview ?? button?.window
  if (!button || !window) throw new Error("摘题快捷区需要 MN Utils，请先启用 MN Utils")
  enterClipperMode(() => refreshClipperMenu(owner), owner)
  stopSameMapPractice(); practiceQueueSnapshot = undefined
  try { openQuickMenu(button, window, owner) } catch (error) { exitClipperMode(owner); throw error }
  __MNAM_WEB_PANEL_GLOBAL__.hidePanel(owner.webController, true)
}
export function onClipperEnd(): void {
  exitClipperMode()
  const button = self.mnutilsEntranceBall
  const window = button?.button?.superview ?? button?.window
  if (button && window) openQuickMenu(button, window)
}
export function onClipperBindMother(): void { bindClipperMother() }
export function onClipperResetQuestion(): void { resetClipperQuestion() }
export function onClipperEditTitle(): void { void editClipperQuestionTitle().catch(error => showHUD(String(error?.message || error), 3)) }

function resizeQuickMenu(menu: QuickMenu, width: number, height: number, nextList?: UIView, nextScroll?: UIScrollView): void {
  const geometry = geometryFor(menu.collapsedFrame, menu.window, width, height)
  const next = geometry.frame
  const previousList = menu.listContainer
  const previousHeight = Number(previousList?.frame.height ?? 0)
  const previousWidth = Number(previousList?.frame.width ?? menu.expandedFrame.width - QUICK_MENU_INSET * 2)
  const listWidth = next.width - QUICK_MENU_INSET * 2
  const listHeight = Math.max(0, next.height - QUICK_MENU_LIST_CHROME)
  const listY = geometry.expandUp ? QUICK_MENU_INSET : QUICK_MENU_LIST_TOP
  if (nextList) {
    nextList.frame = { x: QUICK_MENU_INSET, y: listY, width: previousWidth, height: previousHeight }
    ;(nextList as any).alpha = 0
    menu.controls.addSubview(nextList)
  }
  menu.listContainer = nextList
  menu.scroll = nextScroll
  menu.expandedFrame = next
  menu.geometry = geometry
  menu.desiredWidth = width
  menu.desiredHeight = height
  const update = () => {
    layoutQuickMenu(menu, geometry)
    if (previousList) {
      previousList.frame = { x: QUICK_MENU_INSET, y: listY, width: listWidth, height: Math.min(previousHeight, listHeight) }
      ;(previousList as any).alpha = 0
    }
    if (nextList) (nextList as any).alpha = 1
  }
  void animateQuickMenuUpdate(update, 0.4).then(() => (previousList as any)?.removeFromSuperview())
}

function renderQuestionTree(menu: QuickMenu, focusCurrent = false): void {
  const previousOffset = Number(menu.scroll?.contentOffset?.y ?? 0)
  const currentId = menu.mode === "queue" ? sameMapPracticeCurrentQuestionId() : undefined
  if (focusCurrent && currentId) {
    const reveal = (nodes: QuestionTreeNode[]) => nodes.forEach(node => {
      if (!node.questionIds.includes(currentId)) return
      if (node.children.length) { menu.expandedIds.add(node.id); reveal(node.children) }
    })
    reveal(menu.tree)
  }
  if (menu.mode === "all" || menu.mode === "selected") {
    resizeQuickMenu(menu, QUICK_MENU_WIDTH, QUICK_MENU_HEIGHT)
    menu.visibleRows = []
    menu.rowIds = []
    return
  }
  const rows = visibleQuestionRows(menu).filter(row => menu.mode !== "queue" || row.node.questionIds.some(id => menu.selectedIds.has(id)))
  menu.visibleRows = rows.map(row => row.node)
  menu.rowIds = rows.map(row => row.node.id)
  const desiredHeight = Math.min(QUICK_MENU_LIST_MAX_HEIGHT, QUICK_MENU_LIST_CHROME + Math.max(44, rows.length * 42))
  const nextFrame = geometryFor(menu.collapsedFrame, menu.window, QUICK_MENU_WIDTH, desiredHeight).frame
  const width = nextFrame.width - QUICK_MENU_INSET * 2
  const height = Math.max(0, nextFrame.height - QUICK_MENU_LIST_CHROME)
  const container = new UIView({ x: QUICK_MENU_INSET, y: 0, width, height })
  container.backgroundColor = UIColor.whiteColor().colorWithAlphaComponent(0.74)
  container.layer.cornerRadius = 13
  container.layer.masksToBounds = true
  const scroll = new UIScrollView({ x: 0, y: 0, width, height })
  scroll.contentSize = { width, height: Math.max(height, rows.length * 42) }
  scroll.bounces = false
  for (let index = 0; index < rows.length; index++) {
    const { node, depth } = rows[index]
    const y = index * 42
    const row = UIButton.buttonWithType(0)
    row.frame = { x: 4, y: y + 2, width: width - 8, height: 38 }
    row.tag = index
    row.layer.cornerRadius = 10
    row.layer.masksToBounds = true
    row.addTargetActionForControlEvents(self, "onMnutilsQuickMenuToggleQuestion:", 1 << 6)
    const rowQuestions = menu.selectDescendants === false && node.question ? [node.id] : node.questionIds
    const checked = rowQuestions.every(id => menu.selectedIds.has(id))
    const partial = !checked && rowQuestions.some(id => menu.selectedIds.has(id))
    row.backgroundColor = checked || partial
      ? UIColor.colorWithHexString(UI_COLORS.accent).colorWithAlphaComponent(checked ? 0.2 : 0.08)
      : UIColor.clearColor()
    const labelX = 12 + Math.min(4, depth) * 16
    row.addSubview(menuLabel(node.title, { x: labelX, y: 6, width: width - labelX - 48, height: 26 }, 14,
      checked ? UI_COLORS.accent : "#30343b"))
    scroll.addSubview(row)
    if (node.children.length) {
      const branch = menuButton(menu.expandedIds.has(node.id) ? "⌄" : "›",
        { x: width - 42, y: y + 2, width: 38, height: 38 }, "onMnutilsQuickMenuToggleBranch:")
      branch.tag = index
      branch.backgroundColor = UIColor.clearColor()
      scroll.addSubview(branch)
    }
  }
  container.addSubview(scroll)
  const currentIndex = currentId ? rows.findIndex(row => row.node.id === currentId) : -1
  const offset = focusCurrent && currentIndex >= 0 ? currentIndex * 42 + 21 - height / 2 : previousOffset
  scroll.contentOffset = { x: 0, y: Math.max(0, Math.min(offset, Math.max(0, rows.length * 42 - height))) }
  resizeQuickMenu(menu, QUICK_MENU_WIDTH, desiredHeight, container, scroll)
}

function setQuickMenuShell(menu: QuickMenu, frame: ViewFrame, cornerRadius: number): void {
  menu.content.frame = frame
  menu.content.layer.cornerRadius = cornerRadius
  // Keep the controls fixed in window space while the shell reveals them
  // outward from the ball, or clips them back into it on close.
  // Update the compensating child offset without an inherited UIKit tween.
  // Otherwise shell expansion and the inverse child movement render as two
  // independent animations, leaving a second row flying in from the right.
  setWindowFrame(menu.controls, {
    x: menu.expandedFrame.x - frame.x, y: menu.expandedFrame.y - frame.y,
    width: menu.expandedFrame.width, height: menu.expandedFrame.height
  })
}

function animateQuickMenuUpdate(update: () => void, seconds: number): Promise<void> {
  if (reducedMotionEnabled() || typeof MNUtil.animate !== "function") {
    update()
    return Promise.resolve()
  }
  return Promise.resolve(MNUtil.animate(update, seconds)).then(() => undefined)
}

function withoutReviewAnimations(update: () => void): void {
  const native = UIView as any, transaction = (globalThis as any).CATransaction
  const canDisable = typeof native.areAnimationsEnabled === 'function' && typeof native.setAnimationsEnabled === 'function'
  const enabled = canDisable ? native.areAnimationsEnabled() : undefined
  const transact = typeof transaction?.begin === 'function' && typeof transaction?.setDisableActions === 'function' && typeof transaction?.commit === 'function'
  if (transact) { transaction.begin(); transaction.setDisableActions(true) }
  try { if (canDisable) native.setAnimationsEnabled(false); update() }
  finally { if (canDisable) native.setAnimationsEnabled(enabled); if (transact) transaction.commit() }
}

function interpolateReviewFrame(from: ViewFrame, to: ViewFrame, progress: number): ViewFrame {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress,
    width: from.width + (to.width - from.width) * progress, height: from.height + (to.height - from.height) * progress }
}

/** One clock writes the outline and compensating content coordinates together.
 * No nested UIKit frame/bounds/opacity animations or completion-time reveal. */
function animateReviewGeometry(menu: QuickMenu, seconds: number, update: (progress: number) => void): Promise<void> {
  menu.reviewAnimation?.finish()
  const generation = menu.generation, open = menu.open
  if (reducedMotionEnabled()) { withoutReviewAnimations(() => update(1)); return Promise.resolve() }
  return new Promise(resolve => {
    let timer: { invalidate(): void } | undefined, ended = false
    const animation = { finish() {
      if (ended) return
      ended = true; timer?.invalidate()
      if (menu.reviewAnimation === animation) menu.reviewAnimation = undefined
      resolve()
    } }
    menu.reviewAnimation = animation
    const started = Date.now()
    withoutReviewAnimations(() => update(0))
    timer = NSTimer.scheduledTimerWithTimeInterval(1 / 60, true, () => {
      if (menu.open !== open || menu.generation !== generation) { animation.finish(); return }
      const progress = Math.min(1, Math.max(0, (Date.now() - started) / (seconds * 1000)))
      withoutReviewAnimations(() => update(progress * progress * (3 - 2 * progress)))
      if (progress === 1) animation.finish()
    })
    try {
      const loopType = (globalThis as any).NSRunLoop
      const loop = loopType?.mainRunLoop?.() || loopType?.currentRunLoop?.()
      loop?.addTimerForMode?.(timer, (globalThis as any).NSRunLoopCommonModes || 'kCFRunLoopCommonModes')
    } catch { /* Default run-loop still completes the transition after tracking. */ }
  })
}

function finishQuickMenu(menu: QuickMenu): void {
  menu.reviewAnimation?.finish()
  menu.reviewDrag?.hoverTimer?.invalidate()
  if (menu.reviewControls && menu.owner.cardLinkReviewEntranceHost === menu.reviewControls) {
    menu.owner.cardLinkReviewEntranceHost = undefined
    menu.owner.cardLinkReviewEntranceResize = undefined
    menu.owner.cardLinkReviewEntranceCommit = undefined
    menu.owner.cardLinkReviewEntranceLimits = undefined
    menu.owner.cardLinkReviewEntrancePlacement = undefined
    ;(menu.ball.button ?? menu.ball).hidden = false
  }
  dismissModePicker(menu)
  ;(menu.content as any).removeFromSuperview()
  menu.window.removeGestureRecognizer(menu.dismissTap)
  if (menu.owner.mnutilsQuickMenu === menu) menu.owner.mnutilsQuickMenu = undefined
}

function styleReviewMenuShell(menu: QuickMenu): void {
  styleAnnotationReviewSurface(menu.content, "shell")
}

function settleQuickMenu(menu: QuickMenu): void {
  if (menu.reviewControls) styleReviewMenuShell(menu)
  else styleQuickMenuSurface(menu.content)
  setQuickMenuShell(menu, menu.expandedFrame, menu.reviewControls ? 20 : 18)
  ;(menu.content as any).userInteractionEnabled = true
  ;(menu.controls as any).userInteractionEnabled = true
  recordRuntimeState("悬浮菜单", "ready", `frame=${JSON.stringify(menu.content.frame)}`)
}

async function animateQuickMenu(menu: QuickMenu, opening: boolean): Promise<void> {
  const generation = ++menu.generation
  if (menu.reviewControls) {
    const from = { ...menu.content.frame }, to = { ...(opening ? menu.expandedFrame : menu.collapsedFrame) }
    withoutReviewAnimations(() => { styleReviewMenuShell(menu); menu.content.layer.masksToBounds = true })
    await animateReviewGeometry(menu, QUICK_MENU_SHELL_TRANSITION_SECONDS, progress => {
      setQuickMenuShell(menu, interpolateReviewFrame(from, to, progress), 20 + (opening ? 1 - progress : progress) * 2)
    })
    if (menu.generation !== generation || menu.open !== opening) return
    menu.reviewOpening = false
    withoutReviewAnimations(() => { if (opening) settleQuickMenu(menu); else finishQuickMenu(menu) })
    return
  }
  if (reducedMotionEnabled()) {
    menu.reviewOpening = false
    if (opening) {
      layoutQuickMenu(menu, menu.geometry)
      settleQuickMenu(menu)
    } else finishQuickMenu(menu)
    return
  }
  if (opening) {
    await animateQuickMenuUpdate(() => {
      if (menu.reviewControls) {
        styleReviewMenuShell(menu)
        menu.content.layer.masksToBounds = true
        ;(menu.content.layer as any).shadowOpacity = 0
      } else styleQuickMenuSurface(menu.content)
    }, QUICK_MENU_BALL_TRANSITION_SECONDS)
    if (menu.generation !== generation || !menu.open) return
    menu.reviewOpening = false
    await animateQuickMenuUpdate(() => {
      setQuickMenuShell(menu, menu.expandedFrame, menu.reviewControls ? 20 : 18)
    }, QUICK_MENU_SHELL_TRANSITION_SECONDS)
    if (menu.generation === generation && menu.open) settleQuickMenu(menu)
    return
  }
  ;(menu.content as any).userInteractionEnabled = false
  ;(menu.controls as any).userInteractionEnabled = false
  menu.content.layer.masksToBounds = true
  ;(menu.content.layer as any).shadowOpacity = 0
  await animateQuickMenuUpdate(() => {
    setQuickMenuShell(menu, menu.collapsedFrame, ENTRANCE_SIZE / 2)
  }, QUICK_MENU_SHELL_TRANSITION_SECONDS)
  if (menu.generation !== generation || menu.open) return
  await animateQuickMenuUpdate(() => {
    menu.content.backgroundColor = UIColor.clearColor()
  }, QUICK_MENU_BALL_TRANSITION_SECONDS)
  if (menu.generation === generation && !menu.open) finishQuickMenu(menu)
}

function closeQuickMenu(animated = true, owner: any = self, reason = "lifecycle"): void {
  const menu = owner.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu) return
  // The native writing-mode picker is outside this view. Its option taps must
  // not dismiss the menu whose selected queue is waiting for the result.
  if (reason === "outside-tap" && owner.cardLinkPracticeChoosing) return
  if (menu.reviewControls && typeof owner.cardLinkReviewEntranceRender === "function" &&
    ["outside-tap", "close-button", "open-panel", "entrance-long-press", "collapse"].includes(reason)) {
    if (reason === "outside-tap") owner.cardLinkReviewDismissClassification?.()
    return
  }
  recordRuntimeState("悬浮菜单", "close", `reason=${reason} mode=${menu.mode} selected=${menu.selectedIds.size}`)
  dismissModePicker(menu)
  menu.open = false
  if (animated) void animateQuickMenu(menu, false)
  else {
    menu.generation++
    finishQuickMenu(menu)
  }
}

export function closeMnutilsQuickMenu(): void {
  if (self.mnutilsQuickMenu?.reviewControls && self.cardLinkReviewEntranceRender) return
  exitClipperMode()
  closeQuickMenu(false)
  stopSameMapPractice()
  practiceQueueSnapshot = undefined
}

function openQuickMenu(button: any, window: any, owner: any = self): void {
  closeQuickMenu(false, owner)
  const collapsedFrame = { ...button.frame } as ViewFrame
  const review = typeof owner.cardLinkReviewEntranceRender === "function"
  const current = owner.cardLinkReviewMode
  if (review && current) {
    const size = windowSize(window)
    current.annotationHorizontal = reviewToolbarHorizontal(collapsedFrame.x + collapsedFrame.width / 2, collapsedFrame.y + collapsedFrame.height / 2, size.width, size.height)
  }
  const horizontal = !!current?.annotationHorizontal
  const size = windowSize(window)
  const initialCore = review ? reviewToolbarLayout(horizontal, false, 0, { width: Math.max(0, size.width - 20), height: Math.max(0, size.height - 20) }, reviewToolbarCount(current || {})) : undefined
  const desiredWidth = review ? initialCore!.mainWidth + 8 : QUICK_MENU_WIDTH
  const desiredHeight = review ? initialCore!.height + 8 : clipperModeActive(owner) ? 168 : QUICK_MENU_HEIGHT
  const geometry = geometryFor(collapsedFrame, window, desiredWidth, desiredHeight, owner)
  if (review) geometry.frame = clampReviewToolbarCore(geometry.frame, size, horizontal)
  const menu = createQuickMenu(button, window, collapsedFrame, geometry, owner)
  owner.mnutilsQuickMenu = menu
  menu.open = true
  recordRuntimeState("悬浮菜单", "open", `frame=${JSON.stringify(menu.expandedFrame)}`)
  menu.desiredWidth = desiredWidth; menu.desiredHeight = desiredHeight
  if (review) {
    menu.reviewOpening = true
    menu.content.layer.borderWidth = 0
    menu.content.backgroundColor = UIColor.clearColor()
    menu.startButton.hidden = true
    menu.segment.hidden = true
    menu.closeButton.hidden = true
    ;(button.button ?? button).hidden = true
    menu.reviewControls = new UIView({ x: 4, y: 4, width: Math.max(0, geometry.frame.width - 8), height: Math.max(0, geometry.frame.height - 8) })
    menu.reviewControls.backgroundColor = UIColor.clearColor()
    menu.controls.layer.cornerRadius = 20
    menu.controls.layer.masksToBounds = true
    menu.controls.addSubview(menu.reviewControls)
    // Keep a main-control anchor independent of classification/list extents.
    menu.reviewOrigin = { x: 0, y: 0 }
    menu.reviewCore = { ...geometry.frame }
    menu.reviewHorizontal = horizontal
    const coreFrame = () => {
      const bounds = windowSize(window), horizontal = !!owner.cardLinkReviewMode?.annotationHorizontal
      const layout = reviewToolbarLayout(horizontal, false, 0, { width: Math.max(0, bounds.width - 20), height: Math.max(0, bounds.height - 20) }, reviewToolbarCount(owner.cardLinkReviewMode || {}))
      const next = { width: layout.mainWidth + 8, height: layout.height + 8 }
      let frame = { ...menu.reviewCore!, ...next }
      if (horizontal !== menu.reviewHorizontal && owner.mnutilsEntranceDragging && owner.cardLinkReviewDragAnchor) {
        frame = reviewToolbarTrackingFrame(menu.reviewCore!, next, owner.cardLinkReviewDragAnchor.point, bounds)
      }
      return clampReviewToolbarCore(frame, bounds, horizontal)
    }
    let requestedSize: { width: number; height: number; origin: { x: number; y: number } } | undefined
    owner.cardLinkReviewEntrancePlacement = () => {
      const frame = menu.reviewCore!
      return { point: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, bounds: windowSize(window) }
    }
    owner.cardLinkReviewEntranceLimits = () => {
      const size = windowSize(window), core = coreFrame(), horizontal = !!owner.cardLinkReviewMode?.annotationHorizontal
      return { width: Math.max(0, horizontal ? size.width - core.x - 12 : size.width - 20),
        height: Math.max(0, size.height - core.y - 12), coreWidth: core.width - 8,
        left: Math.max(0, core.x - 2), right: Math.max(0, size.width - core.x - core.width - 2),
        above: Math.max(0, core.y - 2), below: Math.max(0, size.height - core.y - core.height - 2) }
    }
    owner.cardLinkReviewEntranceResize = (bodyHeight: number, bodyWidth: number, origin = { x: 0, y: 0 }) => {
      requestedSize = { height: bodyHeight + 8, width: bodyWidth + 8, origin }
    }
    owner.cardLinkReviewEntranceCommit = (animated = false) => {
      if (!requestedSize || menu.reviewDrag?.phase === 'tracking') return
      const { height, width, origin } = requestedSize
      requestedSize = undefined
      const core = coreFrame(), horizontal = !!owner.cardLinkReviewMode?.annotationHorizontal
      const frame = { x: core.x + origin.x, y: core.y + origin.y, width, height }
      const previous = menu.expandedFrame
      if (!menu.reviewDrag && previous.x === frame.x && previous.y === frame.y && previous.width === width && previous.height === height &&
          menu.reviewOrigin?.x === origin.x && menu.reviewOrigin?.y === origin.y) return
      menu.desiredHeight = height; menu.desiredWidth = width
      menu.reviewCore = core; menu.reviewOrigin = origin; menu.reviewHorizontal = horizontal
      menu.geometry = { ...menu.geometry, frame }
      menu.expandedFrame = frame
      const apply = () => {
        const render = owner.cardLinkReviewEntranceRender
        owner.cardLinkReviewEntranceRender = undefined
        try {
          layoutQuickMenu(menu, menu.geometry, !menu.reviewOpening && !menu.reviewDrag)
          menu.reviewControls!.bounds = { x: origin.x, y: origin.y, width: width - 8, height: height - 8 }
          // The hidden ball follows only the stable main controls.
          const ball = { ...menu.ball.frame, x: core.x + 12, y: core.y + 12 }
          setWindowFrame(menu.ball.button, ball)
          menu.collapsedFrame = ball
          owner.mnutilsEntranceNativeFrame = { ...ball }
          if (owner.mnutilsEntranceDragging && !menu.reviewDrag) setWindowFrame(menu.content, frame)
          if (menu.reviewOpening && !menu.reviewDrag) setQuickMenuShell(menu, menu.collapsedFrame, ENTRANCE_SIZE / 2)
        } finally { owner.cardLinkReviewEntranceRender = render }
      }
      if (animated && !owner.mnutilsEntranceDragging && !menu.reviewDrag) void animateQuickMenuUpdate(apply, 0.2)
      else apply()
    }
    owner.cardLinkReviewEntranceRender(menu.reviewControls)
    setQuickMenuShell(menu, menu.collapsedFrame, ENTRANCE_SIZE / 2)
  } else if (clipperModeActive(owner)) prepareClipperMenu(menu)
  else if ((sameMapPracticeActive() || menu.mode === "selected") && readQuickMenuQuestions(menu)) {
    if (sameMapPracticeActive()) renderQuestionTree(menu, true)
    void updateSegmentSelection(menu)
  }
  void animateQuickMenu(menu, true)
}

export function openReviewQuickMenu(owner: any = self): boolean {
  ensureMnutilsEntrance(owner)
  const button = owner.mnutilsEntranceBall
  const window = button?.button?.superview ?? button?.window
  if (!button || !window) return false
  openQuickMenu(button, window, owner)
  return true
}

export function closeReviewQuickMenu(owner: any = self): void {
  const menu = owner.mnutilsQuickMenu as QuickMenu | undefined
  if (menu?.reviewControls) {
    closeQuickMenu(false, owner, "review-exit")
    const dock = nearestDock(menu.ball, menu.window)
    owner.mnutilsEntranceDock = dock
    owner.mnutilsEntranceNativeFrame = undefined
    rememberDock(dock)
    owner.mnutilsEntranceAnimating = true
    void animateQuickMenuUpdate(() => { menu.ball.frame = dockedFrame(menu.window, dock) }, 0.24)
      .finally(() => { owner.mnutilsEntranceAnimating = false })
  }
  owner.cardLinkReviewEntranceHost = undefined
  owner.cardLinkReviewEntranceResize = undefined
  owner.cardLinkReviewEntranceCommit = undefined
  owner.cardLinkReviewEntranceLimits = undefined
  owner.cardLinkReviewEntrancePlacement = undefined
}

/** MN Utils 可用时，在当前窗口右上方创建独立的插件入口；缺失时静默跳过。 */
export function ensureMnutilsEntrance(owner: any = self): void {
  if (!mnutilsButtonAvailable()) return
  try {
    const window = MNUtil.currentWindow ?? owner.window
    if (!window) return
    const existing = owner.mnutilsEntranceBall
    if (existing?.window === window && existing?.superview) {
      const menu = owner.mnutilsQuickMenu as QuickMenu | undefined
      if (menu?.open) {
        if (owner.mnutilsEntranceDragging) return
        const currentSize = windowSize(window)
        if (currentSize.width !== menu.windowSize.width || currentSize.height !== menu.windowSize.height) {
          menu.generation++
          settleQuickMenu(menu)
          menu.windowSize = currentSize
          menu.collapsedFrame = { ...existing.frame }
          menu.geometry = geometryFor(menu.collapsedFrame, window, menu.desiredWidth, menu.desiredHeight, owner)
          menu.expandedFrame = menu.geometry.frame
          layoutQuickMenu(menu, menu.geometry)
        }
      } else if (!owner.mnutilsEntranceDragging && !owner.mnutilsEntranceAnimating) {
        const dock = owner.mnutilsEntranceDock as EntranceDock | undefined
        if (owner.mnutilsEntranceNativeFrame) { existing.frame = owner.mnutilsEntranceNativeFrame; clampEntranceFrame(existing) }
        else dock ? applyDock(existing, window, dock, false) : clampEntranceFrame(existing)
      }
      return
    }
    closeQuickMenu(false, owner)
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
    // owner.path 在 JSB 运行时里是 undefined，图标因此加载失败只剩蓝底；
    // 插件目录存在 owner.mainPath（sceneWillConnect 时由 JSB.newAddon(mainPath) 赋值）。
    MNButton.setImage(button.button, `${owner.mainPath}/logo.png`, 2)
    button.button.contentHorizontalAlignment = 0
    button.button.contentVerticalAlignment = 0
    button.button.contentEdgeInsets = { top: 0, left: 0, bottom: 0, right: 0 }
    // MNButton 的公开用法是静态 helper，并把底层 UIButton 作为第一个参数；
    // 实例方法在真机上不会安装长按识别器。
    button.addClickAction(owner, "onMnutilsEntranceClick:")
    button.addPanGesture(owner, "onMnutilsEntrancePan:")
    MNButton.addLongPressGesture(button.button ?? button, owner, "onMnutilsEntranceLongPress:", 1)
    window.bringSubviewToFront?.(button.button)
    owner.mnutilsEntranceBall = button
    owner.mnutilsEntranceDock = owner.mnutilsEntranceDock ?? storedDock() ?? {
      edge: "right",
      ratio: clampRatio((Number(button.frame.y) - EDGE_MARGIN) / Math.max(1, height - ENTRANCE_SIZE - EDGE_MARGIN * 2))
    }
    if (owner.mnutilsEntranceNativeFrame) { button.frame = owner.mnutilsEntranceNativeFrame; clampEntranceFrame(button) }
    else applyDock(button, window, owner.mnutilsEntranceDock, false)
  } catch (error) {
    try { console.log("MNButton 第二入口创建失败:", String(error)) } catch { /* optional */ }
  }
}

export function removeMnutilsEntrance(): void {
  exitClipperMode()
  closeQuickMenu(false)
  stopSameMapPractice()
  practiceQueueSnapshot = undefined
  try { self.mnutilsEntranceBall?.removeFromSuperview?.() } catch { /* optional dependency */ }
  self.mnutilsEntranceBall = undefined
  self.mnutilsEntranceDragging = false
  self.mnutilsEntranceMenuDragging = false
  self.mnutilsEntranceAnimating = false
  self.mnutilsEntranceDragOffset = undefined
}

export function onMnutilsEntranceClick(_sender: any): void {
  try {
    if (Date.now() - Number(self.mnutilsEntranceSuppressClick ?? 0) < 1500) {
      self.mnutilsEntranceSuppressClick = 0
      return
    }
    const menu = self.mnutilsQuickMenu as QuickMenu | undefined
    if (menu?.open) onMnutilsQuickMenuOpenPanel()
    else {
      const button = self.mnutilsEntranceBall
      const window = button?.button?.superview ?? button?.window
      if (button && window) {
        if (!self.cardLinkReviewEntranceRender && !clipperModeActive() && !sameMapPracticeActive() && loadMatcherSettings().entranceDefaultMode === "clipper") openClipperQuickMenu()
        else openQuickMenu(button, window)
      }
    }
  } catch (error) {
    try { console.log("MNButton 快捷功能区切换失败:", String(error)) } catch { /* optional */ }
    showHUD(String((error as Error)?.message || error), 3)
  }
}

export function onMnutilsQuickMenuDismiss(): void {
  closeQuickMenu(true, self, "close-button")
}

export function onMnutilsQuickMenuWindowTap(sender: any): void {
  if (clipperModeActive()) return
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open || menu.modePicker || Date.now() - (self.quickMenuModePressAt || 0) < 400 || Number(sender?.state) !== 3) return
  // Use UIKit's conversion into the actual menu view, rather than comparing
  // a window point against cached target geometry during layout/animation.
  const point = sender.locationInView?.(menu.content)
  const bounds = (menu.content as any).bounds
  if (!point || !bounds) return
  const x = Number(point.x), y = Number(point.y)
  const left = Number(bounds.x), top = Number(bounds.y)
  const width = Number(bounds.width), height = Number(bounds.height)
  if (![x, y, left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return
  const inside = x >= left && x <= left + width && y >= top && y <= top + height
  recordRuntimeState("悬浮菜单", "windowTap", `inside=${inside} point=${x},${y} bounds=${left},${top},${width},${height} interactive=${(menu.content as any).userInteractionEnabled}/${(menu.controls as any).userInteractionEnabled}`)
  if (!inside) closeQuickMenu(true, self, "outside-tap")
}

export function onMnutilsQuickMenuFilter(): void {
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  recordRuntimeState("悬浮菜单", "filter.tap", `open=${!!menu?.open}`)
  if (!menu?.open) return
  if (sameMapPracticeActive()) return
  if (menu.mode === "selected") {
    menu.mode = "all"
    if (!readQuickMenuQuestions(menu)) return
    renderQuestionTree(menu)
    updateSegmentSelection(menu)
    return
  }
  if (menu.mode === "all") menu.selectedIds.clear()
  menu.mode = "filter"
  if (!readQuickMenuQuestions(menu)) return
  renderQuestionTree(menu)
  void updateSegmentSelection(menu)
}

export function onMnutilsQuickMenuSelectAll(sender?: any): void {
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  recordRuntimeState("悬浮菜单", "selectAll.tap", `open=${!!menu?.open}`)
  if (sameMapPracticeActive()) return
  if (!menu?.open || !readQuickMenuQuestions(menu)) return
  menu.selectedIds = new Set(questionIdsInTree(menu.tree))
  if (menu.customAllButton && Number(sender?.tag) !== 1) {
    menu.mode = "selected"
    menu.selectedIds = new Set(selectedQuestionIds(menu.tree, menu.selectedCardIds, menu.selectDescendants))
  } else menu.mode = "all"
  renderQuestionTree(menu)
  void updateSegmentSelection(menu)
}

export function onMnutilsQuickMenuToggleQuestion(sender: any): void {
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  const node = menu?.visibleRows[Number(sender?.tag)]
  if (!menu?.open || !node) return
  if (sameMapPracticeActive()) {
    const target = node.question && menu.selectedIds.has(node.id)
      ? node.id : node.questionIds.find(id => menu.selectedIds.has(id))
    if (target) {
      closeQuickMenu()
      if (menu.owner.cardLinkReviewMode?.purpose === "practice") void goToPracticeQuestion(target, menu.owner)
      else void navigateSameMapPractice(target)
    }
    return
  }
  const rowQuestions = menu.selectDescendants === false && node.question ? [node.id] : node.questionIds
  const allSelected = rowQuestions.every(id => menu.selectedIds.has(id))
  for (const id of rowQuestions) {
    if (allSelected) menu.selectedIds.delete(id)
    else menu.selectedIds.add(id)
  }
  updateStartTitle(menu)
  renderQuestionTree(menu)
}

export function onMnutilsQuickMenuToggleBranch(sender: any): void {
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  const node = menu?.visibleRows[Number(sender?.tag)]
  if (!menu?.open || !node?.children.length) return
  if (menu.expandedIds.has(node.id)) menu.expandedIds.delete(node.id)
  else menu.expandedIds.add(node.id)
  rememberTreeExpansion(menu)
  renderQuestionTree(menu)
}

function dismissModePicker(menu: QuickMenu): void {
  ;(menu.modePicker?.view as any)?.removeFromSuperview()
  menu.modePicker = undefined
}

export function onMnutilsQuickMenuModePress(sender: any): void {
  const owner = self, menu = owner.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open) return
  const state = Number(sender?.state), point = sender.locationInView?.(menu.window)
  owner.quickMenuModePressAt = Date.now()
  if (state === 1 && point) {
    dismissModePicker(menu)
    const button = menu.startButton.frame
    const origin = { x: menu.expandedFrame.x + button.x, y: menu.expandedFrame.y + button.y, width: button.width, height: button.height }
    const frame = { x: Math.max(8, Math.min(origin.x + origin.width / 2 - 72, menu.windowSize.width - 152)),
      y: Math.max(8, Math.min(origin.y + origin.height / 2 - 44, menu.windowSize.height - 96)), width: 144, height: 88 }
    const view = createWindowSurface(origin)
    view.backgroundColor = UIColor.clearColor()
    view.layer.cornerRadius = 22; view.layer.masksToBounds = true
    ;(view as any).userInteractionEnabled = false
    // UIToolbar.translucent is exposed by MarginNote's UIKit bridge.
    // Keep the native backdrop behind sibling labels so text stays sharp.
    const glass = new UIToolbar({ x: 0, y: 0, width: origin.width, height: origin.height })
    glass.barStyle = 0
    glass.translucent = true
    glass.backgroundColor = UIColor.clearColor()
    ;(glass as any).userInteractionEnabled = false
    view.addSubview(glass)
    const rows = ["做题模式", "摘题模式"].map((title, index) => {
      const row = menuLabel(title, { x: 0, y: index * 44, width: 144, height: 44 }, 14, "#6e6e73")
      row.textAlignment = 1; row.backgroundColor = UIColor.clearColor(); view.addSubview(row); return row
    })
    menu.modePicker = { view, rows, frame, start: { x: Number(point.x), y: Number(point.y) }, selected: -1 }
    menu.window.addSubview(view)
    void animateQuickMenuUpdate(() => { view.frame = frame; glass.frame = { x: 0, y: 0, width: frame.width, height: frame.height } }, .2)
  }
  const picker = menu.modePicker
  if (!picker) return
  if ((state === 2 || state === 3) && point) {
    const x = Number(point.x), y = Number(point.y), f = picker.frame
    const moved = Math.abs(y - picker.start.y) > 8 || Math.abs(x - picker.start.x) > 8
    picker.selected = moved && x >= f.x && x <= f.x + f.width && y >= f.y && y < f.y + f.height ? Math.floor((y - f.y) / 44) : -1
    picker.rows.forEach((row, index) => {
      row.backgroundColor = index === picker.selected ? UIColor.colorWithHexString(UI_COLORS.accent) : UIColor.clearColor()
      row.textColor = index === picker.selected ? UIColor.whiteColor() : UIColor.colorWithHexString("#6e6e73")
    })
  }
  if (state < 3) return
  const selected = state === 3 ? picker.selected : -1
  dismissModePicker(menu)
  if (selected < 0 || (selected === 1) === clipperModeActive(owner)) return
  try {
    if (selected === 1) openClipperQuickMenu(owner)
    else { exitClipperMode(owner); openQuickMenu(menu.ball, menu.window, owner) }
  } catch (error) { showHUD(String((error as Error)?.message || error), 3) }
}

export async function onMnutilsQuickMenuStart(): Promise<void> {
  recordRuntimeState("悬浮菜单", "start.tap", `open=${!!self.mnutilsQuickMenu?.open} pressAgeMs=${Date.now() - (self.quickMenuModePressAt || 0)}`)
  if (Date.now() - (self.quickMenuModePressAt || 0) < 400) return
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open) return
  if (clipperModeActive()) { toggleClipperRunning(menu.owner); return }
  if (menu.owner.cardLinkReviewMode?.purpose === "practice") {
    onReviewModeExit(undefined, menu.owner)
    if (!menu.owner.cardLinkReviewMode) closeQuickMenu(false, menu.owner, "practice-exit")
    return
  }
  if (sameMapPracticeActive()) {
    // 主动结束做题属于正常退出：按题卡立即恢复折叠状态，不等后台计时器。
    stopSameMapPractice()
    practiceQueueSnapshot = undefined
    menu.mode = "all"
    readQuickMenuQuestions(menu)
    renderQuestionTree(menu)
    void updateSegmentSelection(menu)
    updateStartTitle(menu)
    showHUD("已结束做题", 2)
    return
  }
  if (!readQuickMenuQuestions(menu)) return
  const notebookId = String(MN.currnetNotebookId ?? "").trim()
  const queue = questionIdsInTree(menu.tree).filter(id => menu.selectedIds.has(id))
  recordRuntimeState("悬浮菜单", "start.queue", `count=${queue.length}`)
  if (!queue.length) {
    showHUD(!questionIdsInTree(menu.tree).length
      ? menu.questionColorIndex !== undefined ? "当前脑图没有符合条件的题目，请检查答案配置中的题目颜色筛选"
        : "当前脑图未读到可用题目，请重新打开脑图后重试"
      : menu.mode === "selected" ? "所选卡片未包含符合条件的题目，请检查题目颜色或改用自定义选择"
        : "请先选择做题题目", 4)
    return
  }
  if (menu.owner.cardLinkPracticeChoosing) return
  menu.owner.cardLinkPracticeChoosing = true
  try {
    const choice = await select(["脑图内书写", "批注窗口书写"], "做题方式", "批注书写需要模板配置", true)
    if (![0, 1].includes(choice.index)) return
    if (!menu.open || menu.owner.mnutilsQuickMenu !== menu || String(MN.currnetNotebookId ?? "").trim() !== notebookId) {
      showHUD("做题范围已关闭或切换，请重新选择题目", 3)
      return
    }
    const scopeId = JSON.parse(menu.expansionScope!)[1]
    const result = await startPracticeMode(notebookId, queue, scopeId === MAIN_MINDMAP_SCOPE_ID ? undefined : scopeId, menu.maskAnswers === true, choice.index === 0 ? "mindmap" : "annotation", menu.owner)
    if (!result.started) {
      const reason = result.reason || "没有可开始的题目"
      recordRuntimeState("悬浮菜单", "start.failed", reason)
      showHUD(`无法开始做题：${reason}`, 5)
      return
    }
    practiceQueueSnapshot = { tree: menu.tree, questionIds: queue, expansionScope: menu.expansionScope! }
    showHUD("已开始做题", 2)
  } catch (error) {
    const message = String((error as Error)?.message || error)
    recordRuntimeState("悬浮菜单", "start.error", message)
    showHUD(`无法开始做题：${message}`, 3)
  } finally { menu.owner.cardLinkPracticeChoosing = false }
}

export function onMnutilsQuickMenuOpenPanel(): void {
  closeQuickMenu(true, self, "open-panel")
  try {
    showPluginPanel()
    const study = Application.sharedInstance().studyController(self.window)
    study?.refreshAddonCommands?.()
  } catch (error) {
    try { console.log("MNButton 打开插件页面失败:", String(error)) } catch { /* optional */ }
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
    closeQuickMenu(true, self, "entrance-long-press")
    performEntranceReset()
  } catch (error) {
    try { console.log("MNButton 第二入口长按复位失败:", String(error)) } catch { /* optional */ }
  }
}

/** Clip the real controls against the same animated outline as the shell.
 * Bounds offsets hold each control in window space while revealing both sides. */
function revealReviewToolbarDrag(menu: QuickMenu, visible: ViewFrame, full: ViewFrame): void {
  const drag = menu.reviewDrag!
  drag.preview.frame = visible
  drag.preview.layer.cornerRadius = Math.min(22, visible.width / 2, visible.height / 2)
  // The preview owns the expanding outline. UIKit's independent frame/bounds
  // interpolation on the real controls otherwise adds a second sideways flight.
  const native = UIView as any
  const canDisable = typeof native.areAnimationsEnabled === 'function' && typeof native.setAnimationsEnabled === 'function'
  const enabled = canDisable ? native.areAnimationsEnabled() : undefined
  try {
    if (canDisable) native.setAnimationsEnabled(false)
    setWindowFrame(menu.controls, visible)
    menu.controls.bounds = { x: visible.x - full.x, y: visible.y - full.y, width: visible.width, height: visible.height }
  } finally { if (canDisable) native.setAnimationsEnabled(enabled) }
  menu.controls.layer.cornerRadius = drag.preview.layer.cornerRadius
  menu.controls.layer.masksToBounds = true
}

function collapseReviewToolbarDrag(menu: QuickMenu): void {
  const drag = menu.reviewDrag!
  drag.transformed = true
  drag.preview.hidden = false
  drag.grip.hidden = false
  menu.content.backgroundColor = UIColor.clearColor()
  menu.content.layer.borderWidth = 0
  ;(menu.content.layer as any).shadowOpacity = 0
  menu.content.layer.masksToBounds = false
  drag.revision++
  const geometry = reviewToolbarDragGeometry(drag.point, windowSize(menu.window), drag.edge, drag.nearEdge)
  drag.hovering = false
  const old = menu.content.frame, next = geometry.container
  // Retain the current window-space outline before moving its tracking parent.
  for (const view of [drag.preview, drag.grip, menu.controls]) {
    const f = view.frame
    setWindowFrame(view, { ...f, x: f.x + old.x - next.x, y: f.y + old.y - next.y })
  }
  drag.full = { ...menu.expandedFrame, x: menu.expandedFrame.x - next.x, y: menu.expandedFrame.y - next.y }
  setWindowFrame(menu.content, next)
  const plugin = menu.owner.cardLinkReviewAnnotationButtons?.[0]
  if (plugin) plugin.layer.opacity = 0
  ;(drag.grip as any).alpha = 1
  const from = { ...drag.preview.frame }, grip = { ...drag.grip.frame }, to = { x: 14, y: 14, width: 44, height: 44 }
  drag.transition = animateReviewGeometry(menu, .34, progress => {
    revealReviewToolbarDrag(menu, interpolateReviewFrame(from, to, progress), drag.full)
    ;(menu.controls.layer as any).opacity = progress === 1 ? 0 : 1
    drag.grip.frame = interpolateReviewFrame(grip, to, progress)
  })
}

function expandReviewToolbarDrag(menu: QuickMenu, cancelled = false): void {
  const drag = menu.reviewDrag, owner = menu.owner, current = owner.cardLinkReviewMode
  if (!drag || !current || drag.hovering) return
  drag.hoverTimer?.invalidate()
  drag.hovering = true
  const revision = ++drag.revision
  const target = cancelled ? { frame: drag.homeCore, horizontal: drag.homeHorizontal }
    : reviewToolbarDropFrame(drag.point, windowSize(menu.window), reviewToolbarCount(current), drag.edge)
  menu.reviewCore = { ...target.frame }; menu.reviewHorizontal = target.horizontal
  current.annotationHorizontal = target.horizontal
  // Permit exactly one final layout, including the already-open classification.
  const phase = drag.phase
  drag.phase = 'settling'
  owner.cardLinkReviewDetailKey = undefined
  withoutReviewAnimations(() => owner.cardLinkReviewEntranceRender?.(menu.reviewControls))
  drag.phase = phase
  const root = menu.content.frame, end = menu.expandedFrame
  const full = { x: end.x - root.x, y: end.y - root.y, width: end.width, height: end.height }
  drag.full = full
  const start = { ...drag.preview.frame }
  revealReviewToolbarDrag(menu, start, full)
  ;(menu.controls.layer as any).opacity = 1
  const plugin = owner.cardLinkReviewAnnotationButtons?.[0]
  if (plugin) plugin.layer.opacity = 0
  const gripFrom = { ...drag.grip.frame }, core = menu.reviewCore!
  const gripTo = { x: core.x + 4 - root.x, y: core.y + 4 - root.y, width: 44, height: 44 }
  drag.transition = animateReviewGeometry(menu, .46, progress => {
    revealReviewToolbarDrag(menu, interpolateReviewFrame(start, full, progress), full)
    drag.grip.frame = interpolateReviewFrame(gripFrom, gripTo, progress)
  }).then(() => {
    if (menu.reviewDrag !== drag || drag.revision !== revision || !drag.hovering) return
    withoutReviewAnimations(() => {
      if (plugin) plugin.layer.opacity = 1
      ;(drag.grip as any).alpha = 0
    })
  })
}

function beginReviewToolbarDrag(menu: QuickMenu, point: { x: number; y: number }): void {
  menu.reviewAnimation?.finish()
  if (menu.reviewDrag) {
    menu.reviewDrag.hoverTimer?.invalidate()
    ;(menu.reviewDrag.preview as any).removeFromSuperview()
    ;(menu.reviewDrag.grip as any).removeFromSuperview()
    menu.reviewDrag = undefined
  }
  menu.generation++
  menu.reviewOpening = false
  withoutReviewAnimations(() => {
    settleQuickMenu(menu)
    menu.controls.frame = { x: 0, y: 0, width: menu.expandedFrame.width, height: menu.expandedFrame.height }
    menu.controls.bounds = { ...menu.controls.frame }
    ;(menu.controls.layer as any).opacity = 1
    const plugin = menu.owner.cardLinkReviewAnnotationButtons?.[0]
    if (plugin) plugin.layer.opacity = 1
  })
  const geometry = reviewToolbarDragGeometry(point, windowSize(menu.window))
  const original = { ...menu.content.frame }
  const preview = new UIView({ x: 0, y: 0, width: original.width, height: original.height })
  styleAnnotationReviewSurface(preview, 'shell')
  ;(preview as any).userInteractionEnabled = false
  const core = menu.reviewCore!
  const grip = UIButton.buttonWithType(0)
  grip.frame = { x: core.x + 4 - original.x, y: core.y + 4 - original.y, width: 44, height: 44 }
  ;(grip as any).setImageForState(menu.owner.cardLinkReviewNativeImages?.plugin || UIImage.imageWithDataScale(NSData.dataWithContentsOfFile(`${menu.owner.mainPath}/logo.png`), 2), 0)
  ;(grip as any).contentEdgeInsets = { top: 10, left: 10, bottom: 10, right: 10 }
  ;(grip as any).userInteractionEnabled = false
  menu.content.addSubview(preview)
  ;(menu.content as any).bringSubviewToFront(menu.controls)
  menu.content.addSubview(grip)
  preview.hidden = true
  grip.hidden = true
  menu.reviewDrag = { point: geometry.point, displacement: { x: 0, y: 0 }, transformed: false, edge: geometry.edge, nearEdge: geometry.nearEdge, phase: 'tracking', preview, grip, generation: menu.generation, revision: 0, lastMoveAt: Date.now(), slowSamples: 0, full: original, homeCore: { ...core }, homeHorizontal: !!menu.reviewHorizontal }
  ;(menu.controls as any).alpha = 1
  ;(menu.controls.layer as any).removeAnimationForKey?.('opacity')
}

function scheduleReviewToolbarHover(menu: QuickMenu): void {
  const drag = menu.reviewDrag
  if (!drag || !drag.transformed || drag.phase !== 'tracking' || drag.hovering) return
  drag.hoverTimer?.invalidate()
  drag.hoverTimer = NSTimer.scheduledTimerWithTimeInterval(.09, false, () => {
    if (!menu.open || menu.reviewDrag !== drag || drag.phase !== 'tracking' || menu.generation !== drag.generation) return
    expandReviewToolbarDrag(menu)
  })
}

function translateReviewToolbarDrag(menu: QuickMenu, delta: { x: number; y: number }): void {
  const core = menu.reviewCore!, root = menu.content.frame
  const next = clampReviewToolbarCore({ ...core, x: core.x + delta.x, y: core.y + delta.y }, windowSize(menu.window), !!menu.reviewHorizontal)
  const dx = next.x - core.x, dy = next.y - core.y
  setWindowFrame(menu.content, { ...root, x: root.x + dx, y: root.y + dy })
  menu.reviewCore = next
  menu.expandedFrame = { ...menu.expandedFrame, x: menu.expandedFrame.x + dx, y: menu.expandedFrame.y + dy }
  menu.geometry = { ...menu.geometry, frame: menu.expandedFrame }
  setWindowFrame(menu.ball.button, { ...menu.ball.frame, x: next.x + 12, y: next.y + 12 })
  menu.collapsedFrame = { ...menu.ball.frame }
}

function trackReviewToolbarDrag(menu: QuickMenu, delta: { x: number; y: number }): void {
  const drag = menu.reviewDrag
  if (!drag || drag.phase !== 'tracking' || (!delta.x && !delta.y)) return
  const now = Date.now(), speed = Math.hypot(delta.x, delta.y) / Math.max(8, now - drag.lastMoveAt)
  drag.lastMoveAt = now
  drag.displacement.x += delta.x
  drag.displacement.y += delta.y
  const travelled = Math.hypot(drag.displacement.x, drag.displacement.y) >= REVIEW_TOOLBAR_DRAG_MIN_DISTANCE
  const next = reviewToolbarDragGeometry({ x: drag.point.x + delta.x, y: drag.point.y + delta.y }, windowSize(menu.window), drag.edge, drag.nearEdge)
  drag.point = next.point; drag.edge = next.edge; drag.nearEdge = next.nearEdge
  drag.slowSamples = speed < .16 ? drag.slowSamples + 1 : 0
  if (!drag.transformed) {
    translateReviewToolbarDrag(menu, delta)
    if (!travelled || speed <= .32) return
    collapseReviewToolbarDrag(menu)
  } else if (drag.hovering && travelled && (speed > .32 || next.horizontal !== menu.reviewHorizontal)) collapseReviewToolbarDrag(menu)
  if (drag.hovering) {
    const target = reviewToolbarDropFrame(next.point, windowSize(menu.window), reviewToolbarCount(menu.owner.cardLinkReviewMode || {}), drag.edge)
    const dx = target.frame.x - menu.reviewCore!.x, dy = target.frame.y - menu.reviewCore!.y
    const root = menu.content.frame
    setWindowFrame(menu.content, { ...root, x: root.x + dx, y: root.y + dy })
    menu.reviewCore = target.frame
    menu.expandedFrame = { ...menu.expandedFrame, x: menu.expandedFrame.x + dx, y: menu.expandedFrame.y + dy }
    menu.geometry = { ...menu.geometry, frame: menu.expandedFrame }
    return
  }
  setWindowFrame(menu.content, next.container)
  if (drag.slowSamples >= 2) expandReviewToolbarDrag(menu)
  else scheduleReviewToolbarHover(menu)
}

function finishReviewToolbarDrag(menu: QuickMenu, cancelled: boolean): void {
  const drag = menu.reviewDrag, owner = menu.owner
  if (!drag || drag.phase !== 'tracking') return
  drag.hoverTimer?.invalidate()
  if (!drag.transformed) {
    if (cancelled) translateReviewToolbarDrag(menu, { x: drag.homeCore.x - menu.reviewCore!.x, y: drag.homeCore.y - menu.reviewCore!.y })
  } else {
    if (cancelled && drag.hovering) drag.hovering = false
    if (!drag.hovering) expandReviewToolbarDrag(menu, cancelled)
  }
  drag.phase = 'settling'
  // If a slowdown already revealed controls, release only completes the handoff.
  void Promise.resolve(drag.transition).then(() => {
    if (!menu.open || menu.generation !== drag.generation || menu.reviewDrag !== drag) return
    // UIKit can retain presentation animations after the model outline reaches
    // its target. Swap the shell and reset bounds atomically, with no inherited
    // animation on the controls that would draw a second offset presentation.
    withoutReviewAnimations(() => {
      for (const view of [menu.content, menu.controls, menu.reviewControls, owner.cardLinkReviewToolbar, ...(owner.cardLinkReviewAnnotationButtons || [])]) {
        for (const key of ['position', 'bounds']) (view?.layer as any)?.removeAnimationForKey?.(key)
      }
      menu.reviewDrag = undefined
      settleQuickMenu(menu)
      menu.controls.bounds = { x: 0, y: 0, width: menu.expandedFrame.width, height: menu.expandedFrame.height }
      menu.controls.layer.masksToBounds = true
      ;(menu.controls.layer as any).opacity = 1
      const plugin = owner.cardLinkReviewAnnotationButtons?.[0]
      if (plugin) plugin.layer.opacity = 1
      ;(drag.preview as any).removeFromSuperview()
      ;(drag.grip as any).removeFromSuperview()
      const core = menu.reviewCore!
      setWindowFrame(menu.ball.button, { ...menu.ball.frame, x: core.x + 12, y: core.y + 12 })
    })
    const dock = nearestDock(menu.ball, menu.window)
    owner.mnutilsEntranceDock = dock
    rememberDock(dock)
  })
}

export function onMnutilsEntrancePan(sender: any): void {
  const button = self.mnutilsEntranceBall
  if (!button) return
  const window = button.button?.superview ?? button.window ?? self.window ?? MNUtil.currentWindow
  if (!window) return
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  const state = Number(sender.state)
  if (menu?.open && menu.reviewControls) {
    if (state === 1) {
      self.mnutilsEntranceDragging = true
      self.mnutilsEntranceSuppressClick = Date.now()
      const frame = menu.reviewCore || menu.expandedFrame
      beginReviewToolbarDrag(menu, sender.locationInView?.(window) ?? { x: frame.x + 22, y: frame.y + 22 })
    }
    const delta = sender.translationInView(window)
    sender.setTranslationInView({ x: 0, y: 0 }, window)
    if (state !== 1) trackReviewToolbarDrag(menu, delta)
    if ([3, 4, 5].includes(state)) {
      self.mnutilsEntranceDragging = false
      self.mnutilsEntranceMenuDragging = false
      self.mnutilsEntranceSuppressClick = Date.now()
      finishReviewToolbarDrag(menu, state !== 3)
    }
    return
  }
  if (state === 1) {
    self.mnutilsEntranceDragging = true
    self.mnutilsEntranceSuppressClick = Date.now()
    if (menu?.open) { menu.generation++; settleQuickMenu(menu) }
  }
  const translation = sender.translationInView(window)
  sender.setTranslationInView({ x: 0, y: 0 }, window)
  if (menu?.open) {
    const frame = menu.content.frame, bounds = windowSize(window)
    const nextCore = menu.reviewCore ? clampReviewToolbarCore({ ...menu.reviewCore,
      x: menu.reviewCore.x + translation.x, y: menu.reviewCore.y + translation.y }, bounds, !!menu.owner.cardLinkReviewMode?.annotationHorizontal) : undefined
    const x = nextCore ? frame.x + nextCore.x - menu.reviewCore!.x : Math.max(0, Math.min(frame.x + translation.x, bounds.width - frame.width))
    const y = nextCore ? frame.y + nextCore.y - menu.reviewCore!.y : Math.max(0, Math.min(frame.y + translation.y, bounds.height - frame.height))
    const dx = x - frame.x, dy = y - frame.y
    // Moving the native parent moves every child. No per-move render or layout.
    setWindowFrame(menu.content, { ...frame, x, y })
    if (menu.reviewCore) menu.reviewCore = { ...menu.reviewCore, x: menu.reviewCore.x + dx, y: menu.reviewCore.y + dy }
    menu.expandedFrame = { ...menu.expandedFrame, x, y }
    menu.geometry = { ...menu.geometry, frame: menu.expandedFrame }
    setWindowFrame(button.button, { ...button.frame, x: button.frame.x + dx, y: button.frame.y + dy })
    menu.collapsedFrame = { ...button.frame }
  } else {
    const bounds = windowSize(window), frame = button.frame
    setWindowFrame(button.button, { ...frame,
      x: Math.min(Math.max(frame.x + translation.x, EDGE_MARGIN), Math.max(EDGE_MARGIN, bounds.width - ENTRANCE_SIZE - EDGE_MARGIN)),
      y: Math.min(Math.max(frame.y + translation.y, EDGE_MARGIN), Math.max(EDGE_MARGIN, bounds.height - ENTRANCE_SIZE - EDGE_MARGIN)) })
  }
  self.mnutilsEntranceNativeFrame = { ...button.frame }
  if ([3, 4, 5].includes(state)) {
    self.mnutilsEntranceDragging = false
    self.mnutilsEntranceMenuDragging = false
    if (!menu?.reviewControls) {
      const dock = nearestDock(button, window)
      self.mnutilsEntranceDock = dock
      self.mnutilsEntranceNativeFrame = undefined
      rememberDock(dock)
      const target = dockedFrame(window, dock)
      // Dragging only translates native views; settle and lay out once at release.
      self.mnutilsEntranceAnimating = true
      void animateQuickMenuUpdate(() => {
        button.frame = target
        if (menu?.open) {
          menu.collapsedFrame = { ...target }
          menu.geometry = geometryFor(target, window, menu.desiredWidth, menu.desiredHeight, menu.owner)
          menu.expandedFrame = menu.geometry.frame
          layoutQuickMenu(menu, menu.geometry)
        }
      }, 0.24).finally(() => { self.mnutilsEntranceAnimating = false })
    }
  }
}
