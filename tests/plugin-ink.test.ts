import { windowOpacityFixture } from "./window-opacity-fixture"
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
import * as records from '../src/plugin-ink-record'
import { pluginInkFrame } from '../src/plugin-ink-layout'

const png = 'data:image/png;base64,aGVsbG8='
const payload = () => ({ width: 880, height: 1200, background: png, image: png,
  strokes: JSON.stringify({ strokes: [{ points: [{ x: 10, y: 20, pressure: .5, time: 1 }], options: { size: 3.5 } }] }) })
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness() {
  const files = new Map<string, any>(), comments: any[] = [], calls: any[] = [], views: any[] = []
  const owner: any = { cardLinkReviewMode: { annotationToken: 'one' }, cardLinkReviewAnnotationClosed: (event: any) => { calls.push({ closed: event }); return true } }
  class View {
    frame: any; bounds: any; layer: any = {}; delegate: any; html = ''; superview: any; payload = payload()
    scrollView: any = { scrollEnabled: true, bounces: true, delaysContentTouches: true, canCancelContentTouches: true }
    constructor(frame: any) { this.frame = frame; this.bounds = frame; views.push(this) }
    addSubview(v: any) { v.superview = this }
    removeFromSuperview() { this.superview = undefined }
    loadHTMLStringBaseURL(html: string) { this.html = html }
    evaluateJavaScript(script: string, cb: any) { calls.push({ script }); if (cb) cb(JSON.stringify(this.payload)) }
  }
  const host = new View({ width: 1024, height: 768 })
  const target = { noteid: 'source', topicid: 'book', recordId: 'record', reviewToken: 'one', advance: 'next' }
  const state: any = { failFold: false, failWrite: false, choice: 0 }
  const note: any = { noteId: 'source', noteTitle: '原题', comments: [], appendHtmlComment(html: string, text: string) {
    calls.push({ append: { html, text } }); comments.push({ text, commentId: 'comment-' + comments.length, index: comments.length + 1, collapsed: false })
  } }
  const modules: any = {
    "./window-opacity": windowOpacityFixture(View),
    marginnote: { MN: { db: { getNoteById: () => note }, studyController: { view: host }, app: { refreshAfterDBChanged() {} } },
      select: async () => ({ index: state.choice }), isfileExists: (p: string) => files.has(p) || [...files.keys()].some(f => f.startsWith(p + '/')), readJSON: (p: string) => files.get(p) },
    './storage-paths': { cardLinkDocumentPath: (p: string) => '/data/' + p, ensureStorageDirectory: () => true },
    './content-fingerprint': { sha256Hex: (s: string) => s.replace(/[^a-z]/g, '') },
    './card-html': { renderCardHtml: () => '<html><body><article class="card">原题</article></body></html>' },
    './plugin-ink-record': records, './plugin-ink-layout': { pluginInkFrame }, './workbench-notification': { notifyWorkbenchDataChanged() { calls.push({ notified: true }) } }
  }
  const scope: any = { exports: {}, require: (name: string) => modules[name],
    __PLUGIN_INK_SCRIPT__: '/* bundled */', UIView: View, UIWebView: View, UIColor: { whiteColor: () => 'white' },
    JSB: { defineClass: (_name: string, methods: any) => ({ new: () => methods }) },
    UndoManager: { sharedInstance: () => ({ undoGrouping: (_name: string, _book: string, fn: any) => fn() }) },
    NSData: { dataWithStringEncoding: (text: string) => ({ writeToFileAtomically: (p: string, atomic: boolean) => {
      assert.equal(atomic, true); if (state.failWrite) return false; files.set(p, JSON.parse(text)); return true
    } }) },
    NSFileManager: { defaultManager: () => ({ contentsOfDirectoryAtPath: (p: string) => [...files.keys()].filter(f => f.startsWith(p + '/')).map(f => f.slice(p.length + 1)) }) },
    __MNAM_SCENE_WORKBENCH_GLOBAL__: { openReviewAnnotation: async (_owner: any, request: any) => {
      calls.push({ operation: request.operation })
      if (request.operation === 'ink-fold') {
        if (state.failFold) throw new Error('折叠失败')
        comments.find(c => c.text === request.marker).collapsed = true
        return { comments, persisted: true }
      }
      return { comments }
    } }
  }
  runInNewContext(transpileModule(readFileSync('src/plugin-ink-window.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const api = scope.exports
  function command(name: string) { const view = views[views.length - 1]; return view.delegate.webViewShouldStartLoadWithRequestNavigationType(view, { URL: () => ({ absoluteString: () => 'cardlink-ink://' + name }) }) }
  return { api, owner, target, state, calls, files, comments, views, command }
}

test('批注先保留笔画、再写原题图片评论，折叠失败不推进；重试不重复追加', async () => {
  const h = harness(); await h.api.openPluginInkWindow(h.owner, h.target)
  h.command('ready'); h.state.failFold = true; h.command('save'); await tick()
  assert.equal(h.files.size, 1); assert.equal(h.comments.length, 1)
  assert.ok(h.calls.find(c => c.append).append.html.includes(png))
  assert.equal(h.calls.filter(c => c.closed).length, 0)
  // The upstream exporter changes its timestamp on every save, including retries.
  h.views[h.views.length - 1].payload.strokes = JSON.stringify({ ...JSON.parse(payload().strokes), timestamp: Date.now() })
  h.state.failFold = false; h.command('save'); await tick()
  assert.equal(h.comments.length, 1); assert.equal(h.comments[0].collapsed, true)
  assert.equal(h.calls.filter(c => c.closed).length, 1)
  assert.equal(h.calls.find(c => c.closed).closed.action, 'next')
  assert.equal([...h.files.values()][0].saved, true)
  h.api.disposePluginInkWindow(h.owner)
})

test('作答窗口让网页处理纸张手势，原生滚动不延迟或取消书写触摸', async () => {
  const h = harness(); await h.api.openPluginInkWindow(h.owner, h.target)
  const scroll = h.views[h.views.length - 1].scrollView
  assert.deepEqual(scroll, { scrollEnabled: false, bounces: false, delaysContentTouches: false, canCancelContentTouches: false })
})

test('批注窗口尺寸与位置约束在宿主内，窄分屏保留可操作范围', () => {
  for (const bounds of [{ width: 1024, height: 768 }, { width: 390, height: 600 }, { width: 320, height: 300 }]) {
    for (const request of [undefined, { x: -100, y: -100, width: 10000, height: 10000 }, { x: 9999, y: 9999, width: 0, height: 0 }, { width: NaN, height: Infinity }]) {
      const frame = pluginInkFrame(bounds, request)
      assert.ok(frame.x >= 0 && frame.y >= 0)
      assert.ok(frame.x + frame.width <= bounds.width)
      assert.ok(frame.y + frame.height <= bounds.height)
      assert.ok(frame.width > 0 && frame.height > 0)
    }
  }
})

test('窗口调节改原生 frame 并回传实际值，不写批注或推进复习，重开沿用尺寸', async () => {
  const h = harness(); await h.api.openPluginInkWindow(h.owner, h.target)
  const view = h.views[h.views.length - 1], container = view.superview
  h.command('layout?' + encodeURIComponent(JSON.stringify({ x: 120, y: 104, width: 480, height: 540 })))
  assert.deepEqual(JSON.parse(JSON.stringify(container.frame)), { x: 120, y: 104, width: 480, height: 540 })
  assert.ok(h.calls.some(c => c.script?.startsWith('window.cardlinkInkLayout(')))
  assert.equal(h.files.size, 0); assert.equal(h.comments.length, 0)
  assert.equal(h.calls.filter(c => c.closed).length, 0)
  h.command('layout?bad-json')
  assert.equal(container.frame.width, 480)
  h.command('cancel'); await tick()
  await h.api.openPluginInkWindow(h.owner, h.target)
  assert.equal(h.views[h.views.length - 1].superview.frame.width, 480)
})

test('笔画落盘失败不写评论、不推进复习', async () => {
  const h = harness(); await h.api.openPluginInkWindow(h.owner, h.target)
  h.state.failWrite = true; h.command('save'); await tick()
  assert.equal(h.files.size, 0); assert.equal(h.comments.length, 0)
  assert.equal(h.calls.filter(c => c.closed).length, 0)
})

test('失败后修改笔迹生成另一版本，原有未确认评论不被误认成新图片', async () => {
  const h = harness(); await h.api.openPluginInkWindow(h.owner, h.target)
  h.state.failFold = true; h.command('save'); await tick()
  const strokes = JSON.parse(payload().strokes)
  strokes.strokes[0].points.push({ x: 30, y: 40, pressure: .6, time: 2 })
  h.views[h.views.length - 1].payload.strokes = JSON.stringify(strokes)
  h.state.failFold = false; h.command('save'); await tick()
  assert.equal(h.comments.length, 2); assert.equal(h.files.size, 2)
  assert.notEqual(h.comments[0].text, h.comments[1].text)
  assert.equal(h.comments[1].collapsed, true)
})

test('历史编辑恢复原底图与笔画，保存新版本保留旧评论', async () => {
  const h = harness(); await h.api.openPluginInkWindow(h.owner, h.target); h.command('save'); await tick()
  h.state.choice = 1
  await h.api.openPluginInkWindow(h.owner, h.target); h.command('ready')
  const scripts = h.calls.filter(c => c.script?.startsWith('window.cardlinkInkOpen'))
  const config = JSON.parse(scripts[scripts.length - 1].script.slice('window.cardlinkInkOpen('.length, -1))
  assert.equal(config.saved.background, png); assert.equal(config.saved.strokes, payload().strokes)
  h.command('save'); await tick()
  assert.equal(h.comments.length, 2); assert.equal(h.files.size, 2)
})

test('拒绝不匹配题卡、无效画布和损坏笔画', () => {
  const record = { ...payload(), version: 1, id: 'test', noteId: 'q', notebookId: 'b', createdAt: 1 }
  assert.throws(() => records.validatePluginInkRecord(record, 'other', 'b'), /身份/)
  assert.throws(() => records.validatePluginInkRecord({ ...record, height: 20000 }, 'q', 'b'), /画布/)
  assert.throws(() => records.validatePluginInkRecord({ ...record, strokes: '{"strokes":[{}]}' }, 'q', 'b'), /笔画/)
})

test('新一轮插件批注不弹历史编辑选择，保留旧评论', async () => {
  const h = harness()
  await h.api.openPluginInkWindow(h.owner, h.target); h.command('save'); await tick()
  h.state.choice = 1
  await h.api.openPluginInkWindow(h.owner, { ...h.target, newAttempt: true }); h.command('ready')
  const scripts = h.calls.filter(c => c.script?.startsWith('window.cardlinkInkOpen'))
  const config = JSON.parse(scripts[scripts.length - 1].script.slice('window.cardlinkInkOpen('.length, -1))
  assert.equal(config.saved, undefined)
  h.command('save'); await tick()
  assert.equal(h.comments.length, 2)
})


test('工具条完成直接向画布导出最新笔画，再走同一保存折叠事务', async () => {
  const h = harness()
  await h.api.openPluginInkWindow(h.owner, h.target)
  await h.api.completePluginInkWindow(h.owner)
  assert.ok(h.calls.some(c => c.script?.includes('cardlinkInkPreparePayload()')))
  assert.equal(h.comments.length, 1)
  assert.equal(h.comments[0].collapsed, true)
  assert.equal(h.calls.filter(c => c.closed).length, 1)
})
