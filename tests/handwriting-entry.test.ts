import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function entry(available: boolean | undefined, queue = false) {
  const calls: any[] = [], notices: string[] = [], busy: boolean[] = []
  const pending = { current: false }
  const source = readFileSync("web/src/main.jsx", "utf8")
  const handler = source.match(queue ? /async function openQueueHandwriting\(recordId\) \{[\s\S]*?\n  \}/ : /async function openHandwriting\(\) \{[\s\S]*?\n  \}/)?.[0]
  assert.ok(handler)
  const open = runInNewContext(`(${handler})`, {
    detail: { handwritingAvailable: available, record: { recordId: "topic:question" } },
    handwritingAvailable: available,
    showLocateHint: (message: string) => notices.push(message), handwritingPending: pending,
    setHandwritingBusy: (value: boolean) => busy.push(value),
    action: async (...args: any[]) => { calls.push(args) }
  })
  return { open, calls, notices, busy, pending }
}

test("经典或未确认面板点击手写解释不可用原因，不发送定位或新 API 请求", async () => {
  for (const available of [false, undefined]) {
    const e = entry(available)
    await e.open()
    assert.equal(e.calls.length, 0)
    assert.equal(e.notices.length, 1)
    assert.match(e.notices[0], /经典面板/)
    assert.equal(e.pending.current, false)
  }
})

test("队列书写直接传入所点原题，不先加载详情；经典面板不发送请求", async () => {
  const e = entry(true, true)
  await e.open("queue:question")
  assert.equal(e.calls.length, 1)
  assert.equal(e.calls[0][0], "openMistakeHandwriting")
  assert.equal(e.calls[0][1].recordId, "queue:question")
  assert.equal(e.calls[0][2], false)
  assert.deepEqual(e.busy, [true, false])
  const unavailable = entry(false, true)
  await unavailable.open("queue:question")
  assert.equal(unavailable.calls.length, 0)
  assert.match(unavailable.notices[0], /经典面板/)
})

test("可用的手写入口发送详情题目身份，结束后解除按钮忙碌状态", async () => {
  const e = entry(true)
  await e.open()
  assert.equal(e.calls[0][0], "openMistakeHandwriting")
  assert.equal(e.calls[0][1].recordId, "topic:question")
  assert.equal(e.calls[0][2], false)
  assert.deepEqual(e.busy, [true, false])
  assert.equal(e.pending.current, false)
  assert.equal(e.notices.length, 0)
})
