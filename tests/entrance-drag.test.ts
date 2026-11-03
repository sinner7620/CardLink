import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'

test('普通悬浮球移动关闭继承动画，不重复布局', () => {
  for (const expanded of [false]) {
    let animations = true, orientation = 0, layouts = 0
    const writes: boolean[] = [], removed: string[] = []
    const host = { bounds: { width: 1024, height: 768 } }
    function view(initial: any) {
      let frame = initial
      return { superview: host, layer: { removeAnimationForKey(key: string) { removed.push(key) } },
        get frame() { return frame }, set frame(value) { writes.push(animations); frame = value } }
    }
    const ball = view({ x: 200, y: 200, width: 44, height: 44 })
    const button = { button: ball, get frame() { return ball.frame }, set frame(v) { ball.frame = v } }
    const content = view({ x: 200, y: 200, width: 300, height: 80 })
    const menu = { open: true, reviewControls: true, content, owner: {}, generation: 0,
      expandedFrame: content.frame, collapsedFrame: ball.frame, geometry: { frame: content.frame } }
    const owner = { mnutilsEntranceBall: button, mnutilsQuickMenu: expanded ? menu : undefined }
    const frameApi: any = {}
    runInNewContext(transpileModule(readFileSync('src/window-opacity.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText,
      { exports: frameApi, UIView: { areAnimationsEnabled: () => animations, setAnimationsEnabled: (v: boolean) => { animations = v } } })
    const source = readFileSync('src/mnutils-entrance.ts', 'utf8')
    const scope: any = { exports: {}, self: owner, Date, ENTRANCE_SIZE: 44, EDGE_MARGIN: 18,
      setWindowFrame: frameApi.setWindowFrame, windowSize: () => host.bounds,
      settleQuickMenu: () => { layouts++ }, updateReviewToolbarOrientation: () => { orientation++ } }
    runInNewContext(transpileModule(source.slice(source.indexOf('export function onMnutilsEntrancePan')), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
    const pan = (state: number, x: number, y: number) => scope.exports.onMnutilsEntrancePan({ state,
      translationInView: () => ({ x, y }), setTranslationInView() {} })
    pan(1, 0, 0)
    for (let i = 0; i < 12; i++) pan(2, 2, 1)
    assert.equal(ball.frame.x, 224)
    assert.equal(ball.frame.y, 212)
    assert.equal(orientation, expanded ? 12 : 0)
    assert.equal(layouts, expanded ? 1 : 0)
    assert.ok(writes.every(enabled => !enabled))
    assert.ok(removed.includes('position') && removed.includes('bounds'))
    assert.equal(animations, true)
    if (expanded) {
      assert.equal(content.frame.x, 224)
      pan(3, 0, 0)
      assert.equal(orientation, 13)
    }
  }
})


test('最近边缘方向几何带空间缓冲，换向锚点保持在窗口内', async () => {
  const { reviewToolbarHorizontal, reviewToolbarTrackingFrame } = await import('../src/review-toolbar-layout')
  let horizontal = false, changes = 0
  for (const y of [198, 202, 190, 210, 199]) {
    const next = reviewToolbarHorizontal(200, y, 1024, 768, horizontal)
    if (next !== horizontal) changes++
    horizontal = next
  }
  assert.equal(changes, 0)
  horizontal = reviewToolbarHorizontal(200, 170, 1024, 768, horizontal)
  assert.equal(horizontal, true)
  assert.equal(reviewToolbarHorizontal(200, 218, 1024, 768, horizontal), true)
  assert.equal(reviewToolbarHorizontal(200, 230, 1024, 768, horizontal), false)
  const frame = reviewToolbarTrackingFrame({ x: 300, y: 200, width: 360, height: 52 }, { width: 52, height: 360 }, { x: 480, y: 226 }, { width: 1024, height: 768 })
  assert.equal(frame.x + frame.width / 2, 480)
  assert.equal(frame.y + frame.height / 2, 226)
  const edge = reviewToolbarTrackingFrame({ x: 0, y: 0, width: 52, height: 360 }, { width: 360, height: 52 }, { x: 10, y: 10 }, { width: 400, height: 500 })
  assert.ok(edge.x >= 0 && edge.y >= 0 && edge.x + edge.width <= 400)
})
