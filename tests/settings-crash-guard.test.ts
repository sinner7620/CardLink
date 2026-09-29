import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

const plugin = readFileSync("src/plugin.ts", "utf8")

function exportedFunction(name: string, context: Record<string, unknown>): any {
  const body = plugin.match(new RegExp(`export (?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(body, `${name} 应存在`)
  const sandbox: any = { exports: {}, ...context }
  runInNewContext(transpileModule(body, { compilerOptions: { module: 1, target: 7 } }).outputText, sandbox)
  return sandbox.exports[name]
}

test("设置快照读取绑定与当前匹配时不枚举学习集卡片", () => {
  const bindings = { "questions::root::child": { notebookId: "answers", rootNodeId: "answer-root", rootTitle: "标准答案" } }
  let noteReads = 0
  const notebook = { title: "题目学习集", get notes() { noteReads++; throw new Error("设置快照不应读取全学习集卡片") } }
  const context = {
    MN: { db: { getNotebookById: () => notebook, getNoteById: () => ({ noteTitle: "题目脑图" }) } },
    MAIN_MINDMAP_SCOPE_ID: "main",
    loadBindings: () => bindings,
    normalizeBinding: (value: any) => value,
    notebookTitle: () => "题目学习集",
    targetTitle: () => "答案学习集 › 标准答案"
  }
  const rows = exportedFunction("managedAnswerBindings", context)()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sourceTitle, "题目脑图")
  assert.equal(noteReads, 0)

  const matching = exportedFunction("answerMatchingSettingsData", {
    ...context,
    loadMatcherSettings: () => ({ allowSameStudySetMindMap: true, sourceLocateMode: "locate", subcardAnswerDisplay: "window", answerMaskStyle: "dark", autoCollapseComments: false }),
    currentNotebookId: () => "questions",
    selectedQuestion: () => ({ note: { noteId: "child", childMindMap: { noteId: "child" } } }),
    mindMapScopeIdForNote: () => "child",
    getBindingForMode: (value: any, _notebookId: string, rootId: string) => value[`questions::root::${rootId}`],
    matchingModeLabel: () => "完整标题匹配"
  })()
  assert.equal(matching.bound, true)
  assert.equal(noteReads, 0)
})

test("添加颜色只读取当前选中的题目卡片，不扫描学习集", () => {
  const note = { noteId: "question", colorIndex: 4, childMindMap: { noteId: "child" } }
  const selectedCopy = { ...note, colorIndex: 5 }
  let saved: any
  const add = exportedFunction("addManagedAnswerBindingColor", {
    loadBindings: () => ({ "questions::root::child": { questionColors: [2] } }),
    normalizeBinding: (value: any) => value,
    MAIN_MINDMAP_SCOPE_ID: "main",
    currentNotebookId: () => "questions",
    NodeNote: { getSelectedNodes: () => [{ note: selectedCopy }] },
    MN: { notebookController: { mindmapView: { mindmapNodes: [{ note }] } }, db: { getNotebookById: () => { throw new Error("不得扫描学习集") } } },
    mindMapScopeIdForNote: () => "child",
    updateManagedAnswerBinding: (_key: string, changes: any) => { saved = changes }
  })
  assert.equal(add("questions::root::child").color, 4)
  assert.deepEqual(Array.from(saved.questionColors), [2, 4])
})

test("绑定管理排序不随存储对象的枚举顺序变化", () => {
  const entries = [
    ["questions::root::z", { notebookId: "answers", rootNodeId: "answer-z" }],
    ["questions::root::a", { notebookId: "answers", rootNodeId: "answer-a" }]
  ] as const
  let reversed = false
  const rows = exportedFunction("managedAnswerBindings", {
    MN: { db: { getNoteById: (id: string) => ({ noteTitle: id }) } },
    MAIN_MINDMAP_SCOPE_ID: "main",
    loadBindings: () => Object.fromEntries(reversed ? [...entries].reverse() : entries),
    normalizeBinding: (value: any) => value,
    notebookTitle: () => "题目学习集",
    targetTitle: () => "答案脑图"
  })
  const first = Array.from(rows(), (row: any) => row.key)
  reversed = true
  assert.deepEqual(Array.from(rows(), (row: any) => row.key), first)
  assert.deepEqual(first, ["questions::root::a", "questions::root::z"])
})
