import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { windowOpacityFixture } from "./window-opacity-fixture"
import { createFoldHost, loadMindmapFold, subcardBinding } from "./mindmap-fold-fixture"

class FoldTestLayer {
  superlayer: any; sublayers: FoldTestLayer[] = []; opacity = 1; additions = 0
  constructor(public owner: any) {}
  addSublayer(layer: FoldTestLayer) {
    layer.removeFromSuperlayer()
    this.sublayers.push(layer); layer.superlayer = this; this.additions++
  }
  removeFromSuperlayer() {
    if (this.superlayer) this.superlayer.sublayers = this.superlayer.sublayers.filter((item: FoldTestLayer) => item !== this)
    this.superlayer = undefined
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

/**
 * 折叠优先会话：same-map-practice 使用与 mindmap-fold 相同的"设备"状态，
 * 遮罩仍挂真实的 Canvas 图层，便于核对补盖与摘除时机。
 */
function foldHarness(options: {
  binding?: any
  answerIds?: Set<string> | null
  folded?: boolean
  extraNotes?: Record<string, any>
  settings?: Record<string, any>
} = {}) {
  const host = createFoldHost({
    notes: { question: { children: ["answer"], folded: options.folded === true }, answer: {}, ...(options.extraNotes ?? {}) },
    rendered: options.folded === true ? ["question"] : ["question", "answer"]
  })
  class View {
    frame: any; bounds: any; superview: any; subviews: any[] = []; layer: any = new FoldTestLayer(this)
    constructor(frame: any) { this.frame = frame; this.bounds = { x: 0, y: 0, width: frame.width, height: frame.height } }
    addSubview(view: any) { view.superview = this; if (!this.subviews.includes(view)) this.subviews.push(view) }
    removeFromSuperview() {
      if (this.superview) this.superview.subviews = this.superview.subviews.filter((view: any) => view !== this)
      this.superview = undefined
    }
  }
  const window = new View({ x: 0, y: 0, width: 1024, height: 768 })
  const map: any = new View({ x: 0, y: 0, width: 1024, height: 768 }); window.addSubview(map)
  const card = new View({ x: 100, y: 100, width: 100, height: 50 }); map.addSubview(card)
  map.className = "MindMapCanvas"
  map.selViewLst = [{ note: { note: host.notes.question }, view: card }]
  const frames: Record<string, any> = {
    question: { x: 100, y: 100, width: 100, height: 50 },
    answer: { x: 220, y: 100, width: 100, height: 50 }
  }
  const parents: Record<string, string> = { answer: "question" }
  Object.defineProperty(map, "mindmapNodes", {
    get: () => host.rendered.map(id => ({
      note: host.notes[id], frame: frames[id],
      parentNode: parents[id] ? { note: host.notes[parents[id]] } : undefined
    }))
  })
  const order: string[] = [], hud: string[] = [], periodic: Array<() => void> = [], deferred: Array<() => void> = []
  let focus: (id: string) => Promise<string> = async id => { order.push(`focus:${id}`); return "focused" }
  const color = { colorWithAlphaComponent() { return this } }
  const binding = options.binding ?? subcardBinding()
  const exports: any = {}
  const foldCallsBeforeLoad = host.scene.foldBranch
  host.scene.foldBranch = (owner: any, request: any) => {
    order.push(`fold:${request.noteid}:${request.folded === true}`)
    return foldCallsBeforeLoad(owner, request)
  }
  const foldModule = loadMindmapFold(host, { binding, answerIds: options.answerIds })
  runInNewContext(transpileModule(readFileSync("src/same-map-practice.ts", "utf8"), {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, {
    exports, UIView: View, UILabel: View, UIImageView: View,
    NSData: { dataWithStringEncoding: () => ({ length: () => 1 }) },
    UIImage: { imageWithData: () => ({ decoded: true }) },
    UIColor: { colorWithHexString: () => color, whiteColor: () => color },
    NSTimer: {
      scheduledTimerWithTimeInterval(delay: number, _repeat: boolean, callback: () => void) {
        ;(delay < 0.2 ? periodic : deferred).push(callback)
        return { invalidate() {} }
      }
    },
    MNUtil: { selectNotesInMindmap: async () => { map.selViewLst = [{ note: { note: host.notes.question }, view: card }] } },
    require: (name: string) => name === "marginnote"
      ? {
          MN: {
            get currnetNotebookId() { return host.notebookId },
            notebookController: { get notebookId() { return host.notebookId }, mindmapView: map },
            db: { getNoteById: (noteId: string) => host.notes[noteId] }
          },
          delay: () => Promise.resolve(),
          showHUD: (text: string) => { hud.push(text) }
        }
      : name === "./base64" ? { decodeBase64Ascii: () => "image" }
        : name === "./window-opacity" ? windowOpacityFixture(View)
          : name === "./settings" ? { loadMatcherSettings: () => ({ answerMaskStyle: "dark", ...(options.settings ?? {}) }) }
            : name === "./note-navigation" ? { focusNoteInMindMapFocusMode: (id: string) => focus(id) }
              : name === "./mindmap-fold" ? foldModule
                : {}
  })
  return {
    api: exports, host, map, order, hud, owner: { cardLinkFoldFallbackHinted: false },
    setFocus(fn: (id: string) => Promise<string>) { focus = fn },
    /** 模拟宿主给出某张卡的真实选中视图（画面证据）；attached=false 只有选中记录。 */
    select(noteId: string, attached = true) { host.select(noteId, attached) },
    unselect(noteId: string) { host.unselect(noteId) },
    async tick() {
      const pending = [...periodic]
      periodic.length = 0
      for (const run of pending) run()
      // rebind 与折叠写入都是多段异步，多个微任务轮次后才稳定。
      for (let turn = 0; turn < 6; turn++) await flush()
    },
    get deferredCount() { return deferred.length },
    get periodicCount() { return periodic.length },
    maskCount() { return map.layer.sublayers.filter((layer: any) => !layer.owner.superview).length },
    focusIds() { return order.filter(entry => entry.startsWith("focus:")).map(entry => entry.slice(6)) },
    foldCalls() { return order.filter(entry => entry.startsWith("fold:")) }
  }
}

test("初始展开时先按 ID 收起分支，模型仍保留子卡时也不铺遮盖", async () => {
  const h = foldHarness()
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(result.started, true, result.reason)
  assert.equal(result.foldFirst, true)
  assert.equal(h.api.sameMapPracticeFoldFirst(), true)
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  assert.equal(h.maskCount(), 0, "进入时还没有挂遮盖")
  assert.deepEqual(h.order.slice(0, 2), ["fold:question:true", "focus:question"], "折叠必须先于定位")
  assert.ok(h.host.rendered.includes("answer"), "宿主模型仍保留答案子卡")
  await h.tick()
  assert.equal(h.maskCount(), 0)
  assert.equal(h.hud.length, 0, "不是回退，不提示改按遮盖")
  assert.equal(h.foldCalls().length, 1)
  h.api.stopSameMapPractice()
})

test("宿主字段已收起但有子卡真实视图时：立刻补遮盖，不再重复下发同值写入", async () => {
  const h = foldHarness()
  await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  // 宿主报告收起，但答案卡的真实视图还挂在画布上。
  h.select("answer")
  await h.tick()
  assert.equal(h.maskCount(), 1, "可见的子卡要立刻罩住")
  assert.equal(h.foldCalls().length, 1, "目标值已经满足，不占用撤销栈也不空转重写")
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  assert.equal(h.hud.length, 0, "有矛盾证据仍属折叠会话，不提示改按遮盖")
  h.unselect("answer")
  await h.tick()
  assert.equal(h.maskCount(), 0, "分支保持折叠，旧子卡坐标不会留下遮盖")
  h.api.stopSameMapPractice()
})

test("定位重新展开分支后再写一次并读回，超过预算不再写入", async () => {
  const h = foldHarness()
  h.setFocus(async id => {
    h.order.push(`focus:${id}`)
    h.host.setFolded("question", false)
    h.host.showTree("question", false)
    return "focused"
  })
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(result.foldFirst, true)
  assert.deepEqual(h.foldCalls(), ["fold:question:true", "fold:question:true"])
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  h.api.stopSameMapPractice()
})

test("读回未变时回落到现有遮盖，并且每轮只提示一次", async () => {
  const h = foldHarness()
  h.host.behaviour.apply = false
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(result.started, true, result.reason)
  assert.equal(result.foldFirst, false)
  assert.equal(h.api.sameMapPracticeFoldFirst(), false)
  assert.equal(h.maskCount(), 1, "无法确认收起时保留遮盖")
  assert.equal(h.hud.length, 1)
  assert.match(h.hud[0], /改按遮盖处理/)
  // 同一轮再次进入不再重复提示
  h.api.stopSameMapPractice()
  await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(h.hud.length, 1)
  h.api.stopSameMapPractice()
})

test("答案子卡还有下层卡片时不折叠，改按遮盖处理", async () => {
  const h = foldHarness({ extraNotes: { answer: { children: ["detail"] }, detail: {} } })
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(result.started, true, result.reason)
  assert.equal(result.foldFirst, false)
  assert.equal(h.foldCalls().length, 0, "无法证明整支可收起时不占用撤销栈")
  assert.equal(h.maskCount(), 1)
  assert.match(h.hud[0], /下层卡片/)
  h.api.stopSameMapPractice()
})

test("混合绑定无法确认整支只含答案时不写折叠，直接遮盖并提示", async () => {
  const h = foldHarness({
    binding: { notebookId: "book", designatedAnswer: "subcard", selectionMode: "mixed", questionColors: [0] },
    answerIds: new Set(["other"])
  })
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(result.started, true, result.reason)
  assert.equal(result.foldFirst, false)
  assert.equal(h.foldCalls().length, 0, "结构不满足时不占用撤销栈")
  assert.equal(h.maskCount(), 1)
  assert.match(h.hud[0], /混有非答案卡片/)
  h.api.stopSameMapPractice()
})

test("原生手动展开时补遮盖，重新折叠后撤掉遮盖", async () => {
  const h = foldHarness()
  await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  await h.tick()
  assert.equal(h.maskCount(), 0, "正常折叠时不挂遮盖")
  // 用户点原生加号展开
  h.host.behaviour.beforeWrite = () => assert.equal(h.maskCount(), 1, "重折叠前已补上遮盖")
  h.host.setFolded("question", false)
  h.host.showTree("question", false)
  await h.tick()
  assert.equal(h.foldCalls().length, 2, "一次展开只产生一次折叠写入")
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  assert.equal(h.maskCount(), 0, "重新收起后撤掉遮盖")
  // 宿主拒绝保持收起：保留遮盖并停止自动写入
  h.host.behaviour.apply = false
  h.host.setFolded("question", false)
  h.host.showTree("question", false)
  await h.tick()
  assert.equal(h.foldCalls().length, 3)
  assert.equal(h.maskCount(), 1, "无法收起时保留遮盖")
  assert.match(h.hud.slice(-1)[0] || "", /改按遮盖处理/)
  await h.tick()
  assert.equal(h.foldCalls().length, 3, "停止为本题自动写折叠状态")
  h.api.stopSameMapPractice()
})

test("查找答案：有画面证据才移除遮盖，无证据时保留遮盖并交给答案窗口", async () => {
  const h = foldHarness()
  await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  h.select("answer") // 宿主给出答案卡的真实视图
  assert.equal(await h.api.revealPracticeAnswer("question"), true)
  assert.equal(h.host.notes.question.mindmapBranchClose, 0)
  assert.equal(h.maskCount(), 0, "确认可见后才摘掉遮盖")
  assert.deepEqual(h.foldCalls(), ["fold:question:true", "fold:question:false"])
  // 揭晓后不再自动折叠
  await h.tick()
  assert.equal(h.foldCalls().length, 2)
  h.api.stopSameMapPractice()

  const blind = foldHarness()
  await blind.api.startSameMapPractice("book", ["question"], { owner: blind.owner })
  assert.equal(await blind.api.revealPracticeAnswer("question"), false, "没有画面证据时交给答案窗口")
  assert.equal(blind.host.notes.question.mindmapBranchClose, 0, "分支仍然展开给用户看")
  await blind.tick()
  assert.equal(blind.foldCalls().length, 2, "用户主动揭晓后不再自动收起")
  blind.api.stopSameMapPractice()

  const failed = foldHarness()
  await failed.api.startSameMapPractice("book", ["question"], { owner: failed.owner })
  failed.host.behaviour.apply = false
  assert.equal(await failed.api.revealPracticeAnswer("question"), false, "展开未生效时交给答案窗口")
  failed.api.stopSameMapPractice()
})

test("退出时保留当前折叠状态，主动揭晓过的答案也保留展开", async () => {
  const h = foldHarness()
  await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  h.api.stopSameMapPractice()
  await h.tick()
  assert.equal(h.host.notes.question.mindmapBranchClose, 1, "退出不恢复，保留实际折叠状态")
  assert.deepEqual(h.foldCalls(), ["fold:question:true"])
  assert.equal(h.deferredCount, 0)
  assert.equal(h.api.sameMapPracticeActive(), false)

  const revealed = foldHarness()
  await revealed.api.startSameMapPractice("book", ["question"], { owner: revealed.owner })
  revealed.select("answer")
  assert.equal(await revealed.api.revealPracticeAnswer("question"), true)
  revealed.api.stopSameMapPractice()
  await revealed.tick()
  assert.equal(revealed.host.notes.question.mindmapBranchClose, 0, "揭晓后退出保持展开")
  assert.deepEqual(revealed.foldCalls(), ["fold:question:true", "fold:question:false"])
})

test("写入期间退出，已派发的写入完成后保留折叠且不启动会话", async () => {
  const h = foldHarness()
  h.host.behaviour.beforeWrite = request => { if (request.folded) h.api.stopSameMapPractice() }
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(result.started, false)
  assert.match(result.reason || "", /已结束/)
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  assert.equal(h.api.sameMapPracticeActive(), false)
  assert.deepEqual(h.foldCalls(), ["fold:question:true"])
  assert.deepEqual(h.focusIds(), [])
  assert.equal(h.deferredCount, 0)
})

test("纯答案脑图或多题队列之外的绑定不进入折叠优先", async () => {
  const h = foldHarness({ binding: { notebookId: "book", designatedAnswer: "mindmap" } })
  const result = await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  assert.equal(h.foldCalls().length, 0)
  assert.equal(result.foldFirst, false)
  h.api.stopSameMapPractice()
})

test("查找答案的已展开快捷分支要求画布真的显示答案", async () => {
  const h = foldHarness()
  await h.api.startSameMapPractice("book", ["question"], { owner: h.owner })
  // 只有字段变成展开，画布上并没有答案子卡
  h.host.setFolded("question", false)
  assert.equal(await h.api.revealPracticeAnswer("question"), false, "看不到答案时交给答案窗口")
  assert.deepEqual(h.foldCalls(), ["fold:question:true"])
  h.api.stopSameMapPractice()
})

test("切题只折叠目标题，上一题保持折叠，再返回时不重复写入", async () => {
  const h = foldHarness({ extraNotes: { next: { children: ["nextAnswer"], folded: false }, nextAnswer: {} } })
  await h.api.startSameMapPractice("book", ["question", "next"], { owner: h.owner })
  assert.equal(await h.api.navigateSameMapPractice("next"), true)
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  assert.equal(h.host.notes.next.mindmapBranchClose, 1)
  assert.equal(await h.api.navigateSameMapPractice("question"), true)
  assert.deepEqual(h.foldCalls(), ["fold:question:true", "fold:next:true"])
  assert.equal(h.deferredCount, 0)
  h.api.stopSameMapPractice()
})

test("预折叠的访问守卫：代次结束时不写折叠", async () => {
  const h = foldHarness()
  let allowed = false
  assert.equal(await h.api.preFoldCurrentQuestion("book", "question", h.owner, undefined, () => allowed), false)
  assert.equal(h.foldCalls().length, 0, "访问已结束时不占用撤销栈")
  allowed = true
  assert.equal(await h.api.preFoldCurrentQuestion("book", "question", h.owner, undefined, () => allowed), true)
  assert.equal(h.host.notes.question.mindmapBranchClose, 1)
  assert.deepEqual(h.foldCalls(), ["fold:question:true"])
})
