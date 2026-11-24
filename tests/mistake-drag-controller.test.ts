import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

const nativeModule = transpileModule(readFileSync("src/mistake-drag-controller.ts", "utf8"), {
  compilerOptions: { module: 1, target: 7 },
}).outputText

function fixture() {
  const origin = { x: 100, y: 140 }, onTarget = { x: 480, y: 160 }, elsewhere = { x: 510, y: 330 }
  const frame = { x: 460, y: 140, width: 80, height: 40 }
  const source = { noteId: "question" }, target = { noteId: "target" }
  let notebookId = "book", now = 1000, gesture: any, delegate: any, methods: any
  const exports: any = {}, writes: string[] = []
  const logs: string[] = []
  const timers: Array<{ duration: number; valid: boolean; callback: () => void }> = []
  const animations: Array<() => void> = []
  const views = new Set<View>()
  const panel = { className: "WKWebView", bounds: { x: 0, y: 0, width: 360, height: 280 } }
  let hitView: any = panel
  class View {
    frame: any
    hidden = false
    layer: any = {}
    constructor(frame?: any) { this.frame = frame }
    addSubview() {}
    removeFromSuperview() { views.delete(this) }
    static animateWithDurationAnimationsCompletion(_duration: number, animation: () => void, completion: () => void) {
      animation()
      animations.push(completion)
    }
  }
  const window = {
    hitTestWithEvent: (point: any) => point.x < 400 ? hitView : null,
    convertPointToView: (point: any, view: any) => {
      assert.equal(view, panel)
      return { x: point.x - 40, y: point.y - 60 }
    },
    addSubview: (view: View) => views.add(view),
    addGestureRecognizer: (recognizer: any) => { gesture = recognizer },
    removeGestureRecognizer: (recognizer: any) => { assert.equal(recognizer, gesture); gesture = undefined },
  }
  const color = { colorWithAlphaComponent() { return this } }
  const globals: any = {
    exports,
    Date: { now: () => now },
    NSTimer: { scheduledTimerWithTimeInterval: (duration: number, _repeat: boolean, callback: () => void) => {
      const timer = { duration, callback, valid: true, invalidate() { this.valid = false } }
      timers.push(timer)
      return timer
    } },
    UIView: View, UILabel: View,
    UIColor: { colorWithHexString: () => color, blackColor: () => color },
    JSB: { defineClass: (_name: string, implementation: any) => {
      methods = implementation
      return { new: () => (delegate = {}) }
    } },
    UILongPressGestureRecognizer: class Gesture {
      state = 0
      enabled = true
      point = origin
      locationInView(owner: any) { assert.equal(owner, window); return this.point }
    },
    require: (name: string) => ({
      marginnote: { MN: { app: { studyController: () => ({ notebookController: { notebookId } }) } } },
      "./error-messages": { presentError: (error: unknown) => ({ message: String(error) }) },
      "./note-navigation": { captureDiagnosticError: () => {}, recordRuntimeState: (_scope: string, event: string, detail: string) => logs.push(`${event} ${detail}`) },
      "./same-map-practice": { nativeViewClass: (view: any) => view.className ?? "" },
      "./ui-tokens": { UI_COLORS: { accent: "#0088ff", surface: "#ffffff" } },
      "./window-opacity": { setWindowFrame: (view: View, value: any) => { view.frame = value } },
      "./mistake-card-link": {
        resolveMistakeDragSource: (id: string) => { assert.equal(id, "record"); return { note: source, notebookId, title: "题目" } },
        resolveMistakeDragTarget: (_owner: any, point: any) => point.x === onTarget.x ? { note: target, frame, notebookId } : undefined,
        writeMistakeDragLink: (destination: any, dragged: any) => {
          assert.equal(destination.note, target)
          assert.equal(dragged.note, source)
          writes.push("linked")
          return { status: "linked" }
        },
      },
    } as Record<string, unknown>)[name],
  }
  runInNewContext(nativeModule, globals)
  const owner = { window }
  exports.enableMistakeDrag(owner)
  globals.self = delegate
  function event(state: number, point = origin) {
    gesture.state = state
    gesture.point = point
    methods.trackMistakeDrag(gesture)
  }
  function arm(options = {}, view?: any, active = () => true) {
    now = Math.max(now, 1340)
    return exports.armMistakeDrag(owner, view, {
      id: "press", startedAt: 1000, recordId: "record", x: 60, y: 80,
      width: 360, height: 280, reducedMotion: false, ...options,
    }, active)
  }
  return {
    event, arm, origin, onTarget, elsewhere, views, writes, animations, panel, logs,
    useNestedWebView() { hitView = { className: "WKWebView", superview: panel } },
    begin(at = 1350) { now = at; event(1) },
    changeNotebook() { notebookId = "other" },
    cancel() { exports.cancelMistakeDrag(owner, "press") },
    disable() { exports.disableMistakeDrag(owner) },
    isTracking: () => !!gesture,
    rejectUnmatched() { for (const timer of timers) if (timer.valid && timer.duration === 1) timer.callback() },
  }
}

test("场景触点绑定原生窗口，浮卡和高亮跟随，松手才写入并收进目标卡", async () => {
  const h = fixture()
  h.begin()
  const result = h.arm()
  const [ring, card] = [...h.views]
  assert.equal(ring.hidden, true)
  h.event(2, h.onTarget)
  assert.equal(ring.hidden, false)
  assert.equal(card.frame.x, 456)
  assert.equal(h.writes.length, 0)
  h.event(3, h.onTarget)
  assert.equal((await result).status, "linked")
  assert.equal(card.frame.width, 16)
  assert.equal(card.frame.x, 492)
  h.animations[0]()
  assert.equal(h.views.size, 0)
})

test("经典面板拒绝绑定其他 WebView，取消先于请求时也不写入", async () => {
  const wrong = fixture()
  wrong.begin()
  const result = wrong.arm({}, {})
  wrong.rejectUnmatched()
  assert.equal((await result).status, "unavailable")
  assert.deepEqual(wrong.writes, [])
  assert.ok(wrong.logs.some(log => log.includes("reason=differentWebView")))

  const cancelled = fixture()
  cancelled.begin()
  cancelled.cancel()
  assert.equal((await cancelled.arm()).status, "cancelled")
  cancelled.event(3, cancelled.onTarget)
  assert.deepEqual(cancelled.writes, [])
})

test("经典面板用发起请求的 WebView 匹配延迟手势和偏移触点，超时计时器随即失效", async () => {
  const h = fixture()
  h.useNestedWebView()
  const result = h.arm({ y: 112 }, h.panel)
  h.begin(1750)
  assert.equal(h.views.size, 2)
  assert.ok(h.logs.some(log => log.startsWith("nativeGesture.accepted")
    && log.includes("pointSource=requestWebView; timeDeltaMs=400; dx=0; dy=-32")))
  h.rejectUnmatched()
  h.event(3, h.onTarget)
  assert.equal((await result).status, "linked")
  assert.deepEqual(h.writes, ["linked"])
})

test("场景面板拒绝越界配对和非法原生坐标，传统面板可获得 unavailable 回退状态", async () => {
  const h = fixture()
  h.begin()
  const result = h.arm({ x: 110 })
  assert.ok(h.logs.some(log => log.startsWith("nativeGesture.rejected") && log.includes("reason=coordinateMismatch")))
  h.event(3, h.onTarget)
  assert.equal((await result).status, "unavailable")
  assert.deepEqual(h.writes, [])

  const classic = fixture()
  const fallback = classic.arm({}, classic.panel)
  classic.event(1, { x: NaN, y: 140 })
  classic.rejectUnmatched()
  assert.equal((await fallback).status, "unavailable")
  assert.equal(classic.views.size, 0)
  assert.deepEqual(classic.writes, [])
})

test("清理缩略卡，减少动态效果时跳过动画，切换学习集与关闭时不写入", async () => {
  const switched = fixture()
  switched.begin()
  const result = switched.arm({ reducedMotion: true }, switched.panel)
  switched.changeNotebook()
  switched.event(3, switched.onTarget)
  assert.equal((await result).status, "miss")
  assert.equal(switched.views.size, 0)
  assert.equal(switched.animations.length, 0)
  assert.deepEqual(switched.writes, [])

  const closed = fixture()
  closed.begin()
  const pending = closed.arm()
  closed.disable()
  assert.equal((await pending).status, "cancelled")
  assert.equal(closed.isTracking(), false)
  assert.deepEqual(closed.writes, [])
})
