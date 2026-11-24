import { windowOpacityFixture } from "./window-opacity-fixture"
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { collectQuestionTree, questionIdsInTree } from "../src/quick-menu-selection"
import { createFoldHost, loadMindmapFold } from "./mindmap-fold-fixture"

// 未授权场景面板：折叠优先不可用，这些用例验证沿用原有遮盖流程。
function unavailableFold() {
  return loadMindmapFold(createFoldHost({ available: false }))
}

class MaskTestLayer {
  superlayer: any; sublayers: MaskTestLayer[] = []; opacity = 1; additions = 0
  constructor(public owner: any) {}
  addSublayer(layer: MaskTestLayer) {
    layer.removeFromSuperlayer()
    this.sublayers.push(layer); layer.superlayer = this; this.additions++
  }
  removeFromSuperlayer() {
    if (this.superlayer) this.superlayer.sublayers = this.superlayer.sublayers.filter((item: any) => item !== this)
    this.superlayer = undefined
  }
}
function maskLayers(map: any): MaskTestLayer[] {
  return map.layer.sublayers.filter((layer: MaskTestLayer) => !layer.owner.superview)
}
function lifecycleHarness(settings: any = { answerMaskStyle: "dark" }) {
  class View {
    frame: any; bounds: any; superview: any; subviews: any[] = []; layer: any = new MaskTestLayer(this)
    constructor(frame: any) { this.frame = frame; this.bounds = { x: 0, y: 0, width: frame.width, height: frame.height } }
    addSubview(view: any) { view.superview = this; if (!this.subviews.includes(view)) this.subviews.push(view) }
    removeFromSuperview() { if (this.superview) this.superview.subviews = this.superview.subviews.filter((view: any) => view !== this); this.superview = undefined }
  }
  const question = { noteId: "question" }, answer = { noteId: "answer", parentNote: question }
  const window = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const map: any = new View({ x: 0, y: 0, width: 1024, height: 768 }); window.addSubview(map)
  const card = new View({ x: 100, y: 100, width: 100, height: 50 }); map.addSubview(card)
  const questionNode = { note: question, frame: card.frame }
  const answerNode = { note: answer, frame: { x: 220, y: 100, width: 100, height: 50 } }
  map.mindmapNodes = [questionNode, answerNode]
  map.className = "MindMapCanvas"; map.selViewLst = [{ note: { note: question }, view: card }]
  const controller = { notebookId: "book", mindmapView: map }
  const color = { colorWithAlphaComponent() { return this } }
  let focus: () => Promise<string> = async () => "focused", selections = 0
  let pause: () => Promise<void> = async () => {}
  let select: () => void = () => { map.selViewLst = [{ note: { note: question }, view: card }] }
  const timers: Array<() => void> = [], exports: any = {}
  runInNewContext(transpileModule(readFileSync("src/same-map-practice.ts", "utf8"), {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, {
    exports, UIView: View, UILabel: View, UIImageView: View,
    NSData: { dataWithStringEncoding: () => ({ length: () => 1 }) },
    UIImage: { imageWithData: () => ({ decoded: true }) },
    UIColor: { colorWithHexString: () => color, whiteColor: () => color },
    NSTimer: { scheduledTimerWithTimeInterval(_time: number, _repeat: boolean, callback: () => void) { timers.push(callback) } },
    MNUtil: { selectNotesInMindmap: async () => { selections++; select() } },
    require: (name: string) => name === "./base64" ? { decodeBase64Ascii: () => "image" }
      : name === "./window-opacity" ? windowOpacityFixture(View) : name === "./settings" ? { loadMatcherSettings: () => settings }
      : name === "./note-navigation" ? { focusNoteInMindMapFocusMode: () => focus() }
        : name === "./mindmap-fold" ? unavailableFold()
        : { MN: { currnetNotebookId: "book", notebookController: controller }, delay: () => pause(), showHUD() {} }
  })
  return { api: exports, map, card, View, controller, timers, answerNode, questionNode,
    setFocus(fn: typeof focus) { focus = fn }, setPause(fn: typeof pause) { pause = fn }, setSelect(fn: typeof select) { select = fn },
    get selections() { return selections } }
}

test("答案脑图做题无需子卡/Canvas/遮盖配置，按队列聚焦且不启动遮盖轮询", async () => {
  const h = lifecycleHarness()
  const focused: string[] = []
  h.setFocus(async () => { focused.push("focused"); return "focused" })
  Object.defineProperty(h.map, "selViewLst", { get() { assert.fail("只聚焦模式不校准选卡视图") } })
  Object.defineProperty(h.map, "mindmapNodes", { get() { assert.fail("只聚焦模式不遍历子卡答案") } })
  const result = await h.api.startSameMapPractice("book", ["question", "second"], { maskAnswers: false })
  assert.equal(result.started, true, result.reason)
  assert.equal(result.maskAnswers, false)
  assert.equal(result.answerCount, 0)
  assert.deepEqual(Array.from(h.api.sameMapPracticeQuestionIds()), ["question", "second"])
  assert.equal(h.api.sameMapPracticeActive(), true)
  assert.equal(h.api.sameMapPracticeCurrentQuestionId(), 'question')
  assert.equal(h.api.revealSameMapQuestion("question"), false, "答案查找不能把无遮盖会话误报为揭开成功")
  assert.equal(await h.api.navigateSameMapPractice("second"), true)
  assert.equal(h.api.sameMapPracticeCurrentQuestionId(), 'second')
  assert.equal(await h.api.navigateSameMapPractice("outside"), false)
  assert.equal(h.api.sameMapPracticeCurrentQuestionId(), 'second')
  assert.equal(focused.length, 2)
  assert.equal(h.selections, 0)
  assert.equal(h.timers.length, 0)
  h.api.stopSameMapPractice()
  assert.equal(h.api.sameMapPracticeActive(), false)
  assert.equal(h.api.sameMapPracticeCurrentQuestionId(), undefined)
  assert.deepEqual(Array.from(h.api.sameMapPracticeQuestionIds()), [])
})

test("只聚焦模式的定位失败不创建会话；待定位时停止不重启旧队列", async () => {
  const h = lifecycleHarness()
  h.setFocus(async () => "failed")
  assert.equal((await h.api.startSameMapPractice("book", ["question"], { maskAnswers: false })).started, false)
  assert.equal(h.api.sameMapPracticeActive(), false)
  let finish!: (result: string) => void
  h.setFocus(() => new Promise(resolve => { finish = resolve }))
  const pending = h.api.startSameMapPractice("book", ["question"], { maskAnswers: false })
  h.api.stopSameMapPractice()
  finish("focused")
  assert.equal((await pending).started, false)
  assert.equal(h.api.sameMapPracticeActive(), false)
  assert.equal(h.timers.length, 0)
})

test("只聚焦模式切换学习集后清理旧队列，不定位其他学习集中的旧题", async () => {
  const h = lifecycleHarness()
  assert.equal((await h.api.startSameMapPractice("book", ["question"], { maskAnswers: false })).started, true)
  h.controller.notebookId = "other"
  let focused = false
  h.setFocus(async () => { focused = true; return "focused" })
  assert.equal(await h.api.navigateSameMapPractice("question"), false)
  assert.equal(focused, false)
  assert.equal(h.api.sameMapPracticeActive(), false)
  assert.deepEqual(Array.from(h.api.sameMapPracticeQuestionIds()), [])
})

test("遮盖会话与只聚焦会话互相切换时，旧遮盖和定时器不会污染新会话", async () => {
  const h = lifecycleHarness()
  assert.equal((await h.api.startSameMapPractice("book", ["question"])).started, true)
  const maskedViews = maskLayers(h.map).length
  assert.equal((await h.api.startSameMapPractice("book", ["question"], { maskAnswers: false })).started, true)
  assert.ok(maskLayers(h.map).length < maskedViews)
  for (const tick of [...h.timers]) tick()
  assert.equal(h.timers.length, 1)
  assert.equal(h.api.sameMapPracticeActive(), true)
  assert.equal(h.api.revealSameMapQuestion("question"), false)
  const result = await h.api.startSameMapPractice("book", ["question"], { maskAnswers: true })
  assert.equal(result.started, true)
  assert.equal(result.maskAnswers, true)
  assert.equal(h.api.revealSameMapQuestion("question"), true)
  h.api.stopSameMapPractice()
})

test("校准重试等待期间停止做题，不再继续选择卡片", async () => {
  const h = lifecycleHarness()
  h.map.selViewLst = []
  h.setSelect(() => {})
  let resume!: () => void
  h.setPause(() => new Promise(resolve => { resume = resolve }))
  const pending = h.api.startSameMapPractice("book", ["question"])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.selections, 1)
  h.api.stopSameMapPractice()
  resume()
  assert.equal((await pending).started, false)
  assert.equal(h.selections, 1)
  assert.equal(h.timers.length, 0)
})

test("聚焦前答案尚未渲染时，聚焦完成后重新读取直接子卡并遮盖", async () => {
  const h = lifecycleHarness()
  h.map.mindmapNodes = [h.questionNode]
  h.setFocus(async () => { h.map.mindmapNodes = [h.questionNode, h.answerNode]; return "focused" })
  const result = await h.api.startSameMapPractice("book", ["question"])
  assert.equal(result.started, true, result.reason)
  assert.equal(result.answerCount, 1)
  assert.equal(h.api.sameMapPracticeActive(), true)
  h.api.stopSameMapPractice()
})

test("聚焦期间结束做题，旧启动流程不再选择卡片或启动遮盖", async () => {
  const h = lifecycleHarness()
  let complete!: (result: string) => void
  h.setFocus(() => new Promise(resolve => { complete = resolve }))
  h.map.selViewLst = []
  const pending = h.api.startSameMapPractice("book", ["question"])
  await new Promise(resolve => setImmediate(resolve))
  h.api.stopSameMapPractice()
  complete("focused")
  const result = await pending
  assert.equal(result.started, false)
  assert.equal(h.selections, 0)
  assert.equal(h.timers.length, 0)
  assert.equal(h.api.sameMapPracticeActive(), false)
})

test("新会话已经启动时，晚完成的旧聚焦不选择旧题或结束新会话", async () => {
  const h = lifecycleHarness()
  let complete!: (result: string) => void
  h.setFocus(() => new Promise(resolve => { complete = resolve }))
  const pending = h.api.startSameMapPractice("book", ["question"])
  await new Promise(resolve => setImmediate(resolve))
  h.setFocus(async () => "focused")
  assert.equal((await h.api.startSameMapPractice("book", ["question"])).started, true)
  complete("focused")
  assert.equal((await pending).started, false)
  assert.equal(h.api.sameMapPracticeActive(), true)
  assert.equal(h.timers.length, 1)
  h.api.stopSameMapPractice()
})

test("聚焦期间切换学习集，不在新学习集建立旧题遮盖", async () => {
  const h = lifecycleHarness()
  h.setFocus(async () => { h.controller.notebookId = "other"; return "focused" })
  const result = await h.api.startSameMapPractice("book", ["question"])
  assert.equal(result.started, false)
  assert.match(result.reason, /学习集已切换/)
  assert.equal(h.selections, 0)
  assert.equal(h.timers.length, 0)
})

test("没有直接子卡时不启动；停止后旧定时回调不恢复遮盖", async () => {
  const h = lifecycleHarness()
  h.map.mindmapNodes = [h.questionNode]
  assert.equal((await h.api.startSameMapPractice("book", ["question"])).started, false)
  h.map.mindmapNodes.push(h.answerNode)
  assert.equal((await h.api.startSameMapPractice("book", ["question"])).started, true)
  h.api.stopSameMapPractice()
  for (const tick of [...h.timers]) tick()
  assert.equal(h.timers.length, 1)
  assert.equal(h.api.sameMapPracticeActive(), false)
})

test('遮挡只挂载 Canvas 图层，保留载体且停止后完整移除', async () => {
  const h = lifecycleHarness()
  const children = h.map.subviews.length
  assert.equal((await h.api.startSameMapPractice('book', ['question'])).started, true)
  const [mask] = maskLayers(h.map)
  assert.ok(mask)
  assert.equal(h.map.subviews.length, children)
  assert.equal(mask.owner.superview, undefined)
  assert.equal(mask.owner.subviews[0].text, '答案已遮盖')
  assert.deepEqual({ ...mask.owner.frame }, h.answerNode.frame)
  assert.equal(mask.opacity, 1)
  h.api.stopSameMapPractice()
  assert.equal(mask.superlayer, undefined)
  assert.equal(maskLayers(h.map).length, 0)
})

test('图层随答案更新，稳定轮询不重新挂载，宿主移除后恢复', async () => {
  const h = lifecycleHarness()
  assert.equal((await h.api.startSameMapPractice('book', ['question'])).started, true)
  const [mask] = maskLayers(h.map)
  const additions = h.map.layer.additions
  h.answerNode.frame = { x: 240, y: -20, width: 130, height: 70 }
  h.timers.shift()!()
  assert.deepEqual({ ...mask.owner.frame }, h.answerNode.frame, '顶栏区域不夹紧坐标')
  assert.equal(h.map.layer.additions, additions)
  mask.removeFromSuperlayer()
  h.timers.shift()!()
  assert.equal(mask.superlayer, h.map.layer)
  assert.equal(h.map.layer.additions, additions + 1)
  assert.equal(h.api.revealSameMapQuestion('question'), true)
  assert.equal(maskLayers(h.map).length, 0)
  h.api.stopSameMapPractice()
})

test('不把 UIScrollView 误当 Canvas；接口不可用时明确失败', async () => {
  for (const missing of ['class', 'layer']) {
    const h = lifecycleHarness()
    if (missing === 'class') h.map.className = 'UIScrollView'
    else h.map.layer.addSublayer = undefined
    const result = await h.api.startSameMapPractice('book', ['question'])
    assert.equal(result.started, false)
    assert.match(result.reason, /MindMapCanvas/)
    assert.equal(h.timers.length, 0)
    assert.equal(maskLayers(h.map).length, 0)
  }
})

test('跨缩放容器校准到真实 Canvas，原生转换可用时优先使用', async () => {
  for (const native of [false, true]) {
    const h = lifecycleHarness()
    const wrapper: any = new h.View({ x: 10, y: 20, width: 400, height: 200 })
    wrapper.bounds = { x: 5, y: 10, width: 200, height: 100 }
    wrapper.className = 'UIScrollView'
    h.card.removeFromSuperview()
    h.map.addSubview(wrapper); wrapper.addSubview(h.card)
    if (native) (h.card as any).convertRectToView = (_bounds: any, canvas: any) => {
      assert.equal(canvas, h.map)
      return { x: 100, y: 110, width: 100, height: 50 }
    }
    assert.equal((await h.api.startSameMapPractice('book', ['question'])).started, true)
    const [mask] = maskLayers(h.map)
    assert.ok(mask)
    assert.deepEqual({ ...mask.owner.frame }, native
      ? { x: 220, y: 110, width: 100, height: 50 }
      : { x: 440, y: 200, width: 200, height: 100 })
    assert.equal(maskLayers(wrapper).length, 0)
    h.api.stopSameMapPractice()
  }
})

test('图片与颜色保留在脱离视图树的载体，缩放时同步图片和文字布局', async () => {
  const h = lifecycleHarness({ answerMaskStyle: 'dark', answerMaskColor: '#123456', answerMaskImage: 'test' })
  assert.equal((await h.api.startSameMapPractice('book', ['question'])).started, true)
  const [mask] = maskLayers(h.map)
  const [image, label] = mask.owner.subviews
  assert.equal(image.image.decoded, true)
  assert.equal(image.contentMode, 2)
  assert.equal(mask.owner.superview, undefined)
  h.answerNode.frame = { x: 200, y: 60, width: 160, height: 120 }
  h.timers.shift()!()
  assert.deepEqual({ ...image.frame }, { x: 0, y: 0, width: 160, height: 120 })
  assert.deepEqual({ ...label.frame }, { x: 6, y: 41, width: 148, height: 38 })
  h.api.stopSameMapPractice()
})

test("当前脑图按父节点列题；勾选题目只遮盖直接子卡并可停止", async () => {
  const root: any = { noteId: "root", noteTitle: "章节", colorIndex: 0 }
  const question: any = { noteId: "question", noteTitle: "题目", colorIndex: 1, parentNote: root }
  const answer: any = { noteId: "answer", noteTitle: "答案", colorIndex: 2, parentNote: question }
  const other: any = { noteId: "other", noteTitle: "其他", colorIndex: 3, parentNote: root }
  const tree = collectQuestionTree([root, question, answer, other], undefined, () => true)
  assert.deepEqual(questionIdsInTree(tree), ["root", "question", "answer", "other"])
  assert.equal(tree[0].children[0].title, "题目")

  class View {
    frame: any; bounds: any; superview: any; children: View[] = []; layer: any = new MaskTestLayer(this); note: any
    constructor(frame: any) { this.frame = frame; this.bounds = { x: 0, y: 0, width: frame.width, height: frame.height } }
    addSubview(view: View) { view.superview = this; this.children.push(view) }
    removeFromSuperview() { this.superview?.children.splice(this.superview.children.indexOf(this), 1); this.superview = undefined }
  }
  const window = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const map: any = new View({ x: 0, y: 0, width: 1024, height: 768 }); window.addSubview(map)
  const card: any = new View({ x: 100, y: 100, width: 100, height: 50 }); card.note = question; map.addSubview(card)
  map.className = "MindMapCanvas"; map.selViewLst = [{ note: { note: question }, view: card }]
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
    __MNAM_SCENE_WORKBENCH_GLOBAL__: {
      preparePractice() { assert.fail("恢复遮盖后，开始做题不应初始化场景面板") },
      foldPractice() { assert.fail("恢复遮盖后，不应修改卡片折叠状态") }
    },
    UIColor: { colorWithHexString: () => color, whiteColor: () => color },
    NSTimer: { scheduledTimerWithTimeInterval() {} },
    MNUtil: { selectNotesInMindmap: async () => { map.className = "MindMapCanvas"; map.selViewLst = [{ note: { note: question }, view: card }] } },
    require: (name: string) => name === "./window-opacity" ? windowOpacityFixture(View) : name === "./settings"
      ? { loadMatcherSettings: () => ({ answerMaskStyle: "dark", sceneWorkbenchEnabled: true }) }
      : name === "./review-mode"
        ? { mountPracticeNavigationToolbar() {}, removePracticeNavigationToolbar() {} }
        : name === "./mindmap-fold" ? unavailableFold()
        : name === "./note-navigation"
          ? { locateNoteInCurrentMindMap: async () => { assert.fail("列表跳转必须定位并聚焦") }, focusNoteInMindMapFocusMode: async (id: string) => { focusedIds.push(id); return "focused" } }
          : { MN: { currnetNotebookId: "book", notebookController: { mindmapView: map } }, delay: async () => {} }
  }
  runInNewContext(transpileModule(readFileSync("src/same-map-practice.ts", "utf8"), {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, sandbox)
  const result = await exports.startSameMapPractice("book", ["question"])
  assert.equal(result.started, true, result.reason)
  assert.deepEqual(focusedIds, ["question"])
  assert.equal(await exports.navigateSameMapPractice("outside"), false)
  assert.equal(await exports.navigateSameMapPractice("question"), true)
  assert.deepEqual(focusedIds, ["question", "question"])
  assert.equal(result.answerCount, 1)
  assert.equal(window.children.length + map.children.length, 2)
  assert.equal(maskLayers(map).length, 1)
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
