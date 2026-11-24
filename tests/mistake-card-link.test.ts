import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { CardLinkError } from "../src/errors"
import { commentNoteReferenceId, noteReferenceUrlCandidates } from "../src/note-link"

const nativeModule = transpileModule(readFileSync("src/mistake-card-link.ts", "utf8"), {
  compilerOptions: { module: 1, target: 7 },
}).outputText

function fixture(sourceNotebookId = "current-book") {
  const recordId = "book:question"
  const makeNote = (noteId: string) => ({
    noteId, comments: [] as Array<{ type: string; text: string }>,
    linkedNotes: [] as Array<{ noteid: string }>,
    appendNoteLink(note: { noteId: string }) {
      this.comments.push({ type: "TextNote", text: noteReferenceUrlCandidates(note.noteId)[0] })
    },
  })
  const source = makeNote("question")
  const target = makeNote("target")
  let skipUndoFor: string | undefined
  let oneSideFails = false
  const append = source.appendNoteLink
  source.appendNoteLink = function (note) {
    if (oneSideFails) throw new Error("source write failed")
    append.call(this, note)
  }
  const node = { note: target, frame: { x: 60, y: 20, width: 30, height: 20 } }
  const map = { mindmapNodes: [node], selViewLst: [] as any[] }
  const canvas = { className: "MindMapCanvas", superview: map }
  let hitView: any = canvas
  let calibration: any
  const window = {
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    hitTestWithEvent(point: any) {
      assert.equal(point.x, 540)
      assert.equal(point.y, 220)
      return hitView
    },
    convertPointToView(point: any, view: any) {
      assert.equal(view, canvas)
      return { x: point.x - 470, y: point.y - 190 }
    },
  }
  const webView = {
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    convertPointToView(point: any, view: any) {
      assert.equal(view, window)
      return { x: point.x + 100, y: point.y + 10 }
    },
  }
  let sourceAvailable = true
  let debug = false
  const logs: string[] = []
  const writes: string[] = []
  const exports: any = {}
  const modules: Record<string, unknown> = {
    marginnote: { MN: {
      app: {
        studyController: (owner: any) => {
          assert.equal(owner, window)
          return { notebookController: { notebookId: "current-book", mindmapView: map } }
        },
        refreshAfterDBChanged: (id: string) => writes.push(`refresh:${id}`),
      },
      db: {
        getNoteById: (id: string) => id === target.noteId ? target : sourceAvailable ? source : undefined,
        setNotebookSyncDirty: (id: string) => writes.push(`sync:${id}`),
      },
    } },
    "./errors": { CardLinkError },
    "./mistake-store": { loadMistakeState: () => ({ records: { [recordId]: { sourceNoteId: source.noteId, sourceNotebookId } } }) },
    "./note-link": { commentNoteReferenceId },
    "./note-navigation": { recordRuntimeState: (_scope: string, label: string, detail: string) => logs.push(`${label} ${detail}`) },
    "./settings": { loadMatcherSettings: () => ({ debugModeEnabled: debug }) },
    "./same-map-practice": {
      nativeViewClass: (view: any) => view.className ?? "",
      canvasCalibration: () => calibration,
    },
  }
  runInNewContext(nativeModule, {
    exports,
    require: (name: string) => modules[name],
    UndoManager: { sharedInstance: () => ({
      undoGrouping(_action: string, id: string, write: () => void) {
        writes.push(`undo:${id}`)
        if (id !== skipUndoFor) write()
      },
    }) },
  })
  return {
    target, source, node, map, canvas, writes, logs,
    enableDebug: () => { debug = true },
    skipUndoFor: (id: string) => { skipUndoFor = id },
    failSourceWrite: (value: boolean) => { oneSideFails = value },
    setHit: (view: any) => { hitView = view },
    hideSource: () => { sourceAvailable = false },
    useCalibration: () => {
      map.selViewLst = [{ note: node }]
      calibration = { canvas, calibration: { sx: 1, sy: 1, tx: -30, ty: 0 } }
    },
    hover: () => exports.resolveMistakeDragTarget(window, { x: 540, y: 220 }, {}),
    drop: (id = recordId) => exports.linkMistakeOnDrop(window, webView, { recordId: id, x: 880, y: 420, width: 800, height: 600 }),
  }
}

test("同一学习集在同个撤销组写入两个方向，重复拖放不再写入", () => {
  const h = fixture()
  assert.equal(h.drop().status, "linked")
  assert.equal(h.drop().status, "exists")
  assert.deepEqual(h.writes, ["undo:current-book", "refresh:current-book"])
  assert.deepEqual(h.target.comments, [{ type: "TextNote", text: "marginnote4app://note/question" }])
  assert.deepEqual(h.source.comments, [{ type: "TextNote", text: "marginnote4app://note/target" }])
})

test("跨学习集重拖只补旧链接缺少的方向，原卡所属学习集不执行撤销组时仍写入", () => {
  const h = fixture("source-book")
  h.target.appendNoteLink(h.source)
  h.source.linkedNotes.push({ noteid: h.target.noteId })
  h.skipUndoFor("source-book")
  assert.equal(h.drop().status, "linked")
  assert.deepEqual(h.writes, ["undo:source-book", "sync:source-book", "refresh:source-book"])
  assert.equal(h.target.comments.length, 1)
  assert.deepEqual(h.source.comments, [{ type: "TextNote", text: "marginnote4app://note/target" }])
})

test("一侧写入失败时报告已确认的单向结果，重拖可以补齐并避免重复", () => {
  const h = fixture("source-book")
  h.failSourceWrite(true)
  assert.throws(h.drop, /只确认了一个方向/)
  assert.deepEqual(h.writes, ["undo:current-book", "refresh:current-book", "undo:source-book", "refresh:source-book"])
  h.failSourceWrite(false)
  assert.equal(h.drop().status, "linked")
  assert.equal(h.target.comments.length, 1)
  assert.equal(h.source.comments.length, 1)
})

test("脑图被遮挡、重叠处无法确定最上层或落在原题自身时不写入", () => {
  const covered = fixture()
  covered.setHit({ className: "Overlay" })
  assert.equal(covered.drop().status, "miss")
  assert.deepEqual(covered.writes, [])

  const overlap = fixture()
  overlap.map.mindmapNodes.push({ ...overlap.node, note: { ...overlap.target, noteId: "overlap" } })
  assert.throws(overlap.drop, /重叠卡片/)
  assert.deepEqual(overlap.writes, [])

  overlap.setHit({ note: { noteId: "outside-candidates" }, superview: overlap.canvas })
  assert.throws(overlap.drop, /重叠卡片/)
  assert.deepEqual(overlap.writes, [])

  const own = fixture()
  own.target.noteId = own.source.noteId
  assert.equal(own.drop().status, "sameNote")
  assert.deepEqual(own.writes, [])
})

test("三张卡片完全重叠时，高亮和松手跟随原生命中的卡片", () => {
  const h = fixture()
  const back = { ...h.node, note: { ...h.target, noteId: "back", comments: [] } }
  const front = { ...h.node, note: { ...h.target, noteId: "front", comments: [] } }
  h.map.mindmapNodes = [back, h.node, front]
  const frontView = { note: front, superview: h.canvas }
  h.setHit({ superview: frontView })
  assert.equal(h.hover().note.noteId, "front")

  const targetView = { superview: h.canvas }
  h.map.selViewLst = [{ note: h.node, view: targetView }]
  h.setHit({ superview: targetView })
  assert.equal(h.hover().note.noteId, h.target.noteId)
  assert.equal(h.drop().status, "linked")
  assert.deepEqual(h.source.comments, [{ type: "TextNote", text: "marginnote4app://note/target" }])
  assert.deepEqual(back.note.comments, [])
  assert.deepEqual(front.note.comments, [])
})

test("框架包围子卡时，拖放识别子卡，框架独占的区域仍可链接", () => {
  const h = fixture()
  const frame = {
    frame: { x: 20, y: 5, width: 180, height: 300 },
    note: { ...h.target, noteId: "frame", groupMode: 1, comments: [] },
  }
  Object.assign(h.node, { parentNode: frame })
  h.map.mindmapNodes = [frame, h.node]

  assert.equal(h.hover().note.noteId, h.target.noteId)
  assert.equal(h.drop().status, "linked")
  assert.deepEqual(frame.note.comments, [])

  h.node.frame.x = 100
  assert.equal(h.hover().note.noteId, frame.note.noteId)
})

test("原生命中视图没有笔记 ID 时，四条边唯一对应的卡片仍可链接", () => {
  const h = fixture()
  const outer = {
    frame: { x: 20, y: 5, width: 180, height: 300 },
    note: { ...h.target, noteId: "outer", comments: [] },
  }
  h.node.frame.x = 90
  h.useCalibration()
  h.map.mindmapNodes = [outer, h.node]
  const card = {
    superview: h.canvas,
    bounds: { x: 0, y: 0, width: 30, height: 20 },
    convertRectToView: () => ({ x: 60, y: 20, width: 30, height: 20 }),
  }
  h.setHit({ superview: card })
  assert.equal(h.hover().note.noteId, h.target.noteId)
  assert.equal(h.drop().status, "linked")
  assert.deepEqual(outer.note.comments, [])
})

test("原生边界无法区分完全重合的卡片时，只在调试模式下记录松手的诊断", () => {
  const h = fixture()
  h.map.mindmapNodes.push({ ...h.node, note: { ...h.target, noteId: "other" } })
  h.setHit({
    className: "NativeCard",
    superview: h.canvas,
    bounds: { x: 0, y: 0, width: 30, height: 20 },
    convertRectToView: () => h.node.frame,
  })
  assert.throws(h.drop, /重叠卡片/)
  assert.deepEqual(h.logs, [])
  h.enableDebug()
  assert.throws(h.hover, /重叠卡片/)
  assert.deepEqual(h.logs, [])
  assert.throws(h.drop, /重叠卡片/)
  assert.equal(h.logs.length, 1)
  assert.match(h.logs[0], /target\.ambiguous.*NativeCard\[60,20,30,20\].*hits=2/)
  assert.deepEqual(h.writes, [])
})

test("无关框架覆盖卡片时仍须确认最上层", () => {
  const h = fixture()
  const outer = {
    frame: { x: 20, y: 5, width: 180, height: 300 },
    note: { ...h.target, noteId: "outer", groupMode: 1 },
  }
  h.map.mindmapNodes = [outer, h.node]
  assert.throws(h.drop, /重叠卡片/)

  assert.deepEqual(h.writes, [])
})

test("四级卡片同处时沿笔记父级查找，逐级排除包围子卡的上级", () => {
  const h = fixture()
  const root = {
    frame: { x: 0, y: 0, width: 300, height: 400 },
    note: { noteId: "root", groupMode: 1, parentNote: undefined },
  }
  const levelTwo = {
    frame: { x: 15, y: 5, width: 200, height: 200 },
    note: { noteId: "level-two", groupMode: 0, parentNote: root.note },
  }
  const levelThree = {
    frame: { x: 40, y: 15, width: 80, height: 60 },
    note: { noteId: "level-three", parentNote: levelTwo.note },
  }
  Object.assign(h.target, { parentNote: levelThree.note })
  const ancestorNodes = [levelTwo, root, levelThree].map(node => ({
    frame: node.frame,
    note: { ...h.target, ...node.note, comments: [] },
  }))
  h.map.mindmapNodes = [ancestorNodes[0], h.node, ...ancestorNodes.slice(1)]
  assert.equal(h.hover().note.noteId, h.target.noteId)
  assert.equal(h.drop().status, "linked")
  assert.ok(ancestorNodes.every(node => node.note.comments.length === 0))
})

test("优先使用已选节点的画布校准，原题不可读或记录消失时不写入", () => {
  const h = fixture()
  h.node.frame.x = 90
  assert.equal(h.drop().status, "miss")
  h.useCalibration()
  assert.equal(h.drop().status, "linked")

  const unavailable = fixture()
  unavailable.hideSource()
  assert.throws(unavailable.drop, { code: "sourceNoteUnavailable" })
  assert.throws(() => unavailable.drop("missing"), { code: "mistakeRecordMissing" })
  assert.deepEqual(unavailable.writes, [])
})
