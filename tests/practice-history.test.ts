import { windowOpacityFixture } from "./window-opacity-fixture"
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { transpileModule } from 'typescript'
import { runInNewContext } from 'node:vm'

function load(path: string, modules: any, globals: any = {}) {
  const exports: any = {}
  runInNewContext(transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText,
    { exports, require: (key: string) => modules[key] || {}, ...globals })
  return exports
}

test('作答历史按原时间编号，隔离学习集；查看答案状态仅关联指定作答', () => {
  const disk: any = {}
  const api = load('src/practice-attempts.ts', { marginnote: { getLocalDataByKey: (k: string) => disk[k], setLocalDataByKey: (v: any, k: string) => disk[k] = v } })
  const base = { cardAnnotation: true, practice: { topic: 'book', card: 'q' } }
  const rows = api.practiceHistoryRows([{ ...base, createdAt: 20, index: 3 }, { ...base, createdAt: 10, index: 2 }, { ...base, practice: { topic: 'other' }, index: 1 }], 'BOOK', 'Q')
  assert.equal(rows.length, 2); assert.equal(rows[0].ordinal, 2); assert.equal(rows[1].index, 2)
  api.saveAttemptAnswerChecked('q', 'first', false); api.saveAttemptAnswerChecked('q', 'second', true)
  assert.equal(api.attemptAnswerChecked('q', 'first'), false)
  assert.equal(api.attemptAnswerChecked('q', 'second'), true)
  assert.equal(api.attemptAnswerChecked('q', 'older'), undefined)
})

test('无原生 practice 的新批注依靠本地身份进入历史，评分持久保存且不混入其他批注', () => {
  const disk: any = {}
  const modules = { marginnote: { getLocalDataByKey: (k: string) => disk[k], setLocalDataByKey: (v: any, k: string) => disk[k] = v } }
  const api = load('src/practice-attempts.ts', modules)
  const comments = [
    { commentId: 'first', cardAnnotation: true, index: 1, createdAt: 1793280000 },
    { commentId: 'second', cardAnnotation: true, index: 2, createdAt: 1793280100000 },
    { commentId: 'unrelated', cardAnnotation: true, index: 3 },
    { commentId: 'legacy', cardAnnotation: true, index: 4, createdAt: 1793270000, practice: { topic: 'book', card: 'q', self: 'again' } }
  ]
  api.savePracticeAttempt('BOOK', 'Q', 'first')
  api.savePracticeAttempt('book', 'q', 'second', 'got')
  api.savePracticeAttempt('other', 'q', 'unrelated')
  const first = api.practiceHistoryRows(comments, 'book', 'q')
  assert.deepEqual(Array.from(first, (r: any) => r.commentId), ['second', 'first', 'legacy'])
  assert.equal(first[1].practice.self, undefined)
  api.savePracticeAttempt('book', 'q', 'first', 'again')
  api.savePracticeAttempt('book', 'q', 'second') // Re-saving does not erase a stored grade.
  const restored = load('src/practice-attempts.ts', modules)
  const rows = restored.practiceHistoryRows(comments, 'BOOK', 'Q')
  assert.equal(rows[0].practice.self, 'got')
  assert.equal(rows[1].practice.self, 'again')
  assert.equal(rows[1].practice.source, 'CardLink-local')
  assert.equal(restored.practiceHistoryRows([], 'book', 'q').length, 0, '已删宿主批注不能由本地索引复活')
  assert.equal(restored.practiceHistoryRows(comments, 'book', 'other-note').length, 0)
})

test('历史窗口选中指定批注而非整卡，切题期间的过期读取不打开窗口', async () => {
  const views: any[] = [], renders: any[] = []
  class View {
    layer: any = {}; bounds: any; html = ''; delegate: any; script = ''; removed = false
    constructor(public frame: any) { this.bounds = frame; views.push(this) }
    addGestureRecognizer() {}
    addSubview() {} removeFromSuperview() { this.removed = true }
    loadHTMLStringBaseURL(html: string) { this.html = html }
    evaluateJavaScript(script: string) { this.script = script }
  }
  const owner: any = { cardLinkReviewMode: { index: 0, items: [{ sourceNoteId: 'q' }] } }
  const rows = [1, 2].map(i => ({ index: i, ordinal: i, commentId: `paper${i}`, createdAt: 1793140000 + i * 86400, practice: { self: i === 1 ? 'again' : 'got', reasonLabel: i === 1 ? '计算失误' : null } }))
  const native = [{ commentId: 'paper1', type: 'PaintNote', paint: 'first' }, { commentId: 'paper2', type: 'PaintNote', paint: 'second' }]
  const api = load('src/practice-history.ts', {
    './window-opacity': windowOpacityFixture(View),
    marginnote: { MN: { studyController: { view: new View({ width: 1024, height: 768 }) }, db: { getNoteById: () => ({ comments: native }) } } },
    './card-html': { escapeHtml: (s: string) => s, renderCardHtml: (note: any) => { renders.push(note); return `<html><body><h1>${note.noteTitle}</h1><p>${note.comments[0].paint}</p></body></html>` } },
    './plugin-ink-layout': load('src/plugin-ink-layout.ts', {}),
    './ui-tokens': { UI_COLORS: { accent: '#0e8dfd' } },
    './practice-attempts': { practiceHistoryRows: () => rows, attemptAnswerChecked: (_id: string, paper: string) => paper === 'paper2' }
  }, { UIView: View, UIWebView: View, UIPanGestureRecognizer: class {}, UIColor: { whiteColor: () => 'white' }, JSB: { defineClass: (_: string, methods: any) => ({ new: () => methods }) },
    __MNAM_SCENE_WORKBENCH_GLOBAL__: { openReviewAnnotation: async () => ({ comments: rows }) } })
  const continued: string[] = [], nativeModes: boolean[] = []
  await api.openPracticeHistory(owner, 'q', 'book', async (id: string, nativePaper: boolean) => { continued.push(id); nativeModes.push(nativePaper) })
  const web = views.find(v => v.html)
  const container = views[views.indexOf(web) - 1]
  assert.equal(container.frame.width, 680)
  assert.equal(container.frame.height, 500)
  let reset = false
  const beforeDrag = { ...container.frame }
  web.delegate.historyPan({ view: { superview: container }, state: 2,
    translationInView: () => ({ x: 20, y: 10 }), setTranslationInView: () => { reset = true } })
  assert.equal(container.frame.x, beforeDrag.x + 20)
  assert.equal(container.frame.y, beforeDrag.y + 10)
  assert.equal(reset, true)
  const geometry = encodeURIComponent(JSON.stringify({ x: -20, y: -30, width: 5000, height: 5000 }))
  web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => 'cardlink-history://layout/' + geometry }) })
  assert.ok(container.frame.x >= 0 && container.frame.y >= 0)
  assert.ok(container.frame.x + container.frame.width <= 1024)
  assert.ok(container.frame.y + container.frame.height <= 768)
  const lastFrame = container.frame
  web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => 'cardlink-history://layout/broken' }) })
  assert.equal(container.frame, lastFrame)
  web.delegate.webViewDidFinishLoad(web)
  assert.equal(renders[0].comments.length, 1); assert.equal(renders[0].comments[0].paint, 'first')
  web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => 'cardlink-history://select/1' }) })
  assert.equal(renders[1].comments[0].paint, 'second')
  web.delegate.webViewDidFinishLoad(web)
  assert.equal(renders.length, 2, '详情 iframe 加载不得跳回第一条')
  mkdirSync('output/playwright', { recursive: true })
  writeFileSync('output/playwright/practice-history.html', web.html)
  web.delegate.webViewShouldStartLoadWithRequestNavigationType(web, { URL: () => ({ absoluteString: () => 'cardlink-history://continue' }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(continued, ['paper2'])
  assert.deepEqual(nativeModes, [false], '普通历史批注不能误走原生练习判定')
  assert.equal(container.removed, true)
  assert.ok(!web.html.includes('id="size"'))
  owner.cardLinkReviewMode.items[0].sourceNoteId = 'different'
  const count = views.length
  await api.openPracticeHistory(owner, 'q', 'book')
  assert.equal(views.length, count)
})
