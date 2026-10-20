import assert from "node:assert/strict"
import test from "node:test"
import { filterMistakeAnswerCards } from "../src/mistake-selection"
import { subcardColorHint, type BindingTarget } from "../src/binding"

type Card = { id: string; color: number; parent?: Card }
const q1: Card = { id: "q1", color: 1 }
const q2: Card = { id: "q2", color: 1 }
const a1: Card = { id: "a1", color: 1, parent: q1 }
const a2: Card = { id: "a2", color: 2, parent: q2 }
function filter(target: BindingTarget | undefined, cards = [q1, a1, q2, a2]) {
  const calls: string[] = []
  const result = filterMistakeAnswerCards(cards, {
    target, notebookId: "book", rootNodeId: "questions",
    parentOf: card => card.parent, colorOf: card => card.color,
    isIndexedAnswer: card => { calls.push(card.id); return true }
  })
  return { ids: result.map(card => card.id), calls }
}

test("子卡模式不访问覆盖题目的索引，多选题目全保留，真实答案含同色子卡被排除", () => {
  const result = filter({ notebookId: "book", rootNodeId: "questions", designatedAnswer: "subcard", questionColors: [1] })
  assert.deepEqual(result, { ids: ["q1", "q2"], calls: [] })
})
test("未配置颜色不猜测答案；未绑定保留选卡；混合且同脑图不误用整图索引", () => {
  assert.deepEqual(filter(undefined).ids, ["q1", "a1", "q2", "a2"])
  assert.deepEqual(filter({ notebookId: "book", rootNodeId: "questions", designatedAnswer: "subcard" }).ids, ["q1", "a1", "q2", "a2"])
  assert.deepEqual(filter({ notebookId: "book", rootNodeId: "questions", selectionMode: "mixed", questionColors: [1] }), { ids: ["q1", "q2"], calls: [] })
})
test("独立答案脑图仍过滤索引答案，不再无条件放行第一张答案卡", () => {
  const result = filter({ notebookId: "book", rootNodeId: "answers", designatedAnswer: "mindmap" })
  assert.deepEqual(result.ids, [])
  assert.equal(result.calls.length, 4)
})
test("答案索引失效保留合法题目", () => {
  assert.deepEqual(filterMistakeAnswerCards([q1, q2], {
    target: { notebookId: "book", rootNodeId: "answers" }, notebookId: "book", rootNodeId: "questions",
    parentOf: card => card.parent, colorOf: card => card.color,
    isIndexedAnswer: () => { throw new Error("index missing") }
  }), [q1, q2])
})
test("子卡片未绑定颜色与当前颜色不匹配分别提示，颜色 0 是有效绑定", () => {
  const target = { notebookId: "book", designatedAnswer: "subcard" as const }
  assert.match(subcardColorHint(target, 0)!, /尚未绑定题目卡片颜色/)
  assert.match(subcardColorHint({ ...target, questionColors: [1] }, 0)!, /当前题目卡片颜色/)
  assert.equal(subcardColorHint({ ...target, questionColors: [0] }, 0), undefined)
  assert.equal(subcardColorHint({ notebookId: "book" }, 0), undefined)
})
