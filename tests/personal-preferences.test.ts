import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function moduleAt(file: string, modules: Record<string, any>) {
  const context = { exports: {} as any, require: (name: string) => modules[name] ?? {} }
  runInNewContext(transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  return context.exports
}

function storage() {
  const data = new Map<string, any>()
  return { data, getLocalDataByKey: (key: string) => data.get(key), setLocalDataByKey: (value: any, key: string) => data.set(key, JSON.parse(JSON.stringify(value))) }
}

test("多答案记住最后选择；重启、索引重排、题目和学习集隔离及失效回退", () => {
  const store = storage()
  const load = () => moduleAt("src/answer-preference.ts", { marginnote: store })
  let api = load()
  const a = { notebookId: "answers", noteId: "a", id: "node-a" }
  const b = { notebookId: "answers", noteId: "b", id: "node-b" }
  const candidates = [a, b]
  assert.equal(api.preferredAnswer("source", "q", candidates), a)
  api.rememberAnswer("source", "q", a)
  api.rememberAnswer("source", "q", b)
  api = load()
  assert.equal(api.preferredAnswer("source", "q", candidates), b)
  assert.deepEqual(candidates, [a, b], "不改变候选序号")
  assert.equal(api.preferredAnswer("source", "q", [b, a]), b)
  assert.equal(api.preferredAnswer("source", "other", candidates), a)
  assert.equal(api.preferredAnswer("other", "q", candidates), a)
  assert.equal(api.preferredAnswer("source", "q", [a]), a)
  assert.equal(api.preferredAnswer("source", "q", []), undefined)
  assert.equal(api.preferredAnswer("source", "q", [{ ...b, id: "new-node" }]).id, "new-node")
})

test("旧设置保留双击手写和固定列表；两项设置持久化且互不覆盖", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: (value: any) => value ?? {} } }
  let api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().boundHandwritingDisplay, "doubleTap")
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "always")
  api.saveMatcherSettings({ boundHandwritingDisplay: "always" })
  api.saveMatcherSettings({ mistakeListDisplay: "autoHide" })
  api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().boundHandwritingDisplay, "always")
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "autoHide")
  api.saveMatcherSettings({ boundHandwritingDisplay: "invalid", mistakeListDisplay: "invalid" })
  assert.equal(api.loadMatcherSettings().boundHandwritingDisplay, "always")
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "autoHide")
})

test("绑定手写显示设置只影响交互预览，不改变 AI/导出内容", () => {
  let mode = "doubleTap"
  const api = moduleAt("src/bound-handwriting.ts", { "./settings": { loadMatcherSettings: () => ({ boundHandwritingDisplay: mode }) } })
  const result = { status: "included", assets: [{ hash: "ink", kind: "image", mime: "image/png", base64: "AAAA" }] }
  const render = (interactive = true) => api.appendBoundMindMapHandwriting("<body><article></article></body>", result, interactive)
  const staticHtml = render(false)
  assert.match(render(), /data-bound-handwriting hidden/)
  mode = "always"
  assert.match(render(), /data-bound-handwriting="always"/)
  assert.doesNotMatch(render(), /data-bound-handwriting hidden/)
  assert.equal(render(false), staticHtml)
})

test("答案窗口恢复已选序号，保留全部候选，切题不会把旧选择写给新题", async () => {
  const store = storage()
  const prefs = moduleAt("src/answer-preference.ts", { marginnote: store })
  const source = readFileSync("src/plugin.ts", "utf8")
  const show = source.slice(source.indexOf("let answerQuestion:"), source.indexOf("async function openAnswerEditor"))
  const choose = source.slice(source.indexOf("export async function onChooseAnswerCandidate"), source.indexOf("/** 插件使用说明网页入口"))
  const find = source.slice(source.indexOf("export async function findCurrentAnswer"), source.indexOf("async function runSafely"))
  const a = { notebookId: "answers", noteId: "a", id: "a", titles: ["A"], tags: ["标准答案"], pathTitles: ["匹配路径"] }
  const b = { ...a, noteId: "b", id: "b", titles: ["B"], tags: [], pathTitles: [] }
  let questionId = "q1", selected = 1, ordinal = -1, chooserResolve: any
  let pending = false
  const addon: any = { answerCardView: { hidden: false } }
  const context: any = {
    exports: {}, self: addon, ...prefs,
    resolveAnswerLookupContext: () => ({ questionNotebookId: "source", sourceNotebookId: "source", questionTitle: questionId,
      lookupQuestion: { note: { noteId: questionId } }, answerTarget: { notebookId: "answers" }, titles: [], path: [] }),
    recordRuntimeState() {}, recordAnswerCardDiagnostics() {},
    findAnswersForQuestion: () => [a, b], distinctAnswers: (items: any) => items, excludeAnswerNoteId: (items: any) => items,
    answerCardHtml: (answer: any) => answer.noteId,
    showAnswerCard: () => { addon.answerCardView.hidden = false },
    syncAnswerCandidatesControl: (items: any[], index: number) => { assert.equal(items.length, 2); ordinal = index },
    answerText: () => "", runSafely: (fn: any) => fn(),
    select: () => pending ? new Promise(resolve => { chooserResolve = resolve }) : Promise.resolve({ index: selected })
  }
  runInNewContext(transpileModule(show + choose + find, { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  await context.exports.findCurrentAnswer()
  assert.equal(ordinal, 0)
  await context.exports.onChooseAnswerCandidate()
  assert.equal(ordinal, 1)
  addon.answerCardView.hidden = true
  await context.exports.findCurrentAnswer()
  assert.equal(ordinal, 1)
  pending = true
  const oldChooser = context.exports.onChooseAnswerCandidate()
  questionId = "q2"
  await context.exports.findCurrentAnswer()
  chooserResolve({ index: 1 })
  await oldChooser
  assert.equal(addon.answerCardAnswerNoteId, "a")
  assert.equal(prefs.preferredAnswer("source", "q2", [a, b]), a)
  questionId = "q1"
  await context.exports.findCurrentAnswer()
  assert.equal(ordinal, 1)
})
