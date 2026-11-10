import test from "node:test"
import assert from "node:assert/strict"
Object.assign(globalThis, { Application: { sharedInstance: () => ({ appVersion: "4.0.0", osType: 1 }) }, Database: { sharedInstance: () => ({}) }, NSLocale: { preferredLanguages: () => ["zh-CN"] }, UIColor: { colorWithHexString: (v: string) => v } })
test("答案索引使用 SDK 真实父链，路径为根到父级并排除当前题目标题", async () => {
  const { toIndexedAnswer } = await import("../src/matcher")
  const signal = { noteId: "signal", noteTitle: "信号", notebookId: "book", comments: [] }
  const category = { noteId: "category", noteTitle: "真题年份分类", notebookId: "book", parentNote: signal, comments: [] }
  const year = { noteId: "year", noteTitle: "2013年", notebookId: "book", parentNote: category, comments: [] }
  const note: any = { noteId: "question", noteTitle: "2013-11", notebookId: "book", parentNote: year, comments: [] }
  assert.deepEqual(toIndexedAnswer(note, "book").answer?.pathTitles, ["信号", "真题年份分类", "2013年"])
})
