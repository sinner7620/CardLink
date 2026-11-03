import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
import { withMistakeReason, reviewMistake, createMistakeRecord } from '../src/mistake-domain'

test('错因选择支持模板词汇、跳过、取消；非错误等级不弹窗', async () => {
  const prompts: any[] = []; let index = 0
  const scope: any = { exports: {}, require: () => ({ select: async (...args: any[]) => { prompts.push(args); return { index } } }) }
  runInNewContext(transpileModule(readFileSync('src/error-reasons.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const custom = [{ key: 'custom', label: '模板自定义' }]
  assert.equal((await scope.exports.chooseErrorReason(0, custom)).reason.key, 'custom')
  assert.equal(prompts[0][0][0], '模板自定义')
  index = 1; assert.equal((await scope.exports.chooseErrorReason(1, custom)).reason, undefined)
  index = -1; assert.equal((await scope.exports.chooseErrorReason(0, custom)).cancelled, true)
  await scope.exports.chooseErrorReason(2, custom)
  await scope.exports.chooseErrorReason(3, custom)
  assert.equal(prompts.length, 3)
})

test('错因只写本次历史，不改变调度或覆盖旧错因；无选择保持旧数据结构', () => {
  const record = createMistakeRecord({ sourceNotebookId: 'book', sourceNoteId: 'q', sourceNotebookTitle: 'book', sourceTitle: 'q', sourcePathTitles: [], level: 0 })
  const initial = withMistakeReason(record, { key: 'reading', label: '审题遗漏' })
  assert.equal(record.history[0].errorReason, undefined)
  const next = reviewMistake(initial, 1)
  const saved = withMistakeReason(next, { key: 'calculation', label: '计算失误' })
  assert.equal(saved.history[0].errorReason?.key, 'reading')
  assert.equal(saved.history[1].errorReason?.key, 'calculation')
  assert.equal(saved.nextReviewAt, next.nextReviewAt)
  assert.equal(withMistakeReason(next), next)
})
