import test from "node:test"
import assert from "node:assert/strict"
import { selectReusableAnswerParent } from "../src/answer-card-creation"

test("生成答案卡片时复用唯一同层级分支", () => {
  const reused = { noteId: "answer-section" }
  const candidates = [
    { value: reused, id: "answer-section", title: "第二章", pathTitles: ["上篇", "答案脑图"] },
    { value: { noteId: "other" }, id: "other", title: "第二章", pathTitles: ["下篇", "答案脑图"] }
  ]
  assert.equal(
    selectReusableAnswerParent(["第二章", "上篇", "题目脑图"], candidates, "answer-root"),
    reused
  )
})

test("同分支不唯一时不猜测，也不会要求复制新分支", () => {
  const candidates = [
    { value: { noteId: "a" }, id: "a", title: "第二章", pathTitles: ["上篇", "答案脑图"] },
    { value: { noteId: "b" }, id: "b", title: "第二章", pathTitles: ["上篇", "答案脑图"] }
  ]
  assert.equal(
    selectReusableAnswerParent(["第二章", "上篇", "题目脑图"], candidates, "answer-root"),
    undefined
  )
})

test("题目直属根节点时复用绑定的答案根节点", () => {
  const root = { noteId: "answer-root" }
  assert.equal(
    selectReusableAnswerParent(
      ["题目脑图"],
      [{ value: root, id: "answer-root", title: "答案脑图", pathTitles: [] }],
      "answer-root"
    ),
    root
  )
})
