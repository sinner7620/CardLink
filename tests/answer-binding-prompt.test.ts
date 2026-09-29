import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { createSourceFile, isFunctionDeclaration, ScriptTarget, transpileModule } from "typescript"

const source = readFileSync("src/plugin.ts", "utf8")
const ast = createSourceFile("plugin.ts", source, ScriptTarget.Latest, true)
const names = new Set(["findCurrentAnswer", "chooseCurrentAnswerBinding", "bindCurrentSubcards"])
const functions = ast.statements.filter(node => isFunctionDeclaration(node) && names.has(node.name?.text || ""))
  .map(node => node.getText(ast)).join("\n")
const compiled = transpileModule(functions, { compilerOptions: { module: 1, target: 7 } }).outputText

function harness(confirm: number, option: number, fromMistake = false) {
  const dialogs: any[] = [], choices: any[] = [], mindmapCalls: any[] = [], bindings: any = {}
  const question = { note: { noteId: "original-question" }, title: "题目" }
  let saved = 0
  const sandbox: any = {
    exports: {},
    resolveAnswerLookupContext: () => ({ lookupQuestion: question, questionNotebookId: "display-book",
      sourceNotebookId: "source-book", sourceRootNodeId: "source-root", questionTitle: "题目",
      mistakeContext: fromMistake ? { record: { sourceNotebookTitle: "原题" } } : undefined }),
    recordRuntimeState() {}, showHUD() {},
    popup: async (options: any) => { dialogs.push(options); return { buttonIndex: confirm } },
    select: async (...args: any[]) => { choices.push(args); return { index: option } },
    bindAnswerNotebook: async (...args: any[]) => mindmapCalls.push(args),
    currentNotebookId: () => "wrong-current-book", selectedQuestion: () => { throw new Error("Must use lookup question") },
    sourceMindMap: (book: string, node: any) => {
      assert.equal(book, "source-book"); assert.equal(node, question)
      return { rootNodeId: "source-root", title: "原题脑图" }
    },
    scopedBindingEnabled: () => true, loadBindings: () => bindings,
    bindingKey: (book: string, root: string) => `${book}:${root}`, normalizeBinding: (value: any) => value,
    saveBindings: () => { saved++ }, notifyBindingSettingsChanged() {}
  }
  runInNewContext(compiled, sandbox)
  return { api: sandbox.exports, dialogs, choices, mindmapCalls, bindings, question, saved: () => saved }
}

test("未绑定提示只有一个显式操作和一个系统取消，取消不进入绑定", async () => {
  const h = harness(-1, 0)
  await h.api.findCurrentAnswer()
  assert.equal(h.dialogs[0].title, "尚未绑定答案")
  assert.deepEqual(Array.from(h.dialogs[0].buttons), ["立即绑定"])
  assert.equal(h.dialogs[0].canCancel, true)
  assert.equal(h.choices.length, 0)
  assert.equal(h.saved(), 0)
})

test("立即绑定提供两个来源，答案脑图分支保留原题上下文", async () => {
  const h = harness(0, 0, true)
  await h.api.findCurrentAnswer()
  assert.deepEqual(Array.from(h.choices[0][0]), ["绑定答案脑图", "绑定子卡片"])
  assert.equal(h.choices[0][3], true)
  assert.equal(h.mindmapCalls[0][0], "source-book")
  assert.equal(h.mindmapCalls[0][1], h.question)
  assert.equal(h.saved(), 0)
})

test("子卡片分支绑定原题所在脑图，不绑定当前错题页面", async () => {
  const h = harness(0, 1, true)
  await h.api.findCurrentAnswer()
  assert.equal(h.saved(), 1)
  assert.equal(h.bindings["source-book:source-root"].designatedAnswer, "subcard")
  assert.equal(h.bindings["source-book:source-root"].selectionMode, "designated")
  assert.equal(h.mindmapCalls.length, 0)
})

test("来源选择取消不改变绑定", async () => {
  const h = harness(0, -1)
  await h.api.findCurrentAnswer()
  assert.equal(h.saved(), 0)
  assert.equal(h.mindmapCalls.length, 0)
})
