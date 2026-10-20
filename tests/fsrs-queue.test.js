import test from 'node:test'
import assert from 'node:assert/strict'
import { fsrsQueueRecord } from '../web/src/lib/fsrsQueue.js'

test('智能队列投影不修改原记录，使用独立日期、次数和暂停状态', () => {
  const source = { recordId: 'a', level: 2, reviewCount: 9, reviewCompleted: true, history: [{ at: 'old' }], nextReviewAt: 'old-date', categoryLabel: '数学' }
  const original = JSON.stringify(source)
  const smart = { recordId: 'a', nextReviewAt: '2026-10-20', historyCount: 2, tags: ['积分'], progress: { revision: 3, paused: false, history: [{ rating: 3 }] } }
  const row = fsrsQueueRecord(smart, source)
  assert.equal(JSON.stringify(source), original)
  assert.equal(row.nextReviewAt, '2026-10-20')
  assert.equal(row.level, 2)
  assert.equal(row.reviewCount, 2)
  assert.equal(row.reviewCompleted, false)
  assert.deepEqual(row.history, [])
  assert.equal(row.categoryLabel, '数学')
  assert.deepEqual(row.manualCategories, ['积分'])
})

test('迁入题保持待反馈，不能把旧等级显示为新反馈', () => {
  const row = fsrsQueueRecord({ recordId: 'b', historyCount: 0, tags: [], progress: { revision: 0, paused: true, history: [] } }, { level: 2 })
  assert.equal(row.level, -1)
  assert.equal(row.reviewCompleted, true)
})
