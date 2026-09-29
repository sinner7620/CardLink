import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { build } from "esbuild"
import { mountCardPreview } from "../src/card-preview"
import { wireFramePinchZoom } from "../src/pinch-zoom"
import { pkDrawingRendererScript } from "../src/pkdrawing-renderer"
import { transpileModule } from "typescript"
import { collectQuestionTree, mindMapScopeOf, questionIdsInTree, renderedMindMapNoteIds } from "../src/quick-menu-selection"
import { quickMenuGeometry } from "../src/quick-menu-geometry"

function surface() {
  const events = new Map<string, Set<any>>()
  const target = {
    addEventListener(name: string, handler: any) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(handler) },
    removeEventListener(name: string, handler: any) { events.get(name)?.delete(handler) }
  }
  const card = { style: {} as any, scrollHeight: 800 }
  const root = { style: {} as any, clientWidth: 400, dataset: {} as any }
  const doc = { ...target, body: { style: {} as any }, documentElement: root, querySelector: () => card }
  let scrollCalls = 0
  const win: any = { ...target, document: doc, innerWidth: 400, innerHeight: 500, scrollX: 0, scrollY: 0, setTimeout, clearTimeout, scrollTo() { scrollCalls++ } }
  return { win, card, root, events, scrollCalls: () => scrollCalls }
}

test("缩小后短卡水平垂直居中，长卡仅水平居中且保留滚动高度", () => {
  const { win, card } = surface()
  card.scrollHeight = 500
  const controller = mountCardPreview(win, wireFramePinchZoom)
  controller.setScale(.6)
  assert.equal(card.style.left, "80px")
  assert.equal(card.style.top, "100px")
  assert.equal(win.document.body.style.width, "400px")
  assert.equal(win.document.body.style.height, "500px")
  card.scrollHeight = 1000
  controller.setScale(.7)
  assert.equal(card.style.left, "60px")
  assert.equal(card.style.top, "0px")
  assert.equal(win.document.body.style.height, "700px")
  controller.destroy()
})

test("预览空白处双击切换绑定手写，单指拖动和双指缩放不触发切换", () => {
  const { win, card, events } = surface()
  const handwriting = { hidden: true }
  win.document.querySelector = (selector: string) => selector === ".card" ? card : handwriting
  const controller = mountCardPreview(win, wireFramePinchZoom)
  const fire = (name: string, touches: any[] = []) => events.get(name)?.forEach(handler => handler({ touches, preventDefault() {} }))
  fire("dblclick")
  assert.equal(handwriting.hidden, false)
  fire("dblclick")
  assert.equal(handwriting.hidden, true)
  fire("touchstart", [{ clientX: 10, clientY: 10 }])
  fire("touchmove", [{ clientX: 10, clientY: 80 }])
  fire("touchend")
  assert.equal(handwriting.hidden, true)
  for (let i = 0; i < 2; i++) {
    fire("touchstart", [{ clientX: 10, clientY: 10 }])
    fire("touchend")
  }
  assert.equal(handwriting.hidden, false)
  fire("dblclick")
  assert.equal(handwriting.hidden, false, "忽略双击触摸后的合成鼠标事件")
  controller.destroy()
  assert.equal(events.get("dblclick")?.size, 0)
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

test("HTML与iframe重复接入时只安装一个预览控制器，100%没有transform，清理释放手势", () => {
  const { win, card, events } = surface()
  const controller = mountCardPreview(win, wireFramePinchZoom)
  assert.equal(mountCardPreview(win, wireFramePinchZoom), controller)
  assert.equal(events.get("touchmove")?.size, 2)
  assert.equal(card.style.transform, "none")
  controller.setScale(1.5)
  assert.equal(card.style.transform, "scale(1.5)")
  assert.equal(win.document.body.style.width, "600px")
  assert.equal(win.document.body.style.height, "1200px")
  controller.setScale(1)
  assert.equal(card.style.transform, "none")
  controller.destroy()
  assert.equal(events.get("touchmove")?.size, 0)
  assert.equal(win.__mnCardPreview, undefined)
})

test("相同比例回写不重复调整滚动锚点，避免工具条与手势双写抖动", () => {
  const { win, scrollCalls } = surface()
  const controller = mountCardPreview(win, wireFramePinchZoom)
  controller.setScale(1.4, { x: 100, y: 100 })
  assert.equal(scrollCalls(), 1)
  controller.setScale(1.4, { x: 100, y: 100 })
  assert.equal(scrollCalls(), 1)
  controller.destroy()
})

test("单指上下移动不拦截，双指由唯一手势内核接管", () => {
  const { win, events } = surface()
  mountCardPreview(win, wireFramePinchZoom)
  let prevented = 0
  const fire = (name: string, touches: any[]) => events.get(name)?.forEach(handler => handler({ touches, preventDefault: () => prevented++ }))
  fire("touchstart", [{ clientX: 10, clientY: 10 }])
  fire("touchmove", [{ clientX: 10, clientY: 100 }])
  assert.equal(prevented, 0)
  fire("touchstart", [{ clientX: 10, clientY: 10 }, { clientX: 20, clientY: 10 }])
  fire("touchmove", [{ clientX: 10, clientY: 10 }, { clientX: 30, clientY: 10 }])
  assert.equal(prevented, 1)
  assert.equal(win.__mnCardPreview.getScale(), 2)
  win.__mnCardPreview.destroy()
})

test("原生打包后的预览脚本完全自包含且强制浅色", async () => {
  const bundled = await build({ entryPoints: ["src/card-html.ts"], bundle: true, write: false, format: "iife", globalName: "renderer", minify: true, target: "safari13" })
  const sandbox: any = { console }
  runInNewContext(bundled.outputFiles[0].text, sandbox)
  const html = sandbox.renderer.renderCardHtml({ noteTitle: "测试", comments: [] }, "题目", () => null, () => null)
  assert.match(html, /color-scheme:light/)
  assert.doesNotMatch(html, /prefers-color-scheme:dark/)
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  const { win } = surface()
  const previewScript = scripts.find(match => match[1].includes("__mnCardPreview"))
  assert.ok(previewScript)
  runInNewContext(previewScript[1], { window: win })
  assert.equal(win.__mnCardPreview.getScale(), 1)
  win.__mnCardPreview.destroy()
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
    constructor(frame?: any) { this.frame = frame }
    addSubview(view: any) { this.children.push(view); view.superview = this }
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
  const window: any = new View(); window.bounds = { width: 1024, height: 768 }
  const root: any = { noteId: "root", noteTitle: "章节", colorIndex: 0 }
  const question: any = { noteId: "question", noteTitle: "题目", colorIndex: 1, parentNote: root }
  const answer: any = { noteId: "answer", noteTitle: "答案", colorIndex: 2, parentNote: question }
  const directory: any = { noteId: "directory", noteTitle: "文档目录", colorIndex: 3 }
  const notes = [root, { ...question, colorIndex: 9 }, answer, directory]
  const mindmap = { mindmapNodes: [root, question, answer].map(note => ({ note })) }
  let visible = false, shown = 0
  let startedSelection: string[] = []
  const ball = new View({ x: 900, y: 60, width: 44, height: 44 }); ball.imageView = { alpha: 1 }; window.addSubview(ball)
  const entrance = {
    button: ball,
    layer: ball.layer,
    get frame() { return ball.frame },
    set frame(value: any) { ball.frame = value },
    set alpha(value: number) { ball.alpha = value },
    set backgroundColor(value: any) { ball.backgroundColor = value }
  }
  const owner: any = { window, webController: {}, mnutilsEntranceBall: entrance }
  Object.defineProperty(owner, "isPluginEnabled", { get() { throw Error("不能访问宿主getter") } })
  const color = { colorWithAlphaComponent() { return this } }
  const sandbox: any = {
    self: owner, exports: {}, console,
    MNUtil: { currentWindow: window, animate: (update: any) => { update(); return Promise.resolve() } },
    NSUserDefaults: { standardUserDefaults: () => ({ objectForKey() {}, setObjectForKey() {}, synchronize() {} }) },
    UIView: View, UIScrollView: View, UILabel: Label, UIWebView: class extends View { scrollView = new View() }, UITapGestureRecognizer: class { cancelsTouchesInView = true }, UILongPressGestureRecognizer: class {},
    UIButton: { buttonWithType: () => new View() },
    UIImage: { imageWithContentsOfFile: () => ({}) },
    UIColor: { colorWithHexString: () => color, clearColor: () => color, blackColor: () => color, whiteColor: () => color },
    UIFont: { systemFontOfSize() {}, boldSystemFontOfSize() {} },
    Application: { sharedInstance: () => ({ studyController: () => ({ refreshAddonCommands() {} }) }) },
    __MNAM_WEB_PANEL_GLOBAL__: {
      isVisible: () => visible,
      showPanel: () => { visible = true; shown++ },
      hidePanel: () => { visible = false }
    },
    require: (name: string) => name === "./card-toolbar-state"
      ? {}
      : name === "./ui-tokens" ? { UI_COLORS: { accent: "#0e8dfd", grayFill: "#d8d8dd", surface: "#f7f8fa" } }
      : name === "./quick-menu-geometry" ? { quickMenuGeometry }
      : name === "./question-clipper" ? { clipperModeActive: () => false, exitClipperMode() {} }
      : name === "./same-map-practice" ? { sameMapPracticeActive: () => false, stopSameMapPractice() {}, startSameMapPractice: (_book: string, ids: Set<string>) => { startedSelection = [...ids]; return { started: true, answerCount: 1 } } }
      : name === "./quick-menu-selection" ? { collectQuestionTree, mindMapScopeOf, questionIdsInTree, renderedMindMapNoteIds }
      : name === "./note-tree" ? { notebookNotes: () => notes }
      : name === "./mindmap-candidate" ? { MAIN_MINDMAP_SCOPE_ID: "__mn4_main_mindmap__", mindMapScopeIdForNote: (note: any) => note?.childMindMap?.noteId || "__mn4_main_mindmap__" }
      : name === "./store" ? { bindingKey: (notebookId: string, rootId: string) => `${notebookId}::root::${rootId}`, loadBindings: () => ({ "book::root::__mn4_main_mindmap__": { notebookId: "book", rootNodeId: "__mn4_main_mindmap__", questionColors: [1] } }), normalizeBinding: (value: any) => value }
      : name === "marginnote" ? {
        showHUD() {}, MN: { currnetNotebookId: "book", db: { getNotebookById: () => ({ notes }) }, notebookController: { mindmapView: mindmap } },
        NodeNote: { getSelectedNodes: () => [{ note: question }] }
      }
      : { showHUD() {} }
  }
  runInNewContext(transpileModule(readFileSync("src/mnutils-entrance.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, sandbox)
  sandbox.exports.onMnutilsEntranceClick({})
  assert.equal(shown, 0)
  assert.equal(owner.mnutilsQuickMenu.open, true)
  assert.equal(ball.frame.width, 44)
  assert.equal(ball.frame.x, 900)
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 272)
  assert.equal(owner.mnutilsQuickMenu.content.superview, window)
  assert.equal(owner.mnutilsQuickMenu.content.layer.mask, undefined)
  assert.equal(window.children.length, 2)
  assert.equal(owner.mnutilsQuickMenu.controls.alpha, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 272)
  assert.equal(owner.mnutilsQuickMenu.content.frame.height, 122)
  assert.equal(ball.frame.width, 44)
  assert.equal(ball.frame.x, 900)
  assert.equal(owner.mnutilsQuickMenu.controls.alpha, 1)
  assert.equal(ball.children.length, 0)
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
  sandbox.exports.onMnutilsQuickMenuToggleQuestion({ tag: 0 })
  assert.equal(owner.mnutilsQuickMenu.selectedIds.size, 1)
  const previousList = owner.mnutilsQuickMenu.listContainer
  sandbox.exports.onMnutilsQuickMenuToggleBranch({ tag: 0 })
  assert.equal(previousList.alpha, 0)
  assert.equal(owner.mnutilsQuickMenu.listContainer.alpha, 1)
  assert.equal(previousList.superview, owner.mnutilsQuickMenu.controls)
  assert.equal(owner.mnutilsQuickMenu.content.frame.width, 272)
  sandbox.exports.onMnutilsQuickMenuSelectAll()
  assert.equal(owner.mnutilsQuickMenu.selectedIds.size, 1)
  sandbox.exports.onMnutilsEntrancePan({ state: 1, locationInView: () => ({ x: 815, y: 73 }) })
  sandbox.exports.onMnutilsEntrancePan({ state: 2, locationInView: () => ({ x: 785, y: 93 }) })
  assert.equal(owner.mnutilsQuickMenu.open, true)
  sandbox.exports.onMnutilsEntrancePan({ state: 3, locationInView: () => ({ x: 785, y: 93 }) })
  assert.equal(owner.mnutilsQuickMenu.open, true)
  const anchoredX = ball.frame.x, anchoredY = ball.frame.y
  const closingContent = owner.mnutilsQuickMenu.content
  sandbox.exports.onMnutilsQuickMenuDismiss()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closingContent.alpha, 0)
  assert.equal(owner.mnutilsQuickMenu, undefined)
  assert.equal(ball.frame.width, 44)
  assert.equal(ball.frame.x, anchoredX)
  assert.equal(ball.frame.y, anchoredY)
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
  sandbox.exports.onMnutilsQuickMenuSelectAll()
  sandbox.exports.onMnutilsQuickMenuStart()
  assert.deepEqual(startedSelection, ["question"])
})
