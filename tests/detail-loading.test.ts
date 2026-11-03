import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function harness() {
  const requests: Array<{ payload: any; resolve: (data: any) => void; reject: (error: Error) => void }> = []
  const state = { detail: null as any, selected: "", busy: false, error: "", reloads: 0 }
  const source = readFileSync("web/src/main.jsx", "utf8")
  const fn = source.match(/async function openDetail\(recordId\) \{[\s\S]*?\n  \}/)?.[0]
  assert.ok(fn)
  const open = runInNewContext(`(${fn})`, {
    detailSeqRef: { current: 0 }, selectedIdRef: { current: "" },
    setSelectedId: (id: string) => { state.selected = id },
    setDetail: (value: any) => { state.detail = typeof value === "function" ? value(state.detail) : value },
    setBusy: (value: boolean) => { state.busy = value },
    setError: (value: string) => { state.error = value }, setData() {},
    load: async () => { state.reloads++ },
    MNBridge: { send: (_command: string, payload: any) => new Promise((resolve, reject) => requests.push({ payload, resolve, reject })) }
  })
  return { state, requests, open }
}

test("先请求原题；快速切题只接纳最后一次响应", async () => {
  const h = harness()
  const a = h.open("a"), b = h.open("b")
  assert.equal(h.requests[0].payload.content, "question")
  h.requests[1].resolve({ record: { recordId: "b" } })
  await b
  h.requests[0].resolve({ record: { recordId: "a" } })
  await a
  assert.equal(h.state.selected, "b")
  assert.equal(h.state.detail.record.recordId, "b")
  assert.equal(h.state.busy, false)
})

test("旧请求失败不清空新题、不触发刷新、不提前解除新请求加载态", async () => {
  const h = harness()
  const a = h.open("a"), b = h.open("b")
  h.requests[0].reject(new Error("旧题失败"))
  await a
  assert.equal(h.state.busy, true)
  assert.equal(h.state.error, "")
  assert.equal(h.state.reloads, 0)
  h.requests[1].resolve({ record: { recordId: "b" } })
  await b
  assert.equal(h.state.detail.record.recordId, "b")
})

test("同题刷新也丢弃上次旧内容，切到另一题立即撤下旧预览", async () => {
  const h = harness()
  const first = h.open("a"), fresh = h.open("a")
  h.requests[1].resolve({ record: { recordId: "a" }, questionHtml: "new" })
  await fresh
  h.requests[0].resolve({ record: { recordId: "a" }, questionHtml: "old" })
  await first
  assert.equal(h.state.detail.questionHtml, "new")
  const next = h.open("b")
  assert.equal(h.state.detail, null)
  h.requests[2].resolve({ record: { recordId: "b" } })
  await next
})

test("当前失效题清除预览并后台同步列表，保留失败提示", async () => {
  const h = harness()
  const opening = h.open("missing")
  h.requests[0].reject(new Error("原卡片不可用"))
  await opening
  assert.equal(h.state.detail, null)
  assert.equal(h.state.error, "原卡片不可用")
  assert.equal(h.state.reloads, 1)
  assert.equal(h.state.busy, false)
})
