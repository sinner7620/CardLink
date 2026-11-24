import { prepareReviewCompletionEffect, playReviewCompletionEffect, disposeReviewCompletionEffect } from './review-completion-effect'
import { createWindowSurface, setWindowSurfaceOpacity } from "./window-opacity"
import { DEFAULT_ERROR_REASONS, type ErrorReason } from './error-reasons'
import { saveAttemptAnswerChecked } from './practice-attempts'
import { MN, NodeNote, popup, select, showHUD } from "marginnote"
import { MistakeLevel, reviewResultHint } from "./mistake-domain"
import { openSourceByMistakeId, reviewMistakeById, markQuestionAsMistake } from "./mistake-manager"
import { preFoldCurrentQuestion, resetFoldFallbackHint, startSameMapPractice, stopSameMapPractice } from "./same-map-practice"
import { closeAnswerCard, selectAnswerReviewLevel, syncAnswerReviewControls } from "./answer-card-view"
import { getBindingForMode, loadBindings } from "./store"
import { loadMatcherSettings } from "./settings"
import { focusNoteInMindMapFocusMode } from "./note-navigation"
import { loadMistakeState } from "./mistake-store"
import { reviewedToday, reviewBreadcrumbs, inReviewBranch, groupedReviewRows, type ReviewQueueRow } from "./review-queue"
import { UI_COLORS } from "./ui-tokens"
import { styleAnnotationReviewSurface } from "./quick-menu-surface"
import { pauseControlSurface, syncControlSurface } from "./native-control-surface"
import { notifyWorkbenchDataChanged } from "./workbench-notification"
import { usesSubcardAnswers } from "./binding"
import type { FsrsProgress } from "./fsrs-domain"
import { reviewToolbarAction, reviewToolbarLayout, reviewToolbarHorizontal, reviewToolbarCount } from "./review-toolbar-layout"
import { openReviewQuickMenu, closeReviewQuickMenu } from "./mnutils-entrance"

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
  purpose?: "review" | "practice"
  completed?: Record<string, true>
  visitFeedbackSaved?: boolean
  savedFeedback?: Record<string, { level?: number; reason?: ErrorReason; commentId?: string; answerChecked?: boolean }>
  practiceAdvancePending?: boolean
  maskAnswers?: boolean
  writingMode?: "mindmap" | "annotation" | "handwriting"
  writingFinished?: boolean
  writingOpenToken?: string
  feedbackReasons?: ErrorReason[]
  selectedReason?: ErrorReason
  feedbackReason?: { recordId: string; level: number; reason?: ErrorReason }
  reasonChoosing?: boolean
  annotationHorizontal?: boolean
  dropdownOffsets?: Record<string, number>
  annotationPhase?: "opening" | "editing" | "rating" | "idle" | "uncertain"
  annotationIntent?: { kind: "next" | "goto" | "exit"; index?: number }
  annotationChecking?: boolean
  annotationPendingLevel?: number
  annotationToken?: string
  annotationContinuations?: Array<{ recordId: string; commentId: string }>
  annotationHistorySwitch?: { reviewToken: string; saved: boolean; commentId?: string; discard?: boolean }
  annotationHistoryFeedbackRequired?: boolean
  annotationHistoryReady?: boolean
  annotationLastClose?: { reviewToken: string; saved: boolean; commentId?: string }
  answerChecked?: Record<string, boolean>
  papers?: Record<string, string>
  annotationResumedExisting?: boolean
  annotationVerdictMode?: "native"
  activeAnnotationVerdictMode?: "native"
  nativePaperVerdicts?: Record<string, string>
  paperLevels?: Record<string, number>
  pendingPaperLevel?: number
  algorithm?: "fixed" | "fsrs"
  items: ReviewModeItem[]
  index: number
  startedAt: number
  visited: Record<string, true>
  navigating: boolean
  navigationError?: string
  expanded?: boolean
  resultsVisible?: boolean
  branch?: number
  submitting?: boolean
  position?: { x: number; y: number }
  focusedNotebookId?: string
  focusedRootNodeId?: string
  suspended?: boolean
  queueFinished?: boolean
}

const BAR_HEIGHT = 40
const CONTROL_HEIGHT = 28
const BAR_WIDTH = 180
const INK = "#172033"
const MUTED = "#a9b1bf"
const HOVER = "#787880"
const ACTIVE = UI_COLORS.accent
const ANNOTATION_CELL = 44
const ANNOTATION_LENGTH = ANNOTATION_CELL * 7
function state(owner: any = self): ReviewModeState | undefined {
  return owner?.cardLinkReviewMode as ReviewModeState | undefined
}

function existingMistake(current: ReviewModeState) {
  const item = current.items[current.index], records = loadMistakeState().records
  return records[item.recordId] || records[`${item.sourceNotebookId}:${item.sourceNoteId}`]
}
function needsReviewFeedback(current: ReviewModeState): boolean {
  return current.purpose !== 'practice' || current.annotationResumedExisting === true || !!existingMistake(current)
}
function saveSessionFeedback(current: ReviewModeState, level?: number): void {
  const recordId = current.items[current.index].recordId
  current.visitFeedbackSaved = true
  ;(current.savedFeedback ||= {})[recordId] = {
    level, reason: current.feedbackReason?.reason, commentId: current.papers?.[recordId],
    answerChecked: current.answerChecked?.[recordId]
  }
}
function inlineReasons(current: ReviewModeState): ErrorReason[] {
  return (current.writingMode === 'annotation' && current.feedbackReasons?.length ? current.feedbackReasons : DEFAULT_ERROR_REASONS).slice(0, 6)
}

function isAnnotationMode(current: ReviewModeState | undefined): current is ReviewModeState & { writingMode: 'annotation' | 'handwriting' } {
  return current?.writingMode === "annotation" || current?.writingMode === "handwriting"
}

function annotationBusy(current: ReviewModeState): boolean {
  return isAnnotationMode(current) && ["opening", "editing", "rating", "uncertain"].includes(current.annotationPhase || "")
}

function annotationCommandBlocked(current: ReviewModeState): boolean {
  return !!current.reasonChoosing || isAnnotationMode(current) && ["opening", "rating"].includes(current.annotationPhase || "")
}

function reviewHost(owner: any): any {
  if (state(owner)?.suspended) return undefined
  return owner.cardLinkReviewEntranceHost
}

function completedToday(current: ReviewModeState): boolean[] {
  if (current.purpose === "practice") return current.items.map(item => !!current.completed?.[item.recordId])
  if (current.algorithm === "fsrs") return current.items.map(item => reviewedToday(item.fsrsProgress?.card?.last_review))
  const records = loadMistakeState().records
  return current.items.map(item => reviewedToday(records[item.recordId]?.lastReviewedAt || item.lastReviewedAt))
}

function reviewProgress(current: ReviewModeState): number {
  const completed = completedToday(current)
  return completed.length ? completed.filter(Boolean).length / completed.length : 0
}

// Shared by the original toolbar and the annotation index cell.
function reviewProgressSvg(progress: number): string {
  return `<svg class="progress" viewBox="0 0 32 32"><circle id="progress-disk" cx="16" cy="16" r="16" style="stroke:none;fill:transparent"/><circle class="progress-track" cx="16" cy="16" r="13"/><circle id="progress" class="progress-value" cx="16" cy="16" r="13" stroke-dasharray="${26 * Math.PI}" stroke-dashoffset="${26 * Math.PI * (1 - progress)}"/></svg>`
}

function reviewProgressStyle(): string {
  return `.progress{position:absolute;width:30px;height:30px;transform:rotate(-90deg)}.progress circle{fill:none;stroke-width:2.5}.progress-track{stroke:#e5e7eb}.progress-value{stroke:${HOVER};transition:stroke-dashoffset .2s ease}@media(prefers-reduced-motion:reduce){.progress-value{transition:none}}`
}

function reviewProgressScript(): string {
  return `window.setReviewProgress=function(progress,white,fill){document.getElementById('progress-disk').style.fill=fill||'transparent';document.getElementById('progress').setAttribute('stroke-dashoffset',String(${26 * Math.PI}*(1-progress)));document.getElementById('progress').style.stroke=white?'#ffffff':'${HOVER}';document.querySelector('.progress-track').style.stroke=white?'rgba(255,255,255,.35)':'#e5e7eb'}`
}

function configureReviewSvgSurface(webView: UIWebView, radius = BAR_HEIGHT / 2): void {
  const bridged = webView as any
  bridged.opaque = false
  bridged.backgroundColor = UIColor.clearColor()
  // UIWebView 自身透明仍不足以清除 UIScrollView 的默认白底。两层必须同时
  // 透明，否则 SVG 绘制层会以矩形盖住原生胶囊。
  bridged.scrollView.opaque = false
  bridged.scrollView.backgroundColor = UIColor.clearColor()
  bridged.userInteractionEnabled = false
  bridged.accessibilityElementsHidden = true
  bridged.scrollView.scrollEnabled = false
  bridged.scrollView.bounces = false
  bridged.scrollView.userInteractionEnabled = false
  // 即使宿主重置 WebView 合成背景，也只能落在胶囊轮廓内。
  bridged.layer.cornerRadius = radius
  bridged.layer.masksToBounds = true
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
    const title = crumb.title
    const size = Math.max(26, textWidth(title, 13) + 6)
    const x = width
    width += size + 10
    return { title, index, x, width: size }
  })
  return { entries, width: Math.max(0, width - 10) }
}

function animateReview(update: () => void, complete: () => void = () => {}): void {
  const accessibility = (globalThis as any).UIAccessibility
  const reduced = accessibility?.isReduceMotionEnabled === true ||
    (typeof accessibility?.isReduceMotionEnabled === 'function' && accessibility.isReduceMotionEnabled())
  if (reduced || typeof MNUtil === 'undefined' || typeof MNUtil.animate !== 'function') { update(); complete(); return }
  Promise.resolve(MNUtil.animate(update, 0.2)).then(complete, complete)
}

function mountSourceStrip(owner: any, current: ReviewModeState, toolbar: UIView, width: number, rowHeight = BAR_HEIGHT): void {
  const controlY = (rowHeight - CONTROL_HEIGHT) / 2
  const scroll = new UIScrollView({ x: BAR_WIDTH, y: 0, width: Math.max(0, width - BAR_WIDTH - 5), height: rowHeight })
  scroll.bounces = false
  ;(scroll as any).scrollEnabled = true
  ;(scroll as any).showsHorizontalScrollIndicator = true
  ;(scroll as any).directionalLockEnabled = true
  scroll.layer.masksToBounds = true
  if (owner.cardLinkReviewSourceOffset) scroll.contentOffset = owner.cardLinkReviewSourceOffset
  const layout = sourceLayout(current)
  ;(scroll as any).cardLinkBranchButtons = []
  layout.entries.forEach(({ title, index, x, width: w }) => {
    const button = textButton(owner, title, 'onReviewModeBranch:', index, { x, y: controlY, width: w, height: CONTROL_HEIGHT })
    ;(button as any).titleLabel.font = UIFont.systemFontOfSize(13)
    ;(scroll as any).cardLinkBranchButtons.push(button)
    scroll.addSubview(button)
    if (index < layout.entries.length - 1) {
      const arrow = new (UILabel as any)({ x: x + w, y: controlY, width: 10, height: CONTROL_HEIGHT })
      arrow.text = '›'
      arrow.textAlignment = 1
      arrow.textColor = UIColor.colorWithHexString(MUTED)
      scroll.addSubview(arrow)
    }
  })
  scroll.contentSize = { width: layout.width, height: rowHeight }
  toolbar.addSubview(scroll)
  owner.cardLinkReviewSource = scroll
}

function textWidth(title: string, fontSize: number): number {
  return Array.from(title).reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? fontSize : fontSize * 0.56), 0)
}

function dropdownFrame(owner: any, current: ReviewModeState, _toolbar: UIView, width: number, height: number) {
  const detail = annotationDetailLayout(current, owner)
  return { x: detail.x, y: detail.above ? -height - 6 : detail.y, width, height }
}

function mountReviewDropdown(owner: any, current: ReviewModeState, toolbar: UIView): void {
  if (!current.resultsVisible && current.branch === undefined) return
  const item = current.items[current.index]
  const crumb = reviewBreadcrumbs(item)[current.branch ?? -1]
  const completed = current.resultsVisible ? [] : completedToday(current)
  const feedbackNames = current.algorithm === "fsrs" ? ['不会', '不熟', '良好', '掌握'] : ['不会', '不熟', '掌握']
  const rows: ReviewQueueRow[] = current.resultsVisible
    ? [...feedbackNames, '跳过'].map((name, index) => ({ kind: 'question', title: current.algorithm === "fsrs" && index < 4 ? `${name} · 约 ${item.preview?.[index]?.days ?? '—'} 天` : name, index: index === feedbackNames.length ? -1 : index, depth: 0 }))
    : crumb ? groupedReviewRows(current.items, item, crumb) : []
  if (current.purpose === "practice" && current.resultsVisible) {
    rows.splice(0, rows.length, ...['不会', '不熟', '掌握'].map((title, index) => ({ kind: 'question' as const, title, index, depth: 0 })))
  }
  if (current.resultsVisible) {
    const records = loadMistakeState().records
    const record = records[item.recordId] || records[`${item.sourceNotebookId}:${item.sourceNoteId}`]
    for (const row of rows) {
      if (row.index < 0) continue
      if (current.algorithm === 'fsrs' && current.purpose !== 'practice') {
        const days = item.preview?.[row.index]?.days
        row.title = feedbackNames[row.index] + (record && days !== undefined ? ` +${days}天` : '')
      } else if (record) {
        const hint = reviewResultHint(record, row.index as MistakeLevel, loadMatcherSettings().mistakeReviewCurves)
        row.title += ` ${hint}`
      }
    }
  }
  const annotationFeedback = isAnnotationMode(current) && current.resultsVisible
  if (annotationFeedback && needsReviewFeedback(current)) { const skip = rows.findIndex(row => row.index === -1); if (skip >= 0) rows.splice(skip, 1) }
  if (annotationFeedback) {
    if (current.writingMode === 'annotation' || current.annotationToken) rows.push({ kind: 'question', title: current.writingMode === 'handwriting' ? '重试保存手写并继续' : current.annotationToken ? '批注窗口已关闭？恢复操作' : '重新打开批注窗口', index: -2, depth: 0 })
  }
  const recoveryRow = rows.find(row => row.index === -2)
  if (recoveryRow && current.annotationHorizontal) rows.splice(rows.indexOf(recoveryRow), 1)
  const bounds = reviewHost(owner).frame
  const detail = annotationDetailLayout(current, owner)
  const width = detail.width
  const reasonWidth = current.resultsVisible && current.annotationHorizontal ? Math.min(164, width * .48) : width
  const gradeWidth = current.resultsVisible && current.annotationHorizontal ? width - reasonWidth : width
  const headingHeight = 24
  const gradeHeight = rows.reduce((height, row) => height + (row.kind === 'heading' ? headingHeight : 34), 10)
  const reasonHeight = current.resultsVisible ? 24 + inlineReasons(current).length * 32 : 0
  const bodyHeight = current.annotationHorizontal ? Math.max(gradeHeight, reasonHeight) : gradeHeight + reasonHeight
  const recoveryHeight = recoveryRow && current.annotationHorizontal ? 34 : 0
  const contentHeight = bodyHeight + recoveryHeight

  const height = Math.min(detail.maxHeight, contentHeight)
  const y = detail.above ? -height - 6 : detail.y, x = Math.min(0, detail.x), top = Math.min(0, y)
  owner.cardLinkReviewEntranceResize?.(Math.max(detail.toolbarHeight, y + height) - top,
    Math.max(detail.toolbarWidth, detail.x + detail.width) - x, { x, y: top })
  const dropdown = createWindowSurface(dropdownFrame(owner, current, toolbar, width, height))
  styleAnnotationReviewSurface(dropdown, "list")
  dropdown.layer.masksToBounds = true
  const scroll = new UIScrollView({ x: 0, y: 0, width, height })
  owner.cardLinkReviewDropdownButtons = []
  scroll.bounces = false
  scroll.layer.cornerRadius = 12
  scroll.layer.masksToBounds = true
  scroll.backgroundColor = UIColor.clearColor()
  let rowY = 5
  rows.forEach(row => {
    const inset = 8 + Math.min(row.depth, 5) * 10
    if (row.kind === 'heading') {
      const label = new (UILabel as any)({ x: inset, y: rowY, width: width - inset - 8, height: headingHeight })
      label.text = row.title
      label.font = UIFont.systemFontOfSize(12)
      label.textColor = UIColor.colorWithHexString(HOVER)
      label.lineBreakMode = 4
      label.numberOfLines = 1
      label.userInteractionEnabled = false
      scroll.addSubview(label)
      rowY += headingHeight
      return
    }
    const pending = !current.resultsVisible && current.annotationIntent?.kind === 'goto' && current.annotationIntent.index === row.index
    const selected = !current.resultsVisible && row.index === current.index
    const title = pending ? `待切换 · ${row.title}` : selected ? `当前 · ${row.title}` : row.title
    const button = textButton(owner, title, current.resultsVisible ? 'onReviewModeToolbarResult:' : 'onReviewModeQueuePick:', row.index,
      { x: inset, y: rowY, width: gradeWidth - inset - 8, height: 32 })
    ;(button as any).titleLabel.font = UIFont.systemFontOfSize(14)
    ;(button as any).titleLabel.lineBreakMode = 4
    if (!current.resultsVisible) {
      const color = selected || pending ? UI_COLORS.accent : completed[row.index] ? UI_COLORS.level2 : undefined
      button.setTitleColorForState(UIColor.colorWithHexString(selected || pending ? ACTIVE : INK), 0)
      const background = color ? UIColor.colorWithHexString(color).colorWithAlphaComponent(0.2) : UIColor.clearColor()
      button.backgroundColor = background
      ;(button as any).cardLinkReviewRestingBackground = background
    }
    if (annotationFeedback && row.index === (current.annotationPendingLevel ?? (current.visitFeedbackSaved ? current.savedFeedback?.[item.recordId]?.level : undefined))) {
      button.backgroundColor = UIColor.colorWithHexString(ACTIVE).colorWithAlphaComponent(0.16)
      ;(button as any).cardLinkReviewRestingBackground = button.backgroundColor
    }
    button.enabled = !current.submitting && !current.navigating && (current.purpose === "practice" ? !annotationCommandBlocked(current) : annotationFeedback ? !annotationCommandBlocked(current) : !(current.resultsVisible ? annotationBusy(current) : annotationCommandBlocked(current)))
    owner.cardLinkReviewDropdownButtons.push(button)
    scroll.addSubview(button)
    rowY += 34
  })
  if (current.resultsVisible) {
    const x = current.annotationHorizontal ? gradeWidth : 0
    const top = current.annotationHorizontal ? 0 : gradeHeight
    const reasonArea = new UIView({ x, y: top, width: reasonWidth, height: reasonHeight })
    scroll.addSubview(reasonArea)
    const label = new (UILabel as any)({ x: 8, y: 0, width: reasonWidth - 16, height: 24 })
    label.text = '错因（可选，选后点等级提交）'
    label.font = UIFont.systemFontOfSize(10)
    reasonArea.addSubview(label)
    inlineReasons(current).forEach((reason, index) => {
      const selected = current.selectedReason?.key === reason.key
      const button = textButton(owner, `${selected ? '✓ ' : ''}${reason.label}`, 'onReviewModeReason:', index,
        { x: 8, y: 24 + index * 32, width: reasonWidth - 16, height: 30 })
      button.titleLabel.font = UIFont.systemFontOfSize(12)
      button.backgroundColor = selected ? UIColor.colorWithHexString(ACTIVE).colorWithAlphaComponent(.16) : UIColor.clearColor()
      button.enabled = !current.submitting && !current.navigating && !annotationCommandBlocked(current)
      reasonArea.addSubview(button)
    })
  }
  if (recoveryHeight && recoveryRow) {
    const button = textButton(owner, recoveryRow.title, 'onReviewModeToolbarResult:', -2,
      { x: 8, y: bodyHeight, width: width - 16, height: 32 })
    button.titleLabel.font = UIFont.systemFontOfSize(12)
    button.titleLabel.lineBreakMode = 4
    button.enabled = !current.submitting && !current.navigating && !annotationCommandBlocked(current)
    owner.cardLinkReviewDropdownButtons.push(button)
    scroll.addSubview(button)
  }
  scroll.contentSize = { width, height: contentHeight }
  const scrollKey = current.resultsVisible ? `rating:${item.recordId}` : JSON.stringify([item.sourceNotebookId, crumb?.kind === 'study' ? '' : item.sourceRootNodeId, crumb?.kind, crumb?.id])
  scroll.contentOffset = { x: 0, y: Math.max(0, Math.min(current.dropdownOffsets?.[scrollKey] ?? 0, contentHeight - height)) }
  ;(dropdown as any).cardLinkScroll = scroll
  ;(dropdown as any).cardLinkScrollKey = scrollKey
  dropdown.addSubview(scroll)
  reviewHost(owner).addSubview(dropdown)
  owner.cardLinkReviewDropdown = dropdown
}

export function onReviewModeBranch(sender: any): void {
  const current = state()
  if (!current || current.navigating || current.submitting || annotationCommandBlocked(current)) return
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
  if (index === current.index && !current.navigationError) { showHUD('当前正在作答这道题', 2); return }
  const item = current.items[current.index], crumb = reviewBreadcrumbs(item)[current.branch]
  if (crumb && inReviewBranch(current.items[index], item, crumb)) void goTo(index)
}

function removeReviewViews(owner: any = self, keepToolbar = false, keepSource = false): void {
  if (!keepToolbar) {
    pauseControlSurface(owner?.cardLinkReviewSvgView)
    pauseControlSurface(owner?.cardLinkReviewProgressSvgView)
    try { owner?.cardLinkReviewToolbar?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  }
  try { owner?.cardLinkReviewDropdown?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  try { owner?.cardLinkReviewExtraControls?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  if (!keepSource) owner?.cardLinkReviewSource?.removeFromSuperview?.()
  if (!owner) return
  owner.cardLinkReviewDropdown = undefined
  owner.cardLinkReviewDropdownButtons = []
  if (!keepToolbar) {
    owner.cardLinkReviewToolbar = undefined
    owner.cardLinkReviewIndexButton = undefined
    owner.cardLinkReviewAnnotationButtons = undefined
    owner.cardLinkReviewAnnotationNumber = undefined
    owner.cardLinkReviewDetailKey = undefined
    owner.cardLinkReviewNavigationButtons = undefined
    owner.cardLinkReviewNavigationControls = undefined
  }
}

function currentItem(owner: any = self): ReviewModeItem | undefined {
  const current = state(owner)
  return current?.items[current.index]
}

function toolbarLayout(current: ReviewModeState, owner: any) {
  const limits = owner.cardLinkReviewEntranceLimits?.() ?? { width: 1024, height: 768 }
  return reviewToolbarLayout(!!current.annotationHorizontal, !!current.expanded, sourceLayout(current).width, limits, reviewToolbarCount(current))
}

function annotationDetailLayout(current: ReviewModeState, owner: any) {
  const limits = owner.cardLinkReviewEntranceLimits?.() ?? { width: 1024, height: 768 }
  const layout = toolbarLayout(current, owner), horizontal = !!current.annotationHorizontal
  const left = !horizontal && (limits.left ?? 0) > (limits.right ?? limits.width)
  const width = Math.max(0, Math.min(252, horizontal ? limits.width : (left ? limits.left : limits.right ?? limits.width - layout.mainWidth) - 12))
  const above = horizontal && (limits.above ?? 0) > (limits.below ?? limits.height - layout.height)
  const x = horizontal ? Math.max(0, (current.expanded ? layout.sourceX : layout.mainWidth) - width) : left ? -width - 12 : layout.mainWidth + 12
  const y = horizontal ? layout.height + 6 : 46
  return { x, y, above, toolbarWidth: layout.width, toolbarHeight: layout.height, width,
    maxHeight: Math.max(0, Math.min(horizontal ? 260 : layout.height - y,
      horizontal ? (above ? limits.above : limits.below ?? limits.height - layout.height) - 6 : limits.height - y)) }
}

function practiceLevel(current: ReviewModeState): MistakeLevel | undefined {
  if (current.purpose !== 'practice') return
  const item = current.items[current.index]
  return loadMistakeState().records[`${item.sourceNotebookId}:${item.sourceNoteId}`]?.level
}

function mountAnnotationProgress(owner: any, current: ReviewModeState, button: UIButton, panel: UIView): void {
  const progress = reviewProgress(current)
  const view: UIWebView = owner.cardLinkReviewProgressSvgView ||= new UIWebView({ x: (ANNOTATION_CELL - 30) / 2, y: (ANNOTATION_CELL - 30) / 2, width: 30, height: 30 })
  configureReviewSvgSurface(view, 15)
  view.frame = { x: (button.frame.width - 30) / 2, y: (button.frame.height - 30) / 2, width: 30, height: 30 }
  if (view.superview !== button) { view.removeFromSuperview(); button.addSubview(view) }
  syncControlSurface(view, {
    html: () => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body{margin:0;width:30px;height:30px;overflow:hidden;background:transparent!important;pointer-events:none;-webkit-user-select:none}${reviewProgressStyle()}.progress{left:0;top:0;pointer-events:none}</style></head><body>${reviewProgressSvg(reviewProgress(current))}<script>${reviewProgressScript()}</script></body></html>`,
    method: 'setReviewProgress', args: [progress, practiceLevel(current) !== undefined, current.purpose === 'practice' ? (practiceLevel(current) === undefined ? '#ffffff' : [UI_COLORS.level0, UI_COLORS.level1, UI_COLORS.level2][practiceLevel(current)!]) : 'transparent'], rootId: 'progress',
    active: () => state(owner) === current && owner.cardLinkReviewIndexButton === button && !!panel.superview && !panel.hidden,
    onReady: () => configureReviewSvgSurface(view, 15)
  })
}

/** All writing modes share this native toolbar and its classification/feedback surfaces. */
function mountAnnotationControls(owner: any, current: ReviewModeState, host: UIView, keepDetails = false): void {
  const horizontal = !!current.annotationHorizontal
  const busy = current.navigating || !!current.submitting || annotationCommandBlocked(current)
  const layout = toolbarLayout(current, owner)
  const detail = annotationDetailLayout(current, owner)
  const hasHeader = current.expanded || current.resultsVisible && !horizontal
  if (!keepDetails) {
    const x = hasHeader && !horizontal ? Math.min(0, detail.x) : 0
    owner.cardLinkReviewEntranceResize?.(layout.height,
      Math.max(layout.width, hasHeader && !horizontal ? detail.x + detail.width : 0) - x, { x, y: 0 })
  }
  const reused = owner.cardLinkReviewToolbar?.superview === host
  const panel = reused ? owner.cardLinkReviewToolbar : createWindowSurface({ x: 0, y: 0, width: layout.width, height: layout.height })
  panel.frame = { x: 0, y: 0, width: layout.width, height: layout.height }
  if (!reused) {
    styleAnnotationReviewSurface(panel, "chrome")
    host.addSubview(panel)
    owner.cardLinkReviewAnnotationButtons = []
    panel.addGestureRecognizer(new UIPanGestureRecognizer(owner, "onMnutilsEntrancePan:"))
  }
  styleAnnotationReviewSurface(panel, "chrome")
  ;(panel.layer as any).shadowOpacity = 0
  if (!horizontal) panel.layer.borderWidth = 0
  const action = reviewToolbarAction(current)
  const hasMistake = practiceLevel(current) !== undefined
  const specs: Array<[string, string, string | undefined, boolean]> = [
    ['打开 CardLink', 'onMnutilsQuickMenuOpenPanel:', 'plugin', true],
    [`第 ${current.index + 1} 题，共 ${current.items.length} 题`, 'onReviewModeIndex:', undefined, !busy],
    ['上一题', 'onReviewModePrevious:', 'previous', !busy && current.index > 0],
    [action.title, 'onReviewModeNext:', action.icon, !busy],
    ['查找当前卡片答案', 'onReviewModeAnswer:', 'answer', !current.navigating && !current.submitting],
    [current.expanded ? '收起分类' : '分类索引', 'onReviewModeExpand:', current.expanded ? 'collapse' : 'category', true],
    [current.purpose === 'practice' ? '结束做题' : '退出复习', 'onReviewModeExit:', 'exit', !busy]
  ]
  if (current.writingMode === 'annotation') specs.splice(5, 0, ['历史作答', 'onReviewModeHistory:', 'history', !current.navigating && !current.submitting])
  const separateMark = current.purpose === 'practice'
  if (separateMark) {
    const feedback: [string, string, string, boolean] = [hasMistake ? '复习反馈' : '标记错题', 'onReviewModeMark:', hasMistake ? 'next' : 'mark', !busy]
    if (current.writingMode === 'annotation') specs.splice(3, 1, feedback)
    else specs.splice(4, 0, feedback)
  }
  const level = practiceLevel(current)
  const levelColor = level === undefined ? undefined : [UI_COLORS.level0, UI_COLORS.level1, UI_COLORS.level2][level]
  specs.forEach(([title, action, icon, enabled], i) => {
    const button = reused ? owner.cardLinkReviewAnnotationButtons[i] : makeButton(owner, title, action, ANNOTATION_CELL)
    ;(button as any).accessibilityLabel = title
    button.frame = layout.buttons[i]
    button.enabled = enabled
    ;(button as any).adjustsImageWhenDisabled = false
    ;(button as any).cardLinkReviewRestingAlpha = i === 2 && current.index === 0 ? 0.28 : 1
    ;(button as any).alpha = (button as any).cardLinkReviewRestingAlpha
    if (icon) {
      const images = owner.cardLinkReviewNativeImages ||= {}
      images[icon] ||= UIImage.imageWithDataScale(NSData.dataWithContentsOfFile(icon === 'plugin' ? `${owner.mainPath}/logo.png` : `${owner.mainPath}/review-toolbar/${icon}.png`), icon === 'plugin' ? 2 : 3)
      if ((button as any).cardLinkReviewIcon !== icon) {
        ;(button as any).setImageForState(images[icon], 0)
        ;(button as any).cardLinkReviewIcon = icon
      }
      if ((button as any).imageView) (button as any).imageView.contentMode = 1
      ;(button as any).contentEdgeInsets = { top: 10, left: 10, bottom: 10, right: 10 }
    }
    button.backgroundColor = action === 'onReviewModeExpand:' && current.expanded || action === (separateMark ? 'onReviewModeMark:' : 'onReviewModeNext:') && current.resultsVisible
      ? UIColor.colorWithHexString(ACTIVE).colorWithAlphaComponent(0.16) : UIColor.clearColor()
    ;(button as any).cardLinkReviewRestingBackground = button.backgroundColor
    if (!reused) { panel.addSubview(button); owner.cardLinkReviewAnnotationButtons.push(button) }
    if (i === 1) {
      owner.cardLinkReviewIndexButton = button
      // JSB converts the constructor argument to CGRect before frame can be updated.
      const numberFrame = { x: (button.frame.width - 30) / 2, y: (button.frame.height - 30) / 2, width: 30, height: 30 }
      const number = reused ? owner.cardLinkReviewAnnotationNumber : new (UILabel as any)(numberFrame)
      number.frame = numberFrame
      number.text = String(current.index + 1)
      number.textAlignment = 1
      number.font = UIFont.systemFontOfSize(12)
      number.textColor = UIColor.colorWithHexString(levelColor ? '#ffffff' : INK)
      number.userInteractionEnabled = false
      number.backgroundColor = UIColor.clearColor()
      const disk = owner.cardLinkReviewNumberDisk ||= new UIView(numberFrame)
      disk.frame = numberFrame
      disk.backgroundColor = current.purpose === 'practice' ? UIColor.colorWithHexString(levelColor || '#ffffff') : UIColor.clearColor()
      disk.layer.cornerRadius = 15
      disk.userInteractionEnabled = false
      if (disk.superview !== button) { disk.removeFromSuperview(); button.addSubview(disk) }
      number.layer.cornerRadius = 15
      number.layer.masksToBounds = true
      if (!reused) owner.cardLinkReviewAnnotationNumber = number
      mountAnnotationProgress(owner, current, button, panel)
      // Text must stay above the progress WebView, whose native backing may cover siblings.
      if (number.superview !== button) button.addSubview(number)
    }
  })
  owner.cardLinkReviewToolbar = panel
  if (keepDetails) {
    for (const button of owner.cardLinkReviewDropdownButtons || []) button.enabled = !current.submitting && !current.navigating && !annotationCommandBlocked(current)
    return
  }
  if (hasHeader) {
    if (!owner.cardLinkReviewSource) {
      if (current.resultsVisible && !(horizontal && current.expanded)) {
        const header = new UIScrollView({ x: 0, y: 0, width: detail.width, height: 44 })
        header.contentSize = { width: detail.width, height: 44 }
        header.bounces = false
        const title = new (UILabel as any)({ x: 8, y: 0, width: detail.width - 16, height: 44 })
        title.text = current.items[current.index].sourceTitle || `第 ${current.index + 1} 题`
        title.font = UIFont.systemFontOfSize(13)
        title.textColor = UIColor.colorWithHexString(INK)
        title.numberOfLines = 2
        title.lineBreakMode = 4
        title.userInteractionEnabled = false
        title.backgroundColor = UIColor.clearColor()
        header.addSubview(title)
        owner.cardLinkReviewSource = header
      } else mountSourceStrip(owner, current, panel, (horizontal ? layout.sourceWidth : detail.width) + BAR_WIDTH, ANNOTATION_CELL)
    }
    const source = owner.cardLinkReviewSource
    for (const button of source.cardLinkBranchButtons || []) {
      button.backgroundColor = current.branch === button.tag ? UIColor.colorWithHexString(ACTIVE).colorWithAlphaComponent(0.16) : UIColor.clearColor()
      button.cardLinkReviewRestingBackground = button.backgroundColor
    }
    source.frame = horizontal && current.expanded
      ? { x: layout.sourceX, y: 0, width: layout.sourceWidth, height: layout.height }
      : { x: detail.x, y: horizontal ? layout.height : 0, width: detail.width, height: 44 }
    if (source.cardLinkBranchButtons) {
      source.contentOffset = { x: Math.max(0, Math.min(Number(source.contentOffset?.x || 0), Math.max(0, source.contentSize.width - source.frame.width))), y: 0 }
    }
    styleAnnotationReviewSurface(source, "chrome")
    if (source.superview !== host) { source.removeFromSuperview(); host.addSubview(source) }
  }
  mountReviewDropdown(owner, current, panel)
}

function mountReviewViews(owner: any = self, animated = false): void {
  const current = state(owner), item = currentItem(owner), host = reviewHost(owner)
  if (!current || !item || !host) return
  const key = JSON.stringify([current.index, !!current.expanded, !!current.resultsVisible, current.branch,
    current.annotationIntent?.kind, current.annotationIntent?.index,
    current.annotationPendingLevel, !!current.annotationToken, current.algorithm, item.lastReviewedAt,
    current.annotationHorizontal, practiceLevel(current), host.frame.width, host.frame.height])
  const keepToolbar = owner.cardLinkReviewToolbar?.superview === host
  if (keepToolbar && owner.cardLinkReviewDetailKey === key) { mountAnnotationControls(owner, current, host, true); return }
  const previousSource = owner.cardLinkReviewSource, previousDropdown = owner.cardLinkReviewDropdown
  const sourceKey = current.expanded && (!current.resultsVisible || current.annotationHorizontal)
    ? JSON.stringify(['path', reviewBreadcrumbs(item)])
    : current.resultsVisible && !current.annotationHorizontal ? JSON.stringify(['rating', item.sourceTitle || `第 ${current.index + 1} 题`]) : undefined
  const keepSource = !!previousSource && sourceKey !== undefined && previousSource.cardLinkSourceKey === sourceKey
  const previousFrames = owner.cardLinkReviewAnnotationButtons?.map((button: UIButton) => ({ ...button.frame }))
  const previousPanelFrame = owner.cardLinkReviewToolbar?.frame
  owner.cardLinkReviewSourceOffset = previousSource?.contentOffset
  if (previousDropdown?.cardLinkScrollKey) {
    current.dropdownOffsets ||= {}
    current.dropdownOffsets[previousDropdown.cardLinkScrollKey] = Number(previousDropdown.cardLinkScroll?.contentOffset?.y || 0)
  }
  if (animated) owner.cardLinkReviewDropdown = undefined
  removeReviewViews(owner, keepToolbar, keepSource)
  if (!keepSource) owner.cardLinkReviewSource = undefined
  mountAnnotationControls(owner, current, host)
  if (owner.cardLinkReviewSource) owner.cardLinkReviewSource.cardLinkSourceKey = sourceKey
  owner.cardLinkReviewDetailKey = key
  const leavingSource = previousSource && !owner.cardLinkReviewSource ? previousSource : undefined
  if (animated && leavingSource) { host.addSubview(leavingSource); leavingSource.userInteractionEnabled = false }
  if (animated && previousDropdown) previousDropdown.userInteractionEnabled = false
  if (!animated) { owner.cardLinkReviewEntranceCommit?.(false); return }
  const source = owner.cardLinkReviewSource, dropdown = owner.cardLinkReviewDropdown
  const buttons = owner.cardLinkReviewAnnotationButtons, targets = buttons.map((button: UIButton) => ({ ...button.frame }))
  const panel = owner.cardLinkReviewToolbar, panelTarget = { ...panel.frame }
  if (source && !keepSource) setWindowSurfaceOpacity(source, 0)
  if (dropdown) setWindowSurfaceOpacity(dropdown, 0)
  if (keepToolbar && previousFrames) {
    buttons.forEach((button: UIButton, index: number) => { button.frame = previousFrames[index] })
    panel.frame = previousPanelFrame
  }
  animateReview(() => {
    owner.cardLinkReviewEntranceCommit?.(false)
    buttons.forEach((button: UIButton, index: number) => { button.frame = targets[index] })
    panel.frame = panelTarget
    if (source) setWindowSurfaceOpacity(source, 1)
    if (dropdown) setWindowSurfaceOpacity(dropdown, 1)
    if (leavingSource) setWindowSurfaceOpacity(leavingSource, 0)
    if (previousDropdown) setWindowSurfaceOpacity(previousDropdown, 0)
  }, () => {
    previousDropdown?.removeFromSuperview()
    leavingSource?.removeFromSuperview()
  })
}

async function focusQueueItem(owner: any, item: ReviewModeItem): Promise<boolean> {
  const current = state(owner)
  if (current?.purpose === "practice") {
    const result = await startSameMapPractice(item.sourceNotebookId, [item.sourceNoteId], {
      maskAnswers: current.maskAnswers, owner, rootNodeId: item.sourceRootNodeId
    })
    if (!result.started) throw new Error(result.reason || "无法定位做题卡片")
    return true
  }
  const target = MN.db.getNoteById(item.sourceNoteId)
  if (!target) {
    showHUD("该题目卡片已不存在", 2)
    return false
  }
  const sameMindMap = Boolean(
    MN.currnetNotebookId === item.sourceNotebookId &&
    current?.focusedNotebookId === item.sourceNotebookId &&
    current?.focusedRootNodeId &&
    current.focusedRootNodeId === item.sourceRootNodeId
  )
  if (sameMindMap) {
    // 折叠优先：先按题卡收起分支，再移动焦点，避免定位时重新画出答案。
    if (usesSubcardAnswers(
      getBindingForMode(loadBindings(), item.sourceNotebookId, item.sourceRootNodeId, loadMatcherSettings().allowSameStudySetMindMap),
      target.colorIndex)) {
      // 访问代次：题目仍停在本次进入的目标题时才允许写入折叠。
      await preFoldCurrentQuestion(item.sourceNotebookId, item.sourceNoteId, owner, item.sourceRootNodeId,
        () => state(owner) === current && !!current && current.items[current.index] === item && !current.submitting)
    }
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
    const result = await startSameMapPractice(item.sourceNotebookId, [item.sourceNoteId], {
      alreadyFocused: true, owner, rootNodeId: item.sourceRootNodeId
    })
    if (state(owner) !== current) stopSameMapPractice()
    else if (!result.started && result.reason !== "所选题目没有直接子卡片答案") showHUD(result.reason || "答案遮盖失败", 3)
  }
  return true
}

async function goTo(index: number, owner: any = self): Promise<boolean> {
  const current = state(owner)
  if (current?.reasonChoosing) return false
  if (isAnnotationMode(current) && ["editing", "uncertain"].includes(current.annotationPhase || "")) {
    queueAnnotationAction(owner, current, { kind: "goto", index })
    return false
  }
  if (!current || current.navigating || current.submitting || annotationBusy(current) || !current.items.length) return false
  stopSameMapPractice()
  closeAnswerCard()
  const target = Math.max(0, Math.min(current.items.length - 1, index))
  // Explicit navigation abandons deferred continuations. Normal advancement
  // reaches goTo only after the current question's continuation queue is empty.
  current.annotationContinuations = undefined
  current.annotationHistorySwitch = undefined
  current.annotationHistoryReady = false
  current.annotationHistoryFeedbackRequired = false
  const feedback = current.savedFeedback?.[current.items[target].recordId]
  current.feedbackReason = feedback?.level === undefined ? undefined : { recordId: current.items[target].recordId, level: feedback.level, reason: feedback.reason }
  current.selectedReason = feedback?.reason
  if (target !== current.index) current.pendingPaperLevel = undefined
  current.index = target
  current.visitFeedbackSaved = !!feedback
  current.annotationResumedExisting = false
  current.resultsVisible = false
  current.annotationPendingLevel = undefined
  current.branch = undefined
  current.navigating = true
  current.navigationError = undefined
  const item = current.items[target]
  if (feedback) {
    if (feedback.commentId) current.papers![item.recordId] = feedback.commentId
    else delete current.papers![item.recordId]
    current.answerChecked![item.recordId] = feedback.answerChecked === true
  }
  current.visited[item.recordId] = true
  mountReviewViews(owner)
  try {
    if (current.suspended) return true
    if (current.writingMode === 'handwriting') {
      const finished = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, { operation: 'writing-finish' })
      if (finished?.finished !== true) throw new Error('上一题手写会话尚未结束，未切题')
      if (state(owner) !== current || !await focusQueueItem(owner, item)) return false
      if (state(owner) !== current) return false
    }
    if (isAnnotationMode(current)) return await openReviewAnnotation(owner, current)
    const focused = await focusQueueItem(owner, item)
    return focused
  } catch (error) {
    current.navigationError = String((error as Error)?.message || error)
    showHUD(`切换题目失败：${current.navigationError}`, 2)
    return false
  } finally {
    const latest = state(owner)
    if (latest === current) latest.navigating = false
    mountReviewViews(owner)
  }
}

export async function startReviewMode(itemsValue: unknown, owner: any = self, algorithm: "fixed" | "fsrs" = "fixed", writingMode: "mindmap" | "annotation" | "handwriting" = "mindmap", practice?: { maskAnswers: boolean }): Promise<{ started: boolean; count: number; reason?: string }> {
  if (!['mindmap', 'annotation', 'handwriting'].includes(writingMode)) throw new Error('该书写模式已移除，请重新选择书写方式')
  if (state(owner) && annotationBusy(state(owner)!)) throw new Error("请先关闭当前批注窗口")
  if (writingMode !== "mindmap") {
    const scene = (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__
    const ready = scene?.ensureReady ? await scene.ensureReady(owner) : scene?.enabled(owner)
    if (!ready) throw new Error("批注复习需要开启场景功能，并在支持的场景页面中使用")
  }
  if (state(owner)?.submitting) throw new Error("请等待本次复习保存完成")
  if (algorithm === "fsrs" && (!loadMatcherSettings().debugModeEnabled || loadMatcherSettings().debugReviewAlgorithm !== "fsrs")) throw new Error("智能复习未开启")
  if (!practice && algorithm === "fixed" && loadMatcherSettings().debugModeEnabled && loadMatcherSettings().debugReviewAlgorithm === "fsrs") throw new Error("请从智能复习页进入复习模式")
  const items = Array.isArray(itemsValue)
    ? itemsValue.filter(item => item && typeof item.recordId === "string" && item.recordId) as ReviewModeItem[]
    : []
  if (!items.length) return { started: false, count: 0 }
  let feedbackReasons: ErrorReason[] | undefined
  if (writingMode === 'annotation' || writingMode === 'handwriting') {
    const starting = {}
    owner.cardLinkReviewStarting = starting
    try {
      const config = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, {
        operation: writingMode === 'annotation' ? 'practice-config' : 'writing-config'
      })
      if (owner.cardLinkReviewStarting !== starting) return { started: false, count: items.length, reason: '本次启动已取消' }
      if (writingMode === 'annotation') feedbackReasons = config?.reasons
      if (config?.available === false || (writingMode === 'annotation' ? !Array.isArray(config?.reasons) : config?.available !== true)) {
        const reason = writingMode === 'annotation'
          ? `${config?.reason || '当前模板未配置原生作答判定'}。请导入带 CardLink 配置的场景模板后重试`
          : config?.reason || '当前宿主未提供可用的手写会话'
        showHUD(reason, 5)
        return { started: false, count: items.length, reason }
      }
    } catch (error) {
      if (owner.cardLinkReviewStarting !== starting) return { started: false, count: items.length, reason: '本次启动已取消' }
      const reason = `${writingMode === 'annotation' ? '模板配置' : '手写会话能力'}检测失败：${String((error as Error)?.message || error)}`
      showHUD(reason, 5)
      return { started: false, count: items.length, reason }
    } finally { if (owner.cardLinkReviewStarting === starting) owner.cardLinkReviewStarting = undefined }
  }
  const stored = practice ? {} : loadMistakeState().records
  for (const item of items) {
    item.lastReviewedAt = algorithm === "fsrs" ? item.fsrsProgress?.card?.last_review : stored[item.recordId]?.lastReviewedAt
    try {
      const note = MN.db.getNoteById(item.sourceNoteId)
      item.sourceAncestors = note ? [...new NodeNote(note, item.sourceNotebookId).ancestorNodes].reverse().map(node => ({ id: node.note.noteId, title: node.title?.trim() || '未命名节点' })) : []
      const rootIndex = item.sourceAncestors.findIndex(node => node.id === item.sourceRootNodeId)
      if (rootIndex >= 0) item.sourceAncestors = item.sourceAncestors.slice(rootIndex + 1)
    } catch { item.sourceAncestors = [] }
  }
  removeReviewViews(owner)
  closeReviewQuickMenu(owner)
  owner.cardLinkReviewEntranceRender = undefined
  owner.cardLinkReviewDismissClassification = undefined
  owner.cardLinkReviewAnnotationClosed = undefined
  // 每一轮做题/复习允许重新提示一次“折叠优先已改为遮盖”。
  resetFoldFallbackHint(owner)
  owner.cardLinkReviewMode = {
    purpose: practice ? "practice" : "review", completed: {}, maskAnswers: practice?.maskAnswers,
    writingMode, feedbackReasons, annotationPhase: "idle", papers: {}, answerChecked: {},
    annotationVerdictMode: writingMode === 'annotation' ? 'native' : undefined,
    algorithm,
    items,
    index: 0,
    startedAt: Date.now(),
    visited: {},
    navigating: false,
  } satisfies ReviewModeState
  {
    owner.cardLinkReviewDismissClassification = () => {
      const current = state(owner)
      if (!current) return
      const dismissFeedback = dismissUnselectedAnnotationFeedback(current)
      if (!current.expanded && !dismissFeedback) return
      if (!current.annotationHorizontal) current.expanded = false
      current.branch = undefined
      mountReviewViews(owner, true)
    }
    owner.cardLinkReviewEntranceRender = (host: any) => {
      owner.cardLinkReviewEntranceHost = host
      mountReviewViews(owner)
    }
    owner.cardLinkReviewAnnotationClosed = (event: any) => {
      const token = state(owner)?.annotationToken
      if (!token || token !== event?.reviewToken) return false
      void onReviewAnnotationClosed(owner, event)
      return state(owner)?.annotationToken !== token
    }
    if (!openReviewQuickMenu(owner)) {
      owner.cardLinkReviewMode = undefined
      owner.cardLinkReviewEntranceRender = undefined
      owner.cardLinkReviewDismissClassification = undefined
      owner.cardLinkReviewAnnotationClosed = undefined
      throw new Error("请先启用 MN Utils 悬浮球，再开始做题或复习")
    }
  }
  try {
    const panel = __MNAM_WEB_PANEL_GLOBAL__
    if (panel?.isVisible?.(owner.webController)) panel.hidePanel(owner.webController, true)
  } catch { /* review can continue without a visible panel */ }
  prepareReviewCompletionEffect(owner, !practice && loadMatcherSettings().reviewCompletionConfetti !== false)
  const opened = await goTo(0, owner)
  if (!opened) {
    // An unconfirmed host open must retain the session and its close receipt.
    // A close event may also have already advanced to the next question.
    const current = state(owner)
    const reason = current?.navigationError || (writingMode === 'mindmap' ? '题目定位或答案遮盖未完成' : '批注窗口尚未确认打开，请先恢复窗口状态')
    if (current?.index === 0 && writingMode === "mindmap") discardReviewMode(owner)
    return { started: false, count: items.length, reason }
  }
  return { started: true, count: items.length }
}

export async function startPracticeMode(notebookId: string, noteIds: string[], rootId: string | undefined, maskAnswers: boolean, writingMode: "mindmap" | "annotation" | "handwriting", owner: any = self): Promise<{ started: boolean; count: number; reason?: string }> {
  const items: ReviewModeItem[] = noteIds.map(id => {
    const note = MN.db.getNoteById(id)
    if (!note) throw new Error("所选题目已不存在，请重新选择")
    return { recordId: id, sourceNoteId: id, sourceNotebookId: notebookId, sourceRootNodeId: rootId,
      sourceTitle: note.noteTitle?.trim() || "未命名题目", sourceNotebookTitle: MN.db.getNotebookById(notebookId)?.title || "未命名学习集",
      sourceRootTitle: rootId ? MN.db.getNoteById(rootId)?.noteTitle : undefined, level: 0, reviewCount: 0 }
  })
  return startReviewMode(items, owner, "fixed", writingMode, { maskAnswers })
}

let annotationSequence = 0

async function openReviewAnnotation(owner: any, current: ReviewModeState, commentId?: string, nativePaper?: boolean): Promise<boolean> {
  const item = current.items[current.index]
  current.visitFeedbackSaved = !commentId && !!current.savedFeedback?.[item.recordId]
  current.annotationHistoryFeedbackRequired = false
  current.annotationLastClose = undefined
  if (commentId) { current.feedbackReason = undefined; current.selectedReason = undefined }
  if (current.writingMode === 'annotation' && nativePaper === false) throw Object.assign(new Error('这条是普通旧批注；当前批注模式只继续原生练习批注，请在卡片上打开普通批注'), { editorMayBeOpen: false })
  const token = current.writingMode === 'handwriting' && current.writingOpenToken || `cardlink-review-${Date.now()}-${++annotationSequence}`
  if (current.writingMode === 'handwriting') current.writingOpenToken = token
  current.activeAnnotationVerdictMode = current.annotationVerdictMode
  current.annotationToken = token
  current.annotationResumedExisting = !!commentId
  current.annotationPhase = "opening"
  mountReviewViews(owner)
  try {
    if (state(owner) !== current || current.annotationToken !== token) return false
    if (commentId) {
      current.papers![item.recordId] = commentId
      if (current.paperLevels) delete current.paperLevels[commentId]
      if (current.nativePaperVerdicts) delete current.nativePaperVerdicts[commentId]
    }
    else { delete current.papers![item.recordId]; delete current.answerChecked![item.recordId]; current.pendingPaperLevel = undefined }
    const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, {
      ...(current.writingMode === 'handwriting' ? { operation: 'writing-open' } : {}),
      noteid: item.sourceNoteId, topicid: item.sourceNotebookId, recordId: item.recordId, reviewToken: token,
      advance: current.index === current.items.length - 1 && !current.annotationContinuations?.length ? "finish" : "next",
      nextNoteid: current.items[current.index + 1]?.sourceNoteId,
      newAttempt: !commentId,
      ordinary: false,
      commentId
    })
    if (state(owner) !== current || current.annotationToken !== token) return false
    if (result?.editorOpened !== true) throw new Error("未确认批注窗口已打开")
    if (current.annotationPhase === 'opening' && result.reusedExisting) {
      current.annotationResumedExisting = true
      if (result.commentId) current.papers![item.recordId] = result.commentId
      showHUD(current.purpose === 'practice' ? '已继续当前批注，未主动反馈时保存后默认会了并继续' : '已继续当前批注，保存后请选择等级反馈', 4)
    }
    // The user can close an editor before its open response arrives.
    if (current.annotationPhase === "opening") current.annotationPhase = "editing"
    return true
  } catch (error) {
    if (state(owner) === current && current.annotationToken === token && current.annotationPhase === "opening") {
      current.annotationPhase = (error as any)?.editorMayBeOpen === false ? "idle" : "uncertain"
      if (current.annotationPhase === "idle") current.annotationToken = undefined
    }
    throw error
  } finally { if (state(owner) === current) mountReviewViews(owner) }
}

async function continueHistorySwitch(owner: any, current: ReviewModeState): Promise<void> {
  const pending = current.annotationHistorySwitch
  if (!pending || state(owner) !== current || current.reasonChoosing || current.submitting || current.navigating || annotationBusy(current)) return
  const item = current.items[current.index]
  if (current.annotationContinuations?.[0]?.recordId !== item.recordId) return
  if (pending.saved && pending.discard === undefined) {
    current.reasonChoosing = true
    mountReviewViews(owner)
    try {
      const choice = await select(['保存当前批注并反馈', '丢弃当前新批注'], '是否保存当前批注？', '当前新批注已有内容。保存后先完成反馈，再进入选中的历史批注；丢弃仅移除本次新批注。', true)
      if (state(owner) !== current || current.annotationHistorySwitch !== pending) return
      if (choice.index !== 0 && choice.index !== 1) return
      pending.discard = choice.index === 1
    } finally { current.reasonChoosing = false; if (state(owner) === current) mountReviewViews(owner) }
    if (pending.discard === undefined) return
  }
  if (pending.saved && pending.discard === false) {
    current.annotationHistorySwitch = undefined
    current.annotationHistoryFeedbackRequired = true
    showAnnotationRating(owner, current)
    return
  }
  if (pending.saved) {
    current.submitting = true
    mountReviewViews(owner)
    try {
      const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, {
        operation: 'practice-discard', noteid: item.sourceNoteId, topicid: item.sourceNotebookId,
        reviewToken: pending.reviewToken, commentId: pending.commentId
      })
      if (state(owner) !== current || current.annotationHistorySwitch !== pending) return
      if (result?.discarded !== true || result.commentId !== pending.commentId) throw new Error('新批注丢弃尚未确认')
    } catch (error) { showHUD(`丢弃失败，当前批注和历史续写任务均已保留：${String((error as Error)?.message || error)}，点下一题重试`, 5); return }
    finally { current.submitting = false; if (state(owner) === current) mountReviewViews(owner) }
  }
  current.annotationHistorySwitch = undefined
  current.annotationHistoryReady = true
  current.annotationHistoryFeedbackRequired = false
  current.annotationPendingLevel = undefined
  current.pendingPaperLevel = undefined
  current.feedbackReason = undefined
  current.selectedReason = undefined
  delete current.papers![item.recordId]
  delete current.answerChecked![item.recordId]
  if (pending.commentId) {
    delete current.paperLevels?.[pending.commentId]
    delete current.nativePaperVerdicts?.[pending.commentId]
  }
  await advanceReview(owner)
}

async function onReviewAnnotationClosed(owner: any, event: any, requestedAfterClose = false): Promise<void> {
  const current = state(owner), item = currentItem(owner)
  if (!current || !item || !isAnnotationMode(current) || event?.reviewToken !== current.annotationToken || event.noteid !== item.sourceNoteId) return
  current.annotationResumedExisting ||= event.reusedExisting === true
  current.annotationLastClose = event.identityUnconfirmed ? undefined : { reviewToken: event.reviewToken, saved: event.saved === true, commentId: event.commentId }
  current.annotationToken = undefined
  current.annotationPhase = "idle"
  const intent = current.annotationIntent, level = current.annotationPendingLevel
  current.annotationPendingLevel = undefined
  current.resultsVisible = false
  current.annotationIntent = undefined
  current.navigating = false
  if (event.saved && typeof event.commentId === "string") {
    current.papers![item.recordId] = event.commentId
    saveAttemptAnswerChecked(item.sourceNoteId, event.commentId, current.answerChecked?.[item.recordId] === true)
  }
  if (event.identityUnconfirmed) {
    current.annotationHistorySwitch = undefined
    current.pendingPaperLevel = undefined
    current.resultsVisible = false
    mountReviewViews(owner)
    showHUD('批注已关闭，本题已保留；请从历史作答选择批注继续反馈', 5)
    return
  }
  const historySwitch = current.annotationHistorySwitch
  if (historySwitch && historySwitch.reviewToken === event.reviewToken) {
    if (current.annotationResumedExisting) current.annotationHistorySwitch = undefined
    else {
      historySwitch.saved = event.saved === true
      historySwitch.commentId = event.commentId
      current.annotationPendingLevel = undefined
      current.pendingPaperLevel = undefined
      if (event.action === 'next' || event.action === 'finish' || intent?.kind === 'next') await continueHistorySwitch(owner, current)
      else mountReviewViews(owner)
      return
    }
  }
  if (current.pendingPaperLevel !== undefined && event.saved) {
    const wasSubmitting = current.submitting
    current.submitting = true
    try {
      await submitNativePaperFeedback(owner, current, current.pendingPaperLevel)
      if (state(owner) !== current) return
      savePaperFeedback(current, current.pendingPaperLevel)
      current.pendingPaperLevel = undefined
    } catch (error) {
      current.resultsVisible = true
      showHUD(`原生作答判定保存失败：${String((error as Error)?.message || error)}，请重试反馈`, 5)
      return
    } finally { current.submitting = wasSubmitting; if (state(owner) === current) mountReviewViews(owner) }
  }
  mountReviewViews(owner)
  const completed = event.action === "next" || event.action === "finish"
  if (intent && !completed && event.saved !== true && !requestedAfterClose) return
  if (intent?.kind === "exit") { onReviewModeExit(undefined, owner); return }
  if (intent?.kind === "goto") { await goTo(intent.index!, owner); return }
  if (completed || intent?.kind === "next") {
    // No new ink may produce saved=false; only a real comment ID can receive
    // the native verdict. The close event may race the opening reply.
    current.navigating = false
    if (current.purpose === "practice") {
      if (level !== undefined) {
        showAnnotationRating(owner, current)
        if (needsReviewFeedback(current)) await submitReviewResult(level, owner)
        else await markPracticeQuestion(level, owner, current)
        return
      }
      if (current.submitting) current.practiceAdvancePending = true
      else await completePracticeQuestion(owner, current)
      return
    }
    if (current.visitFeedbackSaved && level === undefined) { await advanceReview(owner); return }
    showAnnotationRating(owner, current)
    if (level !== undefined) await submitReviewResult(level, owner)
  }
}

async function completeReviewWriting(owner: any, current: ReviewModeState): Promise<void> {
  if (current.annotationPhase === 'uncertain') await openReviewAnnotation(owner, current)
  const token = current.annotationToken
  const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, { operation: 'writing-complete', reviewToken: token })
  if (state(owner) !== current || current.annotationToken !== token) return
  if (result?.state !== 'closed' || result.event?.saved !== true) throw new Error('手写笔迹保存和退出尚未确认')
  current.writingOpenToken = undefined
  await onReviewAnnotationClosed(owner, result.event, true)
}

function queueAnnotationAction(owner: any, current: ReviewModeState, intent: NonNullable<ReviewModeState['annotationIntent']>): void {
  if (current.navigating || current.submitting || annotationCommandBlocked(current) || !current.annotationToken) return
  if (intent.kind !== 'next') {
    current.annotationPendingLevel = undefined
    current.annotationHistorySwitch = undefined
  }
  current.annotationIntent = intent
  current.resultsVisible = intent.kind === 'next' && current.purpose !== 'practice' && !current.visitFeedbackSaved && !current.annotationHistorySwitch
  if (current.resultsVisible) { current.branch = undefined; if (!current.annotationHorizontal) current.expanded = false }
  mountReviewViews(owner, true)
  if (current.writingMode === 'handwriting' && intent.kind === 'next' && current.purpose !== 'practice' && !current.visitFeedbackSaved && current.annotationPendingLevel === undefined) return
  if (current.annotationChecking) return
  const token = current.annotationToken
  current.annotationChecking = true
  void (async () => {
    const stillCurrent = () => state(owner) === current && current.annotationToken === token
    try {
      const bridge = (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__
      if (current.writingMode === 'handwriting') { await completeReviewWriting(owner, current); return }
      const result = await bridge.openReviewAnnotation(owner, { operation: 'status', reviewToken: token })
      if (!stillCurrent()) return
      if (result?.state === 'closed' && result.event) { await onReviewAnnotationClosed(owner, result.event, true); return }
      if (current.annotationIntent !== intent) return
      const target = intent.kind === 'goto' ? `切换到第 ${intent.index! + 1} 题` : intent.kind === 'exit' ? '退出' : '切换下一题'
      if (intent.kind !== 'next' || current.annotationPendingLevel !== undefined || current.purpose === 'practice') {
        showHUD(intent.kind === "next" ? "请点批注窗口右上角“下一题”保存后继续" : `已选择${target}，请点批注窗口右上角“下一题”保存后继续`, 4)
      }
    } catch (error) {
      if (stillCurrent() && current.annotationIntent === intent) showHUD(`批注状态同步失败，操作已保留；窗口已关闭时可在等级区恢复：${String((error as Error)?.message || error)}`, 4)
    } finally {
      current.annotationChecking = false
      if (state(owner) === current) mountReviewViews(owner)
    }
  })()
}

function dismissUnselectedAnnotationFeedback(current: ReviewModeState): boolean {
  if (!current.resultsVisible || current.annotationPendingLevel !== undefined || current.submitting || current.navigating) return false
  current.resultsVisible = false
  if (current.annotationIntent?.kind === 'next') current.annotationIntent = undefined
  return true
}

function showAnnotationRating(owner: any, current: ReviewModeState): void {
  if (state(owner) !== current || current.submitting || current.navigating || annotationCommandBlocked(current)) return
  if (current.annotationHistorySwitch) { showHUD('请先保存或丢弃当前新批注，再进入历史作答', 4); return }
  current.resultsVisible = true
  current.branch = undefined
  if (!current.annotationHorizontal) current.expanded = false
  mountReviewViews(owner, true)
}

// Recovery is an explicit action in the inline grade area, never a normal
// next/previous/exit prerequisite. Missing a close receipt is normal while writing.
async function recoverAnnotationWindow(owner: any, current: ReviewModeState, stayOnQuestion = false): Promise<void> {
  if (current.writingMode === 'handwriting') {
    try { await completeReviewWriting(owner, current) }
    catch (error) { showHUD(`手写会话仍未保存，已保留本题：${String((error as Error)?.message || error)}`, 5) }
    return
  }
  if (current.annotationChecking || current.submitting || current.navigating) return
  const token = current.annotationToken
  if (!token) {
    current.resultsVisible = false
    try { await openReviewAnnotation(owner, current) }
    catch (error) { showHUD(`重新打开批注失败：${String((error as Error)?.message || error)}`, 4) }
    return
  }
  if (stayOnQuestion) { current.annotationIntent = undefined; current.annotationPendingLevel = undefined }
  const applyReceipt = (event: any) => onReviewAnnotationClosed(owner, stayOnQuestion ? { ...event, action: 'closed' } : event, true)
  current.annotationChecking = true
  const bridge = (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__
  const stillCurrent = () => state(owner) === current && current.annotationToken === token
  try {
    const result = await bridge.openReviewAnnotation(owner, { operation: 'status', reviewToken: token })
    if (!stillCurrent()) return
    if (result?.state === 'closed' && result.event) { await applyReceipt(result.event); return }
    const answer = await select(['仍在书写，等待保存', '批注窗口已关闭，继续'], '恢复批注状态', '仅在批注窗口已经关闭、操作仍未继续时确认恢复；仍在书写请先保存。', true)
    if (!stillCurrent() || answer.index !== 1) return
    const released = await bridge.openReviewAnnotation(owner, { operation: 'release', reviewToken: token })
    if (!stillCurrent()) return
    if (released?.state === 'closed' && released.event) { await applyReceipt(released.event); return }
    if (released?.state !== 'released') throw new Error('窗口状态同步未完成，请重试')
    const intent = current.annotationIntent, level = current.annotationPendingLevel
    current.annotationToken = undefined
    current.annotationPhase = 'idle'
    current.annotationIntent = undefined
    current.annotationPendingLevel = undefined
    if (stayOnQuestion) { current.resultsVisible = false; return }
    if (intent?.kind === 'exit') onReviewModeExit(undefined, owner)
    else if (intent?.kind === 'goto') await goTo(intent.index!, owner)
    else if (current.purpose === 'practice') {
      if (level !== undefined) {
        showAnnotationRating(owner, current)
        if (needsReviewFeedback(current)) await submitReviewResult(level, owner)
        else await markPracticeQuestion(level, owner, current)
      } else await completePracticeQuestion(owner, current)
    }
    else {
      showAnnotationRating(owner, current)
      if (level !== undefined) await submitReviewResult(level, owner)
    }
  } catch (error) {
    if (stillCurrent()) showHUD(`无法恢复批注窗口状态：${String((error as Error)?.message || error)}`, 4)
  } finally { current.annotationChecking = false; if (state(owner) === current) mountReviewViews(owner) }
}

export function onReviewModeWrite(): void {
  const current = state()
  if (!current || !isAnnotationMode(current) || current.submitting || current.navigating || annotationBusy(current)) return
  void goTo(current.index, self)
}

export function restoreReviewModeToolbar(): void {
  const current = state(self)
  if (!current) return
  current.suspended = false
  prepareReviewCompletionEffect(self, current.purpose !== 'practice' && loadMatcherSettings().reviewCompletionConfetti !== false)
  if (!self.cardLinkReviewEntranceHost) {
    openReviewQuickMenu(self)
  } else mountReviewViews(self)
}

export function suspendReviewModeToolbar(owner: any = self): void {
  disposeReviewCompletionEffect(owner)
  const current = state(owner)
  if (!current) return
  current.suspended = true
  removeReviewViews(owner)
  closeReviewQuickMenu(owner)
}

export function discardReviewMode(owner: any = self, keepCompletionEffect = false): void {
  owner.cardLinkReviewStarting = undefined
  if (!keepCompletionEffect) disposeReviewCompletionEffect(owner)
  owner.cardLinkHistoryClose?.()
  closeReviewQuickMenu(owner)
  owner.cardLinkReviewEntranceRender = undefined
  owner.cardLinkReviewDismissClassification = undefined
  owner.cardLinkReviewAnnotationClosed = undefined
  owner.cardLinkReviewExtraControls?.removeFromSuperview?.()
  // 正常退出：按题卡立即恢复插件改过的折叠状态，无法确认时记录并提示。
  stopSameMapPractice()
  owner.cardLinkReviewMode = undefined
  syncAnswerReviewControls()
  removeReviewViews(owner)
}

export function onReviewModePrevious(): void {
  const current = state()
  if (!current) return
  if (current.index <= 0) return showHUD("已经是第一题", 2)
  void goTo(current.index - 1, self)
}

export async function onReviewModeHistory(): Promise<void> {
  const owner = self, current = state(owner), item = currentItem(owner)
  if (!current || !item || current.navigating || current.submitting || current.reasonChoosing) return
  if (current.writingMode === 'handwriting') { showHUD('手写会话保存在宿主的专用笔迹层；此批注历史入口仅用于卡片批注', 4); return }
  try { await (await import('./practice-history')).openPracticeHistory(owner, item.sourceNoteId, item.sourceNotebookId, async (commentId, nativePaper) => {
    if (state(owner) !== current || currentItem(owner) !== item) throw new Error('题目已切换，请重新打开历史作答')
    if (current.writingMode === 'annotation') {
      if (nativePaper === false) throw new Error('这条是普通旧批注；当前批注模式只继续原生练习批注')
      if (current.navigating || current.submitting) throw new Error('正在保存或切换，请稍后选择历史作答')
      const waitingForFeedback = !current.visitFeedbackSaved && (current.annotationPhase === 'rating' || current.resultsVisible === true)
      if (annotationBusy(current) || waitingForFeedback || current.annotationContinuations?.some(task => task.recordId === item.recordId) ||
          (!current.annotationResumedExisting && !current.visitFeedbackSaved && current.annotationLastClose?.saved)) {
        if (current.annotationToken && current.papers?.[item.recordId] === commentId) {
          showHUD('当前已在续写这份批注', 3)
          return
        }
        const queue = current.annotationContinuations ||= []
        if (!queue.some(task => task.recordId === item.recordId && task.commentId === commentId)) queue.push({ recordId: item.recordId, commentId })
        if (!current.annotationResumedExisting && !current.visitFeedbackSaved) {
          const token = current.annotationToken || current.annotationLastClose?.reviewToken
          if (token) current.annotationHistorySwitch ||= { reviewToken: token, saved: current.annotationLastClose?.saved === true, commentId: current.annotationLastClose?.commentId }
        }
        if (current.annotationHistorySwitch) {
          current.resultsVisible = false
          current.annotationPendingLevel = undefined
          current.feedbackReason = undefined
          current.selectedReason = undefined
          mountReviewViews(owner)
          showHUD('已选择历史批注，点下一题关闭当前新批注；有内容时可选择保存并反馈或丢弃', 5)
          if (!current.annotationToken) await continueHistorySwitch(owner, current)
        } else showHUD(current.visitFeedbackSaved ? '已加入续写队列，点下一题继续' : '已加入下一步续写，当前作答保存并反馈后自动继续', 4)
        return
      }
    }
    if (annotationBusy(current) && !current.navigating && !current.submitting) await recoverAnnotationWindow(owner, current, true)
    if (state(owner) !== current || currentItem(owner) !== item) throw new Error('题目已切换，请重新打开历史作答')
    if (current.navigating || current.submitting || annotationBusy(current)) throw new Error('批注状态尚未确认，请保存当前批注或确认窗口已关闭后重试')
    current.resultsVisible = false
    await openReviewAnnotation(owner, current, commentId, nativePaper)
  }) }
  catch (error) { showHUD(`历史作答读取失败：${String((error as Error)?.message || error)}`, 4) }
}

export function onReviewModeMark(): void {
  const current = state()
  if (current?.purpose !== 'practice' || current.navigating || current.submitting || annotationCommandBlocked(current)) return
  if (current.annotationHistorySwitch) { showHUD('请先保存或丢弃当前新批注，再进入历史作答', 4); return }
  current.resultsVisible = !current.resultsVisible
  if (!current.annotationHorizontal) current.expanded = false
  current.branch = undefined
  mountReviewViews(self, true)
}

export function onReviewModeNext(): void {
  const current = state()
  const item = currentItem()
  if (current?.reasonChoosing) return
  if (current?.annotationHistoryReady && !current.submitting && !current.navigating && !annotationBusy(current)) { void advanceReview(self); return }
  if (current?.annotationHistorySwitch && !current.submitting && !current.navigating) {
    if (current.annotationToken) queueAnnotationAction(self, current, { kind: 'next' })
    else void continueHistorySwitch(self, current)
    return
  }
  if (current?.annotationHistoryFeedbackRequired) { showAnnotationRating(self, current); return }
  if (current?.visitFeedbackSaved && !current.submitting && !current.navigating && !annotationBusy(current)) {
    void advanceReview(self)
    return
  }
  if (current?.writingMode === 'handwriting' && current.navigationError) {
    showHUD(`手写会话未就绪：${current.navigationError}。请通过序号重新选择当前题目重试`, 5)
    return
  }
  if (current?.purpose === 'practice' && current.writingMode === 'mindmap') {
    void completePracticeQuestion(self, current)
    return
  }
  if (current?.purpose === 'practice') {
    if (current.submitting || current.navigating || annotationCommandBlocked(current)) return
    if (current.annotationToken) queueAnnotationAction(self, current, { kind: 'next' })
    else void completePracticeQuestion(self, current)
    return
  }
  // Collapse before the status-request guard: a slow receipt must not make an
  // unselected feedback list impossible to dismiss.
  if (current && dismissUnselectedAnnotationFeedback(current)) {
    current.branch = undefined
    if (!current.annotationHorizontal) current.expanded = false
    mountReviewViews(self, true)
    return
  }
  if (isAnnotationMode(current) && ["editing", "uncertain"].includes(current.annotationPhase || "")) {
    queueAnnotationAction(self, current, { kind: "next" }); return
  }
  if (!current || !item || current.navigating || current.submitting || annotationBusy(current)) return
  if (isAnnotationMode(current)) { void showAnnotationRating(self, current); return }
  const saved = current.algorithm === "fsrs" ? { lastReviewedAt: item.fsrsProgress?.card?.last_review } : loadMistakeState().records[item.recordId]
  if (reviewedToday(saved?.lastReviewedAt || item.lastReviewedAt)) { void advanceReview(self); return }
  current.resultsVisible = !current.resultsVisible
  current.branch = undefined
  mountReviewViews(self, true)
}

async function advanceReview(owner: any): Promise<void> {
  const current = state(owner)
  if (!current) return
  const queue = current.annotationContinuations, task = queue?.[0]
  if (current.writingMode === 'annotation' && task?.recordId === current.items[current.index].recordId) {
    if (current.navigating || current.submitting || annotationBusy(current)) return
    queue!.shift()
    const before = {
      visitFeedbackSaved: current.visitFeedbackSaved, feedbackReason: current.feedbackReason, selectedReason: current.selectedReason,
      papers: { ...current.papers }, paperLevels: { ...current.paperLevels }, nativePaperVerdicts: { ...current.nativePaperVerdicts },
      annotationResumedExisting: current.annotationResumedExisting, annotationHistoryReady: current.annotationHistoryReady
    }
    current.resultsVisible = false
    current.navigating = true
    let token: string | undefined
    try {
      const opening = openReviewAnnotation(owner, current, task.commentId, true)
      token = current.annotationToken
      await opening
      current.annotationHistoryReady = false
    } catch (error) {
      if (state(owner) !== current || current.annotationContinuations !== queue || current.items[current.index].recordId !== task.recordId || (current.annotationToken && current.annotationToken !== token)) return
      if ((error as any)?.editorMayBeOpen === false) {
        Object.assign(current, before)
        queue!.unshift(task)
        showHUD('续写打开失败，任务已保留；点下一题重试', 4)
      } else { current.annotationHistoryReady = false; showHUD('续写窗口状态未确认，请先确认当前批注的保存状态', 4) }
    } finally {
      if (state(owner) === current && current.annotationContinuations === queue && (!current.annotationToken || current.annotationToken === token)) {
        current.navigating = false
        mountReviewViews(owner)
      }
    }
    return
  }
  if (current.index < current.items.length - 1) await goTo(current.index + 1, owner)
  else {
    current.queueFinished = true
    onReviewModeExit(undefined, owner)
  }
}

export function goToPracticeQuestion(noteId: string, owner: any = self): Promise<boolean> {
  const current = state(owner)
  if (current?.purpose !== "practice") return Promise.resolve(false)
  const index = current.items.findIndex(item => item.sourceNoteId === noteId)
  return index < 0 ? Promise.resolve(false) : goTo(index, owner)
}

async function completePracticeQuestion(owner: any, current: ReviewModeState): Promise<void> {
  if (state(owner) !== current || current.navigating || current.submitting || annotationBusy(current)) return
  if (current.annotationHistorySwitch) { await continueHistorySwitch(owner, current); return }
  if (current.annotationHistoryFeedbackRequired) { showAnnotationRating(owner, current); return }
  if (!current.visitFeedbackSaved && current.feedbackReason?.recordId === current.items[current.index].recordId) {
    if (needsReviewFeedback(current)) await submitReviewResult(current.feedbackReason.level, owner)
    else await markPracticeQuestion(current.feedbackReason.level, owner, current)
    return
  }
  const paper = current.papers?.[current.items[current.index].recordId]
  if (current.writingMode === 'annotation' && !current.visitFeedbackSaved && paper && current.paperLevels?.[paper] === undefined) {
    current.submitting = true
    try {
      await submitNativePaperFeedback(owner, current, 2)
      if (state(owner) !== current) return
      saveAttemptAnswerChecked(current.items[current.index].sourceNoteId, paper, true)
      ;(current.answerChecked ||= {})[current.items[current.index].recordId] = true
      savePaperFeedback(current, 2)
    }
    catch (error) { showHUD(`默认“会了”保存失败，本题已保留：${String((error as Error)?.message || error)}`, 4); return }
    finally { current.submitting = false; if (state(owner) === current) mountReviewViews(owner) }
    if (state(owner) !== current) return
  }
  ;(current.completed ||= {})[current.items[current.index].recordId] = true
  if (!current.visitFeedbackSaved) saveSessionFeedback(current, current.writingMode === 'annotation' ? 2 : undefined)
  await advanceReview(owner)
}

export function onReviewModeExpand(): void {
  const current = state()
  if (!current) return
  if (!current.expanded) {
    const placement = self.cardLinkReviewEntrancePlacement?.()
    if (placement) current.annotationHorizontal = reviewToolbarHorizontal(placement.point.x, placement.point.y, placement.bounds.width, placement.bounds.height)
  }
  current.expanded = !current.expanded
  current.branch = undefined
  current.resultsVisible = false
  if (current.expanded && !current.annotationHorizontal) current.branch = 0
  mountReviewViews(self, true)
}

export function updateReviewToolbarOrientation(owner: any, point: { x: number; y: number }, bounds: { width: number; height: number }): void {
  const current = state(owner)
  if (!current) return
  const horizontal = reviewToolbarHorizontal(point.x, point.y, bounds.width, bounds.height, owner.mnutilsEntranceDragging ? !!current.annotationHorizontal : undefined)
  if (!!current.annotationHorizontal === horizontal) {
    const layout = toolbarLayout(current, owner), detail = annotationDetailLayout(current, owner)
    const source = owner.cardLinkReviewSource
    const widthChanged = current.expanded && Math.abs((owner.cardLinkReviewToolbar?.frame.width || 0) - layout.width) > 1
    if (widthChanged && horizontal && source?.cardLinkBranchButtons && !owner.cardLinkReviewDropdown) {
      // Reaching the right edge only changes the native scroll viewport. Avoid
      // rebuilding buttons, progress views, or breadcrumb contents while dragging.
      owner.cardLinkReviewToolbar.frame = { ...owner.cardLinkReviewToolbar.frame, width: layout.width }
      source.frame = { x: layout.sourceX, y: 0, width: layout.sourceWidth, height: layout.height }
      const exit = owner.cardLinkReviewAnnotationButtons?.[layout.buttons.length - 1]
      if (exit) exit.frame = layout.buttons[layout.buttons.length - 1]
      source.contentOffset = { x: Math.max(0, Math.min(Number(source.contentOffset?.x || 0), Math.max(0, source.contentSize.width - layout.sourceWidth))), y: 0 }
      owner.cardLinkReviewEntranceResize?.(layout.height, layout.width, { x: 0, y: 0 })
      owner.cardLinkReviewEntranceCommit?.(false)
      return
    }
    if (widthChanged ||
        (!horizontal && source && Math.abs(source.frame.x - detail.x) > 1)) mountReviewViews(owner, false)
    return
  }
  current.annotationHorizontal = horizontal
  mountReviewViews(owner, !owner.mnutilsEntranceDragging)
}

export function onReviewModeControlPress(sender: any): void {
  if (!sender?.enabled) return
  sender.backgroundColor = hoverBackground()
  sender.alpha = 0.72
}

export function onReviewModeControlRelease(sender: any): void {
  if (!sender) return
  sender.backgroundColor = controlBackground(sender)
  sender.alpha = sender.cardLinkReviewRestingAlpha ?? (sender.enabled ? 1 : 0.28)
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
  if (!current || current.navigating || current.submitting || annotationCommandBlocked(current)) return
  const completed = completedToday(current)
  const canEditFeedback = current.visitFeedbackSaved && !annotationCommandBlocked(current)
  const rows = current.items.map((item, index) => `${index + 1}. ${item.sourceTitle}${completed[index] ? " ✅" : ""}`)
  if (canEditFeedback) rows.push('查看／修改本题反馈')
  void select(
    rows,
    current.purpose === "practice" ? "选择做题题目" : "选择复习题目",
    `当前第 ${current.index + 1} 题，共 ${current.items.length} 题`,
    true
  ).then(result => {
    if (state(self) !== current) return
    if (canEditFeedback && result.index === current.items.length) { showAnnotationRating(self, current); return }
    if (result.index >= 0 && current.items[result.index]) return goTo(result.index, self)
  })
}

export function onReviewModeExit(_sender?: any, owner: any = self): void {
  owner.cardLinkReviewStarting = undefined
  const current = state(owner)
  if (isAnnotationMode(current) && ["editing", "uncertain"].includes(current.annotationPhase || "")) {
    queueAnnotationAction(owner, current, { kind: "exit" }); return
  }
  if (!current || current.submitting || (annotationBusy(current) && current.annotationPhase !== "uncertain")) return
  if (current.writingMode === 'handwriting' && !current.writingFinished) {
    current.submitting = true
    void (async () => {
      try {
        const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, { operation: 'writing-finish' })
        if (result?.finished !== true) throw new Error('宿主未确认手写会话结束')
        if (state(owner) !== current) return
        current.writingFinished = true
        current.submitting = false
        onReviewModeExit(undefined, owner)
      } catch (error) { showHUD(`结束手写会话失败，已保留本轮：${String((error as Error)?.message || error)}`, 5) }
      finally { current.submitting = false; if (state(owner) === current) mountReviewViews(owner) }
    })()
    return
  }
  const elapsedMinutes = Math.max(1, Math.ceil((Date.now() - current.startedAt) / 60000))
  const visited = Object.keys(current.visited).length
  const levels = ([0, 1, 2] as MistakeLevel[]).map(level =>
    current.items.filter(item => item.level === level).length)
  const celebrate = current.purpose !== 'practice' && current.queueFinished === true
  discardReviewMode(owner, celebrate)
  if (current.purpose === "practice") {
    void popup({ title: "本次做题结果", message: `队列 ${current.items.length} 道 · 已完成 ${completedToday(current).filter(Boolean).length} 道\n用时约 ${elapsedMinutes} 分钟`, buttons: ["完成"], canCancel: false, multiLine: true })
    return
  }
  const stopEffect = celebrate ? playReviewCompletionEffect(owner, loadMatcherSettings().reviewCompletionConfetti !== false) : () => {}
  void popup({
    title: "本次复习结果",
    message: current.algorithm === "fsrs" ? `智能复习 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n本日已复习 ${completedToday(current).filter(Boolean).length} 道；固定曲线进度保持不变。` : `队列 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n不会 ${levels[0]} · 不熟 ${levels[1]} · 掌握 ${levels[2]}`,
    buttons: ["完成"],
    canCancel: false,
    multiLine: true
  }).then(stopEffect, stopEffect)
}

export async function onReviewModeResult(sender: any): Promise<void> {
  const current = state()
  if (current?.purpose === 'practice' && !needsReviewFeedback(current)) return
  const item = currentItem()
  const level = Number(sender?.tag)
  if (!current || !item || isAnnotationMode(current) || current.navigating || current.submitting || !(current.algorithm === "fsrs" ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2]).includes(level) ||
    self.answerCardQuestionNoteId !== item.sourceNoteId || self.answerCardQuestionNotebookId !== item.sourceNotebookId) return
  if (!selectAnswerReviewLevel(level)) return
  await submitReviewResult(level, self)
}

export async function onReviewModeToolbarResult(sender: any, owner: any = self): Promise<void> {
  const current = state(owner), level = Number(sender?.tag)
  if (!current?.resultsVisible || current.submitting || current.navigating || current.reasonChoosing) return
  if (isAnnotationMode(current) && level === -2) { await recoverAnnotationWindow(owner, current); return }
  if (isAnnotationMode(current) && level === -1) return
  if (!(current.algorithm === 'fsrs' ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2]).includes(level)) return
  if (isAnnotationMode(current) && current.annotationToken && ['editing', 'uncertain'].includes(current.annotationPhase || '')) {
    if (!chooseReviewReason(owner, current, level)) return
    current.annotationPendingLevel = level
    current.annotationIntent = { kind: 'next' }
    mountReviewViews(owner, true)
    const token = current.annotationToken
    try {
      if (current.writingMode === 'handwriting') { await completeReviewWriting(owner, current); return }
      const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, { operation: 'status', reviewToken: token })
      if (state(owner) === current && current.annotationToken === token && result?.state === 'closed' && result.event) await onReviewAnnotationClosed(owner, result.event, true)
      else if (state(owner) === current && current.annotationToken === token) showHUD('已选择等级，请点批注窗口右上角“下一题”保存后继续', 5)
    } catch (error) {
      if (current.writingMode === 'handwriting') showHUD(`笔迹保存失败，反馈未提交：${String((error as Error)?.message || error)}`, 4)
      else console.log('CardLink 批注关闭回执暂未同步：' + String(error))
    }
    return
  }
  if (current.purpose === 'practice' && !needsReviewFeedback(current)) await markPracticeQuestion(level, owner, current)
  else await submitReviewResult(level, owner)
}

export function onReviewModeReason(sender: any): void {
  const current = state()
  if (!current?.resultsVisible || current.submitting || current.navigating || annotationCommandBlocked(current)) return
  const reason = inlineReasons(current)[Number(sender?.tag)]
  if (!reason) return
  current.selectedReason = current.selectedReason?.key === reason.key ? undefined : reason
  current.feedbackReason = current.annotationPendingLevel === undefined ? undefined : {
    recordId: current.items[current.index].recordId, level: current.annotationPendingLevel,
    reason: current.annotationPendingLevel <= 1 ? current.selectedReason : undefined
  }
  self.cardLinkReviewDetailKey = undefined
  mountReviewViews(self)
}

function chooseReviewReason(owner: any, current: ReviewModeState, level: number): boolean {
  const item = current.items[current.index]
  if (state(owner) !== current) return false
  current.visitFeedbackSaved = false
  current.feedbackReason = { recordId: item.recordId, level, reason: level === 0 || level === 1 ? current.selectedReason : undefined }
  return true
}

async function submitNativePaperFeedback(owner: any, current: ReviewModeState, level: number): Promise<void> {
  if (current.writingMode !== 'annotation' || (current.activeAnnotationVerdictMode ?? current.annotationVerdictMode) !== 'native') return
  const item = current.items[current.index], commentId = current.papers?.[item.recordId]
  if (!commentId) return
  const verdict = (current.algorithm === 'fsrs' ? level >= 2 : level === 2) ? 'got' : 'again'
  const reason = verdict === 'again' ? current.feedbackReason?.reason?.key : undefined
  const signature = JSON.stringify([verdict, reason || null])
  if (current.nativePaperVerdicts?.[commentId] === signature) return
  const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, {
    operation: 'practice-verdict', noteid: item.sourceNoteId, topicid: item.sourceNotebookId, commentId, self: verdict, reason
  })
  if (result?.persisted !== true) throw new Error('宿主未确认作答判定已保存')
  ;(current.nativePaperVerdicts ||= {})[commentId] = signature
}

function savePaperFeedback(current: ReviewModeState, level: number): void {
  if (current.writingMode !== 'annotation') return
  const item = current.items[current.index], commentId = current.papers?.[item.recordId]
  if (!commentId) return
  ;(current.paperLevels ||= {})[commentId] = level
}

async function markPracticeQuestion(level: number, owner: any, current: ReviewModeState): Promise<void> {
  if (![0, 1, 2].includes(level) || current.submitting || current.navigating || annotationCommandBlocked(current)) return
  const item = current.items[current.index], note = MN.db.getNoteById(item.sourceNoteId)
  if (!note) { showHUD('当前题卡已不存在', 3); return }
  current.submitting = true
  let feedbackSaved = false
  mountReviewViews(owner)
  try {
    if (!chooseReviewReason(owner, current, level)) return
    if (current.writingMode === 'handwriting' && current.annotationToken) await completeReviewWriting(owner, current)
    if (state(owner) !== current) return
    if (!current.annotationToken) await submitNativePaperFeedback(owner, current, level)
    if (state(owner) !== current) return
    const record = await markQuestionAsMistake(new NodeNote(note, item.sourceNotebookId), item.sourceNotebookId, level as MistakeLevel, current.feedbackReason?.reason)
    if (!record) return
    ;(current.completed ||= {})[item.recordId] = true
    if (current.writingMode === 'annotation') {
      current.pendingPaperLevel = level
      if (!current.annotationToken) {
        // The editor can close while the local mistake record is being saved.
        await submitNativePaperFeedback(owner, current, level)
        if (state(owner) !== current) return
        savePaperFeedback(current, level)
        current.pendingPaperLevel = undefined
      }
    }
    feedbackSaved = true
    saveSessionFeedback(current, level)
    if (current.writingMode === 'annotation' && current.annotationToken) showHUD('已选择等级，请点批注窗口右上角“下一题”保存后继续', 5)
    notifyWorkbenchDataChanged(owner)
    if (state(owner) !== current) return
    current.resultsVisible = false
  } catch (error) { current.resultsVisible = true; showHUD(`标记错题失败：${String((error as Error)?.message || error)}`, 4) }
  finally {
    current.submitting = false
    if (state(owner) === current) {
      if (!feedbackSaved) { current.practiceAdvancePending = false; mountReviewViews(owner); return }
      if (current.practiceAdvancePending) { current.practiceAdvancePending = false; await completePracticeQuestion(owner, current) }
      else if (!current.resultsVisible && !annotationBusy(current)) {
        if (current.annotationHistoryFeedbackRequired) { current.annotationHistoryFeedbackRequired = false; await advanceReview(owner) }
        else await completePracticeQuestion(owner, current)
      }
      else mountReviewViews(owner)
    }
  }
}

async function submitReviewResult(level: number, owner: any): Promise<void> {
  const current = state(owner), item = currentItem(owner)
  if (current?.purpose === "practice" && !needsReviewFeedback(current)) return
  if (!current || !item || current.submitting || current.navigating || annotationBusy(current) || !(current.algorithm === "fsrs" ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2]).includes(level)) return
  if (level === -1) { await advanceReview(owner); return }
  if (current.purpose === 'practice' && !existingMistake(current)) {
    await markPracticeQuestion(level, owner, current)
    return
  }
  current.submitting = true
  syncAnswerReviewControls()
  mountReviewViews(owner)
  try {
    if (!chooseReviewReason(owner, current, level)) return
    await submitNativePaperFeedback(owner, current, level)
    if (state(owner) !== current) return
    if (current.algorithm === "fsrs") {
      const service = await import("./fsrs-service")
      const reason = current.feedbackReason?.reason
      const builtIn = reason && DEFAULT_ERROR_REASONS.some(r => r.key === reason.key)
      const errorReasons = builtIn ? [reason!.key] : undefined
      const errorNote = reason && !builtIn ? `错因：${reason.label}` : undefined
      if (state(owner) !== current) return
      const progress = service.fsrsCommand("fsrsReview", { recordId: item.recordId, revision: item.fsrsProgress?.revision,
        eventId: `native-${item.recordId}-${item.fsrsProgress?.revision}-${level}`, rating: level + 1, errorReasons, errorNote }) as FsrsProgress
      item.fsrsProgress = progress
      item.preview = service.fsrsCommand("fsrsPreview", { recordId: item.recordId })
      item.lastReviewedAt = progress.card?.last_review
      item.reviewCount = progress.history.length
    } else {
      const record = await reviewMistakeById(existingMistake(current)?.recordId || item.recordId, level as MistakeLevel, current.feedbackReason?.reason)
      Object.assign(item, { level: record.level, reviewCount: record.reviewCount, history: record.history, lastReviewedAt: record.lastReviewedAt })
    }
    savePaperFeedback(current, level)
    saveSessionFeedback(current, level)
    if (current.purpose === 'practice') (current.completed ||= {})[item.recordId] = true
    // 通知发生在持久化成功之后；与会话是否仍然存在无关。
    notifyWorkbenchDataChanged(owner)
    if (state(owner) !== current) return
    mountReviewViews(owner)
    if (state(owner) !== current) return
    current.submitting = false
    current.annotationHistoryFeedbackRequired = false
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
