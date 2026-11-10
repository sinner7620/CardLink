import { windowOpacityFixture } from "./window-opacity-fixture"
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { quickMenuGeometry } from "../src/quick-menu-geometry"
import { clipperProgressHtml } from "../src/clipper-quick-menu"
import { UI_COLORS } from "../src/ui-tokens"

function harness() {
  const notes = new Map<string, any>(), timers: Array<() => void> = [], stored: Record<string, any> = { "cardlink.question-clipper.v1": { tools: { title: "ToolTextExcerpt", question: "ToolRectCut", answer: "ToolRectCut" } } }
  const owner: any = { window: {} }, toolbar: boolean[] = [], checked = new Set(["ToolTextExcerpt"])
  const notices: string[] = []
  const diagnostics: Array<{ scope: string; event: string; detail: string }> = []
  const debugSettings = { debugModeEnabled: true }
  const choice = { index: 0 }
  const choiceQueue: number[] = []
  const toolChoices: string[][] = []
  const sceneConfig: any = { available: true, template: { id: "reading" }, excerptTools: { source: "template",
    tools: [3, 7, 11, 18, 24, 42, 48, 60].map((index, position) => ({ index, label: `场景笔 ${position}`, colorIndex: position })) } }
  let toolReads = 0
  let selected: any
  const app = {
    studyController: () => ({ readerController: { currentDocumentController: {} } }),
    queryCommandWithKeyFlagsInWindow: (cmd: string) => ({ checked: checked.has(cmd) }),
    processCommandWithKeyFlagsInWindow: (cmd: string) => { checked.clear(); checked.add(cmd) },
    checkNotifySenderInWindow: () => true, refreshAfterDBChanged() {}
  }
  const db = { getNoteById: (id: string) => notes.get(id), deleteBookNote: (id: string) => notes.delete(id), setNotebookSyncDirty() {}, savedb() {} }
  const sandbox: any = { exports: {}, self: owner, Application: { sharedInstance: () => app },
    NSTimer: { scheduledTimerWithTimeInterval: (_delay: number, _repeat: boolean, action: () => void) => timers.push(action) },
    require: (name: string) => name === "./window-opacity" ? windowOpacityFixture(sandbox.UIView, { failClass: true }) : name === "./quick-menu-surface" ? { styleQuickMenuSurface(view: any, radius = 18) { view.layer.cornerRadius = radius; view.backgroundColor = sandbox.UIColor.colorWithHexString("#f7f8fa").colorWithAlphaComponent(0.94) } } : name === "marginnote" ? {
      MN: { currnetNotebookId: "book", db }, NodeNote: { getSelectedNodes: () => selected ? [{ note: selected }] : [] },
      UIAlertViewStyle: { PlainTextInput: 2 },
      select: async (options: string[]) => { toolChoices.push(options); return choiceQueue.length ? { index: choiceQueue.shift() } : { index: choice.index } },
      getLocalDataByKey: (key: string) => stored[key], setLocalDataByKey: (value: any, key: string) => { stored[key] = value }, showHUD(message: string) { notices.push(message) }
    } : name === "./note-navigation" ? { recordRuntimeState: (scope: string, event: string, detail: string) => {
      if (debugSettings.debugModeEnabled) diagnostics.push({ scope, event, detail })
    } } : name === "./settings" ? { loadMatcherSettings: () => debugSettings }
      : name === "./card-toolbar-state" ? { setCardToolbarEnabled: (value: boolean) => toolbar.push(value) }
      : { hideAnswerToolbar: () => toolbar.push(false) } }
  sandbox.__MNAM_SCENE_WORKBENCH_GLOBAL__ = { readClipperTools: async (target: any) => { assert.equal(target, owner); toolReads++; return sceneConfig } }
  runInNewContext(transpileModule(readFileSync("src/question-clipper.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, sandbox)
  function flush() { let n = 0; while (timers.length && ++n < 100) timers.shift()!(); assert.ok(n < 100) }
  function note(id: string, text = "") {
    const result: any = { noteId: id, notebookId: "book", excerptText: text, childNotes: [],
      addChild(child: any) { this.childNotes.push(child); child.parentNote = this },
      removeFromParent() { if (this.parentNote) this.parentNote.childNotes = this.parentNote.childNotes.filter((child: any) => child !== this); this.parentNote = null } }
    notes.set(id, result); return result
  }
  const api = sandbox.exports
  return { api, owner, sandbox, app, diagnostics, debugSettings, toolChoices, choiceQueue, sceneConfig, reads: () => toolReads, note, notes, toolbar, checked, flush, stored, notices, choice, select: (value: any) => { selected = value },
    excerpt: (id: string) => api.onProcessNewExcerpt({ userInfo: { noteid: id } }) }
}

test("摘录标题、题目、答案依次挂载；重复通知不重复创建；退出恢复按钮", () => {
  const h = harness(), { api } = h
  const mother = h.note("mother"); h.select(mother)
  api.enterClipperMode(() => {}); api.bindClipperMother(); api.toggleClipperRunning(); h.flush()
  h.note("title", "第 1 题"); h.excerpt("title"); h.flush()
  const question = h.note("question", "题干"); h.excerpt("question"); h.flush()
  assert.equal(question.noteTitle, "第 1 题"); assert.equal(question.parentNote, mother)
  assert.equal(h.notes.has("title"), false)
  const answer = h.note("answer", "答案"); h.excerpt("answer"); h.flush(); h.excerpt("answer"); h.flush()
  assert.equal(answer.parentNote, question); assert.equal(question.childNotes.length, 1)
  assert.equal(answer.noteTitle, "第 1 题答案")
  assert.equal(api.clipperSnapshot().completed, 1); assert.equal(api.clipperSnapshot().stage, "title")
  assert.deepEqual(h.notices, ["已摘录标题，接下来请摘录题目", "已摘录题目，接下来请摘录答案", "已摘录答案，本题完成；接下来请摘录标题"])
  api.exitClipperMode(); assert.equal(api.clipperModeActive(), false); assert.deepEqual(h.toolbar, [false])
})

test("不摘标题直接进入题目；暂停和退出使延迟摘录失效，恢复保留当前步骤", () => {
  const h = harness(), { api } = h
  api.saveClipperSetting(false); api.enterClipperMode(() => {}); api.toggleClipperRunning(); h.flush()
  h.note("stale", "暂停前的通知"); h.excerpt("stale"); api.toggleClipperRunning(); h.flush()
  assert.equal(api.clipperSnapshot().stage, "question")
  api.toggleClipperRunning(); h.flush()
  const q = h.note("q", "题干"); h.excerpt("q"); h.flush()
  assert.equal(api.clipperSnapshot().stage, "answer"); assert.equal(q.noteTitle, undefined)
  h.note("a"); h.excerpt("a"); api.exitClipperMode(); h.flush()
  assert.equal(q.childNotes.length, 0)
})

test("摘题准备与开始失败不隐藏侧边标签，实际开始和恢复才隐藏", () => {
  const h = harness()
  h.api.enterClipperMode(() => {})
  assert.deepEqual(h.toolbar, [])
  const settings = h.stored["cardlink.question-clipper.v1"]
  h.stored["cardlink.question-clipper.v1"] = { tools: {} }
  h.api.toggleClipperRunning()
  assert.equal(h.api.clipperSnapshot().running, false)
  assert.deepEqual(h.toolbar, [])
  h.stored["cardlink.question-clipper.v1"] = settings
  h.api.toggleClipperRunning()
  assert.deepEqual(h.toolbar, [false])
  h.api.toggleClipperRunning()
  assert.equal(h.api.clipperSnapshot().running, false)
  assert.deepEqual(h.toolbar, [false])
  h.api.toggleClipperRunning()
  assert.deepEqual(h.toolbar, [false, false])
  h.api.exitClipperMode()
  assert.deepEqual(h.toolbar, [false, false])
})

test("结束摘题通知设置页解除绑定锁定，暂停保持锁定，开关往返保留绑定", () => {
  const h = harness(), snapshots: any[] = []
  const page = { __onNativeBindingsChanged: () => snapshots.push(h.api.clipperSnapshot(h.owner)) }
  h.owner.webController = { webView: { evaluateJavaScript: (script: string) => runInNewContext(script, { window: page }) } }
  h.api.recordClipperTool("title")
  h.api.enterClipperMode(() => {})
  assert.equal(snapshots[snapshots.length - 1].started, false)
  h.api.toggleClipperRunning()
  assert.equal(snapshots[snapshots.length - 1].started, true)
  h.api.saveClipperSetting(false); h.api.saveClipperSetting(true)
  h.api.saveClipperAnswerSetting(false); h.api.saveClipperAnswerSetting(true)
  h.api.toggleClipperRunning()
  assert.equal(snapshots[snapshots.length - 1].running, false)
  assert.equal(snapshots[snapshots.length - 1].started, true)
  assert.throws(() => h.api.recordClipperTool("title"), /先结束/)
  h.api.exitClipperMode()
  assert.equal(snapshots[snapshots.length - 1].started, false)
  assert.equal(snapshots[snapshots.length - 1].mode, false)
  assert.equal(snapshots[snapshots.length - 1].tools.title, "ToolTextExcerpt")
  h.checked.clear(); h.checked.add("ToolRectCut")
  h.api.recordClipperTool("question")
  assert.equal(h.api.clipperSnapshot().tools.question, "ToolRectCut")
})

test("工具学习优先唯一自定义预设，保留标题文本回退并持久化", () => {
  const h = harness(), { api } = h
  h.checked.add("ExcerptToolCustom2"); api.recordClipperTool("question")
  assert.equal(api.clipperSettings().tools.question, "ExcerptToolCustom2")
  h.checked.add("ExcerptToolCustom3"); api.recordClipperTool("title")
  assert.equal(api.clipperSettings().tools.title, "ToolTextExcerpt")
  assert.throws(() => api.recordClipperTool("answer"), /多个工具/)
})

test("工具记录诊断区分空返回、未勾选、原始数值、禁用和查询异常，失败不改绑定", () => {
  const h = harness(), before = JSON.stringify(h.stored)
  h.app.queryCommandWithKeyFlagsInWindow = (cmd: string): any => {
    if (cmd === "ToolTextExcerpt") return null
    if (cmd === "ToolRectCut") return { checked: false, disabled: false }
    if (cmd === "ExcerptToolSketch") return { checked: 1, disabled: 0 }
    if (cmd === "ExcerptToolCustom0") throw new Error("host query failed")
    if (cmd === "ExcerptToolCustom1") return { checked: true, disabled: true }
    return undefined
  }
  assert.throws(() => h.api.recordClipperTool("question"), /未能识别当前摘录工具/)
  assert.equal(JSON.stringify(h.stored), before)
  const lines = h.diagnostics.map(line => `${line.event} ${line.detail}`).join("\n")
  assert.match(lines, /command=ToolTextExcerpt result=null/)
  assert.match(lines, /command=ToolRectCut result=object checked=false checkedType=boolean/)
  assert.match(lines, /command=ExcerptToolSketch result=object checked=1 checkedType=number disabled=0 disabledType=number/)
  assert.match(lines, /query.error .*command=ExcerptToolCustom0 error=Error: host query failed/)
  assert.match(lines, /command=ExcerptToolCustom1 .*disabled=true disabledType=boolean/)
  assert.match(lines, /command=ExcerptToolCustom2 result=undefined/)
  assert.match(lines, /record.unrecognized .*checked=\(none\)/)
  assert.doesNotMatch(lines, /record.saved/)
})

test("成功记录包含宿主版本和窗口上下文；关闭诊断仍能正常绑定", () => {
  const h = harness()
  Object.assign(h.app, { appVersion: "4.5.0", build: "123", osType: 0, focusWindow: h.owner.window })
  h.api.recordClipperTool("title")
  assert.ok(h.diagnostics.some(line => line.event === "record.start" && /appVersion=4.5.0 build=123 osType=0 windowPresent=true focusWindowMatches=true/.test(line.detail)))
  assert.ok(h.diagnostics.some(line => line.event === "record.saved" && /command=ToolTextExcerpt/.test(line.detail)))
  h.debugSettings.debugModeEnabled = false; h.diagnostics.length = 0
  h.checked.clear(); h.checked.add("ExcerptToolCustom2")
  h.api.recordClipperTool("answer")
  assert.equal(h.api.clipperSettings().tools.answer, "ExcerptToolCustom2")
  assert.equal(h.diagnostics.length, 0)
})

test("切换诊断记录命令派发及回读；暂停取消剩余重试", () => {
  const h = harness()
  h.api.saveClipperSetting(false); h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); h.flush()
  assert.ok(h.diagnostics.some(line => line.event === "dispatch.returned" && /command=ToolRectCut/.test(line.detail)))
  assert.ok(h.diagnostics.some(line => /phase=after-command command=ToolRectCut .*checked=true/.test(line.detail)))
  h.api.toggleClipperRunning(); h.checked.clear(); h.api.toggleClipperRunning(); h.api.toggleClipperRunning()
  h.diagnostics.length = 0; h.flush()
  assert.equal(h.diagnostics.length, 0)
})

test("切换失败区分命令禁用与 URL 异常，保留原重试上限和手动选笔提示", () => {
  const h = harness()
  h.app.queryCommandWithKeyFlagsInWindow = (): any => ({ checked: false, disabled: true })
  let processed = 0, urls = 0
  h.app.processCommandWithKeyFlagsInWindow = () => { processed++ }
  Object.assign(h.app, { openURL() { urls++; throw new Error("URL failed") } })
  h.sandbox.NSURL = { URLWithString: (url: string) => url }
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); h.flush()
  assert.equal(processed, 0); assert.equal(urls, 5)
  assert.ok(h.diagnostics.some(line => line.event === "dispatch.skipped" && /reason=disabled/.test(line.detail)))
  assert.ok(h.diagnostics.some(line => line.event === "url.error" && /URL failed/.test(line.detail)))
  assert.ok(h.diagnostics.some(line => line.event === "switch.unverified" && /attempt=5/.test(line.detail)))
  assert.equal(h.api.clipperSnapshot().issue, "请手动选择当前步骤的摘录工具")
})

function sceneHost(h: ReturnType<typeof harness>, immersive = true, version = "5.1.0") {
  Object.assign(h.app, { appVersion: version,
    studyController: () => ({ immersiveMode: immersive, readerController: { currentDocumentController: {} } }) })
}

test("MN5 场景绑定绕过全禁用的查询，独立保存所选预设并沿用原自动切笔", async () => {
  const h = harness()
  sceneHost(h)
  let queries = 0
  const query = h.app.queryCommandWithKeyFlagsInWindow
  h.app.queryCommandWithKeyFlagsInWindow = () => { queries++; return { checked: false, disabled: true } as any }
  h.choice.index = 5 // ExcerptToolCustom2: exactly the existing command choice, no template-index mapping.
  assert.equal(h.api.clipperSnapshot().toolBindingMode, "scene")
  await h.api.recordClipperTool("title", h.owner)
  assert.equal(queries, 0)
  const saved = JSON.parse(h.stored["cardlink.question-clipper.v1"])
  assert.equal(saved.tools.title, "ToolTextExcerpt")
  assert.equal(saved.sceneTools.title.command, "ExcerptToolCustom2")
  assert.equal(saved.sceneTools.title.index, 42)
  assert.equal(saved.sceneTools.title.label, "场景笔 5")
  assert.deepEqual(Array.from(h.toolChoices[0]), h.sceneConfig.excerptTools.tools.map((tool: any) => tool.label))
  assert.equal(h.reads(), 2)
  assert.equal(h.api.clipperSnapshot().tools.title, "ExcerptToolCustom2")
  assert.equal(h.api.clipperSnapshot().tools.question, "ToolRectCut")
  assert.equal(h.api.clipperSnapshot().toolLabels.title, "场景笔 5")
  h.app.queryCommandWithKeyFlagsInWindow = query
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); await new Promise(resolve => setImmediate(resolve)); h.flush()
  assert.deepEqual([...h.checked], ["ExcerptToolCustom2"])
  h.api.exitClipperMode()
  h.api.saveClipperAnswerSetting(false); h.api.saveClipperTitleFormat("original", "")
  assert.equal(h.api.clipperSettings().sceneTools.title.command, "ExcerptToolCustom2")
  sceneHost(h, false)
  assert.equal(h.api.clipperSnapshot().toolBindingMode, "classic")
  assert.equal(h.api.clipperSnapshot().tools.title, "ToolTextExcerpt")
  h.checked.clear(); h.checked.add("ToolRectCut")
  h.api.recordClipperTool("title")
  assert.equal(h.api.clipperSettings().tools.title, "ToolRectCut")
  assert.equal(h.api.clipperSettings().sceneTools.title.command, "ExcerptToolCustom2")
})

test("MN4 与 MN5 传统界面继续记录当前工具，旧绑定在 MN5 场景可直接使用", () => {
  for (const [version, immersive] of [["4.1.0", true], ["5.1.0", false]] as const) {
    const h = harness(); sceneHost(h, immersive, version)
    h.checked.clear(); h.checked.add("ExcerptToolCustom4")
    h.api.recordClipperTool("question")
    assert.equal(h.api.clipperSettings().tools.question, "ExcerptToolCustom4")
    assert.equal(h.toolChoices.length, 0)
  }
  const h = harness(); sceneHost(h)
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); h.flush()
  assert.equal(h.api.clipperSnapshot().running, true)
  assert.deepEqual([...h.checked], ["ToolTextExcerpt"])
})

test("场景选择取消或失效不改绑定，摘题开始后不接受迟到的选择", async () => {
  const h = harness(); sceneHost(h)
  const before = JSON.stringify(h.stored)
  h.choice.index = -1; await h.api.recordClipperTool("title")
  assert.equal(JSON.stringify(h.stored), before)
  h.choice.index = 19
  await assert.rejects(h.api.recordClipperTool("title"), /无效的场景摘录笔/)
  h.choice.index = 5
  const leaving = h.api.recordClipperTool("title")
  sceneHost(h, false)
  await assert.rejects(leaving, /已离开/)
  assert.equal(JSON.stringify(h.stored), before)
  sceneHost(h)
  const starting = h.api.recordClipperTool("title")
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning()
  await assert.rejects(starting, /请先结束/)
  assert.equal(JSON.stringify(h.stored), before)
})

test("场景必需工具检查使用场景绑定，并在重开流程后保留", async () => {
  const h = harness(); sceneHost(h)
  h.stored["cardlink.question-clipper.v1"] = { tools: {} }
  h.api.saveClipperSetting(false); h.api.saveClipperAnswerSetting(false)
  h.choice.index = 6; await h.api.recordClipperTool("question")
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); await new Promise(resolve => setImmediate(resolve)); h.flush()
  assert.equal(h.api.clipperSnapshot().running, true)
  assert.deepEqual([...h.checked], ["ExcerptToolCustom3"])
  h.api.exitClipperMode(); h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); await new Promise(resolve => setImmediate(resolve)); h.flush()
  assert.deepEqual([...h.checked], ["ExcerptToolCustom3"])
  assert.equal(h.api.clipperSnapshot().tools.question, "ExcerptToolCustom3")
})

test("旧场景命令绑定不被强制迁移，仍使用原自动切笔且不要求新工具接口", () => {
  const h = harness(); sceneHost(h)
  h.stored["cardlink.question-clipper.v1"].sceneTools = { title: "ExcerptToolCustom4" }
  h.sceneConfig.available = false
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); h.flush()
  assert.deepEqual([...h.checked], ["ExcerptToolCustom4"])
  assert.equal(h.reads(), 0)
  assert.equal(h.api.clipperSnapshot().toolLabels.title, "自定义 4")
})

test("真实场景工具可超过16支、序号不连续且重名；不按模板序号猜测切笔命令", async () => {
  const h = harness(); sceneHost(h)
  h.sceneConfig.excerptTools.tools = Array.from({ length: 24 }, (_, i) => ({ index: i * 3 + 20, label: i === 23 ? "" : "同名笔" }))
  h.choiceQueue.push(23, 1) // Real index=89; user explicitly chooses rectangle as the switch position.
  await h.api.recordClipperTool("answer")
  const binding = h.api.clipperSettings().sceneTools.answer
  assert.equal(h.toolChoices[0].length, 24)
  assert.equal(binding.index, 89)
  assert.equal(binding.command, "ToolRectCut")
  assert.equal(binding.label, "未命名摘录笔（序号 89）")
  assert.equal(h.api.clipperSnapshot().toolLabels.answer, binding.label)
  h.choiceQueue.push(23)
  const choices = h.toolChoices.length
  await h.api.recordClipperTool("answer")
  assert.equal(h.toolChoices.length, choices + 1) // Same tool/config retains its confirmed mapping.
})

test("场景配置不可用、空笔盒、重复序号及读取失败不会回退到固定清单或改绑定", async () => {
  for (const value of [
    { available: false, reason: "template unavailable" },
    { error: { message: "面板没有读取许可" } },
    { available: true, excerptTools: { tools: [] } },
    { available: true, excerptTools: { tools: [{ index: 3 }, { index: 3 }] } },
    { available: true, excerptTools: { tools: [{ index: -1 }] } }
  ]) {
    const h = harness(); sceneHost(h)
    h.sandbox.__MNAM_SCENE_WORKBENCH_GLOBAL__.readClipperTools = async () => value
    const before = JSON.stringify(h.stored)
    await assert.rejects(h.api.recordClipperTool("title"))
    assert.equal(h.toolChoices.length, 0)
    assert.equal(JSON.stringify(h.stored), before)
  }
  const h = harness(); sceneHost(h)
  h.sandbox.__MNAM_SCENE_WORKBENCH_GLOBAL__.readClipperTools = async () => { throw new Error("read failed") }
  await assert.rejects(h.api.recordClipperTool("title"), /read failed/)
})

test("取消自动切笔位置不改绑定；选笔期间模板变更拒绝保存", async () => {
  const h = harness(); sceneHost(h)
  const before = JSON.stringify(h.stored)
  h.choiceQueue.push(2, -1)
  await h.api.recordClipperTool("title")
  assert.equal(JSON.stringify(h.stored), before)
  let reads = 0
  h.sandbox.__MNAM_SCENE_WORKBENCH_GLOBAL__.readClipperTools = async () => {
    if (++reads === 2) h.sceneConfig.template.id = "another-template"
    return h.sceneConfig
  }
  h.choiceQueue.push(2, 4)
  await assert.rejects(h.api.recordClipperTool("title"), /配置已变化/)
  assert.equal(JSON.stringify(h.stored), before)
})

test("启动前读回场景笔身份；配置变更阻止切错笔，暂停使迟到的配置回执失效", async () => {
  const h = harness(); sceneHost(h)
  h.choiceQueue.push(0, 5); await h.api.recordClipperTool("title")
  h.sceneConfig.excerptTools.tools[0].colorIndex = 15
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning()
  await new Promise(resolve => setImmediate(resolve)); h.flush()
  assert.equal(h.api.clipperSnapshot().running, false)
  assert.match(h.api.clipperSnapshot().issue, /配置已变化/)
  assert.deepEqual([...h.checked], ["ToolTextExcerpt"])
  h.api.exitClipperMode(); h.sceneConfig.excerptTools.tools[0].colorIndex = 0
  let finish: (value: any) => void = () => {}
  h.sandbox.__MNAM_SCENE_WORKBENCH_GLOBAL__.readClipperTools = () => new Promise(resolve => { finish = resolve })
  h.api.enterClipperMode(() => {}); h.api.toggleClipperRunning(); h.api.toggleClipperRunning()
  finish(h.sceneConfig); await new Promise(resolve => setImmediate(resolve)); h.flush()
  assert.equal(h.api.clipperSnapshot().running, false)
  assert.equal(h.api.clipperSnapshot().issue, "")
  assert.deepEqual([...h.checked], ["ToolTextExcerpt"])
})

test("标题开关兼容原生数值布尔值；运行中关闭保留题目并从下题跳过标题", () => {
  const h = harness(), { api } = h
  h.stored["cardlink.question-clipper.v1"] = { excerptTitle: 0, tools: { title: "ToolTextExcerpt", question: "ToolRectCut", answer: "ToolRectCut" } }
  assert.equal(api.clipperSettings().excerptTitle, false)
  api.saveClipperSetting(true); api.enterClipperMode(() => {}); api.toggleClipperRunning(); h.flush()
  api.saveClipperSetting(false); h.flush()
  assert.equal(api.clipperSnapshot().stage, "question")
  assert.equal(JSON.parse(h.stored["cardlink.question-clipper.v1"]).excerptTitle, false)
  const q = h.note("question", "题目"); h.excerpt("question"); h.flush()
  api.saveClipperSetting(true); api.saveClipperSetting(false); h.flush()
  assert.equal(api.clipperSnapshot().stage, "answer")
  h.note("answer"); h.excerpt("answer"); h.flush()
  assert.equal(q.childNotes.length, 1)
  assert.equal(api.clipperSnapshot().stage, "question")
  assert.equal(h.notices[h.notices.length - 1], "已摘录答案，本题完成；接下来请摘录题目")
})

test("点击编辑标题预填原值，保存同步题目和答案命名，过期弹窗不改下一题", async () => {
  const h = harness(), { api } = h
  let initial = "", submit: (result: any) => void = () => {}
  h.sandbox.MNUtil = { input: (...args: any[]) => { initial = args[3].default; return new Promise(resolve => { submit = resolve }) } }
  api.saveClipperSetting(false); api.enterClipperMode(() => {}); api.toggleClipperRunning(); h.flush()
  let editing = api.editClipperQuestionTitle(); await new Promise<void>(resolve => setImmediate(resolve)); submit({ input: "手动标题", button: 2 }); await editing; h.flush()
  const question = h.note("q"); h.excerpt("q"); h.flush()
  assert.equal(question.noteTitle, "手动标题")
  editing = api.editClipperQuestionTitle(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(initial, "手动标题")
  submit({ input: "新标题", button: 2 }); await editing; h.flush()
  assert.equal(question.noteTitle, "新标题")
  editing = api.editClipperQuestionTitle(); await Promise.resolve()
  const answer = h.note("a"); h.excerpt("a"); h.flush()
  assert.equal(answer.noteTitle, "新标题答案")
  submit({ input: "过期标题", button: 2 }); await editing
  assert.equal(api.clipperSnapshot().title, "")
})

test("标题摘录后立即写入前缀并展示，题目和答案不重复追加", async () => {
  const h = harness(), { api } = h
  api.saveClipperTitleFormat("prefix", "第一章"); api.enterClipperMode(() => {}); api.toggleClipperRunning(); h.flush()
  h.note("t", "例题 1"); h.excerpt("t"); h.flush()
  assert.equal(h.notes.get('t').noteTitle, '第一章 · 例题 1')
  assert.equal(api.clipperSnapshot().title, '第一章 · 例题 1')
  h.sandbox.MNUtil = { input: async (...args: any[]) => { assert.equal(args[3].default, "第一章 · 例题 1"); return { button: 0, input: "" } } }
  await api.editClipperQuestionTitle()
  const q = h.note("q"); h.excerpt("q"); h.flush()
  assert.equal(q.noteTitle, "第一章 · 例题 1")
  const a = h.note("a"); h.excerpt("a"); h.flush()
  assert.equal(a.noteTitle, "第一章 · 例题 1答案")
})

test("母卡前缀取当前名称；各母卡题号持久续增，重置前不占号，保留题目不复用号", () => {
  const h = harness(), { api } = h
  const motherA = h.note("mA", "第一章"), motherB = h.note("mB", "第二章")
  api.saveClipperSetting(false); api.saveClipperTitleFormat("mother", "")
  api.enterClipperMode(() => {}); h.select(motherA); api.bindClipperMother(); api.toggleClipperRunning(); h.flush()
  const q0 = h.note("q0", "例题"); h.excerpt("q0"); h.flush()
  assert.equal(q0.noteTitle, "第一章 · 例题")
  api.exitClipperMode(); api.saveClipperTitleFormat("number", "")
  const open = (mother: any) => { api.enterClipperMode(() => {}); h.select(mother); api.bindClipperMother(); api.toggleClipperRunning(); h.flush() }
  open(motherA); api.resetClipperQuestion(); h.flush()
  const q1 = h.note("q1"); h.excerpt("q1"); h.flush()
  assert.equal(q1.noteTitle, "第1题")
  api.resetClipperQuestion(); h.flush()
  const q2 = h.note("q2"); h.excerpt("q2"); h.flush()
  assert.equal(q2.noteTitle, "第2题")
  api.exitClipperMode(); open(motherB)
  const qb = h.note("qb"); h.excerpt("qb"); h.flush()
  assert.equal(qb.noteTitle, "第1题")
  api.exitClipperMode(); open(motherA)
  const q3 = h.note("q3"); h.excerpt("q3"); h.flush()
  assert.equal(q3.noteTitle, "第3题")
  assert.equal(motherA.childNotes.length, 4)
})

test("母卡前缀在标题阶段写入，重置后新标题重新格式化", () => {
  const h = harness(), { api } = h
  const mother = h.note('m', '第一章')
  api.saveClipperTitleFormat('mother', '')
  api.enterClipperMode(() => {}); h.select(mother); api.bindClipperMother(); api.toggleClipperRunning(); h.flush()
  const t = h.note('t', '例1'); h.excerpt('t'); h.flush()
  assert.equal(t.noteTitle, '第一章 · 例1')
  assert.equal(api.clipperSnapshot().stage, 'question')
  api.resetClipperQuestion(); h.flush()
  mother.noteTitle = '第二章'
  const t2 = h.note('t2', '例2'); h.excerpt('t2'); h.flush()
  assert.equal(t2.noteTitle, '第二章 · 例2')
  const q = h.note('q'); h.excerpt('q'); h.flush()
  assert.equal(q.noteTitle, '第二章 · 例2')
})

test("关闭标题摘录后进度只保留题目答案，重新开启恢复三步", () => {
  const steps = [0, 1, 2].map(() => ({ style: { display: "" }, className: "", b: { textContent: "" }, querySelector() { return this.b } }))
  const html = clipperProgressHtml({ stage: "question", excerptTitle: false, started: false })
  const sandbox: any = { document: { querySelectorAll: () => steps }, window: {} }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], sandbox)
  assert.ok(steps.every(step => step.className.trim() === "step"))
  sandbox.window.updateClip({ stage: "question", excerptTitle: false, started: true })
  assert.equal(steps[1].className, "step active")
  assert.equal(steps[0].style.display, "none")
  assert.equal(steps[1].b.textContent, "1"); assert.equal(steps[2].b.textContent, "2")
  sandbox.window.updateClip({ stage: "title", excerptTitle: true })
  assert.equal(steps[0].style.display, "")
  assert.equal(steps[2].b.textContent, "3")
  sandbox.window.updateClip({ stage: "question", excerptTitle: false, excerptAnswer: false, started: true })
  assert.equal(steps[0].style.display, "none"); assert.equal(steps[2].style.display, "none")
  assert.equal(steps[1].b.textContent, "1"); assert.equal(steps[1].className, "step active")
})

test("标题输入框内选项修改前缀和题号，降低号码后连续递增", async () => {
  const h = harness(), { api } = h
  const mother = h.note("m", "第一章")
  api.saveClipperSetting(false); api.saveClipperTitleFormat("number", "")
  api.enterClipperMode(() => {}); h.select(mother); api.bindClipperMother(); api.toggleClipperRunning(); h.flush()
  const q = h.note("q"); h.excerpt("q"); h.flush()
  h.choice.index = 1
  h.sandbox.MNUtil = { input: async (...args: any[]) => {
    if (args[2].length === 3) { assert.equal(args[3].default, "第1题"); return { input: "第1题", button: 1 } }
    assert.equal(args[3].default, "1"); return { input: "10", button: 1 }
  } }
  await api.editClipperQuestionTitle(); h.flush()
  assert.equal(q.noteTitle, "第10题")
  h.choice.index = 0
  h.sandbox.MNUtil.input = async () => ({ input: "练习", button: 1 })
  await api.editClipperQuestionTitle(); h.flush()
  assert.equal(q.noteTitle, "练习 · 第10题")
  const answer = h.note("a"); h.excerpt("a"); h.flush()
  assert.equal(answer.noteTitle, "练习 · 第10题答案")
  const q2 = h.note("q2"); h.excerpt("q2"); h.flush()
  assert.equal(q2.noteTitle, "第11题")
  h.choice.index = 1; h.sandbox.MNUtil.input = async () => ({ input: "3", button: 1 })
  await api.editClipperQuestionTitle()
  assert.equal(q2.noteTitle, "第3题")
  api.resetClipperQuestion(); h.flush()
  const q3 = h.note("q3"); h.excerpt("q3"); h.flush()
  assert.equal(q3.noteTitle, "第4题")
  api.exitClipperMode(); api.enterClipperMode(() => {}); h.select(mother); api.bindClipperMother(); api.toggleClipperRunning(); h.flush()
  const q4 = h.note("q4"); h.excerpt("q4"); h.flush()
  assert.equal(q4.noteTitle, "第5题")
})

test("建题前改号在成功创建时记号，取消和重置不提前占号", async () => {
  const h = harness(), { api } = h
  api.saveClipperSetting(false); api.saveClipperTitleFormat("number", "")
  api.enterClipperMode(() => {}); h.select(h.note("m")); api.bindClipperMother(); api.toggleClipperRunning(); h.flush()
  h.choice.index = 1; h.sandbox.MNUtil = { input: async () => ({ input: "8", button: 1 }) }
  await api.editClipperQuestionTitle(); h.flush()
  assert.equal(h.stored["cardlink.question-clipper.numbers.v1"], undefined)
  api.resetClipperQuestion(); h.flush()
  const q = h.note("q"); h.excerpt("q"); h.flush()
  assert.equal(q.noteTitle, "第1题")
})

test("设置桥接的 self 为网页控制器时，快捷区仍绑定插件实例并接收开始、暂停、结束", async () => {
  const h = harness(), { sandbox, owner, api } = h
  class View {
    frame: any; bounds: any; layer: any = {}; children: any[] = []; superview: any; titleLabel: any = {}
    target: any; selector = ""; hidden = false; userInteractionEnabled = true; alpha = 1
    constructor(frame: any = {}) { this.frame = frame; this.bounds = frame }
    addSubview(v: any) { this.children.push(v); v.superview = this }
    bringSubviewToFront() {}
    addGestureRecognizer() {}
    removeGestureRecognizer() {}
    removeFromSuperview() {}
    addTargetActionForControlEvents(target: any, selector: string) { this.target = target; this.selector = selector }
    title = ""
    setTitleForState(title: string) { this.title = title }
    setTitleColorForState() {}
    loadHTMLStringBaseURL() {}
    evaluateJavaScript() {}
  }
  const window = new View({ width: 1024, height: 768 }), ball = new View({ x: 900, y: 60, width: 44, height: 44 })
  owner.window = window
  owner.mnutilsEntranceBall = { button: ball, window, superview: window, frame: ball.frame }
  owner.mnutilsEntranceDock = { edge: "right", ratio: .2 }
  owner.webController = {}
  const webController: any = { window }
  sandbox.self = webController
  const color = (hex: string) => ({ hex, colorWithAlphaComponent() { return this } })
  Object.assign(sandbox, {
    JSB: { defineClass: (_name: string, methods: any) => ({ new: () => ({ ...methods }) }) },
    MNUtil: { currentWindow: window }, MNButton: {}, UIAccessibility: { isReduceMotionEnabled: () => true },
    NSUserDefaults: { standardUserDefaults: () => ({ setObjectForKey() {}, synchronize() {} }) },
    UIView: View, UIToolbar: View, UILabel: View, UIWebView: class extends View { scrollView = new View() },
    UITapGestureRecognizer: class {}, UILongPressGestureRecognizer: class {}, UIButton: { buttonWithType: () => new View() },
    UIColor: { colorWithHexString: color, clearColor: () => color("clear"), whiteColor: () => color("white") },
    UIFont: { systemFontOfSize() {} }, __MNAM_WEB_PANEL_GLOBAL__: { hidePanel(controller: any) { assert.equal(controller, owner.webController) } }
  })
  const originalRequire = sandbox.require
  sandbox.require = (name: string) => name === "./question-clipper" ? api
      : name === "./note-navigation" ? { recordRuntimeState() {} }
      : name === "./clipper-quick-menu" ? { clipperProgressHtml }
      : name === "./quick-menu-geometry" ? { quickMenuGeometry }
        : name === "./ui-tokens" ? { UI_COLORS }
          : name === "./same-map-practice" ? { sameMapPracticeActive: () => false, stopSameMapPractice() {} }
            : originalRequire(name)
  sandbox.exports = {}
  runInNewContext("(function(){" + transpileModule(readFileSync("src/mnutils-entrance.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText + "})()", sandbox)
  const menuApi = sandbox.exports
  menuApi.openClipperQuickMenu(owner)
  assert.equal(api.clipperModeActive(owner), true)
  assert.equal(api.clipperModeActive(webController), false)
  assert.equal(webController.mnutilsQuickMenu, undefined)
  const menu = owner.mnutilsQuickMenu
  assert.equal(menu.expandedFrame.width, 272); assert.equal(menu.expandedFrame.height, 168)
  assert.equal(menu.segment.frame.height, 30)
  assert.equal(menu.clipControls.scrollView, undefined)
  assert.equal(menu.segmentVisual.scrollView.contentInsetAdjustmentBehavior, 2)
  for (const control of [menu.startButton, menu.clipEnd, menu.clipMother, menu.clipReset, menu.closeButton]) assert.equal(control.target, owner)
  assert.equal(menu.clipTitle.userInteractionEnabled, false)
  await api.editClipperQuestionTitle(owner)
  assert.equal(menu.content.userInteractionEnabled, true)
  assert.equal(menu.controls.userInteractionEnabled, true)
  sandbox.self = owner
  await menuApi.onMnutilsQuickMenuStart(); assert.equal(api.clipperSnapshot(owner).running, true)
  assert.equal(menu.clipTitle.userInteractionEnabled, true)
  assert.equal(menu.clipColor.frame.width, menu.clipControls.frame.width)
  assert.equal(menu.clipEnd.backgroundColor.hex, UI_COLORS.accent)
  assert.equal(menu.startButton.backgroundColor.hex, "white")
  assert.equal(menu.startButton.title, "暂停")
  assert.equal(menu.clipEnd.title, "结束")
  assert.equal(menu.segment.frame.height, menu.clipMother.frame.height)
  // Exercise actual drag/dock callbacks: native text and hit targets share frames.
  for (const y of [2, 350, 750, 2]) {
    const frame = owner.mnutilsEntranceBall.frame
    menuApi.onMnutilsEntrancePan({ state: 1, translationInView: () => ({ x: 0, y: 0 }), setTranslationInView() {} })
    menuApi.onMnutilsEntrancePan({ state: 3, translationInView: () => ({ x: 500 - frame.x, y: y - frame.y }), setTranslationInView() {} })
    const center = menu.closeButton.frame.y + menu.closeButton.frame.height / 2
    for (const control of [menu.startButton, menu.clipEnd, menu.clipControls]) {
      assert.equal(control.frame.y + control.frame.height / 2, center)
      assert.ok(control.frame.y >= 0)
      assert.ok(control.frame.y + control.frame.height <= menu.expandedFrame.height)
    }
  }
  await menuApi.onMnutilsQuickMenuStart(); assert.equal(api.clipperSnapshot(owner).running, false)
  assert.equal(menu.clipColor.frame.width, 0)
  assert.equal(menu.startButton.backgroundColor.hex, "#d92d20")
  assert.equal(menu.clipEnd.backgroundColor.hex, "white")
  sandbox.self = webController; h.flush()
  sandbox.self = owner; menuApi.onClipperEnd()
  assert.equal(api.clipperModeActive(owner), false)
  assert.deepEqual(h.toolbar, [false])
  menuApi.openClipperQuickMenu(owner)
  await menuApi.onMnutilsQuickMenuStart()
  menuApi.onMnutilsQuickMenuDismiss()
  assert.equal(api.clipperModeActive(owner), true)
  assert.equal(api.clipperSnapshot(owner).running, true)
  assert.equal(owner.mnutilsQuickMenu, undefined)
  menuApi.openClipperQuickMenu(owner)
  assert.equal(api.clipperSnapshot(owner).running, true)
  menuApi.onClipperResetQuestion()
  assert.equal(api.clipperSnapshot(owner).stage, "title")
  menuApi.onClipperEnd()
  menuApi.openClipperQuickMenu(owner)
  const press = (state: number, x: number, y: number) => menuApi.onMnutilsQuickMenuModePress({ state, locationInView: () => ({ x, y }) })
  const begin = () => {
    const m = owner.mnutilsQuickMenu, b = m.startButton.frame
    press(1, m.expandedFrame.x + b.x + b.width / 2, m.expandedFrame.y + b.y + b.height / 2)
    return m.modePicker
  }
  let picker = begin()
  press(2, picker.frame.x + 72, picker.frame.y + 22)
  assert.equal(picker.selected, 0)
  press(4, picker.frame.x + 72, picker.frame.y + 22)
  assert.equal(api.clipperModeActive(owner), true)
  picker = begin()
  press(3, picker.frame.x + 72, picker.frame.y + 22)
  assert.equal(api.clipperModeActive(owner), false)
  picker = begin()
  press(3, picker.frame.x + 72, picker.frame.y + 66)
  assert.equal(api.clipperModeActive(owner), true)
  await menuApi.onMnutilsQuickMenuStart()
  assert.equal(api.clipperSnapshot(owner).started, false)
  owner.quickMenuModePressAt = 0
  menuApi.onClipperEnd()
  // During opening, loading refreshes must leave the shell collapsed until the
  // common native animation applies its update. Closing uses the same duration.
  sandbox.UIAccessibility.isReduceMotionEnabled = () => false
  const animations: Array<{ update: () => void; resolve: () => void; seconds: number }> = []
  sandbox.MNUtil.animate = (update: () => void, seconds: number) => new Promise<void>(resolve => animations.push({ update, resolve, seconds }))
  menuApi.openClipperQuickMenu(owner)
  const animatedMenu = owner.mnutilsQuickMenu
  assert.equal(animatedMenu.content.frame.width, 44)
  const assertReveal = () => {
    assert.equal(animatedMenu.content.alpha, 1)
    assert.equal(animatedMenu.content.frame.x + animatedMenu.controls.frame.x, animatedMenu.expandedFrame.x)
    assert.equal(animatedMenu.content.frame.y + animatedMenu.controls.frame.y, animatedMenu.expandedFrame.y)
  }
  assertReveal()
  h.flush()
  assert.equal(animatedMenu.content.frame.width, 44)
  assert.equal(animatedMenu.content.backgroundColor.hex, "clear")
  const ballOpening = animations.shift()!
  assert.equal(ballOpening.seconds, .08)
  ballOpening.update(); ballOpening.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(animatedMenu.content.frame.width, 44)
  assert.equal(animatedMenu.content.backgroundColor.hex, UI_COLORS.surface)
  const opening = animations.shift()!
  assert.equal(opening.seconds, .24)
  opening.update(); opening.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(animatedMenu.content.frame.width, 272)
  assertReveal()
  menuApi.onMnutilsQuickMenuDismiss()
  const closing = animations.shift()!
  assert.equal(closing.seconds, opening.seconds)
  closing.update(); closing.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(animatedMenu.content.frame.width, 44)
  assertReveal()
  assert.equal(owner.mnutilsQuickMenu, animatedMenu)
  const ballClosing = animations.shift()!
  assert.equal(ballClosing.seconds, ballOpening.seconds)
  ballClosing.update(); ballClosing.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(animatedMenu.content.backgroundColor.hex, "clear")
  assert.equal(owner.mnutilsQuickMenu, undefined)
  assert.equal(api.clipperModeActive(owner), true)
})

test("关闭答案后连续创建独立题目，运行中关闭撤销待处理答案", () => {
  const h = harness(), { api } = h
  api.saveClipperSetting(false); api.saveClipperAnswerSetting(false)
  api.enterClipperMode(() => {}); api.toggleClipperRunning(); h.flush()
  const q1 = h.note("q1"), q2 = h.note("q2")
  h.excerpt("q1"); h.flush(); h.excerpt("q2"); h.flush()
  assert.equal(q1.childNotes.length, 0); assert.equal(q2.parentNote, undefined)
  assert.equal(api.clipperSnapshot().completed, 2)
  assert.equal(api.clipperSnapshot().stage, "question")
  api.saveClipperAnswerSetting(true)
  const q3 = h.note("q3"); h.excerpt("q3"); h.flush()
  assert.equal(api.clipperSnapshot().stage, "answer")
  const a = h.note("a"); h.excerpt("a")
  api.saveClipperAnswerSetting(false); h.flush()
  assert.equal(a.parentNote, undefined); assert.equal(q3.childNotes.length, 0)
  assert.equal(api.clipperSnapshot().completed, 3)
  api.exitClipperMode(); api.enterClipperMode(() => {})
  assert.equal(api.clipperSnapshot().excerptAnswer, false)
})

test("母卡只按当前选中卡片绑定、重绑；无选中时取消绑定", () => {
  const h = harness()
  h.api.enterClipperMode(() => {})
  h.select(h.note("mother1", "母卡一")); h.api.bindClipperMother()
  assert.equal(h.api.clipperSnapshot().motherId, "mother1")
  h.select(h.note("mother2", "母卡二")); h.api.bindClipperMother()
  assert.equal(h.api.clipperSnapshot().motherTitle, "母卡二")
  h.select(undefined); h.api.bindClipperMother()
  assert.equal(h.api.clipperSnapshot().motherId, "")
})

test("重置本题不删除已有卡片，保留母卡和完成数，废弃旧通知与题目引用", () => {
  const h = harness(), { api } = h
  h.select(h.note("mother")); api.enterClipperMode(() => {}); api.bindClipperMother()
  api.toggleClipperRunning(); h.flush()
  h.note("title", "第一题"); h.excerpt("title"); h.flush()
  api.resetClipperQuestion(); h.flush()
  assert.equal(h.notes.has("title"), true)
  assert.equal(api.clipperSnapshot().title, "")
  assert.equal(api.clipperSnapshot().motherId, "mother")
  h.note("t2", "第二题"); h.excerpt("t2"); h.flush()
  const q = h.note("q"); h.excerpt("q"); h.flush()
  h.note("late-answer"); h.excerpt("late-answer")
  api.resetClipperQuestion(); h.flush()
  assert.equal(api.clipperSnapshot().stage, "title")
  assert.equal(h.notes.has("q"), true)
  assert.equal(q.childNotes.length, 0)
  assert.equal(api.clipperSnapshot().completed, 0)
  api.toggleClipperRunning()
  api.resetClipperQuestion(); h.flush()
  assert.equal(api.clipperSnapshot().running, false)
  api.exitClipperMode(); api.saveClipperSetting(false); api.enterClipperMode(() => {})
  api.toggleClipperRunning(); api.resetClipperQuestion(); h.flush()
  assert.equal(api.clipperSnapshot().stage, "question")
})


test("开始前检查当前流程全部工具：未绑定不开始、不调工具；跳过步骤无需绑定", () => {
  const h = harness()
  h.stored["cardlink.question-clipper.v1"] = { tools: { question: "ToolRectCut" } }
  h.api.enterClipperMode(() => {})
  h.api.toggleClipperRunning()
  assert.equal(h.api.clipperSnapshot().started, false)
  assert.equal(h.api.clipperSnapshot().running, false)
  assert.match(h.notices[h.notices.length - 1], /标题、答案摘录工具/)
  h.flush()
  assert.deepEqual([...h.checked], ["ToolTextExcerpt"])
  h.api.saveClipperSetting(false)
  h.api.saveClipperAnswerSetting(false)
  h.api.toggleClipperRunning(); h.flush()
  assert.equal(h.api.clipperSnapshot().started, true)
  assert.equal(h.api.clipperSnapshot().running, true)
  assert.deepEqual([...h.checked], ["ToolRectCut"])
})
