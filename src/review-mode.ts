import { delay, MN, NodeNote, popup, select, showHUD } from "marginnote"
import { ChevronLeft, ChevronRight, LogOut, type IconNode } from "lucide"
import { MistakeLevel } from "./mistake-domain"
import { openSourceByMistakeId, reviewMistakeById } from "./mistake-manager"
import { startSameMapPractice, stopSameMapPractice } from "./same-map-practice"
import { closeAnswerCard, selectAnswerReviewLevel, syncAnswerReviewControls } from "./answer-card-view"
import { getBindingForMode, loadBindings } from "./store"
import { loadMatcherSettings } from "./settings"
import { focusNoteInMindMapFocusMode } from "./note-navigation"
import { loadMistakeState } from "./mistake-store"
import { reviewedToday, reviewBreadcrumbs, inReviewBranch, groupedReviewRows, type ReviewQueueRow } from "./review-queue"
import { UI_COLORS } from "./ui-tokens"
import { pauseControlSurface, syncControlSurface } from "./native-control-surface"
import { notifyWorkbenchDataChanged } from "./workbench-notification"
import { usesSubcardAnswers } from "./binding"
import type { FsrsProgress } from "./fsrs-domain"

export interface ReviewModeItem {
  fsrsProgress?: FsrsProgress
  preview?: Array<{ rating: number; days: number }>
  recordId: string
  sourceNoteId: string
  sourceNotebookId: string
  sourceRootNodeId?: string
  sourceTitle: string
  sourceNotebookTitle: string
  sourceRootTitle?: string
  sourcePathTitles?: string[]
  sourceAncestors?: Array<{ id: string; title: string }>
  lastReviewedAt?: string
  level: MistakeLevel
  reviewCount: number
  history?: Array<{ at: string; level: MistakeLevel }>
}

interface ReviewModeState {
  algorithm?: "fixed" | "fsrs"
  items: ReviewModeItem[]
  index: number
  startedAt: number
  visited: Record<string, true>
  navigating: boolean
  expanded?: boolean
  resultsVisible?: boolean
  branch?: number
  submitting?: boolean
  position?: { x: number; y: number }
  focusedNotebookId?: string
  focusedRootNodeId?: string
}

const BAR_HEIGHT = 40
const BAR_TOP_INSET = 108
const CONTROL_HEIGHT = 28
const BAR_WIDTH = 180
const CONTROL_GAP = 3
const CONTROL_INSET = 5
const INK = "#172033"
const MUTED = "#a9b1bf"
const HOVER = "#787880"
const ACTIVE = "#e8f4ff"
function state(owner: any = self): ReviewModeState | undefined {
  return owner?.cardLinkReviewMode as ReviewModeState | undefined
}

function escapeSvgAttribute(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Morphicons 官网直接消费 Lucide IconNode；静态工具条按同一 24×24 网格生成 SVG。 */
function lucideSvg(icon: IconNode): string {
  const body = icon.map(([tag, attributes]) => {
    const serialized = Object.entries(attributes)
      .map(([key, value]) => `${key}="${escapeSvgAttribute(value)}"`)
      .join(" ")
    return `<${tag}${serialized ? ` ${serialized}` : ""}/>`
  }).join("")
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

function completedToday(current: ReviewModeState): boolean[] {
  if (current.algorithm === "fsrs") return current.items.map(item => reviewedToday(item.fsrsProgress?.card?.last_review))
  const records = loadMistakeState().records
  return current.items.map(item => reviewedToday(records[item.recordId]?.lastReviewedAt || item.lastReviewedAt))
}

function reviewProgress(current: ReviewModeState): number {
  const completed = completedToday(current)
  return completed.length ? completed.filter(Boolean).length / completed.length : 0
}

function reviewToolbarSvgHtml(current: ReviewModeState): string {
  const previousDisabled = current.navigating || current.index === 0
  const nextDisabled = current.navigating || !!current.submitting
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
*{box-sizing:border-box}html,body{margin:0;width:${BAR_WIDTH}px;height:${BAR_HEIGHT}px;overflow:hidden;background:transparent!important;-webkit-user-select:none}
.slot{position:absolute;top:6px;width:30px;height:${CONTROL_HEIGHT}px;display:flex;align-items:center;justify-content:center;pointer-events:none}
.index{left:5px;width:34px}.number{color:${INK};font:600 12px/20px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;font-variant-numeric:tabular-nums;text-align:center}
.glyph,.glyph svg{display:block;width:20px;height:20px;color:${INK}}
.progress{position:absolute;width:30px;height:30px;transform:rotate(-90deg)}.progress circle{fill:none;stroke-width:2.5}.progress-track{stroke:#e5e7eb}.progress-value{stroke:${HOVER};transition:stroke-dashoffset .2s ease}@media(prefers-reduced-motion:reduce){.progress-value{transition:none}}
.previous{left:42px}.next{left:75px}.exit{left:108px}
.disabled{opacity:.28}.active .glyph{color:${UI_COLORS.accent}}
</style></head><body>
<div class="slot index"><svg class="progress" viewBox="0 0 32 32"><circle class="progress-track" cx="16" cy="16" r="13"/><circle id="progress" class="progress-value" cx="16" cy="16" r="13" stroke-dasharray="${26 * Math.PI}" stroke-dashoffset="${26 * Math.PI * (1 - reviewProgress(current))}"/></svg><span id="index" class="number">${current.index + 1}</span></div>
<div id="previous" class="slot previous${previousDisabled ? " disabled" : ""}"><span class="glyph">${lucideSvg(ChevronLeft)}</span></div>
<div id="next" class="slot next${nextDisabled ? " disabled" : ""}"><span class="glyph">${lucideSvg(ChevronRight)}</span></div>
<div class="slot exit"><span class="glyph">${lucideSvg(LogOut)}</span></div>
<script>window.setReviewToolbarState=function(s){document.getElementById('progress').setAttribute('stroke-dashoffset',String(${26 * Math.PI}*(1-s.progress)));document.getElementById('index').textContent=String(s.index);document.getElementById('previous').className='slot previous'+(s.previousDisabled?' disabled':'');document.getElementById('next').className='slot next'+(s.nextDisabled?' disabled':'')}</script>
</body></html>`
}

function configureReviewSvgSurface(webView: UIWebView): void {
  const bridged = webView as any
  bridged.opaque = false
  bridged.backgroundColor = UIColor.clearColor()
  // UIWebView 自身透明仍不足以清除 UIScrollView 的默认白底。两层必须同时
  // 透明，否则 SVG 绘制层会以 190×44 的白色矩形盖住原生胶囊。
  bridged.scrollView.opaque = false
  bridged.scrollView.backgroundColor = UIColor.clearColor()
  bridged.userInteractionEnabled = false
  bridged.accessibilityElementsHidden = true
  bridged.scrollView.scrollEnabled = false
  bridged.scrollView.bounces = false
  bridged.scrollView.userInteractionEnabled = false
  // 即使宿主重置 WebView 合成背景，也只能落在胶囊轮廓内。
  bridged.layer.cornerRadius = BAR_HEIGHT / 2
  bridged.layer.masksToBounds = true
}

function reviewToolbarSvgView(owner: any, current: ReviewModeState, cacheKey = "cardLinkReviewSvgView"): UIWebView | undefined {
  let webView = owner?.[cacheKey] as UIWebView | undefined
  if (!webView) {
    webView = new UIWebView({ x: 0, y: 0, width: BAR_WIDTH, height: BAR_HEIGHT })
    configureReviewSvgSurface(webView)
    owner[cacheKey] = webView
  }
  // 跨题重挂载时重新声明透明合成属性，防止 UIWebView 装载完成后恢复默认白底。
  configureReviewSvgSurface(webView)
  return webView
}

function controlBackground(button: any): any { return button?.cardLinkReviewRestingBackground || UIColor.clearColor() }

function hoverBackground(): any {
  return UIColor.colorWithHexString(HOVER).colorWithAlphaComponent(0.14)
}

function makeButton(owner: any, title: string, action: string, width: number): UIButton {
  const button = UIButton.buttonWithType(0)
  button.frame = { x: 0, y: 0, width, height: CONTROL_HEIGHT }
  // 导航控件的可见内容全部由同一个 WebView 绘制，避免原生标题被绘制层遮挡，
  // 同时保证序号与SVG 图标 使用同一坐标系。UIButton 只承接交互与无障碍。
  button.setTitleForState("", 0)
  button.setTitleColorForState(UIColor.colorWithHexString(INK), 0)
  button.backgroundColor = UIColor.clearColor()
  button.layer.cornerRadius = CONTROL_HEIGHT / 2
  button.layer.masksToBounds = true
  const bridgedButton = button as any
  bridgedButton.accessibilityLabel = title
  bridgedButton.tintColor = UIColor.colorWithHexString(INK)
  bridgedButton.showsTouchWhenHighlighted = true
  bridgedButton.adjustsImageWhenHighlighted = true
  bridgedButton.pointerInteractionEnabled = true
  bridgedButton.isPointerInteractionEnabled = true
  const HoverRecognizer = (globalThis as any).UIHoverGestureRecognizer
  if (typeof HoverRecognizer === "function") {
    bridgedButton.addGestureRecognizer(new HoverRecognizer(owner, "onReviewModeControlHover:"))
  }
  button.addTargetActionForControlEvents(owner, "onReviewModeControlPress:", 1 << 0)
  button.addTargetActionForControlEvents(owner, "onReviewModeControlRelease:", (1 << 6) | (1 << 7) | (1 << 8))
  button.addTargetActionForControlEvents(owner, action, 1 << 6)
  return button
}

function mountNavigationToolbar(owner: any, current: ReviewModeState, specs: Array<[string, string, number]>, cacheKey: string): { toolbar: UIView; buttons: UIButton[] } | undefined {
  const studyView = MN.studyController?.view
  const studyWidth = Number(studyView?.frame?.width)
  if (!studyView || !Number.isFinite(studyWidth) || studyWidth <= 0) return
  const width = current.expanded ? Math.min(studyWidth - 16, BAR_WIDTH + sourceLayout(current).width + 10) : BAR_WIDTH
  const x = Math.max(8, (studyWidth - width) / 2)
  const toolbar = new UIView({ x, y: BAR_TOP_INSET, width, height: BAR_HEIGHT })
  if (current.position) toolbar.frame = { ...toolbar.frame, ...current.position }
  const pan = new UIPanGestureRecognizer(owner, "onReviewModePan:")
  ;(pan as any).allowedScrollTypesMask = 3
  toolbar.frame = { ...toolbar.frame, x: Math.max(8, Math.min(toolbar.frame.x, studyWidth - width - 8)) }
  styleReviewSurface(toolbar, 20)
  toolbar.layer.masksToBounds = true
  // 独立操作区承接拖动；来源滚动区是它的兄弟视图，不参与这条手势。
  const controls = new UIView({ x: 0, y: 0, width: BAR_WIDTH, height: BAR_HEIGHT })
  controls.backgroundColor = UIColor.clearColor()
  controls.addGestureRecognizer(pan)
  toolbar.addSubview(controls)
  let left = CONTROL_INSET
  const buttons = specs.map(([title, action, width], index) => {
    const button = makeButton(owner, title, action, width)
    button.frame = { x: left, y: 6, width, height: CONTROL_HEIGHT }
    button.enabled = !current.navigating && !current.submitting && !(index === 1 && current.index === 0)
    if (index === 3) button.enabled = !current.submitting
    ;(button as any).alpha = button.enabled ? 1 : 0.28
    if (!button.enabled) (button as any).tintColor = UIColor.colorWithHexString(MUTED)
    controls.addSubview(button)
    left += width + CONTROL_GAP
    return button
  })
  const svgView = reviewToolbarSvgView(owner, current, cacheKey)
  if (svgView) controls.addSubview(svgView)
  buttons[4].setTitleForState(current.expanded ? "‹" : "›", 0)
  controls.addSubview(buttons[4])
  if (current.expanded) mountSourceStrip(owner, current, toolbar, width)
  studyView.addSubview(toolbar)
  if (svgView) syncControlSurface(svgView, {
    html: () => reviewToolbarSvgHtml(current), method: "setReviewToolbarState", rootId: "index",
    args: [{ index: current.index + 1, progress: reviewProgress(current), previousDisabled: current.navigating || current.index === 0, nextDisabled: current.navigating || !!current.submitting }],
    active: () => Boolean(toolbar.superview) && !toolbar.hidden && state(owner) === current,
    onReady: () => configureReviewSvgSurface(svgView)
  })
  return { toolbar, buttons }
}

function textButton(owner: any, title: string, action: string, tag: number, frame: any): UIButton {
  const button = makeButton(owner, title, action, frame.width)
  button.frame = frame
  button.tag = tag
  button.setTitleForState(title, 0)
  return button
}

function sourceLayout(current: ReviewModeState) {
  let width = 0
  const entries = reviewBreadcrumbs(current.items[current.index]).map((crumb, index) => {
    const title = crumb.title.length > 10 ? crumb.title.slice(0, 9) + '…' : crumb.title
    const size = Math.max(26, textWidth(title, 13) + 6)
    const x = width
    width += size + 10
    return { title, index, x, width: size }
  })
  return { entries, width: Math.max(0, width - 10) }
}

function styleReviewSurface(view: UIView, radius: number): void {
  view.backgroundColor = UIColor.whiteColor()
  view.layer.cornerRadius = radius
  view.layer.borderWidth = 0.5
  view.layer.borderColor = UIColor.colorWithHexString("#d6dee8")
}

function animateReview(update: () => void, complete: () => void = () => {}): void {
  const accessibility = (globalThis as any).UIAccessibility
  const reduced = accessibility?.isReduceMotionEnabled === true ||
    (typeof accessibility?.isReduceMotionEnabled === 'function' && accessibility.isReduceMotionEnabled())
  if (reduced || typeof MNUtil === 'undefined' || typeof MNUtil.animate !== 'function') { update(); complete(); return }
  Promise.resolve(MNUtil.animate(update, 0.2)).then(complete, complete)
}

function mountSourceStrip(owner: any, current: ReviewModeState, toolbar: UIView, width: number): void {
  const scroll = new UIScrollView({ x: BAR_WIDTH, y: 0, width: Math.max(0, width - BAR_WIDTH - 5), height: BAR_HEIGHT })
  scroll.bounces = false
  if (owner.cardLinkReviewSourceOffset) scroll.contentOffset = owner.cardLinkReviewSourceOffset
  const layout = sourceLayout(current)
  layout.entries.forEach(({ title, index, x, width: w }) => {
    const button = textButton(owner, title, 'onReviewModeBranch:', index, { x, y: 6, width: w, height: CONTROL_HEIGHT })
    ;(button as any).titleLabel.font = UIFont.systemFontOfSize(13)
    if (current.branch === index) button.backgroundColor = UIColor.colorWithHexString(ACTIVE)
    scroll.addSubview(button)
    if (index < layout.entries.length - 1) {
      const arrow = new (UILabel as any)({ x: x + w, y: 6, width: 10, height: CONTROL_HEIGHT })
      arrow.text = '›'
      arrow.textAlignment = 1
      arrow.textColor = UIColor.colorWithHexString(MUTED)
      scroll.addSubview(arrow)
    }
  })
  scroll.contentSize = { width: layout.width, height: BAR_HEIGHT }
  toolbar.addSubview(scroll)
  owner.cardLinkReviewSource = scroll
}

function textWidth(title: string, fontSize: number): number {
  return Array.from(title).reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? fontSize : fontSize * 0.56), 0)
}

function dropdownFrame(owner: any, current: ReviewModeState, toolbar: UIView, width: number, height: number) {
  const bounds = MN.studyController.view.frame
  const source = owner.cardLinkReviewSource
  const entry = sourceLayout(current).entries[current.branch ?? -1]
  const localX = current.resultsVisible ? 75 : BAR_WIDTH + (entry?.x || 0) - Number(source?.contentOffset?.x || 0)
  const anchorX = toolbar.frame.x + Math.max(current.resultsVisible ? 0 : BAR_WIDTH, localX)
  return { x: Math.max(8, Math.min(anchorX, bounds.width - width - 8)), y: Math.max(8, Math.min(toolbar.frame.y + BAR_HEIGHT + 5, bounds.height - height - 8)), width, height }
}

function mountReviewDropdown(owner: any, current: ReviewModeState, toolbar: UIView): void {
  if (!current.resultsVisible && current.branch === undefined) return
  const item = current.items[current.index]
  const crumb = reviewBreadcrumbs(item)[current.branch ?? -1]
  const completed = completedToday(current)
  const feedbackNames = current.algorithm === "fsrs" ? ['不会', '不熟', '良好', '掌握'] : ['不会', '不熟', '掌握']
  const rows: ReviewQueueRow[] = current.resultsVisible
    ? [...feedbackNames, '跳过'].map((name, index) => ({ kind: 'question', title: current.algorithm === "fsrs" && index < 4 ? `${name} · 约 ${item.preview?.[index]?.days ?? '—'} 天` : name, index: index === feedbackNames.length ? -1 : index, depth: 0 }))
    : crumb ? groupedReviewRows(current.items, item, crumb) : []
  const bounds = MN.studyController.view.frame
  const width = Math.min(Math.max(64, ...rows.map(row => textWidth(row.title, row.kind === 'heading' ? 12 : 14) + 24 + Math.min(row.depth, 5) * 10)), 360, bounds.width - 16)
  const contentHeight = rows.reduce((height, row) => height + (row.kind === 'heading' ? 24 : 34), 10)
  const height = Math.min(260, contentHeight, bounds.height - 16)
  const dropdown = new UIView(dropdownFrame(owner, current, toolbar, width, height))
  styleReviewSurface(dropdown, 12)
  dropdown.layer.masksToBounds = true
  const scroll = new UIScrollView({ x: 0, y: 0, width, height })
  scroll.bounces = false
  scroll.layer.cornerRadius = 12
  scroll.layer.masksToBounds = true
  scroll.backgroundColor = UIColor.clearColor()
  let rowY = 5
  rows.forEach(row => {
    const inset = 8 + Math.min(row.depth, 5) * 10
    if (row.kind === 'heading') {
      const label = new (UILabel as any)({ x: inset, y: rowY, width: width - inset - 8, height: 24 })
      label.text = row.title
      label.font = UIFont.systemFontOfSize(12)
      label.textColor = UIColor.colorWithHexString(HOVER)
      label.lineBreakMode = 4
      label.numberOfLines = 1
      label.userInteractionEnabled = false
      scroll.addSubview(label)
      rowY += 24
      return
    }
    const button = textButton(owner, row.title, current.resultsVisible ? 'onReviewModeToolbarResult:' : 'onReviewModeQueuePick:', row.index,
      { x: inset, y: rowY, width: width - inset - 8, height: 32 })
    ;(button as any).titleLabel.font = UIFont.systemFontOfSize(14)
    ;(button as any).titleLabel.lineBreakMode = 4
    if (!current.resultsVisible) {
      const color = row.index === current.index ? UI_COLORS.accent : completed[row.index] ? UI_COLORS.level2 : undefined
      const background = color ? UIColor.colorWithHexString(color).colorWithAlphaComponent(0.2) : UIColor.clearColor()
      button.backgroundColor = background
      ;(button as any).cardLinkReviewRestingBackground = background
    }
    button.enabled = !current.submitting && !current.navigating
    scroll.addSubview(button)
    rowY += 34
  })
  scroll.contentSize = { width, height: contentHeight }
  dropdown.addSubview(scroll)
  MN.studyController.view.addSubview(dropdown)
  owner.cardLinkReviewDropdown = dropdown
}

export function onReviewModeBranch(sender: any): void {
  const current = state()
  if (!current || current.navigating || current.submitting) return
  const index = Number(sender?.tag)
  if (!reviewBreadcrumbs(current.items[current.index])[index]) return
  current.branch = current.branch === index ? undefined : index
  current.resultsVisible = false
  mountReviewViews(self, true)
}

export function onReviewModeQueuePick(sender: any): void {
  const current = state()
  const index = Number(sender?.tag)
  if (!current || current.branch === undefined || !Number.isInteger(index) || !current.items[index]) return
  const item = current.items[current.index], crumb = reviewBreadcrumbs(item)[current.branch]
  if (crumb && inReviewBranch(current.items[index], item, crumb)) void goTo(index)
}

function removeReviewViews(owner: any = self): void {
  pauseControlSurface(owner?.cardLinkReviewSvgView)
  try { owner?.cardLinkReviewToolbar?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  try { owner?.cardLinkReviewDropdown?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  if (!owner) return
  owner.cardLinkReviewDropdown = undefined
  owner.cardLinkReviewToolbar = undefined
  owner.cardLinkReviewIndexButton = undefined
}

function currentItem(owner: any = self): ReviewModeItem | undefined {
  const current = state(owner)
  return current?.items[current.index]
}

function mountReviewViews(owner: any = self, animated = false): void {
  const current = state(owner)
  const item = currentItem(owner)
  const studyView = MN.studyController?.view
  if (!current || !item || !studyView) return
  const previousFrame = owner.cardLinkReviewToolbar?.frame
  const previousSource = owner.cardLinkReviewSource
  owner.cardLinkReviewSourceOffset = previousSource?.contentOffset
  const previousDropdown = owner.cardLinkReviewDropdown
  if (animated) owner.cardLinkReviewDropdown = undefined
  removeReviewViews(owner)
  owner.cardLinkReviewSource = undefined
  const studyWidth = Number(studyView.frame?.width)
  if (!Number.isFinite(studyWidth) || studyWidth <= 0) return
  const specs: Array<[string, string, number]> = [
    [`第 ${current.index + 1} 题`, "onReviewModeIndex:", 34],
    ["上一题", "onReviewModePrevious:", 30],
    ["下一题", "onReviewModeNext:", 30],
    ["退出", "onReviewModeExit:", 30],
    ["展开来源", "onReviewModeExpand:", 30]
  ]
  const mounted = mountNavigationToolbar(owner, current, specs, "cardLinkReviewSvgView")
  if (!mounted) return
  owner.cardLinkReviewToolbar = mounted.toolbar
  owner.cardLinkReviewIndexButton = mounted.buttons[0]
  mountReviewDropdown(owner, current, mounted.toolbar)
  if (!animated) return
  const toolbar = mounted.toolbar
  const target = { ...toolbar.frame }
  current.position = { x: target.x, y: target.y }
  const source = owner.cardLinkReviewSource
  if (previousFrame) toolbar.frame = { ...previousFrame }
  if (source) source.alpha = 0
  if (!source && previousSource) toolbar.addSubview(previousSource)
  const dropdown = owner.cardLinkReviewDropdown
  const dropdownFrame = dropdown ? { ...dropdown.frame } : undefined
  if (dropdown) { dropdown.frame = { ...dropdownFrame, height: 1 }; dropdown.alpha = 0 }
  if (previousDropdown) previousDropdown.userInteractionEnabled = false
  animateReview(() => {
    toolbar.frame = target
    if (source) source.alpha = 1
    if (!source && previousSource) previousSource.alpha = 0
    if (dropdown) { dropdown.frame = dropdownFrame; dropdown.alpha = 1 }
    if (previousDropdown) { previousDropdown.alpha = 0; previousDropdown.frame = { ...previousDropdown.frame, height: 1 } }
  }, () => {
    previousDropdown?.removeFromSuperview()
    if (!source) previousSource?.removeFromSuperview()
  })
}

async function focusQueueItem(owner: any, item: ReviewModeItem): Promise<boolean> {
  const current = state(owner)
  const target = MN.db.getNoteById(item.sourceNoteId)
  if (!target) {
    showHUD("该题目卡片已不存在", 2)
    return false
  }
  const sameMindMap = Boolean(
    current?.focusedNotebookId === item.sourceNotebookId &&
    current?.focusedRootNodeId &&
    current.focusedRootNodeId === item.sourceRootNodeId
  )
  if (sameMindMap) {
    const result = await focusNoteInMindMapFocusMode(item.sourceNoteId)
    if (result !== "focused") {
      showHUD("无法将题目卡片居中显示在焦点模式中", 3)
      return false
    }
  } else {
    // 跨学习集/跨脑图必须把焦点模式意图交给定位状态机。该意图会随 pending
    // 记录由 notebookWillOpen 接力，在新学习集的 controller 上执行，不能复用
    // 切换前捕获的 notebookController。
    const result = await openSourceByMistakeId(item.recordId, { enterFocusMode: true })
    if (result.locateHint) {
      showHUD(result.locateHint, 3)
      return false
    }
  }
  if (current) {
    current.focusedNotebookId = item.sourceNotebookId
    current.focusedRootNodeId = item.sourceRootNodeId
  }
  owner.cardLinkReviewLastFocus = MN.db.getNoteById(item.sourceNoteId) ?? target
  if (state(owner) !== current) return false
  const binding = getBindingForMode(loadBindings(), item.sourceNotebookId, item.sourceRootNodeId,
    loadMatcherSettings().allowSameStudySetMindMap)
  if (usesSubcardAnswers(binding, target.colorIndex)) {
    const result = await startSameMapPractice(item.sourceNotebookId, [item.sourceNoteId], { alreadyFocused: true })
    if (state(owner) !== current) stopSameMapPractice()
    else if (!result.started && result.reason !== "所选题目没有直接子卡片答案") showHUD(result.reason || "答案遮盖失败", 3)
  }
  return true
}

async function goTo(index: number, owner: any = self): Promise<boolean> {
  const current = state(owner)
  if (!current || current.navigating || current.submitting || !current.items.length) return false
  stopSameMapPractice()
  closeAnswerCard()
  const target = Math.max(0, Math.min(current.items.length - 1, index))
  current.index = target
  current.resultsVisible = false
  current.branch = undefined
  current.navigating = true
  const item = current.items[target]
  current.visited[item.recordId] = true
  mountReviewViews(owner)
  try {
    const focused = await focusQueueItem(owner, item)
    await delay(0.12)
    return focused
  } catch (error) {
    showHUD(`切换题目失败：${String((error as Error)?.message || error)}`, 2)
    return false
  } finally {
    const latest = state(owner)
    if (latest === current) latest.navigating = false
    mountReviewViews(owner)
  }
}

export async function startReviewMode(itemsValue: unknown, owner: any = self, algorithm: "fixed" | "fsrs" = "fixed"): Promise<{ started: boolean; count: number }> {
  if (state(owner)?.submitting) throw new Error("请等待本次复习保存完成")
  if (algorithm === "fsrs" && (!loadMatcherSettings().debugModeEnabled || loadMatcherSettings().debugReviewAlgorithm !== "fsrs")) throw new Error("智能复习未开启")
  if (algorithm === "fixed" && loadMatcherSettings().debugModeEnabled && loadMatcherSettings().debugReviewAlgorithm === "fsrs") throw new Error("请从智能复习页进入复习模式")
  const items = Array.isArray(itemsValue)
    ? itemsValue.filter(item => item && typeof item.recordId === "string" && item.recordId) as ReviewModeItem[]
    : []
  if (!items.length) return { started: false, count: 0 }
  const stored = loadMistakeState().records
  for (const item of items) {
    item.lastReviewedAt = algorithm === "fsrs" ? item.fsrsProgress?.card?.last_review : stored[item.recordId]?.lastReviewedAt
    try {
      const note = MN.db.getNoteById(item.sourceNoteId)
      item.sourceAncestors = note ? new NodeNote(note, item.sourceNotebookId).ancestorNodes.reverse().map(node => ({ id: node.note.noteId, title: node.title?.trim() || '未命名节点' })) : []
      const rootIndex = item.sourceAncestors.findIndex(node => node.id === item.sourceRootNodeId)
      if (rootIndex >= 0) item.sourceAncestors = item.sourceAncestors.slice(rootIndex + 1)
    } catch { item.sourceAncestors = [] }
  }
  removeReviewViews(owner)
  owner.cardLinkReviewMode = {
    algorithm,
    items,
    index: 0,
    startedAt: Date.now(),
    visited: {},
    navigating: false,
  } satisfies ReviewModeState
  try {
    const panel = __MNAM_WEB_PANEL_GLOBAL__
    if (panel?.isVisible?.(owner.webController)) panel.hidePanel(owner.webController, true)
  } catch { /* review can continue without a visible panel */ }
  await goTo(0, owner)
  return { started: true, count: items.length }
}

export function restoreReviewModeToolbar(): void {
  if (state(self)) mountReviewViews(self)
}

export function discardReviewMode(): void {
  stopSameMapPractice()
  self.cardLinkReviewMode = undefined
  syncAnswerReviewControls()
  removeReviewViews(self)
}

export function onReviewModePrevious(): void {
  const current = state()
  if (!current) return
  if (current.index <= 0) return showHUD("已经是第一题", 2)
  void goTo(current.index - 1, self)
}

export function onReviewModeNext(): void {
  const current = state()
  const item = currentItem()
  if (!current || !item || current.navigating || current.submitting) return
  const saved = current.algorithm === "fsrs" ? { lastReviewedAt: item.fsrsProgress?.card?.last_review } : loadMistakeState().records[item.recordId]
  if (reviewedToday(saved?.lastReviewedAt || item.lastReviewedAt)) { void advanceReview(self); return }
  current.resultsVisible = !current.resultsVisible
  current.branch = undefined
  mountReviewViews(self, true)
}

async function advanceReview(owner: any): Promise<void> {
  const current = state(owner)
  if (!current) return
  if (current.index < current.items.length - 1) await goTo(current.index + 1, owner)
  else onReviewModeExit()
}

export function onReviewModeExpand(): void {
  const current = state()
  if (!current) return
  current.expanded = !current.expanded
  current.branch = undefined
  mountReviewViews(self, true)
}


export function onReviewModeControlPress(sender: any): void {
  if (!sender?.enabled) return
  sender.backgroundColor = hoverBackground()
  sender.alpha = 0.72
}

export function onReviewModeControlRelease(sender: any): void {
  if (!sender) return
  sender.backgroundColor = controlBackground(sender)
  sender.alpha = sender.enabled ? 1 : 0.28
}

export function onReviewModeControlHover(recognizer: any): void {
  const button = recognizer?.view
  if (!button?.enabled) return
  const gestureState = Number(recognizer.state)
  if (gestureState === 1 || gestureState === 2) {
    button.backgroundColor = hoverBackground()
    button.alpha = 0.86
    return
  }
  button.backgroundColor = controlBackground(button)
  button.alpha = 1
}

export function onReviewModeIndex(): void {
  const current = state()
  if (!current) return
  const completed = completedToday(current)
  void select(
    current.items.map((item, index) => `${index + 1}. ${item.sourceTitle}${completed[index] ? " ✅" : ""}`),
    "选择复习题目",
    `当前第 ${current.index + 1} 题，共 ${current.items.length} 题`,
    true
  ).then(result => {
    if (result.index >= 0) return goTo(result.index, self)
  })
}

export function onReviewModeExit(): void {
  const current = state()
  if (!current || current.submitting) return
  const elapsedMinutes = Math.max(1, Math.ceil((Date.now() - current.startedAt) / 60000))
  const visited = Object.keys(current.visited).length
  const levels = ([0, 1, 2] as MistakeLevel[]).map(level =>
    current.items.filter(item => item.level === level).length)
  discardReviewMode()
  void popup({
    title: "本次复习结果",
    message: current.algorithm === "fsrs" ? `智能复习 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n本日已复习 ${completedToday(current).filter(Boolean).length} 道；固定曲线进度保持不变。` : `队列 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n不会 ${levels[0]} · 不熟 ${levels[1]} · 掌握 ${levels[2]}`,
    buttons: ["完成"],
    canCancel: false,
    multiLine: true
  })
}

export function onReviewModePan(sender: UIPanGestureRecognizer): void {
  const current = state()
  const toolbar = self.cardLinkReviewToolbar
  if (!current || !toolbar) return
  const location = sender.locationInView(MN.studyController.view)
  if (sender.state === 1) self.cardLinkReviewDragOffset = { x: location.x - toolbar.frame.x, y: location.y - toolbar.frame.y }
  const offset = self.cardLinkReviewDragOffset
  if (!offset) return
  const bounds = MN.studyController.view.frame
  const position = { x: Math.max(8, Math.min(location.x - offset.x, bounds.width - toolbar.frame.width - 8)), y: Math.max(8, Math.min(location.y - offset.y, bounds.height - BAR_HEIGHT - 8)) }
  current.position = position
  toolbar.frame = { ...toolbar.frame, ...position }
  if (self.cardLinkReviewDropdown) {
    const frame = self.cardLinkReviewDropdown.frame
    self.cardLinkReviewDropdown.frame = dropdownFrame(self, current, toolbar, frame.width, frame.height)
  }
  if ([3, 4, 5].includes(sender.state)) self.cardLinkReviewDragOffset = undefined
}

export async function onReviewModeResult(sender: any): Promise<void> {
  const current = state()
  const item = currentItem()
  const level = Number(sender?.tag)
  if (!current || !item || current.navigating || current.submitting || !(current.algorithm === "fsrs" ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2]).includes(level) ||
    self.answerCardQuestionNoteId !== item.sourceNoteId || self.answerCardQuestionNotebookId !== item.sourceNotebookId) return
  if (!selectAnswerReviewLevel(level)) return
  await submitReviewResult(level, self)
}

export async function onReviewModeToolbarResult(sender: any): Promise<void> {
  if (!state()?.resultsVisible) return
  await submitReviewResult(Number(sender?.tag), self)
}

async function submitReviewResult(level: number, owner: any): Promise<void> {
  const current = state(owner), item = currentItem(owner)
  if (!current || !item || current.submitting || current.navigating || !(current.algorithm === "fsrs" ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2]).includes(level)) return
  if (level === -1) { await advanceReview(owner); return }
  current.submitting = true
  syncAnswerReviewControls()
  mountReviewViews(owner)
  try {
    if (current.algorithm === "fsrs") {
      const service = await import("./fsrs-service")
      let errorReasons: string[] | undefined
      if (level === 0) {
        const reasonNames = ['概念不清', '公式遗忘', '思路受阻', '计算失误', '审题遗漏', '时间不足']
        const reasonKeys = ['concept', 'formula', 'approach', 'calculation', 'reading', 'time']
        const selected = new Set<string>()
        for (;;) {
          const choice = await select([...reasonNames.map((name, i) => `${selected.has(reasonKeys[i]) ? '✓ ' : ''}${name}`), '保存', '跳过错因并保存'], '这次主要卡在哪里？', '可多选；备注可在智能复习历史中补填', true)
          if (choice.index < 0) return
          if (choice.index === 6) { errorReasons = [...selected]; break }
          if (choice.index === 7) break
          const key = reasonKeys[choice.index]
          if (selected.has(key)) selected.delete(key); else selected.add(key)
        }
      }
      if (state(owner) !== current) return
      const progress = service.fsrsCommand("fsrsReview", { recordId: item.recordId, revision: item.fsrsProgress?.revision,
        eventId: `native-${item.recordId}-${item.fsrsProgress?.revision}-${level}`, rating: level + 1, errorReasons }) as FsrsProgress
      item.fsrsProgress = progress
      item.preview = service.fsrsCommand("fsrsPreview", { recordId: item.recordId })
      item.lastReviewedAt = progress.card?.last_review
      item.reviewCount = progress.history.length
    } else {
      const record = await reviewMistakeById(item.recordId, level as MistakeLevel)
      Object.assign(item, { level: record.level, reviewCount: record.reviewCount, history: record.history, lastReviewedAt: record.lastReviewedAt })
    }
    // 通知发生在持久化成功之后；与会话是否仍然存在无关。
    notifyWorkbenchDataChanged(owner)
    if (state(owner) !== current) return
    mountReviewViews(owner)
    if (reviewProgress(current) === 1) await delay(0.25)
    if (state(owner) !== current) return
    current.submitting = false
    closeAnswerCard()
    await advanceReview(owner)
  } catch (error) {
    showHUD(`复习结果保存失败：${String((error as Error)?.message || error)}`, 3)
  } finally {
    current.submitting = false
    syncAnswerReviewControls()
    mountReviewViews(owner)
  }
}
