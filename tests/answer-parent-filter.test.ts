import test, { mock } from "node:test"
import assert from "node:assert/strict"
import { renderCardHtml } from "../src/card-html"

Object.assign(globalThis, { NSData: { dataWithBase64EncodedStringOptions: () => ({ length: () => 8, writeToFileAtomically: () => true }) }, ZipArchive: { createZipFileAtPathWithContentsOfDirectory: () => true }, NSFileManager: { defaultManager: () => ({ fileExistsAtPath: () => true, contentsOfDirectoryAtPathError: () => [] }) } })
const kv: Record<string, any> = {}
const notes: Record<string, any> = {}
const rendered: string[] = []
const writtenFiles = new Map<string, string>()
let answers: any[] = []
const mediaReads: string[] = []
let sketchReads = 0
class FakeNode {
  constructor(public note: any, public notebookId: string) {}
  get title() { return this.note.noteTitle }
  get titles() { return [this.title] }
  get nodeId() { return this.note.noteId }
  get ancestorNodes() { return (this.note.parents || []).map((title: string) => ({ title })) }
  get childNodes() { return (this.note.childNotes || []).map((note: any) => new FakeNode(note, this.notebookId)) }
}
const runtime = {
  MN: { currnetNotebookId: "source", app: {}, db: { getMediaByHash: (hash: string) => { mediaReads.push(hash); return { base64Encoding: () => "iVBORw0KGgo=", length: () => 8, writeToFileAtomically: () => true } }, getSketchNoteForMindMapFocusNoteId: () => { sketchReads++; return { paint: "bound-image" } }, getNoteById: (id: string) => notes[id], getNotebookById: (id: string) => ({ topicId: id, title: id, notes: [] }) } },
  NodeNote: FakeNode, delay: async () => {}, popup: async () => ({ buttonIndex: -1 }), setTimeInterval() {}, showHUD() {}, saveFile() {},
  UndoManager: {}, isNSNull: () => false,
  getLocalDataByKey: (key: string) => kv[key], setLocalDataByKey: (value: any, key: string) => { kv[key] = value },
  isfileExists: () => false, readJSON() {}, writeTextFile: (path: string, text: string) => { writtenFiles.set(path, text) },
}
mock.module("marginnote", { namedExports: runtime })
mock.module("../src/note-navigation", { namedExports: { recordRuntimeState() {}, captureDiagnosticError() {}, openNoteInMindMap() {} } })
mock.module("../src/matcher", { namedExports: {
  findAnswers: () => answers,
  findAnswersByRegex: () => answers,
  findAnswerByReference: (_target: any, id: string) => answers.find(answer => answer.noteId === id),
  toIndexedAnswer: (note: any, notebookId: string) => ({ answer: { id: note.noteId, noteId: note.noteId, notebookId, titles: [note.noteTitle], pathTitles: ["原题"], tags: [] } }),
  refreshIndex: async () => ({}),
  answerCardHtml: (answer: any, title: string, resolveNote: any, _bound: boolean, runtime: boolean, options: any) => {
    rendered.push(answer.noteId)
    return renderCardHtml(resolveNote(answer.noteId) || {noteId:answer.noteId,excerptText:`BODY-${answer.noteId}`},title,resolveNote,hash=>'iVBORw0KGgo=',hash=>{mediaReads.push(hash);return 'INK'},false,true,runtime,options)
  }
} })
const question: any = { noteId: "q", notebookId: "source", noteTitle: "2013-11", parents: ["2013年", "真题年份分类", "题目脑图"], comments: [{ type: "TextNote", text: "#错题_不会" }] }
const path = ["题目脑图", "真题年份分类", "2013年"]
const candidate = (id: string, parent: string, root = "答案脑图") => ({ id, noteId: id, notebookId: "answers", titles: ["2013-11"], pathTitles: [root, "真题年份分类", parent], tags: [], comments: [], excerpts: [], children: [] })
const target: any = { notebookId: "answers" }
async function lookup(config: any = target, sourcePath = path) {
  const { findAnswersForQuestion } = await import("../src/answer-lookup")
  return findAnswersForQuestion(config, new FakeNode(question, "source") as any, ["2013-11"], sourcePath)
}

test("同名答案按直接父节点硬筛选，顶层脑图名不同仍匹配", async () => {
  answers = [candidate("wrong", "2014年"), candidate("right", "2013年"), candidate("right-two", "２０１３ 年")]
  assert.deepEqual((await lookup()).map(answer => answer.noteId), ["right", "right-two"])
})

test("只剩一个同名答案但父节点不符，也返回空；缺少父级不放宽", async () => {
  answers = [{ ...candidate("wrong", "2014年"), tags: ["标准答案"] }]
  assert.deepEqual(await lookup(), [])
  answers = [candidate("right", "2013年")]
  assert.deepEqual(await lookup(target, []), [])
  answers = [{ ...candidate("unknown", "2013年"), pathTitles: [] }]
  assert.deepEqual(await lookup(), [])
})

test("正则匹配也排除父节点不符的候选，不能绕过筛选", async () => {
  answers = [candidate("wrong", "2014年"), candidate("right", "2013年")]
  assert.deepEqual((await lookup({ ...target, matchMode: "regex", regexRules: { questionPattern: "(.*)", answerPattern: "(.*)" } })).map(answer => answer.noteId), ["right"])
})

test("旧固定配对父节点不符时不使用该答案，同名回退仍筛选", async () => {
  answers = [candidate("stale-pair", "2014年"), candidate("right", "2013年")]
  const config = { ...target, matchMode: "parent-order", orderedPairing: { pairs: [{ questionNoteId: "q", answerNoteId: "stale-pair", answerNodeId: "stale-pair" }] } }
  assert.deepEqual((await lookup(config)).map(answer => answer.noteId), ["right"])
  answers = [candidate("stale-pair", "2014年")]
  assert.deepEqual(await lookup(config), [])
})

test("明确绑定的题目直接子卡保留，混合模式的脑图答案仍被筛选", async () => {
  const child = { noteId: "child", noteTitle: "直接子卡答案", notebookId: "source" }
  question.childNotes = [child]
  question.colorIndex = 1
  answers = [candidate("wrong", "2014年"), candidate("right", "2013年")]
  const config = { ...target, selectionMode: "mixed", questionColors: [1] }
  assert.deepEqual((await lookup(config)).map(answer => answer.noteId), ["child", "right"])
  question.childNotes = []
})

async function seedRecord() {
  const { createMistakeRecord } = await import("../src/mistake-domain")
  const store = await import("../src/mistake-store")
  notes.q = question
  kv["mn4-answer-matcher.bindings.v1"] = { source: target }
  const record = createMistakeRecord({ sourceNotebookId: "source", sourceNoteId: "q", sourceNotebookTitle: "题目脑图", sourceTitle: "2013-11", sourcePathTitles: path, level: 0 })
  store.upsertMistakeRecord(store.loadMistakeState(), record)
  return record.recordId
}

test("真实错题详情、AI/复习读取和 PDF/MD 导出都不渲染被排除的答案", async () => {
  const recordId = await seedRecord()
  const manager = await import("../src/mistake-manager")
  const exporter = await import("../src/mistake-export")
  answers = [candidate("wrong", "2014年"), candidate("right", "2013年")]
  rendered.length = 0
  assert.deepEqual(manager.mistakeDetailById(recordId).answers.map(answer => answer.id), ["right"])
  assert.deepEqual(manager.createMistakeContentReader().read(recordId).answers.map(answer => answer.id), ["right"])
  assert.deepEqual(manager.isolatedReviewContent(recordId).answers.map(answer => answer.id), ["right"])
  const markdown = await exporter.previewMistakeExport({ format: "md", recordIds: [recordId] })
  assert.match(markdown.markdown, /BODY-right/)
  assert.doesNotMatch(markdown.markdown, /BODY-wrong/)
  const pdf = await exporter.previewMistakeExport({ format: "pdf", recordIds: [recordId] })
  assert.match(pdf.html, /BODY-right/)
  assert.doesNotMatch(pdf.html, /BODY-wrong/)
  const formalPdf = await exporter.exportMistakes({ format: "pdf", recordIds: [recordId] })
  assert.equal(formalPdf.renderPdf, true)
  assert.match(formalPdf.html, /BODY-right/)
  assert.doesNotMatch(formalPdf.html, /BODY-wrong/)
  writtenFiles.clear()
  const formalMarkdown = await exporter.exportMistakes({ format: "md", recordIds: [recordId], filename: "父级筛选" })
  assert.equal(formalMarkdown.saved, true)
  const savedText = [...writtenFiles.values()].find(text => text.includes("# MN4 错题导出")) || ""
  assert.match(savedText, /BODY-right/)
  assert.doesNotMatch(savedText, /BODY-wrong/)
  assert.ok(rendered.length >= 7)
  assert.ok(rendered.every(id => id === "right"))
})

test("所有候选父级不符时，导出明确无匹配，不输出其他章节答案", async () => {
  const recordId = await seedRecord()
  const { previewMistakeExport } = await import("../src/mistake-export")
  answers = [candidate("wrong", "2014年")]
  const markdown = await previewMistakeExport({ format: "md", recordIds: [recordId] })
  assert.match(markdown.markdown, /当前未匹配到答案/)
  assert.doesNotMatch(markdown.markdown, /BODY-wrong/)
})


test("PDF/Markdown 正式导出与快速预览默认跳过手写及子评论，显式开启才读取", async () => {
  const recordId = await seedRecord()
  const manager = await import("../src/mistake-manager")
  const exporter = await import("../src/mistake-export")
  const oldPic = question.excerptPic, oldComments = question.comments
  question.excerptPic = { paint: "question-base", drawing: "question-ink" }
  question.comments = [...oldComments, { type: "TextNote", text: "EXPORT-COMMENT" }]
  answers = [candidate("right", "2013年")]
  notes.right = {noteId:"right",excerptText:"BODY-right",comments:[{type:"TextNote",text:"ANSWER-COMMENT"},{type:"PaintNote",drawing:"answer-ink"}]}
  try {
    for (const format of ["pdf", "md"] as const) {
      for (const run of [exporter.previewMistakeExport, exporter.exportMistakes]) {
        mediaReads.length = 0; sketchReads = 0; writtenFiles.clear()
        const result = await run({ format, recordIds: [recordId] })
        const output = result.html || result.markdown || [...writtenFiles.values()].join("\n")
        assert.doesNotMatch(output, /EXPORT-COMMENT|ANSWER-COMMENT|data-pdf-drawing-id=|data-drawing=|脑图绑定手写/)
        assert.equal(sketchReads, 0)
        assert.ok(!mediaReads.includes("question-ink"))
        assert.ok(!mediaReads.includes("bound-image"))
        assert.ok(!mediaReads.includes("answer-ink"))
        const enabled = await run({ format, recordIds: [recordId], include: { handwriting: true, comments: true } })
        const enabledOutput = enabled.html || enabled.markdown || [...writtenFiles.values()].join("\n")
        assert.match(enabledOutput, /EXPORT-COMMENT/)
        assert.match(enabledOutput, /ANSWER-COMMENT/)
        assert.ok(mediaReads.includes("answer-ink"))
        assert.match(enabledOutput, /脑图绑定手写/)
        assert.ok(mediaReads.includes("question-ink"))
        assert.ok(sketchReads > 0)
      }
    }
    const ordinary = manager.mistakeDetailById(recordId, "question")
    assert.match(ordinary.questionHtml, /EXPORT-COMMENT/)
    assert.match(ordinary.questionHtml, /data-drawing=/)
  } finally { question.excerptPic = oldPic; question.comments = oldComments; delete notes.right }
})
