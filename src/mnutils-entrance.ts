import { showHUD } from "marginnote"
import { resetAnswerCardPosition } from "./answer-card-view"
import { UI_COLORS } from "./ui-tokens"
import { collectQuestionTree, questionIdsInTree, type QuestionTreeNode } from "./quick-menu-selection"
import { MN, NodeNote } from "marginnote"
import { MAIN_MINDMAP_SCOPE_ID, mindMapScopeIdForNote } from "./mindmap-candidate"
import { navigateSameMapPractice, sameMapPracticeActive, sameMapPracticeQuestionIds, startSameMapPractice, stopSameMapPractice } from "./same-map-practice"
import { quickMenuGeometry, type QuickMenuGeometry } from "./quick-menu-geometry"
import { bindingKey, loadBindings, normalizeBinding } from "./store"
import { bindClipperMother, clipperModeActive, clipperSnapshot, enterClipperMode, exitClipperMode, toggleClipperRunning, resetClipperQuestion, editClipperQuestionTitle } from "./question-clipper"

import { clipperProgressHtml } from "./clipper-quick-menu"

const ENTRANCE_SIZE = 44
const EDGE_MARGIN = 18
const INITIAL_TOP = 64
const ENTRANCE_DOCK_KEY = "marginnote.extension.mn4-answer-matcher.entrance-dock.v1"
const QUICK_MENU_WIDTH = 272
const QUICK_MENU_HEIGHT = 122
const QUICK_MENU_LIST_MAX_HEIGHT = 520
const QUICK_MENU_INSET = 12
const QUICK_MENU_LIST_TOP = 122
const QUICK_MENU_LIST_CHROME = QUICK_MENU_LIST_TOP + QUICK_MENU_INSET
const QUICK_MENU_TRANSITION_SECONDS = 0.38

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
  listContainer?: UIView
  tree: QuestionTreeNode[]
  selectedIds: Set<string>
  expandedIds: Set<string>
  rowIds: string[]
  visibleRows: QuestionTreeNode[]
  scroll?: UIScrollView
  mode: "filter" | "all" | "queue"
  questionColorIndex?: number
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
}

let practiceQueueSnapshot: { tree: QuestionTreeNode[]; questionIds: string[] } | undefined

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
  return quickMenuGeometry(ball, windowSize(window), { width: desiredWidth, height: desiredHeight }, edge)
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

function quickMenuSegmentHtml(mode: "all" | "queue"): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
    :root{--ease-main:cubic-bezier(0.32,0.72,0,1);--accent:${UI_COLORS.accent};--muted:#6e6e73;--track:${UI_COLORS.grayFill}6b}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
    .track{position:relative;width:100%;height:42px;padding:3px;border-radius:21px;background:var(--track);display:flex;align-items:center}
    .slider{position:absolute;top:3px;left:3px;width:calc((100% - 6px)/2);height:36px;border-radius:18px;background:#fff;transform:translateX(100%);transition:transform 0.45s var(--ease-main)}
    .label{position:relative;z-index:1;width:50%;text-align:center;font:15px -apple-system,BlinkMacSystemFont,sans-serif;line-height:36px;color:var(--muted);transition:color 0.28s ease 0.06s}
    .track[data-mode="filter"] .slider,.track[data-mode="queue"] .slider{transform:translateX(0)}
    .track[data-mode="filter"] .filter,.track[data-mode="all"] .all,.track[data-mode="queue"] .filter{color:var(--accent)}
    .track[data-mode="queue"] .filter{width:100%}.track[data-mode="queue"] .all{display:none}.track[data-mode="queue"] .slider{width:calc(100% - 6px)}
    @media(prefers-reduced-motion:reduce){.slider,.label{transition:none}}
  </style></head><body><div class="track" data-mode="${mode}"><div class="slider"></div><div class="label filter">${mode === "queue" ? "当前做题队列" : "筛选"}</div><div class="label all">全选</div></div>
  <script>window.setQuickMenuMode=function(mode){var track=document.querySelector('.track');track.dataset.mode=mode;track.querySelector('.filter').textContent=mode==='queue'?'当前做题队列':'筛选'}</script></body></html>`
}

function quickMenuSegmentVisual(width: number, mode: "all" | "queue"): UIWebView {
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

function createQuickMenu(ball: any, window: any, collapsedFrame: ViewFrame, geometry: QuickMenuGeometry, owner: any = self): QuickMenu {
  const expandedFrame = geometry.frame
  const dismissTap = new UITapGestureRecognizer(owner, "onMnutilsQuickMenuWindowTap:")
  dismissTap.cancelsTouchesInView = false
  window.addGestureRecognizer(dismissTap)
  const content = new UIView(collapsedFrame)
  content.backgroundColor = UIColor.colorWithHexString(UI_COLORS.surface).colorWithAlphaComponent(0.94)
  content.layer.cornerRadius = ENTRANCE_SIZE / 2
  content.layer.masksToBounds = true
  ;(content as any).alpha = 0
  ;(content as any).userInteractionEnabled = false
  const controls = new UIView({ x: 0, y: 0, width: expandedFrame.width, height: expandedFrame.height })
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
  const initialMode = sameMapPracticeActive() ? "queue" : "all"
  const segmentVisual = quickMenuSegmentVisual(expandedFrame.width - QUICK_MENU_INSET * 2, initialMode)
  segment.addSubview(segmentVisual)
  const filterButton = menuButton("", { x: 3, y: 0, width: (expandedFrame.width - QUICK_MENU_INSET * 2 - 6) / 2, height: 42 }, "onMnutilsQuickMenuFilter:", owner)
  filterButton.backgroundColor = UIColor.clearColor()
  segment.addSubview(filterButton)
  const allButton = menuButton("", { x: 3 + (expandedFrame.width - QUICK_MENU_INSET * 2 - 6) / 2, y: 0, width: (expandedFrame.width - QUICK_MENU_INSET * 2 - 6) / 2, height: 42 }, "onMnutilsQuickMenuSelectAll:", owner)
  allButton.backgroundColor = UIColor.clearColor()
  segment.addSubview(allButton)
  controls.addSubview(segment)
  window.addSubview(content)
  window.bringSubviewToFront?.(ball.button)
  return {
    owner, window, windowSize: windowSize(window), dismissTap, ball, content, controls, startButton, closeButton, segment, segmentVisual, filterButton, allButton,
    tree: [], selectedIds: new Set(), expandedIds: new Set(), rowIds: [], visibleRows: [], mode: initialMode,
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
    menu.selectedIds = new Set(practiceQueueSnapshot.questionIds)
    updateStartTitle(menu)
    return true
  }
  if (!sameMapPracticeActive()) practiceQueueSnapshot = undefined
  const context = activeMindMapNotes()
  if (!context) {
    showHUD("请先打开脑图", 2)
    return false
  }
  const bindings = loadBindings()
  const binding = normalizeBinding(bindings[bindingKey(context.notebookId, context.scopeId)] ?? bindings[context.notebookId])
  const colors = binding?.questionColors ?? []
  if (!colors.length && !sameMapPracticeActive()) {
    showHUD("请先在答案配置中筛选题目卡片颜色", 3)
    return false
  }
  menu.questionColorIndex = colors[0]
  const inCurrentMap = new Set(context.notes.map(note => String(note.noteId ?? "").trim()))
  menu.tree = collectQuestionTree(context.notes, sameMapPracticeActive() ? undefined : colors, note => inCurrentMap.has(String(note.noteId ?? "").trim()))
  const available = new Set(questionIdsInTree(menu.tree))
  menu.selectedIds = sameMapPracticeActive()
    ? new Set(sameMapPracticeQuestionIds().filter(id => available.has(id)))
    : menu.mode === "all" ? available : new Set([...menu.selectedIds].filter(id => available.has(id)))
  updateStartTitle(menu)
  return true
}

function updateStartTitle(menu: QuickMenu): void {
  if (clipperModeActive(menu.owner)) return
  const running = sameMapPracticeActive()
  menu.startButton.backgroundColor = UIColor.colorWithHexString(running ? "#d92d20" : UI_COLORS.accent)
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
  ;(menu.segmentVisual as any).evaluateJavaScript(`window.setQuickMenuMode(${JSON.stringify(menu.mode)})`, () => {})
}

function layoutQuickMenu(menu: QuickMenu, geometry: QuickMenuGeometry, resizeShell = true): void {
  const frame = geometry.frame
  const width = Math.max(0, frame.width - QUICK_MENU_INSET * 2)
  const listHeight = Math.max(0, frame.height - QUICK_MENU_LIST_CHROME)
  const listY = geometry.expandUp ? QUICK_MENU_INSET : QUICK_MENU_LIST_TOP
  const headerY = geometry.expandUp ? frame.height - 56 : QUICK_MENU_INSET
  if (resizeShell) setQuickMenuShell(menu, frame, 18)
  menu.controls.frame = { x: 0, y: 0, width: frame.width, height: frame.height }
  menu.startButton.frame = { x: 64, y: headerY, width: Math.max(0, frame.width - 128), height: 44 }
  menu.closeButton.frame = { x: geometry.expandLeft ? QUICK_MENU_INSET : frame.width - 56, y: headerY, width: 44, height: 44 }
  menu.segment.frame = { x: QUICK_MENU_INSET, y: geometry.expandUp ? frame.height - 110 : 68, width, height: 42 }
  menu.segmentVisual.frame = { x: 0, y: 0, width, height: 42 }
  const half = Math.max(0, (width - 6) / 2)
  menu.allButton.frame = { x: 3 + half, y: 0, width: half, height: 42 }
  menu.filterButton.frame = { x: 3, y: 0, width: menu.mode === "queue" ? width - 6 : half, height: 42 }
  menu.allButton.hidden = menu.mode === "queue"
  if (menu.listContainer) menu.listContainer.frame = { x: QUICK_MENU_INSET, y: listY, width, height: listHeight }
  if (menu.scroll) {
    menu.scroll.frame = { x: 0, y: 0, width, height: listHeight }
    menu.scroll.contentSize = { width, height: Math.max(listHeight, menu.visibleRows.length * 42) }
  }
  if (menu.clipControls) layoutClipperMenu(menu)
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
    menu.clipControls!.backgroundColor = UIColor.colorWithHexString("#d92d20")
    menu.startButton.setTitleForState(snapshot.started ? snapshot.running ? "暂停" : "继续" : "开始摘题", 0)
    menu.startButton.backgroundColor = snapshot.started ? snapshot.running ? UIColor.whiteColor() : UIColor.colorWithHexString("#d92d20") : UIColor.colorWithHexString(UI_COLORS.accent)
    menu.startButton.setTitleColorForState(snapshot.started && snapshot.running ? UIColor.colorWithHexString(UI_COLORS.accent) : UIColor.whiteColor(), 0)
    if (menu.startButton.titleLabel) menu.startButton.titleLabel.font = UIFont.systemFontOfSize(snapshot.started ? 13 : 15)
    menu.clipEnd!.backgroundColor = snapshot.running ? UIColor.colorWithHexString(UI_COLORS.accent) : UIColor.whiteColor()
    menu.clipEnd!.setTitleColorForState(snapshot.running ? UIColor.whiteColor() : UIColor.colorWithHexString("#d92d20"), 0)
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

function renderQuestionTree(menu: QuickMenu): void {
  const previousOffset = Number(menu.scroll?.contentOffset?.y ?? 0)
  if (menu.mode === "all") {
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
    const checked = node.questionIds.every(id => menu.selectedIds.has(id))
    const partial = !checked && node.questionIds.some(id => menu.selectedIds.has(id))
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
  scroll.contentOffset = { x: 0, y: Math.min(previousOffset, Math.max(0, rows.length * 42 - height)) }
  resizeQuickMenu(menu, QUICK_MENU_WIDTH, desiredHeight, container, scroll)
}

function setQuickMenuShell(menu: QuickMenu, frame: ViewFrame, cornerRadius: number): void {
  menu.content.frame = frame
  menu.content.layer.cornerRadius = cornerRadius
}

function animateQuickMenuUpdate(update: () => void, seconds: number): Promise<void> {
  if (reducedMotionEnabled() || typeof MNUtil.animate !== "function") {
    update()
    return Promise.resolve()
  }
  return Promise.resolve(MNUtil.animate(update, seconds)).then(() => undefined)
}

function finishQuickMenu(menu: QuickMenu): void {
  dismissModePicker(menu)
  ;(menu.content as any).removeFromSuperview()
  menu.window.removeGestureRecognizer(menu.dismissTap)
  if (menu.owner.mnutilsQuickMenu === menu) menu.owner.mnutilsQuickMenu = undefined
}

function settleQuickMenu(menu: QuickMenu): void {
  setQuickMenuShell(menu, menu.expandedFrame, 18)
  ;(menu.content as any).alpha = 1
  ;(menu.content as any).userInteractionEnabled = true
  ;(menu.controls as any).userInteractionEnabled = true
}

async function animateQuickMenu(menu: QuickMenu, opening: boolean): Promise<void> {
  const generation = ++menu.generation
  if (reducedMotionEnabled()) {
    if (opening) {
      layoutQuickMenu(menu, menu.geometry)
      settleQuickMenu(menu)
    } else finishQuickMenu(menu)
    return
  }
  if (opening) {
    await animateQuickMenuUpdate(() => {
      setQuickMenuShell(menu, menu.expandedFrame, 18)
      ;(menu.content as any).alpha = 1
    }, QUICK_MENU_TRANSITION_SECONDS)
    if (menu.generation === generation && menu.open) settleQuickMenu(menu)
    return
  }
  ;(menu.content as any).userInteractionEnabled = false
  ;(menu.controls as any).userInteractionEnabled = false
  await animateQuickMenuUpdate(() => {
    setQuickMenuShell(menu, menu.collapsedFrame, ENTRANCE_SIZE / 2)
    ;(menu.content as any).alpha = 0
  }, QUICK_MENU_TRANSITION_SECONDS)
  if (menu.generation === generation && !menu.open) finishQuickMenu(menu)
}

function closeQuickMenu(animated = true, owner: any = self): void {
  const menu = owner.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu) return
  dismissModePicker(menu)
  menu.open = false
  if (animated) void animateQuickMenu(menu, false)
  else {
    menu.generation++
    finishQuickMenu(menu)
  }
}

export function closeMnutilsQuickMenu(): void {
  exitClipperMode()
  closeQuickMenu(false)
  stopSameMapPractice()
  practiceQueueSnapshot = undefined
}

function openQuickMenu(button: any, window: any, owner: any = self): void {
  closeQuickMenu(false, owner)
  const collapsedFrame = { ...button.frame } as ViewFrame
  const desiredWidth = QUICK_MENU_WIDTH
  const desiredHeight = clipperModeActive(owner) ? 168 : QUICK_MENU_HEIGHT
  const geometry = geometryFor(collapsedFrame, window, desiredWidth, desiredHeight, owner)
  const menu = createQuickMenu(button, window, collapsedFrame, geometry, owner)
  owner.mnutilsQuickMenu = menu
  menu.open = true
  menu.desiredWidth = desiredWidth; menu.desiredHeight = desiredHeight
  if (clipperModeActive(owner)) prepareClipperMenu(menu)
  else if (sameMapPracticeActive() && readQuickMenuQuestions(menu)) {
    for (const root of menu.tree) menu.expandedIds.add(root.id)
    renderQuestionTree(menu)
    void updateSegmentSelection(menu)
  }
  void animateQuickMenu(menu, true)
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
        dock ? applyDock(existing, window, dock, false) : clampEntranceFrame(existing)
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
    applyDock(button, window, owner.mnutilsEntranceDock, false)
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
      if (button && window) openQuickMenu(button, window)
    }
  } catch (error) {
    try { console.log("MNButton 快捷功能区切换失败:", String(error)) } catch { /* optional */ }
  }
}

export function onMnutilsQuickMenuDismiss(): void {
  closeQuickMenu()
}

export function onMnutilsQuickMenuWindowTap(sender: any): void {
  if (clipperModeActive()) return
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open || menu.modePicker || Date.now() - (self.quickMenuModePressAt || 0) < 400 || Number(sender?.state) !== 3) return
  const point = sender.locationInView?.(menu.window)
  if (!point) return
  const frame = menu.expandedFrame
  if (Number(point.x) < frame.x || Number(point.x) > frame.x + frame.width ||
    Number(point.y) < frame.y || Number(point.y) > frame.y + frame.height) closeQuickMenu()
}

export function onMnutilsQuickMenuFilter(): void {
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open) return
  if (sameMapPracticeActive()) return
  if (menu.mode === "all" && !sameMapPracticeActive()) menu.selectedIds.clear()
  menu.mode = "filter"
  if (!readQuickMenuQuestions(menu)) return
  if (!menu.expandedIds.size) for (const root of menu.tree) menu.expandedIds.add(root.id)
  renderQuestionTree(menu)
  void updateSegmentSelection(menu)
}

export function onMnutilsQuickMenuSelectAll(): void {
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  if (sameMapPracticeActive()) return
  if (!menu?.open || !readQuickMenuQuestions(menu)) return
  menu.selectedIds = new Set(questionIdsInTree(menu.tree))
  menu.mode = "all"
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
      void navigateSameMapPractice(target)
    }
    return
  }
  const allSelected = node.questionIds.every(id => menu.selectedIds.has(id))
  for (const id of node.questionIds) {
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
    const view = new UIView(origin)
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
  if (Date.now() - (self.quickMenuModePressAt || 0) < 400) return
  const menu = self.mnutilsQuickMenu as QuickMenu | undefined
  if (!menu?.open) return
  if (clipperModeActive()) { toggleClipperRunning(menu.owner); return }
  if (sameMapPracticeActive()) {
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
  const result = await startSameMapPractice(notebookId, queue)
  if (!result.started) {
    showHUD(result.reason ?? "无法开始做题", 3)
    return
  }
  showHUD(`已开始做题，遮盖 ${result.answerCount ?? 0} 张答案卡片`, 2)
  practiceQueueSnapshot = { tree: menu.tree, questionIds: queue }
  menu.mode = "queue"
  if (readQuickMenuQuestions(menu)) {
    for (const root of menu.tree) menu.expandedIds.add(root.id)
    renderQuestionTree(menu)
    void updateSegmentSelection(menu)
  }
}

export function onMnutilsQuickMenuOpenPanel(): void {
  closeQuickMenu()
  try {
    const panel = __MNAM_WEB_PANEL_GLOBAL__
    const controller = self.webController
    if (!panel.isVisible?.(controller)) panel.showPanel(controller)
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
    closeQuickMenu()
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
    const menu = self.mnutilsQuickMenu as QuickMenu | undefined
    if (state === 1) {
      if (menu?.open) {
        menu.generation++
        settleQuickMenu(menu)
        self.mnutilsEntranceSuppressClick = Date.now()
        self.mnutilsEntranceMenuDragging = true
      }
      const frame = button.frame
      self.mnutilsEntranceDragging = true
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
    if (menu?.open) {
      menu.collapsedFrame = { ...button.frame }
      menu.geometry = geometryFor(menu.collapsedFrame, window, menu.desiredWidth, menu.desiredHeight)
      menu.expandedFrame = menu.geometry.frame
      layoutQuickMenu(menu, menu.geometry)
    }
    if (state === 3 || state === 4 || state === 5) {
      self.mnutilsEntranceDragging = false
      self.mnutilsEntranceMenuDragging = false
      self.mnutilsEntranceDragOffset = undefined
      const dock = nearestDock(button, window)
      self.mnutilsEntranceDock = dock
      rememberDock(dock)
      if (menu?.open) {
        const target = dockedFrame(window, dock)
        const geometry = geometryFor(target, window, menu.desiredWidth, menu.desiredHeight)
        menu.collapsedFrame = target
        menu.geometry = geometry
        menu.expandedFrame = geometry.frame
        void animateQuickMenuUpdate(() => {
          button.frame = target
          layoutQuickMenu(menu, geometry)
        }, 0.2)
      } else applyDock(button, window, dock, true)
    }
  } catch (error) {
    self.mnutilsEntranceDragging = false
    self.mnutilsEntranceMenuDragging = false
    self.mnutilsEntranceDragOffset = undefined
    try { console.log("MNButton 第二入口拖动失败:", String(error)) } catch { /* optional */ }
  }
}
