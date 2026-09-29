import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { collectQuestionTree, questionIdsInTree } from "../src/quick-menu-selection"
import { normalizeBinding, usesOnlySubcardAnswers } from "../src/binding"
import { renderCardHtml } from "../src/card-html"

test("指定颜色只把该颜色的卡片加入快捷区题目来源", () => {
  const question: any = { noteId: "q", noteTitle: "题目", colorIndex: 1 }
  const answer: any = { noteId: "a", noteTitle: "答案", colorIndex: 2, parentNote: question }
  const zero: any = { noteId: "z", noteTitle: "另一题", colorIndex: 0 }
  assert.deepEqual(questionIdsInTree(collectQuestionTree([question, answer, zero], [1], () => true)), ["q"])
  assert.deepEqual(questionIdsInTree(collectQuestionTree([question, answer, zero], [0], () => true)), ["z"])
})

test("同色的题目子卡不计数；子卡答案只在没有独立答案脑图时从原题隐藏", () => {
  const q: any = { noteId: "q", noteTitle: "题目", colorIndex: 1 }
  const a: any = { noteId: "a", noteTitle: "答案", excerptText: "答案正文", colorIndex: 1, parentNote: q }
  q.childNotes = [a]
  assert.deepEqual(questionIdsInTree(collectQuestionTree([q, a], [1], () => true)), ["q"])
  const target = { notebookId: "source", rootNodeId: "root", selectionMode: "mixed" as const, questionColors: [1] }
  assert.equal(usesOnlySubcardAnswers(target, "source", "root", 1), true)
  assert.equal(usesOnlySubcardAnswers({ ...target, rootNodeId: "answers" }, "source", "root", 1), false)
  assert.equal(usesOnlySubcardAnswers({ ...target, notebookId: "answers" }, "source", "root", 1), false)
  assert.equal(usesOnlySubcardAnswers(target, "source", "root", 2), false)
  assert.doesNotMatch(renderCardHtml(q, "原题", () => undefined, () => undefined, undefined, false, false), /答案正文/)
  assert.match(renderCardHtml(q, "原题", () => undefined, () => undefined), /答案正文/)
})

test("旧绑定保留默认答案脑图；子卡模式只匹配指定颜色的直接子卡", () => {
  const legacy = normalizeBinding({ notebookId: "answers", rootNodeId: "root" })!
  assert.equal(legacy.designatedAnswer, undefined)
  const configured = normalizeBinding({ notebookId: "answers", rootNodeId: "root", selectionMode: "designated", designatedAnswer: "subcard", questionColors: [0, 0, 2, -1] })!
  assert.deepEqual(configured.questionColors, [0, 2])

  const question: any = { note: { noteId: "q", notebookId: "source", colorIndex: 0 }, childNodes: [
    { note: { noteId: "a", notebookId: "source" } },
    { note: { noteId: "b", notebookId: "source" } }
  ] }
  const calls: string[] = []
  const sandbox: any = {
    exports: {},
    require: (name: string) => name === "./matcher" ? {
      toIndexedAnswer: (note: any, notebookId: string) => ({ answer: { id: note.noteId, noteId: note.noteId, notebookId } }),
      findAnswers: () => { calls.push("mindmap"); return [{ id: "remote", noteId: "remote" }] },
      findAnswersByRegex: () => [], findAnswerByReference: () => undefined
    } : name === "./ordered-pairing" ? { pairedAnswerReference: () => undefined }
      : name === "marginnote" ? { MN: { currnetNotebookId: "source" } } : {}
  }
  runInNewContext(transpileModule(readFileSync("src/answer-lookup.ts", "utf8"), {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, sandbox)
  assert.deepEqual(Array.from(sandbox.exports.findAnswersForQuestion(configured, question, [], []), (item: any) => item.noteId), ["a", "b"])
  assert.deepEqual(calls, [])
  assert.deepEqual(Array.from(sandbox.exports.findAnswersForQuestion({ ...configured, questionColors: [2] }, question, [], [])), [])
  assert.deepEqual(Array.from(sandbox.exports.findAnswersForQuestion({ ...configured, selectionMode: "mixed" }, question, [], []), (item: any) => item.noteId), ["a", "b", "remote"])
  assert.deepEqual(calls, ["mindmap"])
})

test("评论自动折叠只包裹评论，题目摘录仍直接显示", () => {
  const note = { noteTitle: "答案", excerptText: "摘录正文", comments: [{ type: "TextNote", text: "评论内容" }] }
  const html = renderCardHtml(note, "题目", () => undefined, () => undefined, undefined, true)
  assert.match(html, /摘录正文[\s\S]*<details class="card-comment"/)
  assert.match(html, /<summary>评论 1<\/summary>[\s\S]*评论内容/)
})

test("多条卡片评论可分别展开并有独立持久化键", () => {
  const note = { noteId: "question", excerptText: "题干", comments: [
    { type: "TextNote", text: "第一条" }, { type: "TextNote", text: "第二条" }
  ] }
  const html = renderCardHtml(note, "原题", () => undefined, () => undefined)
  assert.equal((html.match(/class="card-comment"/g) || []).length, 2)
  assert.match(html, /data-comment-key="question:0" open/)
  assert.match(html, /data-comment-key="question:1" open/)
})
