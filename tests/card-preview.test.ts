import { windowOpacityFixture } from "./window-opacity-fixture"
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { build } from "esbuild"
import { mountCardPreview } from "../src/card-preview"
import { pkDrawingRendererScript } from "../src/pkdrawing-renderer"
import { transpileModule } from "typescript"
import { collectQuestionTree, mindMapScopeOf, questionIdsInTree, renderedMindMapNoteIds, selectedQuestionIds } from "../src/quick-menu-selection"
import { reviewToolbarHorizontal } from "../src/review-toolbar-layout"
import * as reviewToolbarLayoutApi from "../src/review-toolbar-layout"
import { quickMenuGeometry } from "../src/quick-menu-geometry"
import * as bindings from "../src/binding"

function librarySurface(handwritingEnabled = false) {
  function target(extra: any = {}) {
    const events = new Map<string, Set<any>>()
    return { ...extra, events,
      addEventListener(name: string, fn: any) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn) },
      removeEventListener(name: string, fn: any) { events.get(name)?.delete(fn) },
      emit(name: string, event: any = {}) { events.get(name)?.forEach(fn => fn({ type: name, ...event })) }
    }
  }
  const card = target({ style: {}, scrollHeight: 1800, offsetWidth: 400, offsetHeight: 1800 })
  const root: any = { style: {}, dataset: {}, clientWidth: 400, clientHeight: 500 }
  const button: any = { setAttribute() {}, remove() { this.removed = true } }
  const handwriting: any = { hidden: true, before() {} }
  const meta: any = { setAttribute(_key: string, value: string) { this.content = value } }
  const doc = target({ body: target({ style: {} }), documentElement: root, createElement: () => button, querySelectorAll: () => [],
    querySelector: (selector: string) => selector === '.card' ? card : selector.startsWith('meta') ? meta : handwritingEnabled ? handwriting : null })
  const win = target({ document: doc, innerWidth: 400, innerHeight: 500, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} })
  let scale = 1, pan = { x: 0, y: 0 }, options: any, zooms = 0, dead = false
  const moves: any[] = [], downs: any[] = [], ups: any[] = []
  const engine = { eventNames: { down: 'pointerdown', move: 'pointermove', up: 'pointerup pointercancel' },
    getScale: () => scale, getPan: () => pan,
    pan(x: number, y: number) { pan = { x, y } },
    zoomToPoint(value: number) { scale = value; zooms++; card.emit('panzoomzoom') },
    handleDown(event: any) { downs.push(event) }, handleMove(event: any) { moves.push(event) }, handleUp(event: any) { ups.push(event) },
    destroy() { dead = true }, zoomWithWheel() {}
  }
  const Panzoom: any = (_card: any, settings: any) => { options = settings; return engine }
  Panzoom.defaultOptions = { setTransform(_card: any, state: any) { card.style.transform = `scale(${state.scale}) translate(${state.x}px, ${state.y}px)` } }
  return { win, root, card, doc, meta, button, handwriting, Panzoom, engine, moves, downs, ups, options: () => options, zooms: () => zooms, dead: () => dead }
}

test("预览由原库变换正文，百分比回写不重复缩放，范围与边界生效", () => {
  const s = librarySurface(), controller = mountCardPreview(s.win, s.Panzoom)
  assert.equal(mountCardPreview(s.win, s.Panzoom), controller)
  assert.equal(s.root.style.overflow, 'hidden')
  assert.equal(s.root.style.touchAction, 'none')
  assert.match(s.meta.content, /user-scalable=no/)
  assert.equal(s.options().step, .75)
  const changes: number[] = []
  controller.subscribe((value: number) => { changes.push(value); controller.setScale(Math.round(value * 100) / 100) })
  controller.setScale(1.754)
  assert.equal(s.zooms(), 1)
  assert.equal(changes[changes.length - 1], 1.754)
  assert.match(s.card.style.transform, /scale\(1.754\)/)
  assert.equal(s.card.style.zoom, undefined)
  controller.setScale(8); assert.equal(controller.getScale(), 3)
  controller.setScale(.1); assert.equal(controller.getScale(), .6)
  s.engine.pan(10000, -10000); s.options().setTransform()
  assert.ok(s.engine.getPan().x <= 200)
  assert.ok(s.engine.getPan().y > -10000)
  assert.equal(controller.naturalHeight(), 1800)
  controller.destroy(); assert.equal(s.dead(), true); assert.equal(s.win.__mnCardPreview, undefined)
  for (const target of [s.win, s.doc, s.doc.body, s.card]) for (const handlers of target.events.values()) assert.equal(handlers.size, 0)
})

test("库输入适配只转交已开始指针，笔独占且不接收悬停或手掌结束", () => {
  const s = librarySurface(), controller = mountCardPreview(s.win, s.Panzoom)
  const event = (pointerId: number, pointerType = 'touch') => ({ pointerId, pointerType, buttons: 1, pressure: .5 })
  s.doc.emit('pointermove', event(9, 'pen')); assert.equal(s.moves.length, 0)
  s.doc.body.emit('pointerdown', event(1)); s.doc.body.emit('pointerdown', event(9, 'pen'))
  assert.equal(s.ups[0].pointerId, 1)
  s.doc.body.emit('pointerdown', event(2)); s.doc.emit('pointermove', event(2)); s.doc.emit('pointerup', event(2))
  s.doc.emit('pointermove', event(9, 'pen')); assert.equal(s.moves.length, 1)
  s.doc.emit('pointermove', { ...event(9, 'pen'), buttons: 0, pressure: 0 })
  s.doc.emit('pointermove', event(9, 'pen')); assert.equal(s.moves.length, 1)
  controller.destroy()
})

test("手写显式按钮保持可用且销毁移除", () => {
  const s = librarySurface(true), controller = mountCardPreview(s.win, s.Panzoom)
  assert.equal(s.button.textContent, '显示脑图手写')
  s.button.onclick(); assert.equal(s.handwriting.hidden, false)
  s.button.onclick(); assert.equal(s.handwriting.hidden, true)
  controller.destroy(); assert.equal(s.button.removed, true)
})
test("图片笔迹叠加使用底图坐标，笔迹边界不能改变画布比例", () => {
  const transforms: any[] = []
  const img = { complete: true, naturalWidth: 400, naturalHeight: 200 }
  const canvas: any = {
    style: {}, parentElement: { querySelector: () => img },
    getAttribute: (key: string) => key === "data-drawing-overlay" ? "true" : "ink",
    getContext: () => ({ scale: (...args: any[]) => transforms.push(args), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} })
  }
  runInNewContext(pkDrawingRendererScript, {
    __mnPkdrawingCore: { drawingData: () => [], decodeStrokes: () => [{ color: "black", points: [{ x: 10, y: 10, width: 1 }, { x: 450, y: 220, width: 1 }] }] },
    document: { querySelectorAll: () => [canvas] }, devicePixelRatio: 2
  })
  assert.equal(canvas.width, 800)
  assert.equal(canvas.height, 400)
  assert.deepEqual(transforms, [[2, 2]])
})

test("HTML携带库预览运行时，场景页可延后挂载空文档", async () => {
  const runtime = await build({ entryPoints: ["src/card-preview-webview.ts"], bundle: true, write: false, minify: true, format: "iife", target: "safari13" })
  const script = runtime.outputFiles[0].text.trim()
  assert.doesNotMatch(script, /<\/script/i)
  const window: any = { document: { querySelector: () => null } }
  runInNewContext(script, { window })
  assert.equal(typeof window.__mnMountCardPreview, "function")
  const renderer = await build({ entryPoints: ["src/card-html.ts"], bundle: true, write: false, format: "iife", globalName: "renderer", define: { __CARD_PREVIEW_SCRIPT__: JSON.stringify(script) } })
  const sandbox: any = {}
  runInNewContext(renderer.outputFiles[0].text, sandbox)
  const html = sandbox.renderer.renderCardHtml({ noteTitle: "测试", comments: [] }, "题目", () => null, () => null)
  assert.ok(html.includes('<script id="cardlink-preview-runtime">' + script + "</script>"))
})

test("短笔迹不被拉满容器，DPR只影响位图清晰度不影响CSS比例", () => {
  const widths: string[] = []
  for (const dpr of [1, 2, 3]) {
    const canvas: any = { style: {}, getAttribute: () => "drawing", getContext: () => ({ scale() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }) }
    runInNewContext(pkDrawingRendererScript, {
      __mnPkdrawingCore: { drawingData: () => [], decodeStrokes: () => [{ color: "black", points: [{ x: 10, y: 10, width: 1 }, { x: 40, y: 30, width: 1 }] }] },
      document: { querySelectorAll: () => [canvas] }, devicePixelRatio: dpr
    })
    assert.equal(canvas.style.width, "48px")
    widths.push(canvas.style.width)
  }
  assert.equal(new Set(widths).size, 1)
})

test("Bridge开关直接调用JS服务并携带所属addon，不调用宿主自定义getter", () => {
  const context: any = { addon: { isPluginEnabled() { throw Error("不应进入宿主") } } }
  let supplied: any
  const sandbox: any = { __MN_ANSWER_CORE_GLOBAL__: { cardToolbar: { setEnabled: (enabled: boolean, owner: any) => { supplied = owner; return { enabled } } } } }
  runInNewContext(readFileSync("rails-native/WebBridgeCommands.js", "utf8"), sandbox)
  assert.equal(sandbox.__MNAM_WEB_BRIDGE_GLOBAL__.dispatch(context, "setPluginEnabled", { enabled: false }).enabled, false)
  assert.equal(supplied, context.addon)
})

test("悬浮球快捷区展开、收起并从快捷项打开插件页面", async () => {
  const rightEdge = quickMenuGeometry({ x: 962, y: 570, width: 44, height: 44 }, { width: 1024, height: 768 }, { width: 272, height: 520 }, "right")
  const movedUp = quickMenuGeometry({ x: 962, y: 220, width: 44, height: 44 }, { width: 1024, height: 768 }, { width: 272, height: 520 }, "right")
  assert.equal(rightEdge.frame.x + rightEdge.frame.width, 1018)
  assert.ok(rightEdge.frame.height < movedUp.frame.height)
  const bottomEdge = quickMenuGeometry({ x: 500, y: 706, width: 44, height: 44 }, { width: 1024, height: 768 }, { width: 272, height: 520 }, "bottom")
  assert.equal(bottomEdge.frame.y + bottomEdge.frame.height, 762)
  class View {
    frame: any; layer: any = {}; children: any[] = []; superview: any; alpha = 1; enabled = true; imageView: any; backgroundColor: any; titleLabel: any = {}
    storedBounds: any
    get bounds() { return this.storedBounds || { x: 0, y: 0, width: this.frame?.width, height: this.frame?.height } }
    set bounds(value: any) { this.storedBounds = value }
    constructor(frame?: any) { this.frame = frame }
    addSubview(view: any) { this.children.push(view); view.superview = this }
    bringSubviewToFront(view: any) { const index = this.children.indexOf(view); if (index >= 0) this.children.push(...this.children.splice(index, 1)) }
    addGestureRecognizer() {}
    removeGestureRecognizer() {}
    removeFromSuperview() { this.superview?.children.splice(this.superview.children.indexOf(this), 1); this.superview = null }
    addTargetActionForControlEvents(_owner: any, selector: string) { this.selector = selector }
    setTitleForState() {}
    setTitleColorForState() {}
    setImageForState() {}
    loadHTMLStringBaseURL(html: string) { this.html = html }
    evaluateJavaScript(script: string) { this.script = script }
    html = ""
    script = ""
    selector = ""
  }
  class Label extends View {
    constructor(frame: any) {
      assert.ok(frame && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite))
      super(frame)
    }
  }
  const window: any = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const root: any = { noteId: "root", noteTitle: "章节", colorIndex: 0 }
  const question: any = { noteId: "question", noteTitle: "题目", colorIndex: 1, parentNote: root }
  const answer: any = { noteId: "answer", noteTitle: "答案", colorIndex: 2, parentNote: question }
  const directory: any = { noteId: "directory", noteTitle: "文档目录", colorIndex: 3 }
  let selectedCards = [question]
  const notes = [root, { ...question, colorIndex: 9 }, answer, directory]
  const mindmap = { mindmapNodes: [root, question, answer].map(note => ({ note })) }
  let visible = false, shown = 0
  let startedSelection: string[] = []
  let startError = false
  let practiceActive = false, practiceCurrentId: string | undefined
  let answerBinding: bindings.BindingTarget = { notebookId: "answers", designatedAnswer: "mindmap", questionColors: [1] }
  const startedModes: boolean[] = []
  const menuLogs: string[] = []
  const hudMessages: string[] = []
  const ball = new View({ x: 900, y: 60, width: 44, height: 44 }); ball.imageView = { alpha: 1 }; window.addSubview(ball)
  const entrance = {
    button: ball,
    layer: ball.layer,
    get frame() { return ball.frame },
    set frame(value: any) { ball.frame = value },
    set alpha(value: number) { ball.alpha = value },
    set backgroundColor(value: any) { ball.backgroundColor = value }
  }
  let globalColors: number[] = []
  let writingChoice = 0
  const writingModes: string[] = []
  const owner: any = { window, webController: {}, mnutilsEntranceBall: entrance }
  Object.defineProperty(owner, "isPluginEnabled", { get() { throw Error("不能访问宿主getter") } })
  const color = { colorWithAlphaComponent(alpha: number) { return { ...this, alpha } } }
  const preferences = new Map<string, string>()
  const quickSurface: any = {}
  let animationNow = Date.now()
  const sandbox: any = {
    self: owner, exports: {}, console,
    Date: { now: () => animationNow },
    NSTimer: { scheduledTimerWithTimeInterval(_seconds: number, _repeat: boolean, callback: () => void) {
      const timer = { active: true, invalidate() { this.active = false } }
      setImmediate(() => { if (timer.active) { animationNow += 1000; callback() } })
      return timer
    } },
    JSB: { defineClass: (_declaration: string, methods: any) => ({ new: () => ({ ...methods }) }) },
    MNUtil: { currentWindow: window, animate: (update: any) => { update(); return Promise.resolve() } },
    NSUserDefaults: { standardUserDefaults: () => ({
      objectForKey: (key: string) => preferences.get(key),
      setObjectForKey: (value: string, key: string) => { preferences.set(key, value) }, synchronize() {}
    }) },
    UIView: View, UIToolbar: View, UIScrollView: View, UILabel: Label, UIWebView: class extends View { scrollView = new View() }, UITapGestureRecognizer: class { cancelsTouchesInView = true }, UILongPressGestureRecognizer: class {},
    UIButton: { buttonWithType: () => new View() }, UIPanGestureRecognizer: class {},
    UIImage: { imageWithContentsOfFile: () => ({}), imageWithDataScale: () => ({}) },
    NSData: { dataWithContentsOfFile: () => ({}) },
    UIColor: { colorWithHexString: () => color, clearColor: () => color, blackColor: () => color, whiteColor: () => color },
    UIFont: { systemFontOfSize() {}, boldSystemFontOfSize() {} },
    Application: { sharedInstance: () => ({ studyController: () => ({ refreshAddonCommands() {} }) }) },
    __MNAM_WEB_PANEL_GLOBAL__: {
      isVisible: () => visible,
      showPanel: () => { visible = true; shown++ },
      hidePanel: () => { visible = false }
    },
    require: (name: string) => name === "./window-opacity" ? windowOpacityFixture(View, { failClass: true }) : name === "./quick-menu-surface" ? quickSurface : name === "./card-toolbar-state"
      ? {}
      : name === "./ui-tokens" ? { UI_COLORS: { accent: "#0e8dfd", grayFill: "#d8d8dd", surface: "#f7f8fa" } }
      : name === "./review-toolbar-layout" ? reviewToolbarLayoutApi
      : name === "./quick-menu-geometry" ? { quickMenuGeometry }
      : name === "./settings" ? { loadMatcherSettings: () => ({ entranceDefaultMode: "practice", allowSameStudySetMindMap: true, globalQuestionColors: globalColors }) }
      : name === "./note-navigation" ? { recordRuntimeState: (_scope: string, label: string, detail: string) => menuLogs.push(`${label} ${detail}`) }
      : name === "./question-clipper" ? { clipperModeActive: () => false, exitClipperMode() {} }
      : name === "./review-mode" ? { updateReviewToolbarOrientation() {}, startPracticeMode: (_book: string, ids: string[], _root: string, mask: boolean, mode: string) => { if (startError) throw new Error("native selection failed"); startedSelection = [...ids]; startedModes.push(mask); writingModes.push(mode); return { started: true, count: ids.length } } }
      : name === "./same-map-practice" ? { sameMapPracticeActive: () => practiceActive, sameMapPracticeCurrentQuestionId: () => practiceCurrentId, sameMapPracticeQuestionIds: () => startedSelection, stopSameMapPractice() {}, startSameMapPractice: (_book: string, ids: Set<string>, options: { maskAnswers: boolean }) => { if (startError) throw new Error("native selection failed"); startedSelection = [...ids]; startedModes.push(options.maskAnswers); return { started: true, answerCount: options.maskAnswers ? 1 : 0, maskAnswers: options.maskAnswers } } }
      : name === "./quick-menu-selection" ? { collectQuestionTree, mindMapScopeOf, questionIdsInTree, renderedMindMapNoteIds, selectedQuestionIds }
      : name === "./note-tree" ? { notebookNotes: () => notes }
      : name === "./mindmap-candidate" ? { MAIN_MINDMAP_SCOPE_ID: "__mn4_main_mindmap__", mindMapScopeIdForNote: (note: any) => note?.childMindMap?.noteId || "__mn4_main_mindmap__" }
      : name === "./store" ? { loadBindings: () => ({ "book::root::__mn4_main_mindmap__": answerBinding }) }
      : name === "./binding" ? bindings
      : name === "marginnote" ? {
        select: async (choices: string[]) => { assert.deepEqual(Array.from(choices), ["脑图内书写", "批注窗口书写"]); if (writingChoice === 1) windowTap(-1, 10); return { index: writingChoice } },
        showHUD(message: string) { hudMessages.push(message) }, MN: { currnetNotebookId: "book", db: { getNotebookById: () => ({ notes }) }, notebookController: { mindmapView: mindmap } },
        NodeNote: { getSelectedNodes: () => selectedCards.map(note => ({ note })) }
      }
      : { showHUD() {} }
  }
  runInNewContext(transpileModule(readFileSync("src/quick-menu-surface.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, {
    exports: quickSurface, UIColor: sandbox.UIColor, require: sandbox.require
  })
  runInNewContext(transpileModule(readFileSync("src/mnutils-entrance.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, sandbox)
  sandbox.exports.onMnutilsEntranceClick({})
  assert.equal(shown, 0)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  const observer = owner.mnutilsQuickMenu.dismissTap
  assert.equal(observer.cancelsTouchesInView, false)
  assert.equal(observer.delaysTouchesBegan, false)
  assert.equal(observer.delaysTouchesEnded, false)
  assert.equal(observer.delegate.gestureRecognizerShouldRecognizeSimultaneouslyWithGestureRecognizer(observer, {}), true)
  assert.equal(ball.frame.width, 44)
  assert.equal(ball.frame.x, 900)
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 44)
  assert.equal(owner.mnutilsQuickMenu.content.superview, window)
  assert.equal(owner.mnutilsQuickMenu.content.layer.mask, undefined)
  assert.equal(window.children.length, 2)
  assert.equal(owner.mnutilsQuickMenu.controls.alpha, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 272)
  assert.equal(owner.mnutilsQuickMenu.content.frame.height, 122)
  assert.equal(owner.mnutilsQuickMenu.content.backgroundColor.alpha, 0.94)
  assert.equal(ball.frame.width, 44)
  assert.equal(ball.frame.x, 900)
  assert.equal(owner.mnutilsQuickMenu.controls.alpha, 1)
  assert.equal(ball.children.length, 0)
  // UIKit reports coordinates in the requested view even when the window and
  // menu have different origins. A tap on either control must not dismiss it.
  const windowTap = (x: number, y: number) => sandbox.exports.onMnutilsQuickMenuWindowTap({
    state: 3,
    locationInView(view: any) {
      const content = owner.mnutilsQuickMenu.content
      if (view === content) return { x, y }
      if (view === window) return { x: content.frame.x + x, y: content.frame.y + y }
      throw new Error("Unexpected coordinate space")
    }
  })
  const startFrame = owner.mnutilsQuickMenu.startButton.frame
  const actualFrame = owner.mnutilsQuickMenu.content.frame
  owner.mnutilsQuickMenu.content.frame = { ...actualFrame, x: actualFrame.x - 400 }
  windowTap(startFrame.x + 10, startFrame.y + 10)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  owner.mnutilsQuickMenu.content.frame = actualFrame
  const filterFrame = owner.mnutilsQuickMenu.filterButton.frame
  const segmentFrame = owner.mnutilsQuickMenu.segment.frame
  windowTap(segmentFrame.x + filterFrame.x + 10, segmentFrame.y + filterFrame.y + 10)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  assert.equal(owner.mnutilsQuickMenu.mode, "selected")
  assert.equal(owner.mnutilsQuickMenu.selectedIds.has("question"), true)
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.mode, "all")
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.mode, "filter")
  assert.match(owner.mnutilsQuickMenu.segmentVisual.html, /transition:transform 0\.45s var\(--ease-main\)/)
  assert.match(owner.mnutilsQuickMenu.segmentVisual.script, /setQuickMenuMode\("filter"\)/)
  assert.equal(owner.mnutilsQuickMenu.selectedIds.size, 0)
  assert.equal(owner.mnutilsQuickMenu.tree.some((node: any) => node.id === "directory"), false)
  assert.equal(owner.mnutilsQuickMenu.startButton.frame.y, 12)
  assert.equal(owner.mnutilsQuickMenu.segment.frame.y, 68)
  assert.equal(owner.mnutilsQuickMenu.listContainer.alpha, 1)
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 272)
  assert.equal(owner.mnutilsQuickMenu.scroll.contentSize.height >= 42, true)
  // The window gesture may also arrive after the filter action relayouts the menu.
  windowTap(segmentFrame.x + filterFrame.x + 10, segmentFrame.y + filterFrame.y + 10)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  sandbox.exports.onMnutilsQuickMenuToggleQuestion({ tag: 0 })
  assert.equal(owner.mnutilsQuickMenu.selectedIds.size, 1)
  const previousList = owner.mnutilsQuickMenu.listContainer
  sandbox.exports.onMnutilsQuickMenuToggleBranch({ tag: 0 })
  assert.equal(previousList.alpha, 0)
  assert.equal(owner.mnutilsQuickMenu.listContainer.alpha, 1)
  assert.equal(previousList.superview, owner.mnutilsQuickMenu.controls)
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 272)
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  assert.equal(owner.mnutilsQuickMenu.selectedIds.size, 3)
  assert.equal(owner.mnutilsQuickMenu.expandedIds.size, 0)
  // 收起全部后重新筛选、关闭重开都保留空集合，不恢复默认顶层展开。
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.expandedIds.size, 0)
  sandbox.exports.onMnutilsQuickMenuDismiss()
  await new Promise(resolve => setImmediate(resolve))
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.expandedIds.size, 0)
  sandbox.exports.onMnutilsQuickMenuToggleBranch({ tag: 0 })
  assert.equal(owner.mnutilsQuickMenu.expandedIds.has("root"), true)
  sandbox.exports.onMnutilsQuickMenuDismiss()
  await new Promise(resolve => setImmediate(resolve))
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.expandedIds.has("root"), true)
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  sandbox.exports.onMnutilsEntrancePan({ state: 1, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
  sandbox.exports.onMnutilsEntrancePan({ state: 2, translationInView: () => ({ x: -30, y: 20 }), setTranslationInView() {} })
  assert.equal(owner.mnutilsQuickMenu.open, true)
  sandbox.exports.onMnutilsEntrancePan({ state: 3, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
  assert.equal(owner.mnutilsQuickMenu.open, true)
  assert.ok(ball.frame.x === 18 || ball.frame.x === 962 || ball.frame.y === 18 || ball.frame.y === 706, '展开快捷区拖动结束应吸附窗口边缘')
  assert.ok(preferences.has('marginnote.extension.mn4-answer-matcher.entrance-dock.v1'))
  const anchoredX = ball.frame.x, anchoredY = ball.frame.y
  const closingContent = owner.mnutilsQuickMenu.content
  sandbox.exports.onMnutilsQuickMenuDismiss()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closingContent.alpha, 1)
  assert.equal(owner.mnutilsQuickMenu, undefined)
  assert.equal(ball.frame.width, 44)
  assert.equal(ball.frame.x, anchoredX)
  assert.equal(ball.frame.y, anchoredY)
  ball.frame = { x: 820, y: 350, width: 44, height: 44 }
  sandbox.exports.onMnutilsEntrancePan({ state: 1, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
  sandbox.exports.onMnutilsEntrancePan({ state: 3, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ball.frame.x, 962, '收起后的悬浮球应恢复右侧吸附')
  assert.equal(ball.frame.y, 350)
  assert.equal(owner.mnutilsEntranceNativeFrame, undefined)
  owner.mnutilsEntranceSuppressClick = 0
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsEntranceClick({})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shown, 1)
  assert.equal(owner.mnutilsQuickMenu, undefined)
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsQuickMenuOpenPanel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shown, 1)
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  writingChoice = -1
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.equal(startedSelection.length, 0)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  writingChoice = 0
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.deepEqual(startedSelection, ["root", "question", "answer"])
  assert.equal(owner.mnutilsQuickMenu.open, true)
  assert.deepEqual(startedModes, [false])
  assert.ok(hudMessages.includes("已开始做题"))
  for (const target of [
    { notebookId: "book", designatedAnswer: "subcard" as const, questionColors: [1] },
    { notebookId: "answers", selectionMode: "mixed" as const, questionColors: [1] }
  ]) {
    answerBinding = target
    await sandbox.exports.onMnutilsQuickMenuStart()
  }
  assert.deepEqual(startedModes, [false, true, true])
  writingChoice = 1
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.equal(writingModes[writingModes.length - 1], "annotation")
  writingChoice = 0
  startError = true
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.equal(owner.mnutilsQuickMenu.open, true)
  assert.ok(hudMessages.some(message => message.includes("native selection failed")))
  assert.ok(menuLogs.some(line => line.includes("start.error native selection failed")))
  windowTap(Number.NaN, 0)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  windowTap(-1, 10)
  assert.equal(owner.mnutilsQuickMenu.open, false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(owner.mnutilsQuickMenu, undefined)
  assert.ok(menuLogs.some(line => line.includes("close reason=outside-tap")))
  owner.cardLinkReviewEntranceRender = (host: any) => { owner.cardLinkReviewEntranceHost = host }
  sandbox.exports.onMnutilsEntranceClick({})
  await new Promise(resolve => setImmediate(resolve))
  const reviewMenu = owner.mnutilsQuickMenu
  assert.equal((ball as any).hidden, true)
  assert.equal(reviewMenu.closeButton.hidden, true)
  assert.equal(reviewMenu.reviewBackdrop, undefined)
  assert.equal(reviewMenu.expandedFrame.width, 52)
  assert.equal(reviewMenu.expandedFrame.height, 316)
  assert.equal(reviewMenu.content.backgroundColor.alpha, 0.78)
  assert.equal(reviewMenu.content.layer.masksToBounds, false)
  assert.equal(reviewMenu.content.layer.shadowOpacity, 0.14)
  assert.equal(reviewMenu.controls.layer.masksToBounds, true)
  assert.equal(reviewMenu.controls.layer.cornerRadius, 20)
  assert.equal(reviewMenu.reviewControls.frame.x, 4)
  assert.equal(reviewMenu.reviewControls.frame.y, 4)
  owner.cardLinkReviewMode = { writingMode: "mindmap", annotationHorizontal: true }
  owner.cardLinkReviewEntranceResize(44, 308)
  owner.cardLinkReviewEntranceCommit()
  assert.equal(reviewMenu.expandedFrame.width, 316)
  assert.equal(reviewMenu.expandedFrame.height, 52)
  assert.ok(reviewMenu.expandedFrame.x + reviewMenu.expandedFrame.width <= window.frame.width)
  assert.equal(reviewMenu.reviewControls.frame.width, 308)
  const shellStyle = {
    background: reviewMenu.content.backgroundColor,
    borderWidth: reviewMenu.content.layer.borderWidth,
    shadowOpacity: reviewMenu.content.layer.shadowOpacity
  }
  owner.cardLinkReviewMode = { annotationHorizontal: true }
  owner.cardLinkReviewEntranceResize(300, 500)
  owner.cardLinkReviewEntranceCommit()
  assert.deepEqual({
    background: reviewMenu.content.backgroundColor,
    borderWidth: reviewMenu.content.layer.borderWidth,
    shadowOpacity: reviewMenu.content.layer.shadowOpacity
  }, shellStyle, '横排下拉继续使用同一外壳，不更换背景或叠加第二层')
  owner.cardLinkReviewEntranceResize(44, 308)
  owner.cardLinkReviewEntranceCommit()
  let classificationDismissals = 0
  owner.cardLinkReviewDismissClassification = () => { classificationDismissals++ }
  windowTap(20, 20)
  assert.equal(classificationDismissals, 0)
  windowTap(-1, 10)
  assert.equal(classificationDismissals, 1)
  sandbox.exports.onMnutilsQuickMenuDismiss()
  sandbox.exports.closeMnutilsQuickMenu()
  sandbox.exports.onMnutilsEntranceLongPress({ state: 1 })
  sandbox.exports.onMnutilsQuickMenuOpenPanel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(owner.mnutilsQuickMenu, reviewMenu)
  assert.equal(reviewMenu.open, true)
  assert.ok(reviewMenu.content.superview)
  sandbox.exports.onMnutilsEntrancePan({ state: 1, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
  animationNow += 1000
  sandbox.exports.onMnutilsEntrancePan({ state: 2, translationInView: () => ({ x: -40, y: -20 }), setTranslationInView() {} })
  const reviewDraggedCore = { ...reviewMenu.reviewCore }
  sandbox.exports.onMnutilsEntrancePan({ state: 3, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual({ ...reviewMenu.reviewCore }, reviewDraggedCore, '松手恢复完整工具条，但主控保留自由拖动位置')
  assert.equal(reviewMenu.content.frame.width, reviewMenu.expandedFrame.width)
  assert.equal(reviewMenu.content.frame.height, reviewMenu.expandedFrame.height)
  sandbox.exports.closeReviewQuickMenu(owner)
  assert.equal((ball as any).hidden, false)
  assert.equal(owner.cardLinkReviewEntranceResize, undefined)
  owner.cardLinkReviewEntranceRender = undefined
  await new Promise(resolve => setImmediate(resolve))
  for (const position of [{ x: 450, y: 8, horizontal: true }, { x: 8, y: 250, horizontal: false }]) {
    ball.frame = { x: position.x, y: position.y, width: 44, height: 44 }
    owner.mnutilsEntranceNativeFrame = { ...ball.frame }
    owner.mnutilsEntranceSuppressClick = 0
    owner.cardLinkReviewMode = { purpose: 'practice', writingMode: 'mindmap' }
    owner.cardLinkReviewEntranceRender = (host: any) => {
      owner.cardLinkReviewEntranceHost = host
      owner.cardLinkReviewEntranceResize(position.horizontal ? 44 : 352, position.horizontal ? 352 : 44)
      owner.cardLinkReviewEntranceCommit()
    }
    sandbox.exports.onMnutilsEntranceClick({})
    const opened = owner.mnutilsQuickMenu
    assert.equal(owner.cardLinkReviewMode.annotationHorizontal, position.horizontal)
    assert.equal(opened.content.frame.width, 44, '首帧保持球体宽度，渲染提交不能提前展开')
    assert.equal(opened.content.frame.height, 44)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(opened.content.frame.width, position.horizontal ? 360 : 52)
    assert.equal(opened.content.frame.height, position.horizontal ? 52 : 360)
    ball.frame = { x: 460, y: 20, width: 44, height: 44 }
    sandbox.exports.closeReviewQuickMenu(owner)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(owner.mnutilsEntranceDock.edge, 'top')
    assert.equal(owner.mnutilsEntranceNativeFrame, undefined)
    assert.ok(ball.frame.y < 20, '退出恢复顶部贴边')
    owner.cardLinkReviewEntranceRender = undefined
    owner.cardLinkReviewMode = undefined
  }
  const chapter = { noteId: 'chapter-two', noteTitle: '第二章', colorIndex: 0 }
  const more = Array.from({ length: 40 }, (_, i) => ({ noteId: `q${i}`, noteTitle: `题${i}`, colorIndex: 1, parentNote: chapter }))
  notes.push(chapter, ...more)
  mindmap.mindmapNodes.push(...[chapter, ...more].map(note => ({ note })))
  startError = false
  owner.mnutilsEntranceSuppressClick = 0
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  assert.ok(owner.mnutilsQuickMenu.selectedIds.has('q25'), JSON.stringify({ selected: [...owner.mnutilsQuickMenu.selectedIds], logs: menuLogs.slice(-7) }))
  await sandbox.exports.onMnutilsQuickMenuStart()
  practiceActive = true
  practiceCurrentId = 'q25'
  preferences.clear()
  sandbox.exports.onMnutilsQuickMenuDismiss()
  await new Promise(resolve => setImmediate(resolve))
  sandbox.exports.onMnutilsEntranceClick({})
  await new Promise(resolve => setImmediate(resolve))
  const reopened = owner.mnutilsQuickMenu
  assert.equal(reopened.mode, 'queue')
  assert.ok(reopened.expandedIds.has('chapter-two'))
  const currentRow = reopened.rowIds.indexOf('q25')
  assert.ok(currentRow > 5, JSON.stringify(reopened.rowIds))
  assert.ok(reopened.scroll.contentOffset.y > 0)
  assert.equal(currentRow * 42 + 21 - reopened.scroll.contentOffset.y, reopened.scroll.frame.height / 2)
  practiceActive = false
  sandbox.exports.closeMnutilsQuickMenu()
  owner.mnutilsEntranceSuppressClick = 0
  owner.cardLinkReviewMode = undefined
  answerBinding = { notebookId: 'answers', selectionMode: 'designated', designatedAnswer: 'mindmap', questionColors: [] } as any
  sandbox.exports.onMnutilsEntranceClick({})
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  assert.ok(owner.mnutilsQuickMenu.selectedIds.has('chapter-two'), '答案脑图无颜色绑定时包含所有卡片')
  assert.ok(owner.mnutilsQuickMenu.selectedIds.has('q25'))
  assert.equal(owner.mnutilsQuickMenu.maskAnswers, false)
  globalColors = [1]
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  assert.equal(owner.mnutilsQuickMenu.selectedIds.has('chapter-two'), true, '答案脑图不受全局颜色限制')
  assert.ok(owner.mnutilsQuickMenu.selectedIds.has('q25'))

  answerBinding.questionColors = [1]
  globalColors = [0]
  sandbox.exports.onMnutilsQuickMenuFilter()
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  assert.ok(owner.mnutilsQuickMenu.selectedIds.has('chapter-two'), '答案脑图忽略旧局部与全局颜色')
  globalColors = [1]
  sandbox.exports.onMnutilsQuickMenuSelectAll()
  assert.equal(owner.mnutilsQuickMenu.mode, "selected")
  assert.deepEqual([...owner.mnutilsQuickMenu.selectedIds], ["question"])
  assert.equal(owner.mnutilsQuickMenu.customAllButton.hidden, true)
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.customAllButton.hidden, false)
  assert.equal(owner.mnutilsQuickMenu.filterButton.frame.width, owner.mnutilsQuickMenu.customAllButton.frame.width)
  sandbox.exports.closeMnutilsQuickMenu()
  await new Promise(resolve => setImmediate(resolve))
  selectedCards = []
  sandbox.exports.onMnutilsEntranceClick({})
  assert.equal(owner.mnutilsQuickMenu.mode, "all")
  assert.equal(owner.mnutilsQuickMenu.customAllButton, undefined)
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.mode, "filter")
  assert.equal(owner.mnutilsQuickMenu.selectedIds.size, 0)

  // Independent answer maps may put a question below a same-colored parent.
  // Exercise actual start actions through all three source-selection entries.
  sandbox.exports.closeMnutilsQuickMenu()
  await new Promise(resolve => setImmediate(resolve))
  root.colorIndex = 1
  globalColors = [1]
  answerBinding = { notebookId: "answers", selectionMode: "designated", designatedAnswer: "mindmap", questionColors: [1] }
  selectedCards = [question]
  sandbox.exports.onMnutilsEntranceClick({})
  assert.equal(owner.mnutilsQuickMenu.mode, "selected")
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.deepEqual(startedSelection, ["question"])
  assert.equal(startedModes[startedModes.length - 1], false)
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.mode, "all")
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.ok(startedSelection.includes("question"))
  sandbox.exports.onMnutilsQuickMenuFilter()
  assert.equal(owner.mnutilsQuickMenu.mode, "filter")
  const filterMenu = owner.mnutilsQuickMenu
  if (!filterMenu.expandedIds.has("root")) {
    sandbox.exports.onMnutilsQuickMenuToggleBranch({ tag: filterMenu.rowIds.indexOf("root") })
  }
  const questionRow = filterMenu.rowIds.indexOf("question")
  assert.ok(questionRow >= 0)
  sandbox.exports.onMnutilsQuickMenuToggleQuestion({ tag: questionRow })
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.deepEqual(startedSelection, ["question"])
  // Pure answer-map sources ignore both stale local and global color settings.
  globalColors = [15]
  answerBinding.questionColors = [14]
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.ok(startedSelection.includes("question"))
  assert.ok(startedSelection.includes("chapter-two"))
  assert.equal(owner.mnutilsQuickMenu.maskAnswers, false)
  // Subcard sources still require matching colors.
  answerBinding = { notebookId: "book", designatedAnswer: "subcard", questionColors: [14] }
  sandbox.exports.onMnutilsQuickMenuSelectAll({ tag: 1 })
  await sandbox.exports.onMnutilsQuickMenuStart()
  assert.ok(hudMessages[hudMessages.length - 1]?.includes("题目颜色筛选"))

})
