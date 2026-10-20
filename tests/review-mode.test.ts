import assert from "node:assert/strict"
import test from "node:test"
import { answerControlBarLayout } from "../src/window-controls"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import * as answerLayout from "../src/answer-card-layout"
import * as reviewQueue from "../src/review-queue"
import * as reviewVisual from "../src/answer-review-controls"
import { reviewMistake } from "../src/mistake-domain"
import { usesSubcardAnswers } from "../src/binding"

function harness(foreignSelf = false) {
  class View {
    frame: any; bounds: any; superview: any; backgroundColor: any; hidden = false; enabled = true
    titleLabel: any = {}; layer: any = {}; scrollView: any = {}; children: any[] = []; tag = 0
    constructor(frame: any = {}) { this.frame = frame; this.bounds = frame }
    addSubview(view: any) { view.superview = this; this.children.push(view) }
    removeFromSuperview() { this.superview = undefined }
    gestures: any[] = []
    addGestureRecognizer(gesture: any) { this.gestures.push(gesture) }
    removeGestureRecognizer() {}
    title = ""
    setTitleForState(title: string) { this.title = title }
    titleColor: any
    setTitleColorForState(color: any) { this.titleColor = color }
    addTargetActionForControlEvents(target: any, action: string) { calls.targets.push({target, action}) }
    html = ""
    scripts: string[] = []
    delegate: any
    loadHTMLStringBaseURL(html: string) { this.html = html; this.delegate?.webViewDidFinishLoad(this) }
    evaluateJavaScript(script: string, complete?: (result: string) => void) { this.scripts.push(script); complete?.(this.html ? "cardlink-control-ready" : "missing") }
  }
  const owner: any = {}
  const host = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const calls: any = { masks: [], writes: [], reports: [], closed: 0, stopped: 0, targets: [], timers: [], notifications: [] }
  let save: (id: string, level: number) => Promise<any> = async (_id, level) => ({ level, reviewCount: 1, history: [{ level, at: "today" }] })
  const color = { colorWithAlphaComponent(alpha: number) { return { alpha } } }
  const mn = { studyController: { view: host }, db: { getNoteById: (id: string) => ({ noteId: id, colorIndex: 1 }) } }
  const viewExports: any = {}
  const common: any = {
    __MNAM_SCENE_WORKBENCH_GLOBAL__: { notify(target: any, event: string) { calls.notifications.push({ target, event }); if (calls.sceneNotifyFails) throw new Error("scene unavailable") } },
    JSB: { defineClass: (_declaration: string, methods: any) => ({ new: () => ({ ...methods }) }) },
    UIAccessibility: { isReduceMotionEnabled: () => !!calls.reducedMotion },
    UIFont: { systemFontOfSize: (size: number) => size },
    MNUtil: { animate(update: () => void) { calls.animations = (calls.animations || 0) + 1; update(); return calls.deferAnimation ? new Promise<void>(resolve => calls.animationEnds.push(resolve)) : Promise.resolve() } },
    UIScrollView: View, self: foreignSelf ? { panelController: true } : owner, UIView: View, UIWebView: View, UILabel: View,
    UIButton: { buttonWithType: () => new View() }, UIPanGestureRecognizer: class { constructor(target: any, action: string) { calls.targets.push({target, action}) } }, UITapGestureRecognizer: class { constructor(target: any, action: string) { calls.targets.push({target, action}) } },
    UIColor: Object.fromEntries(["colorWithHexString", "whiteColor", "clearColor", "blackColor"].map(key => [key, (hex?: string) => ({ ...color, hex: hex || key, colorWithAlphaComponent(alpha: number) { return { hex: hex || key, alpha } } })])),
    NSTimer: { scheduledTimerWithTimeInterval(_interval: number, _repeat: boolean, callback: () => void) { calls.timers.push(callback) } }
  }
  function load(file: string, exports: any, modules: any) {
    runInNewContext(transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText,
      { ...common, exports, require: (name: string) => modules[name] ?? {} })
  }
  const colors = { UI_COLORS: { accent: "blue", level0: "red", level1: "orange", level2: "green" } }
  const surfaces: any = {}
  load("src/native-control-surface.ts", surfaces, {})
  const workbenchNotification: any = {}
  load("src/workbench-notification.ts", workbenchNotification, {})
  const windowControls: any = {}
  load("src/window-controls.ts", windowControls, { "./ui-tokens": { WINDOW_CONTROL_BACKGROUND_OPACITY: 0.96 } })
  load("src/answer-card-view.ts", viewExports, { marginnote: { MN: mn }, "./answer-review-controls": reviewVisual, "./answer-card-layout": answerLayout,
    "./window-controls": { ...windowControls, storedWindowControlSide: () => calls.side || "left" }, "./native-control-surface": surfaces })
  const api: any = {}
  load("src/review-mode.ts", api, {
    "./binding": { usesSubcardAnswers },
    "./review-queue": reviewQueue,
    "./native-control-surface": surfaces,
    "./workbench-notification": workbenchNotification,
    "./mistake-store": { loadMistakeState: () => ({ records: calls.records || {} }) },
    marginnote: { MN: mn, NodeNote: class { ancestorNodes = [] }, delay: async () => {}, select: async (rows: string[]) => { calls.selectedRows = rows; return { index: -1 } }, showHUD: (message: string) => { calls.hud = message }, popup: async (value: any) => calls.reports.push(value) },
    lucide: { ChevronLeft: [], ChevronRight: [], Info: [], LogOut: [] },
    "./ui-tokens": colors,
    "./mistake-domain": { LEVEL_DESCRIPTIONS: ["不会", "不熟", "掌握"] },
    "./mistake-manager": {
      openSourceByMistakeId: async () => ({}),
      reviewMistakeById: (id: string, level: number) => { calls.writes.push([id, level]); return save(id, level) }
    },
    "./note-navigation": { focusNoteInMindMapFocusMode: async () => "focused" },
    "./same-map-practice": {
      startSameMapPractice: async (...args: any[]) => { calls.masks.push(args); return { started: true } },
      stopSameMapPractice: () => calls.stopped++
    },
    "./answer-card-view": { ...viewExports, closeAnswerCard: () => { calls.closed++; viewExports.closeAnswerCard() } },
    "./store": { loadBindings: () => ({}), getBindingForMode: () => calls.binding },
    "./settings": { loadMatcherSettings: () => ({ allowSameStudySetMindMap: true, ...calls.settings }) },
    "./fsrs-service": { fsrsCommand: (_command: string, payload: any) => {
      if (_command === "fsrsPreview") return [1, 2, 3, 4].map(rating => ({ rating, days: rating * 2 }))
      calls.fsrsWrites = [...(calls.fsrsWrites || []), payload]
      return { revision: 1, history: [{ id: payload.eventId, rating: payload.rating }], card: { last_review: new Date().toISOString() } }
    } }
  })
  const items = ["a", "b"].map(id => ({ recordId: id, sourceNoteId: id, sourceNotebookId: "book", sourceRootNodeId: "root", level: 0, reviewCount: 0 }))
  function answer(id: string) {
    owner.answerCardView ??= new View({ x: 0, y: 0, width: 600, height: 400 })
    if (!owner.answerCardView.superview) host.addSubview(owner.answerCardView)
    owner.answerCardView.hidden = false
    owner.answerCardQuestionNoteId = id
    owner.answerCardQuestionNotebookId = "book"
    viewExports.syncAnswerReviewControls()
  }
  return { api, owner, calls, items, answer, viewExports, windowControls, View, setSave: (fn: typeof save) => { save = fn } }
}

test("FSRS 原生答案窗口四档反馈仅写智能进度；切回固定模式恢复三档", async () => {
  const h = harness()
  h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: "fsrs" }
  const items = h.items.map(item => ({ ...item, fsrsProgress: { revision: 0, history: [] } }))
  await h.api.startReviewMode(items, h.owner, "fsrs")
  h.answer("a")
  assert.equal(h.owner.answerCardReviewButtons.length, 4)
  assert.match(h.owner.answerCardReviewControls.html, /良好/)
  await h.api.onReviewModeResult({ tag: 3 })
  await h.api.onReviewModeResult({ tag: 3 })
  assert.equal(h.calls.fsrsWrites.length, 1)
  assert.equal(h.calls.fsrsWrites[0].rating, 4)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  h.api.discardReviewMode()
  h.calls.settings = { debugModeEnabled: false, debugReviewAlgorithm: "fsrs" }
  await h.api.startReviewMode(h.items, h.owner)
  h.answer("a")
  assert.equal(h.owner.answerCardReviewButtons.length, 3)
})

test("复习当前子卡题自动遮盖；横条拖动位置跨题保留，结果写入后才切题", async () => {
  const h = harness()
  h.calls.binding = { designatedAnswer: "subcard", questionColors: [1] }
  await h.api.startReviewMode(h.items, h.owner)
  assert.equal(h.calls.masks[0][1][0], "a")
  assert.equal(h.calls.masks[0][2].alreadyFocused, true)
  const frame = h.owner.cardLinkReviewToolbar.frame
  h.api.onReviewModePan({ state: 1, locationInView: () => ({ x: frame.x + 5, y: frame.y + 5 }) })
  h.api.onReviewModePan({ state: 3, locationInView: () => ({ x: 105, y: 205 }) })
  h.answer("a")
  assert.equal(h.owner.answerCardReviewControls.frame.y, -4)
  assert.equal(h.owner.answerCardReviewControls.frame.x, 600 - 6 - 132 - 10)
  assert.equal(h.owner.answerCardReviewControls.hidden, false)
  assert.equal(h.owner.answerCardReviewButtons.length, 3)
  await h.api.onReviewModeResult({ tag: 1 })
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.owner.answerReviewExpanded, true)
  await h.api.onReviewModeResult({ tag: 1 })
  assert.deepEqual(h.calls.writes, [["a", 1]])
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.items[0].reviewCount, 1)
  assert.equal(h.owner.cardLinkReviewToolbar.frame.x, 100)
  assert.equal(h.owner.cardLinkReviewToolbar.frame.y, 200)
  assert.equal(h.calls.masks[1][1][0], "b")
  h.answer("b")
  await h.api.onReviewModeResult({ tag: 2 })
  await h.api.onReviewModeResult({ tag: 2 })
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
  assert.match(h.calls.reports[0].message, /不熟 1 · 掌握 1/)
  assert.equal(h.owner.answerCardReviewControls.hidden, true)
})

test("不匹配的答案不可评价；保存失败保留当前题；重复点击仅写一次", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  assert.equal(h.calls.masks.length, 0)
  h.answer("other")
  assert.equal(h.owner.answerCardReviewControls.hidden, true)
  await h.api.onReviewModeResult({ tag: 0 })
  assert.equal(h.calls.writes.length, 0)
  h.answer("a")
  let reject!: (reason: Error) => void
  h.setSave(() => new Promise((_resolve, fail) => { reject = fail }))
  await h.api.onReviewModeResult({ tag: 0 })
  const pending = h.api.onReviewModeResult({ tag: 0 })
  assert.equal(h.owner.answerCardReviewButtons[0].enabled, false)
  await h.api.onReviewModeResult({ tag: 2 })
  h.api.onReviewModeNext()
  assert.equal(h.calls.writes.length, 1)
  reject(new Error("write failed"))
  await pending
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.answerCardReviewButtons[0].enabled, true)
  assert.match(h.calls.hud, /保存失败/)
})

test("顶部胶囊整组展开，外部收起；选择任一等级即提交，关闭或换题重置", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.answer("a")
  assert.equal(h.owner.answerCardReviewToggleButton.hidden, false)
  assert.ok(h.owner.answerCardReviewButtons.every((b: any) => b.hidden))
  await h.api.onReviewModeResult({ tag: -1 })
  assert.ok(h.owner.answerCardReviewButtons.every((b: any) => !b.hidden && b.enabled))
  assert.equal(h.calls.writes.length, 0)
  const frame = h.owner.answerCardReviewButtons[2].frame
  h.viewExports.onAnswerReviewOutsideTap({ locationInView: () => ({ x: frame.x + 1, y: frame.y + 1 }) })
  assert.equal(h.owner.answerReviewExpanded, true)
  h.viewExports.onAnswerReviewOutsideTap({ locationInView: () => ({ x: 20, y: 120 }) })
  assert.equal(h.owner.answerReviewExpanded, false)
  await h.api.onReviewModeResult({ tag: -1 })
  h.viewExports.closeAnswerCard()
  assert.equal(h.owner.answerReviewExpanded, false)
  assert.equal(h.owner.answerReviewDismissTap, undefined)
  h.answer("a")
  await h.api.onReviewModeResult({ tag: -1 })
  await h.api.onReviewModeResult({ tag: 2 })
  assert.deepEqual(h.calls.writes, [["a", 2]])
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  h.answer("b")
  assert.equal(h.owner.answerReviewExpanded, false)
  h.owner.answerCardView.frame.width = 320
  h.viewExports.syncAnswerReviewControls()
  assert.equal(h.owner.answerCardReviewControls.frame.x, 320 - 6 - 132 - 10)
  assert.equal(h.owner.answerCardReviewControls.frame.y, -4)
  h.owner.answerCardView.frame.width = 280
  h.owner.answerCandidatesButton = { hidden: false }
  for (const side of ["left", "right"]) {
    h.calls.side = side
    h.owner.answerReviewExpanded = true
    h.viewExports.syncAnswerReviewControls()
    const drawing = h.owner.answerCardReviewControls.frame
    const capsule = { x: drawing.x + 10, y: drawing.y + 10, width: drawing.width - 20, height: drawing.height - 20 }
    const bar = answerControlBarLayout(280, side as "left" | "right", true).bar
    assert.equal(capsule.y, bar.y)
    assert.equal(capsule.height, bar.height)
    assert.equal(capsule.width, 84)
    assert.ok(capsule.x >= 0 && capsule.x + capsule.width <= 280)
    assert.ok(capsule.x >= bar.x + bar.width + 8 || capsule.x + capsule.width <= bar.x - 8)
    assert.equal(side === "left" ? 280 - capsule.x - capsule.width : capsule.x, 6)
    assert.equal(h.owner.answerCardReviewButtons[2].frame.x + h.owner.answerCardReviewButtons[2].frame.width, capsule.x + capsule.width)
  }
})

test("胶囊展开收起不缩放绘制视口，点击面保持相反侧上角；视窗图标透明", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.answer("a")
  const closing = new h.View({ x: 6, y: 6, width: 132, height: 36 })
  h.windowControls.styleWindowControlCapsule(closing)
  assert.equal(closing.backgroundColor.alpha, 0.96)
  assert.equal(closing.layer.cornerRadius, 18)
  for (const side of ["left", "right"]) {
    h.calls.side = side
    for (const expanded of [false, true]) {
      h.owner.answerReviewExpanded = expanded
      h.viewExports.syncAnswerReviewControls()
      const frame = h.owner.answerCardReviewControls.frame
      assert.equal(frame.width, 152)
      assert.equal(frame.height, 56)
      assert.equal(side === "left" ? 600 - frame.x - frame.width + 10 : frame.x + 10, 6)
      const hit = expanded ? h.owner.answerCardReviewButtons[side === "left" ? 2 : 0].frame : h.owner.answerCardReviewToggleButton.frame
      assert.equal(side === "left" ? 600 - hit.x - hit.width : hit.x, 6)
      if (!expanded) assert.equal(hit.width, 64)
    }
  }
  const icon = h.windowControls.createWindowControlIcon()
  assert.equal(icon.userInteractionEnabled, false)
  assert.equal(icon.children.length, 4)
  assert.equal(icon.backgroundColor.hex, icon.children[0].backgroundColor.hex)
  assert.ok(icon.children.every((child: any) => child.userInteractionEnabled === false))
  assert.equal(icon.children[0].layer.borderWidth, 1.35)
})

test("评分 WebView 内部白底被清除，正文视图保持原背景", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.answer("a")
  const visual = h.owner.answerCardReviewControls
  const content = { opaque: true, backgroundColor: "white" }
  visual.subviews = [{ opaque: true, backgroundColor: "white", subviews: [content] }]
  visual.scrollView.opaque = true
  visual.scrollView.backgroundColor = "white"
  h.owner.answerCardView.backgroundColor = "answer-background"
  h.viewExports.syncAnswerReviewControls()
  assert.equal(content.opaque, false)
  assert.notEqual(content.backgroundColor, "white")
  assert.equal(visual.scrollView.opaque, false)
  assert.notEqual(visual.scrollView.backgroundColor, "white")
  assert.equal(h.owner.answerCardView.backgroundColor, "answer-background")
})


test("菜单面板上下文不会成为答案窗口按钮或手势的原生目标，定时器保留真实插件实例", () => {
  const h = harness(true)
  h.viewExports.showAnswerCard('<p>answer</p>', h.owner)
  assert.ok(h.owner.answerCardView)
  assert.ok(h.calls.targets.some((entry: any) => entry.action === 'onAnswerCardPan:'))
  assert.ok(h.calls.targets.some((entry: any) => entry.action === 'onAnswerCardResize:'))
  assert.ok(h.calls.targets.some((entry: any) => entry.action === 'onCloseAnswerCard:'))
  assert.ok(h.calls.targets.every((entry: any) => entry.target === h.owner))
  let fronts = 0
  h.owner.answerCardView.superview.bringSubviewToFront = () => fronts++
  assert.equal(h.calls.timers.length, 1)
  h.calls.timers[0]()
  assert.equal(fronts, 1)
})

test("下一题展开四种结果，跳过不写复习记录；末题仍可评分退出", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeNext()
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].children.filter((v: any) => v.tag === -1).length, 1)
  await h.api.onReviewModeToolbarResult({ tag: -1 })
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.writes.length, 0)
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: 2 })
  assert.deepEqual(h.calls.writes, [["b", 2]])
  assert.equal(h.owner.cardLinkReviewMode, undefined)
})

test("今日完成直接下一题，展开来源宽度受窗口限制且可按节点选择", async () => {
  const h = harness()
  h.calls.records = { a: { lastReviewedAt: new Date().toISOString() } }
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeExpand()
  assert.ok(h.owner.cardLinkReviewToolbar.frame.width > 180)
  assert.ok(h.owner.cardLinkReviewToolbar.frame.width <= 1008)
  h.api.onReviewModeNext()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.writes.length, 0)
  h.api.onReviewModeBranch({ tag: 0 })
  h.api.onReviewModeQueuePick({ tag: 0 })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
})

test("悬浮条保存失败不推进，并发点击只写一次", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeNext()
  let reject!: (error: Error) => void
  h.setSave(() => new Promise((_resolve, fail) => { reject = fail }))
  const first = h.api.onReviewModeToolbarResult({ tag: 0 })
  await h.api.onReviewModeToolbarResult({ tag: 2 })
  reject(new Error('failed'))
  await first
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.calls.notifications.length, 0)
})

test("悬浮条等级保存后通知原宿主面板，刷新读到新历史和复习计划；跳过不通知", async () => {
  const h = harness()
  const initial: any = {
    ...h.items[0], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    nextReviewAt: "2026-01-02T00:00:00.000Z", history: [{ at: "2026-01-01T00:00:00.000Z", level: 0 }]
  }
  h.calls.records = { a: initial }
  const snapshots: any[] = []
  h.owner.webController = { webView: { evaluateJavaScript(script: string, complete: () => void) {
    runInNewContext(script, { window: { __onNativeDataChanged() {
      snapshots.push(JSON.parse(JSON.stringify(h.calls.records.a)))
      assert.equal(h.owner.cardLinkReviewMode.index, 0, "先刷新再切题")
    } } })
    complete()
  } } }
  let finish!: () => void
  h.setSave((id, level) => new Promise(resolve => { finish = () => {
    const record = reviewMistake(h.calls.records[id], level as 0 | 1 | 2, new Date("2026-10-19T04:00:00.000Z"))
    h.calls.records[id] = record
    resolve(record)
  } }))
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeNext()
  const pending = h.api.onReviewModeToolbarResult({ tag: 1 })
  await h.api.onReviewModeToolbarResult({ tag: 2 })
  assert.equal(snapshots.length, 0)
  assert.equal(h.calls.notifications.length, 0)
  finish(); await pending
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].history.length, 2)
  assert.equal(snapshots[0].history[1].level, 1)
  assert.equal(snapshots[0].lastReviewedAt, "2026-10-19T04:00:00.000Z")
  assert.ok(Date.parse(snapshots[0].nextReviewAt) > Date.parse("2026-10-20T00:00:00.000Z"))
  assert.equal(h.calls.notifications.length, 1)
  assert.equal(h.calls.notifications[0].target, h.owner)
  assert.equal(h.calls.notifications[0].event, "nativeDataChanged")
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: -1 })
  assert.equal(snapshots.length, 1)
  assert.equal(h.calls.notifications.length, 1)
})

test("答案胶囊保存后同样通知面板；场景通知失败不阻断经典面板与切题", async () => {
  const h = harness()
  h.calls.sceneNotifyFails = true
  let refreshed = 0
  h.owner.webController = { webView: { evaluateJavaScript(script: string) {
    runInNewContext(script, { window: { __onNativeDataChanged() { refreshed++ } } })
  } } }
  await h.api.startReviewMode(h.items, h.owner)
  h.answer("a")
  await h.api.onReviewModeResult({ tag: -1 })
  await h.api.onReviewModeResult({ tag: 2 })
  assert.equal(refreshed, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.hud, undefined)
})

test("面板脚本暂不可用不影响成功保存或切题，数据仍然提交", async () => {
  const h = harness()
  h.owner.webController = { webView: { evaluateJavaScript() { throw new Error("webview unavailable") } } }
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: 0 })
  assert.deepEqual(h.calls.writes, [["a", 0]])
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.hud, undefined)
})


test("左侧整组操作区可拖动，来源滚动区不继承拖动识别器", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeExpand()
  const bar = h.owner.cardLinkReviewToolbar
  const controls = h.owner.cardLinkReviewIndexButton.superview
  assert.equal(controls.frame.width, 180)
  assert.equal(controls.frame.height, 40)
  assert.equal(controls.gestures.length, 1)
  assert.equal(h.owner.cardLinkReviewIndexButton.gestures.length, 0)
  assert.equal(bar.gestures.length, 0)
  const source = bar.children.find((view: any) => view.frame.x === 180)
  assert.ok(source)
  assert.equal(source.superview, bar)
  assert.equal(source.gestures.length, 0)
  const frame = bar.frame
  h.api.onReviewModePan({ state: 1, locationInView: () => ({ x: frame.x + 150, y: frame.y + 15 }) })
  h.api.onReviewModePan({ state: 3, locationInView: () => ({ x: 250, y: 215 }) })
  assert.equal(bar.frame.x, 100)
  assert.equal(bar.frame.y, 200)
})


test("来源紧凑递进、删除详情入口；开合动画结束不误删新下拉", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  assert.equal(h.calls.targets.some((entry: any) => entry.action === "onReviewModeInfo:"), false)
  h.owner.cardLinkReviewMode.items[0].sourceNotebookTitle = "学习集"
  h.owner.cardLinkReviewMode.items[0].sourceRootTitle = "脑图"
  h.api.onReviewModeExpand()
  const source = h.owner.cardLinkReviewSource
  assert.ok(source.children.some((view: any) => view.text === "›"))
  assert.ok(source.contentSize.width < 200)
  const expandedWidth = h.owner.cardLinkReviewToolbar.frame.width
  h.calls.deferAnimation = true
  h.calls.animationEnds = []
  h.api.onReviewModeBranch({ tag: 0 })
  const old = h.owner.cardLinkReviewDropdown
  h.api.onReviewModeBranch({ tag: 0 })
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
  assert.equal(old.alpha, 0)
  h.api.onReviewModeBranch({ tag: 1 })
  const latest = h.owner.cardLinkReviewDropdown
  h.calls.animationEnds.forEach((end: () => void) => end())
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!old.superview)
  assert.ok(latest.superview)
  assert.equal(latest.alpha, 1)
  h.api.onReviewModeExpand()
  assert.ok(h.owner.cardLinkReviewToolbar.frame.width < expandedWidth)
  assert.ok(h.calls.animations >= 5)
})

test("减少动态效果时直接完成布局，不启动原生动画", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.calls.reducedMotion = true
  h.api.onReviewModeExpand()
  h.api.onReviewModeNext()
  assert.ok(h.owner.cardLinkReviewToolbar.frame.width > 180)
  assert.ok(h.owner.cardLinkReviewDropdown.frame.height > 1)
  assert.equal(h.calls.animations || 0, 0)
})


test("下拉跟随具体来源、横向滚动及拖动位置，宽度按文字内容决定", async () => {
  const h = harness()
  Object.assign(h.items[0], { sourceTitle: "短题" })
  Object.assign(h.items[1], { sourceTitle: "另一题" })
  await h.api.startReviewMode(h.items, h.owner)
  h.api.onReviewModeExpand()
  h.owner.cardLinkReviewSource.contentOffset = { x: 12, y: 0 }
  h.api.onReviewModeBranch({ tag: 1 })
  const toolbar = h.owner.cardLinkReviewToolbar
  const source = h.owner.cardLinkReviewSource
  const button = source.children.find((v: any) => v.title === "主脑图")
  assert.equal(h.owner.cardLinkReviewDropdown.frame.x, toolbar.frame.x + 180 + button.frame.x - 12)
  assert.ok(h.owner.cardLinkReviewDropdown.frame.width < 130)
  h.api.onReviewModeNext()
  assert.equal(h.owner.cardLinkReviewDropdown.frame.width, 64)
  assert.equal(h.owner.cardLinkReviewDropdown.frame.x, h.owner.cardLinkReviewToolbar.frame.x + 75)
  h.api.onReviewModePan({state:1,locationInView:()=>({x:toolbar.frame.x+10,y:toolbar.frame.y+10})})
  h.api.onReviewModePan({state:3,locationInView:()=>({x:110,y:210})})
  assert.equal(h.owner.cardLinkReviewDropdown.frame.x, 175)
  assert.equal(h.owner.cardLinkReviewToolbar.backgroundColor.hex, "whiteColor")
})

test("今日反馈驱动进度、序号列表勾选和来源颜色；当前蓝色优先", async () => {
  const h = harness()
  h.calls.records = { a: { lastReviewedAt: new Date().toISOString() }, b: { lastReviewedAt: new Date().toISOString() } }
  await h.api.startReviewMode(h.items, h.owner)
  const svg = h.owner.cardLinkReviewSvgView
  assert.ok(svg.html.includes('class="progress-value"'))
  assert.ok(svg.scripts.at(-1).includes('"progress":1'))
  h.api.onReviewModeIndex()
  assert.ok(h.calls.selectedRows.every((row: string) => row.endsWith(' ✅')))
  h.api.onReviewModeExpand()
  h.api.onReviewModeBranch({tag:0})
  const rows = h.owner.cardLinkReviewDropdown.children[0].children.filter((v: any) => v.title)
  assert.equal(rows[0].backgroundColor.hex, "blue")
  assert.equal(rows[0].backgroundColor.alpha, 0.2)
  assert.equal(rows[0].titleColor.hex, "#172033")
  assert.equal(rows[1].backgroundColor.hex, "green")
  assert.equal(rows[1].titleColor.hex, "#172033")
  h.api.onReviewModeControlPress(rows[0])
  h.api.onReviewModeControlRelease(rows[0])
  assert.equal(rows[0].backgroundColor.hex, "blue")
  h.calls.records.b.lastReviewedAt = new Date(Date.now() - 86400000).toISOString()
  h.api.restoreReviewModeToolbar()
  assert.ok(svg.scripts.at(-1).includes('"progress":0.5'))
  h.api.onReviewModeIndex()
  assert.ok(!h.calls.selectedRows[1].endsWith(' ✅'))
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].children.filter((v: any) => v.title)[1].titleColor.hex, "#172033")
})
