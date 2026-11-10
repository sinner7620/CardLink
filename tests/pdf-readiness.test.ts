import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function readinessHarness(images: any[] = [], fonts: any = Promise.resolve(), unstable = false) {
  let now = 0, next = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const signals: string[] = []
  const location = { set href(value: string) { signals.push(value) } }
  const root = { scrollWidth: 700, get scrollHeight() { return unstable ? ++next : 1000 } }
  const scope: any = { window: { location }, document: {
    images, fonts: { ready: fonts }, documentElement: root,
    querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, style: {} })
  }, Date: { now: () => now }, Promise, Error, Array,
    requestAnimationFrame() { throw new Error("隐藏 WebView 不得依赖动画帧") },
    setTimeout: (callback: () => void, delay: number) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id },
    clearTimeout: (id: number) => timers.delete(id)
  }
  runInNewContext(readFileSync("web/pdf-export-runtime.js", "utf8"), scope)
  return { scope, signals, time: () => now, async flush() {
    for (let step = 0; step < 100; step++) {
      for (let micro = 0; micro < 12; micro++) await Promise.resolve()
      if (signals.length || !timers.size) return
      const [id, task] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      timers.delete(id); now = task.at; task.callback()
    }
    assert.fail("就绪检查没有终止")
  } }
}

test("隐藏 WebView 不触发动画帧、字体永不就绪时，仍在有界时间进入渲染", async () => {
  const h = readinessHarness([], new Promise(() => {}))
  h.scope.window.__MN_PDF_EXPORT_BEGIN__()
  h.scope.window.__MN_PDF_EXPORT_BEGIN__()
  await h.flush()
  assert.deepEqual(h.signals, ["mnaddon://pdf-render-ready"])
  assert.ok(h.time() >= 3000 && h.time() < 4000)
})

test("已损坏图片直接终止导出，不能生成全是图片失败提示的 PDF", async () => {
  const image = { complete: true, naturalWidth: 0, style: {} }
  const h = readinessHarness([image])
  h.scope.window.__MN_PDF_EXPORT_BEGIN__()
  await h.flush()
  assert.match(h.signals[0], /mnaddon:\/\/pdf-render-error/)
  assert.match(decodeURIComponent(h.signals[0]), /1 张图片未能加载/)
})

test("图片永不回调时超时报告失败，34% 不会无限等待", async () => {
  const image = { complete: false, naturalWidth: 0, style: {}, addEventListener() {}, removeEventListener() {} }
  const h = readinessHarness([image])
  h.scope.window.__MN_PDF_EXPORT_BEGIN__()
  await h.flush()
  assert.match(h.signals[0], /pdf-render-error/)
  assert.equal(h.time(), 5000)
})

test("布局持续变化时有明确失败，不无限等待，也不序列化全部手写画布", async () => {
  const h = readinessHarness([], Promise.resolve(), true)
  h.scope.window.__MN_PDF_EXPORT_BEGIN__()
  await h.flush()
  assert.match(decodeURIComponent(h.signals[0]), /PDF 页面布局未能稳定/)
  assert.ok(h.time() <= 6120)
})
