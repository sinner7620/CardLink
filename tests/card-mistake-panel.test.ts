import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule, createSourceFile, ScriptTarget, isFunctionDeclaration } from 'typescript'
import { windowOpacityFixture } from './window-opacity-fixture'
import { reviewResultHint, reviewMistake, REVIEW_CURVES, type MistakeLevel, type MistakeRecord, type MistakeReviewCurves } from '../src/mistake-domain'

const plain = (value: any): any => JSON.parse(JSON.stringify(value))
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

function harness(size = { width: 900, height: 700 }, deferred = false, reduced = false) {
  const animations: number[] = [], delays: number[] = []
  class View {
    frame: any; bounds: any; layer: any = {}; subviews: any[] = []; superview: any
    hidden = false; enabled = true; titleLabel: any = {}; title = ''; text = ''; backgroundColor: any
    constructor(frame: any = {}) { this.frame = frame; this.bounds = { x: 0, y: 0, width: frame.width, height: frame.height } }
    addSubview(view: any) { this.subviews.push(view); view.superview = this }
    bringSubviewToFront(view: any) { this.subviews = this.subviews.filter(item => item !== view); this.subviews.push(view) }
    removeFromSuperview() { if (this.superview) this.superview.subviews = this.superview.subviews.filter((item: any) => item !== this); this.superview = undefined }
    setTitleForState(title: string) { this.title = title }
    setTitleColorForState(color: any) { (this as any).textColor = color }
    addTargetActionForControlEvents(owner: any, selector: string) { (this as any).target = owner; (this as any).selector = selector }
  }
  const host = new View({ x: 0, y: 0, ...size }), owner: any = { window: host }
  const writes: any[] = [], attempts: any[] = []
  let fail = false
  const pending: Array<() => void> = [], pendingWrites: Array<() => void> = []
  const windowOpacity = windowOpacityFixture(View)
  const color = (value: any, alpha = value === 'clear' ? 0 : 1): any => ({ value, alpha, colorWithAlphaComponent: (alpha: number) => color(value, alpha) })
  const scope: any = { exports: {}, self: owner, Promise, Error, UIView: View, UIScrollView: View, UILabel: View,
    UIAccessibility: { isReduceMotionEnabled: reduced },
    MNUtil: { animate: (update: () => void, duration: number) => { animations.push(duration); update(); return Promise.resolve() } },
    UIFont: { systemFontOfSize: (size: number) => size }, UIButton: { buttonWithType: () => new View() },
    UIColor: { clearColor: () => color('clear'), whiteColor: () => color('white'), colorWithHexString: color },
    require: (name: string) => {
      if (name === 'marginnote') return { delay: (duration: number) => {
        delays.push(duration)
        return deferred ? new Promise<void>(resolve => pending.push(resolve)) : Promise.resolve()
      } }
      if (name === './window-opacity') return windowOpacity
      if (name === './error-reasons') return { DEFAULT_ERROR_REASONS: ['概念不清', '公式遗忘', '思路受阻', '计算失误', '审题遗漏', '时间不足'].map((label, index) => ({ key: String(index), label })) }
      if (name === './ui-tokens') return { UI_COLORS: { surface: '#f7f8fa', accent: '#0066ff', level0: '#f00', level1: '#f80', level2: '#080' } }
      throw Error(name)
    } }
  runInNewContext(transpileModule(readFileSync('src/card-mistake-panel.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const api = scope.exports
  return { api, owner, host, writes, attempts, animations, delays, pending,
    fail() { fail = true },
    unblock() { const release = pendingWrites.shift(); assert.ok(release, '必须已有等待中的提交'); release() },
    async open(current?: number, blocking = false, reviewHint: (level: MistakeLevel) => string = level => reviewResultHint(undefined, level), onSaved: (feedback: any) => void = () => {}) {
      const result = api.showCardMistakePanel(owner, host, { x: 300, y: 250, width: 100, height: 80 }, '事件题目', current, async (feedback: any) => {
        attempts.push(plain(feedback))
        if (blocking) await new Promise<void>(resolve => pendingWrites.push(resolve))
        if (fail) { fail = false; throw Error('标签写入失败，请重试') }
        writes.push(plain(feedback))
        onSaved(feedback)
      }, reviewHint)
      await flush()
      return { result, panel: owner.cardMistakePanel }
    } }
}

function assertWithin(frame: any, bounds: { width: number; height: number }) {
  assert.ok(frame.x >= 8 && frame.y >= 8)
  assert.ok(frame.x + frame.width <= bounds.width - 8)
  assert.ok(frame.y + frame.height <= bounds.height - 8)
}

function allViews(view: any): any[] { return [view, ...view.subviews.flatMap(allViews)] }

function assertMounted(host: any, panel: any) {
  const surfaces = [...panel.outside, panel.view]
  assert.deepEqual(host.subviews, surfaces)
  assert.ok(surfaces.every(view => view.superview === host))
  assert.equal(host.subviews[host.subviews.length - 1], panel.view)
}

function assertOutsideCoverage(host: any, panel: any) {
  const frame = panel.view.frame, bounds = host.bounds
  for (const outside of panel.outside) {
    const rect = outside.frame
    assert.equal(outside.superview, host)
    assert.equal(outside.backgroundColor.alpha, 0)
    assert.ok(rect.width >= 0 && rect.height >= 0)
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= bounds.width && rect.y + rect.height <= bounds.height)
    assert.ok(rect.x + rect.width <= frame.x || rect.x >= frame.x + frame.width || rect.y + rect.height <= frame.y || rect.y >= frame.y + frame.height)
  }
  const xs = [0, frame.x, frame.x + frame.width, bounds.width]
  const ys = [0, frame.y, frame.y + frame.height, bounds.height]
  for (let row = 1; row < ys.length; row++) {
    for (let column = 1; column < xs.length; column++) {
      const x = (xs[column - 1] + xs[column]) / 2, y = (ys[row - 1] + ys[row]) / 2
      const hits = host.subviews.filter((view: any) => !view.hidden && x >= view.frame.x && x < view.frame.x + view.frame.width && y >= view.frame.y && y < view.frame.y + view.frame.height)
      assert.equal(hits.length, 1, `宿主坐标 ${x},${y} 只能命中面板或一块外部点击区`)
      assert.equal(hits[0] === panel.view, row === 2 && column === 2)
    }
  }
}

function effectiveOpacity(view: any): number {
  return (view.layer.opacity ?? view.alpha ?? 1) * (view.superview ? effectiveOpacity(view.superview) : 1)
}

for (const failure of ['addSubview', 'bringSubviewToFront']) {
  test(`挂载 ${failure} 失败时清理已加入的同级视图，不移除宿主原有控件`, async () => {
    const h = harness(), existing = { frame: {}, layer: {}, subviews: [] }
    h.host.addSubview(existing)
    const added: any[] = [], addSubview = h.host.addSubview.bind(h.host)
    h.host.addSubview = view => {
      added.push(view)
      addSubview(view)
      if (failure === 'addSubview' && added.length === 2) throw Error('原生挂载失败')
    }
    h.host.bringSubviewToFront = () => { throw Error('原生挂载失败') }
    const result = h.api.showCardMistakePanel(h.owner, h.host, { x: 300, y: 250, width: 100, height: 80 }, '事件题目', undefined, async () => {}, (level: MistakeLevel) => reviewResultHint(undefined, level))
    await assert.rejects(result, /原生挂载失败/)
    assert.equal(h.owner.cardMistakePanel, undefined)
    assert.deepEqual(h.host.subviews, [existing])
    assert.ok(added.every(view => view.superview === undefined))
  })
}

test('关闭只移除评分页及外部点击区，宿主原有视图保留', async () => {
  const h = harness(), existing = { frame: {}, layer: {}, subviews: [] }
  h.host.addSubview(existing)
  const { panel, result } = await h.open()
  assert.deepEqual(h.host.subviews, [existing, ...panel.outside, panel.view])
  h.api.onCardMistakePanelOutsideTap(panel.outside[0])
  assert.deepEqual(plain(await result), { cancelled: true })
  assert.deepEqual(h.host.subviews, [existing])
  assert.ok([...panel.outside, panel.view].every(view => view.superview === undefined))
})

test('等级天数复用默认及自定义曲线，已有同档推进、换档归零和掌握结束', async () => {
  const cases = [
    { record: undefined, curves: REVIEW_CURVES, expected: ['不会 +1天', '不熟 +2天', '掌握 +14天'] },
    { record: { level: 0, reviewCount: 0 }, curves: { 0: [2, 6, 12], 1: [4, 9], 2: [20] }, expected: ['不会 +6天', '不熟 +4天', '掌握 +20天'] },
    { record: { level: 1, reviewCount: 9 }, curves: { 0: [2, 6, 12], 1: [4, 9], 2: [20] }, expected: ['不会 +2天', '不熟 +9天', '掌握 +20天'] },
    { record: { level: 2, reviewCount: 0 }, curves: REVIEW_CURVES, expected: ['不会 +1天', '不熟 +2天', '掌握 结束'] }
  ]
  for (const item of cases) {
    const h = harness(), record = item.record as Pick<MistakeRecord, 'level' | 'reviewCount'> | undefined
    const { panel, result } = await h.open(record?.level, false, level => reviewResultHint(record, level, item.curves))
    assert.deepEqual(plain(panel.levels.map((view: any) => view.title)), item.expected)
    assert.deepEqual(h.writes, [], '显示提示不保存或推进记录')
    h.api.onCardMistakePanelClose(panel.close)
    assert.deepEqual(plain(await result), { cancelled: true })
  }
})

test('等级保存后保留本次天数，切档按最新记录预告，失败与错因补写不推进提示', async () => {
  const curves: MistakeReviewCurves = { 0: [2, 6, 12], 1: [4, 9, 15], 2: [20] }
  let record = { level: 0, reviewCount: 0, history: [] } as unknown as MistakeRecord
  const h = harness(), { panel, result } = await h.open(0, false, level => reviewResultHint(record, level, curves), feedback => {
    if (!feedback.reason) record = reviewMistake(record, feedback.level, new Date('2026-11-03T00:00:00Z'), curves)
  })
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.equal(record.reviewCount, 1)
  assert.equal(panel.levels[0].title, '不会 +6天', '已保存等级显示本次已选间隔，不提前变为下次12天')
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.equal(h.writes.length, 1)
  h.fail()
  await h.api.onCardMistakePanelReason(panel.reasons[0])
  assert.equal(record.reviewCount, 1)
  assert.equal(panel.levels[0].title, '不会 +6天')
  h.fail()
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  assert.equal(record.level, 0)
  assert.deepEqual(plain(panel.levels.map((view: any) => view.title)), ['不会 +12天', '不熟 +4天', '掌握 +20天'])
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  assert.equal(record.level, 1)
  assert.equal(record.reviewCount, 0)
  assert.deepEqual(plain(panel.levels.map((view: any) => view.title)), ['不会 +2天', '不熟 +4天', '掌握 +20天'])
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.equal(record.level, 0)
  assert.equal(record.reviewCount, 0)
  assert.equal(panel.levels[0].title, '不会 +2天', '切回旧等级不沿用打开面板时的旧进度')
  await h.api.onCardMistakePanelReason(panel.reasons[0])
  assert.equal(record.reviewCount, 0)
  assert.equal(panel.levels[0].title, '不会 +2天')
  assert.deepEqual(plain(await result), {})
})

test('四位自定义天数保持紧凑单行等级标题，不改变面板或错因按钮尺寸', async () => {
  const h = harness(), { panel, result } = await h.open(undefined, false, level => reviewResultHint(undefined, level, { 0: [3650], 1: [1234], 2: [3650] }))
  assert.deepEqual(plain(panel.levels.map((view: any) => view.title)), ['不会 +3650天', '不熟 +1234天', '掌握 +3650天'])
  assert.equal(panel.view.frame.width, 192)
  assert.deepEqual(plain(panel.levels.map((view: any) => view.frame.width)), [80, 80, 168])
  for (const view of panel.levels) {
    const estimatedWidth = [...view.title].reduce((width, char) => width + view.titleLabel.font * (char === ' ' ? .3 : /[^\x00-\x7f]/.test(char) ? 1 : .6), 0)
    assert.equal(view.titleLabel.font, 11)
    assert.ok(estimatedWidth <= view.frame.width - 8)
    assert.equal(view.frame.height, 44)
  }
  assert.ok(panel.reasons.every((view: any) => view.frame.width === 72 && view.titleLabel.font === 13))
  h.api.onCardMistakePanelClose(panel.close)
  assert.deepEqual(plain(await result), { cancelled: true })
})

test('卡片命令把目标题最新记录与当前自定义曲线接到原生等级提示', async () => {
  const source = readFileSync('src/plugin.ts', 'utf8'), ast = createSourceFile('plugin.ts', source, ScriptTarget.Latest, true)
  const fn = ast.statements.find(node => isFunctionDeclaration(node) && node.name?.text === 'executeCardMenuCommand')!
  const host = {}, owner = { window: {} }, card = { noteId: 'event-card' }, anchor = { x: 1, y: 2, width: 3, height: 4 }
  let record: Pick<MistakeRecord, 'level' | 'reviewCount'> = { level: 0, reviewCount: 0 }
  let curves: MistakeReviewCurves = { 0: [2, 6, 12], 1: [4, 9], 2: [20] }
  let hint!: (level: MistakeLevel) => string
  const scope: any = { exports: {}, Application: { sharedInstance: () => ({ studyController: () => ({ view: { window: host } }) }) },
    cardMistakeAnchor: () => anchor, hideAnswerToolbar() {}, currentNotebookId: () => 'event-book',
    MN: { db: { getNoteById: (id: string) => { assert.equal(id, 'event-card'); return card } } },
    NodeNote: class { note: any; title = '事件题目'; constructor(note: any) { this.note = note } },
    runCardMenuCommand: (_command: any, noteID: string, deps: any) => deps.showFeedback({ noteID, notebookID: 'event-book' }, 0, async () => {}),
    mistakeRecordForSourceQuestion: (question: any, notebookID: string) => { assert.equal(question.note, card); assert.equal(notebookID, 'event-book'); return record },
    loadMatcherSettings: () => ({ mistakeReviewCurves: curves }), reviewResultHint,
    showCardMistakePanel: (value: any, parent: any, rect: any, title: string, level: number, submit: any, reviewHint: typeof hint) => {
      assert.equal(value, owner); assert.equal(parent, host); assert.equal(rect, anchor)
      assert.equal(title, '事件题目'); assert.equal(level, 0); assert.equal(typeof submit, 'function')
      hint = reviewHint
      return Promise.resolve({})
    } }
  runInNewContext(transpileModule(fn.getText(ast), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  await scope.exports.executeCardMenuCommand('markMistake', 'event-card', owner)
  assert.equal(hint(0), '+6天')
  record = { level: 1, reviewCount: 0 }
  curves = { 0: [3, 7], 1: [5, 11], 2: [30] }
  assert.equal(hint(0), '+3天')
  assert.equal(hint(1), '+11天')
  record = { level: 2, reviewCount: 0 }
  assert.equal(hint(2), '结束')
})

test('减少动态效果时等级即时保存与错因布局照常工作，不播放动画', async () => {
  const h = harness(undefined, false, true), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.equal(panel.reasonArea.hidden, false)
  assert.equal(panel.levels[2].frame.y, 216)
  await h.api.onCardMistakePanelLevel(panel.levels[2])
  assert.deepEqual(h.animations, [])
  assert.deepEqual(h.writes, [{ level: 0 }, { level: 2 }])
  assert.deepEqual(plain(await result), {})
})

test('卡片侧边页面宽 192，优先右侧、其次左侧，小屏及长面板限制在窗口内', () => {
  const h = harness()
  const frame = h.api.cardMistakePanelFrame({ x: 300, y: 250, width: 100, height: 80 }, h.host.bounds)
  assert.equal(frame.x, 408)
  assert.equal(frame.y, 250)
  assert.equal(frame.width, 192)
  assert.equal(frame.height, 152)
  const right = h.api.cardMistakePanelFrame({ x: 790, y: 250, width: 100, height: 80 }, h.host.bounds)
  assert.equal(right.x, 590)
  for (const size of [{ width: 360, height: 640 }, { width: 240, height: 260 }, { width: 200, height: 220 }]) {
    for (const height of [152, 316, 1000]) {
      const value = h.api.cardMistakePanelFrame({ x: size.width - 30, y: size.height - 30, width: 20, height: 20 }, size, height)
      assertWithin(value, size)
      assert.equal(value.width, Math.min(192, size.width - 16))
    }
  }
})

test('紧凑错因仍按两列三行完整显示，文字左右仅留少量空白，标题与跳过不重叠', async () => {
  const h = harness(), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.deepEqual(plain(panel.reasons.map((view: any) => view.title)), ['概念不清', '公式遗忘', '思路受阻', '计算失误', '审题遗漏', '时间不足'])
  panel.reasons.forEach((view: any, index: number) => {
    const textWidth = view.title.length * view.titleLabel.font
    assert.ok(view.frame.width - textWidth >= 12 && view.frame.width - textWidth <= 24)
    assert.equal(view.frame.height, 36)
    assert.ok(view.frame.x >= 8 && view.frame.x + view.frame.width <= panel.reasonArea.frame.width - 8)
    assert.ok(view.frame.y + view.frame.height <= panel.reasonArea.frame.height - 4)
    if (index % 2) {
      const previous = panel.reasons[index - 1].frame
      assert.equal(view.frame.y, previous.y)
      assert.equal(view.frame.x - previous.x - previous.width, 8)
    } else if (index > 0) {
      const previous = panel.reasons[index - 2].frame
      assert.equal(view.frame.x, previous.x)
      assert.equal(view.frame.y - previous.y - previous.height, 8)
    }
  })
  const title = panel.view.subviews.find((view: any) => view.text === '标记错题')
  const reasonTitle = panel.reasonArea.subviews.find((view: any) => view.text === '选择错因')
  assert.ok(title.frame.width >= title.text.length * title.font)
  assert.ok(title.frame.x + title.frame.width <= panel.close.frame.x)
  assert.ok(reasonTitle.frame.width >= reasonTitle.text.length * reasonTitle.font)
  assert.ok(reasonTitle.frame.x + reasonTitle.frame.width <= panel.skip.frame.x)
  assert.ok(panel.skip.frame.x + panel.skip.frame.width <= panel.reasonArea.frame.width - 8)
  h.api.onCardMistakePanelSkip(panel.skip)
  assert.deepEqual(plain(await result), {})
})

test('评分外壳直接挂宿主，宿主对子视图发起淡化不降低面板合成不透明度', async () => {
  const h = harness(), { panel, result } = await h.open()
  assertMounted(h.host, panel)
  const assertOpaque = () => {
    assert.equal(panel.view.layer.opacity, 1)
    assert.equal(effectiveOpacity(panel.view), 1)
    assert.equal(panel.view.backgroundColor.alpha, 1)
    assert.equal(panel.reasonArea.backgroundColor.alpha, 1)
    assert.ok([...panel.levels, ...panel.reasons].every((view: any) => view.backgroundColor.alpha === 1))
  }
  assertOpaque()
  h.host.subviews.forEach((view: any) => { view.alpha = .3 })
  assert.ok(panel.outside.every((view: any) => view.alpha === .3))
  assertOpaque()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assertOpaque()
  h.fail()
  await h.api.onCardMistakePanelReason(panel.reasons[2])
  assertOpaque()
  h.api.onCardMistakePanelSkip(panel.skip)
  assert.deepEqual(plain(await result), {})
})

test('默认三档：不会和不熟横排、掌握整行，错因折叠且没有保存按钮', async () => {
  const h = harness(), { panel, result } = await h.open()
  assert.deepEqual(plain(panel.levels.map((view: any) => view.title)), ['不会 +1天', '不熟 +2天', '掌握 +14天'])
  assert.equal(panel.reasons.length, 6)
  assert.equal(panel.level, undefined)
  assert.equal(panel.savedLevel, undefined)
  assert.equal(panel.expanded, false)
  assert.equal(panel.reasonArea.hidden, true)
  assert.ok(panel.reasons.every((view: any) => !view.enabled))
  const [unknown, unfamiliar, mastery] = panel.levels
  assert.equal(unknown.frame.y, unfamiliar.frame.y)
  assert.equal(unknown.frame.width, unfamiliar.frame.width)
  assert.ok(unknown.frame.x + unknown.frame.width < unfamiliar.frame.x)
  assert.ok(mastery.frame.y >= unknown.frame.y + unknown.frame.height)
  assert.equal(mastery.frame.x, unknown.frame.x)
  assert.equal(mastery.frame.width, unfamiliar.frame.x + unfamiliar.frame.width - unknown.frame.x)
  assert.ok(panel.levels.every((view: any) => view.target === h.owner && view.selector === 'onCardMistakePanelLevel:'))
  assert.ok(panel.reasons.every((view: any) => view.target === h.owner && view.selector === 'onCardMistakePanelReason:'))
  assert.equal(panel.skip.selector, 'onCardMistakePanelSkip:')
  assert.ok(panel.outside.every((view: any) => view.target === h.owner && view.selector === 'onCardMistakePanelOutsideTap:'))
  assert.equal(allViews(h.host).some(view => view.title === '保存' || view.selector === 'onCardMistakePanelSave:'), false)
  assert.equal(panel.scroll.bounces, false)
  assert.equal(panel.scroll.superview, panel.view)
  assert.equal(panel.reasonArea.superview, panel.scroll)
  assertMounted(h.host, panel)
  assert.deepEqual(h.animations, [])
  assert.deepEqual(h.writes, [])
  h.api.onCardMistakePanelClose(panel.close)
  assert.deepEqual(plain(await result), { cancelled: true })
  assert.equal(h.host.subviews.length, 0)
})

for (const level of [0, 1]) {
  test(`点击 ${level} 级立即写入并展开；补选单项错因成功后关闭`, async () => {
    const h = harness(), { panel, result } = await h.open()
    await h.api.onCardMistakePanelReason(panel.reasons[4])
    assert.deepEqual(h.attempts, [], '折叠时不能先写错因')
    const saving = h.api.onCardMistakePanelLevel(panel.levels[level])
    assert.deepEqual(h.attempts, [{ level }], '等级点击回调不等待另一个保存操作')
    assert.equal(panel.busy, true)
    assert.equal(panel.expanded, true)
    assert.equal(panel.reasonArea.hidden, false)
    assert.ok(panel.reasons.every((view: any) => !view.enabled))
    await saving
    assert.equal(h.owner.cardMistakePanel, panel)
    assert.equal(panel.savedLevel, level)
    assert.ok(panel.reasons.every((view: any) => view.enabled))
    assert.equal(panel.skip.enabled, true)
    assert.deepEqual(h.writes, [{ level }])
    assert.deepEqual(h.animations, [.18])
    await h.api.onCardMistakePanelReason(panel.reasons[3])
    assert.deepEqual(h.writes, [{ level }, { level, reason: { key: '3', label: '计算失误' } }])
    assert.deepEqual(plain(await result), {})
    assert.equal(h.owner.cardMistakePanel, undefined)
    assert.equal(h.host.subviews.length, 0)
    assert.deepEqual(h.animations, [.18], '错因提交和完成不额外触发展开动画')
  })
}

for (const level of [0, 1, 2]) {
  test(`当前 ${level} 级只预选，默认折叠；点击当前等级仍立即保存`, async () => {
    const h = harness(), { panel, result } = await h.open(level)
    assert.equal(panel.level, level)
    assert.equal(panel.savedLevel, undefined, '预选不等于本次已保存')
    assert.equal(panel.reason, undefined)
    assert.equal(panel.expanded, false)
    assert.equal(panel.reasonArea.hidden, true)
    assert.deepEqual(h.writes, [])
    assert.equal(panel.levels[level].textColor.value, 'white')
    assert.ok(panel.levels.every((view: any, index: number) => index === level || (view.enabled && view.backgroundColor.value === '#e9ebef')))
    await h.api.onCardMistakePanelReason(panel.reasons[0])
    await h.api.onCardMistakePanelLevel(panel.levels[level])
    assert.deepEqual(h.writes, [{ level }])
    if (level !== 2) {
      assert.equal(panel.expanded, true)
      assert.equal(panel.reasonArea.hidden, false)
      await h.api.onCardMistakePanelLevel(panel.levels[level])
      assert.equal(h.attempts.length, 1, '本次已保存的同等级点击不重复提交')
      h.api.onCardMistakePanelSkip(panel.skip)
    }
    assert.deepEqual(plain(await result), {})
    assert.deepEqual(h.animations, level === 2 ? [] : [.18])
  })
}

test('0/1 切换保持错因展开，灰色等级仍可点击；仅展开状态变化触发动画', async () => {
  const h = harness(), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  const expandedFrame = plain(panel.view.frame)
  assert.equal(panel.levels[1].backgroundColor.value, '#e9ebef')
  assert.equal(panel.levels[1].enabled, true)
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  assert.equal(panel.expanded, true)
  assert.equal(panel.reasonArea.hidden, false)
  assert.deepEqual(plain(panel.view.frame), expandedFrame)
  assert.equal(panel.levels[0].backgroundColor.value, '#e9ebef')
  assert.equal(panel.levels[0].enabled, true)
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.deepEqual(h.animations, [.18])
  await h.api.onCardMistakePanelLevel(panel.levels[2])
  assert.equal(panel.expanded, false)
  assert.equal(panel.reasonArea.hidden, true)
  assert.deepEqual(h.animations, [.18, .18], '掌握导致折叠，只再动画一次')
  assert.deepEqual(h.writes, [{ level: 0 }, { level: 1 }, { level: 0 }, { level: 2 }])
  assert.deepEqual(plain(await result), {})
})

for (const action of ['Skip', 'OutsideTap', 'Close']) {
  test(`等级已保存后 ${action} 直接关闭，不回滚也不再写入`, async () => {
    const h = harness(), { panel, result } = await h.open()
    await h.api.onCardMistakePanelLevel(panel.levels[1])
    const sender = action === 'Skip' ? panel.skip : action === 'OutsideTap' ? panel.outside[2] : panel.close
    h.api[`onCardMistakePanel${action}`](sender)
    assert.deepEqual(plain(await result), {})
    assert.deepEqual(h.writes, [{ level: 1 }])
    assert.equal(h.attempts.length, 1)
    assert.equal(h.host.subviews.length, 0)
  })
}

test('未选择等级时跳过不生效，外部点击取消；四块外部点击区域不遮挡面板', async () => {
  const h = harness(), { panel, result } = await h.open(0)
  h.api.onCardMistakePanelSkip(panel.skip)
  assert.equal(h.owner.cardMistakePanel, panel)
  assert.equal(panel.outside.length, 4)
  assertOutsideCoverage(h.host, panel)
  h.api.onCardMistakePanelOutsideTap(panel.outside[0])
  assert.deepEqual(plain(await result), { cancelled: true })
  assert.deepEqual(h.writes, [])
})

test('同级外部点击区随展开、失败增高和短屏限位更新，无空洞或面板内遮挡', async () => {
  for (const size of [{ width: 900, height: 700 }, { width: 240, height: 260 }, { width: 360, height: 180 }]) {
    const h = harness(size), { panel, result } = await h.open()
    assertMounted(h.host, panel)
    assertOutsideCoverage(h.host, panel)
    await h.api.onCardMistakePanelLevel(panel.levels[0])
    assertOutsideCoverage(h.host, panel)
    h.fail()
    await h.api.onCardMistakePanelReason(panel.reasons[0])
    assertOutsideCoverage(h.host, panel)
    h.api.onCardMistakePanelSkip(panel.skip)
    assert.deepEqual(plain(await result), {})
    assert.ok([...panel.outside, panel.view].every(view => view.superview === undefined))
  }
})

test('等级失败不关闭，保留当前等级和展开区域，点当前等级可重试', async () => {
  const h = harness(), { panel, result } = await h.open(1)
  h.fail()
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  assert.deepEqual(h.writes, [])
  assert.equal(h.owner.cardMistakePanel, panel)
  assert.equal(panel.level, 1)
  assert.equal(panel.savedLevel, undefined)
  assert.equal(panel.expanded, true)
  assert.equal(panel.reasonArea.hidden, false)
  assert.equal(panel.busy, false)
  assert.equal(panel.status.hidden, false)
  assert.match(panel.status.text, /标签写入失败.*点选当前等级重试/)
  assert.equal(panel.status.numberOfLines, 0)
  assert.ok(panel.status.frame.height >= 4 * panel.status.font * 1.2, '窄面板仍预留多行错误及重试提示')
  assert.ok(panel.status.frame.y + panel.status.frame.height <= panel.scroll.contentSize.height)
  assert.ok(panel.levels.every((view: any) => view.enabled))
  assert.ok(panel.reasons.every((view: any) => !view.enabled))
  assert.equal(panel.skip.enabled, false)
  h.api.onCardMistakePanelSkip(panel.skip)
  h.api.onCardMistakePanelOutsideTap(panel.outside[0])
  await h.api.onCardMistakePanelReason(panel.reasons[4])
  assert.equal(h.owner.cardMistakePanel, panel)
  assert.equal(h.attempts.length, 1)
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  assert.deepEqual(h.writes, [{ level: 1 }])
  assert.equal(panel.savedLevel, 1)
  assert.equal(panel.status.hidden, true)
  assert.equal(panel.status.text, '')
  assert.ok(panel.reasons.every((view: any) => view.enabled))
  assert.deepEqual(h.animations, [.18], '失败、错误布局和同等级重试不重复动画')
  h.api.onCardMistakePanelSkip(panel.skip)
  assert.deepEqual(plain(await result), {})
})

test('已保存等级后切换失败，保留先前成功等级且不能用外部点击跳过失败', async () => {
  const h = harness(), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  h.fail()
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  assert.equal(panel.level, 1)
  assert.equal(panel.savedLevel, 0)
  h.api.onCardMistakePanelOutsideTap(panel.outside[1])
  h.api.onCardMistakePanelSkip(panel.skip)
  assert.equal(h.owner.cardMistakePanel, panel)
  assert.deepEqual(h.writes, [{ level: 0 }])
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  h.api.onCardMistakePanelSkip(panel.skip)
  assert.deepEqual(plain(await result), {})
  assert.deepEqual(h.writes, [{ level: 0 }, { level: 1 }])
  assert.deepEqual(h.animations, [.18])
})

test('切换保存失败后选回先前等级会重新保存，避免沿用已作废回执', async () => {
  const h = harness(), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  h.fail()
  await h.api.onCardMistakePanelLevel(panel.levels[1])
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  assert.deepEqual(h.writes, [{ level: 0 }, { level: 0 }])
  await h.api.onCardMistakePanelReason(panel.reasons[3])
  assert.deepEqual(plain(await result), {})
  assert.equal(h.writes.length, 3)
})

test('错因失败不丢已保存等级和错因选择，点当前错因重试成功才关闭', async () => {
  const h = harness(), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  h.fail()
  await h.api.onCardMistakePanelReason(panel.reasons[4])
  assert.equal(h.owner.cardMistakePanel, panel)
  assert.equal(panel.savedLevel, 0)
  assert.equal(panel.level, 0)
  assert.deepEqual(plain(panel.reason), { key: '4', label: '审题遗漏' })
  assert.equal(panel.reasonArea.hidden, false)
  assert.match(panel.status.text, /标签写入失败.*点选当前错因重试/)
  assert.ok(panel.reasons.every((view: any) => view.enabled))
  assert.equal(panel.skip.enabled, true)
  assert.deepEqual(h.writes, [{ level: 0 }])
  await h.api.onCardMistakePanelReason(panel.reasons[4])
  assert.deepEqual(plain(await result), {})
  assert.deepEqual(h.writes, [{ level: 0 }, { level: 0, reason: { key: '4', label: '审题遗漏' } }])
  assert.equal(h.attempts.length, 3)
  assert.deepEqual(h.animations, [.18])
})

test('错因失败后改为掌握，只提交 level、不继承错因并立即关闭', async () => {
  const h = harness(), { panel, result } = await h.open()
  await h.api.onCardMistakePanelLevel(panel.levels[0])
  h.fail()
  await h.api.onCardMistakePanelReason(panel.reasons[0])
  assert.equal(panel.reason.label, '概念不清')
  await h.api.onCardMistakePanelLevel(panel.levels[2])
  assert.equal(panel.reason, undefined)
  assert.equal(panel.reasonArea.hidden, true)
  assert.ok(panel.reasons.every((view: any) => !view.enabled))
  assert.deepEqual(h.writes, [{ level: 0 }, { level: 2 }])
  assert.deepEqual(plain(await result), {})
})

test('掌握写入失败也保留页面和当前等级，重试仍只写等级', async () => {
  const h = harness(), { panel, result } = await h.open()
  h.fail()
  await h.api.onCardMistakePanelLevel(panel.levels[2])
  assert.equal(h.owner.cardMistakePanel, panel)
  assert.equal(panel.level, 2)
  assert.equal(panel.expanded, false)
  assert.match(panel.status.text, /点选当前等级重试/)
  h.api.onCardMistakePanelOutsideTap(panel.outside[0])
  assert.equal(h.owner.cardMistakePanel, panel)
  await h.api.onCardMistakePanelLevel(panel.levels[2])
  assert.deepEqual(plain(await result), {})
  assert.deepEqual(h.writes, [{ level: 2 }])
  assert.deepEqual(h.animations, [])
})

for (const phase of ['level', 'reason']) {
  test(`${phase} 提交期间 busy 阻止重复提交、改选、跳过和关闭`, async () => {
    const h = harness(), { panel, result } = await h.open(undefined, true)
    let saving = h.api.onCardMistakePanelLevel(panel.levels[1])
    if (phase === 'reason') {
      h.unblock(); await saving
      saving = h.api.onCardMistakePanelReason(panel.reasons[3])
    }
    const count = h.attempts.length
    assert.equal(panel.busy, true)
    assert.ok(panel.levels.every((view: any) => !view.enabled))
    assert.ok(panel.reasons.every((view: any) => !view.enabled))
    assert.equal(panel.skip.enabled, false)
    assert.equal(panel.close.enabled, false)
    await h.api.onCardMistakePanelLevel(panel.levels[1])
    await h.api.onCardMistakePanelLevel(panel.levels[2])
    await h.api.onCardMistakePanelReason(panel.reasons[3])
    await h.api.onCardMistakePanelReason(panel.reasons[4])
    h.api.onCardMistakePanelSkip(panel.skip)
    h.api.onCardMistakePanelClose(panel.close)
    assert.equal(h.attempts.length, count)
    assert.equal(h.owner.cardMistakePanel, panel)
    assert.equal(panel.level, 1)
    assert.equal(panel.closeRequested, false)
    h.unblock(); await saving
    assert.equal(panel.busy, false)
    if (phase === 'level') {
      assert.equal(panel.close.enabled, true)
      h.api.onCardMistakePanelSkip(panel.skip)
    }
    assert.deepEqual(plain(await result), {})
    assert.equal(h.writes.length, count)
    assert.deepEqual(h.animations, [.18])
  })

  for (const failed of [false, true]) {
    test(`${phase} 提交期间外部点击请求关闭，${failed ? '失败不关闭并可重试' : '成功后才关闭'}`, async () => {
      const h = harness(), { panel, result } = await h.open(undefined, true)
      let saving = h.api.onCardMistakePanelLevel(panel.levels[1])
      if (phase === 'reason') {
        h.unblock(); await saving
        saving = h.api.onCardMistakePanelReason(panel.reasons[2])
      }
      if (failed) h.fail()
      h.api.onCardMistakePanelOutsideTap(panel.outside[0])
      h.api.onCardMistakePanelOutsideTap(panel.outside[3])
      assert.equal(panel.closeRequested, true)
      assert.equal(h.owner.cardMistakePanel, panel)
      assertMounted(h.host, panel)
      h.unblock(); await saving
      if (failed) {
        assert.equal(h.owner.cardMistakePanel, panel)
        assert.equal(panel.closeRequested, false)
        assert.equal(panel.busy, false)
        assert.equal(panel.savedLevel, phase === 'reason' ? 1 : undefined)
        assert.equal(h.writes.length, phase === 'reason' ? 1 : 0)
        saving = phase === 'reason' ? h.api.onCardMistakePanelReason(panel.reasons[2]) : h.api.onCardMistakePanelLevel(panel.levels[1])
        h.unblock(); await saving
        if (phase === 'level') {
          assert.equal(h.owner.cardMistakePanel, panel, '失败已清除关闭请求，重试成功保持错因可选')
          h.api.onCardMistakePanelSkip(panel.skip)
        }
      }
      assert.deepEqual(plain(await result), {})
      assert.equal(h.owner.cardMistakePanel, undefined)
      assert.equal(h.host.subviews.length, 0)
      assert.deepEqual(h.animations, [.18])
    })
  }
}

test('原生挂载前等待回调退出，生命周期关闭与新页替换不会留下迟到页面', async () => {
  const h = harness(undefined, true), first = await h.open()
  assert.deepEqual(h.delays, [.08])
  assert.equal(h.host.subviews.length, 0)
  h.api.closeCardMistakePanel(h.owner)
  h.api.closeCardMistakePanel(h.owner)
  h.pending.shift()!()
  assert.deepEqual(plain(await first.result), { cancelled: true })
  assert.equal(h.host.subviews.length, 0)
  const second = await h.open(), third = await h.open()
  h.pending.splice(0).forEach(resolve => resolve())
  await flush()
  assert.deepEqual(plain(await second.result), { cancelled: true })
  assert.equal(h.owner.cardMistakePanel, third.panel)
  assertMounted(h.host, third.panel)
  h.api.closeCardMistakePanel(h.owner)
  assert.deepEqual(plain(await third.result), { cancelled: true })
  assert.equal(h.host.subviews.length, 0)
  assert.deepEqual(h.writes, [])
  assert.deepEqual(h.animations, [])
})

test('短屏展开后正文滚动覆盖错因和掌握，小屏宽度自适应；关闭已保存页不再提交', async () => {
  for (const size of [{ width: 240, height: 260 }, { width: 360, height: 180 }, { width: 200, height: 220 }]) {
    const h = harness(size), { panel, result } = await h.open(0)
    assert.equal(panel.view.frame.width, Math.min(192, size.width - 16))
    assert.equal(panel.reasonArea.hidden, true)
    await h.api.onCardMistakePanelLevel(panel.levels[0])
    assertWithin(panel.view.frame, size)
    assert.ok(panel.scroll.contentSize.height > panel.scroll.frame.height)
    assert.ok(panel.scroll.frame.y + panel.scroll.frame.height <= panel.view.frame.height)
    assert.ok(panel.reasonArea.frame.y + panel.reasonArea.frame.height <= panel.scroll.contentSize.height)
    assert.ok(panel.levels[2].frame.y >= panel.reasonArea.frame.y + panel.reasonArea.frame.height)
    assert.ok(panel.levels[2].frame.y + panel.levels[2].frame.height <= panel.scroll.contentSize.height)
    assert.equal(panel.close.superview, panel.view)
    assert.ok(panel.close.frame.y + panel.close.frame.height <= panel.scroll.frame.y)
    h.api.onCardMistakePanelClose(panel.close)
    assert.deepEqual(plain(await result), {})
    assert.deepEqual(h.writes, [{ level: 0 }])
    assert.equal(h.host.subviews.length, 0)
  }
})

for (const phase of ['level', 'reason']) {
  for (const failed of [false, true]) {
    test(`${phase} 保存途中替换页，迟到${failed ? '失败' : '成功'}及旧按钮不影响新页面`, async () => {
      const h = harness(), first = await h.open(undefined, true)
      let saving = h.api.onCardMistakePanelLevel(first.panel.levels[0])
      if (phase === 'reason') {
        h.unblock(); await saving
        saving = h.api.onCardMistakePanelReason(first.panel.reasons[0])
      }
      h.api.onCardMistakePanelOutsideTap(first.panel.outside[0])
      const second = await h.open(1)
      assert.deepEqual(plain(await first.result), phase === 'reason' ? {} : { cancelled: true })
      await h.api.onCardMistakePanelLevel(second.panel.levels[1])
      const attempts = h.attempts.length, animations = h.animations.length
      await h.api.onCardMistakePanelLevel(first.panel.levels[2])
      await h.api.onCardMistakePanelReason(first.panel.reasons[3])
      h.api.onCardMistakePanelSkip(first.panel.skip)
      h.api.onCardMistakePanelOutsideTap(first.panel.outside[1])
      h.api.onCardMistakePanelClose(first.panel.close)
      assert.equal(h.attempts.length, attempts)
      assert.equal(h.owner.cardMistakePanel, second.panel)
      assert.equal(second.panel.closeRequested, false)
      if (failed) h.fail()
      h.unblock(); await saving
      assert.equal(first.panel.busy, false)
      assert.equal(h.owner.cardMistakePanel, second.panel)
      assert.equal(second.panel.level, 1)
      assert.equal(second.panel.savedLevel, 1)
      assert.equal(second.panel.error, undefined)
      assert.equal(second.panel.busy, false)
      assert.equal(h.animations.length, animations)
      assertMounted(h.host, second.panel)
      assert.ok([...first.panel.outside, first.panel.view].every(view => view.superview === undefined))
      h.api.closeCardMistakePanel(h.owner)
      assert.deepEqual(plain(await second.result), {})
      assert.equal(h.host.subviews.length, 0)
    })
  }
}

test('生命周期关闭等待中的已挂载页后，迟到写入不重新挂载', async () => {
  const h = harness(), { panel, result } = await h.open(undefined, true)
  const saving = h.api.onCardMistakePanelLevel(panel.levels[0])
  h.api.closeCardMistakePanel(h.owner)
  assert.deepEqual(plain(await result), { cancelled: true })
  assert.equal(h.host.subviews.length, 0)
  h.unblock(); await saving
  assert.deepEqual(h.writes, [{ level: 0 }])
  assert.equal(h.owner.cardMistakePanel, undefined)
  assert.equal(h.host.subviews.length, 0)
})

test('卡片锚点只接受同一事件卡片矩形或同 ID 的真实选中视图', () => {
  const source = readFileSync('src/floating-toolbar.ts', 'utf8'), ast = createSourceFile('toolbar.ts', source, ScriptTarget.Latest, true)
  const fn = ast.statements.find(node => isFunctionDeclaration(node) && node.name?.text === 'cardMistakeAnchor')!
  let selected: any[] = []
  const scope: any = { exports: {}, Application: { sharedInstance: () => ({ studyController: () => ({ notebookController: { mindmapView: { get selViewLst() { return selected } } } }) }) } }
  runInNewContext(transpileModule(fn.getText(ast), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const window = { frame: { x: 20, y: 30 } }, host = { frame: { x: 80, y: 30 } }
  const owner = { window, answerToolbarNoteId: 'event', answerToolbarTargetRect: { x: 300, y: 200, width: 100, height: 80 } }
  assert.deepEqual(JSON.parse(JSON.stringify(scope.exports.cardMistakeAnchor(owner, 'event', window))), owner.answerToolbarTargetRect)
  assert.deepEqual(JSON.parse(JSON.stringify(scope.exports.cardMistakeAnchor(owner, 'event', host))), { x: 220, y: 170, width: 100, height: 80 })
  assert.equal(scope.exports.cardMistakeAnchor(owner, 'other', host), undefined)
  selected = [{ note: { noteId: 'other' }, view: { superview: {}, bounds: {}, convertRectToView: () => ({ x: 40, y: 50, width: 60, height: 70 }) } }]
  assert.deepEqual(JSON.parse(JSON.stringify(scope.exports.cardMistakeAnchor(owner, 'other', host))), { x: 40, y: 50, width: 60, height: 70 })
  assert.equal(scope.exports.cardMistakeAnchor(owner, 'absent', host), undefined)
  selected[0].view.convertRectToView = () => ({ x: NaN, y: 0, width: 20, height: 20 })
  assert.equal(scope.exports.cardMistakeAnchor(owner, 'other', host), undefined)
  selected[0].view.convertRectToView = () => { throw Error('native conversion failed') }
  assert.equal(scope.exports.cardMistakeAnchor(owner, 'other', host), undefined)
  selected[0].view.superview = undefined
  assert.equal(scope.exports.cardMistakeAnchor(owner, 'other', host), undefined)
})
