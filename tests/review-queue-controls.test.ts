import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore browser JS helpers are also exercised without the UI
import { buildReviewFilterTree, canExpandReviewNode, toggleReviewSelection, sortReviewRecords, reviewSourcePath, chooseReviewSources, chooseReviewLevels } from '../web/src/lib/reviewQueueControls.js'

const record = (recordId: string, extra = {}) => ({ recordId, sourceNotebookId: 'book', sourceNotebookTitle: '学习集', sourceRootNodeId: 'root', sourceRootTitle: '脑图', sourcePathTitles: ['脑图', '章节', '小节'], sourceTitle: recordId, ...extra })

test('来源树隔离同名学习集与脑图，展开停止于题目父层，手动分类不影响来源', () => {
  const tree = buildReviewFilterTree([record('a'), record('b', { sourceRootNodeId: 'root2', manualCategory: '标签' }), record('c', { sourceNotebookId: 'book2' })])
  assert.equal(tree.length, 2)
  assert.equal(tree[0].children.length, 2)
  assert.deepEqual(tree[0].children[0].recordIds, ['a'])
  const chapter = tree[0].children[0].children[0]
  assert.equal(canExpandReviewNode(chapter), true)
  assert.equal(canExpandReviewNode(chapter.children[0]), false)
  assert.equal(chapter.children[0].children[0].title, 'a')
})

test('整组切换：部分选中变全选，全选变清空，并保留其他组', () => {
  const selected = new Set(['a', 'c'])
  const full = toggleReviewSelection(selected, ['a', 'b'])
  assert.deepEqual([...full], ['a', 'c', 'b'])
  assert.deepEqual([...toggleReviewSelection(full, ['a', 'b'])], ['c'])
  assert.deepEqual([...selected], ['a', 'c'])
})

test('来源路径复用既有根到父层规范化，不重复根节点或题目标题', () => {
  assert.deepEqual(reviewSourcePath(record('题目', { sourcePathTitles: ['小节', '章节', '脑图'] })), ['学习集', '脑图', '章节', '小节'])
  assert.deepEqual(reviewSourcePath(record('题目', { sourcePathTitles: ['脑图', '章节', '题目'] })), ['学习集', '脑图', '章节'])
})

test('五种排序方向、缺失复习时间和同值稳定性，不改变输入', () => {
  const records = [record('a', { lastReviewedAt: '2026-10-01', createdAt: '2026-09-03', nextReviewAt: '2026-11-01', level: 2, sourceNotebookTitle: 'B' }), record('b', { lastReviewedAt: '2026-10-03', createdAt: '2026-09-01', nextReviewAt: '2026-10-01', level: 0, sourceNotebookTitle: 'A' }), record('c', { createdAt: '2026-09-02', nextReviewAt: '2026-10-20', level: 0, sourceNotebookTitle: 'A' })]
  const ids = (order: string) => sortReviewRecords(records, order).map((r: any) => r.recordId)
  assert.deepEqual(ids('reviewed'), ['b', 'a', 'c'])
  assert.deepEqual(ids('added'), ['a', 'c', 'b'])
  assert.deepEqual(ids('remaining'), ['b', 'c', 'a'])
  assert.deepEqual(ids('level'), ['b', 'c', 'a'])
  assert.deepEqual(ids('map'), ['b', 'c', 'a'])
  assert.deepEqual(records.map(r => r.recordId), ['a', 'b', 'c'])
})


test('默认全选不冒充手动选择，第一次点击只选该来源或等级', () => {
  const chosen = chooseReviewSources(null, ['a', 'b'])
  assert.deepEqual([...chosen], ['a', 'b'])
  assert.deepEqual([...chooseReviewSources(chosen, ['c'])], ['a', 'b', 'c'])
  assert.deepEqual([...chooseReviewSources(chosen, ['a', 'b'])], [])
  assert.deepEqual(chooseReviewLevels(null, 1), [1])
  assert.deepEqual(chooseReviewLevels([1], 2), [1, 2])
  assert.deepEqual(chooseReviewLevels([1], 1), [])
})
