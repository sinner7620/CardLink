import assert from "node:assert/strict"
import test from "node:test"
import { mindMapScopeIdForNote, noteBelongsToMindMapScope, MAIN_MINDMAP_SCOPE_ID } from "../src/mindmap-candidate"
import { notebookContainsNote } from "../src/note-tree"

test("普通子脑图卡片首次读取直接解析归属，不枚举学习集", () => {
  let scans = 0
  const scope = mindMapScopeIdForNote({ noteId: "question", childMindMap: { noteId: "child-root" } }, () => {
    scans++
    throw new Error("不应扫描")
  })
  assert.equal(scope, "child-root")
  assert.equal(scans, 0)
})

test("无 childMindMap 的根卡片仍使用候选区分子脑图根与主脑图", () => {
  let scans = 0
  const candidates = () => { scans++; return ["child-root"] }
  assert.equal(mindMapScopeIdForNote({ noteId: "child-root" }, candidates), "child-root")
  assert.equal(mindMapScopeIdForNote({ noteId: "main-card" }, candidates), MAIN_MINDMAP_SCOPE_ID)
  assert.equal(scans, 2)
  assert.equal(mindMapScopeIdForNote(null, candidates), MAIN_MINDMAP_SCOPE_ID)
  assert.equal(scans, 2)
})

test("菜单单卡归属直接验证学习集 ID，包括跨学习集拒绝", () => {
  const notebook = { topicId: "current", get notes(): never { throw new Error("不应枚举") } }
  assert.equal(notebookContainsNote(notebook, { noteId: "card", notebookId: "current" }), true)
  assert.equal(notebookContainsNote(notebook, { noteId: "card", notebookId: "other" }), false)
  assert.equal(notebookContainsNote(notebook, undefined), false)
})

test("新建答案卡片验证具体子脑图时不扫描；主脑图仍排除子脑图根", () => {
  const noScan = (): never => { throw new Error("不应扫描") }
  assert.equal(noteBelongsToMindMapScope({ noteId: "answer", childMindMap: { noteId: "root" } }, "root", noScan), true)
  assert.equal(noteBelongsToMindMapScope({ noteId: "root" }, "root", noScan), true)
  assert.equal(noteBelongsToMindMapScope({ noteId: "other" }, "root", noScan), false)
  assert.equal(noteBelongsToMindMapScope({ noteId: "root" }, MAIN_MINDMAP_SCOPE_ID, () => ["root"]), false)
})

test("缺少单卡学习集字段时保留旧运行时归属验证", () => {
  const notebook = { topicId: "legacy", notes: [{ noteId: "legacy-card" }] }
  assert.equal(notebookContainsNote(notebook, { noteId: "legacy-card" }), true)
  assert.equal(notebookContainsNote(notebook, { noteId: "missing" }), false)
  assert.equal(notebookContainsNote(undefined, { noteId: "legacy-card" }), false)
})
