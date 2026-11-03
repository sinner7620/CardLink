import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

test("做题树按学习集和脑图保存深层展开状态，全部收起也可恢复", () => {
  const source = readFileSync("src/mnutils-entrance.ts", "utf8")
  const functions = ["restoreTreeExpansion", "rememberTreeExpansion"].map(name => {
    const fn = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0]
    assert.ok(fn)
    return fn
  }).join("\n")
  const preferences = new Map<string, string>()
  const sandbox: any = {
    TREE_EXPANSION_KEY: "expansion.",
    NSUserDefaults: { standardUserDefaults: () => ({
      objectForKey: (key: string) => preferences.get(key),
      setObjectForKey: (value: string, key: string) => preferences.set(key, value), synchronize() {}
    }) }
  }
  runInNewContext(transpileModule(functions, { compilerOptions: { target: 7 } }).outputText, sandbox)
  const menu = () => ({ tree: [{ id: "root" }], expandedIds: new Set<string>() })
  const first = menu()
  sandbox.restoreTreeExpansion(first, '["book-a","map-a"]')
  assert.deepEqual([...first.expandedIds], ["root"])
  first.expandedIds.add("deep-node")
  sandbox.rememberTreeExpansion(first)
  const reopened = menu()
  sandbox.restoreTreeExpansion(reopened, '["book-a","map-a"]')
  assert.deepEqual([...reopened.expandedIds], ["root", "deep-node"])
  // 同一脑图重读树时，不用保存值覆盖当前选择。
  reopened.expandedIds.delete("root")
  sandbox.restoreTreeExpansion(reopened, '["book-a","map-a"]')
  assert.deepEqual([...reopened.expandedIds], ["deep-node"])
  for (const scope of ['["book-a","map-b"]', '["book-b","map-a"]']) {
    sandbox.restoreTreeExpansion(reopened, scope)
    assert.deepEqual([...reopened.expandedIds], ["root"])
  }
  sandbox.restoreTreeExpansion(reopened, '["book-a","map-a"]')
  reopened.expandedIds.clear()
  sandbox.rememberTreeExpansion(reopened)
  const collapsed = menu()
  sandbox.restoreTreeExpansion(collapsed, '["book-a","map-a"]')
  assert.deepEqual([...collapsed.expandedIds], [])
})

function geometryHarness() {
  const source = readFileSync('src/mnutils-entrance.ts', 'utf8')
  const functions = ['withoutReviewAnimations', 'interpolateReviewFrame', 'animateReviewGeometry', 'setQuickMenuShell', 'animateQuickMenu', 'settleQuickMenu'].map(name => {
    const fn = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0]
    assert.ok(fn); return fn
  }).join('\n')
  let now = 0, disabled = false, reduced = false, writes = 0
  const timers: any[] = []
  function view(frame: any) {
    let stored = frame
    return { layer: {}, userInteractionEnabled: true,
      get frame() { return stored }, set frame(value) { assert.equal(disabled, true, '宿主没有 UIView 动画开关时仍须禁用 CA 隐式动画'); stored = value; writes++ } }
  }
  const menu: any = { generation: 0, open: true, reviewOpening: true, reviewControls: {},
    content: view({ x: 100, y: 100, width: 44, height: 44 }), controls: view({ x: -20, y: 0, width: 360, height: 52 }),
    expandedFrame: { x: 80, y: 100, width: 360, height: 52 }, collapsedFrame: { x: 100, y: 100, width: 44, height: 44 } }
  const scope: any = { menu, exports: {}, UIView: {}, Date: { now: () => now },
    CATransaction: { begin() {}, setDisableActions(v: boolean) { disabled = v }, commit() { disabled = false } },
    reducedMotionEnabled: () => reduced, QUICK_MENU_SHELL_TRANSITION_SECONDS: .24,
    styleReviewMenuShell() {}, recordRuntimeState() {}, finishQuickMenu() {},
    setWindowFrame(view: any, frame: any) { view.frame = frame },
    NSTimer: { scheduledTimerWithTimeInterval(_seconds: number, _repeat: boolean, callback: () => void) {
      const timer = { callback, active: true, invalidate() { this.active = false } }; timers.push(timer); return timer
    } } }
  runInNewContext(transpileModule(functions + ';exports.open=animateQuickMenu;exports.animate=animateReviewGeometry', { compilerOptions: { target: 7, module: 1 } }).outputText, scope)
  return { menu, scope, timers, get writes() { return writes }, setReduced() { reduced = true },
    tick(ms: number) { now = ms; for (const timer of [...timers]) if (timer.active) timer.callback() } }
}

test('展开只用一个时钟：每个中间帧主控坐标固定，结束后不再飞入或启动第二动画', async () => {
  const h = geometryHarness(), opening = h.scope.exports.open(h.menu, true)
  assert.equal(h.timers.length, 1)
  let previousWidth = 44
  for (const time of [0, 40, 80, 120, 180, 240]) {
    h.tick(time)
    assert.equal(h.menu.content.frame.x + h.menu.controls.frame.x, 80)
    assert.equal(h.menu.content.frame.y + h.menu.controls.frame.y, 100)
    assert.ok(h.menu.content.frame.width >= previousWidth)
    previousWidth = h.menu.content.frame.width
  }
  await opening
  assert.equal(h.menu.reviewOpening, false)
  assert.equal(h.menu.content.frame.width, 360)
  const writes = h.writes
  h.tick(400); await Promise.resolve()
  assert.equal(h.writes, writes)
  assert.equal(h.timers.length, 1)
  assert.ok(h.timers.every(timer => !timer.active))
  h.menu.open = false
  const closing = h.scope.exports.open(h.menu, false)
  h.tick(520)
  assert.ok(h.menu.content.frame.width > 44 && h.menu.content.frame.width < 360)
  h.tick(640); await closing
  assert.equal(h.menu.content.frame.width, 44)
})

test('帧动画取消后旧时钟不能覆盖新布局，减少动态效果时不创建动画时钟', async () => {
  const h = geometryHarness(), samples: number[] = []
  const animation = h.scope.exports.animate(h.menu, .46, (progress: number) => samples.push(progress))
  h.tick(100); const count = samples.length
  h.menu.generation++; h.tick(200); await animation
  assert.equal(samples.length, count)
  h.setReduced(); await h.scope.exports.animate(h.menu, .46, (progress: number) => samples.push(progress))
  assert.equal(samples[samples.length - 1], 1)
  assert.equal(h.timers.length, 1)
})
