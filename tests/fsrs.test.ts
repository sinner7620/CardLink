import test from "node:test"
import assert from "node:assert/strict"
import { applyFeedback, amendErrorDetails, correctLastFeedback, DEFAULT_FSRS_OPTIONS, importProgress, previewFeedback, validateOptions } from "../src/fsrs-domain"
import { createFsrsStore } from "../src/fsrs-store"
import { createMistakeRecord, reviewMistake } from "../src/mistake-domain"

const now = new Date("2026-10-19T08:00:00Z")
const options = { ...DEFAULT_FSRS_OPTIONS, fuzz: false }
const source = () => createMistakeRecord({ sourceNoteId: "note", sourceNotebookId: "book", sourceNotebookTitle: "书", sourceTitle: "题", sourcePathTitles: [], level: 2 }, now)

test("旧等级和到期日仅作迁入参考，不伪造历史或 FSRS 记忆状态", () => {
  const old = source(), before = JSON.stringify(old)
  const progress = importProgress(old, now)
  assert.equal(progress.initialDue, old.nextReviewAt)
  assert.equal(progress.legacyLevel, 2)
  assert.equal(progress.card, undefined)
  assert.deepEqual(progress.history, [])
  assert.equal(JSON.stringify(old), before)
  assert.equal(importProgress({ ...old, reviewCompleted: true }, now).paused, true)
})
test("四档真实评分建立记忆状态；Easy 不结束；天级调度预览与提交一致", () => {
  const initial = importProgress(source(), now)
  for (const rating of [1, 2, 3, 4] as const) {
    const preview = previewFeedback(initial, options, now).find(item => item.rating === rating)!
    const result = applyFeedback(initial, options, { id: `event-${rating}`, revision: 0, rating }, now)
    assert.equal(result.card!.due, preview.due)
    assert.ok(Date.parse(result.card!.due) >= now.getTime() + 86400000)
    assert.equal(result.card!.reps, 1)
    assert.equal(result.paused, false)
    assert.equal(result.history.length, 1)
    assert.ok(result.card!.stability > 0)
  }
})
test("两个算法交替推进，彼此的日期、计数、历史完全不变", () => {
  let fixed = source(), smart = importProgress(fixed, now)
  const originalFixed = JSON.stringify(fixed)
  smart = applyFeedback(smart, options, { id: "one", revision: 0, rating: 4 }, now)
  assert.equal(JSON.stringify(fixed), originalFixed)
  const originalSmart = JSON.stringify(smart)
  fixed = reviewMistake(fixed, 0, new Date("2026-10-25T08:00:00Z"))
  assert.equal(JSON.stringify(smart), originalSmart)
  const nextFixed = JSON.stringify(fixed)
  smart = applyFeedback(smart, options, { id: "two", revision: 1, rating: 1 }, new Date("2026-11-01T08:00:00Z"))
  assert.equal(JSON.stringify(fixed), nextFixed)
  assert.equal(smart.history.length, 2)
})
test("重复请求幂等、旧修订拒绝、暂停拒绝评分", () => {
  const p = importProgress(source(), now)
  const input = { id: "one", revision: 0, rating: 3 as const }
  const result = applyFeedback(p, options, input, now)
  assert.equal(applyFeedback(result, options, input, now), result)
  assert.throws(() => applyFeedback(result, options, { ...input, id: "two" }, now), /状态已变化/)
  assert.throws(() => applyFeedback({ ...p, paused: true }, options, input, now), /恢复/)
})
test("日期扰动按题目身份固定，同日稍后保存不改变预告间隔", () => {
  const p = importProgress(source(), now)
  const preview = previewFeedback(p, DEFAULT_FSRS_OPTIONS, now)
  for (const rating of [1, 2, 3, 4] as const) {
    const saved = applyFeedback(p, DEFAULT_FSRS_OPTIONS, { id: `fuzz-${rating}`, revision: 0, rating }, new Date(now.getTime() + 60000))
    assert.equal(saved.card!.scheduled_days, preview[rating - 1].days)
  }
})
test("修改错因不修改记忆状态、评分、日期与复习次数", () => {
  const p = applyFeedback(importProgress(source(), now), options, { id: "one", revision: 0, rating: 1 }, now)
  const amended = amendErrorDetails(p, "one", 1, ["formula", "formula", "calculation"], "符号错误")
  assert.deepEqual(amended.card, p.card)
  assert.equal(amended.history.length, 1)
  assert.equal(amended.history[0].rating, 1)
  assert.deepEqual(amended.history[0].errorReasons, ["formula", "calculation"])
  assert.equal(p.history[0].errorReasons, undefined)
})
test("调度参数验证；改参数不会重排已保存日期", () => {
  const p = applyFeedback(importProgress(source(), now), options, { id: "one", revision: 0, rating: 3 }, now)
  const before = JSON.stringify(p)
  previewFeedback(p, { ...options, retention: 0.95, maximumInterval: 3 }, new Date(p.card!.due))
  assert.equal(JSON.stringify(p), before)
  assert.throws(() => validateOptions({ ...options, retention: 1 }), /保持率/)
  assert.throws(() => validateOptions({ ...options, maximumInterval: 1.5 }), /间隔/)
})
test("存储创建无读写，保存读回失败不推进缓存，重启及独立备份恢复", () => {
  let value: unknown, backup: unknown, reads = 0, fail = false
  const storage = { read: () => { reads++; return value }, write: (v: string) => { if (!fail) value = v }, readBackup: () => backup, backup: (v: string) => { backup = v } }
  const store = createFsrsStore(storage)
  assert.equal(reads, 0)
  const initial = store.load()
  store.save({ ...initial, records: { "book:note": importProgress(source(), now) } })
  const before = store.load()
  fail = true
  assert.throws(() => store.save({ ...before, options: { ...options, retention: 0.95 } }), /未确认/)
  assert.equal(store.load(), before)
  fail = false
  assert.deepEqual(createFsrsStore(storage).load(), before)
  value = "corrupt"
  assert.deepEqual(createFsrsStore(storage).load(), before)
  backup = "also corrupt"
  assert.throws(() => createFsrsStore(storage).load(), /停止写入/)
})


test("末次反馈更正按原时间重算，不增加次数且保留暂停和错因", () => {
  const initial = importProgress(source(), now)
  const first = applyFeedback(initial, options, { id: "first", revision: 0, rating: 1, errorReasons: ["formula"] }, now)
  const corrected = correctLastFeedback({ ...first, paused: true }, "first", 1, 3)
  const expected = applyFeedback(initial, options, { id: "first", revision: 0, rating: 3 }, now)
  assert.deepEqual(corrected.card, expected.card)
  assert.equal(corrected.history.length, 1)
  assert.equal(corrected.history[0].at, now.toISOString())
  assert.deepEqual(corrected.history[0].errorReasons, ["formula"])
  assert.equal(corrected.paused, true)
  assert.equal(corrected.revision, 2)
  assert.throws(() => correctLastFeedback(corrected, "first", 1, 2), /刷新/)
  assert.throws(() => correctLastFeedback(corrected, "older", 2, 2), /最后/)
})
