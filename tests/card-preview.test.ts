import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { build } from "esbuild"
import { mountCardPreview } from "../src/card-preview"
import { wireFramePinchZoom } from "../src/pinch-zoom"
import { pkDrawingRendererScript } from "../src/pkdrawing-renderer"
import { transpileModule } from "typescript"

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
  runInNewContext(scripts[scripts.length - 1][1], { window: win })
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

test("悬浮球单击复用主面板开关且不创建自绘原生菜单", () => {
  class View {
    frame: any; layer: any = {}; children: any[] = []; superview: any
    constructor(frame?: any) { this.frame = frame }
    addSubview(view: any) { this.children.push(view); view.superview = this }
    removeFromSuperview() { this.superview = null }
    addTargetActionForControlEvents(_owner: any, selector: string) { assert.match(selector, /:$/) }
  }
  const window: any = new View(); window.bounds = { width: 1024, height: 768 }
  let visible = false, shown = 0, hidden = 0
  const owner: any = { window, webController: {}, mnutilsEntranceBall: { frame: { x: 900, y: 60 }, button: { superview: window } } }
  Object.defineProperty(owner, "isPluginEnabled", { get() { throw Error("不能访问宿主getter") } })
  const color = { colorWithAlphaComponent() { return this } }
  const sandbox: any = {
    self: owner, exports: {}, console, MNUtil: { currentWindow: window },
    UIView: View, UILabel: View, UIButton: { buttonWithType: () => new View() },
    UIColor: { colorWithHexString: () => color, clearColor: () => color, blackColor: () => color },
    UIFont: { systemFontOfSize() {}, boldSystemFontOfSize() {} },
    Application: { sharedInstance: () => ({ studyController: () => ({ refreshAddonCommands() {} }) }) },
    __MNAM_WEB_PANEL_GLOBAL__: {
      isVisible: () => visible,
      showPanel: () => { visible = true; shown++ },
      hidePanel: () => { visible = false; hidden++ }
    },
    require: (name: string) => name === "./card-toolbar-state"
      ? {}
      : name === "./ui-tokens" ? { UI_COLORS: { accent: "#0e8dfd" } } : { showHUD() {} }
  }
  runInNewContext(transpileModule(readFileSync("src/mnutils-entrance.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, sandbox)
  sandbox.exports.onMnutilsEntranceClick({})
  assert.equal(shown, 1)
  assert.equal(window.children.length, 0)
  sandbox.exports.onMnutilsEntranceClick({})
  assert.equal(hidden, 1)
})
