import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { createSourceFile, isFunctionDeclaration, ScriptTarget, transpileModule } from "typescript"
import { getBindingForMode, usesSubcardAnswers } from "../src/binding"

const source = readFileSync("src/plugin.ts", "utf8")
const ast = createSourceFile("plugin.ts", source, ScriptTarget.Latest, true)
const names = new Set(["resolveAnswerLookupContext", "findCurrentAnswer", "onReviewModeAnswer"])
const compiled = transpileModule(ast.statements.filter(n => isFunctionDeclaration(n) && names.has(n.name?.text || ""))
  .map(n => n.getText(ast)).join("\n"), { compilerOptions: { module: 1, target: 7 } }).outputText

test("批注复习按队列来源和脑图绑定查子卡/答案脑图，不读取屏幕当前绑定", async () => {
  for (const subcard of [true, false]) {
    const item = { sourceNoteId: 'q', sourceNotebookId: 'source', sourceRootNodeId: 'root' }
    const owner = { cardLinkReviewMode: { writingMode: 'annotation', items: [item], index: 0 } }
    const question: any = { noteId: 'q', notebookId: 'source', colorIndex: 1, noteTitle: '题目', childNotes: [{ noteId: 'child', notebookId: 'source' }] }
    class Node {
      note: any
      constructor(note: any) { this.note = note }
      get title() { return this.note.noteTitle }
      get titles() { return [this.title] }
      ancestorNodes = []
      get childNodes(): Node[] { return (this.note.childNotes || []).map((n: any) => new Node(n)) }
    }
    const calls: any[] = [], opened: any[] = []
    const binding: any = subcard ? { notebookId: 'source', designatedAnswer: 'subcard', questionColors: [1] } : { notebookId: 'answer-book', rootNodeId: 'answer-root' }
    const bindings = { 'source::root::root': binding, wrong: { notebookId: 'wrong-answers' } }
    const lookup: any = { exports: {}, require: (name: string) => name === './binding' ? { usesSubcardAnswers } : name === './matcher' ? {
      toIndexedAnswer: (note: any, notebookId: string) => ({ answer: { id: note.noteId, noteId: note.noteId, notebookId, titles: ['答案'] } }),
      findAnswers: (target: any) => {
        calls.push(target)
        if (calls.length === 1) throw Error('index needs refresh')
        return [{ id: 'remote', noteId: 'remote', notebookId: target.notebookId, titles: ['答案'] }]
      }
    } : name === './ordered-pairing' ? { pairedAnswerReference: () => undefined } : {} }
    runInNewContext(transpileModule(readFileSync('src/answer-lookup.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, lookup)
    let pending: Promise<void> = Promise.resolve()
    const sandbox: any = {
      exports: {}, self: owner, MN: { db: { getNoteById: () => question } }, NodeNote: Node,
      currentNotebookId: () => 'wrong', selectedQuestion: () => { throw Error('must use queued card') },
      mistakeAnswerContext: (_q: any, book: string) => { assert.equal(book, 'source'); return undefined },
      sourceMindMapId: () => { throw Error('must use queued root') },
      bindingForSource: (book: string, root: string) => getBindingForMode(bindings, book, root, true),
      effectiveAnswerTarget: (target: any) => target,
      recordRuntimeState() {}, showHUD: (message: string) => { throw Error(message) },
      recoverAnswerIndexError: async () => 'refreshed',
      findAnswersForQuestion: lookup.exports.findAnswersForQuestion,
      distinctAnswers: (answers: any) => answers, excludeAnswerNoteId: (answers: any) => answers,
      preferredAnswer: (_book: string, _note: string, answers: any[]) => answers[0],
      showAnswer: async (_title: string, answer: any, _matches: any, context: any, host: any) => opened.push({ answer, context, host }),
      loadMatcherSettings: () => ({ subcardAnswerDisplay: 'reveal' }),
      revealSameMapQuestion: () => { throw Error('must not reveal behind annotation editor') },
      runSafely: (action: () => Promise<void>) => { pending = action(); return pending }
    }
    runInNewContext(compiled, sandbox)
    sandbox.exports.onReviewModeAnswer()
    await pending
    assert.equal(opened[0].host, owner)
    assert.equal(opened[0].context.notebookId, 'source')
    assert.equal(opened[0].answer.noteId, subcard ? 'child' : 'remote')
    assert.equal(calls.length, subcard ? 0 : 2)
    if (!subcard) assert.equal(calls[0].rootNodeId, 'answer-root')
  }
})
