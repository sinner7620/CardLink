import test from "node:test"
import assert from "node:assert/strict"
import { getBindingForMode, normalizeBinding } from "../src/binding"

test("恢复混合绑定解析，保留答案位置和颜色且不改写原记录", () => {
  for (const designatedAnswer of [undefined, "mindmap", "subcard"] as const) {
    const stored = { notebookId: "answers", rootNodeId: "answer-root", selectionMode: "mixed", designatedAnswer, questionColors: [1, 3] }
    const before = JSON.stringify(stored)
    const target = getBindingForMode({ "source::root::root": stored } as any, "source", "root", true)!
    assert.equal(target.selectionMode, "mixed")
    assert.equal(target.designatedAnswer, designatedAnswer)
    assert.equal(target.rootNodeId, "answer-root")
    assert.deepEqual(target.questionColors, [1, 3])
    assert.equal(JSON.stringify(stored), before)
  }
})

test("指定模式和旧式脑图绑定保持兼容", () => {
  assert.deepEqual(normalizeBinding("answers"), { notebookId: "answers" })
  const target = { notebookId: "source", selectionMode: "designated", designatedAnswer: "subcard", questionColors: [2] }
  assert.deepEqual(normalizeBinding(target), target)
})
