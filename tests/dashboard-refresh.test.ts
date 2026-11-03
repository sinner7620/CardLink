import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function harness() {
  const source = readFileSync("web/src/main.jsx", "utf8")
  const fn = source.match(/async function performLoad\(quiet = false\) \{[\s\S]*?\n  \}/)?.[0]
  assert.ok(fn)
  const records = Array.from({ length: 100 }, (_, i) => ({ recordId: String(i) }))
  const state = {
    data: { mistakes: { records, recordsComplete: true } } as any,
    publishedSizes: [] as number[], error: "", streamLoading: false
  }
  const sidebar = { scrollTop: 4000, isConnected: true }
  let resolvePage!: (value: any) => void
  let rejectPage!: (error: Error) => void
  let pageStarted!: () => void
  const waitingForPage = new Promise<void>(resolve => { pageStarted = resolve })
  const page = new Promise((resolve, reject) => { resolvePage = resolve; rejectPage = reject })
  const load = runInNewContext(`(${fn})`, {
    loadSeqRef: { current: 0 }, selectedIdRef: { current: "" }, detailSeqRef: { current: 0 },
    document: { querySelector: (selector: string) => selector === ".mistakeSidebar" ? sidebar : null },
    requestAnimationFrame: (callback: () => void) => callback(),
    setData(value: any) {
      state.data = value
      state.publishedSizes.push(value.mistakes.records.length)
      // 模拟滚动容器因列表缩短而被浏览器钳制。
      sidebar.scrollTop = Math.min(sidebar.scrollTop, Math.max(0, value.mistakes.records.length * 72 - 600))
    },
    setError: (value: string) => { state.error = value },
    setBusy() {}, setSelectedId() {}, setDetail() {},
    setStreamLoading: (value: boolean) => { state.streamLoading = value },
    readLegacyFavoriteTitles: () => [], saveDashboardShellCache() {},
    waitForPaint: async () => {},
    mergeMistakePage: (current: any, next: any) => ({ ...current, mistakes: {
      ...current.mistakes, records: [...current.mistakes.records, ...next.records], recordsComplete: true
    } }),
    MNBridge: { send: async (command: string) => {
      if (command === "dashboard") return { mistakes: {
        records: records.slice(0, 25), recordsComplete: false, nextOffset: 25, transferId: "refresh"
      } }
      assert.equal(command, "mistakesPage")
      pageStarted()
      return page
    } }
  })
  return { state, sidebar, load, waitingForPage, finish: () => resolvePage({ records: records.slice(25) }), fail: rejectPage }
}

test("失效详情触发的后台刷新收齐分页后才更新列表，保留滚动位置", async () => {
  const h = harness()
  const loading = h.load(true)
  await h.waitingForPage
  assert.equal(h.state.data.mistakes.records.length, 100)
  assert.equal(h.sidebar.scrollTop, 4000)
  h.sidebar.scrollTop = 4200 // 等待期间用户继续滚动，不应被旧位置覆盖。
  h.finish()
  await loading
  assert.deepEqual(h.state.publishedSizes, [100])
  assert.equal(h.sidebar.scrollTop, 4200)
})

test("后台分页失败保留完整列表和位置，并撤下加载状态", async () => {
  const h = harness()
  const loading = h.load(true)
  await h.waitingForPage
  h.fail(new Error("分页失败"))
  await loading
  assert.equal(h.state.data.mistakes.records.length, 100)
  assert.equal(h.sidebar.scrollTop, 4000)
  assert.deepEqual(h.state.publishedSizes, [])
  assert.equal(h.state.streamLoading, false)
})

test("显式刷新仍逐页显示并恢复外层侧栏的滚动位置", async () => {
  const h = harness()
  const loading = h.load(false)
  await h.waitingForPage
  assert.equal(h.state.data.mistakes.records.length, 25)
  assert.ok(h.sidebar.scrollTop < 4000)
  h.finish()
  await loading
  assert.deepEqual(h.state.publishedSizes, [25, 100])
  assert.equal(h.sidebar.scrollTop, 4000)
})
