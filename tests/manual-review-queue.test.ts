import assert from "node:assert/strict"
import { mock, test } from "node:test"
import type { MistakeRecord } from "../src/mistake-domain"

const saved = new Map<string, unknown>()
let writes = 0
mock.module("marginnote", { namedExports: {
  getLocalDataByKey: (key: string) => saved.get(key),
  setLocalDataByKey: (value: unknown, key: string) => { writes++; saved.set(key, value) }
} })

let queue: typeof import("../src/manual-review-queue")
async function loadQueue() {
  queue ??= await import("../src/manual-review-queue")
  return queue
}

function record(id: string, nextReviewAt: string): MistakeRecord {
  return { recordId: id, nextReviewAt, sourceAvailable: true, reviewCompleted: false } as MistakeRecord
}

test("超过首页 25 题时，补入队列读取完整原生错题库并在刷新后保持", async () => {
  const { addOverdueToToday, manualTodayIds } = await loadQueue()
  saved.clear()
  writes = 0
  const now = new Date(2026, 8, 23, 12)
  const records: Record<string, MistakeRecord> = {}
  for (let index = 0; index < 30; index++) {
    const id = `future:${index}`
    records[id] = record(id, "2026-09-25T00:00:00+08:00")
  }
  for (let index = 0; index < 5; index++) {
    const id = `overdue:${index}`
    records[id] = record(id, "2026-09-20T00:00:00+08:00")
  }
  const added = addOverdueToToday(records, 3, now)
  assert.equal(added.addedCount, 3)
  assert.ok(added.ids.every(id => id.startsWith("overdue:")))
  assert.deepEqual(manualTodayIds(records, now), added.ids)
  assert.equal(writes, 1, "面板刷新读取队列不能反向写入存储")
  assert.equal(addOverdueToToday(records, 5, now).addedCount, 2)
  assert.equal(manualTodayIds(records, now).length, 5)
})

test("复测后从手动队列移除；次日自动失效", async () => {
  const { addOverdueToToday, manualTodayIds, removeFromManualToday } = await loadQueue()
  saved.clear()
  writes = 0
  const now = new Date(2026, 8, 23, 12)
  const records = { a: record("a", "2026-09-20T00:00:00+08:00") }
  addOverdueToToday(records, 1, now)
  removeFromManualToday("a", records, now)
  assert.deepEqual(manualTodayIds(records, now), [])
  addOverdueToToday(records, 1, now)
  assert.deepEqual(manualTodayIds(records, new Date(2026, 8, 24, 1)), [])
})
