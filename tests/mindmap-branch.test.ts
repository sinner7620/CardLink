import { before, mock, test } from "node:test"
import assert from "node:assert/strict"

const cards = new Map<string, any>()
let scans = 0
let fullNotes: any[] = []
const snapshots = new Map<string, any[]>()

class Node {
  constructor(public note: any) { if (note.group) this.note = note.group }
  get nodeId() { return this.note.noteId }
  get title() { return this.note.noteTitle || "" }
  get titles() { return [this.title] }
  get childNodes(): Node[] { return Array.from(this.note.childNotes ?? [], (child: any) => new Node(child)) }
  get ancestorNodes(): Node[] {
    const result: Node[] = [], seen = new Set<string>()
    let parent = this.note.parentNote
    while (parent && !seen.has(parent.noteId)) { seen.add(parent.noteId); result.push(new Node(parent)); parent = parent.parentNote }
    return result
  }
}

mock.module("marginnote", { namedExports: {
  NodeNote: Node, delay: async () => {},
  MN: { db: {
    getNoteById: (id: string) => cards.get(id),
    getNotebookById: () => ({ topicId: "nb", get notes() { scans++; return fullNotes } })
  } }
} })
mock.module("../src/note-navigation", { namedExports: { captureDiagnosticError() {}, recordRuntimeState() {} } })
mock.module("../src/index-store", { namedExports: {
  loadStoredIndex: () => undefined, storedIndexUpdatedAt: () => "",
  saveStoredIndex: (key: string, value: any[]) => snapshots.set(key, value)
} })
mock.module("../src/bound-handwriting", { namedExports: { appendBoundMindMapHandwriting: (html: string) => html, readBoundMindMapHandwriting: () => ({ assets: [] }) } })
mock.module("../src/settings", { namedExports: { loadMatcherSettings: () => ({}) } })

let readMindMapBranch: typeof import("../src/mindmap-scope").readMindMapBranch
let collectPairingGroupsForScope: typeof import("../src/ordered-pairing").collectPairingGroupsForScope
let refreshIndex: typeof import("../src/matcher").refreshIndex
let MAIN_MINDMAP_SCOPE_ID: string
before(async () => {
  ;({ readMindMapBranch } = await import("../src/mindmap-scope"))
  ;({ collectPairingGroupsForScope } = await import("../src/ordered-pairing"))
  ;({ refreshIndex } = await import("../src/matcher"))
  ;({ MAIN_MINDMAP_SCOPE_ID } = await import("../src/mindmap-candidate"))
})

function seed() {
  cards.clear(); snapshots.clear(); scans = 0
  const root: any = { noteId: "root", notebookId: "nb", noteTitle: "第一章", childNotes: [] }
  const a: any = { noteId: "a", notebookId: "nb", noteTitle: "题一", childMindMap: root, parentNote: root, childNotes: [] }
  const b: any = { noteId: "b", notebookId: "nb", noteTitle: "题二", childMindMap: root, parentNote: root, childNotes: [] }
  const unrelated: any = { noteId: "other", notebookId: "nb", noteTitle: "无关", childNotes: [] }
  root.childNotes = [a, b]
  fullNotes = [root, a, b, unrelated]
  for (const card of fullNotes) cards.set(card.noteId, card)
  return { root, a, b, unrelated }
}

test("具体脑图只读取目标分支；保持父节点下题目顺序，索引排除其他脑图", async () => {
  seed()
  assert.deepEqual(readMindMapBranch("nb", "root")?.map(note => note.noteId), ["root", "a", "b"])
  const groups = collectPairingGroupsForScope("nb", "root")
  assert.deepEqual(groups.map(group => group.children.map(child => child.noteId)), [["a", "b"]])
  const result = await refreshIndex({ notebookId: "nb", rootNodeId: "root" })
  assert.equal(result.indexedCards, 3)
  assert.equal(result.skippedCards, 0)
  assert.deepEqual([...snapshots.values()][0].map(note => note.noteId), ["root", "a", "b"])
  assert.equal(scans, 0)
})

test("别名根不使用局部快照，回退扫描保持索引和顺序配对结果", async () => {
  const { root, a } = seed()
  const directGroups = collectPairingGroupsForScope("nb", "root")
  await refreshIndex({ notebookId: "nb", rootNodeId: "root" })
  const directIndex = [...snapshots.values()][0]
  cards.set("root", { ...root, group: { noteId: "alias" } })
  assert.equal(readMindMapBranch("nb", "root"), undefined)
  assert.deepEqual(collectPairingGroupsForScope("nb", "root"), directGroups)
  await refreshIndex({ notebookId: "nb", rootNodeId: "root" })
  assert.deepEqual([...snapshots.values()][0], directIndex)
  assert.ok(scans > 0)
  assert.equal(a.parentNote, root)
})

test("主脑图保留完整发现；缺失或跨学习集的根不使用局部分支", () => {
  const { root } = seed()
  assert.equal(readMindMapBranch("nb", MAIN_MINDMAP_SCOPE_ID), undefined)
  assert.equal(readMindMapBranch("nb", "missing"), undefined)
  assert.equal(readMindMapBranch("other-nb", "root"), undefined)
  assert.deepEqual(collectPairingGroupsForScope("nb", MAIN_MINDMAP_SCOPE_ID), [])
  assert.ok(scans > 0)
  delete root.childNotes
  assert.equal(readMindMapBranch("nb", "root"), undefined)
})

test("循环和重复引用不会重复索引；子树读取异常不会返回半份快照", () => {
  const { root, a, b } = seed()
  a.childNotes = [root, b]
  assert.deepEqual(readMindMapBranch("nb", "root")?.map(note => note.noteId), ["root", "a", "b"])
  Object.defineProperty(b, "childNotes", { get() { throw new Error("原生读取失败") } })
  assert.equal(readMindMapBranch("nb", "root"), undefined)
})
