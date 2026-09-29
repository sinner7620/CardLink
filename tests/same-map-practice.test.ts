import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { collectQuestionTree, questionIdsInTree } from "../src/quick-menu-selection"

test("当前脑图按父节点列题；勾选题目只遮盖直接子卡并可停止", async () => {
  const root: any = { noteId: "root", noteTitle: "章节", colorIndex: 0 }
  const question: any = { noteId: "question", noteTitle: "题目", colorIndex: 1, parentNote: root }
  const answer: any = { noteId: "answer", noteTitle: "答案", colorIndex: 2, parentNote: question }
  const other: any = { noteId: "other", noteTitle: "其他", colorIndex: 3, parentNote: root }
  const tree = collectQuestionTree([root, question, answer, other], undefined, () => true)
  assert.deepEqual(questionIdsInTree(tree), ["root", "question", "answer", "other"])
  assert.equal(tree[0].children[0].title, "题目")

  class View {
    frame: any; bounds: any; superview: any; children: View[] = []; layer: any = {}; note: any
    constructor(frame: any) { this.frame = frame; this.bounds = { x: 0, y: 0, width: frame.width, height: frame.height } }
    addSubview(view: View) { view.superview = this; this.children.push(view) }
    removeFromSuperview() { this.superview?.children.splice(this.superview.children.indexOf(this), 1); this.superview = undefined }
  }
  const window = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const map: any = new View({ x: 0, y: 0, width: 1024, height: 768 }); window.addSubview(map)
  const card: any = new View({ x: 100, y: 100, width: 100, height: 50 }); card.note = question; map.addSubview(card)
  map.selViewLst = [{ note: { note: question }, view: card }]
  map.mindmapNodes = [
    { note: question, frame: { x: 100, y: 100, width: 100, height: 50 } },
    { note: answer, frame: { x: 220, y: 100, width: 100, height: 50 } },
    { note: other, frame: { x: 100, y: 220, width: 100, height: 50 } }
  ]
  const color = { colorWithAlphaComponent() { return this } }
  const exports: any = {}
  const focusedIds: string[] = []
  const sandbox: any = {
    exports, UIView: View, UILabel: View,
    UIColor: { colorWithHexString: () => color, whiteColor: () => color },
    NSTimer: { scheduledTimerWithTimeInterval() {} },
    MNUtil: { selectNotesInMindmap: async () => { map.selViewLst = [{ note: { note: question }, view: card }] } },
    require: (name: string) => name === "./settings"
      ? { loadMatcherSettings: () => ({ answerMaskStyle: "dark" }) }
      : name === "./review-mode"
        ? { mountPracticeNavigationToolbar() {}, removePracticeNavigationToolbar() {} }
        : name === "./note-navigation"
          ? { locateNoteInCurrentMindMap: async () => true, focusNoteInMindMapFocusMode: async (id: string) => { focusedIds.push(id); return "focused" } }
          : { MN: { currnetNotebookId: "book", notebookController: { mindmapView: map } }, delay: async () => {} }
  }
  runInNewContext(transpileModule(readFileSync("src/same-map-practice.ts", "utf8"), {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, sandbox)
  const result = await exports.startSameMapPractice("book", ["question"])
  assert.equal(result.started, true, result.reason)
  assert.deepEqual(focusedIds, ["question"])
  assert.equal(result.answerCount, 1)
  assert.equal(window.children.length + map.children.length, 3)
  assert.equal(exports.revealSameMapQuestion("question"), true)
  assert.equal(map.children.length, 1)
  exports.stopSameMapPractice()
  assert.equal(exports.sameMapPracticeActive(), false)
  assert.equal(map.children.length, 1)
  map.selViewLst = []
  const withoutSelection = await exports.startSameMapPractice("book", ["question"])
  assert.equal(withoutSelection.started, true)
  assert.equal(withoutSelection.answerCount, 1)
  exports.stopSameMapPractice()
})
