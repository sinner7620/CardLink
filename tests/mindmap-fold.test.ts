import assert from "node:assert/strict"
import test from "node:test"
import { createFoldHost, loadMindmapFold, subcardBinding } from "./mindmap-fold-fixture"

function host(extra: Record<string, any> = {}) {
  return createFoldHost({
    notes: { question: { children: ["answer"], folded: false }, answer: {} },
    rendered: ["question", "answer"],
    ...extra
  })
}

test("模型节点列表不是画面证据：字段收起后模型仍保留子卡也只算 applied", () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  assert.equal(fold.readBranchFolded("question"), false)
  h.setFolded("question", true)
  assert.equal(fold.readBranchFolded("question"), true)
  // 设备日志场景：模型列表仍列出答案 ID，但没有任何视图证据。
  assert.equal(h.rendered.includes("answer"), true)
  const noEvidence = fold.foldVisibility("question")
  assert.equal(noEvidence.visibleAnswers, 0)
  assert.equal(noEvidence.source, "none")
  assert.equal(fold.foldConfirmation("question", true).state, "applied", "字段收起但无画面证据只能是 applied")
  assert.notEqual(fold.foldConfirmation("question", true).state, "confirmed", "不能凭模型列表宣称已确认")
  // 有子卡真实视图附着：证明答案仍画在画面上。
  h.select("answer")
  const visible = fold.foldVisibility("question")
  assert.equal(visible.visibleAnswers, 1)
  assert.equal(visible.source, "selection-view")
  assert.equal(fold.foldConfirmation("question", true).state, "contradicted")
  // 选中记录存在但视图未附着：不算可见（弱证据只进诊断）。
  h.select("answer", false)
  const detached = fold.foldVisibility("question")
  assert.equal(detached.visibleAnswers, 0)
  assert.equal(detached.detachedSelections, 1)
  assert.equal(fold.foldConfirmation("question", true).state, "applied")
  h.unselect("answer")
  delete h.notes.question.mindmapBranchClose
  assert.equal(fold.readBranchFolded("question"), undefined)
  assert.equal(fold.foldConfirmation("question", true).state, "unknown")
})

test("展开方向只有看见子卡真实视图才确认；诊断串带证据来源与画布状态", () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  assert.equal(fold.foldConfirmation("question", false).state, "unknown", "只有字段展开不算看到答案")
  h.select("answer")
  assert.equal(fold.foldConfirmation("question", false).state, "confirmed")
  const described = fold.describeVisibility(fold.foldVisibility("question"))
  assert.match(described, /folded=false/)
  assert.match(described, /visible=1\/1/)
  assert.match(described, /source=selection-view/)
  assert.match(described, /canvas=ready/)
})

test("折叠优先要求当前题的直接子卡确实承载答案", () => {
  const run = (options: any) => {
    const h = host(options.host)
    const fold = loadMindmapFold(h, { binding: options.binding ?? subcardBinding(), answerIds: options.answerIds })
    return fold.foldEligibility("book", "question", undefined)
  }
  const eligible = run({})
  assert.equal(eligible.eligible, true)
  assert.equal(eligible.capability, true)
  assert.match(String(run({ binding: { notebookId: "book", designatedAnswer: "mindmap" } }).reason), /不在直接子卡/)
  assert.match(String(run({ host: { notes: { question: { folded: false } } } }).reason), /没有直接子卡片答案/)
  assert.match(String(run({ host: { notes: { question: { children: ["answer"], folded: false }, answer: { notebookId: "other" } } } }).reason), /不属于当前学习集/)
  assert.match(String(run({ host: { notes: { question: { children: ["answer"] } } } }).reason), /无法读取当前题目的分支状态/)
  const unknown = run({ host: { notes: { question: { children: ["answer"] } } } })
  assert.equal(unknown.capability, true, "读不到字段属于宿主能力问题")
  const mixed = { notebookId: "book", designatedAnswer: "subcard", selectionMode: "mixed", questionColors: [0] }
  assert.match(String(run({ binding: mixed }).reason), /答案索引未就绪/)
  assert.match(String(run({ binding: mixed, answerIds: new Set(["other"]) }).reason), /混有非答案卡片/)
  assert.equal(run({ binding: mixed, answerIds: new Set(["answer"]) }).eligible, true)
  // 纯答案脑图绑定：本题没有直接子卡答案
  assert.equal(run({ binding: { notebookId: "book", designatedAnswer: "mindmap" }, answerIds: new Set(["answer"]) }).eligible, false)
})

test("答案子卡下还有下层卡片时保守回退，不遍历整棵分支", () => {
  const h = host({
    notes: { question: { children: ["answer"], folded: false }, answer: { children: ["detail"] }, detail: {} }
  })
  const fold = loadMindmapFold(h, { binding: subcardBinding() })
  const verdict = fold.foldEligibility("book", "question", undefined)
  assert.equal(verdict.eligible, false)
  assert.match(String(verdict.reason), /下层卡片/)
})

test("下级卡片存在时即使只有一层也回退；无下层时仍可折叠", () => {
  const flat = host()
  assert.equal(loadMindmapFold(flat, { binding: subcardBinding() }).foldEligibility("book", "question").eligible, true)
  const nested = host({ notes: { question: { children: ["answer"], folded: false }, answer: { children: ["detail"] }, detail: {} } })
  assert.equal(loadMindmapFold(nested, { binding: subcardBinding() }).foldEligibility("book", "question").eligible, false)
})

test("目标状态已满足时跳过写入，写入后按读回确认而不是回执回显", async () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  const outcome = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(outcome.status, "applied")
  assert.equal(h.notes.question.mindmapBranchClose, 1)
  assert.deepEqual(h.calls.map(call => [call.noteid, call.folded]), [["question", true]])
  const again = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(again.status, "unchanged")
  assert.equal(h.calls.length, 1, "已满足目标状态时不占用撤销栈")
})

test("回执称已写入但读回未变时保持未确认", async () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  h.behaviour.apply = false
  const outcome = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(outcome.status, "unverified")
  assert.equal(outcome.wrote, true)
  assert.equal(h.notes.question.mindmapBranchClose, 0)
})

test("回执身份、跳过与错误分别处理，写入不因错误回执当作已生效", async () => {
  const cases: Array<[Record<string, any>, string, RegExp, boolean]> = [
    [{ topicid: "other-book" }, "error", /其它学习集/, true],
    [{ sceneToken: "stale-token" }, "error", /场景面板会话已变化/, true],
    [{ skipped: "no_children" }, "skipped", /no_children/, false],
    [{ error: "分支折叠请求超时" }, "error", /超时/, false]
  ]
  for (const [behaviour, status, pattern, wrote] of cases) {
    const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
    Object.assign(h.behaviour, behaviour)
    const outcome = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
    assert.equal(outcome.status, status, JSON.stringify(behaviour))
    assert.match(String(outcome.error || outcome.skippedReason), pattern)
    assert.equal(outcome.wrote, wrote, "区分尚未写入和结果未知")
  }
})

test("切到别的学习集或访问代次已结束时不下发写入", async () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  const stale = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true, isCurrent: () => false })
  assert.equal(stale.status, "skipped")
  assert.equal(h.calls.length, 0)
  h.notebookId = "other"
  const moved = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(moved.status, "error")
  assert.match(moved.error!, /已切换学习集/)
  assert.equal(h.calls.length, 0)
})

test("区分已派发但结果未知和确定未派发的错误", async () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  h.behaviour.rejectDispatched = true
  const outcome = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(outcome.status, "error")
  assert.equal(outcome.wrote, true, "已派发的结果未知不能当作没写")
  assert.match(outcome.error!, /超时/)
  // 未派发（场景不可用）仍然算没写
  const offline = host({ available: false })
  const undelivered = await loadMindmapFold(offline, { binding: subcardBinding() })
    .writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(undelivered.wrote, false)
  assert.equal(offline.calls.length, 0)
})

test("读回期间切换学习集或访问代次结束时不算确认", async () => {
  const switched = host(), foldA = loadMindmapFold(switched, { binding: subcardBinding() })
  // 写入已派发后切走学习集
  switched.behaviour.beforeWrite = () => { switched.notebookId = "other" }
  const moved = await foldA.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(moved.wrote, true)
  assert.equal(moved.status, "unverified")
  assert.match(String(moved.error), /学习集/)

  const stale = host(), foldB = loadMindmapFold(stale, { binding: subcardBinding() })
  let checks = 0
  const aborted = await foldB.writeBranchFolded({
    owner: {}, notebookId: "book", noteId: "question", folded: true,
    isCurrent: () => checks++ < 1
  })
  assert.equal(aborted.wrote, true)
  assert.equal(aborted.status, "unverified")
  assert.match(String(aborted.error), /本次访问已结束/)
})

test("折叠与展开共用串行队列，迟到的结果不交叉", async () => {
  const h = host(), fold = loadMindmapFold(h, { binding: subcardBinding() })
  const first = fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  const second = fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: false })
  assert.equal((await first).status, "applied")
  // 展开方向没有子卡视图证据时不宣称已看到答案。
  assert.equal((await second).status, "unverified")
  assert.deepEqual(h.calls.map(call => call.folded), [true, false])
  assert.equal(h.notes.question.mindmapBranchClose, 0)
})

test("没有授权场景会话时不提供折叠写入", async () => {
  const h = host({ available: false }), fold = loadMindmapFold(h, { binding: subcardBinding() })
  assert.equal(fold.foldSceneSession({}).available, false)
  assert.match(fold.foldSceneSession({}).reason!, /未授权|未就绪/)
  const outcome = await fold.writeBranchFolded({ owner: {}, notebookId: "book", noteId: "question", folded: true })
  assert.equal(outcome.status, "error")
  assert.equal(outcome.wrote, false)
  assert.equal(h.calls.length, 0)
})
