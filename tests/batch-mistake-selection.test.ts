import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

test("批量标记保留所有选卡，不按脑图、答案身份或颜色过滤", async () => {
  const source = readFileSync("src/plugin.ts", "utf8")
  const start = source.indexOf("async function markSelectedQuestions(")
  const end = source.indexOf("export async function onMistakeToolbarClick", start)
  const cards = [
    { id: "question", root: "questions", color: 1 },
    { id: "child-answer", root: "questions", parent: "question", color: 2 },
    { id: "indexed-answer", root: "answers", color: 3 }
  ]
  let marked: unknown
  let notified = false
  const scope: any = {
    hideAnswerToolbar() {}, currentNotebookId: () => "book",
    selectedQuestions: () => cards,
    async markQuestionsAsMistakes(selected: unknown, notebookId: string, level: number) {
      marked = selected
      assert.equal(notebookId, "book")
      assert.equal(level, 1)
      return { added: 3, updated: 0, failed: 0 }
    },
    notifyWorkbenchDataChanged() { notified = true }, showHUD() {},
    captureDiagnosticError(error: unknown) { throw error }
  }
  runInNewContext(transpileModule(source.slice(start, end), {}).outputText, scope)
  await scope.markSelectedQuestions(1)
  assert.equal(marked, cards)
  assert.equal(notified, true)
})
