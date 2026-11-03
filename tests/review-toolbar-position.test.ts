import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createSourceFile, ScriptTarget, isFunctionDeclaration, transpileModule } from 'typescript'
import * as layout from '../src/review-toolbar-layout'
import { quickMenuGeometry } from '../src/quick-menu-geometry'

/** Exercise the actual native menu layout/commit closures with UIView frames. */
function menuHarness(position: { x: number; y: number }, size = { width: 1024, height: 768 }) {
  let animationsEnabled = true
  const layoutWrites: boolean[] = [], removedAnimations: string[] = []
  class View {
    private storedFrame: any; private storedBounds: any
    layer: any = { removeAnimationForKey(key: string) { removedAnimations.push(key) } }; hidden = false; backgroundColor: any
    static areAnimationsEnabled() { return animationsEnabled }
    static setAnimationsEnabled(value: boolean) { animationsEnabled = value }
    get frame() { return this.storedFrame }
    set frame(value: any) { layoutWrites.push(animationsEnabled); this.storedFrame = value }
    get bounds() { return this.storedBounds }
    set bounds(value: any) { layoutWrites.push(animationsEnabled); this.storedBounds = value }
    constructor(frame: any = {}) { this.frame = frame; this.bounds = { x: 0, y: 0, width: frame.width, height: frame.height } }
    addSubview() {}
    setImageForState(image: any) { (this as any).image = image }
    bringSubviewToFront() {}
    removeFromSuperview() { (this as any).removed = true }
  }
  const ball = { button: new View({ ...position, width: 44, height: 44 }),
    get frame() { return this.button.frame }, set frame(v) { this.button.frame = v } }
  const owner: any = { window: { bounds: size }, cardLinkReviewMode: { writingMode: 'annotation', annotationHorizontal: undefined } }
  const source = readFileSync('src/mnutils-entrance.ts', 'utf8')
  const ast = createSourceFile('entrance.ts', source, ScriptTarget.Latest, true)
  const names = new Set(['withoutReviewAnimations', 'interpolateReviewFrame', 'geometryFor', 'openQuickMenu', 'layoutQuickMenu', 'setQuickMenuShell', 'beginReviewToolbarDrag', 'translateReviewToolbarDrag', 'trackReviewToolbarDrag', 'scheduleReviewToolbarHover', 'finishReviewToolbarDrag', 'onMnutilsEntrancePan', 'settleQuickMenu', 'revealReviewToolbarDrag', 'collapseReviewToolbarDrag', 'expandReviewToolbarDrag'])
  const functions = ast.statements.filter(n => isFunctionDeclaration(n) && names.has(n.name?.text || '')).map(n => n.getText(ast)).join('\n')
  let pathWidth = 0, expanded = false, renders = 0, clock = 1000
  owner.cardLinkReviewNativeImages = { plugin: "logo.png" }
  const transitions: number[] = [], finishes: Array<() => void> = []
  let deferSettle = false
  owner.cardLinkReviewEntranceRender = () => {
    renders++
    const viewport = owner.cardLinkReviewEntranceLimits()
    const metrics = layout.reviewToolbarLayout(owner.cardLinkReviewMode.annotationHorizontal, expanded, pathWidth, viewport, 8)
    owner.cardLinkReviewEntranceResize(metrics.height, metrics.width)
    owner.cardLinkReviewEntranceCommit(true)
  }
  const timers: Array<{ run(): void; invalidate(): void; valid: boolean }> = []
  const scope: any = { Date: { now: () => clock }, UIButton: { buttonWithType: () => new View() }, NSTimer: { scheduledTimerWithTimeInterval(_seconds: number, _repeat: boolean, callback: () => void) { const timer = { valid: true, run() { if (this.valid) callback() }, invalidate() { this.valid = false } }; timers.push(timer); return timer } }, exports: {}, self: owner, ...layout, quickMenuGeometry,
    UIView: View, UIColor: { clearColor: () => ({}), colorWithHexString: () => ({}) },
    ENTRANCE_SIZE: 44, REVIEW_TOOLBAR_DRAG_MIN_DISTANCE: 44, QUICK_MENU_WIDTH: 272, QUICK_MENU_HEIGHT: 520, QUICK_MENU_INSET: 12,
    QUICK_MENU_LIST_CHROME: 124, QUICK_MENU_LIST_TOP: 112,
    windowSize: () => size, nearestDock: () => ({ edge: position.x > size.width / 2 ? 'right' : 'left' }),
    recordRuntimeState() {}, closeQuickMenu() {}, styleReviewMenuShell() {}, styleAnnotationReviewSurface() {},
    rememberDock() {},
    animateQuickMenuUpdate(update: () => void, duration: number) {
      transitions.push(duration); update()
      return deferSettle && duration === .46 ? new Promise<void>(resolve => finishes.push(resolve)) : Promise.resolve()
    },
    animateReviewGeometry(_menu: any, duration: number, update: (progress: number) => void) {
      transitions.push(duration); update(1)
      return deferSettle && duration === .46 ? new Promise<void>(resolve => finishes.push(resolve)) : Promise.resolve()
    },
    setWindowFrame: (view: any, frame: any) => { view.frame = frame },
    createQuickMenu: (ball: any, window: any, collapsedFrame: any, geometry: any, owner: any) => ({
      ball, window, collapsedFrame, geometry, owner, generation: 0, expandedFrame: geometry.frame,
      content: new View(geometry.frame), controls: new View(), startButton: new View(), closeButton: new View(),
      segment: new View(), segmentVisual: new View(), allButton: new View(), filterButton: new View()
    }) }
  runInNewContext(transpileModule(functions + '\nfunction animateQuickMenu(menu){menu.reviewOpening=false;layoutQuickMenu(menu,menu.geometry)}\nexports.open=openQuickMenu;exports.pan=onMnutilsEntrancePan',
    { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  owner.mnutilsEntranceBall = ball
  scope.exports.open(ball, {}, owner)
  return { owner, ball, size, layoutWrites, removedAnimations, get animationsEnabled() { return animationsEnabled }, menu: owner.mnutilsQuickMenu, transitions, finishes,
    get renders() { return renders },
    hover() { timers.forEach(timer => timer.run()) },
    defer() { deferSettle = true },
    pause(ms: number) { clock += ms },
    pan(state: number, dx = 0, dy = 0, point?: { x: number; y: number }) {
      clock += 16
      scope.exports.pan({ state, translationInView: () => ({ x: dx, y: dy }), setTranslationInView() {},
        locationInView: () => point || { x: ball.frame.x + 22, y: ball.frame.y + 22 } })
    },
    render(width: number, open = true) { pathWidth = width; expanded = open; owner.cardLinkReviewEntranceRender() },
    mainPosition() {
      const menu = owner.mnutilsQuickMenu, root = menu.reviewControls
      return { x: menu.content.frame.x + menu.controls.frame.x - (menu.controls.bounds?.x || 0) + root.frame.x - root.bounds.x,
        y: menu.content.frame.y + menu.controls.frame.y - (menu.controls.bounds?.y || 0) + root.frame.y - root.bounds.y }
    } }
}

test('真实窗口锚点不随分类长短或展开收起改变，右侧不足只限制分类视口', () => {
  for (const position of [{ x: 900, y: 30 }, { x: 20, y: 0 }, { x: 950, y: 0 }]) {
    const h = menuHarness(position), initial = h.mainPosition()
    assert.equal(h.owner.cardLinkReviewMode.annotationHorizontal, true)
    const core = { ...h.menu.reviewCore }
    for (const width of [20, 800, 50, 1400, 10]) {
      h.render(width)
      assert.deepEqual(h.mainPosition(), initial)
      assert.deepEqual({ ...h.menu.reviewCore }, core)
      const limits = h.owner.cardLinkReviewEntranceLimits()
      const metrics = layout.reviewToolbarLayout(true, true, width, limits, 8)
      assert.equal(metrics.buttons[0].width, 44)
      assert.ok(metrics.sourceWidth > 0)
      assert.ok(h.menu.content.frame.x + h.menu.content.frame.width <= h.size.width)
      h.render(width, false)
      assert.deepEqual(h.mainPosition(), initial)
    }
  }
})

test('向左或向上扩展外层时，主控的屏幕坐标和可交互坐标仍固定', () => {
  for (const position of [{ x: 970, y: 300 }, { x: 500, y: 710 }]) {
    const h = menuHarness(position), initial = h.mainPosition(), core = h.menu.reviewCore
    const left = !h.owner.cardLinkReviewMode.annotationHorizontal
    const origin = left ? { x: -180, y: 0 } : { x: 0, y: -150 }
    h.owner.cardLinkReviewEntranceResize(core.height - 8 - origin.y, core.width - 8 - origin.x, origin)
    h.owner.cardLinkReviewEntranceCommit()
    assert.deepEqual(h.mainPosition(), initial)
    assert.equal(h.menu.reviewControls.bounds.x, origin.x)
    assert.equal(h.menu.reviewControls.bounds.y, origin.y)
    assert.ok(h.menu.content.frame.x >= 0 && h.menu.content.frame.y >= 0)
    assert.ok(h.menu.content.frame.x + h.menu.content.frame.width <= h.size.width)
    assert.ok(h.menu.content.frame.y + h.menu.content.frame.height <= h.size.height)
  }
})


test('短距离快速微调保持原形与抓取偏移，悬停和松手均不收球或居中展开', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.render(160)
  const initial = h.mainPosition(), core = { ...h.menu.reviewCore }, frame = { ...h.menu.content.frame }
  const before = h.renders, transitions = h.transitions.length
  h.pan(1, 0, 0, { x: 700, y: 30 })
  assert.deepEqual(h.mainPosition(), initial)
  h.pan(2, 30, 30)
  h.hover()
  assert.deepEqual(h.mainPosition(), { x: initial.x + 30, y: initial.y + 30 })
  assert.equal(h.menu.content.frame.width, frame.width)
  assert.equal(h.menu.content.frame.height, frame.height)
  assert.equal(h.menu.reviewDrag.preview.hidden, true)
  assert.equal(h.menu.reviewDrag.grip.hidden, true)
  assert.equal(h.transitions.length, transitions)
  assert.equal(h.renders, before)
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual({ ...h.menu.reviewCore }, { ...core, x: core.x + 30, y: core.y + 30 })
  assert.deepEqual(h.mainPosition(), { x: initial.x + 30, y: initial.y + 30 })
  assert.equal(h.transitions.length, transitions)
  assert.equal(h.menu.reviewDrag, undefined)
})

test('单次拖拽达到 44 点且快速移动才开始收球，低速长距离只平移', () => {
  const fast = menuHarness({ x: 400, y: 10 })
  fast.pan(1)
  fast.pan(2, 43, 0)
  assert.equal(fast.menu.reviewDrag.transformed, false)
  fast.pan(2, 1, 0)
  assert.equal(fast.menu.reviewDrag.transformed, false, '达到距离但本次速度不够时仍不收球')
  fast.pan(2, 6, 0)
  assert.equal(fast.menu.reviewDrag.transformed, true)
  assert.ok(fast.transitions.includes(.34))

  const slow = menuHarness({ x: 400, y: 10 })
  slow.pan(1)
  for (let i = 0; i < 10; i++) {
    slow.pause(100)
    slow.pan(2, 6, 0)
  }
  slow.hover()
  assert.equal(slow.menu.reviewDrag.transformed, false)
  assert.ok(!slow.transitions.includes(.34) && !slow.transitions.includes(.46))
})

test('距离按本次起点的净位移计算，反复短距离往返不累加触发收球', () => {
  const h = menuHarness({ x: 400, y: 10 }), initial = h.mainPosition()
  h.pan(1)
  for (let i = 0; i < 10; i++) {
    h.pan(2, 30, 0)
    h.pan(2, -30, 0)
  }
  assert.equal(h.menu.reviewDrag.transformed, false)
  assert.deepEqual(h.mainPosition(), initial)
})

test('每次手势重置距离，上次收球和多次微调不影响下一次短拖动', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.pan(1)
  h.pan(2, 44, 0)
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  const transitions = h.transitions.length
  for (let i = 0; i < 3; i++) {
    const initial = h.mainPosition()
    h.pan(1)
    h.pan(2, 20, 0)
    assert.equal(h.menu.reviewDrag.transformed, false)
    h.pan(3)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(h.mainPosition(), { x: initial.x + 20, y: initial.y })
    assert.equal(h.transitions.length, transitions)
  }
})

test('短拖动取消或失败原位恢复，原位松手不播放收展动画', async () => {
  for (const state of [3, 4, 5]) {
    const h = menuHarness({ x: 400, y: 10 }), initial = h.mainPosition()
    const transitions = h.transitions.length
    h.pan(1)
    if (state !== 3) h.pan(2, 20, 8)
    h.pan(state)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(h.mainPosition(), initial)
    assert.equal(h.transitions.length, transitions)
    assert.equal(h.menu.reviewDrag, undefined)
  }
})

test('短距离跨过换向线也保持原方向，已向左展开的分类随原生父层平移', async () => {
  const h = menuHarness({ x: 970, y: 300 }), core = h.menu.reviewCore
  const origin = { x: -80, y: 0 }
  h.owner.cardLinkReviewEntranceResize(core.height - 8, core.width - 8 - origin.x, origin)
  h.owner.cardLinkReviewEntranceCommit()
  const initial = h.mainPosition(), bounds = { ...h.menu.reviewControls.bounds }
  const horizontal = h.menu.reviewHorizontal
  h.pan(1, 0, 0, { x: 190, y: 200 })
  h.pan(2, 0, -40)
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.mainPosition(), { x: initial.x, y: initial.y - 40 })
  assert.deepEqual({ ...h.menu.reviewControls.bounds }, bounds)
  assert.equal(h.menu.reviewHorizontal, horizontal)
  assert.ok(!h.transitions.includes(.34) && !h.transitions.includes(.46))
})


test('视频式拖动只移动收拢容器，不在移动途中重排按钮，松手在释放位置展开一次', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.render(500)
  const before = h.renders
  h.pan(1, 0, 0, { x: 500, y: 250 })
  assert.notEqual(h.menu.content.frame.width, 72)
  h.pan(2, -22, 0)
  h.pan(2, -22, 0)
  assert.equal(h.menu.content.frame.width, 72)
  assert.equal(h.menu.controls.layer.opacity, 0)
  assert.equal(h.menu.reviewDrag.preview.frame.width, 44)
  assert.equal(h.menu.reviewDrag.preview.frame.height, 44)
  assert.ok(h.menu.reviewControls && !h.menu.reviewControls.hidden, '手势所在视图不能隐藏或移除')
  for (let i = 0; i < 18; i++) h.pan(2, -22, 0)
  assert.equal(h.renders, before, '移动途中不重建或重排完整工具条')
  assert.equal(h.menu.reviewDrag.preview.frame.width, 44)
  assert.equal(h.menu.reviewDrag.preview.frame.height, 44)
  assert.equal(h.menu.content.frame.x + 36, 60)
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.renders, before + 1)
  assert.equal(h.owner.cardLinkReviewMode.annotationHorizontal, false)
  assert.equal(h.menu.reviewCore.x, 34)
  assert.equal(h.menu.reviewDrag, undefined)
  assert.equal(h.menu.controls.layer.opacity, 1)
  assert.equal(h.menu.controls.alpha, 1)
  assert.ok(h.transitions.includes(.34) && h.transitions.includes(.46))
  const position = h.mainPosition()
  h.render(900)
  assert.deepEqual(h.mainPosition(), position, '停靠后分类变化继续固定主控')
})

test('四边停靠保持主控在窗口内，预览中央收拢且角落不会抖动换向', () => {
  const bounds = { width: 1024, height: 768 }
  for (const [point, edge, horizontal] of [
    [{ x: 20, y: 380 }, 'left', false], [{ x: 1000, y: 380 }, 'right', false],
    [{ x: 500, y: 20 }, 'top', true], [{ x: 500, y: 750 }, 'bottom', true]
  ] as const) {
    const target = layout.reviewToolbarDropFrame(point, bounds, 8)
    assert.equal(target.edge, edge)
    assert.equal(target.horizontal, horizontal)
    assert.ok(target.frame.x >= 0 && target.frame.y >= 0)
    assert.ok(target.frame.x + target.frame.width <= bounds.width)
    assert.ok(target.frame.y + target.frame.height <= bounds.height)
  }
  const center = layout.reviewToolbarDragGeometry({ x: 500, y: 350 }, bounds)
  assert.deepEqual(center.preview, { x: 14, y: 14, width: 44, height: 44 })
  for (const y of [199, 201, 190, 210]) assert.equal(layout.reviewToolbarDragGeometry({ x: 200, y }, bounds, 'left').edge, 'left')
  assert.equal(layout.reviewToolbarDragGeometry({ x: 200, y: 170 }, bounds, 'left').edge, 'top')
  for (const point of [{ x: 10, y: 10 }, { x: 310, y: 490 }]) {
    const target = layout.reviewToolbarDropFrame(point, { width: 320, height: 500 }, 8)
    assert.ok(target.frame.x >= 0 && target.frame.y >= 0 && target.frame.x + target.frame.width <= 320 && target.frame.y + target.frame.height <= 500)
  }
})

test('取消拖动恢复原位置，展开动画被新拖动打断时旧回调不能覆盖新位置', async () => {
  const h = menuHarness({ x: 450, y: 10 })
  const original = { ...h.menu.reviewCore }
  h.pan(1, 0, 0, { x: 500, y: 30 })
  h.pan(2, -450, 300)
  h.pan(4)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual({ ...h.menu.reviewCore }, original)
  h.defer()
  h.pan(1, 0, 0, { x: 500, y: 30 })
  h.pan(2, -450, 300)
  h.pan(3)
  const first = h.menu.reviewDrag
  h.pan(1, 0, 0, { x: 50, y: 330 })
  h.pan(2, 500, 300)
  const second = h.menu.reviewDrag, frame = { ...h.menu.content.frame }
  h.finishes.shift()!()
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(first, second)
  assert.equal(h.menu.reviewDrag, second)
  assert.deepEqual({ ...h.menu.content.frame }, frame)
  h.pan(3)
  h.finishes.shift()!()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.menu.reviewDrag, undefined)
  assert.equal(h.owner.cardLinkReviewMode.annotationHorizontal, true)
})


test('拖动期间反馈或分类刷新不改变收拢位置，首个手势位置不重复叠加位移', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.pan(1, 12, 8, { x: 500, y: 250 })
  h.pan(2, 44, 0)
  assert.equal(h.menu.content.frame.x + 36, 544)
  assert.equal(h.menu.content.frame.y + 36, 250)
  const compact = { ...h.menu.content.frame }
  h.render(1000)
  assert.deepEqual({ ...h.menu.content.frame }, compact)
  h.pan(2, 0, 480)
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  const stable = h.mainPosition()
  for (const width of [50, 1200, 20]) {
    h.render(width)
    assert.deepEqual(h.mainPosition(), stable)
  }
})

test('边缘预览有进入退出缓冲，中央收拢与边缘胶囊不会反复伸缩', () => {
  const size = { width: 1024, height: 768 }
  for (const x of [90, 95, 100, 105]) {
    assert.equal(layout.reviewToolbarDragGeometry({ x, y: 380 }, size, 'left', true).nearEdge, true)
    assert.equal(layout.reviewToolbarDragGeometry({ x, y: 380 }, size, 'left', false).nearEdge, false)
  }
  assert.equal(layout.reviewToolbarDragGeometry({ x: 80, y: 380 }, size, 'left', false).nearEdge, true)
  assert.equal(layout.reviewToolbarDragGeometry({ x: 115, y: 380 }, size, 'left', true).nearEdge, false)
})


test('取消或原位松手展开时，控件在动画开始前已对齐最终位置，不在动画结束时跳动', async () => {
  for (const cancelled of [false, true]) {
    const h = menuHarness({ x: 6, y: 300 })
    const original = h.mainPosition()
    h.defer()
    h.pan(1, 0, 0, { x: 28, y: 400 })
    if (cancelled) h.pan(2, 400, -200)
    else h.pan(2, 0, 44)
    h.pan(cancelled ? 4 : 3)
    const beforeFinish = h.mainPosition()
    if (cancelled) assert.deepEqual(beforeFinish, original)
    h.finishes.shift()!()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(h.mainPosition(), beforeFinish)
  }
})


test('同方向结束也刷新真实渲染器的缓存，避免收拢后一直停留在旧布局', async () => {
  const h = menuHarness({ x: 6, y: 300 })
  const render = h.owner.cardLinkReviewEntranceRender
  h.owner.cardLinkReviewDetailKey = 'unchanged'
  h.owner.cardLinkReviewEntranceRender = () => {
    if (h.owner.cardLinkReviewDetailKey === 'unchanged') return
    render()
  }
  h.pan(1, 0, 0, { x: 28, y: 400 })
  h.pan(2, 0, 44)
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.menu.reviewDrag, undefined)
  assert.equal(h.menu.content.frame.width, h.menu.expandedFrame.width)
  assert.equal(h.menu.content.frame.height, h.menu.expandedFrame.height)
  assert.equal(h.mainPosition().x, h.menu.reviewCore.x + 4)
})


test('圆形和短胶囊在四角仍完整可见，透明跟踪外框不限制预览尺寸', () => {
  const size = { width: 320, height: 500 }
  for (const point of [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 0, y: 500 }, { x: 320, y: 500 }]) {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const preview = layout.reviewToolbarDragGeometry(point, size, edge)
      const x = preview.container.x + preview.preview.x, y = preview.container.y + preview.preview.y
      assert.ok(x >= 0 && y >= 0)
      assert.ok(x + preview.preview.width <= size.width && y + preview.preview.height <= size.height)
    }
  }
})

test('中央悬停显示释放位置预览，移动收拢，松手只展开一次且过期计时器无效', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.defer()
  h.pan(1, 0, 0, { x: 500, y: 300 })
  h.pan(2, 44, 0)
  h.hover()
  assert.equal(h.menu.reviewDrag.hovering, true)
  const target = layout.reviewToolbarDropFrame({ x: 544, y: 300 }, h.size, 8)
  assert.equal(h.menu.content.frame.x + h.menu.reviewDrag.preview.frame.x, target.frame.x)
  assert.equal(h.menu.content.frame.y + h.menu.reviewDrag.preview.frame.y, target.frame.y)
  assert.ok(target.frame.y > 6, '中央释放不吸附上边缘')
  h.pan(2, 15, 0)
  assert.equal(h.menu.reviewDrag.hovering, false)
  assert.equal(h.menu.reviewDrag.preview.frame.width, 44)
  h.pan(3)
  assert.equal(h.menu.controls.layer.opacity, 1, '放缓后显示的是实际控件')
  const transitions = h.transitions.length
  h.hover()
  h.pan(3)
  assert.equal(h.transitions.length, transitions, '结束和计时器回调均不得重复启动展开')
  assert.equal(h.transitions.filter(seconds => seconds === .46).length, 2, '悬停一次，重新快速移动后再展开一次')
  h.finishes.splice(0).forEach(finish => finish())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.menu.controls.layer.opacity, 1)
  assert.equal(h.menu.reviewDrag, undefined)
})


test('移动放缓即显示实际按钮和分类，松手沿用同一次展开，收起球使用插件图标', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.render(160)
  h.pan(1, 0, 0, { x: 500, y: 300 })
  assert.equal(h.menu.reviewDrag.grip.image, 'logo.png')
  h.pan(2, 44, 0)
  h.pause(100)
  h.pan(2, .5, 0)
  h.pause(30)
  h.pan(2, .5, 0)
  assert.equal(h.menu.reviewDrag.hovering, true)
  assert.equal(h.menu.controls.layer.opacity, 1)
  assert.ok(h.menu.expandedFrame.width > h.menu.reviewCore.width, '实际分类已布局并显示')
  const animations = h.transitions.filter(seconds => seconds === .46).length
  h.pan(3)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.transitions.filter(seconds => seconds === .46).length, animations)
  assert.equal(h.menu.reviewDrag, undefined)
})


test('预览交给真实外壳时全部布局写入禁用继承动画，并清理残留呈现位置', async () => {
  const h = menuHarness({ x: 400, y: 10 })
  h.defer()
  h.pan(1, 0, 0, { x: 500, y: 300 })
  h.pan(2, 44, 0)
  h.pan(3)
  h.layoutWrites.length = 0
  h.removedAnimations.length = 0
  h.finishes.shift()!()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(h.layoutWrites.length > 0)
  assert.ok(h.layoutWrites.every(enabled => !enabled))
  assert.ok(h.removedAnimations.includes('position') && h.removedAnimations.includes('bounds'))
  assert.equal(h.animationsEnabled, true)
})
