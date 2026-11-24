import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { windowOpacityFixture } from './window-opacity-fixture'

function harness(show = true) {
  const loads: Array<{ path: string; frame: any; attached: boolean; registered: boolean }> = []
  let registered = false
  class View {
    frame: any; layer: any = { removeAnimationForKey() {} }; scrollView: any = {}
    hidden = false; children: any[] = []; superview: any
    constructor(frame = { x: 0, y: 0, width: 1024, height: 768 }) { this.frame = frame }
    get bounds() { return { ...this.frame, x: 0, y: 0 } }
    set bounds(_value) {}
    addSubview(view: any) { view.superview = this; this.children.push(view) }
    removeFromSuperview() { this.superview = null }
    addGestureRecognizer() {}
    loadRequest(path: string) {
      loads.push({ path, frame: this.frame, attached: this.superview?.superview === host, registered })
    }
  }
  const root = new View(), host = new View(), opacity = windowOpacityFixture(View)
  const core = {
    ...opacity,
    enableMistakeDrag() { registered = true },
    disableMistakeDrag() { registered = false },
  }
  let methods: any
  const scope: any = { __MN_ANSWER_CORE_GLOBAL__: core, UIWebView: View, UILabel: View,
    UIColor: { clearColor() {}, blackColor() {}, grayColor() {} }, UIPanGestureRecognizer: class {},
    NSURL: { fileURLWithPath: (p: string) => p }, NSURLRequest: { requestWithURL: (p: string) => p },
    NSUserDefaults: { standardUserDefaults: () => ({ objectForKey() {}, setObjectForKey() {} }) } }
  scope.JSB = { require() {}, defineClass(_name: string, handlers: any) {
    methods = handlers
    return { new() {
      let loaded = false
      const controller: any = { get view() {
        if (!loaded) { loaded = true; const previous = scope.self; scope.self = controller; try { handlers.viewDidLoad() } finally { scope.self = previous } }
        return root
      }, set view(_) { assert.fail('replaced controller root') } }
      return controller
    } }
  } }
  runInNewContext(readFileSync('rails-native/ui-constants.js', 'utf8'), scope)
  runInNewContext(readFileSync('rails-native/WebPanelController.js', 'utf8'), scope)
  const api = scope.__MNAM_WEB_PANEL_GLOBAL__
  const controller = api.createController('/addon', { window: host })
  if (show) api.showPanel(controller)
  function invoke(name: string, gesture: any) { scope.self = controller; return methods[name](gesture) }
  return { api, controller, root, invoke, loads, isRegistered: () => registered }
}

test('经典面板首次打开时才创建 WebView，关闭和重开复用该实例', () => {
  const { api, controller, root, loads, isRegistered } = harness(false)
  api.ensureLayout(controller)
  api.hidePanel(controller, false)
  assert.equal(api.isVisible(controller), false)
  assert.equal(controller.webView, undefined)
  api.showPanel(controller)
  const webView = controller.webView
  assert.ok(webView)
  const { width, height } = controller.panelSurface.frame
  assert.equal(loads.length, 1)
  assert.equal(loads[0].path, "/addon/web-dist/index.html")
  assert.equal(loads[0].attached, true)
  assert.equal(loads[0].registered, true)
  assert.equal(loads[0].frame.width, width)
  assert.equal(loads[0].frame.height, height)
  assert.equal(root.hidden, true)
  assert.equal(api.isVisible(controller), true)
  api.hidePanel(controller)
  assert.equal(isRegistered(), false)
  api.showPanel(controller)
  assert.equal(controller.webView, webView)
  assert.equal(loads.length, 1)
  assert.equal(isRegistered(), true)
})

test('从场景切回经典模式并恢复面板时，可以首次加载经典 WebView', () => {
  const { api, controller } = harness(false)
  controller.preserveAcrossNotebookSwitch = true
  api.restorePanelAfterNotebookSwitch(controller)
  assert.ok(controller.webView)
  assert.equal(api.isVisible(controller), true)
  assert.equal(controller.preserveAcrossNotebookSwitch, false)
})

test('经典浮窗拖动直接跟随位移，重复回调不累计漂移，缩放不能抢占', () => {
  const h = harness(), c = h.controller
  const start = { ...c.panelSurface.frame }
  const gesture = c.headerPan
  let delta = { x: 0, y: 0 }
  gesture.locationInView = () => ({ x: 240, y: 20 })
  gesture.translationInView = () => delta
  assert.equal(h.invoke('gestureRecognizerShouldBegin', gesture), true)
  gesture.state = 1; h.invoke('handleHeaderPan', gesture)
  delta = { x: 38, y: 21 }; gesture.state = 2
  h.invoke('handleHeaderPan', gesture); h.invoke('handleHeaderPan', gesture)
  assert.equal(c.panelSurface.frame.x, start.x + 38)
  assert.equal(c.panelSurface.frame.y, start.y + 21)
  c.resizePan.state = 1
  assert.equal(h.invoke('gestureRecognizerShouldBegin', c.resizePan), false)
  h.invoke('handleResize', c.resizePan)
  assert.equal(c.resizeStart, undefined)
  gesture.state = 3; h.invoke('handleHeaderPan', gesture)
  assert.equal(c.activeFrameGesture, null)
  assert.equal(c.userAdjustingFrame, false)
  assert.equal(h.root.children.length, 0)
})

test('角部缩放不移动窗口，取消和关闭释放手势锁，重开保留稳定尺寸', () => {
  const h = harness(), c = h.controller, start = { ...c.panelSurface.frame }
  const gesture = c.resizePan
  let point = { x: 600, y: 500 }
  gesture.locationInView = () => point
  gesture.state = 1; h.invoke('handleResize', gesture)
  point = { x: 640, y: 530 }; gesture.state = 2; h.invoke('handleResize', gesture)
  assert.equal(c.panelSurface.frame.width, start.width + 40)
  assert.equal(c.panelSurface.frame.height, start.height + 30)
  assert.equal(c.panelSurface.frame.x, start.x)
  gesture.state = 4; h.invoke('handleResize', gesture)
  assert.equal(c.activeFrameGesture, null)
  gesture.state = 1; h.invoke('handleResize', gesture)
  h.api.hidePanel(c)
  assert.equal(c.activeFrameGesture, null)
  h.api.showPanel(c)
  assert.equal(c.panelSurface.frame.width, start.width + 40)
  assert.equal(h.api.isVisible(c), true)
})
