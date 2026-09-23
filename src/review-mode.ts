import { delay, MN, popup, select, showHUD } from "marginnote"
import { ChevronLeft, ChevronRight, Info, LogOut, type IconNode } from "lucide"
import { LEVEL_DESCRIPTIONS, MistakeLevel } from "./mistake-domain"
import { openSourceByMistakeId } from "./mistake-manager"
import { focusNoteInMindMapFocusMode } from "./note-navigation"
import { UI_COLORS } from "./ui-tokens"

export interface ReviewModeItem {
  recordId: string
  sourceNoteId: string
  sourceNotebookId: string
  sourceRootNodeId?: string
  sourceTitle: string
  sourceNotebookTitle: string
  sourceRootTitle?: string
  sourcePathTitles?: string[]
  level: MistakeLevel
  reviewCount: number
  history?: Array<{ at: string; level: MistakeLevel }>
}

interface ReviewModeState {
  items: ReviewModeItem[]
  index: number
  startedAt: number
  visited: Record<string, true>
  navigating: boolean
  infoVisible: boolean
  focusedNotebookId?: string
  focusedRootNodeId?: string
}

const BAR_HEIGHT = 44
const BAR_TOP_INSET = 10 + BAR_HEIGHT
const CONTROL_HEIGHT = 32
const BAR_WIDTH = 190
const INFO_WIDTH = 294
const INFO_HEIGHT = 118
const CONTROL_GAP = 3
const CONTROL_INSET = 5
const INK = "#172033"
const MUTED = "#a9b1bf"
const HOVER = "#787880"
const ACTIVE = "#e8f4ff"
// E:\project\just glass 的 static-shell 回退材质：真实 WebGL 折射只能处理
// WebView 自己的场景，原生脑图上层采用同项目定义的静态玻璃参数。
const GLASS_BACKGROUND = "#f3f8ff"
const GLASS_SHADOW = "#1e3c63"
const GLASS_BOTTOM_RIM = "#49688e"

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

function reviewToolbarSvgHtml(current: ReviewModeState): string {
  const previousDisabled = current.navigating || current.index === 0
  const nextDisabled = current.navigating || current.index === current.items.length - 1
  const infoActive = current.infoVisible
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
*{box-sizing:border-box}html,body{margin:0;width:190px;height:44px;overflow:hidden;background:transparent!important;-webkit-user-select:none}
.slot{position:absolute;top:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;pointer-events:none}
.index{left:5px;width:38px}.number{color:${INK};font:600 18px/20px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;font-variant-numeric:tabular-nums;text-align:center}
.glyph,.glyph svg{display:block;width:20px;height:20px;color:${INK}}
.previous{left:46px}.next{left:81px}.info{left:116px}.exit{left:151px}
.disabled{opacity:.28}.active .glyph{color:${UI_COLORS.accent}}
</style></head><body>
<div class="slot index"><span id="index" class="number">${current.index + 1}</span></div>
<div id="previous" class="slot previous${previousDisabled ? " disabled" : ""}"><span class="glyph">${lucideSvg(ChevronLeft)}</span></div>
<div id="next" class="slot next${nextDisabled ? " disabled" : ""}"><span class="glyph">${lucideSvg(ChevronRight)}</span></div>
<div id="info" class="slot info${infoActive ? " active" : ""}"><span class="glyph">${lucideSvg(Info)}</span></div>
<div class="slot exit"><span class="glyph">${lucideSvg(LogOut)}</span></div>
<script>window.setReviewToolbarState=function(s){document.getElementById('index').textContent=String(s.index);document.getElementById('previous').className='slot previous'+(s.previousDisabled?' disabled':'');document.getElementById('next').className='slot next'+(s.nextDisabled?' disabled':'');document.getElementById('info').className='slot info'+(s.infoActive?' active':'')}</script>
</body></html>`
}

function configureReviewSvgSurface(webView: UIWebView): void {
  const bridged = webView as any
  bridged.opaque = false
  bridged.backgroundColor = UIColor.clearColor()
  // UIWebView 自身透明仍不足以清除 UIScrollView 的默认白底。两层必须同时
  // 透明，否则 SVG 绘制层会以 190×44 的白色矩形盖住原生玻璃胶囊。
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

function reviewToolbarSvgView(owner: any, current: ReviewModeState): UIWebView | undefined {
  let webView = owner?.cardLinkReviewSvgView as UIWebView | undefined
  if (!webView) {
    webView = new UIWebView({ x: 0, y: 0, width: BAR_WIDTH, height: BAR_HEIGHT })
    configureReviewSvgSurface(webView)
    ;(webView as any).loadHTMLStringBaseURL(reviewToolbarSvgHtml(current), null)
    owner.cardLinkReviewSvgView = webView
    return webView
  }
  // 跨题重挂载时重新声明透明合成属性，防止 UIWebView 装载完成后恢复默认白底。
  configureReviewSvgSurface(webView)
  const payload = JSON.stringify({
    index: current.index + 1,
    previousDisabled: current.navigating || current.index === 0,
    nextDisabled: current.navigating || current.index === current.items.length - 1,
    infoActive: current.infoVisible
  })
  try {
    ;(webView as any).evaluateJavaScript(`window.setReviewToolbarState&&window.setReviewToolbarState(${payload})`, () => {})
  } catch { /* initial HTML already carries a complete state */ }
  return webView
}

function controlBackground(owner: any, button: any): any {
  const current = state(owner)
  return button === owner?.cardLinkReviewInfoButton && current?.infoVisible
    ? UIColor.colorWithHexString(ACTIVE)
    : UIColor.clearColor()
}

function hoverBackground(): any {
  return UIColor.colorWithHexString(HOVER).colorWithAlphaComponent(0.14)
}

function applyJustGlassStaticShell(view: any, width: number, height: number, radius: number): void {
  view.backgroundColor = UIColor.colorWithHexString(GLASS_BACKGROUND).colorWithAlphaComponent(0.74)
  view.layer.cornerRadius = radius
  view.layer.masksToBounds = false
  view.layer.borderWidth = 1
  view.layer.borderColor = UIColor.whiteColor().colorWithAlphaComponent(0.72)
  view.layer.shadowColor = UIColor.colorWithHexString(GLASS_SHADOW)
  view.layer.shadowOffset = { width: 0, height: 4 }
  view.layer.shadowRadius = 12
  view.layer.shadowOpacity = 0.1

  // 对应 Just Glass static-shell 的两条 inset rim；使用普通 UIView，保持 JSB 官方边界。
  const topRim = new UIView({ x: radius, y: 1, width: Math.max(0, width - radius * 2), height: 1 })
  topRim.backgroundColor = UIColor.whiteColor().colorWithAlphaComponent(0.95)
  ;(topRim as any).userInteractionEnabled = false
  view.addSubview(topRim)
  const bottomRim = new UIView({ x: radius, y: height - 2, width: Math.max(0, width - radius * 2), height: 1 })
  bottomRim.backgroundColor = UIColor.colorWithHexString(GLASS_BOTTOM_RIM).colorWithAlphaComponent(0.09)
  ;(bottomRim as any).userInteractionEnabled = false
  view.addSubview(bottomRim)
}

function makeButton(owner: any, title: string, action: string, width: number): UIButton {
  const button = UIButton.buttonWithType(0)
  button.frame = { x: 0, y: 0, width, height: CONTROL_HEIGHT }
  // 五个控件的可见内容全部由同一个 WebView 绘制，避免原生标题被绘制层遮挡，
  // 同时保证序号与四枚 SVG 使用同一坐标系。UIButton 只承接交互与无障碍。
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

function removeReviewViews(owner: any = self): void {
  try { owner?.cardLinkReviewToolbar?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  try { owner?.cardLinkReviewInfo?.removeFromSuperview?.() } catch { /* bridge-safe */ }
  if (!owner) return
  owner.cardLinkReviewToolbar = undefined
  owner.cardLinkReviewInfo = undefined
  owner.cardLinkReviewIndexButton = undefined
  owner.cardLinkReviewInfoButton = undefined
}

function currentItem(owner: any = self): ReviewModeItem | undefined {
  const current = state(owner)
  return current?.items[current.index]
}

function lastResult(item: ReviewModeItem): string {
  const last = item.history?.[item.history.length - 1]
  return last ? LEVEL_DESCRIPTIONS[last.level] : "暂无"
}

function infoLines(item: ReviewModeItem): string[] {
  const source = [item.sourceNotebookTitle, item.sourceRootTitle, ...(item.sourcePathTitles || [])]
    .filter(Boolean).join(" › ")
  return [
    `标题：${item.sourceTitle}`,
    `来源：${source || "未记录"}`,
    `等级状态：${LEVEL_DESCRIPTIONS[item.level]}    第 ${item.reviewCount + 1} 次复测`,
    `上次复测结果：${lastResult(item)}`
  ]
}

function mountReviewViews(owner: any = self): void {
  const current = state(owner)
  const item = currentItem(owner)
  const studyView = MN.studyController?.view
  if (!current || !item || !studyView) return
  removeReviewViews(owner)
  const studyWidth = Number(studyView.frame?.width)
  if (!Number.isFinite(studyWidth) || studyWidth <= 0) return
  const x = Math.max(8, (studyWidth - BAR_WIDTH) / 2)
  // MarginNote 自带顶栏占用脑图区顶部；在原 10pt 留白基础上再避让一个
  // 完整复习工具条高度，防止原生顶栏覆盖复习控件。
  const toolbar = new UIView({ x, y: BAR_TOP_INSET, width: BAR_WIDTH, height: BAR_HEIGHT })
  applyJustGlassStaticShell(toolbar, BAR_WIDTH, BAR_HEIGHT, 22)
  const specs: Array<[string, string, number]> = [
    [`第 ${current.index + 1} 题`, "onReviewModeIndex:", 38],
    ["上一题", "onReviewModePrevious:", 32],
    ["下一题", "onReviewModeNext:", 32],
    ["错题信息", "onReviewModeInfo:", 32],
    ["退出", "onReviewModeExit:", 32]
  ]
  let left = CONTROL_INSET
  specs.forEach(([title, action, width], index) => {
    const button = makeButton(owner, title, action, width)
    button.frame = { x: left, y: 6, width, height: CONTROL_HEIGHT }
    button.enabled = !current.navigating &&
      !(index === 1 && current.index === 0) &&
      !(index === 2 && current.index === current.items.length - 1)
    ;(button as any).alpha = button.enabled ? 1 : 0.28
    if (!button.enabled) (button as any).tintColor = UIColor.colorWithHexString(MUTED)
    if (index === 3 && current.infoVisible) {
      button.backgroundColor = UIColor.colorWithHexString(ACTIVE)
      button.setTitleColorForState(UIColor.colorWithHexString(UI_COLORS.accent), 0)
      ;(button as any).tintColor = UIColor.colorWithHexString(UI_COLORS.accent)
    }
    toolbar.addSubview(button)
    if (index === 0) owner.cardLinkReviewIndexButton = button
    if (index === 3) owner.cardLinkReviewInfoButton = button
    left += width + CONTROL_GAP
  })
  // SVG WebView 只负责矢量绘制并关闭全部交互；它置于按钮上方，触摸仍由下层
  // 原生 UIButton 接收，因而保留原生 hover/按压/无障碍行为而不需要 WebView bridge。
  const svgView = reviewToolbarSvgView(owner, current)
  if (svgView) toolbar.addSubview(svgView)
  studyView.addSubview(toolbar)
  owner.cardLinkReviewToolbar = toolbar
  if (current.infoVisible) {
    const infoX = Math.max(8, (studyWidth - INFO_WIDTH) / 2)
    const infoFrame = { x: infoX, y: BAR_TOP_INSET + BAR_HEIGHT + 5, width: INFO_WIDTH, height: INFO_HEIGHT }
    const info = new UIView(infoFrame)
    applyJustGlassStaticShell(info, INFO_WIDTH, INFO_HEIGHT, 18)
    // IPS 5CC99F68 显示无 frame 构造会在 _UILabelLayer setBounds 触发 SIGABRT。
    // 一次性传入全部有限尺寸，禁止先 new UILabel() 再补 frame。
    const Label = UILabel as any
    infoLines(item).forEach((text, index) => {
      const label = new Label({ x: 14, y: 8 + index * 24, width: INFO_WIDTH - 28, height: 22 })
      label.text = text
      label.numberOfLines = 1
      // NSLineBreakByTruncatingTail；来源过长时只截断本行，不挤占后续状态行。
      label.lineBreakMode = 4
      label.textColor = UIColor.colorWithHexString("#172033")
      info.addSubview(label)
    })
    studyView.addSubview(info)
    owner.cardLinkReviewInfo = info
  }
}

async function focusQueueItem(owner: any, item: ReviewModeItem): Promise<void> {
  const current = state(owner)
  const target = MN.db.getNoteById(item.sourceNoteId)
  if (!target) {
    showHUD("该题目卡片已不存在", 2)
    return
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
      return
    }
  } else {
    // 跨学习集/跨脑图必须把焦点模式意图交给定位状态机。该意图会随 pending
    // 记录由 notebookWillOpen 接力，在新学习集的 controller 上执行，不能复用
    // 切换前捕获的 notebookController。
    const result = await openSourceByMistakeId(item.recordId, { enterFocusMode: true })
    if (result.locateHint) {
      showHUD(result.locateHint, 3)
      return
    }
  }
  if (current) {
    current.focusedNotebookId = item.sourceNotebookId
    current.focusedRootNodeId = item.sourceRootNodeId
  }
  owner.cardLinkReviewLastFocus = MN.db.getNoteById(item.sourceNoteId) ?? target
}

async function goTo(index: number, owner: any = self): Promise<void> {
  const current = state(owner)
  if (!current || current.navigating || !current.items.length) return
  const target = Math.max(0, Math.min(current.items.length - 1, index))
  current.index = target
  current.navigating = true
  const item = current.items[target]
  current.visited[item.recordId] = true
  mountReviewViews(owner)
  try {
    await focusQueueItem(owner, item)
    await delay(0.12)
  } catch (error) {
    showHUD(`切换题目失败：${String((error as Error)?.message || error)}`, 2)
  } finally {
    const latest = state(owner)
    if (latest) latest.navigating = false
    mountReviewViews(owner)
  }
}

export async function startReviewMode(itemsValue: unknown, owner: any = self): Promise<{ started: boolean; count: number }> {
  const items = Array.isArray(itemsValue)
    ? itemsValue.filter(item => item && typeof item.recordId === "string" && item.recordId) as ReviewModeItem[]
    : []
  if (!items.length) return { started: false, count: 0 }
  removeReviewViews(owner)
  owner.cardLinkReviewMode = {
    items,
    index: 0,
    startedAt: Date.now(),
    visited: {},
    navigating: false,
    infoVisible: false
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
  self.cardLinkReviewMode = undefined
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
  if (!current) return
  if (current.index >= current.items.length - 1) return showHUD("已经是最后一题", 2)
  void goTo(current.index + 1, self)
}

export function onReviewModeInfo(): void {
  const current = state()
  if (!current) return
  current.infoVisible = !current.infoVisible
  mountReviewViews(self)
}

export function onReviewModeControlPress(sender: any): void {
  if (!sender?.enabled) return
  sender.backgroundColor = hoverBackground()
  sender.alpha = 0.72
}

export function onReviewModeControlRelease(sender: any): void {
  if (!sender) return
  sender.backgroundColor = controlBackground(self, sender)
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
  button.backgroundColor = controlBackground(self, button)
  button.alpha = 1
}

export function onReviewModeIndex(): void {
  const current = state()
  if (!current) return
  void select(
    current.items.map((item, index) => `${index + 1}. ${item.sourceTitle}`),
    "选择复习题目",
    `当前第 ${current.index + 1} 题，共 ${current.items.length} 题`,
    true
  ).then(result => {
    if (result.index >= 0) return goTo(result.index, self)
  })
}

export function onReviewModeExit(): void {
  const current = state()
  if (!current) return
  const elapsedMinutes = Math.max(1, Math.ceil((Date.now() - current.startedAt) / 60000))
  const visited = Object.keys(current.visited).length
  const levels = ([0, 1, 2] as MistakeLevel[]).map(level =>
    current.items.filter(item => item.level === level).length)
  self.cardLinkReviewMode = undefined
  removeReviewViews(self)
  void popup({
    title: "本次复习结果",
    message: `队列 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n不会 ${levels[0]} · 不熟 ${levels[1]} · 掌握 ${levels[2]}`,
    buttons: ["完成"],
    canCancel: false,
    multiLine: true
  })
}
