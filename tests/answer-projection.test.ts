import assert from "node:assert/strict"
import test from "node:test"
import {
  extractMatchedAnswerText,
  projectAnswerText,
  uniqueAnswerCandidate,
  type AnswerCandidate,
} from "../src/answer-projection.ts"
import { sourceFingerprint } from "../src/harness/source-fingerprint.ts"

/**
 * v2.16 §6.1/§6.3：设备答案正文投影与本地源指纹的纯函数测试。
 * 这些用例不依赖 MarginNote 运行时：候选卡片与卡片解析器由测试注入。
 */

function candidate(overrides: Partial<AnswerCandidate> = {}): AnswerCandidate {
  return {
    id: "ansNode1",
    noteId: "ansNote1",
    notebookId: "bookAns",
    titles: ["傅里叶变换的基本性质（答案）"],
    tags: [],
    comments: ["答案：先做卷积定理，再核对符号。"],
    excerpts: [],
    children: [],
    pathTitles: ["信号与系统", "第三章"],
    ...overrides,
  }
}

test("唯一匹配：评论优先、来源为实际答案笔记（不是脑图根）", () => {
  const answer = projectAnswerText(
    { status: "ok", candidates: [candidate()] },
    () => ({ comments: [{ type: "TextNote", text: "答案：先做卷积定理，再核对符号。" }], childNotes: [] }),
  )
  assert.equal(answer.status, "projected")
  if (answer.status !== "projected") return
  assert.equal(answer.text, "答案：先做卷积定理，再核对符号。")
  assert.deepEqual(answer.source, { notebookId: "bookAns", noteId: "ansNote1" })
  assert.equal(answer.title, "傅里叶变换的基本性质（答案）")
  assert.equal(answer.candidateCount, 1)
})

test("评论为空时按摘录、再按子卡片抽取，保持既有文本口径", () => {
  const excerpt = extractMatchedAnswerText(
    candidate({ comments: [], excerpts: ["摘录正文"] }),
    () => ({ excerptText: "摘录正文", childNotes: [] }),
  )
  assert.equal(excerpt.status === "projected" ? excerpt.text : "", "摘录正文")
  const children = extractMatchedAnswerText(
    candidate({ comments: [], excerpts: [], children: [{ title: "步骤", text: "先换元" }] }),
    () => ({ childNotes: [{ noteTitle: "步骤", comments: [{ type: "TextNote", text: "先换元" }] }] }),
  )
  assert.equal(children.status === "projected" ? children.text : "", "【步骤】\n先换元")
})

test("多候选不唯一 → ambiguous；无匹配 → not_found；无绑定/索引不可用 → 显式原因", () => {
  const ambiguous = uniqueAnswerCandidate([candidate(), candidate({ id: "ansNode2", noteId: "ansNote2" })])
  assert.deepEqual(ambiguous, { status: "unavailable", reason: "answer_ambiguous", candidateCount: 2 })
  assert.deepEqual(projectAnswerText({ status: "not-found", candidates: [] }, () => undefined), {
    status: "unavailable", reason: "answer_not_found", candidateCount: 0,
  })
  assert.deepEqual(projectAnswerText({ status: "unbound", candidates: [] }, () => undefined), {
    status: "unavailable", reason: "answer_source_unbound",
  })
  assert.deepEqual(projectAnswerText({ status: "index-missing", candidates: [] }, () => undefined), {
    status: "unavailable", reason: "answer_index_unavailable",
  })
})

test("同一卡片多个脑图节点按笔记身份去重；卡片不可读/空文本显式不可用", () => {
  const duplicated = uniqueAnswerCandidate([candidate(), candidate({ id: "ansNodeOther" })])
  assert.equal("status" in duplicated, false, "同一 noteId 的两个节点仍是唯一候选")
  assert.deepEqual(extractMatchedAnswerText(candidate(), () => undefined), {
    status: "unavailable", reason: "answer_note_unavailable",
  })
  assert.deepEqual(extractMatchedAnswerText(candidate({ comments: [], excerpts: [] }), () => ({})), {
    status: "missing", reason: "answer_text_empty",
  })
})

test("本地源指纹：稳定、对记录/OCR/绑定变化敏感、与顺序无关", () => {
  const records = [
    { recordId: "n1:a1", level: 0, reasonTags: ["计算"], reviewCompleted: false, nextReviewAt: "2026-11-18T00:00:00Z", reviewCount: 1, favorite: false, manualCategories: ["第一章"], customTags: ["tag1"], answerNotebookId: "bookAns", answerRootNodeId: "root1" },
    { recordId: "n1:a2", level: 2, reasonTags: [], reviewCompleted: true, nextReviewAt: "", reviewCount: 0, favorite: true, manualCategories: [], customTags: [], answerNotebookId: "", answerRootNodeId: "" },
  ]
  const ocrRows = [{ record_id: "n1:a1", manual_text: "手工修订题干", effective_text: "题干", ocr_text: "ocr", status: "complete" }]
  const bindings = [{ notebookId: "n1", rootNodeId: "root1" }]
  const base = sourceFingerprint({ records, ocrRows, bindings })
  const reordered = sourceFingerprint({ records: [...records].reverse(), ocrRows, bindings })
  assert.equal(base.fingerprint, reordered.fingerprint)
  assert.equal(base.fingerprint.length, 64)
  assert.equal(base.tracked.answerCardText, false, "答案卡片正文明确不进入轻量指纹")

  const levelChanged = sourceFingerprint({ records: [{ ...records[0]!, level: 1 }, records[1]!], ocrRows, bindings })
  assert.notEqual(levelChanged.fingerprint, base.fingerprint, "等级变化")
  const reasonChanged = sourceFingerprint({ records: [{ ...records[0]!, reasonTags: ["计算", "符号"] }, records[1]!], ocrRows, bindings })
  assert.notEqual(reasonChanged.fingerprint, base.fingerprint, "错因变化")
  const removed = sourceFingerprint({ records: [records[0]!], ocrRows, bindings })
  assert.notEqual(removed.fingerprint, base.fingerprint, "记录删除")
  const ocrEdited = sourceFingerprint({ records, ocrRows: [{ ...ocrRows[0]!, manual_text: "再次修订" }], bindings })
  assert.notEqual(ocrEdited.fingerprint, base.fingerprint, "OCR 手工修订")
  const ocrDeleted = sourceFingerprint({ records, ocrRows: [], bindings })
  assert.notEqual(ocrDeleted.fingerprint, base.fingerprint, "OCR 行删除")
  const bindingChanged = sourceFingerprint({ records, ocrRows, bindings: [{ notebookId: "n1", rootNodeId: "root2" }] })
  assert.notEqual(bindingChanged.fingerprint, base.fingerprint, "答案绑定变化")
})
