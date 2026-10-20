import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function policy() {
  const scope: any = {}
  runInNewContext(readFileSync("web/host-policy.js", "utf8"), scope)
  return scope.CardLinkHostPolicy
}

test("4.5.0 门限解析宿主版本，场景状态只接受明确 true", () => {
  const p = policy()
  for (const version of ["4.5.0", "4.5.0(450)", "4.10.0", "5.0.0"]) {
    assert.equal(p.sceneEnabled(version, { state: { immersive: true } }), true)
  }
  for (const version of ["4.0.2(97)", "4.4.9", "3.9.9", "", undefined, "450"]) {
    assert.equal(p.versionAtLeast450(version), false)
  }
  for (const ui of [null, {}, { state: {} }, { state: { immersive: false } }, { state: { immersive: 1 } }, { error: {}, state: { immersive: true } }]) {
    assert.equal(p.sceneEnabled("4.5.0", ui), false)
  }
})

function native(version = "4.5.0", permitted = true, loadResult: any = true) {
  const calls: any[] = [], timers: (() => void)[] = []
  const owner: any = { window: "window" }, controller: any = { addon: owner }
  const panel: any = {
    loadPanel() { calls.push("load"); return loadResult },
    showFloatingIn(study: any) { assert.equal(study, "study"); calls.push("show") },
    hideFloating() { calls.push("hide") },
    post(event: string, data: any) { calls.push({ event, data }) }
  }
  const legacy: any = {
    showPanel() { calls.push("classic") }, hidePanel() { calls.push("classicHide") },
    isVisible() { return false }, restorePanelAfterNotebookSwitch() { calls.push("classicRestore") },
    panelCloseButtonSide() { return "left" }, setPanelCloseButtonSide() {}
  }
  const scope: any = {
    CardLinkHostPolicy: policy(), __MNAM_WEB_PANEL_GLOBAL__: legacy,
    Application: { sharedInstance: () => ({ appVersion: version, studyController: () => "study" }) },
    AddonWebPanel: { panel: () => { calls.push("factory"); return permitted ? panel : null } },
    NSUserDefaults: { standardUserDefaults: () => ({ setObjectForKey() {} }) },
    NSTimer: { scheduledTimerWithTimeInterval: (_delay: number, _repeat: boolean, callback: () => void) => {
      let active = true
      timers.push(() => { if (active) callback() })
      return { invalidate() { active = false } }
    } },
    __MNAM_WEB_BRIDGE_GLOBAL__: { dispatch: async (context: any, command: string, payload: any) => {
      assert.equal(context.addon, owner); return { command, payload }
    } },
    __MN_ANSWER_CORE_GLOBAL__: { sceneWorkbenchEnabled: () => true, annotationLog() {}, cardToolbar: { isEnabled: () => true } }
  }
  runInNewContext(readFileSync("rails-native/SceneMedia.js", "utf8"), scope)
  runInNewContext(readFileSync("rails-native/SceneWorkbench.js", "utf8"), scope)
  return { calls, timers, owner, controller, panel, legacy, scope, helper: scope.__MNAM_SCENE_WORKBENCH_GLOBAL__ }
}

test("旧版本和未知版本保留经典面板，完全不创建场景面板", () => {
  for (const version of ["4.4.9", "", "450"]) {
    const n = native(version)
    n.legacy.showPanel(n.controller)
    assert.deepEqual(n.calls, ["classic"])
    assert.equal(n.helper.enabled(n.owner), false)
  }
})

test("宿主不允许场景面板或加载明确失败时回退经典面板", () => {
  for (const n of [native("4.5.0", false), native("4.5.0", true, false)]) {
    n.legacy.showPanel(n.controller)
    assert.equal(n.calls[n.calls.length - 1], "classic")
    assert.equal(n.helper.enabled(n.owner), false)
  }
})

test("正式场景面板确认状态后才能处理业务；异步回复使用 post", async () => {
  const n = native("4.5.0", true, undefined)
  n.legacy.showPanel(n.controller)
  assert.deepEqual(n.calls.slice(0, 4), ["factory", "load", "classicHide", "show"])
  assert.ok(n.panel.onMessage("bridgeRequest", {}).error)
  assert.equal(n.panel.onMessage("sceneReady", { state: { immersive: true } }).enabled, true)
  const ack = n.panel.onMessage("bridgeRequest", { requestId: "r", command: "dashboard", payload: { x: 1 } })
  assert.equal(ack.accepted, true)
  assert.equal(typeof ack.then, "undefined")
  await new Promise(resolve => setImmediate(resolve))
  const response = n.calls.find(c => c.event === "bridgeResponse")
  assert.equal(response.data.requestId, "r")
  assert.equal(response.data.payload.command, "dashboard")
  n.panel.onMessage("sceneRejected", {})
  assert.equal(n.helper.enabled(n.owner), false)
  assert.ok(n.panel.onMessage("bridgeRequest", {}).error)
  n.timers[1]()
  assert.equal(n.calls[n.calls.length - 1], "classic")
})

test("跨学习集恢复同一面板，关闭后清理并禁止迟到回复", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  n.controller.preserveAcrossNotebookSwitch = true
  n.legacy.restorePanelAfterNotebookSwitch(n.controller)
  assert.equal(n.calls.filter(c => c === "factory").length, 1)
  assert.equal(n.calls.find(c => c.event === "panelShown").data.skipReload, true)
  n.panel.onMessage("bridgeRequest", { requestId: "late", command: "dashboard" })
  n.helper.dispose(n.owner)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(n.calls.some(c => c.event === "bridgeResponse"), false)
  assert.equal(n.helper.enabled(n.owner), false)
})

test("启动资源或应用未完成渲染时，原生看门狗恢复经典面板", () => {
  for (const confirmed of [false, true]) {
    const n = native()
    n.legacy.showPanel(n.controller)
    if (confirmed) n.panel.onMessage("sceneReady", { state: { immersive: true } })
    n.timers[0]()
    assert.equal(n.helper.enabled(n.owner), false)
    assert.equal(n.panel.onMessage("sceneReady", { state: { immersive: true } }).enabled, false)
    n.timers[1]()
    assert.equal(n.calls[n.calls.length - 1], "classic")
  }
})

test("应用渲染完成取消启动看门狗，不误关闭正常面板", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  n.panel.onMessage("bridgeRequest", { command: "runtimeLog", payload: { event: "boot.appRendered" } })
  await new Promise(resolve => setImmediate(resolve))
  n.timers[0]()
  assert.equal(n.helper.enabled(n.owner), true)
  assert.equal(n.calls.includes("classic"), false)
})

test("手写目标解析失败回复明确错误", async () => {
  const n = native()
  n.scope.__MNAM_WEB_BRIDGE_GLOBAL__.dispatch = async () => { throw new Error("来源题卡不可用") }
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  n.panel.onMessage("bridgeRequest", { requestId: "failed", command: "openMistakeHandwriting" })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(n.calls.find(c => c.event === "bridgeResponse").data.error.message, /题卡不可用/)
})

async function boot(version: string, ui: any, savedSize: any = null) {
  const scripts: any[] = [], calls: string[] = [], timers: (() => Promise<void>)[] = []
  const root: any = { style: {} }
  const scope: any = {
    window: { CardLinkHostPolicy: policy(), addEventListener() {}, localStorage: { getItem: () => JSON.stringify(savedSize) }, mn: {
      async call(name: string) { calls.push(name); return name === "hostInfo" ? { version } : { enabled: true } },
      async api() { calls.push("ui-state"); return ui },
      mode(m: string) { calls.push(`mode:${m}`) },
      size(w: number, h: number) { calls.push(`size:${w}x${h}`) }
    } },
    document: { documentElement: { dataset: {} }, getElementById: () => root, createElement: () => ({}), body: { style: {}, appendChild: (node: any) => scripts.push(node) } },
    setTimeout: (callback: () => Promise<void>, delay: number) => delay === 0 ? timers.push(callback) : setTimeout(callback, delay), clearTimeout
  }
  runInNewContext(readFileSync("web/boot.js", "utf8"), scope)
  assert.equal(scripts.length, 0)
  await timers[0]()
  return { scripts, calls, window: scope.window }
}

test("启动在版本和场景确认后才装载应用；低版本不请求新 API", async () => {
  const old = await boot("4.4.9", { state: { immersive: true } })
  assert.deepEqual(old.calls, ["hostInfo", "sceneRejected"])
  assert.equal(old.scripts.length, 0)
  const rejected = await boot("4.5.0", { state: { immersive: false } })
  assert.equal(rejected.scripts.length, 0)
  assert.equal(rejected.window.__MN_SCENE_ENABLED__, undefined)
  const enabled = await boot("4.5.0", { state: { immersive: true } })
  assert.equal(enabled.scripts[0].src, "./app.js")
  assert.equal(enabled.window.__MN_SCENE_ENABLED__, true)
})

test("重开场景窗口按保存宽度恢复，不截断到1400或面板screen宽度", async () => {
  const value = await boot("4.5.0", { state: { immersive: true } }, { width: 1800, height: 720 })
  assert.ok(value.calls.includes("size:1800x720"))
})

function transport() {
  const events: Record<string, ((event: any) => void)[]> = {}, handlers: any = {}, calls: any[] = []
  let immersive = true
  const window: any = {
    __MN_HOST_VERSION__: "4.5.0", CustomEvent: class { constructor(public type: string, public detailObject: any) {} get detail() { return this.detailObject.detail } },
    addEventListener: (name: string, handler: any) => (events[name] ||= []).push(handler),
    dispatchEvent: (event: any) => (events[event.type] || []).forEach(handler => handler(event))
  }
  const target = { noteid: "question", topicid: "source-not-open", recordId: "record" }
  const sdk: any = {
    on(name: string, handler: any) { handlers[name] = handler }, log() {}, size(width: number, height: number) { calls.push({ size: [width, height] }) },
    async call(name: string, payload: any) {
      calls.push({ name, payload })
      if (name === "bridgeRequest") {
        queueMicrotask(() => window.dispatchEvent({ type: "mn:bridgeResponse", detail: { requestId: payload.requestId, payload: target } }))
        return { accepted: true }
      }
      return {}
    }
  }
  const annotation = {
    async open(noteid: string, beforeWrite: () => Promise<any>) { await beforeWrite(); calls.push({ open: [noteid] }); return { editorOpened: true } },
    async read(noteid: string) { calls.push({ read: noteid }); return { revision: "r", comments: [{ commentId: "paper" }] } }
  }
  const scope: any = { exports: {}, setTimeout, clearTimeout }
  runInNewContext(transpileModule(readFileSync("web/src/lib/sceneTransport.js", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const client = scope.exports.createSceneTransport(sdk, window, async (url: string) => {
    calls.push({ url }); return { json: async () => ({ state: { immersive, topicid: "topic", focusnoteid: "wrong-focus" } }) }
  }, policy(), annotation)
  return { client, calls, handlers, window, annotation, exit() { immersive = false } }
}

test("题目不属于当前学习集仍直接按ID批注，关闭保存事件只刷新对应题目", async () => {
  const t = transport(), saved: string[] = []
  t.window.addEventListener("cardlink:annotation-saved", (event: any) => saved.push(event.detail.recordId))
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
  assert.deepEqual(t.calls.find(c => c.open).open, ["question"])
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
  await t.handlers.practice({ noteid: "other", saved: true, commentId: "paper" })
  assert.equal(saved.length, 0)
  await t.handlers.practice({ noteid: "question", saved: true, commentId: "paper" })
  assert.deepEqual(saved, ["record"])
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
  await t.handlers.practice({ noteid: "question", saved: false })
  assert.deepEqual(saved, ["record"])
})

test("普通批注关闭无practice事件时仍可再次打开，仅打开请求未结束时阻止重复点击", async () => {
  const t = transport()
  let complete: (value: any) => void = () => {}
  t.annotation.open = async (_noteid: string, beforeWrite: () => Promise<any>) => {
    await beforeWrite()
    return new Promise(resolve => { complete = resolve }) as Promise<any>
  }
  const opening = t.client.send("openMistakeHandwriting", { recordId: "record" })
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(t.client.send("openMistakeHandwriting", {}), /正在打开/)
  complete({ editorOpened: true })
  await opening
  t.annotation.open = async () => ({ editorOpened: true })
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
})

test("宿主拒绝占用请求不留下插件锁；comments变化可刷新普通批注详情", async () => {
  const t = transport(), saved: string[] = []
  t.window.addEventListener("cardlink:annotation-saved", (event: any) => saved.push(event.detail.recordId))
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
  t.annotation.open = async () => { throw new Error("ANNOTATION_UNAVAILABLE") }
  await assert.rejects(t.client.send("openMistakeHandwriting", {}), /ANNOTATION_UNAVAILABLE/)
  await t.handlers.comments({ noteids: ["other"] })
  assert.equal(saved.length, 0)
  await t.handlers.comments({ noteids: ["question"] })
  assert.deepEqual(saved, ["record"])
  t.annotation.open = async () => ({ editorOpened: true })
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
})

test("离开场景不再发送业务和书写，低版本连 ui-state 都不请求", async () => {
  const t = transport()
  t.exit()
  await assert.rejects(t.client.send("openMistakeHandwriting", {}), /已离开场景/)
  assert.equal(t.calls.some(c => c.open || c.name === "bridgeRequest"), false)
  t.calls.length = 0
  t.window.__MN_HOST_VERSION__ = "4.4.9"
  await assert.rejects(t.client.send("dashboard", {}), /4.5.0/)
  assert.equal(t.calls.length, 0)
})


test("菜单小面板就绪取消启动看门狗，等级选择超过20秒不回退工作台", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  assert.equal(n.panel.onMessage("sceneCommandReady", {}).ready, true)
  n.timers[0]()
  assert.equal(n.helper.enabled(n.owner), true)
  assert.equal(n.calls.includes("classic"), false)
})

test("小面板与已打开工作台请求并行时，回复不会串到另一条请求", async () => {
  const events: any[] = [], requests: any[] = []
  const scope: any = {exports:{},setTimeout,clearTimeout}
  runInNewContext(transpileModule(readFileSync('web/src/lib/sceneTransport.js','utf8'),{compilerOptions:{module:1,target:7}}).outputText,scope)
  const window: any = {__MN_HOST_VERSION__:'4.5.0',addEventListener:(name:string,handler:any)=>{if(name==='mn:bridgeResponse')events.push(handler)}}
  const sdk: any = {on(){},call:async(name:string,payload:any)=>{if(name==='bridgeRequest')requests.push(payload);return {accepted:true}}}
  const fetch = async()=>({json:async()=>({state:{immersive:true}})})
  const workbench=scope.exports.createSceneTransport(sdk,window,fetch,policy(),null)
  const menu=scope.exports.createSceneTransport(sdk,window,fetch,policy(),null,'card-menu-')
  let workbenchDone=false,menuDone=false
  const a=workbench.send('dashboard',{}).then(()=>{workbenchDone=true})
  const b=menu.send('cardMenuCommand',{}).then(()=>{menuDone=true})
  for(let i=0;i<10;i++)await Promise.resolve()
  assert.equal(requests.length,2);assert.notEqual(requests[0].requestId,requests[1].requestId)
  for(const handler of events)handler({detail:{requestId:requests[1].requestId,payload:{}}})
  await b;assert.equal(menuDone,true);assert.equal(workbenchDone,false)
  for(const handler of events)handler({detail:{requestId:requests[0].requestId,payload:{}}})
  await a;assert.equal(workbenchDone,true)
})


test("场景总开关关闭不创建面板，开启仍须满足版本；关闭已有面板后再次打开回到经典", () => {
  const n = native()
  let enabled = false
  n.scope.__MN_ANSWER_CORE_GLOBAL__.sceneWorkbenchEnabled = () => enabled
  n.legacy.showPanel(n.controller)
  assert.deepEqual(n.calls, ["classic"])
  enabled = true
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  assert.equal(n.helper.enabled(n.owner), true)
  enabled = false
  n.legacy.showPanel(n.controller)
  assert.equal(n.helper.enabled(n.owner), false)
  assert.deepEqual(n.calls.slice(-2), ["hide", "classic"])
  const old = native("4.4.9")
  old.legacy.showPanel(old.controller)
  assert.deepEqual(old.calls, ["classic"])
})

test("场景面板与手写须同时满足前置开关及已确认场景；已打开时关闭立即禁用手写", () => {
  const source = readFileSync("src/rails-core.ts", "utf8")
  const fn = source.match(/function sceneFeatures\([\s\S]*?\n\}/)![0]
  let enabled = false, confirmed = true
  const scope: any = { exports: {}, loadMatcherSettings: () => ({ sceneWorkbenchEnabled: enabled }), self: {} }
  scope.__MNAM_SCENE_WORKBENCH_GLOBAL__ = { enabled: () => confirmed }
  runInNewContext(transpileModule(fn + "\nexports.features = sceneFeatures", { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  assert.equal(scope.exports.features().handwriting, false)
  enabled = true
  assert.equal(scope.exports.features().scenePanel, true)
  assert.equal(scope.exports.features().handwriting, true)
  confirmed = false
  assert.equal(scope.exports.features().scenePanel, false)
  confirmed = true; enabled = false
  assert.equal(scope.exports.features().handwriting, false)
})


test("菜单残留的过小保存尺寸不用于主工作台，恢复标准模式与尺寸", async () => {
  const f = await boot("4.5.0", { state: { immersive: true } }, { width: 240, height: 64 })
  assert.ok(f.calls.includes("mode:workspace"))
  assert.ok(f.calls.includes("size:640x620"))
})

test("仅确认批注编辑器打开后缩为360×600完整工作台，失败不改尺寸、不收起", async () => {
  const t = transport()
  await t.client.send("openMistakeHandwriting", { recordId: "record" })
  const opened = t.calls.findIndex(c => c.open)
  const resized = t.calls.findIndex(c => c.size)
  assert.ok(opened >= 0 && resized > opened)
  assert.deepEqual(t.calls[resized].size, [360, 600])
  assert.equal(t.calls.some(c => c.name === "sceneMinimize"), false)
  assert.equal(t.calls.some(c => c.name === "sceneClose"), false)
  const failed = transport()
  failed.annotation.open = async () => { throw new Error("ANNOTATION_UNAVAILABLE") }
  await assert.rejects(failed.client.send("openMistakeHandwriting", { recordId: "record" }), /ANNOTATION_UNAVAILABLE/)
  assert.equal(failed.calls.some(c => c.name === "sceneClose"), false)
  assert.equal(failed.calls.some(c => c.size || c.name === "sceneMinimize"), false)
})


test("工作台收起与恢复复用同一个原生会话，只有明确退出才销毁", async () => {
 const n = native()
 n.legacy.showPanel(n.controller)
 n.panel.onMessage("sceneReady", {state:{immersive:true}})
 n.panel.onMessage("sceneCommandReady", {})
 n.legacy.hidePanel(n.controller, true)
 assert.equal(n.helper.enabled(n.owner),true)
 assert.equal(n.legacy.isVisible(n.controller),false)
 assert.equal(n.calls.includes("hide"),false)
 assert.ok(n.calls.some(c=>c.event==='workbenchCollapse'))
 n.legacy.showPanel(n.controller)
 assert.equal(n.legacy.isVisible(n.controller),true)
 assert.equal(n.calls.filter(c=>c==='factory').length,1)
 n.panel.onMessage("sceneMinimize", {})
 assert.equal(n.legacy.isVisible(n.controller),false)
 n.panel.onMessage("sceneExpand", {})
 assert.equal(n.legacy.isVisible(n.controller),true)
 n.panel.onMessage("sceneClose", {})
 n.timers[n.timers.length-1]()
 assert.equal(n.helper.enabled(n.owner),false)
 assert.equal(n.calls.filter(c=>c==='hide').length,1)
})
