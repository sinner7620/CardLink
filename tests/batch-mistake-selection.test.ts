import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function markingHarness(cards: any[]) {
  const source = readFileSync("src/plugin.ts", "utf8")
  const start = source.indexOf("async function markSelectedQuestions(")
  const end = source.indexOf("export async function onMistakeToolbarClick", start)
  const writes: any[] = []
  let notified = false, reasonPrompts = 0
  const scope: any = {
    hideAnswerToolbar() {}, currentNotebookId: () => "book", selectedQuestions: () => cards,
    mistakeRecordForSourceQuestion: () => undefined,
    chooseMistakeLevel: async () => 1,
    chooseErrorReason: async () => { reasonPrompts++; return { reason: { key: "reading", label: "审题遗漏" } } },
    async markQuestionsAsMistakes(selected: any[], notebookId: string, level: number, reason: any, preserveReason: boolean) {
      writes.push({ selected, notebookId, level, reason, preserveReason })
      return { added: selected.length, updated: 0, failed: 0 }
    },
    async markQuestionAsMistake(question: any, notebookId: string, level: number, reason: any, preserveReason: boolean) {
      writes.push({ selected: [question], notebookId, level, reason, preserveReason })
      return { id: "record" }
    },
    notifyWorkbenchDataChanged() { notified = true }, showHUD() {},
    captureDiagnosticError(error: unknown) { throw error }
  }
  runInNewContext(transpileModule(source.slice(start, end), {}).outputText, scope)
  return { mark: scope.markSelectedQuestions, writes, get notified() { return notified }, get reasonPrompts() { return reasonPrompts } }
}

const cards = [
  { id: "question", root: "questions", color: 1 },
  { id: "child-answer", root: "questions", parent: "question", color: 2 },
  { id: "indexed-answer", root: "answers", color: 3 }
]

test("侧边批量等级快捷反馈保留所有选卡，只保存等级且不弹错因", async () => {
  const h = markingHarness(cards)
  await h.mark(1)
  assert.equal(h.writes[0].selected, cards)
  assert.equal(h.writes[0].notebookId, "book")
  assert.equal(h.writes[0].level, 1)
  assert.equal(h.writes[0].reason, undefined)
  assert.equal(h.writes[0].preserveReason, true)
  assert.equal(h.reasonPrompts, 0)
  assert.equal(h.notified, true)
})

test("侧边单卡三级快捷反馈不弹错因，保留已有错因", async () => {
  for (const level of [0, 1, 2]) {
    const h = markingHarness([cards[0]])
    await h.mark(level)
    assert.equal(h.writes[0].selected[0], cards[0])
    assert.equal(h.writes[0].level, level)
    assert.equal(h.writes[0].reason, undefined)
    assert.equal(h.writes[0].preserveReason, true)
    assert.equal(h.reasonPrompts, 0)
    assert.equal(h.notified, true)
  }
})

test("普通批量标记仍保留原错因选择，不按脑图、答案身份或颜色过滤", async () => {
  const h = markingHarness(cards)
  await h.mark()
  assert.equal(h.writes[0].selected, cards)
  assert.equal(h.writes[0].level, 1)
  assert.equal(h.writes[0].reason.key, "reading")
  assert.equal(h.writes[0].preserveReason, false)
  assert.equal(h.reasonPrompts, 1)
  assert.equal(h.notified, true)
})

test("详情单项等级侧边反馈不弹错因，固定单题与批量复习保留原入口", async () => {
  const source = readFileSync("src/rails-core.ts", "utf8")
  const start = source.indexOf("  if (['reviewMistake', 'changeMistakeLevel', 'reviewMistakes', 'changeMistakeLevels'].includes(command))")
  const end = source.indexOf('  if (command === "resumeMistakeReview")', start)
  assert.ok(start > 0 && end > start)
  const calls: any[] = []
  const scope = {
    chooseErrorReason: async () => { calls.push("reason"); return { reason: { key: "reading", label: "审题遗漏" } } },
    changeMistakeLevelById: async (...args: any[]) => { calls.push(["change", ...args]); return { id: args[0] } },
    reviewMistakeById: async (...args: any[]) => { calls.push(["review", ...args]); return { id: args[0] } },
    reviewMistakesByIds: async (...args: any[]) => { calls.push(["batch", ...args]); return { updated: 1 } }
  }
  const compiled = transpileModule(`const run = async (command: string, payload: any) => {${source.slice(start, end)}}`, { compilerOptions: { target: 7 } }).outputText
  const run = runInNewContext(`${compiled}\nrun`, scope)
  await run("changeMistakeLevel", { recordId: "r", level: 0 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "change")
  assert.equal(calls[0][1], "r")
  assert.equal(calls[0][2], 0)
  assert.equal(calls[0][3], undefined)
  assert.equal(calls[0][4], true)
  calls.length = 0
  await run("reviewMistake", { recordId: "r", level: 1 })
  assert.equal(calls[0], "reason")
  assert.equal(calls[1][0], "review")
  assert.equal(calls[1][3].key, "reading")
  calls.length = 0
  await run("reviewMistakes", { recordIds: ["r"], level: 1 })
  assert.equal(calls[0], "reason")
  assert.equal(calls[1][0], "batch")
})
