import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { CardLinkError } from "../src/errors"
import { isAnswerIndexError, promptAnswerIndexRecovery } from "../src/answer-index-recovery"

test("两类索引错误都进入恢复弹窗，其他已有码错误不按关键词误分类", () => {
  assert.equal(isAnswerIndexError(new CardLinkError("indexNotReady")), true)
  assert.equal(isAnswerIndexError({ code: "indexNotReady", message: "indexNotReady" }), true)
  assert.equal(isAnswerIndexError(new Error("答案索引读取失败")), true)
  assert.equal(isAnswerIndexError({ message: "答案索引尚未建立或已过期，请先在设置中刷新答案索引" }), true)
  assert.equal(isAnswerIndexError(new CardLinkError("network", { detail: "索引服务不可用" })), false)
  assert.equal(isAnswerIndexError(new Error("目标卡片不存在")), false)
})

test("弹窗包含绑定脑图和有效刷新时间，刷新仅在明确选择后执行", async () => {
  const order: string[] = []
  const updatedAt = "2026-10-19T03:00:00.000Z"
  const result = await promptAnswerIndexRecovery({ bindingName: "高数答案 › 第一章", updatedAt }, {
    choose: async options => {
      assert.equal(options.title, "答案索引需要处理")
      assert.match(options.message, /当前绑定的答案脑图：高数答案 › 第一章/)
      assert.ok(options.message.includes(new Date(updatedAt).toLocaleString("zh-CN", { hour12: false })))
      assert.deepEqual(options.buttons, ["刷新索引", "换绑"])
      assert.equal(options.canCancel, true)
      order.push("choose"); return { buttonIndex: 0 }
    },
    refresh: async () => { order.push("refresh") },
    rebind: async () => { assert.fail("刷新时不能换绑") }
  })
  assert.equal(result, "refreshed")
  assert.deepEqual(order, ["choose", "refresh"])
})

test("取消不读写索引或绑定；未知或无效日期显示暂无刷新记录", async () => {
  for (const updatedAt of [undefined, "invalid-date"]) {
    const result = await promptAnswerIndexRecovery({ bindingName: "答案学习集", updatedAt }, {
      choose: async options => { assert.match(options.message, /上次刷新时间：暂无刷新记录/); return { buttonIndex: -1 } },
      refresh: async () => assert.fail("取消不能刷新"),
      rebind: async () => assert.fail("取消不能换绑")
    })
    assert.equal(result, "cancelled")
  }
})

test("换绑仅启动选择流程，刷新失败不伪装成功", async () => {
  let rebindings = 0
  assert.equal(await promptAnswerIndexRecovery({ bindingName: "答案脑图" }, {
    choose: async () => ({ buttonIndex: 1 }),
    refresh: async () => assert.fail("换绑前不能自行刷新"),
    rebind: async () => { rebindings++ }
  }), "rebound")
  assert.equal(rebindings, 1)
  await assert.rejects(promptAnswerIndexRecovery({ bindingName: "答案脑图" }, {
    choose: async () => ({ buttonIndex: 0 }),
    refresh: async () => { throw new Error("写入失败") },
    rebind: async () => assert.fail("刷新失败不能换绑")
  }), /写入失败/)
})

function loadFunction(path: string, declaration: string, scope: Record<string, any>): any {
  const source = readFileSync(path, "utf8")
  const start = source.indexOf(declaration)
  assert.notEqual(start, -1)
  const end = source.indexOf("\n}", start) + 2
  const js = transpileModule(source.slice(start, end), { compilerOptions: { module: 1, target: 7 } }).outputText
  const context: any = { exports: {}, ...scope }
  runInNewContext(js, context)
  return context.exports
}

test("原生恢复针对传入的原题及真实答案名称和该目标刷新时间，不随当前选卡改变", async () => {
  const question = { note: { noteId: "source" } }
  const target = { notebookId: "answer-nb", rootNodeId: "answer-root", rootTitle: "旧标题" }
  const refreshed: any[] = [], rebound: any[] = [], hud: string[] = []
  let buttonIndex = 0
  const api = loadFunction("src/plugin.ts", "export async function recoverAnswerIndexError(", {
    isAnswerIndexError, promptAnswerIndexRecovery,
    sourceMindMapId: (id: string, node: any) => { assert.equal(id, "source-nb"); assert.equal(node, question); return "source-root" },
    bindingForSource: () => target, effectiveAnswerTarget: (value: any) => value,
    MAIN_MINDMAP_SCOPE_ID: "__mn4_main_mindmap__",
    MN: { db: { getNoteById: (id: string) => { assert.equal(id, "answer-root"); return { noteTitle: "实时名称" } } } },
    NodeNote: class { title: string; constructor(note: any) { this.title = note.noteTitle } },
    notebookTitle: (id: string) => { assert.equal(id, "answer-nb"); return "答案集" },
    answerIndexUpdatedAt: (value: any) => { assert.equal(value, target); return "2026-10-19T00:00:00Z" },
    popup: async (options: any) => { assert.match(options.message, /答案集 › 实时名称/); return { buttonIndex } },
    HUDController: { show: () => hud.push("show"), hidden: () => hud.push("hide") },
    refreshIndex: async (value: any) => refreshed.push(value), notifyWorkbenchDataChanged() {},
    chooseCurrentAnswerBinding: async (...args: any[]) => rebound.push(args)
  })
  const error = new CardLinkError("indexNotReady")
  assert.equal(await api.recoverAnswerIndexError(error, { notebookId: "source-nb", question, target }), "refreshed")
  assert.deepEqual(refreshed, [target]); assert.deepEqual(hud, ["show", "hide"])
  buttonIndex = 1
  await api.recoverAnswerIndexError(error, { notebookId: "source-nb", question, target })
  assert.deepEqual(rebound, [["source-nb", question]])
})

test("面板刷新后重读触发错误的题目；取消、换绑或切换学习集不重放读取", async () => {
  for (const recovery of ["refreshed", "rebound", "cancelled"]) {
    for (const switched of [false, true]) {
      const question = { note: { noteId: "original" } }, calls: any[] = []
      const resolved = { question, lookupQuestion: question, questionNotebookId: "source-nb", sourceNotebookId: "source-nb", answerTarget: { notebookId: "answer-nb" } }
      const api = loadFunction("src/plugin.ts", "export async function answerWorkbenchDataWithIndexRecovery()", {
        resolveAnswerLookupContext: () => resolved,
        answerWorkbenchData: (node: any) => { calls.push(node); if (calls.length === 1) throw new CardLinkError("indexNotReady"); return { status: "ready" } },
        recoverAnswerIndexError: async (_error: any, source: any) => { assert.equal(source.question, question); return recovery },
        currentNotebookId: () => switched ? "other-nb" : "source-nb"
      })
      const result = await api.answerWorkbenchDataWithIndexRecovery()
      const retried = recovery === "refreshed" && !switched
      assert.equal(calls.length, retried ? 2 : 1)
      assert.ok(calls.every(node => node === question))
      assert.equal(retried ? result.status : result.cancelled, retried ? "ready" : true)
    }
  }
})

test("错题答案请求恢复后重新获取答案，原题请求及取消保留原响应", async () => {
  for (const choice of ["refreshed", "rebound", "cancelled"]) {
    const source = readFileSync("src/rails-core.ts", "utf8")
    const start = source.indexOf('  if (command === "mistakeDetail") {')
    const end = source.indexOf('  if (command === "openMistakeHandwriting")', start)
    const handler = new Function("command", "payload", "owner", "deps", `return (async () => { const {mistakeDetailById, MN, NodeNote, recoverAnswerIndexError, CardLinkError, sceneFeatures} = deps; ${source.slice(start, end)} })()`)
    let reads = 0, recoveries = 0
    const detail = { record: { sourceNotebookId: "source-nb", sourceNoteId: "source-note", answerNotebookId: "answer-nb", answerRootNodeId: "answer-root" }, answerStatus: "index-missing" }
    const deps = {
      mistakeDetailById: (_id: string, content: string) => { reads++; return { ...detail, answerStatus: content === "question" ? "deferred" : reads === 1 ? "index-missing" : "ready" } },
      MN: { db: { getNoteById: () => ({ noteId: "source-note" }) } }, NodeNote: class { constructor(public note: any) {} }, CardLinkError,
      recoverAnswerIndexError: async (_error: any, context: any) => { recoveries++; assert.equal(context.notebookId, "source-nb"); assert.equal(context.target.rootNodeId, "answer-root"); return choice },
      sceneFeatures: () => ({ handwriting: true })
    }
    const result = await handler("mistakeDetail", { recordId: "r", content: "answers" }, {}, deps)
    assert.equal(reads, choice === "cancelled" ? 1 : 2)
    assert.equal(recoveries, 1)
    assert.equal(result.answerStatus, choice === "cancelled" ? "index-missing" : "ready")
    reads = 0; recoveries = 0
    assert.equal((await handler("mistakeDetail", { recordId: "r", content: "question" }, {}, deps)).answerStatus, "deferred")
    assert.equal(recoveries, 0)
  }
})

test("复习页面不会把取消处理后的索引缺失保留为已读答案", () => {
  const source = readFileSync("web/src/main.jsx", "utf8")
  const start = source.indexOf("function retainReviewDetail(")
  const end = source.indexOf("\n}", start) + 2
  const retain = runInNewContext(source.slice(start, end) + "; retainReviewDetail")
  const ready = { answerStatus: "ready", answers: [{ id: "answer" }] }
  const next = retain({ a: ready, b: ready }, "a", { answerStatus: "index-missing", answers: [] })
  assert.deepEqual(Object.keys(next), ["b"])
  assert.equal(next.b, ready)
  assert.equal(retain(next, "a", ready).a, ready)
})

test("工具栏刷新后重试原题并保留窗口宿主；切换学习集不查错题", async () => {
  for (const switched of [false, true]) {
    const question = { note: { noteId: "original" } }, owner = { id: "window" }
    let lookups = 0, recoveries = 0
    const opened: any[] = [], overrides: any[] = []
    const resolved = {
      questionNotebookId: "source-nb", question, lookupQuestion: question,
      sourceNotebookId: "source-nb", sourceRootNodeId: "source-root",
      questionTitle: "原题", titles: ["原题"], path: [], answerTarget: { notebookId: "answer-nb" }
    }
    const api = loadFunction("src/plugin.ts", "export async function findCurrentAnswer(", {
      resolveAnswerLookupContext: (override: any) => { overrides.push(override); return resolved },
      recordRuntimeState() {}, showHUD() {},
      findAnswersForQuestion: () => { if (++lookups === 1) throw new CardLinkError("indexNotReady"); return [{ noteId: "answer", id: "answer", titles: ["原题"] }] },
      recoverAnswerIndexError: async (_error: any, source: any) => { recoveries++; assert.equal(source.question, question); return "refreshed" },
      currentNotebookId: () => switched ? "other-nb" : "source-nb",
      distinctAnswers: (items: any[]) => items, excludeAnswerNoteId: (items: any[]) => items,
      preferredAnswer: (_nb: string, _noteId: string, items: any[]) => items[0],
      showAnswer: async (...args: any[]) => opened.push(args)
    })
    await api.findCurrentAnswer(true, undefined, false, owner)
    assert.equal(recoveries, 1)
    assert.equal(lookups, switched ? 1 : 2)
    assert.equal(opened.length, switched ? 0 : 1)
    if (!switched) { assert.equal(overrides[1], question); assert.equal(opened[0][4], owner) }
  }
})

test("可能出现索引弹窗的桥接请求预留五分钟选择时间，普通读题仍保留原时限", () => {
  const source = readFileSync("web/src/lib/mnBridge.js", "utf8")
  const start = source.indexOf("function requestTimeoutMs(")
  const end = source.indexOf("\n}", start) + 2
  const timeout = runInNewContext(source.slice(start, end) + "; requestTimeoutMs")
  for (const base of [30000, 60000]) {
    for (const command of ["answer", "findCurrentAnswer", "markMistake", "cardMenuCommand"]) assert.equal(timeout(command, {}, base), 300000)
    assert.equal(timeout("mistakeDetail", { content: "answers" }, base), 300000)
    assert.equal(timeout("mistakeDetail", {}, base), 300000)
    assert.equal(timeout("mistakeDetail", { content: "question" }, base), base)
    assert.equal(timeout("dashboard", {}, base), base)
    assert.equal(timeout("openMistakeHandwriting", {}, base), 60000)
  }
})
