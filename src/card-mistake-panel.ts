import { delay } from 'marginnote'
import { createWindowSurface, setWindowSurfaceOpacity } from './window-opacity'
import { DEFAULT_ERROR_REASONS, type ErrorReason } from './error-reasons'
import { UI_COLORS } from './ui-tokens'
import type { MistakeLevel } from './mistake-domain'

export interface CardMistakeFeedback { level: MistakeLevel; reason?: ErrorReason }
type Rect = { x: number; y: number; width: number; height: number }
interface Panel {
  view?: UIView
  outside: UIButton[]
  host: any
  card: Rect
  scroll?: UIScrollView
  reasonArea?: UIView
  expanded: boolean
  level?: MistakeLevel
  savedLevel?: MistakeLevel
  savedHint?: string
  reviewHint(level: MistakeLevel): string
  reason?: ErrorReason
  busy: boolean
  closeRequested: boolean
  error?: string
  layoutKey?: string
  levels: UIButton[]
  reasons: UIButton[]
  skip?: UIButton
  close?: UIButton
  status?: UILabel
  submit(feedback: CardMistakeFeedback): Promise<void>
  resolve(result: { cancelled?: boolean }): void
}

export function cardMistakePanelFrame(card: Rect, bounds: { width: number; height: number }, height = 152): Rect {
  const gap = 8, width = Math.max(1, Math.min(192, bounds.width - gap * 2))
  height = Math.max(1, Math.min(height, bounds.height - gap * 2))
  const right = card.x + card.width + gap, left = card.x - width - gap
  const x = right + width <= bounds.width - gap ? right : left
  return { x: Math.max(gap, Math.min(x, bounds.width - width - gap)),
    y: Math.max(gap, Math.min(card.y, bounds.height - height - gap)), width, height }
}

function label(parent: UIView, text: string, frame: Rect, size = 12): UILabel {
  const view = new (UILabel as any)(frame)
  view.text = text
  view.font = UIFont.systemFontOfSize(size)
  view.textColor = UIColor.colorWithHexString('#55565a')
  view.numberOfLines = 1
  view.lineBreakMode = 4
  parent.addSubview(view)
  return view
}

function button(owner: any, parent: UIView | undefined, title: string, selector: string, frame: Rect): UIButton {
  const view = UIButton.buttonWithType(0)
  view.frame = frame
  view.setTitleForState(title, 0)
  view.titleLabel.font = UIFont.systemFontOfSize(13)
  view.layer.cornerRadius = 8
  view.addTargetActionForControlEvents(owner, selector, 1 << 6)
  parent?.addSubview(view)
  return view
}

function layout(panel: Panel, animate: boolean): void {
  if (!panel.view || !panel.scroll) return
  const contentHeight = panel.expanded ? 260 : 96
  const errorHeight = panel.error ? 76 : 0
  const frame = cardMistakePanelFrame(panel.card, panel.host.bounds, contentHeight + 56 + errorHeight)
  const layoutKey = JSON.stringify([frame, panel.expanded, !!panel.error, panel.host.bounds.width, panel.host.bounds.height])
  if (panel.layoutKey === layoutKey) return
  panel.layoutKey = layoutKey
  const width = frame.width, cell = (width - 32) / 2
  const update = () => {
    panel.view!.frame = frame
    panel.scroll!.frame = { x: 0, y: 44, width, height: Math.max(1, frame.height - 56) }
    panel.scroll!.contentSize = { width, height: contentHeight + errorHeight }
    panel.levels[0].frame = { x: 12, y: 0, width: cell, height: 44 }
    panel.levels[1].frame = { x: 20 + cell, y: 0, width: cell, height: 44 }
    panel.levels[2].frame = { x: 12, y: panel.expanded ? 216 : 52, width: width - 24, height: 44 }
    panel.reasonArea!.hidden = !panel.expanded
    panel.reasonArea!.frame = { x: 12, y: 52, width: width - 24, height: 156 }
    panel.status!.hidden = !panel.error
    panel.status!.frame = { x: 12, y: contentHeight + 4, width: width - 24, height: 72 }
    const bounds = panel.host.bounds
    const outside = [
      { x: 0, y: 0, width: bounds.width, height: frame.y },
      { x: 0, y: frame.y + frame.height, width: bounds.width, height: Math.max(0, bounds.height - frame.y - frame.height) },
      { x: 0, y: frame.y, width: frame.x, height: frame.height },
      { x: frame.x + width, y: frame.y, width: Math.max(0, bounds.width - frame.x - width), height: frame.height }
    ]
    panel.outside.forEach((view, index) => { view.frame = outside[index] })
  }
  const accessibility = (globalThis as any).UIAccessibility
  const reduced = accessibility?.isReduceMotionEnabled === true ||
    (typeof accessibility?.isReduceMotionEnabled === 'function' && accessibility.isReduceMotionEnabled())
  if (animate && !reduced && typeof MNUtil !== 'undefined' && typeof MNUtil.animate === 'function') {
    void Promise.resolve(MNUtil.animate(update, .18)).catch(update)
  } else update()
}

function render(panel: Panel, animate = false): void {
  const colors = [UI_COLORS.level0, UI_COLORS.level1, UI_COLORS.level2]
  panel.levels.forEach((view, index) => {
    const selected = panel.level === index
    view.enabled = !panel.busy
    view.backgroundColor = UIColor.colorWithHexString(selected ? colors[index] : panel.level === undefined ? ['#fde3e2', '#f8eddd', '#dff3e7'][index] : '#e9ebef')
    view.setTitleColorForState(selected ? UIColor.whiteColor() : UIColor.colorWithHexString(panel.level === undefined ? colors[index] : '#73767d'), 0)
    const hint = selected && panel.savedLevel === index && panel.savedHint !== undefined ? panel.savedHint : panel.reviewHint(index as MistakeLevel)
    view.titleLabel.font = UIFont.systemFontOfSize(hint.length > 5 ? 11 : 12)
    view.setTitleForState(`${['不会', '不熟', '掌握'][index]} ${hint}`, 0)
  })
  panel.reasons.forEach((view, index) => {
    const selected = panel.reason?.key === DEFAULT_ERROR_REASONS[index].key
    view.enabled = !panel.busy && panel.expanded && panel.savedLevel === panel.level
    view.backgroundColor = UIColor.colorWithHexString(selected ? colors[panel.level ?? 0] : '#e9ebef')
    view.setTitleColorForState(selected ? UIColor.whiteColor() : UIColor.colorWithHexString('#55565a'), 0)
  })
  if (panel.skip) panel.skip.enabled = !panel.busy && panel.savedLevel === panel.level
  if (panel.close) panel.close.enabled = !panel.busy
  if (panel.status) panel.status.text = panel.error || ''
  layout(panel, animate)
}

export function closeCardMistakePanel(owner: any = self, result?: { cancelled?: boolean }): void {
  const panel = owner.cardMistakePanel as Panel | undefined
  owner.cardMistakePanel = undefined
  if (!panel) return
  ;(panel.view as any)?.removeFromSuperview()
  panel.outside.forEach(view => (view as any).removeFromSuperview())
  panel.resolve(result ?? (panel.savedLevel === undefined ? { cancelled: true } : {}))
}

export async function showCardMistakePanel(owner: any, host: any, card: Rect, _title: string,
  currentLevel: MistakeLevel | undefined, submit: Panel['submit'], reviewHint: Panel['reviewHint']): Promise<{ cancelled?: boolean }> {
  closeCardMistakePanel(owner)
  let resolve!: Panel['resolve']
  const result = new Promise<{ cancelled?: boolean }>(done => { resolve = done })
  const panel: Panel = { host, card, level: currentLevel, expanded: false, busy: false, closeRequested: false,
    levels: [], reasons: [], outside: [], submit, reviewHint, resolve }
  owner.cardMistakePanel = panel
  // Leave the WebView delegate callback before mounting native controls.
  await delay(.08)
  if (owner.cardMistakePanel !== panel) return result
  try {
    const frame = cardMistakePanelFrame(card, host.bounds)
    panel.outside = Array.from({ length: 4 }, () => {
      const outside = button(owner, undefined, '', 'onCardMistakePanelOutsideTap:', { x: 0, y: 0, width: 0, height: 0 })
      outside.backgroundColor = UIColor.clearColor()
      ;(outside.layer as any).zPosition = 110002
      return outside
    })
    const view = panel.view = createWindowSurface(frame)
    setWindowSurfaceOpacity(view, 1)
    view.backgroundColor = UIColor.colorWithHexString(UI_COLORS.surface)
    view.layer.cornerRadius = 10
    view.layer.masksToBounds = true
    ;(view.layer as any).zPosition = 110002
    label(view, '标记错题', { x: 12, y: 8, width: frame.width - 66, height: 28 }, 15)
    panel.close = button(owner, view, '关闭', 'onCardMistakePanelClose:', { x: frame.width - 54, y: 8, width: 42, height: 28 })
    panel.close.setTitleColorForState(UIColor.colorWithHexString('#73767d'), 0)
    const scroll = panel.scroll = new UIScrollView({ x: 0, y: 44, width: frame.width, height: 96 })
    scroll.backgroundColor = UIColor.clearColor()
    scroll.bounces = false
    view.addSubview(scroll)
    panel.levels = ['不会', '不熟', '掌握'].map(name => button(owner, scroll, name, 'onCardMistakePanelLevel:', frame))
    const reasonArea = panel.reasonArea = new UIView({ x: 12, y: 52, width: frame.width - 24, height: 156 })
    reasonArea.backgroundColor = UIColor.colorWithHexString('#f0f1f4')
    reasonArea.layer.cornerRadius = 8
    scroll.addSubview(reasonArea)
    label(reasonArea, '选择错因', { x: 8, y: 2, width: frame.width - 96, height: 22 })
    panel.skip = button(owner, reasonArea, '跳过', 'onCardMistakePanelSkip:', { x: frame.width - 76, y: 0, width: 44, height: 24 })
    panel.skip.setTitleColorForState(UIColor.colorWithHexString('#73767d'), 0)
    const reasonWidth = (frame.width - 48) / 2
    panel.reasons = DEFAULT_ERROR_REASONS.map((reason, index) => button(owner, reasonArea, reason.label, 'onCardMistakePanelReason:',
      { x: 8 + index % 2 * (reasonWidth + 8), y: 28 + Math.floor(index / 2) * 44, width: reasonWidth, height: 36 }))
    panel.status = label(scroll, '', frame, 11)
    panel.status.numberOfLines = 0
    render(panel)
    panel.outside.forEach(outside => host.addSubview(outside))
    host.addSubview(view)
    host.bringSubviewToFront(view)
  } catch (error) {
    closeCardMistakePanel(owner)
    throw error
  }
  return result
}

async function saveFeedback(owner: any, panel: Panel, feedback: CardMistakeFeedback, animate = false): Promise<void> {
  const hint = panel.reviewHint(feedback.level)
  panel.busy = true
  panel.error = undefined
  render(panel, animate)
  try {
    await panel.submit(feedback)
    panel.savedLevel = feedback.level
    if (!feedback.reason) panel.savedHint = hint
    if (owner.cardMistakePanel !== panel) return
    if (feedback.reason || feedback.level === 2 || panel.closeRequested) closeCardMistakePanel(owner, {})
  } catch (error) {
    if (owner.cardMistakePanel !== panel) return
    panel.closeRequested = false
    panel.error = `${error instanceof Error ? error.message : String(error)}；点选当前${feedback.reason ? '错因' : '等级'}重试`
  } finally {
    panel.busy = false
    if (owner.cardMistakePanel === panel) render(panel)
  }
}

export async function onCardMistakePanelLevel(sender: UIButton): Promise<void> {
  const owner = self, panel = owner.cardMistakePanel as Panel | undefined
  if (!panel || panel.busy) return
  const index = panel.levels.indexOf(sender)
  if (index < 0) return
  if (panel.level === index && panel.savedLevel === index && !panel.error) return
  const expanded = index !== 2
  const animate = panel.expanded !== expanded
  panel.level = index as MistakeLevel
  panel.savedHint = undefined
  panel.reason = undefined
  panel.expanded = expanded
  panel.error = undefined
  await saveFeedback(owner, panel, { level: panel.level }, animate)
}

export async function onCardMistakePanelReason(sender: UIButton): Promise<void> {
  const owner = self, panel = owner.cardMistakePanel as Panel | undefined
  if (!panel || panel.busy || !panel.expanded || panel.level === undefined || panel.savedLevel !== panel.level) return
  const index = panel.reasons.indexOf(sender)
  if (index < 0) return
  panel.reason = { ...DEFAULT_ERROR_REASONS[index] }
  await saveFeedback(owner, panel, { level: panel.level, reason: panel.reason })
}

export function onCardMistakePanelSkip(sender: UIButton): void {
  const panel = self.cardMistakePanel as Panel | undefined
  if (!panel || panel.busy || panel.skip !== sender || panel.savedLevel === undefined || panel.savedLevel !== panel.level) return
  closeCardMistakePanel(self, {})
}

export function onCardMistakePanelOutsideTap(sender: UIButton): void {
  const panel = self.cardMistakePanel as Panel | undefined
  if (!panel || !panel.outside.includes(sender)) return
  if (panel.busy) { panel.closeRequested = true; return }
  if (panel.level !== panel.savedLevel && panel.error) return
  closeCardMistakePanel(self)
}

export function onCardMistakePanelClose(sender: UIButton): void {
  const panel = self.cardMistakePanel as Panel | undefined
  if (!panel || panel.busy || panel.close !== sender) return
  closeCardMistakePanel(self)
}
