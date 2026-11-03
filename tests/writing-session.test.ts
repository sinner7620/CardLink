import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'
import { transpileModule } from 'typescript'

function fixture() {
  const calls: any[] = [], options: any = {}
  let currentRunId: string | null = null, question = 'q', plan: any = { revision: 1, questions: [] }
  let guides = 0
  const api = async (path: string, request?: any): Promise<any> => {
    const b = request?.body || {}
    calls.push({ path, body: b })
    if (path === '/capabilities') return { routes: [{ method: 'GET', path: '/writing/capabilities' }] }
    if (path === '/writing/capabilities') return {
      carriers: ['focus'], practiceSessionRecord: { canCreate: true, ready: !options.unavailable, canSwitch: true },
      managedLayerTrial: { ready: true, canSwitch: true, createsAttempt: false }, pencilCommit: { submit: '/writing/pencil-commit' }, practicePlan: { save: '/writing/plan-save' }
    }
    if (path === '/writing/context') return { window: { topicid: options.wrongTopic ? 'foreign' : 'book' }, surfaces: [{
      kind: 'focus', surfaceId: 'surface', state: { loadedBinding: { topicid: 'book', noteid: options.wrongQuestion ? 'foreign' : question },
        rootCanvasOwnerMatches: true, activeLayerId: options.defaultLayer ? '' : 'owned-layer' }
    }] }
    if (path === '/writing/session-read') return { currentRunId, runs: currentRunId ? [{ runId: currentRunId }] : [] }
    if (path === '/writing/plan-read') return { plan }
    if (path === '/writing/plan-save') {
      plan = { revision: 2, questions: b.questions, lastRequestId: b.requestId }
      if (options.planLost) { options.planLost = false; throw new Error('plan reply lost') }
      return { persisted: true, plan }
    }
    if (path === '/writing/session-create') { currentRunId = 'run-' + b.requestId; return { runId: currentRunId, settled: !options.recordAccepted, persisted: true } }
    if (path === '/writing/session-reserve') return { attemptId: 'attempt-' + b.requestId, settled: !options.recordAccepted, persisted: true }
    if (path === '/writing/session-focus-begin') {
      question = b.questionId
      if (options.beginLost) { options.beginLost = false; throw new Error('network lost after accepted') }
      return { settled: true, ready: true }
    }
    if (path === '/writing/transition-result') return { settled: true, ready: true }
    if (path === '/writing/pencil-commit') return { settled: false }
    if (path === '/writing/pencil-result') return { settled: true, persistedSnapshotVerified: true, snapshotCurrent: !options.stale, canSwitch: !options.cannotSwitch, layerLeaseUnresolved: !!options.unresolved }
    if (path === '/writing/session-exit') return { settled: true, persisted: true, canSwitch: !options.exitBlocked }
    if (path === '/writing/session-finish') { currentRunId = null; return { settled: !options.recordAccepted, persisted: true } }
    throw Error('unexpected ' + path)
  }
  const scope: any = { exports: {}, crypto: { randomUUID }, setTimeout }
  runInNewContext(transpileModule(readFileSync('web/src/lib/writingSession.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const client = scope.exports.createWritingSessionClient(api, async () => { guides++ }, () => {}, async () => {})
  const target = { noteid: 'q', topicid: 'book', reviewToken: 'token' }
  return { client, calls, options, target, guides: () => guides }
}

test('新模式读取设备能力与指南，分配独立尝试，保存快照后退出再进入另一题', async () => {
  const f = fixture()
  assert.equal((await f.client.open(f.target)).editorOpened, true)
  assert.equal(f.guides(), 1)
  assert.equal(f.calls.some(c => c.path.includes('annotation-editor')), false)
  const closed = await f.client.complete(f.target)
  assert.equal(closed.event.saved, true)
  assert.equal(closed.event.commentId, undefined)
  const save = f.calls.find(c => c.path === '/writing/pencil-commit')
  assert.equal(save.body.target.layerId, 'owned-layer')
  assert.ok(f.calls.findIndex(c => c.path === '/writing/pencil-result') < f.calls.findIndex(c => c.path === '/writing/session-exit'))
  await f.client.open({ ...f.target, noteid: 'other', reviewToken: 'token2' })
  assert.equal(f.calls.filter(c => c.path === '/writing/session-create').length, 2)
  assert.equal(f.calls.filter(c => c.path === '/writing/session-finish').length, 1)
  assert.notEqual(f.calls.filter(c => c.path === '/writing/session-reserve')[0].body.requestId, f.calls.filter(c => c.path === '/writing/session-reserve')[1].body.requestId)
})

test('能力未开放时只读检查，不创建计划、会话或批注', async () => {
  const f = fixture(); f.options.unavailable = true
  assert.equal((await f.client.capabilities()).available, false)
  await assert.rejects(f.client.open(f.target), /尚未开放/)
  assert.equal(f.calls.some(c => c.body.confirm === true), false)
})

test('跨学习集、错误画布和默认层都不能保存或退出专用层尝试', async () => {
  for (const error of ['wrongTopic', 'wrongQuestion', 'defaultLayer']) {
    const f = fixture(); await f.client.open(f.target); f.options[error] = true
    await assert.rejects(f.client.complete(f.target), /学习集|不匹配/)
    assert.equal(f.calls.some(c => c.path === '/writing/pencil-commit'), false)
    assert.equal(f.calls.some(c => c.path === '/writing/session-exit'), false)
  }
})

test('已受理、旧快照、不可切题和租约未定都不伪装已保存', async () => {
  for (const error of ['stale', 'cannotSwitch', 'unresolved']) {
    const f = fixture(); await f.client.open(f.target); f.options[error] = true
    await assert.rejects(f.client.complete(f.target), /未确认/)
    assert.equal(f.calls.some(c => c.path === '/writing/session-exit'), false)
    await assert.rejects(f.client.finish(), /先保存/)
  }
})

test('新建返回丢失后重试只查询相同请求，不重复建立尝试或手写层', async () => {
  const f = fixture(); f.options.beginLost = true
  await assert.rejects(f.client.open(f.target), /network lost/)
  assert.equal(f.client.mayBeOpen(f.target.reviewToken), true)
  const original = f.calls.find(c => c.path === '/writing/session-focus-begin').body.requestId
  assert.equal((await f.client.open(f.target)).editorOpened, true)
  assert.equal(f.calls.filter(c => c.path === '/writing/session-focus-begin').length, 1)
  assert.equal(f.calls.filter(c => c.path === '/writing/session-reserve').length, 1)
  const queries = f.calls.filter(c => c.path === '/writing/transition-result')
  assert.equal(queries[queries.length - 1].body.requestId, original)
})

test('保存成功但退出不获准时不结束会话，重复保存保持请求身份', async () => {
  const f = fixture(); await f.client.open(f.target); f.options.exitBlocked = true
  await assert.rejects(f.client.complete(f.target), /未确认退出/)
  await assert.rejects(f.client.finish(), /先保存/)
  assert.equal(f.calls.filter(c => c.path === '/writing/pencil-commit').length, 1)
})

test('准备清单响应丢失后用读回身份确认，不查询不存在的转场或重写计划', async () => {
  const f = fixture(); f.options.planLost = true
  await assert.rejects(f.client.open(f.target), /plan reply lost/)
  assert.equal((await f.client.open(f.target)).editorOpened, true)
  assert.equal(f.calls.filter(c => c.path === '/writing/plan-save').length, 1)
  assert.equal(f.calls.filter(c => c.path === '/writing/transition-result').length, 0)
})

test('仅写记录的创建与结束用会话读回确认，不把受理状态当画布已保存', async () => {
  const f = fixture(); f.options.recordAccepted = true
  await f.client.open(f.target)
  await f.client.complete(f.target)
  assert.equal((await f.client.finish()).finished, true)
  assert.equal(f.calls.filter(c => c.path === '/writing/transition-result').length, 0)
  assert.ok(f.calls.some(c => c.path === '/writing/pencil-result'))
})
