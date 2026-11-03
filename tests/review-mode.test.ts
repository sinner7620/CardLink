import { windowOpacityFixture } from "./window-opacity-fixture"
import assert from "node:assert/strict"
import test from "node:test"
import { answerControlBarLayout } from "../src/window-controls"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import * as toolbarLayout from "../src/review-toolbar-layout"
import * as answerLayout from "../src/answer-card-layout"
import * as reviewQueue from "../src/review-queue"
import * as reviewVisual from "../src/answer-review-controls"
import { reviewMistake, reviewResultHint } from "../src/mistake-domain"
import { usesSubcardAnswers } from "../src/binding"
import * as lucide from "lucide"

test('拖动就近边缘决定方向，横向分类向右追加且所有主控位置固定、窄窗不越界', () => {
  for (const [x, y, horizontal] of [[500, 20, true], [500, 740, true], [20, 380, false], [1000, 380, false]] as const)
    assert.equal(toolbarLayout.reviewToolbarHorizontal(x, y, 1024, 768), horizontal)
  for (const width of [180, 320, 1024]) {
    const closed = toolbarLayout.reviewToolbarLayout(true, false, 240, { width, height: 768 })
    const open = toolbarLayout.reviewToolbarLayout(true, true, 240, { width, height: 768 })
    assert.ok(open.width <= width)
    assert.deepEqual(open.buttons.slice(0, -1), closed.buttons.slice(0, -1))
    assert.equal(open.buttons[open.buttons.length - 1].x, open.sourceX + open.sourceWidth)
    assert.equal(open.sourceX, Math.floor(closed.mainWidth - closed.cell))
    for (const button of open.buttons) assert.ok(button.x + button.width <= width)
  }
})

function harness(foreignSelf = false) {
  class View {
    frame: any; bounds: any; superview: any; backgroundColor: any; hidden = false; enabled = true
    titleLabel: any = {}; layer: any = { sublayers: [], addSublayer(layer: any) { this.sublayers.push(layer) } }; scrollView: any = {}; children: any[] = []; tag = 0
    constructor(frame: any = {}) { this.frame = frame; this.bounds = frame }
    addSubview(view: any) { view.superview = this; this.children.push(view) }
    bringSubviewToFront(view: any) { (calls.fronts ||= []).push({ host: this, view }) }
    removeFromSuperview() { this.superview = undefined; this.removals++ }
    removals = 0
    gestures: any[] = []
    addGestureRecognizer(gesture: any) { this.gestures.push(gesture) }
    removeGestureRecognizer() {}
    title = ""
    setTitleForState(title: string) { this.title = title }
    image: any
    setImageForState(image: any) { this.image = image }
    titleColor: any
    setTitleColorForState(color: any) { this.titleColor = color }
    addTargetActionForControlEvents(target: any, action: string) { calls.targets.push({target, action, button: this}) }
    html = ""
    scripts: string[] = []
    delegate: any
    loads = 0
    completionStates: boolean[] = []
    completionScope: any
    loadHTMLStringBaseURL(html: string) {
      this.loads++; this.html = html
      if (html.includes('<canvas id="review-completion-confetti"')) {
        ;(calls.completionViews ||= []).push(this)
        this.completionScope = {
          window: {}, document: { getElementById: (id: string) => id === 'review-completion-confetti' ? {} : null },
          recordCompletion: (active: boolean) => this.completionStates.push(active)
        }
        runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)![1], this.completionScope)
      }
      if (!calls.deferSurfaceLoad) this.delegate?.webViewDidFinishLoad(this)
    }
    evaluateJavaScript(script: string, complete?: (result: string) => void) {
      this.scripts.push(script)
      const result = this.completionScope ? runInNewContext(script, this.completionScope) : this.html ? 'cardlink-control-ready' : 'missing'
      if (this.completionScope && calls.deferCompletionAck && complete) {
        ;(calls.completionAcks ||= []).push(() => complete(result))
      } else complete?.(result)
    }
  }
  const owner: any = {}
  const host = new View({ x: 0, y: 0, width: 1024, height: 768 })
  owner.window = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const calls: any = { practiceAvailable: true, masks: [], writes: [], reports: [], closed: 0, stopped: 0, targets: [], timers: [], timerHandles: [], notifications: [] }
  let save: (id: string, level: number) => Promise<any> = async (_id, level) => ({ level, reviewCount: 1, history: [{ level, at: "today" }] })
  const color = { colorWithAlphaComponent(alpha: number) { return { alpha } } }
  const mn = { studyController: { view: host }, db: { getNotebookById: () => ({ title: '学习集' }), getNoteById: (id: string) => ({ noteId: id, noteTitle: id, colorIndex: 1 }) } }
  const viewExports: any = {}
  const common: any = {
    __MNAM_SCENE_WORKBENCH_GLOBAL__: {
      enabled: () => true,
      openReviewAnnotation: async (_owner: any, target: any) => {
        if (target.operation) (calls.operations ||= []).push(target.operation)
        if (target.operation === 'practice-history') return { comments: calls.savedPapers || [] }
        if (target.operation === 'writing-config') return { available: calls.writingAvailable !== false, reason: 'host not ready' }
        if (target.operation === 'writing-open') { (calls.writingAnnotations ||= []).push(target); return { editorOpened: true } }
        if (target.operation === 'writing-complete') {
          calls.writingCompletions = (calls.writingCompletions || 0) + 1
          if (calls.writingSaveError) throw new Error('snapshot not current')
          return { state: 'closed', event: { ...calls.writingAnnotations.at(-1), saved: true, action: 'closed' } }
        }
        if (target.operation === 'writing-finish') { calls.writingFinishes = (calls.writingFinishes || 0) + 1; return { finished: !calls.writingFinishError } }

        if (target.operation === 'practice-config') { if (calls.configWait) await calls.configWait; if (calls.configError) throw new Error('config failed'); return calls.practiceAvailable && !calls.practiceUnavailable ? { reasons: calls.practiceReasons || [] } : { available: false } }
        if (target.operation === 'practice-verdict') {
          (calls.verdicts ||= []).push(target)
          if (calls.verdictError) throw new Error('verdict failed')
          return { persisted: true }
        }
        if (target.operation === 'practice-discard') {
          (calls.discards ||= []).push(target)
          if (calls.discardError) throw new Error('delete failed')
          return { discarded: true, commentId: target.commentId }
        }
        if (target.operation === 'status' || target.operation === 'release') {
          (calls.statusRequests ||= []).push(target)
          if (calls.statusError) throw calls.statusError
          if (calls.statusReply) return calls.statusReply
          return calls.closedReceipt ? { state: 'closed', event: calls.closedReceipt } : { state: target.operation === 'release' ? 'released' : 'unknown' }
        }
        if (target.operation === 'advance') {
          (calls.advances ||= []).push(target)
          if (calls.advanceError) throw calls.advanceError
          return { advance: target.advance }
        }
        (calls.annotations ||= []).push(target)
        if (calls.openError) throw calls.openError
        return { editorOpened: true, advance: target.advance, ...(calls.openResult || {}) }
      },
      notify(target: any, event: string) { calls.notifications.push({ target, event }); if (calls.sceneNotifyFails) throw new Error("scene unavailable") }
    },
    // Exercise the actual native helper's injected-script contract, with only
    // the canvas animation replaced by an observable WebView-side function.
    __REVIEW_COMPLETION_SCRIPT__: 'window.setReviewCompletionEffect=function(active){recordCompletion(active)}',
    JSB: { defineClass: (_declaration: string, methods: any) => ({ new: () => ({ ...methods }) }) },
    UIAccessibility: { isReduceMotionEnabled: () => !!calls.reducedMotion },
    UIFont: { systemFontOfSize: (size: number) => size },
    MNUtil: { animate(update: () => void) { calls.animations = (calls.animations || 0) + 1; calls.inAnimation = true; update(); calls.inAnimation = false; return calls.deferAnimation ? new Promise<void>(resolve => calls.animationEnds.push(resolve)) : Promise.resolve() } },
    UIScrollView: View, self: foreignSelf ? { panelController: true } : owner, UIView: View, UIWebView: View,
    UILabel: class extends View {
      constructor(frame: any) {
        assert.ok(frame && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(frame[key])), '原生 UILabel 构造必须包含完整有限 CGRect，不能事后补 frame')
        super(frame)
      }
    },
    UIImage: { imageWithDataScale: (path: string, scale: number) => ({ path, scale }) },
    NSData: { dataWithContentsOfFile: (path: string) => path },
    UIButton: { buttonWithType: () => new View() }, UIPanGestureRecognizer: class { constructor(target: any, action: string) { calls.targets.push({target, action}) } }, UITapGestureRecognizer: class { constructor(target: any, action: string) { calls.targets.push({target, action}) } },
    UIColor: Object.fromEntries(["colorWithHexString", "whiteColor", "clearColor", "blackColor"].map(key => [key, (hex?: string) => ({ ...color, hex: hex || key, colorWithAlphaComponent(alpha: number) { return { hex: hex || key, alpha } } })])),
    NSTimer: { scheduledTimerWithTimeInterval(interval: number, repeat: boolean, callback: () => void) {
      const timer = { interval, repeat, callback, invalidations: 0, invalidate() { this.invalidations++ } }
      calls.timers.push(callback); calls.timerHandles.push(timer)
      return timer
    } }
  }
  function load(file: string, exports: any, modules: any) {
    runInNewContext(transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText,
      { ...common, exports, require: (name: string) => modules[name] ?? (name === "./window-opacity" ? opacity : {}) })
  }
  const opacity = windowOpacityFixture(View)
  const colors = { UI_COLORS: { accent: "blue", surface: "#f7f8fa", level0: "red", level1: "orange", level2: "green" } }
  const surfaces: any = {}
  load("src/native-control-surface.ts", surfaces, {})
  const completionEffect: any = {}
  load('src/review-completion-effect.ts', completionEffect, { './native-control-surface': surfaces })
  const workbenchNotification: any = {}
  load("src/workbench-notification.ts", workbenchNotification, {})
  const windowControls: any = {}
  load("src/window-controls.ts", windowControls, { "./ui-tokens": { WINDOW_CONTROL_BACKGROUND_OPACITY: 0.96 } })
  const previewMode: any = {}
  load("src/answer-preview-mode.ts", previewMode, {})
  load("src/answer-card-view.ts", viewExports, { "./mistake-store": { loadMistakeState: () => ({ records: calls.records || {} }) }, "./mistake-domain": { reviewResultHint }, marginnote: { MN: mn }, "./answer-review-controls": reviewVisual, "./answer-card-layout": answerLayout,
    "./window-controls": { ...windowControls, storedWindowControlSide: () => calls.side || "left" }, "./native-control-surface": surfaces, "./answer-preview-mode": previewMode, "./settings": { loadMatcherSettings: () => ({ ...calls.settings }) } })
  const reasonApi: any = {}
  load('src/error-reasons.ts', reasonApi, { marginnote: { select: async (rows: string[]) => {
    calls.reasonPrompts = (calls.reasonPrompts || 0) + 1
    calls.reasonOptions = rows
    if (calls.reasonWait) await calls.reasonWait
    return { index: calls.reasonChoice ?? rows.length - 1 }
  } } })
  const api: any = {}
  const quickSurface: any = {}
  load('src/quick-menu-surface.ts', quickSurface, { './ui-tokens': colors })
  load("src/review-mode.ts", api, {
    './review-completion-effect': completionEffect,
    "./error-reasons": reasonApi,
    "./practice-attempts": { savePracticeAttempt: (...args: any[]) => (calls.attempts ||= []).push(args), saveAttemptAnswerChecked: (...args: any[]) => (calls.checked ||= []).push(args) },
    "./review-toolbar-layout": toolbarLayout,
    "./practice-history": { openPracticeHistory: async (_owner: any, _noteid: string, _topicid: string, resume: any) => { calls.historyResume = resume } },
    "./plugin-ink-window": {
      completePluginInkWindow: async (targetOwner: any) => {
        calls.pluginCompletions = (calls.pluginCompletions || 0) + 1
        if (calls.pluginSaveError) throw new Error('插件批注保存失败')
        const target = calls.pluginAnnotations[calls.pluginAnnotations.length - 1]
        const event = { ...target, action: target.advance, saved: true, commentId: 'plugin-new' }
        calls.pluginClosed = event
        targetOwner.cardLinkReviewAnnotationClosed?.(event)
      },
      setPluginInkWindowVisible: () => {},
      disposePluginInkWindow: () => { calls.pluginDisposed = (calls.pluginDisposed || 0) + 1 },
      openPluginInkWindow: async (_owner: any, target: any) => { (calls.pluginAnnotations ||= []).push(target); return { editorOpened: true } },
      pluginInkStatus: () => calls.pluginClosed ? { state: 'closed', event: calls.pluginClosed } : { state: 'unknown' }
    },
    './quick-menu-surface': quickSurface,
    "./mnutils-entrance": {
      openReviewQuickMenu: (target: any) => {
        const body = new View({ x: 0, y: 0, width: 40, height: 304 })
        target.cardLinkReviewEntranceResize = (height: number, width: number) => { body.frame = { ...body.frame, height, width } }
        target.cardLinkReviewEntranceCommit = (animated: boolean) => { (calls.commits ||= []).push({ animated, inAnimation: !!calls.inAnimation }) }
        target.cardLinkReviewEntranceRender(body)
        return true
      },
      closeReviewQuickMenu: (target: any) => { target.cardLinkReviewEntranceHost = undefined }
    },
    "./binding": { usesSubcardAnswers },
    "./review-queue": reviewQueue,
    "./native-control-surface": surfaces,
    "./workbench-notification": workbenchNotification,
    "./mistake-store": { loadMistakeState: () => ({ records: calls.records || {} }) },
    marginnote: { MN: mn, NodeNote: class { ancestorNodes = []; constructor(public note: any) {} }, delay: async () => {}, select: async (rows: string[], title: string) => {
      if (title === '是否保存当前批注？') {
        calls.historySavePrompts = (calls.historySavePrompts || 0) + 1
        calls.historySaveOptions = rows
        if (calls.historySaveWait) await calls.historySaveWait
        return { index: calls.historySaveChoice ?? 0 }
      }
      if (title === '恢复批注状态') { calls.statusPrompts = (calls.statusPrompts || 0) + 1; return { index: calls.statusChoice ?? 0 } }
      calls.selectedRows = rows; return calls.choose ? calls.choose(rows) : { index: calls.choices?.shift() ?? -1 }
    }, showHUD: (message: string) => { (calls.hudMessages ||= []).push(message); calls.hud = message }, popup: async (value: any) => {
      calls.reports.push(value)
      if (calls.popupWait) await calls.popupWait
      if (calls.popupError) throw calls.popupError
    } },
    lucide,
    "./ui-tokens": colors,
    "./mistake-domain": { reviewResultHint, LEVEL_DESCRIPTIONS: ["不会", "不熟", "掌握"] },
    "./mistake-manager": {
      markQuestionAsMistake: async (node: any, notebook: string, level: number, reason: any) => {
        (calls.markReasons ||= []).push(reason)
        if (calls.markError) throw new Error('mark failed')
        const id = node.note.noteId
        ;(calls.marks ||= []).push([notebook, id, level])
        if (calls.markWait) await calls.markWait
        const record = { recordId: `${notebook}:${id}`, level }
        ;(calls.records ||= {})[record.recordId] = record
        return record
      },
      openSourceByMistakeId: async () => ({}),
      reviewMistakeById: (id: string, level: number, reason: any) => { (calls.writeReasons ||= []).push(reason); calls.writes.push([id, level]); return save(id, level) }
    },
    "./note-navigation": { focusNoteInMindMapFocusMode: async () => "focused" },
    "./same-map-practice": {
      startSameMapPractice: async (...args: any[]) => { calls.masks.push(args); if (calls.focusWait) await calls.focusWait; return calls.practiceFailure ? { started: false, reason: calls.practiceFailure } : { started: true } },
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
  function nativeAddon() {
    const fallback = new Proxy({}, { get: () => () => {} })
    const plugin = new Proxy(api, { get: (target, key) => key === 'lifecycle' ? { instanceMethods: {}, classMethods: {} } : key === 'handlers' ? {} : target[key] || (() => {}) })
    const scope: any = { exports: {}, self: owner, require: (name: string) => name === './plugin' ? plugin : fallback,
      JSB: { defineClass: (_name: string, methods: any) => methods } }
    runInNewContext(transpileModule(readFileSync('src/rails-core.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
    runInNewContext(readFileSync('rails-native/WebAddon.js', 'utf8'), scope)
    const methods = scope.__MNAM_WEB_ADDON_GLOBAL__.createAddon('/addon')
    return { methods, tap(button: any) {
      const target = calls.targets.find((value: any) => value.button === button && !/Control(Press|Release)/.test(value.action))
      assert.ok(target, '原生按钮必须绑定动作')
      const method = methods[target.action.replace(/:$/, '')]
      assert.equal(typeof method, 'function', `${target.action} 必须注册在正式 Rails 原生入口`)
      return method(button)
    } }
  }
  return { api, owner, calls, items, answer, viewExports, windowControls, View, nativeAddon, setSave: (fn: typeof save) => { save = fn } }
}

function completionPopup(h: ReturnType<typeof harness>) {
  let resolve!: () => void, reject!: (error: Error) => void
  h.calls.popupWait = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { resolve, reject }
}

function completionPlays(h: ReturnType<typeof harness>): number {
  return (h.calls.completionViews || []).reduce((total: number, view: any) => total + view.completionStates.filter(Boolean).length, 0)
}

function completionTimers(h: ReturnType<typeof harness>): any[] {
  return h.calls.timerHandles.filter((timer: any) => timer.interval === 5 && !timer.repeat)
}

function assertCompletionStopped(h: ReturnType<typeof harness>, effect: any): void {
  assert.equal(h.owner.cardLinkReviewCompletionEffect, undefined)
  assert.equal(effect.active, false)
  assert.equal(effect.view.superview, undefined)
  assert.equal(effect.container.superview, undefined)
  assert.equal(effect.view.removals, 1)
  assert.equal(effect.view.completionStates.at(-1), false)
  if (effect.timer) assert.equal(effect.timer.invalidations, 1)
}

async function completeReviewQuestion(h: ReturnType<typeof harness>, level = 2): Promise<void> {
  const current = h.owner.cardLinkReviewMode
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: level }, h.owner)
  if (current.writingMode === 'annotation') {
    const target = h.calls.annotations.at(-1)
    const close = h.owner.cardLinkReviewAnnotationClosed
    const event = { ...target, action: target.advance, saved: true, commentId: `paper-${target.reviewToken}` }
    close(event); close(event)
  }
  await new Promise(resolve => setImmediate(resolve))
}

test('复习队列完成与结果弹窗同步播放一次，固定曲线及 FSRS 的三种书写方式一致', async () => {
  for (const algorithm of ['fixed', 'fsrs']) for (const writingMode of ['mindmap', 'annotation', 'handwriting']) {
    const h = harness(), popup = completionPopup(h)
    if (algorithm === 'fsrs') h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: 'fsrs' }
    await h.api.startReviewMode(h.items, h.owner, algorithm, writingMode)
    const effect = h.owner.cardLinkReviewCompletionEffect
    assert.ok(effect.ready)
    assert.equal(completionPlays(h), 0)
    await completeReviewQuestion(h)
    assert.equal(completionPlays(h), 0)
    assert.equal(h.calls.reports.length, 0)
    await completeReviewQuestion(h)
    assert.equal(h.owner.cardLinkReviewMode, undefined)
    assert.equal(h.calls.reports.length, 1)
    assert.equal(h.calls.reports[0].title, '本次复习结果')
    assert.equal(completionPlays(h), 1)
    assert.equal(completionTimers(h).length, 1)
    h.api.onReviewModeExit(undefined, h.owner)
    assert.equal(completionPlays(h), 1)
    assert.equal(h.calls.reports.length, 1)
    popup.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assertCompletionStopped(h, effect)
  }
})

test('手动退出及做题完成仍结算，但不播放复习烟花', async () => {
  const manual = harness()
  await manual.api.startReviewMode(manual.items, manual.owner)
  const effect = manual.owner.cardLinkReviewCompletionEffect
  manual.api.onReviewModeExit(undefined, manual.owner)
  assert.equal(manual.calls.reports.length, 1)
  assert.equal(completionPlays(manual), 0)
  assertCompletionStopped(manual, effect)
  for (const writingMode of ['mindmap', 'annotation', 'handwriting']) {
    const h = harness()
    await h.api.startPracticeMode('book', ['a'], undefined, false, writingMode, h.owner)
    assert.equal(h.owner.cardLinkReviewCompletionEffect, undefined)
    if (writingMode === 'annotation') h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'finish', saved: true, commentId: 'practice-paper' })
    else h.api.onReviewModeNext()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.reports.length, 1)
    assert.equal(completionPlays(h), 0)
  }
})

test('复习关闭烟花、减少动态效果或未加载完成均不延迟或阻止结果弹窗', async () => {
  for (const condition of ['disabled', 'reduced', 'unready']) {
    const h = harness()
    if (condition === 'disabled') h.calls.settings = { reviewCompletionConfetti: false }
    if (condition === 'reduced') h.calls.reducedMotion = true
    if (condition === 'unready') h.calls.deferSurfaceLoad = true
    await h.api.startReviewMode(h.items.slice(0, 1), h.owner)
    await completeReviewQuestion(h)
    assert.equal(h.calls.reports.length, 1)
    assert.equal(completionPlays(h), 0)
    assert.equal(h.owner.cardLinkReviewCompletionEffect, undefined)
  }
})

test('末题评分保存失败及宿主手写结束失败不提前播放烟花，重试成功才播放', async () => {
  const failedSave = harness(), savePopup = completionPopup(failedSave)
  failedSave.setSave(async () => { throw new Error('save failed') })
  await failedSave.api.startReviewMode(failedSave.items.slice(0, 1), failedSave.owner)
  await completeReviewQuestion(failedSave)
  assert.ok(failedSave.owner.cardLinkReviewMode)
  assert.equal(failedSave.calls.reports.length, 0)
  assert.equal(completionPlays(failedSave), 0)
  failedSave.setSave(async (_id, level) => ({ level, reviewCount: 1, history: [{ level, at: 'today' }] }))
  await failedSave.api.onReviewModeToolbarResult({ tag: 2 }, failedSave.owner)
  assert.equal(failedSave.calls.reports.length, 1)
  assert.equal(completionPlays(failedSave), 1)
  savePopup.resolve()
  const finish = harness(), finishPopup = completionPopup(finish)
  await finish.api.startReviewMode(finish.items.slice(0, 1), finish.owner, 'fixed', 'handwriting')
  finish.calls.writingFinishError = true
  await completeReviewQuestion(finish)
  assert.ok(finish.owner.cardLinkReviewMode)
  assert.equal(finish.calls.reports.length, 0)
  assert.equal(completionPlays(finish), 0)
  assert.equal(finish.owner.cardLinkReviewMode.queueFinished, true)
  assert.equal(finish.owner.cardLinkReviewCompletionEffect?.ready, true)
  finish.calls.writingFinishError = false
  finish.api.onReviewModeExit(undefined, finish.owner)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finish.calls.reports.length, 1)
  assert.equal(completionPlays(finish), 1)
  finishPopup.resolve()
})

test('结果显示后会话已释放，生命周期挂起仍立即停止烟花且旧弹窗不清理新层', async () => {
  const h = harness(), popup = completionPopup(h)
  await h.api.startReviewMode(h.items.slice(0, 1), h.owner)
  const effect = h.owner.cardLinkReviewCompletionEffect
  await completeReviewQuestion(h)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  h.api.suspendReviewModeToolbar(h.owner)
  assertCompletionStopped(h, effect)
  await h.api.startReviewMode(h.items, h.owner)
  const nextEffect = h.owner.cardLinkReviewCompletionEffect
  popup.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewCompletionEffect, nextEffect)
  assert.equal(nextEffect.active, true)
  h.api.discardReviewMode(h.owner)
})

test('复习挂起、直接丢弃及结果弹窗拒绝均释放烟花层', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  const suspended = h.owner.cardLinkReviewCompletionEffect
  h.api.suspendReviewModeToolbar(h.owner)
  assertCompletionStopped(h, suspended)
  h.api.restoreReviewModeToolbar()
  assert.ok(h.owner.cardLinkReviewCompletionEffect.ready)
  const discarded = h.owner.cardLinkReviewCompletionEffect
  h.api.discardReviewMode(h.owner)
  assertCompletionStopped(h, discarded)
  const rejected = harness(), popup = completionPopup(rejected)
  await rejected.api.startReviewMode(rejected.items.slice(0, 1), rejected.owner)
  const effect = rejected.owner.cardLinkReviewCompletionEffect
  await completeReviewQuestion(rejected)
  popup.reject(new Error('popup dismissed'))
  await new Promise(resolve => setImmediate(resolve))
  assertCompletionStopped(rejected, effect)
})

function orient(h: any, horizontal = !h.owner.cardLinkReviewMode.annotationHorizontal) {
  h.api.updateReviewToolbarOrientation(h.owner, horizontal ? { x: 512, y: 0 } : { x: 0, y: 384 }, { width: 1024, height: 768 })
}

function ratingButtons(h: any): any[] {
  return h.owner.cardLinkReviewDropdown.children[0].children.filter((view: any) => view.title)
}

function ratingTitle(h: any): any {
  return h.owner.cardLinkReviewSource.children.find((view: any) => view.text)
}

function nativeButton(h: any, title: string): any {
  const stack = [h.owner.cardLinkReviewToolbar, h.owner.cardLinkReviewDropdown]
  while (stack.length) {
    const view = stack.pop()
    if (view?.accessibilityLabel === title) return view
    if (view?.children) stack.push(...view.children)
  }
  assert.fail(`未找到当前原生按钮：${title}`)
}

test('正式 Rails 原生回调：只展开反馈不提示保存，错因能点击和取消，选等级后才提示保存', async () => {
  const h = harness(), native = h.nativeAddon()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(h.calls.hudMessages?.length || 0, 0)
  await native.tap(nativeButton(h, '下一题'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.hudMessages?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
  await native.tap(nativeButton(h, '概念不清'))
  assert.equal(h.owner.cardLinkReviewMode.selectedReason.key, 'concept')
  await native.tap(nativeButton(h, '✓ 概念不清'))
  assert.equal(h.owner.cardLinkReviewMode.selectedReason, undefined)
  await native.tap(nativeButton(h, '不会'))
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, 0)
  assert.match(h.calls.hud, /已选择等级/)
  await native.tap(nativeButton(h, '公式遗忘'))
  assert.equal(h.owner.cardLinkReviewMode.selectedReason.key, 'formula')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.verdicts[0].reason, 'formula')
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
})

test('正式反馈按钮只展开等级，末题等级与笔迹保存成功才结束', async () => {
  const h = harness(), native = h.nativeAddon()
  await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  await native.tap(nativeButton(h, '标记错题'))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.calls.reports.length, 0)
  assert.equal(h.calls.hudMessages?.length || 0, 0)
  await native.tap(nativeButton(h, '不会'))
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.equal(h.calls.reports.length, 0)
  const event = { ...h.calls.annotations[0], action: 'finish', saved: true, commentId: 'paper' }
  h.owner.cardLinkReviewAnnotationClosed(event); h.owner.cardLinkReviewAnnotationClosed(event)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.marks.length, 1)
  assert.equal(h.calls.verdicts[0].self, 'again')
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
  assert.match(h.calls.reports[0].message, /已完成 1 道/)
})

test('宿主下一题保存：普通批注做题默认会了，非末题自动开窗，末题只结算一次', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  assert.ok(h.owner.cardLinkReviewAnnotationButtons.every((button: any) => button.accessibilityLabel !== '下一题'))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'one' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.reports.length, 0)
  const end = { ...h.calls.annotations[1], action: 'finish', saved: true, commentId: 'two' }
  h.owner.cardLinkReviewAnnotationClosed(end); h.owner.cardLinkReviewAnnotationClosed(end)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.deepEqual(h.calls.verdicts.map((v: any) => v.self), ['got', 'got'])
  assert.equal(h.calls.reports.length, 1)
  assert.match(h.calls.reports[0].message, /已完成 2 道/)
})

test('批注复习末题保存或无新增笔迹不会直接退出：新旧作答都等待等级再提交', async () => {
  for (const old of [false, true]) {
    const h = harness(), native = h.nativeAddon()
    await h.api.startReviewMode(h.items.slice(0, 1), h.owner, 'fixed', 'annotation')
    if (old) {
      h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: false })
      await new Promise(resolve => setImmediate(resolve))
      await h.api.onReviewModeHistory()
      await h.calls.historyResume('old-paper', true)
    }
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[old ? 1 : 0], action: 'finish', saved: !old, commentId: old ? 'old-paper' : 'new-paper' })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(h.owner.cardLinkReviewMode)
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
    assert.equal(h.calls.reports.length, 0)
    assert.equal(h.calls.writes.length, 0)
    await native.tap(nativeButton(h, '掌握'))
    assert.equal(h.calls.writes.length, 1)
    assert.equal(h.calls.verdicts[0].commentId, old ? 'old-paper' : 'new-paper')
    assert.equal(h.owner.cardLinkReviewMode, undefined)
    assert.equal(h.calls.reports.length, 1)
  }
})

test('原生反馈区横竖布局均保留可点击的窗口恢复入口，未知状态不自动确认', async () => {
  for (const purpose of ['practice', 'review']) for (const horizontal of [false, true]) {
    const h = harness(), native = h.nativeAddon()
    if (purpose === 'practice') await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
    else await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
    orient(h, horizontal)
    await native.tap(nativeButton(h, purpose === 'practice' ? '标记错题' : '下一题'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.statusPrompts, undefined)
    const restore = nativeButton(h, '批注窗口已关闭？恢复操作')
    assert.equal(restore.enabled, true)
    assert.ok(restore.frame.width > 0 && restore.frame.height > 0)
    if (horizontal) assert.equal(restore.frame.width, h.owner.cardLinkReviewDropdown.frame.width - 16)
    h.calls.statusChoice = -1
    await native.tap(restore)
    assert.equal(h.calls.statusPrompts, 1)
    assert.equal(h.owner.cardLinkReviewMode.annotationPhase, 'editing')
    assert.equal(h.calls.writes.length, 0)
    assert.equal(h.calls.verdicts?.length || 0, 0)
  }
})

test('脑图做题遇已有错题可直接下一题或结算，不自动展开反馈或修改复习记录', async () => {
  const h = harness(), native = h.nativeAddon()
  h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 }, 'book:b': { recordId: 'book:b', level: 0 } }
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'mindmap', h.owner)
  const current = h.owner.cardLinkReviewMode
  await native.tap(nativeButton(h, '下一题'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.index, 1)
  assert.equal(current.completed.a, true)
  assert.equal(current.resultsVisible, false)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.marks?.length || 0, 0)
  await native.tap(nativeButton(h, '下一题'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
  assert.match(h.calls.reports[0].message, /已完成 2 道/)
  assert.equal(h.calls.writes.length, 0)
})

test('批注做题已有错题未选等级也默认会了：不弹反馈、不写错题记录，末题直接结算', async () => {
  for (const feedbackOpen of [false, true]) for (const saved of [false, true]) {
    const h = harness(), native = h.nativeAddon()
    h.calls.records = { 'book:a': { recordId: 'book:a', level: 0, tags: ['错题', '错因_计算失误'] }, 'book:b': { recordId: 'book:b', level: 1 } }
    const before = JSON.stringify(h.calls.records)
    await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
    const current = h.owner.cardLinkReviewMode
    if (feedbackOpen) {
      await native.tap(nativeButton(h, '复习反馈'))
      await native.tap(nativeButton(h, '概念不清'))
    }
    const first = { ...h.calls.annotations[0], action: 'next', saved, ...(saved ? { commentId: 'paper-a' } : {}) }
    h.owner.cardLinkReviewAnnotationClosed(first); h.owner.cardLinkReviewAnnotationClosed(first)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 1)
    assert.equal(current.completed.a, true)
    assert.equal(current.resultsVisible, false)
    assert.equal(h.owner.cardLinkReviewDropdown, undefined)
    assert.equal(h.calls.annotations[1].noteid, 'b')
    assert.equal(h.calls.writes.length, 0)
    assert.equal(h.calls.marks?.length || 0, 0)
    assert.equal(h.calls.verdicts?.length || 0, saved ? 1 : 0)
    if (saved) { assert.equal(h.calls.verdicts[0].self, 'got'); assert.equal(h.calls.verdicts[0].reason, undefined) }
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'finish', saved: true, commentId: 'paper-b' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.owner.cardLinkReviewMode, undefined)
    assert.equal(h.calls.reports.length, 1)
    assert.equal(h.calls.verdicts.at(-1).self, 'got')
    assert.equal(JSON.stringify(h.calls.records), before)
    assert.equal(h.calls.writes.length, 0)
    assert.equal(h.calls.marks?.length || 0, 0)
  }
})

test('保留的宿主手写做题已有错题无需等级即可保存切题，不写成绩或原生批注判定', async () => {
  const h = harness(), native = h.nativeAddon()
  h.calls.records = { 'book:a': { recordId: 'book:a', level: 0 }, 'book:b': { recordId: 'book:b', level: 1 } }
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'handwriting', h.owner)
  const current = h.owner.cardLinkReviewMode
  await native.tap(nativeButton(h, '下一题'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.index, 1)
  assert.equal(current.resultsVisible, false)
  assert.equal(h.calls.writingCompletions, 1)
  assert.equal(h.calls.writingAnnotations.length, 2)
  await native.tap(nativeButton(h, '下一题'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.equal(h.calls.reports.length, 1)
})

test('批注做题仅有反馈按钮，横竖切换不恢复下一题且反馈高亮不串到答案', async () => {
  const h = harness(), native = h.nativeAddon()
  h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 } }
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  const buttons = [...h.owner.cardLinkReviewAnnotationButtons]
  for (const horizontal of [false, true, false]) {
    orient(h, horizontal)
    assert.equal(h.owner.cardLinkReviewAnnotationButtons.length, 8)
    assert.ok(buttons.every((button: any, index: number) => button === h.owner.cardLinkReviewAnnotationButtons[index]))
    assert.ok(buttons.every((button: any) => button.accessibilityLabel !== '下一题'))
    assert.ok(h.calls.targets.every((target: any) => target.action !== 'onReviewModeNext:'))
    const feedback = nativeButton(h, '复习反馈'), answer = nativeButton(h, '查找当前卡片答案')
    assert.match(feedback.image.path, /next\.png$/)
    await native.tap(feedback)
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
    assert.equal(feedback.backgroundColor.hex, 'blue')
    assert.equal(answer.backgroundColor.hex, 'clearColor')
    assert.equal(h.calls.writes.length, 0)
    h.owner.cardLinkReviewDismissClassification()
  }
})

test('同轮已反馈题往返正常开批注但不弹反馈，保留等级错因，主动改反馈才新增评分', async () => {
  for (const purpose of ['practice', 'review']) for (const algorithm of ['fixed', 'fsrs']) {
    if (purpose === 'practice' && algorithm === 'fsrs') continue
    const h = harness(), native = h.nativeAddon()
    if (algorithm === 'fsrs') h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: 'fsrs' }
    if (purpose === 'practice') h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 } }
    if (purpose === 'practice') await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
    else await h.api.startReviewMode(h.items.map(item => ({ ...item, fsrsProgress: { revision: 0, history: [] } })), h.owner, algorithm, 'annotation')
    const current = h.owner.cardLinkReviewMode
    await native.tap(nativeButton(h, purpose === 'practice' ? '复习反馈' : '下一题'))
    await native.tap(nativeButton(h, '概念不清'))
    await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1))
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper-a' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 1)
    h.api.onReviewModePrevious()
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'next', saved: true, commentId: 'paper-b' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 0)
    assert.equal(current.visitFeedbackSaved, true)
    assert.equal(current.resultsVisible, false)
    assert.equal(current.selectedReason.key, 'concept')
    assert.equal(current.savedFeedback.a.commentId, 'paper-a')
    assert.equal(current.papers.a, undefined)
    assert.equal(h.calls.annotations.length, 3)
    assert.equal(h.calls.annotations[2].noteid, 'a')
    assert.equal(h.calls.annotations[2].newAttempt, true)
    assert.equal(current.annotationPhase, 'editing')
    const writes = () => algorithm === 'fsrs' ? h.calls.fsrsWrites.length : h.calls.writes.length
    assert.equal(writes(), 1)
    if (purpose === 'review') {
      await native.tap(nativeButton(h, '下一题'))
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(current.index, 0)
      assert.equal(current.resultsVisible, false)
    }
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[2], action: 'next', saved: true, commentId: 'rewrite-a' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 1)
    assert.equal(current.resultsVisible, false)
    assert.equal(h.calls.annotations[3].noteid, 'b')
    assert.equal(writes(), 1)
    assert.equal(h.calls.verdicts.length, 1)
    h.api.onReviewModePrevious()
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[3], action: 'next', saved: true, commentId: 'paper-b-2' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 0)
    if (purpose === 'practice') await native.tap(nativeButton(h, '复习反馈'))
    else {
      h.calls.choices = [current.items.length]
      await native.tap(h.owner.cardLinkReviewIndexButton)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.calls.selectedRows.at(-1), '查看／修改本题反馈')
    }
    assert.equal(current.resultsVisible, true)
    assert.equal(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1).backgroundColor.hex, 'blue')
    assert.equal(writes(), 1)
    await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 2))
    assert.equal(writes(), 1)
    assert.equal(current.annotationPendingLevel, 2)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[4], action: 'next', saved: true, commentId: 'regrade-a' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(writes(), 2)
    assert.equal(current.savedFeedback.a.level, 2)
    assert.equal(current.savedFeedback.a.reason, undefined)
    assert.equal(h.calls.verdicts.at(-1).commentId, 'regrade-a')
    h.api.discardReviewMode(h.owner)
  }
})

test('切到已反馈的下一题仍自动开窗，保存切题不重复判定或反馈', async () => {
  for (const purpose of ['practice', 'review']) {
    const h = harness(), native = h.nativeAddon()
    if (purpose === 'practice') await h.api.startPracticeMode('book', ['a', 'b', 'c'], undefined, false, 'annotation', h.owner)
    else await h.api.startReviewMode([...h.items, { ...h.items[0], recordId: 'c', sourceNoteId: 'c' }], h.owner, 'fixed', 'annotation')
    const current = h.owner.cardLinkReviewMode
    for (let index = 0; index < 2; index++) {
      h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[index], action: 'next', saved: true, commentId: `original-${index}` })
      await new Promise(resolve => setImmediate(resolve))
      if (purpose === 'review') await native.tap(nativeButton(h, '掌握'))
    }
    assert.equal(current.index, 2)
    h.calls.choices = [0]
    await native.tap(h.owner.cardLinkReviewIndexButton)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[2], action: 'finish', saved: true, commentId: 'ungraded-c' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 0)
    assert.equal(h.calls.annotations[3].noteid, 'a')
    const verdicts = h.calls.verdicts.length, writes = h.calls.writes.length
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[3], action: 'next', saved: true, commentId: 'rewrite-a' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(current.index, 1)
    assert.equal(h.calls.annotations[4].noteid, 'b')
    assert.equal(h.calls.annotations[4].newAttempt, true)
    assert.equal(current.annotationPhase, 'editing')
    assert.equal(current.visitFeedbackSaved, true)
    assert.equal(current.resultsVisible, false)
    assert.equal(current.savedFeedback.b.commentId, 'original-1')
    h.calls.choices = [0]
    await native.tap(h.owner.cardLinkReviewIndexButton)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[4], action: 'next', saved: true, commentId: 'rewrite-b' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.annotations[5].noteid, 'a')
    assert.equal(h.calls.verdicts.length, verdicts)
    assert.equal(h.calls.writes.length, writes)
    h.api.discardReviewMode(h.owner)
  }
})

test('已反馈题主动重新书写后仅保存切题，不重弹反馈也不改判新作答', async () => {
  for (const purpose of ['practice', 'review']) {
    const h = harness(), native = h.nativeAddon()
    h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 } }
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation', purpose === 'practice' ? { maskAnswers: false } : undefined)
    if (purpose === 'practice') {
      await native.tap(nativeButton(h, '复习反馈'))
      await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1))
    }
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'first' })
    await new Promise(resolve => setImmediate(resolve))
    if (purpose === 'review') await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1))
    h.api.onReviewModePrevious()
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'next', saved: true, commentId: 'second' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.owner.cardLinkReviewMode.index, 0)
    assert.equal(h.calls.annotations[2].newAttempt, true)
    assert.equal(h.owner.cardLinkReviewMode.visitFeedbackSaved, true)
    if (purpose === 'review') {
      await native.tap(nativeButton(h, '下一题'))
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[2], action: 'next', saved: true, commentId: 'rewrite' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.owner.cardLinkReviewMode.index, 1)
    assert.equal(h.calls.writes.length, 1)
    assert.equal(h.calls.verdicts.length, 1)
    assert.equal(h.owner.cardLinkReviewMode.savedFeedback.a.commentId, 'first')
    h.api.discardReviewMode(h.owner)
  }
})

test('脑图做题主动重评失败不能被已完成状态跳过，下一题重试所选等级', async () => {
  const h = harness(), native = h.nativeAddon()
  h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 } }
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'mindmap', h.owner)
  await native.tap(nativeButton(h, '复习反馈'))
  await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1))
  await h.api.goToPracticeQuestion('a', h.owner)
  h.setSave(async () => { throw new Error('保存失败') })
  await native.tap(nativeButton(h, '复习反馈'))
  await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 0))
  assert.equal(h.owner.cardLinkReviewMode.visitFeedbackSaved, false)
  assert.equal(h.owner.cardLinkReviewMode.savedFeedback.a.level, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  h.setSave(async (_id, level) => ({ level, reviewCount: 2, history: [] }))
  await native.tap(nativeButton(h, '下一题'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewMode.savedFeedback.a.level, 0)
  assert.deepEqual(h.calls.writes, [['book:a', 1], ['book:a', 0], ['book:a', 0]])
})

test('保存关闭后的反馈区可重新打开窗口，不伪造关闭回执或提交等级', async () => {
  const h = harness(), native = h.nativeAddon()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper-a' })
  await new Promise(resolve => setImmediate(resolve))
  await native.tap(nativeButton(h, '重新打开批注窗口'))
  assert.equal(h.calls.annotations.length, 2)
  assert.equal(h.calls.annotations[1].newAttempt, true)
  assert.equal(h.calls.annotations[1].commentId, undefined)
  assert.equal(h.calls.statusPrompts, undefined)
  assert.equal(h.calls.statusRequests?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, 'editing')
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(nativeButton(h, '批注窗口已关闭？恢复操作'))
})

test('已有错题主动反馈仍更新原记录：三种做题方式打开不写入，选等级后保存', async () => {
  for (const writing of ['mindmap', 'annotation', 'handwriting']) {
    const h = harness(), native = h.nativeAddon()
    h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 } }
    await h.api.startPracticeMode('book', ['a'], undefined, false, writing, h.owner)
    await native.tap(nativeButton(h, '复习反馈'))
    assert.equal(h.calls.writes.length, 0)
    assert.equal(h.calls.writingCompletions || 0, 0)
    assert.equal(h.calls.reports.length, 0)
    await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1))
    if (writing === 'annotation') {
      assert.equal(h.calls.writes.length, 0)
      h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'finish', saved: true, commentId: 'paper' })
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.deepEqual(h.calls.writes, [['book:a', 1]])
    assert.equal(h.calls.marks?.length || 0, 0)
    assert.equal(h.owner.cardLinkReviewMode, undefined)
    assert.equal(h.calls.reports.length, 1)
  }
})

test('三种方式的普通做题与复习逐题完成矩阵：下一题、错因、提交、末题结算', async () => {
  for (const purpose of ['practice', 'review']) for (const writing of ['mindmap', 'annotation', 'handwriting']) {
    const h = harness(), native = h.nativeAddon()
    if (purpose === 'practice') await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, writing, h.owner)
    else await h.api.startReviewMode(h.items, h.owner, 'fixed', writing)
    for (let index = 0; index < 2; index++) {
      if (purpose !== 'practice' || writing !== 'annotation') await native.tap(nativeButton(h, '下一题'))
      await new Promise(resolve => setImmediate(resolve))
      if (purpose === 'review') {
        assert.equal(h.owner.cardLinkReviewMode.index, index)
        assert.equal(h.calls.writes.length, index)
        assert.equal(h.calls.reports.length, 0)
        await native.tap(nativeButton(h, '概念不清'))
        await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 1))
      }
      if (writing === 'annotation') {
        assert.ok(h.owner.cardLinkReviewMode)
        h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[index], action: index ? 'finish' : 'next', saved: true, commentId: `paper-${index}` })
      }
      await new Promise(resolve => setImmediate(resolve))
      if (index === 0) { assert.equal(h.owner.cardLinkReviewMode.index, 1); assert.equal(h.calls.reports.length, 0) }
      else { assert.equal(h.owner.cardLinkReviewMode, undefined); assert.equal(h.calls.reports.length, 1) }
    }
    assert.equal(h.calls.marks?.length || 0, 0)
    assert.equal(h.calls.writes.length, purpose === 'review' ? 2 : 0)
  }
})

test('智能复习的三种书写方式经正式按钮提交错因，保存前不评分且成功后只推进一次', async () => {
  for (const writing of ['mindmap', 'annotation', 'handwriting']) {
    const h = harness(), native = h.nativeAddon()
    h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: 'fsrs' }
    await h.api.startReviewMode(h.items.map(item => ({ ...item, fsrsProgress: { revision: 0, history: [] } })), h.owner, 'fsrs', writing)
    await native.tap(nativeButton(h, '下一题'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.hudMessages?.length || 0, 0)
    assert.equal(h.calls.writingCompletions || 0, 0)
    await native.tap(nativeButton(h, '概念不清'))
    await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 0))
    if (writing === 'annotation') {
      assert.equal(h.calls.fsrsWrites?.length || 0, 0)
      h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(h.calls.fsrsWrites.length, 1)
    assert.equal(h.calls.fsrsWrites[0].errorReasons[0], 'concept')
    assert.equal(h.owner.cardLinkReviewMode.index, 1)
  }
})

test('普通题主动评分失败后在反馈区重试等级，不覆盖成默认会了或提前结束', async () => {
  const h = harness(), native = h.nativeAddon()
  await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  await native.tap(nativeButton(h, '标记错题'))
  await native.tap(h.owner.cardLinkReviewDropdownButtons.find((button: any) => button.tag === 0))
  h.calls.verdictError = true
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'finish', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.calls.reports.length, 0)
  h.calls.verdictError = false
  await native.tap(nativeButton(h, '不会'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.verdicts[h.calls.verdicts.length - 1].self, 'again')
  assert.equal(h.calls.marks[0][2], 0)
  assert.equal(h.calls.reports.length, 1)
})

test('普通做题继续旧批注未主动反馈时默认会了，直接切题且不标错', async () => {
  const h = harness()
  h.calls.openResult = { reusedExisting: true, commentId: 'old' }
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  const current = h.owner.cardLinkReviewMode
  assert.equal(current.annotationResumedExisting, true)
  assert.equal(current.papers[current.items[0].recordId], 'old')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], saved: true, action: 'next', commentId: 'old', reusedExisting: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.index, 1)
  assert.equal(current.resultsVisible, false)
  assert.equal(h.calls.verdicts[0].commentId, 'old')
  assert.equal(h.calls.verdicts[0].self, 'got')
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
})

test('身份未确认的旧纸保留保存身份但不执行已排队等级或下一题', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const current = h.owner.cardLinkReviewMode
  current.annotationPendingLevel = 1
  current.pendingPaperLevel = 1
  current.annotationIntent = { kind: 'next' }
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], saved: true, action: 'closed', commentId: 'unknown', identityUnconfirmed: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.index, 0)
  assert.equal(current.annotationToken, undefined)
  assert.equal(current.papers[current.items[0].recordId], 'unknown')
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
})

test('已移除的插件内批注模式不能从旧调用重新启动', async () => {
  const h = harness()
  await assert.rejects(h.api.startReviewMode(h.items, h.owner, 'fixed', 'plugin-ink'), /已移除/)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
})

test('批注切题复用七控件和圆环，状态更新保留详情；暂停不残留，恢复保留队列和进度', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const current = h.owner.cardLinkReviewMode, toolbar = h.owner.cardLinkReviewToolbar
  const buttons = [...h.owner.cardLinkReviewAnnotationButtons], ring = h.owner.cardLinkReviewProgressSvgView
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewToolbar, toolbar)
  buttons.forEach((button, index) => assert.equal(h.owner.cardLinkReviewAnnotationButtons[index], button))
  assert.equal(h.owner.cardLinkReviewAnnotationNumber.text, '2')
  assert.equal(h.owner.cardLinkReviewProgressSvgView, ring)
  assert.equal(ring.loads, 1)
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  h.api.restoreReviewModeToolbar()
  const source = h.owner.cardLinkReviewSource, dropdown = h.owner.cardLinkReviewDropdown
  h.api.restoreReviewModeToolbar()
  assert.equal(h.owner.cardLinkReviewSource, source)
  assert.equal(h.owner.cardLinkReviewDropdown, dropdown)
  h.api.suspendReviewModeToolbar()
  assert.equal(toolbar.superview, undefined)
  assert.equal(source.superview, undefined)
  assert.equal(dropdown.superview, undefined)
  assert.equal(h.owner.cardLinkReviewToolbar, undefined)
  assert.equal(current.suspended, true)
  // A close receipt arriving while the notebook is closed updates state only.
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'closed', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewToolbar, undefined)
  h.api.restoreReviewModeToolbar()
  assert.equal(h.owner.cardLinkReviewMode, current)
  assert.equal(current.index, 1)
  assert.equal(current.suspended, false)
  assert.ok(h.owner.cardLinkReviewToolbar.superview)
  assert.equal(h.calls.annotations.length, 2, '恢复只恢复界面，不额外打开编辑器')
  h.api.discardReviewMode()
})

test('脑图切题复用工具条及按钮，离开与返回保持当前题及拖动位置', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  const toolbar = h.owner.cardLinkReviewToolbar, buttons = [...h.owner.cardLinkReviewAnnotationButtons]
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewToolbar, toolbar)
  buttons.forEach((button, index) => assert.equal(h.owner.cardLinkReviewAnnotationButtons[index], button))
  h.api.suspendReviewModeToolbar()
  assert.equal(toolbar.superview, undefined)
  h.api.restoreReviewModeToolbar()
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  h.api.discardReviewMode()
})

test("批注复习冻结队列；关闭后展开等级，点击等级保存成功才打开下一题，末题评分退出", async () => {
  const h = harness(true)
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(h.calls.masks.length, 0)
  assert.equal(h.owner.cardLinkReviewToolbar.superview, h.owner.cardLinkReviewEntranceHost)
  const first = h.calls.annotations[0]
  assert.equal(first.noteid, 'a'); assert.equal(first.topicid, 'book'); assert.equal(first.advance, 'next')
  h.owner.cardLinkReviewAnnotationClosed({ ...first, noteid: 'other', action: 'next', saved: true })
  assert.equal(h.calls.writes.length, 0)
  const close = { ...first, action: 'next', saved: true, commentId: 'paper-a' }
  h.owner.cardLinkReviewAnnotationClosed(close); h.owner.cardLinkReviewAnnotationClosed(close)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.writes.length, 0)
  assert.deepEqual(ratingButtons(h).map(view => view.title), ['不会', '不熟', '掌握', '重新打开批注窗口'])
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.deepEqual(h.calls.writes, [['a', 1]])
  assert.equal(h.calls.annotations[1].advance, 'finish')
  const last = h.calls.annotations[1]
  h.owner.cardLinkReviewAnnotationClosed({ ...last, action: 'finish', saved: true, commentId: 'paper-b' })
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.deepEqual(h.calls.writes, [['a', 1], ['b', 2]])
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
})

test('关闭回执投递失败时重放，展开等级而不自动评分或弹状态确认', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.closedReceipt = { ...h.calls.annotations[0], action: 'next', saved: false }
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.calls.statusPrompts, undefined)
  assert.equal(h.calls.writes.length, 0)
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  assert.deepEqual(h.calls.writes, [['a', 1]])
  assert.equal(h.calls.annotations[1].noteid, 'b')
})

test('恢复只由等级区独立入口触发，确认已关闭后提交预选等级，不伪造笔迹保存', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.statusChoice = 1
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.statusPrompts, undefined)
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, 'editing')
  await h.api.onReviewModeToolbarResult({ tag: 2 })
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, 2)
  await h.api.onReviewModeToolbarResult({ tag: -2 })
  assert.deepEqual(h.calls.writes, [['a', 2]])
  assert.deepEqual(h.calls.statusRequests.map((r: any) => r.operation), ['status', 'status', 'status', 'release'])
  assert.equal(h.calls.statusPrompts, 1)
  assert.equal(h.calls.annotations[1].noteid, 'b')
  assert.equal(h.owner.cardLinkReviewMode.papers.a, undefined)
})

test('查询期间收到关闭事件只展开一次等级，未选等级不自动评分', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  const event = { ...h.calls.annotations[0], action: 'next', saved: true }
  assert.equal(h.owner.cardLinkReviewAnnotationClosed(event), true)
  assert.equal(h.owner.cardLinkReviewAnnotationClosed(event), false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.writes.length, 0)
  await h.api.onReviewModeToolbarResult({ tag: 0 })
  assert.deepEqual(h.calls.writes, [['a', 0]])
  assert.equal(h.calls.statusPrompts, undefined)
})

test('无新笔迹的关闭回执补偿后仍可在等级区评价', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.closedReceipt = { ...h.calls.annotations[0], action: 'closed', saved: false }
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  assert.deepEqual(h.calls.writes, [['a', 1]])
  assert.equal(h.calls.annotations[1].noteid, 'b')
})

test('正常无关闭回执不弹确认；查询失败保留切题意图，显式恢复可取消', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.statusChoice = -1
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationIntent.kind, 'next')
  assert.equal(h.calls.statusPrompts, undefined)
  await h.api.onReviewModeToolbarResult({ tag: -2 })
  assert.equal(h.calls.statusPrompts, 1)
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, 'editing')
  h.calls.statusError = new Error('场景已退出')
  h.api.onReviewModeNext() // 收起上次未选择的等级区。
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationChecking, false)
  assert.equal(h.owner.cardLinkReviewMode.annotationIntent.kind, 'next')
  assert.match(h.calls.hud, /操作已保留/)
  assert.equal(h.calls.writes.length, 0)
})

test('已知关闭回执下的选题和退出直接执行，不需要额外确认', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.closedReceipt = { ...h.calls.annotations[0], action: 'closed', saved: false }
  h.calls.choices = [1]
  h.api.onReviewModeIndex()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations[1].noteid, 'b')
  h.calls.closedReceipt = { ...h.calls.annotations[1], action: 'closed', saved: false }
  h.api.onReviewModeExit()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.statusPrompts, undefined)
})

test('点下一题立即展开当前题名称与等级，预选等级不写入，取消批注清除预选', async () => {
  const h = harness()
  const title = '例题4.1 窗函数的傅立叶变换'
  Object.assign(h.items[0], { sourceTitle: title })
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  assert.equal(ratingTitle(h).text, title)
  assert.equal(ratingTitle(h).numberOfLines, 2)
  assert.ok(ratingButtons(h).every(view => view.enabled))
  assert.deepEqual(ratingButtons(h).map(view => view.title), ['不会', '不熟', '掌握', '批注窗口已关闭？恢复操作'])
  assert.equal(h.calls.selectedRows, undefined)
  await h.api.onReviewModeToolbarResult({ tag: 0 })
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, 1)
  assert.equal(ratingButtons(h).find(view => view.tag === 1).backgroundColor.hex, 'blue')
  assert.equal(h.calls.writes.length, 0)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'cancel', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, undefined)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  assert.equal(h.calls.writes.length, 0)
})

test('窄窗和低高度窗口中全部复习按钮、等级列表均落在可用区域内', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewEntranceLimits = () => ({ width: 288, height: 218 })
  for (const horizontal of [false, true]) {
    h.owner.cardLinkReviewMode.annotationHorizontal = horizontal
    h.owner.cardLinkReviewEntranceRender(h.owner.cardLinkReviewEntranceHost)
    h.api.onReviewModeNext()
    const toolbar = h.owner.cardLinkReviewToolbar
    for (const button of toolbar.children.filter((view: any) => view.accessibilityLabel)) {
      assert.ok(button.frame.x + button.frame.width <= 288)
      assert.ok(button.frame.y + button.frame.height <= 218)
    }
    const list = h.owner.cardLinkReviewDropdown
    assert.ok(list.frame.x + list.frame.width <= 288)
    assert.ok(list.frame.y + list.frame.height <= 218)
    const scroll = list.children[0]
    assert.ok(scroll.contentSize.height >= scroll.frame.height)
    h.api.onReviewModeNext()
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  }
  h.api.discardReviewMode()
})

test('长分类列表在重新布局和横竖切换后保留滚动位置，不串到其他分类', async () => {
  const h = harness()
  const items = Array.from({ length: 40 }, (_, index) => ({ ...h.items[0], recordId: `r${index}`, sourceNoteId: `n${index}`, sourceTitle: `题目 ${index}` }))
  await h.api.startReviewMode(items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  h.owner.cardLinkReviewDropdown.children[0].contentOffset = { x: 0, y: 340 }
  h.owner.cardLinkReviewEntranceRender(h.owner.cardLinkReviewEntranceHost)
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].contentOffset.y, 340)
  orient(h)
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].contentOffset.y, 340)
  h.api.onReviewModeBranch({ tag: 1 })
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].contentOffset.y, 0)
  h.api.onReviewModeBranch({ tag: 0 })
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].contentOffset.y, 340)
  h.api.discardReviewMode()
})

test('等级题名与分类共用透明顶部，白色列表仅含等级；固定和FSRS横竖布局都不重叠', async () => {
  for (const algorithm of ['fixed', 'fsrs']) {
    const h = harness()
    if (algorithm === 'fsrs') h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: 'fsrs' }
    await h.api.startReviewMode(h.items, h.owner, algorithm, 'annotation')
    h.api.onReviewModeExpand()
    const categoryFrame = { ...h.owner.cardLinkReviewSource.frame }
    h.api.onReviewModeNext()
    const header = h.owner.cardLinkReviewSource, dropdown = h.owner.cardLinkReviewDropdown
    assert.deepEqual({ ...header.frame }, categoryFrame)
    assert.equal(header.backgroundColor.hex, 'clearColor')
    assert.equal(header.layer.cornerRadius, 0)
    assert.equal(header.superview, h.owner.cardLinkReviewEntranceHost)
    assert.equal(dropdown.superview, header.superview)
    assert.equal(dropdown.backgroundColor.alpha, 0.58)
    assert.equal(dropdown.frame.y - header.frame.y - header.frame.height, 2)
    assert.equal(dropdown.children[0].children.some((view: any) => view.text), false, 'title is outside the list')
    assert.equal(ratingButtons(h).length, algorithm === 'fsrs' ? 5 : 4)
    assert.equal(h.owner.cardLinkReviewToolbar.children.find((view: any) => view.accessibilityLabel === '下一题').backgroundColor.hex, 'blue')
    orient(h)
    const list = h.owner.cardLinkReviewDropdown
    assert.equal(h.owner.cardLinkReviewSource, undefined)
    assert.equal(list.frame.y, h.owner.cardLinkReviewToolbar.frame.height + 6)
    assert.equal(list.frame.x + list.frame.width, h.owner.cardLinkReviewToolbar.frame.width)
    assert.ok(list.frame.y + list.frame.height <= h.owner.cardLinkReviewEntranceHost.frame.height)
    assert.equal(h.calls.writes.length, 0)
    h.api.discardReviewMode()
  }
})

test('批注复习拒绝跳过等级，选择等级且保存后才推进', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: -1 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, undefined)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.calls.writes.length, 0)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
})


test('保存关闭后提交预选等级失败时保留等级区，允许重试且只推进一次', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  h.setSave(async () => { throw new Error('保存失败') })
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.owner.cardLinkReviewMode.annotationToken, undefined)
  assert.equal(h.calls.annotations.length, 1)
  h.setSave(async (_id, level) => ({ level, reviewCount: 1, history: [] }))
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  assert.equal(h.calls.annotations.length, 2)
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, undefined)
})

test("批注工具条竖排八控件，分类向侧边展开；拖动横排保留队列，分类路径在同行展开", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items.map(item => ({ ...item, sourceNotebookTitle: '数学', sourceRootTitle: '函数' })), h.owner, 'fixed', 'annotation')
  const body = h.owner.cardLinkReviewEntranceHost
  const compact = body.frame.height
  const controls = h.owner.cardLinkReviewToolbar
  assert.equal(body.frame.width, 44)
  assert.equal(compact, 352)
  assert.equal(controls.layer.borderWidth, 0)
  assert.equal(h.owner.cardLinkAnnotationToolbarSvg, undefined)
  assert.equal(controls.children.filter((v: any) => v.image).length, 7)
  assert.equal(controls.children.filter((v: any) => v.accessibilityLabel).length, 8)
  for (const view of controls.children) {
    assert.ok(view.frame.x >= 0 && view.frame.x + view.frame.width <= body.frame.width)
    assert.ok(view.frame.y + view.frame.height <= compact)
  }
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: false })
  h.api.onReviewModeExpand()
  assert.ok(body.frame.width > controls.frame.width)
  const source = h.owner.cardLinkReviewSource
  const crumb = source.children[0]
  assert.equal(source.frame.y + crumb.frame.y + crumb.frame.height / 2,
    h.owner.cardLinkReviewAnnotationButtons[0].frame.y + h.owner.cardLinkReviewAnnotationButtons[0].frame.height / 2)
  assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  const dropdown = h.owner.cardLinkReviewDropdown
  assert.ok(dropdown.frame.x >= h.owner.cardLinkReviewToolbar.frame.width)
  assert.ok(dropdown.frame.y + dropdown.frame.height <= body.frame.height)
  const queue = h.owner.cardLinkReviewMode.items
  const index = h.owner.cardLinkReviewMode.index
  orient(h)
  assert.equal(h.owner.cardLinkReviewMode.items, queue)
  assert.equal(h.owner.cardLinkReviewMode.index, index)
  assert.ok(h.owner.cardLinkReviewToolbar.frame.width > h.owner.cardLinkReviewToolbar.frame.height)
  assert.ok(h.owner.cardLinkReviewDropdown.frame.y >= h.owner.cardLinkReviewToolbar.frame.height)
  assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  h.api.onReviewModeExpand()
  assert.equal(body.frame.height, 44)
  orient(h)
  assert.equal(body.frame.height, compact)
  assert.equal(body.frame.width, 44)
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
})

function runProgressPage(view: any): Record<string, any> {
  const elements: Record<string, any> = {}
  for (const id of ['progress', 'progress-disk', 'index', 'previous', 'next']) elements[id] = { style: {}, attributes: {}, setAttribute(key: string, value: string) { this.attributes[key] = value } }
  const scope: any = { window: {}, document: { getElementById: (id: string) => elements[id], querySelector: () => ({ style: {} }) } }
  const script = /<script>([\s\S]*?)<\/script>/.exec(view.html)?.[1]
  assert.ok(script)
  runInNewContext(script!, scope)
  for (const update of view.scripts) runInNewContext(update, scope)
  return elements
}

test('批注序号仅嵌入30点SVG，复用原圆环状态更新，横竖切换不重载或拦截按钮', async () => {
  const h = harness()
  const items = [...h.items, { ...h.items[0], recordId: 'c', sourceNoteId: 'c' }]
  await h.api.startReviewMode(items, h.owner, 'fixed', 'annotation')
  const view = h.owner.cardLinkReviewProgressSvgView
  assert.equal(h.owner.cardLinkReviewIndexButton.image, undefined)
  assert.equal(view.superview, h.owner.cardLinkReviewIndexButton)
  assert.deepEqual({ ...view.frame }, { x: 7, y: 7, width: 30, height: 30 })
  assert.equal(view.userInteractionEnabled, false)
  assert.equal(view.scrollView.userInteractionEnabled, false)
  assert.equal(view.scrollView.scrollEnabled, false)
  assert.equal(view.opaque, false)
  assert.equal(view.backgroundColor.hex, 'clearColor')
  assert.equal(view.scrollView.backgroundColor.hex, 'clearColor')
  assert.equal(view.layer.cornerRadius, 15)
  assert.equal(view.layer.masksToBounds, true)
  assert.equal(Number(runProgressPage(view).progress.attributes['stroke-dashoffset']), 26 * Math.PI)
  h.calls.records = { a: { lastReviewedAt: new Date().toISOString() } }
  h.api.restoreReviewModeToolbar()
  assert.equal(h.owner.cardLinkReviewProgressSvgView, view)
  assert.equal(Number(runProgressPage(view).progress.attributes['stroke-dashoffset']), 26 * Math.PI * (1 - 1 / 3))
  h.calls.records.b = h.calls.records.c = h.calls.records.a
  h.api.restoreReviewModeToolbar()
  assert.equal(Number(runProgressPage(view).progress.attributes['stroke-dashoffset']), 0)
  orient(h)
  assert.equal(view.superview, h.owner.cardLinkReviewIndexButton)
  assert.equal(view.loads, 1)
  assert.equal(view.frame.width, 30)
  assert.equal(Object.keys(h.owner.cardLinkReviewNativeImages).length, 7)
  h.api.discardReviewMode(h.owner)
  const updates = view.scripts.length
  view.delegate.webViewDidFinishLoad(view)
  assert.equal(view.scripts.length, updates, 'late completion after exit must not update the surface')
})

test('批注圆环加载期间重挂载保留最新进度，加载完成才应用且只加载一次', async () => {
  const h = harness()
  h.calls.deferSurfaceLoad = true
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const view = h.owner.cardLinkReviewProgressSvgView
  assert.equal(view.scripts.length, 0)
  h.calls.records = { a: { lastReviewedAt: new Date().toISOString() } }
  h.api.restoreReviewModeToolbar()
  orient(h)
  assert.equal(view.loads, 1)
  assert.equal(view.scripts.length, 0)
  view.delegate.webViewDidFinishLoad(view)
  assert.equal(Number(runProgressPage(view).progress.attributes['stroke-dashoffset']), 13 * Math.PI)
})

test("取消批注评价停留当前题，新书写不复用旧批注；无新笔迹仍允许反馈", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, "fixed", "annotation")
  let target = h.calls.annotations[0]
  h.owner.cardLinkReviewAnnotationClosed({ ...target, action: "next", saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(ratingButtons(h).map(view => view.title), ['不会', '不熟', '掌握', '重新打开批注窗口'])
  assert.equal(h.calls.writes.length, 0)
  h.api.onReviewModeWrite()
  await new Promise(resolve => setImmediate(resolve))
  target = h.calls.annotations[1]
  h.owner.cardLinkReviewAnnotationClosed({ ...target, action: "next", saved: true, commentId: "paper-a" })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.calls.writes.length, 0)
  const oldDropdown = h.owner.cardLinkReviewDropdown
  assert.ok(oldDropdown?.superview)
  h.api.onReviewModeExpand()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(oldDropdown.superview, undefined)
  h.api.onReviewModeWrite()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations[2].commentId, undefined)
})

test("批注评价保存失败不打开下一题；FSRS批注评价仍只写智能进度", async () => {
  const h = harness()
  h.calls.choices = [1]
  h.setSave(async () => { throw new Error("保存失败") })
  await h.api.startReviewMode(h.items, h.owner, "fixed", "annotation")
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: "next", saved: true, commentId: "paper" })
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.match(h.calls.hud, /保存失败/)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  const f = harness()
  f.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: "fsrs" }
  f.calls.choices = [2]
  await f.api.startReviewMode(f.items.map(item => ({ ...item, fsrsProgress: { revision: 0, history: [] } })), f.owner, "fsrs", "annotation")
  f.owner.cardLinkReviewAnnotationClosed({ ...f.calls.annotations[0], action: "next", saved: true, commentId: "paper" })
  await new Promise(resolve => setImmediate(resolve))
  await f.api.onReviewModeToolbarResult({ tag: 2 })
  assert.equal(f.calls.writes.length, 0)
  assert.equal(f.calls.fsrsWrites[0].rating, 3)
  assert.equal(f.owner.cardLinkReviewMode.index, 1)
})

test("批注下一题请求关闭后等待事件；宿主明确拒绝可重试，结果未知保持原题", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, "fixed", "annotation")
  h.api.onReviewModeNext()
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  h.api.onReviewModeExit()
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: "closed", saved: false })
  h.calls.openError = Object.assign(new Error("宿主拒绝"), { editorMayBeOpen: false })
  h.api.onReviewModeWrite()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, "idle")
  h.calls.openError = new Error("超时")
  h.api.onReviewModeWrite()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, "uncertain")
  h.api.onReviewModeWrite()
  assert.equal(h.calls.annotations.length, 3)
})

test("书写中的工具条下一题仅记录意图，宿主关闭后反馈且不重复评分", async () => {
  const h = harness()
  h.calls.choices = [1]
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const buttons = h.owner.cardLinkReviewToolbar.children.filter((v: any) => v.accessibilityLabel)
  assert.equal(buttons[0].enabled, true)
  assert.equal(buttons[3].enabled, true)
  assert.equal(buttons[6].enabled, true)
  const target = h.calls.annotations[0]
  h.api.onReviewModeNext()
  h.api.onReviewModeNext()
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  h.api.onReviewModeNext()
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.calls.writes.length, 0)
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  const closed = { ...target, action: 'next', saved: false }
  h.owner.cardLinkReviewAnnotationClosed(closed)
  h.owner.cardLinkReviewAnnotationClosed(closed)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.calls.writes, [['a', 1]])
  assert.equal(h.calls.annotations[1].noteid, 'b')
  h.api.onReviewModeExit()
  assert.ok(h.owner.cardLinkReviewMode)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'finish', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode, undefined)
})

test("书写中分类和序号可以选题，收到关闭事件后才打开所选题", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeExpand(); assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  assert.ok(h.owner.cardLinkReviewDropdown)
  h.calls.choices = [1]
  h.api.onReviewModeIndex()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.calls.annotations.length, 1)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations[1].noteid, 'b')
  assert.equal(h.calls.selectedRows.length, 2)
  assert.equal(h.calls.writes.length, 0)
})

test("连续选择以最后目标为准，等待期间不发请求，取消批注清除待跳转操作", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.choices = [1, 0]
  h.api.onReviewModeIndex()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationIntent.index, 1)
  assert.match(h.calls.hud || '', /请点批注窗口/)
  h.api.onReviewModeIndex()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.annotationIntent.index, 0)
  assert.equal(h.calls.annotations.length, 1)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'cancel', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.annotationIntent, undefined)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
})

test("外部点击收起分类及分支，保留复习、待切题和等级区；没有旋转入口", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const current = h.owner.cardLinkReviewMode
  const iconPaths = () => h.owner.cardLinkReviewToolbar.children.filter((v: any) => v.image).map((v: any) => v.image.path)
  assert.ok(!iconPaths().some((path: string) => path.endsWith('/orientation.png')))
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  current.annotationIntent = { kind: 'goto', index: 1 }
  const token = current.annotationToken
  const before = h.calls.animations
  h.owner.cardLinkReviewDismissClassification()
  assert.ok(h.calls.animations > before)
  assert.equal(current.expanded, false)
  assert.equal(current.branch, undefined)
  assert.equal(h.owner.cardLinkReviewSource, undefined)
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
  assert.equal(h.owner.cardLinkReviewMode, current)
  assert.equal(current.annotationToken, token)
  assert.equal(current.annotationIntent.index, 1)
  current.resultsVisible = true
  current.annotationPendingLevel = 1
  h.owner.cardLinkReviewDismissClassification()
  assert.equal(current.resultsVisible, true)
  orient(h)
  assert.ok(!iconPaths().some((path: string) => path.endsWith('/orientation.png')))
  assert.equal(h.owner.cardLinkReviewToolbar.children.filter((view: any) => view.accessibilityLabel).length, 8)
  assert.equal(h.owner.cardLinkReviewToolbar.backgroundColor.hex, 'clearColor')
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewSource.backgroundColor.hex, 'clearColor')
  h.api.discardReviewMode()
  assert.equal(h.owner.cardLinkReviewDismissClassification, undefined)
})

test("分类展开运行动画且尊重减少动态效果设置", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const count = h.calls.animations || 0
  h.api.onReviewModeExpand()
  assert.ok(h.calls.animations > count)
  const oldSource = h.owner.cardLinkReviewSource
  h.api.onReviewModeBranch({ tag: 1 })
  assert.equal(oldSource, h.owner.cardLinkReviewSource)
  assert.equal(oldSource.superview, h.owner.cardLinkReviewEntranceHost)
  assert.equal(h.owner.cardLinkReviewSource.alpha, 1)
  assert.equal(h.owner.cardLinkReviewDropdown.alpha, 1)
  const animated = h.calls.animations
  h.calls.reducedMotion = true
  h.api.onReviewModeExpand()
  assert.equal(h.calls.animations, animated)
  assert.equal(h.owner.cardLinkAnnotationToolbarSvg, undefined)
  assert.equal(h.owner.cardLinkReviewToolbar.backgroundColor.hex, 'clearColor')
  assert.equal(h.owner.cardLinkReviewToolbar.layer.cornerRadius, 0)
  assert.equal(h.owner.cardLinkReviewSource, undefined)
})

test("分类收起保留旧来源和列表到淡出完成，再移除视图", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  await new Promise(resolve => setImmediate(resolve))
  const source = h.owner.cardLinkReviewSource, dropdown = h.owner.cardLinkReviewDropdown
  assert.equal(dropdown.backgroundColor.hex, 'whiteColor')
  assert.equal(dropdown.backgroundColor.alpha, 0.58)
  assert.equal(dropdown.layer.borderWidth, 0.5)
  assert.equal(dropdown.layer.borderColor.alpha, 0.75)
  assert.equal(source.backgroundColor.hex, 'clearColor')
  assert.equal(source.layer.cornerRadius, 0)
  h.calls.deferAnimation = true
  h.calls.animationEnds = []
  h.api.onReviewModeExpand()
  assert.ok(source.superview)
  assert.ok(dropdown.superview)
  assert.equal(source.userInteractionEnabled, false)
  assert.equal(dropdown.userInteractionEnabled, false)
  assert.equal(source.alpha, 0)
  assert.equal(dropdown.alpha, 0)
  assert.equal(h.calls.animationEnds.length, 1)
  h.calls.animationEnds[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(source.superview, undefined)
  assert.equal(dropdown.superview, undefined)
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
})
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
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.writes.length, 1)
  await new Promise(resolve => setImmediate(resolve))
  reject(new Error("write failed"))
  await pending
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.answerCardReviewButtons[0].enabled, true)
  assert.match(h.calls.hud, /保存失败/)
})

test('批注模式不创建答案等级胶囊，旧评分回调不展开或写入，悬浮条仍可评分', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.answer('a')
  assert.equal(h.owner.answerCardReviewControls, undefined)
  assert.equal(h.owner.answerCardReviewToggleButton, undefined)
  assert.equal(h.owner.answerReviewDismissHost, undefined)
  await h.api.onReviewModeResult({ tag: -1 })
  await h.api.onReviewModeResult({ tag: 1 })
  assert.equal(h.viewExports.selectAnswerReviewLevel(1), false)
  assert.equal(h.owner.answerReviewExpanded, false)
  assert.equal(h.calls.writes.length, 0)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true })
  await h.api.onReviewModeToolbarResult({ tag: 1 })
  assert.deepEqual(h.calls.writes, [['a', 1]])
})

test('脑图切换批注时隐藏已有答案胶囊及点击面，回到脑图仍恢复原评分', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  h.answer('a')
  await h.api.onReviewModeResult({ tag: -1 })
  const visual = h.owner.answerCardReviewControls
  assert.equal(h.owner.answerReviewExpanded, true)
  assert.ok(h.owner.answerReviewDismissHost)
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.answer('a')
  assert.equal(visual.hidden, true)
  assert.equal(h.owner.answerReviewExpanded, false)
  assert.equal(h.owner.answerReviewDismissHost, undefined)
  assert.equal(h.owner.answerCardReviewToggleButton.hidden, true)
  assert.equal(h.owner.answerCardReviewToggleButton.enabled, false)
  assert.ok(h.owner.answerCardReviewButtons.every((button: any) => button.hidden && !button.enabled))
  h.api.discardReviewMode(h.owner)
  await h.api.startReviewMode(h.items, h.owner)
  h.answer('a')
  assert.equal(visual.hidden, false)
  assert.equal(h.owner.answerCardReviewToggleButton.enabled, true)
  await h.api.onReviewModeResult({ tag: 1 })
  await h.api.onReviewModeResult({ tag: 1 })
  assert.deepEqual(h.calls.writes, [['a', 1]])
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
  orient(h, true)
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
  await new Promise(resolve => setImmediate(resolve))
  reject(new Error('failed'))
  await first
  await new Promise(resolve => setImmediate(resolve))
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
  await new Promise(resolve => setImmediate(resolve))
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


test("共用工具条承接拖动，分类路径和下拉不继承拖动手势", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  orient(h, true)
  h.api.onReviewModeExpand()
  const bar = h.owner.cardLinkReviewToolbar
  assert.equal(bar.gestures.length, 1)
  assert.equal(h.owner.cardLinkReviewIndexButton.gestures.length, 0)
  assert.equal(h.owner.cardLinkReviewSource.superview, bar.superview)
  assert.equal(h.owner.cardLinkReviewSource.gestures.length, 0)
  h.api.onReviewModeBranch({ tag: 0 })
  assert.equal(h.owner.cardLinkReviewDropdown.superview, bar.superview)
  assert.equal(h.owner.cardLinkReviewDropdown.gestures.length, 0)
})


test("来源紧凑递进、删除详情入口；开合动画结束不误删新下拉", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  orient(h, true)
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
  orient(h, true)
  h.calls.reducedMotion = true
  h.calls.animations = 0
  h.api.onReviewModeExpand()
  h.api.onReviewModeNext()
  assert.ok(h.owner.cardLinkReviewToolbar.frame.width > 180)
  assert.ok(h.owner.cardLinkReviewDropdown.frame.height > 1)
  assert.equal(h.calls.animations || 0, 0)
})


test("横排分类切换和路径滚动保持下拉锚点及整体宽度稳定", async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  orient(h, true)
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
  h.owner.cardLinkReviewSource.contentOffset = { x: 12, y: 0 }
  h.api.onReviewModeBranch({ tag: 1 })
  const source = h.owner.cardLinkReviewSource
  const button = source.children.find((v: any) => v.tag === 1)
  const initial = { ...h.owner.cardLinkReviewDropdown.frame }
  assert.equal(initial.x + initial.width, h.owner.cardLinkReviewSource.frame.x)
  h.api.onReviewModeBranch({ tag: 0 })
  assert.equal(h.owner.cardLinkReviewDropdown.frame.x, initial.x)
  assert.equal(h.owner.cardLinkReviewDropdown.frame.width, initial.width)
  assert.equal(source.frame.y, 0)
  assert.ok(h.owner.cardLinkReviewDropdown.frame.y >= 44)
  h.api.onReviewModeNext()
  assert.equal(h.owner.cardLinkReviewDropdown.frame.x + h.owner.cardLinkReviewDropdown.frame.width, h.owner.cardLinkReviewSource.frame.x)
})

test("今日反馈驱动进度、序号列表勾选和来源颜色；当前蓝色优先", async () => {
  const h = harness()
  h.calls.records = { a: { lastReviewedAt: new Date().toISOString() }, b: { lastReviewedAt: new Date().toISOString() } }
  await h.api.startReviewMode(h.items, h.owner)
  orient(h, true)
  const svg = h.owner.cardLinkReviewProgressSvgView
  assert.ok(svg.html.includes('class="progress-value"'))
  assert.equal(Number(runProgressPage(svg).progress.attributes['stroke-dashoffset']), 0)
  assert.equal(h.owner.cardLinkReviewAnnotationNumber.text, '1')
  h.api.onReviewModeIndex()
  assert.ok(h.calls.selectedRows.every((row: string) => row.endsWith(' ✅')))
  h.api.onReviewModeExpand()
  h.api.onReviewModeBranch({tag:0})
  const rows = h.owner.cardLinkReviewDropdown.children[0].children.filter((v: any) => v.title)
  assert.equal(rows[0].backgroundColor.hex, "blue")
  assert.equal(rows[0].backgroundColor.alpha, 0.2)
  assert.equal(rows[0].titleColor.hex, "blue")
  assert.equal(rows[1].backgroundColor.hex, "green")
  assert.equal(rows[1].titleColor.hex, "#172033")
  h.api.onReviewModeControlPress(rows[0])
  h.api.onReviewModeControlRelease(rows[0])
  assert.equal(rows[0].backgroundColor.hex, "blue")
  h.calls.records.b.lastReviewedAt = new Date(Date.now() - 86400000).toISOString()
  h.api.restoreReviewModeToolbar()
  assert.equal(Number(runProgressPage(svg).progress.attributes['stroke-dashoffset']), 13 * Math.PI)
  h.api.onReviewModeIndex()
  assert.ok(!h.calls.selectedRows[1].endsWith(' ✅'))
  assert.equal(h.owner.cardLinkReviewDropdown.children[0].children.filter((v: any) => v.title)[1].titleColor.hex, "#172033")
})


test("答案窗口始终采用原生模式，调试设置不能重新启用插件手势", () => {
  const h = harness()
  const html = '<html><head><meta name="viewport" content="user-scalable=no"></head><body><script id="cardlink-preview-runtime">customGesture()</script></body></html>'
  h.calls.settings = { debugModeEnabled: true, debugAnswerPreviewMode: "native" }
  h.viewExports.showAnswerCard(html, h.owner)
  assert.equal(h.owner.answerCardWebView.scalesPageToFit, true)
  assert.doesNotMatch(h.owner.answerCardWebView.html, /customGesture/)
  assert.equal(h.owner.answerCardHtml, html, "保存原文以便切回")
  h.calls.settings.debugModeEnabled = false
  h.viewExports.refreshAnswerCard()
  assert.equal(h.owner.answerCardWebView.scalesPageToFit, true)
  assert.doesNotMatch(h.owner.answerCardWebView.html, /customGesture/)
})


test('手动打开反馈未选等级时点外部撤销下一题意图，已选等级则保留', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  h.owner.cardLinkReviewDismissClassification()
  await new Promise(resolve => setImmediate(resolve))
  const current = h.owner.cardLinkReviewMode
  assert.equal(current.resultsVisible, false)
  assert.equal(current.annotationIntent, undefined)
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
  assert.equal(h.calls.writes.length, 0)
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  h.owner.cardLinkReviewDismissClassification()
  assert.equal(current.resultsVisible, true)
  assert.equal(current.annotationPendingLevel, 1)
  assert.equal(current.annotationIntent.kind, 'next')
  h.api.discardReviewMode()
})

test('编辑器完成后的未选反馈也可外部收起，复习条和当前题保留', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  h.owner.cardLinkReviewDismissClassification()
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewMode.branch, 0)
  assert.ok(h.owner.cardLinkReviewDropdown)
  h.api.onReviewModeNext()
  h.owner.cardLinkReviewDismissClassification()
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  assert.equal(h.calls.writes.length, 0)
  h.api.discardReviewMode()
})

test('下一题只展开等级，不提示已选择；再次点击收起且不写入', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const current = h.owner.cardLinkReviewMode, toolbar = h.owner.cardLinkReviewToolbar
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.resultsVisible, true)
  assert.equal(current.annotationPendingLevel, undefined)
  assert.doesNotMatch(h.calls.hud || '', /已选择/)
  h.api.onReviewModeNext()
  assert.equal(current.resultsVisible, false)
  assert.equal(current.annotationIntent, undefined)
  assert.equal(h.owner.cardLinkReviewDropdown, undefined)
  assert.equal(h.owner.cardLinkReviewToolbar, toolbar)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.annotations.length, 1)
  // The editor has finished: reopening and toggling feedback still works.
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.resultsVisible, true)
  h.api.onReviewModeNext()
  assert.equal(current.resultsVisible, false)
  h.api.onReviewModeNext()
  assert.equal(current.resultsVisible, true)
  h.api.discardReviewMode()
})

test('状态查询未返回时可反复开合，迟到回复或报错不会提示已选择或重开', async () => {
  for (const reject of [false, true]) {
    const h = harness()
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
    let settle!: (value?: any) => void
    h.calls.statusReply = new Promise((resolve, fail) => { settle = reject ? fail : resolve })
    h.api.onReviewModeNext()
    h.api.onReviewModeNext()
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
    h.api.onReviewModeNext()
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
    h.owner.cardLinkReviewDismissClassification()
    settle(reject ? new Error('late timeout') : { state: 'unknown' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
    assert.equal(h.owner.cardLinkReviewMode.annotationIntent, undefined)
    assert.equal(h.owner.cardLinkReviewMode.annotationChecking, false)
    assert.equal(h.owner.cardLinkReviewDropdown, undefined)
    assert.doesNotMatch(h.calls.hud || '', /已选择|同步失败/)
    assert.equal(h.calls.statusRequests.length, 1)
    assert.equal(h.calls.writes.length, 0)
    h.api.discardReviewMode()
  }
})

test('做题脑图标记成功自动推进，回看保留等级底色', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], 'root', true, 'mindmap', h.owner)
  assert.equal(h.calls.masks[0][1][0], 'a')
  assert.equal(h.owner.cardLinkReviewNumberDisk.backgroundColor.hex, '#ffffff')
  h.api.onReviewModeMark()
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.deepEqual(ratingButtons(h).map(v => v.title), ['不会', '不熟', '掌握'])
  assert.equal(h.calls.marks, undefined)
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.deepEqual(h.calls.marks, [['book', 'a', 1]])
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  await h.api.goToPracticeQuestion('a', h.owner)
  assert.equal(h.owner.cardLinkReviewNumberDisk.backgroundColor.hex, 'orange')
  assert.equal(runProgressPage(h.owner.cardLinkReviewProgressSvgView).progress.style.stroke, '#ffffff')
  await h.api.goToPracticeQuestion('b', h.owner)
  assert.equal(h.owner.cardLinkReviewNumberDisk.backgroundColor.hex, '#ffffff')
  await h.api.goToPracticeQuestion('a', h.owner)
  assert.equal(h.owner.cardLinkReviewNumberDisk.backgroundColor.hex, 'orange')
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.fsrsWrites, undefined)
})

test('普通批注做题下一题默认会了，不标错、不弹反馈，重复回执只推进一次', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  h.api.onReviewModeNext()
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  const event = { ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' }
  h.owner.cardLinkReviewAnnotationClosed(event)
  h.owner.cardLinkReviewAnnotationClosed(event)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.verdicts.length, 1)
  assert.equal(h.calls.verdicts[0].self, 'got')
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
})


test('做题批注手动跳转等待关闭，跳过的题不记完成并复用本轮作答纸', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  await h.api.goToPracticeQuestion('b', h.owner)
  assert.equal(h.calls.annotations.length, 1)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper-a' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewMode.completed.a, undefined)
  await h.api.goToPracticeQuestion('a', h.owner)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'finish', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations[2].commentId, undefined)
  assert.equal(h.calls.writes.length, 0)
})

test('做题批注打开结果不确定时保留会话，迟到关闭回执仍能推进', async () => {
  const h = harness()
  h.calls.openError = new Error('timeout')
  const result = await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  assert.equal(result.started, false)
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, 'uncertain')
  assert.equal(h.calls.annotations.length, 1)
  h.calls.openError = undefined
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.annotations.length, 2)
  assert.equal(h.calls.writes.length, 0)
})

test('做题与复习按实际模式挂载按钮并保持入口回调、分类和拖动换向', async () => {
  for (const purpose of ['practice', 'review']) for (const writing of ['mindmap', 'annotation']) {
    const h = harness()
    if (purpose === 'practice') await h.api.startPracticeMode('book', ['a', 'b'], 'root', false, writing, h.owner)
    else await h.api.startReviewMode(h.items, h.owner, 'fixed', writing)
    const buttons = h.owner.cardLinkReviewAnnotationButtons
    const separate = purpose === 'practice', feedbackOnly = separate && writing === 'annotation'
    assert.equal(buttons.length, writing === 'annotation' || separate ? 8 : 7)
    const exitIndex = buttons.length - 1
    if (separate) assert.match(buttons[feedbackOnly ? 3 : 4].image.path, /mark\.png$/)
    assert.ok(h.calls.targets.some((v: any) => v.action === 'onMnutilsQuickMenuOpenPanel:'))
    assert.match(buttons[0].image.path, /logo\.png$/)
    if (!feedbackOnly) assert.match(buttons[3].image.path, new RegExp(`/${writing === 'mindmap' ? 'forward' : 'next'}\\.png$`))
    else assert.ok(buttons.every((button: any) => button.accessibilityLabel !== '下一题'))
    assert.match(buttons[exitIndex].image.path, /exit\.png$/)
    const session = h.owner.cardLinkReviewMode
    orient(h, true)
    const exitX = buttons[exitIndex].frame.x
    const animations = h.calls.animations
    h.api.onReviewModeExpand()
    assert.ok(buttons[exitIndex].frame.x > exitX)
    assert.equal(buttons[exitIndex].frame.x, h.owner.cardLinkReviewSource.frame.x + h.owner.cardLinkReviewSource.frame.width)
    assert.ok(h.calls.animations > animations)
    assert.equal(h.owner.cardLinkReviewDropdown, undefined)
    h.api.onReviewModeBranch({ tag: 0 })
    assert.ok(h.owner.cardLinkReviewDropdown)
    orient(h, false)
    assert.equal(h.owner.cardLinkReviewMode, session)
    assert.equal(h.owner.cardLinkReviewAnnotationButtons[exitIndex], buttons[exitIndex])
    assert.equal(buttons[exitIndex].frame.x, 0)
    assert.ok(buttons[exitIndex].frame.y > 0)
    h.api.discardReviewMode()
  }
})

test('批注完成回执与手动标记并发时等保存后仅推进一次', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], 'root', false, 'annotation', h.owner)
  let finish!: () => void
  h.calls.markWait = new Promise<void>(resolve => { finish = resolve })
  h.api.onReviewModeMark()
  const saving = h.api.onReviewModeToolbarResult({ tag: 0 }, h.owner)
  const event = { ...h.calls.annotations[0], action: 'next', saved: true }
  h.owner.cardLinkReviewAnnotationClosed(event)
  h.owner.cardLinkReviewAnnotationClosed(event)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  finish()
  await saving
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.annotations.length, 2)
  assert.deepEqual(h.calls.marks, [['book', 'a', 0]])
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
})

test('做题启动失败保留底层原因并清理半启动状态，修正条件后可重试', async () => {
  const h = harness()
  h.calls.practiceFailure = '无法定位当前脑图卡片的遮盖位置'
  const result = await h.api.startPracticeMode('book', ['a'], 'root', true, 'mindmap', h.owner)
  assert.equal(result.started, false)
  assert.equal(result.reason, h.calls.practiceFailure)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  h.calls.practiceFailure = undefined
  assert.equal((await h.api.startPracticeMode('book', ['a'], 'root', true, 'mindmap', h.owner)).started, true)
})

test('做题标记失败保留原题和选择框，不更新颜色', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a'], 'root', false, 'mindmap', h.owner)
  h.calls.markError = true
  h.api.onReviewModeMark()
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.owner.cardLinkReviewNumberDisk.backgroundColor.hex, '#ffffff')
  assert.match(h.calls.hud, /标记错题失败/)
})

test('横排分类保持展开；外部关闭下拉、标记和切题均不收起路径，按钮可主动收起', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], 'root', false, 'mindmap', h.owner)
  orient(h, true)
  h.api.onReviewModeExpand()
  const category = h.owner.cardLinkReviewAnnotationButtons[6]
  assert.match(category.image.path, /collapse\.png$/)
  h.api.onReviewModeBranch({ tag: 0 })
  h.owner.cardLinkReviewDismissClassification()
  assert.equal(h.owner.cardLinkReviewMode.expanded, true)
  assert.equal(h.owner.cardLinkReviewMode.branch, undefined)
  assert.ok(h.owner.cardLinkReviewSource)
  h.api.onReviewModeMark()
  assert.equal(h.owner.cardLinkReviewMode.expanded, true)
  assert.equal(h.owner.cardLinkReviewDropdown.frame.y, 50)
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  await h.api.goToPracticeQuestion('a', h.owner)
  assert.equal(h.owner.cardLinkReviewMode.expanded, true)
  const progress = runProgressPage(h.owner.cardLinkReviewProgressSvgView)
  assert.equal(progress['progress-disk'].style.fill, 'orange')
  assert.equal(progress.progress.style.stroke, '#ffffff')
  const index = h.owner.cardLinkReviewIndexButton
  assert.equal(index.children.at(-1), h.owner.cardLinkReviewAnnotationNumber, '序号位于圆环 WebView 上方')
  assert.equal(h.owner.cardLinkReviewAnnotationNumber.backgroundColor.hex, 'clearColor')
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewMode.completed.a, true)
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  assert.equal(h.owner.cardLinkReviewMode.expanded, true)
  assert.equal(h.calls.marks.length, 1)
  h.api.onReviewModeExpand()
  assert.equal(h.owner.cardLinkReviewMode.expanded, false)
  assert.match(category.image.path, /category\.png$/)
})

test('分类收起时底板提交与图标同处一个动画，不等淡出后第二次收缩', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'mindmap')
  orient(h, true)
  h.api.onReviewModeExpand()
  await new Promise(resolve => setImmediate(resolve))
  h.calls.deferAnimation = true
  h.calls.animationEnds = []
  const before = h.calls.commits.length
  h.api.onReviewModeExpand()
  assert.equal(h.calls.commits.length, before + 1)
  assert.deepEqual(h.calls.commits.at(-1), { animated: false, inAnimation: true })
  const count = h.calls.commits.length
  h.calls.animationEnds[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.commits.length, count)
})

test('做题标记随实际错题状态切换为复习反馈对号，下一题保持独立', async () => {
  for (const writing of ['mindmap', 'annotation']) {
    const h = harness()
    h.calls.records = { 'book:a': { recordId: 'book:a', level: 1 } }
    await h.api.startPracticeMode('book', ['a', 'b'], 'root', false, writing, h.owner)
    const index = writing === 'annotation' ? 3 : 4
    const mark = h.owner.cardLinkReviewAnnotationButtons[index]
    assert.match(mark.image.path, /next\.png$/)
    assert.equal(mark.accessibilityLabel, '复习反馈')
    if (writing === 'mindmap') assert.match(h.owner.cardLinkReviewAnnotationButtons[3].image.path, /forward\.png$/)
    h.api.onReviewModeMark()
    await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
    if (writing === 'mindmap') assert.deepEqual(h.calls.writes, [['book:a', 2]])
    else assert.equal(h.calls.writes.length, 0)
    assert.equal(h.owner.cardLinkReviewMode.index, writing === 'mindmap' ? 1 : 0)
    if (writing === 'annotation') {
      h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true })
      await new Promise(resolve => setImmediate(resolve))
    } else await h.api.goToPracticeQuestion('b', h.owner)
    assert.deepEqual(h.calls.writes, [['book:a', 2]])
    assert.match(mark.image.path, /mark\.png$/)
    assert.equal(mark.accessibilityLabel, '标记错题')
    h.api.onReviewModeMark()
    await h.api.onReviewModeToolbarResult({ tag: 0 }, h.owner)
    if (writing === 'mindmap') { assert.equal(h.owner.cardLinkReviewMode, undefined); continue }
    assert.equal(h.calls.marks?.length || 0, 0)
    h.api.discardReviewMode()
  }
})

test('切题等待定位期间不闪暗、不重挂序号或同路径分类；横排没有阴影', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b', 'c'], 'root', false, 'mindmap', h.owner)
  orient(h, true)
  h.api.onReviewModeExpand()
  const source = h.owner.cardLinkReviewSource
  const number = h.owner.cardLinkReviewAnnotationNumber
  const progress = h.owner.cardLinkReviewProgressSvgView
  const toolbar = h.owner.cardLinkReviewToolbar
  let removals = 0
  for (const view of [source, number, progress, toolbar]) {
    const remove = view.removeFromSuperview.bind(view)
    view.removeFromSuperview = () => { removals++; remove() }
  }
  let finish!: () => void
  h.calls.focusWait = new Promise<void>(resolve => { finish = resolve })
  const pending = h.api.goToPracticeQuestion('b', h.owner)
  assert.equal(h.owner.cardLinkReviewMode.navigating, true)
  for (const i of [1, 2, 3, 4, 5, 7]) {
    const button = h.owner.cardLinkReviewAnnotationButtons[i]
    assert.equal(button.enabled, false)
    assert.equal(button.alpha, 1)
    assert.equal(button.adjustsImageWhenDisabled, false)
  }
  assert.equal(number.text, '2')
  assert.equal(removals, 0)
  assert.equal(h.owner.cardLinkReviewSource, source)
  assert.equal(toolbar.layer.shadowOpacity, 0)
  finish()
  await pending
  assert.equal(removals, 0)
  assert.equal(h.owner.cardLinkReviewAnnotationNumber, number)
  assert.equal(progress.loads, 1)
  assert.equal(h.owner.cardLinkReviewAnnotationButtons[3].alpha, 1)
  h.api.onReviewModeBranch({ tag: 1 })
  assert.equal(h.owner.cardLinkReviewSource, source)
  assert.equal(source.cardLinkBranchButtons[1].backgroundColor.hex, 'blue')
  h.api.onReviewModeBranch({ tag: 0 })
  assert.equal(source.cardLinkBranchButtons[1].backgroundColor.hex, 'clearColor')
  assert.equal(source.cardLinkBranchButtons[0].backgroundColor.hex, 'blue')
  h.owner.cardLinkReviewMode.items[2].sourceRootNodeId = 'different'
  await h.api.goToPracticeQuestion('c', h.owner)
  assert.notEqual(h.owner.cardLinkReviewSource, source, '真正换分类时才替换来源视图')
  assert.equal(h.owner.cardLinkReviewAnnotationNumber, number)
})

test('新复习会话与本轮新书写都不继承旧作答纸', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(h.calls.annotations[0].newAttempt, true)
  assert.equal(h.calls.annotations[0].commentId, undefined)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: true, commentId: 'round-one' })
  await new Promise(resolve => setImmediate(resolve))
  h.api.onReviewModeWrite()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations[1].newAttempt, true)
  assert.equal(h.calls.annotations[1].commentId, undefined)
  h.api.discardReviewMode()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(h.calls.annotations[2].newAttempt, true)
  assert.equal(h.calls.annotations[2].commentId, undefined)
})

test('模板缺配置时阻止复习，不新建普通批注或写反馈', async () => {
  const h = harness()
  h.calls.practiceUnavailable = true
  const result = await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(result.started, false)
  assert.match(result.reason, /模板/)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.annotations?.length || 0, 0)
  assert.equal(h.calls.verdicts?.length || 0, 0)
})

test('新做题会话不继续上轮批注，保存记录本轮实际查看答案状态', async () => {
  const h = harness()
  for (const round of [1, 2]) {
    await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
    const target = h.calls.annotations[h.calls.annotations.length - 1]
    assert.equal(target.newAttempt, true)
    assert.equal(target.commentId, undefined)
    h.owner.cardLinkReviewMode.answerChecked[h.owner.cardLinkReviewMode.items[0].recordId] = round === 1
    h.owner.cardLinkReviewAnnotationClosed({ ...target, action: 'closed', saved: true, commentId: `round-${round}` })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.checked[h.calls.checked.length - 1][2], round === 1)
    h.api.discardReviewMode()
  }
})


test('模板检测失败保留已有脑图会话，不替换为普通批注', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner)
  const previous = h.owner.cardLinkReviewMode
  h.calls.configError = true
  const result = await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(result.started, false)
  assert.equal(h.owner.cardLinkReviewMode, previous)
  assert.equal(h.calls.annotations?.length || 0, 0)
})

test('做题也必须通过模板配置检查，失败时不打开批注或改成绩', async () => {
  const h = harness()
  h.calls.practiceUnavailable = true
  const result = await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  assert.equal(result.started, false)
  assert.match(h.calls.hud, /导入.*模板/)
  assert.equal(h.calls.annotations?.length || 0, 0)
  assert.equal(h.calls.marks?.length || 0, 0)
})


test('结果反馈仅对已有错题展示与实际固定曲线一致的天数', async () => {
  for (const practice of [false, true]) {
    const h = harness()
    h.calls.settings = { mistakeReviewCurves: { 0: [1, 4, 8], 1: [2, 6], 2: [14] } }
    h.calls.records = { a: { level: 0, reviewCount: 0 } }
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation', practice ? { maskAnswers: false } : undefined)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: false })
    await new Promise(resolve => setImmediate(resolve))
    if (practice) h.api.onReviewModeMark()
    else h.api.onReviewModeNext()
    assert.deepEqual(ratingButtons(h).slice(0, 3).map(v => v.title), ['不会 +4天', '不熟 +2天', '掌握 +14天'])
    h.calls.records = {}
    if (practice) h.api.onReviewModeMark()
    else h.api.onReviewModeNext()
    if (practice) h.api.onReviewModeMark()
    else h.api.onReviewModeNext()
    assert.deepEqual(ratingButtons(h).slice(0, 3).map(v => v.title), ['不会', '不熟', '掌握'])
  }
})


test('智能复习错题反馈显示各等级预估天数，跳过不显示', async () => {
  const h = harness()
  h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: 'fsrs' }
  h.calls.records = { a: { level: 0, reviewCount: 0 } }
  ;(h.items[0] as any).preview = [0, 1, 2, 3].map((rating, i) => ({ rating, days: i + 1 }))
  await h.api.startReviewMode(h.items, h.owner, 'fsrs', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  h.api.onReviewModeNext()
  assert.deepEqual(ratingButtons(h).map(v => v.title), ['不会 +1天', '不熟 +2天', '良好 +3天', '掌握 +4天', '重新打开批注窗口'])
})


test('答案窗口等级不显示错题天数，普通题同样不显示', async () => {
  const h = harness()
  h.calls.records = { a: { level: 0, reviewCount: 0 } }
  await h.api.startReviewMode(h.items, h.owner)
  h.answer("a")
  assert.equal(h.owner.answerCardReviewButtons[0].accessibilityLabel, '复习结果：不会')
  h.calls.records = {}
  h.viewExports.syncAnswerReviewControls()
  assert.equal(h.owner.answerCardReviewButtons[0].accessibilityLabel, '复习结果：不会')
})


test('旧作答未判定且模板缺配置时只提示，不改判旧题也不开普通批注', async () => {
  const h = harness()
  h.calls.practiceUnavailable = true
  h.calls.savedPapers = [{ commentId: 'old', practice: { self: null } }]
  const result = await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  assert.equal(result.started, false)
  assert.equal(h.calls.annotations?.length || 0, 0)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.deepEqual(h.calls.operations, ['practice-config'])
})

test('其他插件或学习集的未反馈作答不会被新做题改判', async () => {
  const h = harness()
  h.calls.savedPapers = [
    { commentId: 'foreign', cardAnnotation: true, practice: { addon: 'mn.cardpractice', topic: 'book' } },
    { commentId: 'other-book', cardAnnotation: true, practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'other' } }
  ]
  await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.equal(h.calls.annotations.length, 1)
})


test('拖动实时转向仅跨缓冲区时重排，保持同方向不提交布局、不启用动画', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.mnutilsEntranceDragging = true
  const bounds = { width: 1024, height: 768 }
  const initial = h.calls.commits.length
  for (const y of [199, 201, 190, 210]) h.api.updateReviewToolbarOrientation(h.owner, { x: 200, y }, bounds)
  assert.equal(h.calls.commits.length, initial)
  h.api.updateReviewToolbarOrientation(h.owner, { x: 200, y: 170 }, bounds)
  assert.equal(h.owner.cardLinkReviewMode.annotationHorizontal, true)
  assert.equal(h.calls.commits.length, initial + 1)
  assert.equal(h.calls.commits.at(-1).animated, false)
  assert.equal(h.calls.commits.at(-1).inAnimation, false)
  for (const y of [175, 195, 215]) h.api.updateReviewToolbarOrientation(h.owner, { x: 200, y }, bounds)
  assert.equal(h.calls.commits.length, initial + 1)
  h.api.updateReviewToolbarOrientation(h.owner, { x: 200, y: 230 }, bounds)
  assert.equal(h.owner.cardLinkReviewMode.annotationHorizontal, false)
  assert.equal(h.calls.commits.length, initial + 2)
})

test('切题遇到长短分类名称，所有主控帧不变，名称只在右侧滚动视口变化', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], 'root', false, 'mindmap', h.owner)
  const current = h.owner.cardLinkReviewMode
  current.items[1].sourceRootTitle = '一个很长很长的分类名称，需要在分类区域内横向滚动'
  let availableWidth = 420
  h.owner.cardLinkReviewEntranceLimits = () => ({ width: availableWidth, height: 700, coreWidth: 352 })
  orient(h, true)
  const frames = h.owner.cardLinkReviewAnnotationButtons.slice(0, -1).map((b: any) => ({ ...b.frame }))
  h.api.onReviewModeExpand()
  assert.deepEqual(h.owner.cardLinkReviewAnnotationButtons.slice(0, -1).map((b: any) => ({ ...b.frame })), frames)
  await h.api.goToPracticeQuestion('b', h.owner)
  const source = h.owner.cardLinkReviewSource
  assert.deepEqual(h.owner.cardLinkReviewAnnotationButtons.slice(0, -1).map((b: any) => ({ ...b.frame })), frames)
  assert.equal(source.frame.x, 308)
  assert.ok(source.frame.width <= 68)
  assert.ok(source.contentSize.width > source.frame.width)
  assert.equal(source.scrollEnabled, true)
  assert.ok(source.cardLinkBranchButtons.some((b: any) => b.title.includes('横向滚动')))
  const progressCalls = h.owner.cardLinkReviewProgressSvgView.scripts.length
  availableWidth = 400
  h.owner.mnutilsEntranceDragging = true
  h.api.updateReviewToolbarOrientation(h.owner, { x: 500, y: 0 }, { width: 1024, height: 768 })
  assert.equal(h.owner.cardLinkReviewSource, source)
  assert.equal(source.frame.width, 48)
  assert.equal(h.owner.cardLinkReviewProgressSvgView.scripts.length, progressCalls)
  assert.deepEqual(h.owner.cardLinkReviewAnnotationButtons.slice(0, -1).map((b: any) => ({ ...b.frame })), frames)
  h.owner.mnutilsEntranceDragging = false
  await h.api.goToPracticeQuestion('a', h.owner)
  assert.deepEqual(h.owner.cardLinkReviewAnnotationButtons.slice(0, -1).map((b: any) => ({ ...b.frame })), frames)
})

test('展开按当前位置自适应横竖，右侧竖条分类向左、底部横条列表向上', async () => {
  const right = harness()
  await right.api.startReviewMode(right.items, right.owner)
  right.owner.cardLinkReviewEntrancePlacement = () => ({ point: { x: 990, y: 380 }, bounds: { width: 1024, height: 768 } })
  right.owner.cardLinkReviewEntranceLimits = () => ({ width: 1004, height: 400, left: 900, right: 12, above: 300, below: 100 })
  right.api.onReviewModeExpand()
  assert.equal(right.owner.cardLinkReviewMode.annotationHorizontal, false)
  assert.ok(right.owner.cardLinkReviewSource.frame.x < 0)
  assert.ok(right.owner.cardLinkReviewDropdown.frame.x < 0)
  const bottom = harness()
  await bottom.api.startReviewMode(bottom.items, bottom.owner)
  bottom.owner.cardLinkReviewEntrancePlacement = () => ({ point: { x: 500, y: 740 }, bounds: { width: 1024, height: 768 } })
  bottom.owner.cardLinkReviewEntranceLimits = () => ({ width: 800, height: 60, coreWidth: 308, left: 200, right: 500, above: 600, below: 8 })
  bottom.api.onReviewModeExpand()
  assert.equal(bottom.owner.cardLinkReviewMode.annotationHorizontal, true)
  bottom.api.onReviewModeBranch({ tag: 0 })
  const list = bottom.owner.cardLinkReviewDropdown.frame
  assert.ok(list.y < 0)
  assert.equal(list.y + list.height, -6)
})


test('每轮批注做题或复习只检测一次配置，切题不重复检测，新一轮重新检测', async () => {
  for (const practice of [false, true]) {
    const h = harness()
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation', practice ? { maskAnswers: false } : undefined)
    assert.equal(h.owner.cardLinkReviewMode.annotationVerdictMode, 'native')
    assert.equal(h.calls.hudMessages?.length || 0, 0)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: true, commentId: 'first' })
    await new Promise(resolve => setImmediate(resolve))
    await h.api.goToPracticeQuestion('b', h.owner)
    assert.deepEqual(h.calls.operations, ['practice-config'])
    assert.equal((h.calls.hudMessages || []).filter((s: string) => s.includes('请点批注窗口')).length, 0)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations.at(-1), action: 'closed', saved: false })
    await new Promise(resolve => setImmediate(resolve))
    h.api.discardReviewMode(h.owner)
    h.calls.practiceAvailable = true
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation', practice ? { maskAnswers: false } : undefined)
    assert.deepEqual(h.calls.operations, ['practice-config', 'practice-config'])
    assert.equal(h.owner.cardLinkReviewMode.annotationVerdictMode, 'native')
    assert.equal(h.calls.hudMessages?.length || 0, 0)
    assert.equal(h.calls.annotations.at(-1).ordinary, false)
  }
})

test('检测失败说明原因并停止批注；脑图无需模板判定', async () => {
  const h = harness()
  h.calls.configError = true
  const result = await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  assert.equal(result.started, false)
  assert.match(h.calls.hud, /检测失败/)
  assert.equal(h.calls.annotations?.length || 0, 0)
  const other = harness()
  await other.api.startReviewMode(other.items, other.owner, 'fixed', 'mindmap')
  assert.equal(other.calls.operations?.length || 0, 0)
})

test('有配置的复习使用原生判定，保存成功后推进，不写普通批注本地反馈', async () => {
  for (const [level, verdict] of [[0, 'again'], [1, 'again'], [2, 'got']] as const) {
    const h = harness()
    h.calls.practiceAvailable = true
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
    assert.equal(h.calls.annotations[0].ordinary, false)
    assert.equal(h.calls.annotations[0].newAttempt, true)
    assert.equal(h.calls.annotations[0].commentId, undefined)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'first' })
    await new Promise(resolve => setImmediate(resolve))
    await h.api.onReviewModeToolbarResult({ tag: level }, h.owner)
    assert.equal(h.calls.verdicts.length, 1)
    assert.equal(h.calls.verdicts[0].self, verdict)
    assert.equal(h.calls.verdicts[0].commentId, 'first')
    assert.equal(h.owner.cardLinkReviewMode.index, 1)
    assert.equal(h.calls.attempts?.length || 0, 0)
    assert.equal(h.calls.operations.filter((op: string) => op === 'practice-config').length, 1)
  }
})

test('原生判定失败留在当前题，重试成功才保存复习记录，不自动切换模式或重开编辑器', async () => {
  const h = harness()
  h.calls.practiceAvailable = true
  h.calls.verdictError = true
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'first' })
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.annotations.length, 1)
  h.calls.verdictError = false
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.annotations.at(-1).ordinary, false)
})

test('原生判定成功但本地复习保存失败，重试不重复提交相同原生判定', async () => {
  const h = harness()
  h.calls.practiceAvailable = true
  h.setSave(async () => { throw new Error('local failed') })
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'first' })
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  h.setSave(async () => ({ level: 2, reviewCount: 1 }))
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.calls.verdicts.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
})

test('有配置的做题先选等级再关闭时补交原生判定，失败保留反馈并可重试', async () => {
  for (const failed of [false, true]) {
    const h = harness()
    h.calls.practiceAvailable = true
    h.calls.verdictError = failed
    await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
    h.owner.cardLinkReviewMode.resultsVisible = true
    await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
    assert.equal(h.calls.verdicts?.length || 0, 0)
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'first' })
    await new Promise(resolve => setImmediate(resolve))
    if (failed) {
      assert.equal(h.owner.cardLinkReviewMode.index, 0)
      assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
      assert.equal(h.calls.annotations.length, 1)
      h.calls.verdictError = false
      await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
    }
    assert.equal(h.owner.cardLinkReviewMode.index, 1)
    assert.equal(h.calls.verdicts.at(-1).self, 'again')
  }
})


test('配置检测完成前不能抢先打开题目，检测期间退出后不再打开或提示', async () => {
  const h = harness()
  let release!: () => void
  h.calls.configWait = new Promise<void>(resolve => { release = resolve })
  const pending = h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await new Promise(resolve => setImmediate(resolve))
  await h.api.goToPracticeQuestion('b', h.owner)
  assert.equal(h.calls.annotations?.length || 0, 0)
  h.api.discardReviewMode(h.owner)
  release()
  const result = await pending
  assert.equal(result.started, false)
  assert.equal(h.calls.annotations?.length || 0, 0)
  assert.equal(h.calls.hudMessages?.length || 0, 0)
})

test('默认会了保存失败留在本题，重试下一题成功后推进且不标错', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  h.calls.verdictError = true
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.answerChecked.a, undefined)
  assert.equal(h.calls.checked.at(-1)[2], false, 'failed default verdict must not mark the answer checked')
  h.calls.verdictError = false
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.deepEqual(h.calls.checked.at(-1), ['a', 'paper', true])
  assert.equal(h.owner.cardLinkReviewMode.savedFeedback.a.answerChecked, true)
  assert.equal(h.calls.marks?.length || 0, 0)
})


test('已关闭批注的回执可在点等级时补收，不弹请先完成提示，也不重复模板检测', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  h.calls.closedReceipt = { ...h.calls.annotations[0], action: 'closed', saved: false }
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.hudMessages?.length || 0, 0)
  assert.equal(h.calls.operations.filter((op: string) => op === 'practice-config').length, 1)
})


test('历史继续在书写时排队，当前保存和反馈后才续写，再回原队列', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  const first = h.calls.annotations[0], current = h.owner.cardLinkReviewMode
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('selected-history', true)
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(current.annotationToken, first.reviewToken)
  assert.equal(h.calls.statusPrompts, undefined)
  assert.equal(current.annotationContinuations.length, 1)
  h.owner.cardLinkReviewAnnotationClosed({ ...first, action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 1, '保存后仍须先完成当前等级反馈')
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.calls.annotations[1].commentId, 'selected-history')
  assert.equal(current.index, 0)
  assert.equal(current.visitFeedbackSaved, false)
  assert.equal(h.calls.writes.length, 1)
  h.owner.cardLinkReviewAnnotationClosed({ ...first, action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.annotationToken, h.calls.annotations[1].reviewToken, '旧回执不影响续写窗口')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'next', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.resultsVisible, true)
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(current.index, 1)
  assert.equal(h.calls.annotations[2].noteid, h.items[1].sourceNoteId)
  assert.equal(h.calls.writes.length, 2)
  assert.deepEqual(h.calls.verdicts.map((v: any) => v.commentId), ['new', 'selected-history'])
})

test('未知关闭状态下选择历史只入队，不要求恢复或重复打开', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.statusChoice = 0
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('chosen', true)
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.calls.statusPrompts, undefined)
  assert.equal(h.owner.cardLinkReviewMode.annotationContinuations[0].commentId, 'chosen')
})

test('先选等级再选择历史时先确认保存，新批注反馈不被预选等级跳过', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('after-grade', true)
  assert.equal(h.owner.cardLinkReviewMode.annotationPendingLevel, undefined)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.historySavePrompts, 1)
  assert.equal(h.calls.writes.length, 0)
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.calls.annotations[1].commentId, 'after-grade')
})

test('已保存但未评分时选择历史仍排队；反馈失败不能消耗续写任务', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('later', true)
  assert.equal(h.calls.annotations.length, 1)
  h.calls.verdictError = true
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.annotationContinuations.length, 1)
  assert.equal(h.calls.annotations.length, 1)
  h.calls.verdictError = false
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.calls.annotations[1].commentId, 'later')
})

test('多份历史按选择顺序续写，重复选择不重复排队，末题续写结束后才结算', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items.slice(0, 1), h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('old-one', true)
  await h.calls.historyResume('old-one', true)
  await h.calls.historyResume('old-two', true)
  const current = h.owner.cardLinkReviewMode
  assert.equal(current.annotationContinuations.length, 2)
  for (let index = 0; index < 3; index++) {
    const target = h.calls.annotations[index]
    h.owner.cardLinkReviewAnnotationClosed({ ...target, action: 'finish', saved: true, commentId: index ? target.commentId : 'new' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.reports.length, 0)
    await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  }
  assert.deepEqual(h.calls.annotations.slice(1).map((a: any) => a.commentId), ['old-one', 'old-two'])
  assert.equal(current.items.length, 1, '续写不重复计为新题')
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
})

test('明确未打开续写窗口时保留任务，下一题重试不重复提交当前成绩', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('retry-paper', true)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  h.calls.openError = Object.assign(new Error('not opened'), { editorMayBeOpen: false })
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  const current = h.owner.cardLinkReviewMode
  assert.equal(current.annotationContinuations.length, 1)
  assert.equal(current.visitFeedbackSaved, true)
  assert.equal(current.papers[h.items[0].recordId], 'new')
  assert.equal(h.calls.writes.length, 1)
  h.calls.openError = undefined
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations[h.calls.annotations.length - 1].commentId, 'retry-paper')
  assert.equal(current.annotationContinuations.length, 0)
  assert.equal(current.visitFeedbackSaved, false)
  assert.equal(h.calls.writes.length, 1)
})

test('做题空白新批注切历史不判定，历史续写未主动反馈仍默认会了', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('old-practice', true)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'finish', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.calls.annotations[1].commentId, 'old-practice')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'finish', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.calls.verdicts.map((verdict: any) => [verdict.commentId, verdict.self]), [['old-practice', 'got']])
  assert.deepEqual(h.calls.checked.filter((entry: any[]) => entry[2]), [['a', 'old-practice', true]])
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
  await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  assert.equal(h.calls.annotations.at(-1).newAttempt, true)
  assert.equal(h.calls.annotations.at(-1).commentId, undefined, 'a new round must not request the completed sheet')
  assert.equal(h.owner.cardLinkReviewMode.answerChecked.a, undefined, 'new attempts do not inherit the previous checked state')
})

test('做题排队历史主动选择等级仍标错，不被默认会了覆盖', async () => {
  const h = harness(), native = h.nativeAddon()
  await h.api.startPracticeMode('book', ['a'], undefined, false, 'annotation', h.owner)
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('old-practice', true)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'finish', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  await native.tap(nativeButton(h, '标记错题'))
  await native.tap(nativeButton(h, '不会'))
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'finish', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.verdicts.at(-1).commentId, 'old-practice')
  assert.equal(h.calls.verdicts.at(-1).self, 'again')
  assert.deepEqual(h.calls.marks, [['book', 'a', 0]])
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.reports.length, 1)
})

test('续写打开结果不确定时不重复发起，收到该任务回执后才继续', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('uncertain-paper', true)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  h.calls.openError = new Error('response lost')
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.annotationPhase, 'uncertain')
  assert.equal(h.owner.cardLinkReviewMode.annotationContinuations.length, 0)
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 2)
  h.calls.openError = undefined
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'next', saved: true, commentId: 'uncertain-paper' })
  await new Promise(resolve => setImmediate(resolve))
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.calls.writes.length, 2)
})

test('明确退出不执行已排队历史，迟到回执不能重开已结束会话', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('abandoned', true)
  h.api.onReviewModeExit(undefined, h.owner)
  const event = { ...h.calls.annotations[0], action: 'closed', saved: true, commentId: 'new' }
  h.owner.cardLinkReviewAnnotationClosed(event)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  assert.equal(h.calls.annotations.length, 1)
  h.owner.cardLinkReviewAnnotationClosed?.(event)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 1)
})

test('主动跳题取消未执行续写，取消当前批注本身不会自动开历史', async () => {
  const h = harness()
  await h.api.startPracticeMode('book', ['a', 'b'], undefined, false, 'annotation', h.owner)
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('cancel-paper', true)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'closed', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.annotationContinuations.length, 1)
  await h.api.goToPracticeQuestion('b', h.owner)
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
  assert.equal(h.owner.cardLinkReviewMode.annotationContinuations, undefined)
})

test('分类点击立即显示待切换目标和保存提示，当前题保存关闭后才切换', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeExpand()
  if (h.owner.cardLinkReviewMode.branch === undefined) h.api.onReviewModeBranch({ tag: 0 })
  h.api.onReviewModeQueuePick({ tag: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.equal(h.owner.cardLinkReviewMode.annotationIntent.index, 1)
  assert.match(h.calls.hud, /第 2 题.*右上角/)
  const buttons = ratingButtons(h)
  assert.match(buttons.find((b: any) => b.tag === 0).title, /当前/)
  assert.match(buttons.find((b: any) => b.tag === 1).title, /待切换/)
  assert.equal(buttons.find((b: any) => b.tag === 1).titleColor.hex, 'blue')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
})

test('手写模式在做题和复习中保存后评分切题，退出等待会话结束确认', async () => {
  for (const action of ['exit', 'rating', 'practice-rating']) {
    const h = harness()
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'handwriting', action === 'practice-rating' ? { maskAnswers: false } : undefined)
    assert.equal(h.calls.annotations?.length || 0, 0)
    assert.equal(h.calls.writingAnnotations.length, 1)
    if (action === 'exit') h.api.onReviewModeExit(undefined, h.owner)
    else {
      if (action === 'practice-rating') h.api.onReviewModeMark()
      else h.api.onReviewModeNext()
      await new Promise(resolve => setImmediate(resolve))
      await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.writingCompletions, 1)
    if (action === 'exit') {
      assert.ok(h.calls.writingFinishes >= 1)
      assert.equal(h.owner.cardLinkReviewMode, undefined)
    } else {
      assert.equal(h.owner.cardLinkReviewMode.index, 1)
      assert.equal(action === 'rating' ? h.calls.writes.length : h.calls.marks.length, 1)
    }
  }
})

test('手写保存失败不写成绩或切题，保存成功但结束失败也保留会话', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'handwriting', { maskAnswers: false })
  h.calls.writingSaveError = true
  h.owner.cardLinkReviewMode.resultsVisible = true
  await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  assert.equal(h.calls.marks?.length || 0, 0)
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  assert.ok(h.owner.cardLinkReviewMode.annotationToken)
  h.calls.writingSaveError = false
  h.calls.writingFinishError = true
  h.api.onReviewModeExit(undefined, h.owner)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(h.owner.cardLinkReviewMode)
  assert.match(h.calls.hud, /结束手写会话失败/)
})

test('手写能力未开放时显示原因且不创建会话，不打开批注替代', async () => {
  const h = harness()
  h.calls.writingAvailable = false
  const result = await h.api.startReviewMode(h.items, h.owner, 'fixed', 'handwriting')
  assert.equal(result.started, false)
  assert.match(result.reason, /host not ready/)
  assert.equal(h.calls.writingAnnotations?.length || 0, 0)
  assert.equal(h.calls.annotations?.length || 0, 0)
})

test('普通旧批注不能从统一的原生批注模式继续，仍保留历史查看', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.calls.closedReceipt = { ...h.calls.annotations[0], action: 'closed', saved: false }
  await h.api.onReviewModeHistory()
  await assert.rejects(h.calls.historyResume('ordinary', false), /普通旧批注/)
  assert.equal(h.calls.annotations.length, 1)
})

test('手写进入失败不能报告已开始，也不能展开评分写入未进入的题目', async () => {
  const h = harness()
  h.calls.writingFinishError = true
  const result = await h.api.startReviewMode(h.items, h.owner, 'fixed', 'handwriting')
  assert.equal(result.started, false)
  h.api.onReviewModeNext()
  assert.match(h.calls.hud, /未就绪/)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.writingAnnotations?.length || 0, 0)
})


test('批注从模板选择主要错因，关闭后原生和本地历史使用同一选择且不重复询问', async () => {
  const h = harness()
  h.calls.practiceReasons = [{ key: 'custom-cause', label: '自定义错因' }]
  h.calls.reasonChoice = 0
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  h.api.onReviewModeReason({ tag: 0 })
  await h.api.onReviewModeToolbarResult({ tag: 0 }, h.owner)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.reasonPrompts || 0, 0)
  assert.equal(h.calls.verdicts[0].reason, 'custom-cause')
  assert.equal(h.calls.writeReasons[0].label, '自定义错因')
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
})

test('反馈区错因再次点击取消；未选错因仍提交等级且不弹窗', async () => {
  for (const writing of ['mindmap', 'annotation', 'handwriting']) {
    const h = harness()
    h.calls.practiceReasons = [{ key: 'custom', label: '错因' }]
    await h.api.startReviewMode(h.items, h.owner, 'fixed', writing, { maskAnswers: false })
    h.api.onReviewModeMark()
    h.api.onReviewModeReason({ tag: 0 })
    assert.ok(h.owner.cardLinkReviewMode.selectedReason)
    h.api.onReviewModeReason({ tag: 0 })
    assert.equal(h.owner.cardLinkReviewMode.selectedReason, undefined)
    await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
    if (writing === 'annotation') {
      assert.equal(h.calls.marks?.length || 0, 0)
      h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(h.calls.marks.length, 1)
    assert.equal(h.calls.markReasons[0], undefined)
    assert.equal(h.calls.reasonPrompts || 0, 0)
  }
})


test('原生反馈失败后重试沿用错因；选择掌握不提交旧错因', async () => {
  const h = harness()
  h.calls.practiceReasons = [{ key: 'custom', label: '错因' }]
  h.calls.reasonChoice = 0
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  await new Promise(resolve => setImmediate(resolve))
  h.calls.verdictError = true
  h.api.onReviewModeReason({ tag: 0 })
  await h.api.onReviewModeToolbarResult({ tag: 0 }, h.owner)
  await h.api.onReviewModeToolbarResult({ tag: 0 }, h.owner)
  assert.equal(h.calls.reasonPrompts || 0, 0)
  assert.equal(h.calls.verdicts[1].reason, 'custom')
  h.calls.verdictError = false
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.calls.verdicts[2].self, 'got')
  assert.equal(h.calls.verdicts[2].reason, undefined)
})

test('选择错因期间收到关闭回执也只提交一次，不丢掉等级或再次询问', async () => {
  const h = harness()
  h.calls.practiceReasons = [{ key: 'reading', label: '审题遗漏' }]
  h.calls.reasonChoice = 0
  let finish!: () => void
  h.calls.reasonWait = new Promise<void>(resolve => { finish = resolve })
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  h.api.onReviewModeNext()
  h.api.onReviewModeReason({ tag: 0 })
  const pending = h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
  finish(); await pending
  assert.equal(h.calls.reasonPrompts || 0, 0)
  assert.equal(h.calls.verdicts.length, 1)
  assert.equal(h.calls.verdicts[0].reason, 'reading')
  assert.equal(h.calls.writes.length, 1)
})


test('智能批注中的模板自定义错因以备注保留，内置错因写标准键', async () => {
  for (const key of ['custom', 'reading']) {
    const h = harness()
    h.calls.settings = { debugModeEnabled: true, debugReviewAlgorithm: 'fsrs' }
    h.calls.practiceReasons = [{ key, label: '选中的错因' }]
    h.calls.reasonChoice = 0
    await h.api.startReviewMode(h.items.map(item => ({ ...item, fsrsProgress: { revision: 0, history: [] } })), h.owner, 'fsrs', 'annotation')
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'paper' })
    await new Promise(resolve => setImmediate(resolve))
    h.api.onReviewModeReason({ tag: 0 })
    await h.api.onReviewModeToolbarResult({ tag: 1 }, h.owner)
    assert.equal(h.calls.fsrsWrites[0].rating, 2)
    assert.equal(h.calls.verdicts[0].reason, key)
    if (key === 'custom') assert.equal(h.calls.fsrsWrites[0].errorNote, '错因：选中的错因')
    else assert.equal(h.calls.fsrsWrites[0].errorReasons[0], 'reading')
  }
})


test('空白新批注下一题直接进入历史，复习历史即使未写仍需反馈', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('old', true)
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, false)
  const blank = { ...h.calls.annotations[0], action: 'next', saved: false }
  h.owner.cardLinkReviewAnnotationClosed(blank)
  h.owner.cardLinkReviewAnnotationClosed(blank)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.historySavePrompts, undefined)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.verdicts?.length || 0, 0)
  assert.equal(h.calls.annotations.length, 2)
  assert.equal(h.calls.annotations[1].commentId, 'old')
  assert.equal(h.owner.cardLinkReviewMode.index, 0)
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[1], action: 'next', saved: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.calls.verdicts[0].commentId, 'old')
  assert.equal(h.owner.cardLinkReviewMode.index, 1)
})

test('新批注有内容：保存须先反馈，丢弃不写成绩，失败保留任务且下一题重试', async () => {
  for (const practice of [false, true]) for (const discard of [false, true]) {
    const h = harness()
    h.calls.historySaveChoice = discard ? 1 : 0
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation', practice ? { maskAnswers: false } : undefined)
    await h.api.onReviewModeHistory()
    await h.calls.historyResume('old', true)
    h.calls.discardError = discard
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.historySavePrompts, 1)
    assert.equal(h.calls.annotations.length, 1)
    assert.equal(h.calls.writes.length, 0)
    if (discard) {
      assert.equal(h.calls.discards[0].commentId, 'new')
      assert.equal(h.owner.cardLinkReviewMode.annotationContinuations.length, 1)
      h.calls.discardError = false
      h.api.onReviewModeNext()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.calls.historySavePrompts, 1)
      assert.equal(h.calls.verdicts?.length || 0, 0)
      assert.equal(h.calls.marks?.length || 0, 0)
    } else {
      assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
      h.api.onReviewModeNext()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.calls.annotations.length, 1, '保存后不允许下一题绕过反馈')
      await h.api.onReviewModeToolbarResult({ tag: 2 }, h.owner)
      assert.equal(h.calls.verdicts[0].commentId, 'new')
      assert.equal(practice ? h.calls.marks.length : h.calls.writes.length, 1)
    }
    assert.equal(h.calls.annotations[1].commentId, 'old')
  }
})

test('保存询问期间重复下一题不评分，取消后保留新批注和历史', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('old', true)
  let answer!: () => void
  h.calls.historySaveWait = new Promise<void>(resolve => { answer = resolve })
  h.calls.historySaveChoice = -1
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  h.api.onReviewModeNext()
  assert.equal(h.calls.historySavePrompts, 1)
  answer()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.owner.cardLinkReviewMode.annotationContinuations.length, 1)
  h.calls.historySaveWait = undefined
  h.calls.historySaveChoice = 0
  h.api.onReviewModeNext()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.cardLinkReviewMode.resultsVisible, true)
  assert.equal(h.calls.writes.length, 0)
})


test('保存确认期间退出后，迟到选择不删除新批注或重开历史', async () => {
  const h = harness()
  await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
  await h.api.onReviewModeHistory()
  await h.calls.historyResume('old', true)
  let answer!: () => void
  h.calls.historySaveChoice = 1
  h.calls.historySaveWait = new Promise<void>(resolve => { answer = resolve })
  h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved: true, commentId: 'new' })
  await new Promise(resolve => setImmediate(resolve))
  h.api.onReviewModeExit(undefined, h.owner)
  assert.equal(h.owner.cardLinkReviewMode, undefined)
  answer()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.discards?.length || 0, 0)
  assert.equal(h.calls.writes.length, 0)
  assert.equal(h.calls.annotations.length, 1)
})


test('空白切历史或丢弃后续写明确打开失败，下一题只重试历史而不评分空板', async () => {
  for (const saved of [false, true]) {
    const h = harness()
    h.calls.historySaveChoice = 1
    await h.api.startReviewMode(h.items, h.owner, 'fixed', 'annotation')
    await h.api.onReviewModeHistory()
    await h.calls.historyResume('old', true)
    h.calls.openError = Object.assign(new Error('not opened'), { editorMayBeOpen: false })
    h.owner.cardLinkReviewAnnotationClosed({ ...h.calls.annotations[0], action: 'next', saved, ...(saved ? { commentId: 'new' } : {}) })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.owner.cardLinkReviewMode.annotationContinuations.length, 1)
    assert.equal(h.calls.writes.length, 0)
    h.calls.openError = undefined
    h.api.onReviewModeNext()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.annotations.at(-1).commentId, 'old')
    assert.equal(h.calls.writes.length, 0)
    assert.equal(h.calls.discards?.length || 0, saved ? 1 : 0)
  }
})
