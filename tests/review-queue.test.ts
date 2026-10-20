import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewedToday, reviewBreadcrumbs, inReviewBranch, groupedReviewRows } from '../src/review-queue'

test('按本地自然日判断完成，创建历史与非法日期不算复习', () => {
  const now = new Date(2026, 9, 18, 10)
  assert.equal(reviewedToday(new Date(2026, 9, 18, 0, 1).toISOString(), now), true)
  assert.equal(reviewedToday(new Date(2026, 9, 17, 23, 59).toISOString(), now), false)
  assert.equal(reviewedToday(undefined, now), false)
  assert.equal(reviewedToday('invalid', now), false)
})

test('来源层级按ID过滤，同名父节点和其他学习集不混入', () => {
  const current = { sourceNotebookId: 'book', sourceNotebookTitle: '学习集', sourceRootNodeId: 'root', sourceRootTitle: '脑图', sourceAncestors: [{ id: 'parent', title: '同名' }] }
  const crumbs = reviewBreadcrumbs(current)
  assert.deepEqual(crumbs.map(c => c.title), ['学习集', '脑图', '同名'])
  assert.equal(inReviewBranch(current, current, crumbs[2]), true)
  const other = { ...current, sourceAncestors: [{ id: 'other', title: '同名' }] }
  assert.equal(inReviewBranch(other, current, crumbs[2]), false)
  assert.equal(inReviewBranch(other, current, crumbs[1]), true)
  assert.equal(inReviewBranch({ ...current, sourceNotebookId: 'other' }, current, crumbs[0]), false)
  assert.equal(inReviewBranch({ ...current, sourceRootNodeId: 'other' }, current, crumbs[1]), false)
})


test('来源树按节点ID逐级分组，同名节点分开，导航索引保持原队列', () => {
  const base = { sourceNotebookId: 'b', sourceNotebookTitle: '学习集', sourceRootNodeId: 'r', sourceRootTitle: '脑图' }
  const a = { id: 'a', title: '第一章' }, b = { id: 'b', title: '同名节' }, c = { id: 'c', title: '同名节' }
  const items = [
    { ...base, sourceTitle: '第一题', sourceAncestors: [a, b] },
    { ...base, sourceTitle: '第二题', sourceAncestors: [a, c] },
    { ...base, sourceTitle: '第三题', sourceAncestors: [a, b] },
    { ...base, sourceTitle: '直接题', sourceAncestors: [] },
    { ...base, sourceNotebookId: 'other', sourceTitle: '不应出现' }
  ]
  const rows = groupedReviewRows(items, items[0], {kind:'map', id:'r'})
  assert.deepEqual(rows.map(r => r.title), ['4. 直接题', '第一章', '同名节', '1. 第一题', '3. 第三题', '同名节', '2. 第二题'])
  assert.deepEqual(rows.filter(r => r.kind === 'question').map(r => r.index), [3,0,2,1])
  assert.deepEqual(rows.filter(r => r.kind === 'heading').map(r => r.depth), [0,1,1])
  const subtree = groupedReviewRows(items, items[0], {kind:'parent', id:'b'})
  assert.deepEqual(subtree.map(r => r.index), [0,2])
})
