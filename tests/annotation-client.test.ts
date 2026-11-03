import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function client(api: (path: string, options?: any) => Promise<any>) {
  const scope: any = { setTimeout, clearTimeout }
  runInNewContext(readFileSync("web/annotation-client.js", "utf8"), scope)
  return scope.createCardLinkAnnotationClient({ api })
}

test('下一题预读复用版本，实际打开只写一次；comments 失效后重新读取', async () => {
  const calls: string[] = []
  const c = client(async (path, options) => {
    calls.push((options ? 'POST ' : 'GET ') + path)
    return options ? { editorOpened: true } : { revision: 'r1', comments: [] }
  })
  await c.prefetch('q2')
  await c.prefetch('q2')
  assert.equal(calls.length, 1)
  let checked = 0
  await c.open('q2', async () => { checked++ }, { advance: 'next', topicid: 'book' })
  assert.deepEqual(calls.map(v => v.split(' ')[0]), ['GET', 'POST'])
  assert.equal(checked, 1)
  await c.prefetch('q3')
  c.invalidate('Q3')
  await c.open('q3', null, { advance: 'next', topicid: 'book' })
  assert.equal(calls.filter(v => v === 'GET /notes/q3/comments').length, 2)
})

test('只有缓存版本明确冲突才刷新重试，未知打开错误绝不自动重开', async () => {
  for (const failure of ['COMMENT_CHANGED', 'NETWORK_UNKNOWN']) {
    let reads = 0, writes = 0, checks = 0
    const c = client(async (_path, options) => {
      if (!options) return { revision: `r${++reads}` }
      writes++
      if (writes === 1) {
        if (failure === 'NETWORK_UNKNOWN') throw new Error('network uncertain')
        return { error: { code: failure } }
      }
      assert.equal(options.body.expectedRevision, 'r2')
      return { editorOpened: true }
    })
    await c.prefetch('q')
    const opening = c.open('q', async () => { checks++ }, { advance: 'next', topicid: 'book' })
    if (failure === 'COMMENT_CHANGED') {
      await opening
      assert.equal(writes, 2); assert.equal(reads, 2); assert.equal(checks, 2)
    } else {
      await assert.rejects(opening, /network uncertain/)
      assert.equal(writes, 1); assert.equal(reads, 1)
    }
  }
})

test('预读期间的评论更新禁止旧版本重新进入缓存', async () => {
  let finish: any, reads = 0
  const c = client(async (_path, options) => {
    if (options) { assert.equal(options.body.expectedRevision, 'fresh'); return { editorOpened: true } }
    if (++reads === 1) return new Promise(resolve => { finish = resolve })
    return { revision: 'fresh' }
  })
  const prefetch = c.prefetch('q')
  c.invalidate('q')
  finish({ revision: 'old' }); await prefetch
  await c.open('q', null, { advance: 'next', topicid: 'book' })
  assert.equal(reads, 2)
})

test('缓存冲突后的写前检查失败不能留下编辑器已打开的假占用', async () => {
  let writes = 0, checks = 0
  const c = client(async (_path, options) => {
    if (!options) return { revision: 'r' }
    writes++
    return { error: { code: 'COMMENT_CHANGED' } }
  })
  await c.prefetch('q')
  await assert.rejects(c.open('q', async () => { if (++checks === 2) throw new Error('scene left') }, { advance: 'next', topicid: 'book' }),
    (error: any) => error.message === 'scene left' && error.editorMayBeOpen === false)
  assert.equal(writes, 1)
})

test("直接批注按题卡ID读取新鲜版本，不传练习上下文，不把打开当成保存", async () => {
  const calls: any[] = []
  const c = client(async (path, options) => {
    calls.push({ path, options })
    return options ? { editorOpened: true, persisted: false } : { revision: "fresh", comments: [] }
  })
  const result = await c.open("question")
  assert.equal(result.persisted, false)
  assert.equal(calls[0].path, "/notes/question/comments")
  assert.equal(calls[1].path, "/notes/question/annotation-editor")
  assert.equal(calls[1].options.body.expectedRevision, "fresh")
  assert.equal("practice" in calls[1].options.body, false)
  assert.equal("commentId" in calls[1].options.body, false)
  assert.equal("addon" in calls[1].options.body, false)
})

test("直接新批注省略历史作答纸 ID，使用新鲜版本号", async () => {
  let body: any
  const c = client(async (_path, options) => {
    if (!options) return { revision: "new", comments: [{ commentId: "paper", type: "practice" }] }
    body = options.body
    return { editorOpened: true, continued: false }
  })
  await c.open("q")
  assert.equal("commentId" in body, false)
  assert.equal(body.confirm, true)
  assert.equal(body.expectedRevision, "new")
})

test("只有普通批注时仍由宿主打开作答编辑器，不自行判断历史纸张", async () => {
  let writes = 0
  const c = client(async (_path, options) => {
    if (options) writes++
    return options ? { editorOpened: true } : { revision: "r", comments: [{ commentId: "text", type: "text" }] }
  })
  await c.open("q")
  assert.equal(writes, 1)
})

test("缺少版本或题卡身份阻止打开，宿主拒绝不自动重试", async () => {
  const missing = client(async () => ({ comments: [] }))
  await assert.rejects(missing.open("q"), /版本/)
  await assert.rejects(missing.open(""), /题卡身份/)
  let writes = 0
  const refused = client(async (_path, options) => {
    if (!options) return { revision: "r" }
    writes++
    return { error: { code: "ANNOTATION_UNAVAILABLE", message: "编辑器占用" } }
  })
  await assert.rejects(refused.open("q"), /编辑器占用/)
  assert.equal(writes, 1)
})

test("宿主未确认打开不能显示成功", async () => {
  const c = client(async (_path, options) => options ? { persisted: false } : { revision: "r" })
  await assert.rejects(c.open("q"), /未确认/)
})

test("读取版本后离开场景，写前检查阻止打开编辑器", async () => {
  let writes = 0
  const c = client(async (_path, options) => {
    if (options) writes++
    return options ? { editorOpened: true } : { revision: "r" }
  })
  await assert.rejects(c.open("q", async () => { throw new Error("已离开场景") }), /已离开场景/)
  assert.equal(writes, 0)
})

test("批注复习传下一题或完成模式，回看时继续指定纸张；普通调用不受影响", async () => {
  const bodies: any[] = []
  const c = client(async (_path, options) => {
    if (!options) return { revision: "fresh" }
    if (options.body.advance && !options.body.practice?.topic) return { error: { code: 'INVALID_INPUT', message: 'advance only goes with practice' } }
    bodies.push(options.body)
    return { editorOpened: true, advance: options.body.advance }
  })
  await c.open("q", undefined, { advance: "next", topicid: "source-topic" })
  await c.open("q", undefined, { advance: "finish", topicid: "source-topic", commentId: "paper" })
  assert.equal(bodies[0].advance, "next")
  assert.equal(bodies[1].advance, "finish")
  assert.equal(bodies[1].commentId, "paper")
  assert.equal(bodies[1].expectedRevision, "fresh")
  assert.equal(bodies[0].practice.topic, "source-topic")
  assert.equal(bodies[1].practice.topic, "source-topic")
  assert.equal('addon' in bodies[0].practice, false)
})

test("连续批注缺少来源学习集时在读写前拒绝，不能猜当前学习集", async () => {
  let calls = 0
  const c = client(async () => { calls++; return { revision: 'r', editorOpened: true } })
  for (const topicid of [undefined, '', '  ']) {
    await assert.rejects(c.open('q', undefined, { advance: 'next', topicid }), /来源学习集/)
  }
  assert.equal(calls, 0)
})

test('新一轮强制省略旧 commentId，本轮继续可显式带回', async () => {
  const bodies: any[] = []
  const c = client(async (_path, options) => options ? (bodies.push(options.body), { editorOpened: true }) : { revision: 'r1' })
  await c.open('q', null, { advance: 'next', topicid: 'book', newAttempt: true, commentId: 'old' })
  await c.open('q', null, { advance: 'next', topicid: 'book', newAttempt: false, commentId: 'this-round' })
  assert.equal(bodies[0].commentId, undefined)
  assert.equal(bodies[1].commentId, 'this-round')
})

test('原生判定读取当前版本并绑定当前插件、本学习集作答纸及错因', async () => {
  const calls: any[] = []
  const c = client(async (path, options) => {
    calls.push({ path, body: options?.body })
    if (path === '/capabilities') return { routes: [{ method: 'POST', path: '/notes/{id}/practice-verdict' }] }
    if (path === '/immersive/template') return { plugins: [{ addon: 'marginnote.extension.mn4-answer-matcher', allowed: true, config: { tagPrefix: 'cardlink-practice', reasons: [{ key: 'concept', label: '概念不懂' }] } }] }
    if (path.endsWith('/comments')) return { revision: 'latest', comments: [{ commentId: 'paper', practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book' } }] }
    return { persisted: true, commentId: options.body.commentId, practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book', self: options.body.self, reason: options.body.reason } }
  })
  const config = await c.practiceConfig()
  assert.equal(config.available, true)
  assert.equal(config.reasons[0].key, 'concept')
  let verified = 0
  await c.verdict('q', { commentId: 'paper', topicid: 'book', self: 'again', reason: 'concept' }, async () => { verified++ })
  const body = calls[calls.length - 1].body
  assert.equal(body.expectedRevision, 'latest')
  assert.equal(body.practice.topic, 'book')
  assert.equal(body.self, 'again')
  assert.equal(body.reason, 'concept')
  assert.equal(verified, 1)
  await assert.rejects(c.verdict('q', { commentId: 'another-paper', topicid: 'book', self: 'got' }), /身份不匹配/)
  await c.verdict('q', { commentId: 'paper', topicid: 'book', self: 'got', reason: 'concept' })
  assert.equal(calls[calls.length - 1].body.reason, null)
})

test('无宿主能力或模板配置时返回不可用，供调用方跳过原生判定', async () => {
  assert.equal((await client(async () => ({ routes: [] })).practiceConfig()).available, false)
  assert.equal((await client(async path => path === '/capabilities' ? { routes: [{ method: 'POST', path: '/notes/{noteid}/practice-verdict' }] } : { plugins: [] }).practiceConfig()).available, false)
})


test('新建响应明确继续旧批注时报告宿主实际结果；不自动重试', async () => {
  for (const reply of [{ continued: true }, { commentId: 'old' }]) {
    let writes = 0
    const c = client(async (_path, options) => options ? (++writes, { editorOpened: true, ...reply }) : { revision: 'r', comments: [{ commentId: 'old' }] })
    await assert.rejects(c.open('q', null, { newAttempt: true }), (e: any) => e.code === 'OLD_PRACTICE_SHEET_OPENED' && e.editorMayBeOpen === true)
    assert.equal(writes, 1)
    await c.open('q', null, { commentId: 'old' })
    assert.equal(writes, 2)
  }
})

test('persisted 标志不能替代官方判定的批注身份和反馈状态', async () => {
  const c = client(async (_path, options) => options ? { persisted: true, commentId: 'wrong', practice: { self: 'got' } } :
    { revision: 'r', comments: [{ commentId: 'paper', practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book' } }] })
  await assert.rejects(c.verdict('q', { commentId: 'paper', topicid: 'book', self: 'got' }), /官方反馈状态/)
})

test('宿主复用同题原生练习批注时保留身份供继续反馈；异插件和异学习集不接受', async () => {
  for (const owner of [
    { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book' },
    { addon: 'other', topic: 'book' },
    { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'other' }
  ]) {
    let writes = 0
    const c = client(async (_path, options) => options
      ? (++writes, { editorOpened: true, continued: true, commentId: 'old', advance: 'next' })
      : { revision: 'r', comments: [{ commentId: 'old', practice: owner }] })
    const pending = c.open('q', null, { newAttempt: true, advance: 'next', topicid: 'book' })
    if (owner.addon.endsWith('mn4-answer-matcher') && owner.topic === 'book') {
      const result = await pending
      assert.equal(result.reusedExisting, true)
      assert.equal(result.commentId, 'old')
    } else await assert.rejects(pending, (e: any) => e.code === 'OLD_PRACTICE_SHEET_OPENED')
    assert.equal(writes, 1)
  }
})

test('宿主未确认所选错因时不能当作反馈保存成功', async () => {
  const owner = { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book' }
  const c = client(async (_path, options) => options
    ? { persisted: true, commentId: 'paper', practice: { ...owner, self: 'again', reason: null } }
    : { revision: 'r', comments: [{ commentId: 'paper', practice: owner }] })
  await assert.rejects(c.verdict('q', { commentId: 'paper', topicid: 'book', self: 'again', reason: 'reading' }), /官方反馈状态/)
})

test('批注诊断记录实际省略的 ID 和误开旧纸响应，不记录正文与图片', async () => {
  const entries: any[] = [], bodies: any[] = []
  const diagnostic = (event: string, data: any) => entries.push({ event, data })
  const c = client(async (_path, options) => {
    if (!options) return { revision: 'r1', comments: [{ commentId: 'old', text: 'PRIVATE_TEXT', image: 'PRIVATE_IMAGE',
      cardAnnotation: true, practice: { addon: 'mine', topic: 'book', self: null } }] }
    bodies.push(options.body)
    return { editorOpened: true, continued: true, commentId: 'old', bridgeApiVersion: '0.91' }
  })
  await assert.rejects(c.open('q', null, { newAttempt: true, commentId: 'old', diagnostic }), /旧批注/)
  const sent = entries.find(e => e.event === 'annotation.editor.request').data
  const reply = entries.find(e => e.event === 'annotation.editor.response').data
  assert.equal(sent.commentIdPresent, false)
  assert.equal(sent.commentId, null)
  assert.equal('commentId' in bodies[0], false)
  assert.equal(sent.expectedRevision, bodies[0].expectedRevision)
  assert.equal(reply.continued, true)
  assert.equal(reply.commentId, 'old')
  assert.equal(reply.knownCommentId, true)
  assert.equal(reply.bridgeApiVersion, '0.91')
  assert.equal(entries.find(e => e.event === 'annotation.comments.paper').data.practice.self, null)
  assert.ok(!JSON.stringify(entries).includes('PRIVATE_'))
})

test('版本冲突重试的诊断保留每次实际版本号；日志抛错不改变请求', async () => {
  let reads = 0, writes = 0
  const entries: any[] = []
  const c = client(async (_path, options) => {
    if (!options) return { revision: `r${++reads}`, comments: [] }
    if (++writes === 1) return { error: { code: 'COMMENT_CHANGED' } }
    return { editorOpened: true, continued: false }
  })
  await c.prefetch('q')
  await c.open('q', null, { advance: 'next', topicid: 'book', diagnostic: (event: string, data: any) => {
    entries.push({ event, data }); throw new Error('logger unavailable')
  } })
  assert.deepEqual(entries.filter(e => e.event === 'annotation.editor.request').map(e => [e.data.attempt, e.data.expectedRevision]), [[1, 'r1'], [2, 'r2']])
  assert.equal(entries.find(e => e.event === 'annotation.editor.error').data.code, 'COMMENT_CHANGED')
  assert.equal(writes, 2)
})

test('官方判定日志关联请求批注和前后状态，响应缺字段保留 null', async () => {
  const entries: any[] = []
  const c = client(async (_path, options) => !options
    ? { revision: 'before', comments: [{ commentId: 'paper', practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book', self: null } }] }
    : { persisted: true, commentId: 'paper', commentsRevision: 'after', practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book', self: 'again' } })
  await c.verdict('q', { commentId: 'paper', topicid: 'book', self: 'again', diagnostic: (event: string, data: any) => entries.push({ event, data }) })
  assert.equal(entries.find(e => e.event === 'annotation.comments.paper').data.practice.self, null)
  assert.equal(entries.find(e => e.event === 'annotation.verdict.request').data.expectedRevision, 'before')
  const reply = entries.find(e => e.event === 'annotation.verdict.response').data
  assert.equal(reply.practice.self, 'again')
  assert.equal(reply.commentsRevision, 'after')
  assert.equal(reply.source, 'host-response')
  assert.equal(reply.bridgeApiVersion, null)
})

test('普通作答强制省略 practice 和 advance，无需官方配置；继续时仅带指定 ID', async () => {
  const bodies: any[] = [], paths: string[] = []
  const c = client(async (path, options) => {
    paths.push(path)
    if (!options) return { revision: 'r', comments: [{ commentId: 'old', practice: { self: null } }] }
    bodies.push(options.body)
    return { editorOpened: true, continued: !!options.body.commentId }
  })
  await c.open('q', null, { ordinary: true, newAttempt: true, advance: 'next', topicid: 'book', commentId: 'old' })
  await c.open('q', null, { ordinary: true, newAttempt: false, advance: 'finish', topicid: 'book', commentId: 'old' })
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['confirm', 'expectedRevision'])
  assert.deepEqual(Object.keys(bodies[1]).sort(), ['commentId', 'confirm', 'expectedRevision'])
  assert.equal(bodies[1].commentId, 'old')
  assert.ok(!paths.some(p => p.includes('verdict') || p.includes('template') || p.includes('capabilities')))
})


test('丢弃只删除当前令牌下本次新增的原生批注，读回确认且不碰旧作答', async () => {
  const old = { commentId: 'old', index: 1, cardAnnotation: true, text: '历史', practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book', card: 'q' } }
  const fresh = { ...old, commentId: 'new', index: 2, text: '新笔迹' }
  let comments = [old], deleted = 0
  const c = client(async (path, options) => {
    if (!options) return { revision: 'r', comments }
    if (path.endsWith('/annotation-editor')) return { editorOpened: true }
    assert.equal(path, '/notes/q/comments/2/delete')
    assert.equal(options.body.expectedPrefix, '新笔迹')
    assert.equal(options.body.confirm, true)
    deleted++; comments = [old]
    return { action: 'delete' }
  })
  await c.open('q', null, { newAttempt: true, reviewToken: 'token', advance: 'next', topicid: 'book' })
  comments = [old, fresh]
  await assert.rejects(c.discardFresh('q', { reviewToken: 'stale', commentId: 'new' }), /未确认/)
  await assert.rejects(c.discardFresh('q', { reviewToken: 'token', commentId: 'old' }), /未确认/)
  assert.equal(deleted, 0)
  let verified = 0
  const result = await c.discardFresh('q', { reviewToken: 'token', commentId: 'new' }, async () => { verified++ })
  assert.equal(result.discarded, true)
  assert.equal(verified, 1)
  assert.equal(deleted, 1)
  assert.deepEqual(comments, [old])
  await assert.rejects(c.discardFresh('q', { reviewToken: 'token', commentId: 'new' }), /未确认/)
})

test('丢弃拒绝不匹配作答身份，删除失败或读回仍存在不能宣称丢弃', async () => {
  for (const failure of ['foreign', 'wrong-topic', 'wrong-card', 'delete-error', 'still-present']) {
    let comments: any[] = [], deletes = 0
    const paper = { commentId: 'new', index: 1, cardAnnotation: true, practice: {
      addon: failure === 'foreign' ? 'another-addon' : 'marginnote.extension.mn4-answer-matcher',
      topic: failure === 'wrong-topic' ? 'other' : 'book', card: failure === 'wrong-card' ? 'other-card' : 'q'
    } }
    const c = client(async (path, options) => {
      if (!options) return { revision: 'r', comments }
      if (path.endsWith('/annotation-editor')) return { editorOpened: true }
      deletes++
      if (failure === 'delete-error') throw new Error('host delete rejected')
      return { action: 'delete' }
    })
    await c.open('q', null, { newAttempt: true, reviewToken: 'token', advance: 'next', topicid: 'book' })
    comments = [paper]
    await assert.rejects(c.discardFresh('q', { reviewToken: 'token', commentId: 'new' }),
      /身份不匹配|host delete rejected|未确认新批注/)
    assert.equal(deletes, ['delete-error', 'still-present'].includes(failure) ? 1 : 0)
  }
})


test('缓存冲突刷新后的已有纸不能被误认本次新建并丢弃', async () => {
  let reads = 0, opens = 0
  const old = { commentId: 'appeared', index: 1, cardAnnotation: true, practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic: 'book', card: 'q' } }
  const c = client(async (_path, options) => {
    if (!options) return { revision: `r${++reads}`, comments: reads > 1 ? [old] : [] }
    opens++
    if (opens === 1) return { error: { code: 'COMMENT_CHANGED' } }
    return { editorOpened: true, continued: true, commentId: 'appeared' }
  })
  await c.prefetch('q')
  const result = await c.open('q', null, { advance: 'next', topicid: 'book', newAttempt: true, reviewToken: 'token' })
  assert.equal(result.reusedExisting, true)
  await assert.rejects(c.discardFresh('q', { reviewToken: 'token', commentId: 'appeared' }), /未确认/)
  assert.equal(opens, 2)
})
