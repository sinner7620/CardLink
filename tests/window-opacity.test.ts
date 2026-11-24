import test from 'node:test'
import assert from 'node:assert/strict'
import { windowOpacityFixture } from './window-opacity-fixture'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

class View {
  layer = { opacity: 1 }; hidden = false; alpha = 1
  constructor(public frame: any = {}) {}
}

test('宿主淡化只被自有外壳拦截，不改变子控件或其他窗口', () => {
  const api = windowOpacityFixture(View)
  const shell = api.createWindowSurface({ x: 10, y: 20, width: 400, height: 500 })
  const child = new View(), foreign = new View()
  for (const alpha of [0, .1, .5, 1]) { shell.alpha = alpha; assert.equal(shell.layer.opacity, 1) }
  child.alpha = .28; foreign.alpha = .4
  assert.equal(child.alpha, .28); assert.equal(foreign.alpha, .4)
  assert.equal(shell.frame.width, 400)
})

test('显式淡出、淡入和用户透明度保留，宿主后续请求不会覆盖', () => {
  const api = windowOpacityFixture(View), shell = api.createWindowSurface({})
  for (const opacity of [0, .72, 1]) {
    api.setWindowSurfaceOpacity(shell, opacity)
    shell.alpha = .2
    assert.equal(shell.layer.opacity, opacity)
  }
  shell.hidden = true; shell.alpha = 0; shell.hidden = false
  assert.equal(shell.layer.opacity, 1, '隐藏再显示不会遗留宿主淡化值')
  const plain = new View()
  api.setWindowSurfaceOpacity(plain, 0)
  assert.equal(plain.alpha, 0)
})

test('各窗口状态独立，明确设置的透明度限制到有效范围', () => {
  const api = windowOpacityFixture(View), first = api.createWindowSurface({}), second = api.createWindowSurface({})
  api.setWindowSurfaceOpacity(first, 0)
  second.alpha = .3
  assert.equal(first.layer.opacity, 0); assert.equal(second.layer.opacity, 1)
  for (const [value, expected] of [[-1, 0], [3, 1], [NaN, 1]]) {
    api.setWindowSurfaceOpacity(first, value); assert.equal(first.layer.opacity, expected)
  }
})

test('经典浮窗不替换控制器根视图，WebView 从浮窗原点开始，隐藏恢复不遗留淡化', () => {
  class PanelView extends View {
    children: any[] = []; scrollView = {}; delegate: any
    addSubview(view: any) { this.children.push(view) }
    addGestureRecognizer() {}
  }
  const api = windowOpacityFixture(PanelView)
  const setup = readFileSync('rails-native/WebPanelController.js', 'utf8').match(/function setup\(controller\) \{[\s\S]*?\n  \}/)![0]
  const original = new PanelView()
  const controller: any = { get view() { return original }, set view(_value) { assert.fail('不能在 viewDidLoad 替换 UIKit 根视图') }, mainPath: '/addon' }
  const scope: any = { controller, __MN_ANSWER_CORE_GLOBAL__: api, UIWebView: PanelView, UILabel: PanelView,
    UIPanGestureRecognizer: class {}, UIColor: { clearColor: () => null, blackColor: () => null, grayColor: () => null },
    layoutCloseButton() {}, panelCloseButtonSide: () => 'left',
    savedFrame: () => ({ x: 16, y: 40, width: 620, height: 500 }) }
  runInNewContext(setup + ';setup(controller)', scope)
  assert.equal(controller.view, original)
  assert.equal(original.children.length, 0)
  assert.ok(controller.panelSurface.children.includes(controller.webView))
  assert.equal(controller.panelSurface.children.length, 3)
  assert.equal(controller.webView.frame.y, 0)
  controller.panelSurface.alpha = .15
  assert.equal(controller.panelSurface.layer.opacity, 1)
  controller.panelSurface.hidden = true; controller.panelSurface.alpha = 0; controller.panelSurface.hidden = false
  assert.equal(controller.panelSurface.layer.opacity, 1)
})

test('原生初始化时调用 alpha 不读取尚未建立的属性，类或实例失败不阻止窗口创建', () => {
  const ready = windowOpacityFixture(View, { initAlpha: true }).createWindowSurface({ width: 42 })
  assert.equal(ready.layer.opacity, 1)
  for (const options of [{ failClass: true }, { failInstance: true }]) {
    const plain = windowOpacityFixture(View, options).createWindowSurface({ width: 42 })
    assert.ok(plain instanceof View)
    assert.equal(plain.frame.width, 42)
  }
})

test('重复宿主淡化不反复写图层；需要恢复时移除 opacity 动画', () => {
  let writes = 0, value = 1
  const removed: string[] = []
  class AnimatedView extends View {
    layer = { get opacity() { return value }, set opacity(v) { value = v; writes++ }, removeAnimationForKey(k: string) { removed.push(k) } }
  }
  const shell = windowOpacityFixture(AnimatedView).createWindowSurface({})
  writes = 0
  for (let i = 0; i < 100; i++) shell.alpha = .2
  assert.equal(writes, 0)
  value = .3; shell.alpha = .2
  assert.equal(value, 1); assert.equal(writes, 1); assert.deepEqual(removed, ['opacity'])
})

test('跟手 frame 更新关闭继承动画并清除位置/尺寸 tween，结束后恢复动画开关', () => {
  let animations = true
  const removed: string[] = []
  class AnimatedView extends View {
    static areAnimationsEnabled() { return animations }
    static setAnimationsEnabled(value: boolean) { animations = value }
  }
  const api = windowOpacityFixture(AnimatedView)
  const panel: any = { set frame(value: any) { assert.equal(animations, false); this.result = value }, layer: { removeAnimationForKey(k: string) { removed.push(k) } } }
  api.setWindowFrame(panel, { x: 80, y: 90 })
  assert.equal(panel.result.x, 80); assert.equal(animations, true)
  assert.deepEqual(removed, ['position', 'bounds'])
  assert.throws(() => api.setWindowFrame({ set frame(_: any) { throw new Error('gone') } }, {}), /gone/)
  assert.equal(animations, true)
})
