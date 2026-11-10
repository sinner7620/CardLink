import test, { mock } from "node:test"
import assert from "node:assert/strict"
const legacy = { sourceNotebookId: "book", sourceNoteId: "question", sourceNotebookTitle: "专业课", sourceTitle: "2013-11", sourcePathTitles: ["2013年", "真题年份分类", "信号"], categoryPath: ["专业课", "2013年", "真题年份分类", "信号"], level: 1, levelModel: 3, reviewScheduleModel: 3, nextReviewAt: "2026-11-08", createdAt: "2026-11-07", history: [{ at: "2026-11-07", level: 1 }], manualCategories: ["自定义"] }
const key = "mn4-answer-matcher.mistakes.v2"
const kv: Record<string, any> = { [key]: { version: 2, records: { "book:question": legacy, "book:new": { ...legacy, sourceNoteId: "new", sourcePathOrder: "root-first", sourcePathTitles: ["信号", "真题年份分类", "2013年"], categoryPath: ["专业课", "信号", "真题年份分类", "2013年"] } } } }
mock.module("marginnote", { namedExports: { getLocalDataByKey: (key: string) => kv[key], setLocalDataByKey: (value: any, key: string) => { kv[key] = value }, isfileExists: () => false, readJSON() {}, writeTextFile() {}, MN: { app: {} } } })
mock.module("../src/settings", { namedExports: { loadMatcherSettings: () => ({ mistakeReviewCurves: { 0: [1], 1: [1], 2: [1] } }) } })
mock.module("../src/note-navigation", { namedExports: { recordRuntimeState() {} } })

test("旧错题来源与分类路径同步迁移，保留标题、人工分类和复习历史", async () => {
  const store = await import("../src/mistake-store")
  const { automaticCategoryPath, categoryPathPrefixes } = await import("../src/mistake-domain")
  const state = store.loadMistakeState()
  for (const record of Object.values(state.records)) {
    assert.deepEqual(record.sourcePathTitles, ["信号", "真题年份分类", "2013年"])
    assert.deepEqual(automaticCategoryPath(record), ["专业课", "信号", "真题年份分类", "2013年"])
    assert.equal(record.sourceTitle, "2013-11")
    assert.deepEqual(record.manualCategories, ["自定义"])
    assert.deepEqual(record.history, legacy.history)
    assert.equal(categoryPathPrefixes(automaticCategoryPath(record)).slice(-1)[0]?.label, "专业课 › 信号 › 真题年份分类 › 2013年")
  }
  store.saveMistakeState(state)
  const saved = JSON.parse(kv[key])
  assert.equal(saved.records["book:question"].sourcePathOrder, "root-first")
  assert.deepEqual(saved.records["book:question"].sourcePathTitles, state.records["book:new"].sourcePathTitles)
})

