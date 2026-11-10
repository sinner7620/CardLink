import { test } from "node:test"
import assert from "node:assert/strict"
import { collectQuestionTree, selectedQuestionIds } from "../src/quick-menu-selection"

test("框选卡片提取题目：章节、重复、答案子卡与脑图外卡片", () => {
  const chapter = { noteId: "c", colorIndex: 0 }
  const q1 = { noteId: "q1", colorIndex: 1, parentNote: chapter }
  const answer = { noteId: "a", colorIndex: 1, parentNote: q1 }
  const q2 = { noteId: "q2", colorIndex: 1, parentNote: chapter }
  const q3 = { noteId: "q3", colorIndex: 1 }
  const tree = collectQuestionTree([chapter, q1, answer, q2, q3], [1], () => true)
  assert.deepEqual(selectedQuestionIds(tree, new Set(["q2", "q1"])), ["q1", "q2"])
  assert.deepEqual(selectedQuestionIds(tree, new Set(["c", "q1"])), ["q1", "q2"])
  assert.deepEqual(selectedQuestionIds(tree, new Set(["a", "outside"])), [])
  assert.deepEqual(selectedQuestionIds(tree, new Set()), [])
})

test("答案脑图绑定的同色父子题目都可选，不按答案子卡排除", () => {
  const parent = { noteId: "parent", colorIndex: 1 }
  const question = { noteId: "question", colorIndex: 1, parentNote: parent }
  const tree = collectQuestionTree([parent, question], [1], () => true, { excludeQuestionDescendants: false })
  assert.deepEqual(selectedQuestionIds(tree, new Set(["question"])), ["question"])
})

test("答案脑图未设颜色筛选时，不要求卡片必须有颜色编号", () => {
  const tree = collectQuestionTree([{ noteId: "question" }], undefined, () => true, { excludeQuestionDescendants: false })
  assert.deepEqual(selectedQuestionIds(tree, new Set(["question"])), ["question"])
})


test("答案脑图按所选卡片本身做题，多选父子卡不扩选其他后代", () => {
  const parent = { noteId: "parent" }
  const q = { noteId: "q", parentNote: parent }
  const other = { noteId: "other", parentNote: parent }
  const tree = collectQuestionTree([parent, q, other], undefined, () => true, { excludeQuestionDescendants: false })
  assert.deepEqual(selectedQuestionIds(tree, new Set(["parent"]), false), ["parent"])
  assert.deepEqual(selectedQuestionIds(tree, new Set(["parent", "q"]), false), ["parent", "q"])
})
