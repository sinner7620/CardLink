import assert from "node:assert/strict"
import test, { mock } from "node:test"

const events: string[] = []
const store = new Map<string, unknown>()
const note = { noteId: "question", notebookId: "target", docMd5: "document" }
const notebookController = {
  notebookId: "source",
  changeFocusToNote: (item: typeof note) => events.push("focus-root:" + item.noteId),
}
const studyController = {
  studyMode: 2,
  openNotebookAndDocument: (notebookId: string, documentId: string) => {
    events.push(`open:${notebookId}:${documentId}`)
    notebookController.notebookId = notebookId
    studyController.studyMode = 3
  },
  focusNoteInMindMapById: (id: string) => events.push("focus-map:" + id),
  focusNoteInFloatMindMapById: (id: string) => events.push("focus-float:" + id),
}
const app = { openURL: (url: string) => events.push(url) }
mock.module("marginnote", { namedExports: {
  MN: {
    db: { getNoteById: () => note, getNotebookById: () => ({}) },
    app,
    studyController,
    notebookController,
    get currnetNotebookId() { return notebookController.notebookId },
  },
  delay: async () => { await new Promise(resolve => setImmediate(resolve)) },
  genNSURL: (url: string) => url,
  getLocalDataByKey: (key: string) => store.get(key),
  setLocalDataByKey: (value: unknown, key: string) => store.set(key, value),
  showHUD() {},
  saveFile() {},
  writeTextFile() {},
  isNSNull: () => false,
} })
Object.assign(globalThis, { __APP_VERSION__: "test", self: {} })

test("跨学习集复习等到目标学习界面就绪，生命周期接力只聚焦一次", async () => {
  const { openNoteInMindMap, completePendingNoteNavigation } = await import("../src/note-navigation")
  const pending = openNoteInMindMap("question", "target", { enterFocusMode: true })
  assert.deepEqual(events, ["open:target:document"])
  const handoff = completePendingNoteNavigation("target")
  studyController.studyMode = 2
  assert.equal(await pending, undefined)
  await handoff
  assert.deepEqual(events, ["open:target:document", "focus-root:question", "focus-map:question"])
})

test("无来源文档时打开学习集链接，再在浮窗中定位原题", async () => {
  const { openNoteInMindMap } = await import("../src/note-navigation")
  events.length = 0
  note.docMd5 = ""
  notebookController.notebookId = "source"
  const pending = openNoteInMindMap("question", "target", { inFloat: true })
  assert.deepEqual(events, ["marginnote4app://notebook/target"])
  notebookController.notebookId = "target"
  assert.equal(await pending, undefined)
  assert.deepEqual(events, ["marginnote4app://notebook/target", "focus-float:question"])
})
