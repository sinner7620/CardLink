import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'

function harness(windowed = true) {
  const views: any[] = []
  class View {
    layer = {}; scrollView = {}; delegate: any; html = ''; removed = false
    subviews: View[] = []; superview?: View; window?: View
    userInteractionEnabled = true; hidden = false
    constructor(public frame: any) { views.push(this) }
    get bounds() { return { width: this.frame.width, height: this.frame.height } }
    addSubview(view: View) { view.superview?.removeSubview(view); this.subviews.push(view); view.superview = this }
    removeSubview(view: View) { this.subviews = this.subviews.filter(child => child !== view) }
    bringSubviewToFront(view: View) { this.removeSubview(view); this.subviews.push(view) }
    removeFromSuperview() { this.superview?.removeSubview(this); this.superview = undefined; this.removed = true }
    hitTest(x: number, y: number): View | undefined {
      if (this.hidden || !this.userInteractionEnabled || x < 0 || y < 0 || x >= this.bounds.width || y >= this.bounds.height) return
      for (const child of [...this.subviews].reverse()) {
        const target = child.hitTest(x - child.frame.x, y - child.frame.y)
        if (target) return target
      }
      return this
    }
    loadHTMLStringBaseURL(html: string) { this.html = html }
  }
  const window = new View({ x: 0, y: 0, width: 900, height: 700 })
  const host = new View({ x: 80, y: 30, width: 360, height: 640 })
  const panel = new View({ x: 0, y: 0, width: 900, height: 700 })
  if (windowed) { host.window = window; window.addSubview(host); window.addSubview(panel) }
  const exports: any = {}
  const scope: any = { exports, UIWebView: View, UIColor: { clearColor: () => 'clear' }, NSURL: { URLWithString: (s: string) => s },
    JSB: { defineClass: (_: string, methods: any) => ({ new: () => methods }) },
    require: (id: string) => id === 'marginnote' ? { MN: { studyController: { view: host } }, delay: async () => {} }
      : id.includes('window-opacity') ? { createWindowSurface: (frame: any) => new View(frame) }
      : { escapeHtml: (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)) }
  }
  runInNewContext(transpileModule(readFileSync('src/notebook-picker.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  return { api: exports, views, window, host, panel }
}
test('脑图选择返回原始项目；取消和生命周期关闭不绑定，旧窗口回调无效', async () => {
  const h = harness(), items = [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]
  const selected = h.api.chooseNotebook(items, '标题', '消息')
  await new Promise(resolve => setImmediate(resolve))
  const web = h.views[h.views.length - 1]
  const navigate = (url: string) => web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => url }) })
  assert.equal(navigate('cardlink-picker://pick/99'), false)
  navigate('cardlink-picker://pick/1')
  assert.equal(await selected, items[1])
  const cancel = h.api.chooseNotebook(items); await new Promise(resolve => setImmediate(resolve))
  h.api.closeNotebookPicker()
  assert.equal(await cancel, undefined)
  assert.equal(navigate('cardlink-picker://pick/0'), false)
})
test('选择窗只占内容尺寸，长列表和窄窗口有界；原生两层背板透明', async () => {
  const h = harness(false)
  for (const bounds of [{ width: 1024, height: 768 }, { width: 360, height: 640 }, { width: 240, height: 260 }]) {
    for (const count of [0, 1, 80]) {
      const frame = h.api.notebookPickerFrame(bounds, count)
      assert.ok(frame.width <= 480 && frame.height <= 560)
      assert.ok(frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= bounds.width && frame.y + frame.height <= bounds.height)
    }
  }
  assert.ok(h.api.notebookPickerFrame({ width: 1024, height: 768 }, 1).height < h.api.notebookPickerFrame({ width: 1024, height: 768 }, 80).height)
  const picking = h.api.chooseNotebook([{ id: 'a', title: '甲' }])
  await new Promise(resolve => setImmediate(resolve))
  const web = h.views[h.views.length - 1]
  assert.equal(web.opaque, false)
  assert.equal(web.backgroundColor, 'clear')
  assert.equal(web.scrollView.backgroundColor, 'clear')
  assert.equal(web.scrollView.opaque, false)
  assert.equal(web.scrollView.scrollEnabled, false)
  assert.ok(web.frame.width < 360 && web.frame.height < 640)
  h.api.closeNotebookPicker(); await picking
})

test('窗口同层透明触控层阻止底下插件抢焦点，外侧点击后仍命中列表；关闭恢复页面', async () => {
  const h = harness(), items = [{ id: 'a', title: '甲' }]
  let panelTaps = 0
  assert.equal(h.window.hitTest(10, 10), h.panel)
  const picking = h.api.chooseNotebook(items)
  await new Promise(resolve => setImmediate(resolve))
  const web = h.views[h.views.length - 1], container = web.superview!, shield = container.superview!
  assert.equal(shield.superview, h.window)
  assert.equal(shield.backgroundColor, 'clear')
  assert.equal(shield.opaque, false)
  assert.equal(shield.userInteractionEnabled, true)
  assert.deepEqual(JSON.parse(JSON.stringify(shield.frame)), { x: 0, y: 0, width: 900, height: 700 })
  assert.ok(container.frame.width < shield.frame.width && container.frame.height < shield.frame.height)
  const outside = h.window.hitTest(10, 10)
  if (outside === h.panel) { panelTaps++; h.window.bringSubviewToFront(h.panel) }
  assert.equal(outside, shield)
  assert.equal(panelTaps, 0)
  assert.equal(h.window.hitTest(container.frame.x + 20, container.frame.y + 120), web)
  web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => 'cardlink-picker://pick/0' }) })
  assert.equal(await picking, items[0])
  assert.equal(shield.removed, true)
  assert.equal(h.window.hitTest(10, 10), h.panel)
})

test('替换或取消选择器移除完整触控层，旧回调不能关闭新窗口', async () => {
  const h = harness(), items = [{ id: 'a', title: '甲' }]
  const first = h.api.chooseNotebook(items)
  await new Promise(resolve => setImmediate(resolve))
  const oldWeb = h.views[h.views.length - 1], oldShield = oldWeb.superview!.superview!
  const second = h.api.chooseNotebook(items)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await first, undefined)
  assert.equal(oldShield.removed, true)
  const web = h.views[h.views.length - 1], shield = web.superview!.superview!
  oldWeb.delegate.webViewShouldStartLoadWithRequestNavigationType(oldWeb, { URL: () => ({ absoluteString: () => 'cardlink-picker://cancel' }) })
  assert.equal(shield.removed, false)
  web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => 'cardlink-picker://cancel' }) })
  assert.equal(await second, undefined)
  assert.equal(shield.removed, true)
  assert.equal(h.window.hitTest(10, 10), h.panel)
})

test('长列表 HTML 转义名称并支持搜索；生成窄屏视觉检查输入', () => {
  const h = harness(), items = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: `学习集 ${i} 很长的脑图名称` }))
  items[0].title = '<script> & "学习集"'
  const html = h.api.notebookPickerHtml(items, '绑定答案脑图', '请选择对应的答案脑图')
  assert.ok(!html.includes('<script> &'))
  assert.ok(html.includes('&lt;script&gt;'))
  mkdirSync('output/playwright', { recursive: true })
  writeFileSync('output/playwright/notebook-picker.html', html)
})
