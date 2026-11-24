import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function windowSizeApi() {
  const scope: any = { exports: {} }
  runInNewContext(transpileModule(readFileSync("web/src/lib/sceneWindow.js", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  return scope.exports
}

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

function native(version = "5.0.0", permitted = true, loadResult: any = true) {
  const calls: any[] = [], timers: (() => void)[] = [], surfaceTimers: (() => void)[] = []
  const surfaceIntervals: number[] = []
  let activeSurfaceWatchers = 0
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
    NSTimer: { scheduledTimerWithTimeInterval: (delay: number, repeat: boolean, callback: () => void) => {
      let active = true
      if (repeat) { activeSurfaceWatchers++; surfaceIntervals.push(delay) }
      ;(repeat ? surfaceTimers : timers).push(() => { if (active) callback() })
      return { invalidate() { if (active && repeat) activeSurfaceWatchers--; active = false } }
    } },
    __MNAM_WEB_BRIDGE_GLOBAL__: { dispatch: async (context: any, command: string, payload: any) => {
      assert.equal(context.addon, owner); return { command, payload }
    } },
    __MN_ANSWER_CORE_GLOBAL__: { isSceneMode: () => /^\d+\./.test(version) && parseInt(version, 10) >= 5, notifySceneUnavailable(message: string) { calls.push({ message }) }, annotationLog() {}, enableMistakeDrag() {}, disableMistakeDrag() {}, cardToolbar: { isEnabled: () => true },
      closeCardMistakePanel(target: any) { assert.equal(target, owner); calls.push('closeMistakePanel') } }
  }
  runInNewContext(readFileSync("rails-native/SceneMedia.js", "utf8"), scope)
  runInNewContext(readFileSync("rails-native/SceneWorkbench.js", "utf8"), scope)
  return { calls, timers, surfaceTimers, surfaceIntervals, get activeSurfaceWatchers() { return activeSurfaceWatchers }, owner, controller, panel, legacy, scope, helper: scope.__MNAM_SCENE_WORKBENCH_GLOBAL__ }
}

function fadedNativeView(host: any, alpha = .6, width = 640, height = 520) {
  return { className: 'UIView', superview: host, alpha, frame: { x: 20, y: 100, width, height }, layer: { opacity: alpha } }
}
function nativeWeb(parent: any) {
  return { description: () => '<WKWebView: 0x111>', superview: parent,
    get URL(): any { return assert.fail('参考实现不读取 URL') },
    get evaluateJavaScript(): any { return assert.fail('参考实现不依赖网页脚本能力') } }
}

test('按参考原生条件找到唯一淡化父容器：无 URL 或脚本接口仍恢复，保持稳定不反复写入', () => {
  const h = native(), host: any = { subviews: [] };
  let writes = 0, value = .6;
  const own: any = fadedNativeView(host), foreign = fadedNativeView(host, 1);
  own.layer = { get opacity() { return value }, set opacity(v) { value = v; writes++ } };
  host.subviews = [nativeWeb(own), nativeWeb(foreign)];
  h.owner.window = host; h.legacy.showPanel(h.controller); h.surfaceTimers[0]();
  assert.equal(value, 1); assert.equal(writes, 1); assert.equal(foreign.layer.opacity, 1);
  h.surfaceTimers[0](); assert.equal(writes, 1, 'alpha 仍为 .6 不能反复写图层');
  value = .6; h.surfaceTimers[0](); assert.equal(value, 1); assert.equal(writes, 2);
  value = 0; h.surfaceTimers[0](); assert.equal(value, 0, '不恢复主动隐藏');
  own.hidden = true; value = .6; h.surfaceTimers[0](); assert.equal(value, .6);
  own.hidden = false; h.helper.dispose(h.owner); h.surfaceTimers[0](); assert.equal(value, .6);
});

test('首次校正与持续监视严格分开：alpha=.6 且 layer=1 首次写回一次，后续只看图层回退', () => {
  const h = native(), host: any = { subviews: [] };
  let writes = 0;
  const target: any = fadedNativeView(host);
  target.layer = { get opacity() { return 1 }, set opacity(_v) { writes++ } };
  host.subviews = [nativeWeb(target)];
  h.owner.window = host; h.legacy.showPanel(h.controller); h.surfaceTimers[0]();
  assert.equal(writes, 1); h.surfaceTimers[0](); assert.equal(writes, 1);
  target.alpha = 1; h.surfaceTimers[0](); target.alpha = .6; h.surfaceTimers[0](); assert.equal(writes, 1);
});

test('多个被淡化的容器一律不改；隐藏、小窗和其他父容器类型不列为候选', () => {
  const h = native(), host: any = { subviews: [] };
  const one: any = fadedNativeView(host), two: any = fadedNativeView(host);
  const small: any = fadedNativeView(host, .6, 200, 160), hidden: any = fadedNativeView(host);
  hidden.hidden = true;
  const other: any = fadedNativeView(host); other.className = 'OtherContainer';
  host.subviews = [one, two, small, hidden, other].map(nativeWeb);
  h.owner.window = host; h.legacy.showPanel(h.controller); h.surfaceTimers[0]();
  assert.equal(one.layer.opacity, .6); assert.equal(two.layer.opacity, .6);
  assert.match(h.owner.cardLinkSceneSurfaceStatus.detail, /2 个/);
});

test('layer 写入失败或不可读时仅调用可用的 setAlpha；没有 setAlpha 也不误报已校正', () => {
  for (const unreadable of [false, true]) {
    const h = native(), host: any = { subviews: [] }, target: any = fadedNativeView(host);
    let calls = 0;
    target.layer = { get opacity() { if (unreadable) throw Error('not exported'); return .6 }, set opacity(_v) { throw Error('readonly') } };
    target.setAlpha = (v: number) => { target.alpha = v; calls++ };
    host.subviews = [nativeWeb(target)]; h.owner.window = host;
    h.legacy.showPanel(h.controller);
    assert.equal(calls, 1); assert.equal(target.alpha, 1);
    assert.equal(h.owner.cardLinkSceneSurfaceStatus.event, 'panel.surfaceVisible');
  }
  const h = native(), host: any = { subviews: [] }, target: any = fadedNativeView(host);
  target.layer = { get opacity() { return .6 }, set opacity(_v) { throw Error('readonly') } };
  host.subviews = [nativeWeb(target)]; h.owner.window = host;
  h.legacy.showPanel(h.controller); h.surfaceTimers[0]();
  assert.equal(h.owner.cardLinkSceneSurfaceStatus.event, 'panel.surfaceHidden');
});

test('首次自动等待淡化；已绑定容器移除后重新查找新容器，收起期间暂停', () => {
  const h = native(), host: any = { subviews: [] }, target: any = fadedNativeView(host, 1);
  let now = 1000; h.scope.Date = { now: () => now };
  host.subviews = [nativeWeb(target)]; h.owner.window = host;
  h.legacy.showPanel(h.controller); h.surfaceTimers[0]();
  assert.equal(h.owner.cardLinkSceneSurfaceStatus.event, 'panel.surfaceCandidates');
  target.alpha = .6; target.layer.opacity = .6; now += 1000; h.surfaceTimers[0]();
  assert.equal(target.layer.opacity, 1);
  const next: any = fadedNativeView(host); target.superview = null; host.subviews = [nativeWeb(next)];
  now += 1000; h.surfaceTimers[0](); assert.equal(next.layer.opacity, 1);
  h.panel.onMessage('sceneReady', { state: { immersive: true } });
  h.panel.onMessage('sceneMinimize'); next.layer.opacity = .6; h.surfaceTimers[0](); assert.equal(next.layer.opacity, .6);
  assert.equal(h.activeSurfaceWatchers, 0);
  h.panel.onMessage('sceneExpand'); assert.equal(next.layer.opacity, 1);
  assert.equal(h.activeSurfaceWatchers, 1);
  h.panel.onMessage('sceneCommandReady');
  h.legacy.hidePanel(h.controller, true); assert.equal(h.activeSurfaceWatchers, 0);
  next.layer.opacity = .6;
  h.legacy.showPanel(h.controller); assert.equal(next.layer.opacity, 1);
  h.legacy.showPanel(h.controller); assert.equal(h.activeSurfaceWatchers, 1);
  assert.deepEqual(h.surfaceIntervals, [0.5, 0.5, 0.5]);
  h.helper.dispose(h.owner); assert.equal(h.activeSurfaceWatchers, 0);
});

test('首次做题自动建立场景通道；握手和应用就绪后才完成，同步请求复用面板', async () => {
  const n = native()
  n.owner.webController = n.controller
  let done = false
  const ready = n.helper.ensureReady(n.owner).then((value: boolean) => { done = true; return value })
  const second = n.helper.ensureReady(n.owner)
  assert.equal(n.calls.filter(c => c === 'factory').length, 1)
  n.panel.onMessage('sceneReady', { state: { immersive: true } })
  await Promise.resolve()
  assert.equal(done, false)
  n.panel.onMessage('bridgeRequest', { command: 'runtimeLog', payload: { event: 'boot.appRendered' } })
  assert.equal(await ready, true)
  assert.equal(await second, true)
  assert.ok(n.calls.some(c => c.event === 'workbenchCollapse'))
  assert.equal(await n.helper.ensureReady(n.owner), true)
  assert.equal(n.calls.filter(c => c === 'factory').length, 1)
})

test('首次场景初始化拒绝、超时或销毁均结束等待；低版本不创建面板', async () => {
  for (const outcome of ['reject', 'timeout', 'dispose']) {
    const n = native(); n.owner.webController = n.controller
    const ready = n.helper.ensureReady(n.owner)
    if (outcome === 'reject') n.panel.onMessage('sceneRejected', { stage: 'ui', reason: 'not scene' })
    if (outcome === 'timeout') n.timers[0]()
    if (outcome === 'dispose') n.helper.dispose(n.owner)
    assert.equal(await ready, false)
  }
  const old = native('4.4.0'); old.owner.webController = old.controller
  assert.equal(await old.helper.ensureReady(old.owner), false)
  assert.equal(old.calls.length, 0)
})

test('已有菜单小面板不冒充完整批注通道，自动请求工作台并等待实际渲染', async () => {
  const n = native(); n.owner.webController = n.controller
  n.legacy.showPanel(n.controller)
  n.panel.onMessage('sceneReady', { state: { immersive: true } })
  n.panel.onMessage('sceneCommandReady', {})
  let done = false
  const ready = n.helper.ensureReady(n.owner).then((v: boolean) => { done = true; return v })
  assert.ok(n.calls.some(c => c.event === 'workbenchRequested'))
  await Promise.resolve(); assert.equal(done, false)
  n.panel.onMessage('bridgeRequest', { command: 'runtimeLog', payload: { event: 'boot.appRendered' } })
  assert.equal(await ready, true)
})

test("复习批注原生请求按回执ID完成，旧回执忽略；关闭面板取消未完成请求", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  const opening = n.helper.openReviewAnnotation(n.owner, { noteid: "q", advance: "next" })
  const request = n.calls.find(c => c.event === "reviewAnnotationOpen")
  assert.equal(n.panel.onMessage("reviewAnnotationReply", { requestId: "old" }).ignored, true)
  n.panel.onMessage("reviewAnnotationReply", { requestId: request.data.requestId, result: { editorOpened: true } })
  assert.equal((await opening).editorOpened, true)
  const another = n.helper.openReviewAnnotation(n.owner, { noteid: "q2" })
  const rejected = assert.rejects(another, /场景面板已关闭/)
  n.helper.dispose(n.owner)
  await rejected
})

test("场景开启才选择复习方式，取消不启动；场景关闭保持脑图方式", async () => {
  const source = readFileSync("src/rails-core.ts", "utf8")
  const fn = source.slice(source.indexOf("async function chooseReviewWritingMode"), source.indexOf("async function bridgeInternal"))
  let enabled = false, selection = -1, prompts = 0
  const scope: any = { exports: {}, sceneFeatures: () => ({ handwriting: enabled }), select: async (choices: string[]) => {
    prompts++
    assert.deepEqual(Array.from(choices), ["脑图书写模式", "批注书写模式"])
    return { index: selection }
  } }
  runInNewContext(transpileModule(fn + "\nexports.choose = chooseReviewWritingMode", { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  assert.equal(await scope.exports.choose({}), "mindmap")
  assert.equal(prompts, 0)
  enabled = true
  assert.equal(await scope.exports.choose({}), undefined)
  selection = 0
  assert.equal(await scope.exports.choose({}), "mindmap")
  selection = 1
  assert.equal(await scope.exports.choose({}), "annotation")
  selection = 2
  assert.equal(await scope.exports.choose({}), undefined)
})

test("批注先关闭后收到打开回执时释放原生请求，不阻塞下一题", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  const first = n.helper.openReviewAnnotation(n.owner, { noteid: "q1", reviewToken: "one" })
  const firstId = n.calls.find(c => c.event === "reviewAnnotationOpen").data.requestId
  n.panel.onMessage("reviewAnnotationClosed", { reviewToken: "one", noteid: "q1", action: "next", saved: true })
  assert.equal((await first).editorOpened, true)
  const second = n.helper.openReviewAnnotation(n.owner, { noteid: "q2", reviewToken: "two" })
  const secondId = n.calls.filter(c => c.event === "reviewAnnotationOpen")[1].data.requestId
  assert.equal(n.panel.onMessage("reviewAnnotationReply", { requestId: firstId }).ignored, true)
  n.panel.onMessage("reviewAnnotationReply", { requestId: secondId, result: { editorOpened: true } })
  assert.equal((await second).editorOpened, true)
})

test('关闭回执按实际消费结果确认，不能把状态查询误当打开请求完成', async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage('sceneReady', { state: { immersive: true } })
  const query = n.helper.openReviewAnnotation(n.owner, { operation: 'status', reviewToken: 'one' })
  let finished = false
  query.then(() => { finished = true })
  const request = n.calls.find(c => c.event === 'reviewAnnotationOpen')
  assert.equal(n.panel.onMessage('reviewAnnotationClosed', { reviewToken: 'one' }).accepted, false)
  n.owner.cardLinkReviewAnnotationClosed = () => true
  assert.equal(n.panel.onMessage('reviewAnnotationClosed', { reviewToken: 'one' }).accepted, true)
  await Promise.resolve()
  assert.equal(finished, false)
  n.panel.onMessage('reviewAnnotationReply', { requestId: request.data.requestId, result: { state: 'closed' } })
  assert.equal((await query).state, 'closed')
})

test("旧版本和未知版本保留经典面板，完全不创建场景面板", () => {
  for (const version of ["4.4.9", "", "450"]) {
    const n = native(version)
    n.legacy.showPanel(n.controller)
    assert.deepEqual(n.calls, ["classic"])
    assert.equal(n.helper.enabled(n.owner), false)
  }
})

test("宿主不允许场景面板或加载明确失败时提示原因", () => {
  for (const n of [native("5.0.0", false), native("5.0.0", true, false)]) {
    n.legacy.showPanel(n.controller)
    assert.ok(n.calls.some(call => typeof call.message === "string"))
    assert.ok(!n.calls.includes("classic"))
    assert.equal(n.helper.enabled(n.owner), false)
  }
})

test("正式场景面板确认状态后才能处理业务；异步回复使用 post", async () => {
  const n = native("5.0.0", true, undefined)
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
  assert.ok(n.calls.some(call => typeof call.message === "string"))
})

test("场景工具读取独立关联回执，关闭与超时清理请求，迟到回执不会写入", async () => {
  const n = native("5.1.0")
  n.legacy.showPanel(n.controller)
  await assert.rejects(n.helper.readClipperTools(n.owner), /打开当前场景/)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  const reading = n.helper.readClipperTools(n.owner)
  await assert.rejects(n.helper.readClipperTools(n.owner), /正在读取/)
  const posted = n.calls.find(c => c.event === "clipperToolsRead")
  assert.equal(n.panel.onMessage("clipperToolsReply", { requestId: "wrong", result: {} }).ignored, true)
  const data = { available: true, excerptTools: { tools: [{ index: 42, label: "答案" }] } }
  assert.equal(n.panel.onMessage("clipperToolsReply", { requestId: posted.data.requestId, result: data }).accepted, true)
  assert.equal(await reading, data)
  const timeout = n.helper.readClipperTools(n.owner)
  const rejected = assert.rejects(timeout, /超时/)
  n.timers[n.timers.length - 1]()
  await rejected
  const closing = n.helper.readClipperTools(n.owner)
  const closed = assert.rejects(closing, /场景面板已关闭/)
  n.helper.dispose(n.owner)
  await closed
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

test("启动资源或应用未完成渲染时，原生看门狗关闭场景面板并提示", () => {
  for (const confirmed of [false, true]) {
    const n = native()
    n.legacy.showPanel(n.controller)
    if (confirmed) n.panel.onMessage("sceneReady", { state: { immersive: true } })
    n.timers[0]()
    assert.equal(n.helper.enabled(n.owner), false)
    assert.equal(n.panel.onMessage("sceneReady", { state: { immersive: true } }).enabled, false)
    n.timers[1]()
    assert.ok(n.calls.some(call => typeof call.message === "string"))
    assert.ok(!n.calls.includes("classic"))
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

async function boot(version: string, ui: any, savedSize: any = null, defaultSize: any = null) {
  const scripts: any[] = [], calls: string[] = [], timers: (() => Promise<void>)[] = []
  const root: any = { style: {} }
  const scope: any = {
    window: { CardLinkHostPolicy: policy(), addEventListener() {}, localStorage: { getItem: (key: string) => JSON.stringify(key === "cardlink.scene.defaultSizePreset" ? defaultSize : savedSize) }, mn: {
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

test("重启优先加载所选默认预设，不沿用临时大小或截断宽度", async () => {
  const value = await boot("4.5.0", { state: { immersive: true } }, { width: 900, height: 720 }, { width: 1800, height: 720 })
  assert.ok(value.calls.includes("size:1800x720"))
})

function transport(apiReply?: (url: string, options: any) => any) {
  const events: Record<string, ((event: any) => void)[]> = {}, handlers: any = {}, calls: any[] = []
  let immersive = true
  let closeDeliveryFails = false
  let sceneTopic: string | null = "topic"
  const window: any = {
    __MN_HOST_VERSION__: "4.5.0", CustomEvent: class { constructor(public type: string, public detailObject: any) {} get detail() { return this.detailObject.detail } },
    addEventListener: (name: string, handler: any) => (events[name] ||= []).push(handler),
    removeEventListener: (name: string, handler: any) => { events[name] = (events[name] || []).filter(value => value !== handler) },
    dispatchEvent: (event: any) => (events[event.type] || []).forEach(handler => handler(event))
  }
  const target = { noteid: "question", topicid: "source-not-open", recordId: "record" }
  const sdk: any = {
    on(name: string, handler: any) { handlers[name] = handler }, log() {}, size(width: number, height: number) { calls.push({ size: [width, height] }) },
    async call(name: string, payload: any) {
      calls.push({ name, payload })
      if (name === 'sceneReady') return { enabled: true }
      if (name === 'reviewAnnotationClosed' && closeDeliveryFails) throw new Error('JSB unavailable')
      if (name === "bridgeRequest") {
        queueMicrotask(() => window.dispatchEvent({ type: "mn:bridgeResponse", detail: { requestId: payload.requestId, payload: target } }))
        return { accepted: true }
      }
      return {}
    }
  }
  const annotation = {
    async advance(noteid: string, topicid: string, action: string) { calls.push({ advance: [noteid, topicid, action] }); return { advance: action, persisted: false } },
    async open(noteid: string, beforeWrite: () => Promise<any>) { await beforeWrite(); calls.push({ open: [noteid] }); return { editorOpened: true } },
    async read(noteid: string) { calls.push({ read: noteid }); return { revision: "r", comments: [{ commentId: "paper" }] } }
  }
  const writingScope: any = { exports: {}, setTimeout, clearTimeout }
  runInNewContext(transpileModule(readFileSync('web/src/lib/writingSession.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, writingScope)
  const scope: any = { exports: {}, setTimeout, clearTimeout, require: (name: string) => name === './writingSession' ? writingScope.exports : windowSizeApi() }
  runInNewContext(transpileModule(readFileSync("web/src/lib/sceneTransport.js", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const client = scope.exports.createSceneTransport(sdk, window, async (url: string, options: any) => {
    calls.push({ url, options }); return { ok: true, text: async () => 'runtime writing guide', json: async () => apiReply && !url.endsWith('/ui-state') ? apiReply(url, options) : ({ state: { immersive, topicid: sceneTopic, focusnoteid: "wrong-focus" } }) }
  }, policy(), annotation)
  return { client, calls, handlers, window, annotation, sdk, transportApi: scope.exports, events, failCloseDelivery() { closeDeliveryFails = true }, exit() { immersive = false }, enter() { immersive = true }, setSceneTopic(value: string | null) { sceneTopic = value } }
}

test('场景摘录笔仅从面板读取当前模板，错误回传且销毁后不再读取', async () => {
  const data = { available: true, template: { id: 'reading' }, excerptTools: { source: 'template', tools: [{ index: 42, label: '答案笔' }] } }
  const t = transport(() => data)
  t.window.dispatchEvent({ type: 'mn:clipperToolsRead', detail: { requestId: 'tools-1' } })
  await new Promise(resolve => setImmediate(resolve))
  const response = t.calls.find(c => c.name === 'clipperToolsReply')
  assert.equal(response.payload.requestId, 'tools-1')
  assert.equal(response.payload.result.excerptTools.tools[0].label, '答案笔')
  assert.deepEqual(t.calls.filter(c => c.url).map(c => c.url), ['/bridge/v1/ui-state', '/bridge/v1/immersive/template'])
  t.client.dispose(); t.calls.length = 0
  t.window.dispatchEvent({ type: 'mn:clipperToolsRead', detail: { requestId: 'late' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(t.calls.length, 0)
  const failed = transport(() => ({ error: { code: 'IN_PROCESS_NOT_ALLOWED', message: '没有读取许可' } }))
  failed.window.dispatchEvent({ type: 'mn:clipperToolsRead', detail: { requestId: 'failed' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(failed.calls.find(c => c.name === 'clipperToolsReply').payload.error, '没有读取许可')
})

test('手写模式经场景通道读取真实能力，不可用时回传原因且不转开批注', async () => {
  const t = transport(url => url.endsWith('/capabilities') && !url.endsWith('/writing/capabilities')
    ? { routes: [{ method: 'GET', path: '/writing/capabilities' }] }
    : { carriers: ['focus'], practiceSessionRecord: { canCreate: true, ready: false, canSwitch: false } })
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'writing-config-1', target: { operation: 'writing-config' } } })
  await new Promise(resolve => setImmediate(resolve))
  const reply = t.calls.find(c => c.name === 'reviewAnnotationReply' && c.payload.requestId === 'writing-config-1')
  assert.equal(reply.payload.result.available, false)
  assert.match(reply.payload.result.reason, /尚未开放/)
  assert.ok(t.calls.some(c => c.url === '/bridge/v1/guide'))
  assert.equal(t.calls.some(c => c.open || c.url?.includes('annotation-editor')), false)
})

test('原生作答判定转发本轮身份，退出场景后不再提交', async () => {
  const t = transport()
  const writes: any[] = [], saved: any[] = []
  ;(t.annotation as any).practiceConfig = async () => ({ reasons: [{ key: 'concept', label: '概念不懂' }] })
  ;(t.annotation as any).verdict = async (noteid: string, target: any, verify: any) => {
    await verify(); writes.push({ noteid, commentId: target.commentId, reason: target.reason }); return { persisted: true }
  }
  t.window.addEventListener('cardlink:annotation-saved', (event: any) => saved.push(event.detail.noteid))
  const send = async (requestId: string, target: any) => {
    t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId, target } })
    await new Promise(resolve => setImmediate(resolve))
    return t.calls.find(c => c.name === 'reviewAnnotationReply' && c.payload.requestId === requestId).payload
  }
  assert.equal((await send('config', { operation: 'practice-config' })).result.reasons[0].key, 'concept')
  const target = { operation: 'practice-verdict', noteid: 'question', topicid: 'book', commentId: 'new-paper', self: 'again', reason: 'concept' }
  assert.equal((await send('verdict', target)).result.persisted, true)
  assert.deepEqual(writes, [{ noteid: 'question', commentId: 'new-paper', reason: 'concept' }])
  assert.deepEqual(saved, ['question'])
  t.exit()
  assert.ok((await send('after-exit', target)).error)
  assert.equal(writes.length, 1)
})

test('插件图片评论按读回身份折叠，刷新后返回；缺少折叠能力时拒绝', async () => {
  let folded = false, supported = true, routePath = '/notes/{id}/comments/fold'
  const marker = 'CardLink 插件批注 paper'
  const t = transport((url, options) => {
    if (url.endsWith('/capabilities')) return { routes: supported ? [{ method: 'POST', path: routePath }] : [] }
    if (url.endsWith('/fold')) {
      const body = JSON.parse(options.body)
      assert.equal(body.expectedRevision, 'rev'); assert.equal(body.targets[0].index, 3)
      folded = body.collapsed
      return { persisted: true }
    }
    return { revision: 'rev', comments: [{ index: 3, text: marker, collapsed: folded }] }
  })
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'ink', target: { operation: 'ink-fold', noteid: 'source', marker } } })
  await new Promise(resolve => setImmediate(resolve))
  const reply = t.calls.find(c => c.name === 'reviewAnnotationReply').payload
  assert.equal(reply.result.persisted, true); assert.equal(reply.result.comments[0].collapsed, true)
  // OpenAPI uses a different name for the same single path parameter.
  routePath = '/notes/{noteid}/comments/fold'
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'openapi', target: { operation: 'ink-read', noteid: 'source' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(t.calls.filter(c => c.name === 'reviewAnnotationReply')[1].payload.result)
  assert.equal(t.calls.some(c => c.url?.includes('{')), false, '实际请求使用原题ID，不向宿主发送模板路径')
  routePath = '/notes/{id}/comments/{index}/fold'
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'different-route', target: { operation: 'ink-read', noteid: 'source' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(t.calls.filter(c => c.name === 'reviewAnnotationReply')[2].payload.error, /未提供评论折叠接口/)
  supported = false
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'unsupported', target: { operation: 'ink-read', noteid: 'source' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(t.calls.filter(c => c.name === 'reviewAnnotationReply')[3].payload.error, /未提供评论折叠接口/)
})

test('批注打开只做一次写前场景确认，成功后预读下一题', async () => {
  const t = transport()
  const prefetched: string[] = []
  ;(t.annotation as any).prefetch = async (id: string) => { prefetched.push(id) }
  t.annotation.open = async (_id, before, config?: any) => { await before(); return { editorOpened: true, advance: config.advance } }
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: {
    requestId: 'open', target: { noteid: 'question', reviewToken: 'one', topicid: 'book', advance: 'next', nextNoteid: 'q2' }
  } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(t.calls.filter(c => c.url?.endsWith('/ui-state')).length, 1)
  assert.deepEqual(prefetched, ['q2'])
  t.exit()
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'another', target: { noteid: 'q3', reviewToken: 'two', advance: 'next' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(prefetched, ['q2'], '失败打开不预读其他题')
})

test('复习中隐藏面板、切换学习集与场景暂不可用仍保留关闭回执和状态查询，恢复后可开下一题', async () => {
  const n = native(), t = transport()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage('sceneReady', { state: { immersive: true } })
  n.owner.cardLinkReviewMode = { writingMode: 'annotation' }
  const received: any[] = []
  n.owner.cardLinkReviewAnnotationClosed = (event: any) => { received.push(event); return true }
  t.sdk.call = async (name: string, payload: any) => n.panel.onMessage(name, payload)
  n.panel.post = (name: string, detail: any) => t.window.dispatchEvent({ type: 'mn:' + name, detail })
  t.annotation.open = async (_id, before, config?: any) => {
    await before(); return { editorOpened: true, advance: config.advance }
  }
  // Review can start before the full workbench has reported appRendered.
  n.legacy.hidePanel(n.controller, true)
  n.legacy.hidePanel(n.controller, false)
  n.timers.forEach(run => run())
  assert.equal(n.calls.filter(c => c === 'hide').length, 0)
  assert.equal(n.helper.enabled(n.owner), true)
  await n.helper.openReviewAnnotation(n.owner, { noteid: 'question', reviewToken: 'one', advance: 'next' })
  t.exit()
  await assert.rejects(t.client.send('dashboard', {}), /已离开场景/)
  assert.equal(n.helper.enabled(n.owner), false)
  assert.ok(n.panel.onMessage('bridgeRequest', {}).error, 'suspension must still block new business')
  await t.handlers.practice({ noteid: 'question', action: 'next', saved: true })
  assert.equal(received.length, 1)
  const status = await n.helper.openReviewAnnotation(n.owner, { operation: 'status', reviewToken: 'one' })
  assert.equal(status.state, 'closed')
  assert.equal(status.event.reviewToken, 'one')
  await assert.rejects(n.helper.openReviewAnnotation(n.owner, { noteid: 'q2', reviewToken: 'two', advance: 'next' }), /已离开场景/)
  t.enter()
  await n.helper.openReviewAnnotation(n.owner, { noteid: 'q2', reviewToken: 'two', advance: 'next' })
  assert.equal(n.helper.enabled(n.owner), true)
  assert.equal(n.panel.onMessage('sceneClose', {}).minimized, true)
  // A rejection can originate in media/boot code outside this transport.
  n.panel.onMessage('sceneRejected', { stage: 'media' })
  assert.equal(n.helper.enabled(n.owner), false)
  await t.client.send('resetPanelFrame', {})
  assert.equal(n.helper.enabled(n.owner), true)
  assert.equal(n.calls.filter(c => c === 'factory').length, 1, 'same runtime retains the close journal')
  n.helper.dispose(n.owner)
  assert.equal(n.calls.filter(c => c === 'hide').length, 1)
  assert.ok(n.panel.onMessage('reviewAnnotationClosed', { reviewToken: 'two' }).error)
  assert.equal(received.length, 1, 'disposed sessions reject late close events')
})

test('宿主场景为真但原生会话未确认，禁止继续打开批注', async () => {
  const t = transport()
  t.sdk.call = async (name: string) => name === 'sceneReady' ? { enabled: false } : {}
  await assert.rejects(t.client.send('openMistakeHandwriting', {}), /场景状态尚未恢复/)
  assert.equal(t.calls.some(c => c.open), false)
})

test('宿主返回的卡片身份及大小写用于关闭匹配；投递失败仍保留关闭回执，旧回执不能释放新题', async () => {
  const t = transport()
  t.annotation.open = async (_id, before, config?: any) => {
    await before(); return { editorOpened: true, advance: config.advance, noteid: 'host-card' }
  }
  const send = async (requestId: string, target: any) => {
    t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId, target } })
    await new Promise(resolve => setImmediate(resolve))
    const replies = t.calls.filter(c => c.name === 'reviewAnnotationReply')
    return replies[replies.length - 1].payload.result
  }
  await send('open', { noteid: 'question', reviewToken: 'one', advance: 'next' })
  await t.handlers.practice({ noteid: 'unrelated', action: 'next', saved: true })
  assert.equal(t.calls.filter(c => c.name === 'reviewAnnotationClosed').length, 0)
  t.failCloseDelivery()
  await t.handlers.practice({ noteid: 'HOST-CARD', action: 'next', saved: true, commentId: 'paper' })
  const status = await send('status', { operation: 'status', reviewToken: 'one' })
  assert.equal(status.state, 'closed')
  assert.equal(status.event.noteid, 'question')
  assert.equal(status.event.hostNoteid, 'HOST-CARD')
  assert.equal(status.event.commentId, 'paper')
  await send('next', { noteid: 'q2', reviewToken: 'two', advance: 'finish' })
  const stale = await send('release', { operation: 'release', reviewToken: 'stale' })
  assert.equal(stale.state, 'unknown')
  assert.equal((await send('unknown', { operation: 'status', reviewToken: 'two' })).state, 'unknown')
  assert.equal(t.calls.filter(c => c.open).length, 0, 'status/release must not open another host editor')
})

test('打开回执前的宿主规范卡片关闭事件，在身份确认后补发', async () => {
  const t = transport()
  t.annotation.open = async (_id, before, config?: any) => {
    await before()
    await t.handlers.practice({ noteid: 'HOST-CARD', action: 'closed', saved: false })
    return { editorOpened: true, advance: config.advance, practice: { card: 'host-card' } }
  }
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'open', target: { noteid: 'question', reviewToken: 'one', advance: 'next' } } })
  await new Promise(resolve => setImmediate(resolve))
  const closed = t.calls.filter(c => c.name === 'reviewAnnotationClosed')
  assert.equal(closed.length, 1)
  assert.equal(closed[0].payload.noteid, 'question')
  assert.equal(closed[0].payload.saved, false)
})

test("批注保存事件期间宿主编辑器遮住场景，不应销毁复习会话", async () => {
  const t = transport()
  t.annotation.open = async (_id, before, config?: any) => { await before(); return { editorOpened: true, advance: config.advance } }
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'open', target: { noteid: 'question', topicid: 'book', reviewToken: 'active', advance: 'next' } } })
  await new Promise(resolve => setImmediate(resolve))
  t.exit()
  await t.handlers.comments({ noteid: 'question' })
  await t.handlers.practice({ noteid: 'question', action: 'next', saved: true, commentId: 'paper' })
  assert.equal(t.calls.filter(c => c.name === 'sceneRejected').length, 0)
  assert.equal(t.calls.filter(c => c.name === 'reviewAnnotationClosed').length, 1)
})

test("复习批注携带按钮模式；关闭事件只转发一次，普通手写不能覆盖正在复习的目标", async () => {
  const t = transport()
  const options: any[] = []
  t.annotation.open = async (_id, before, config?: any) => { await before(); options.push(config); return { editorOpened: true, advance: config.advance } }
  const target = { noteid: "question", topicid: "source-not-open", recordId: "record", reviewToken: "session-1", advance: "next" }
  t.window.dispatchEvent({ type: "mn:reviewAnnotationOpen", detail: { requestId: "r1", target } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(options[0].advance, "next")
  assert.equal(options[0].topicid, "source-not-open")
  assert.equal(t.calls.find(c => c.name === "reviewAnnotationReply").payload.result.editorOpened, true)
  await assert.rejects(t.client.send("openMistakeHandwriting", { recordId: "other" }), /先关闭/)
  const event = { noteid: "question", action: "next", saved: true, commentId: "paper" }
  await t.handlers.practice(event)
  await t.handlers.practice(event)
  const closed = t.calls.filter(c => c.name === "reviewAnnotationClosed")
  assert.equal(closed.length, 1)
  assert.equal(closed[0].payload.reviewToken, "session-1")
  assert.equal(closed[0].payload.action, "next")
})

test("复习批注明确拒绝可重试，未知按钮模式报告未确认且禁止重复打开", async () => {
  const t = transport()
  const target = { noteid: "question", reviewToken: "token", advance: "next" }
  t.annotation.open = async () => { throw Object.assign(new Error("拒绝"), { editorMayBeOpen: false }) }
  t.window.dispatchEvent({ type: "mn:reviewAnnotationOpen", detail: { requestId: "r1", target } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(t.calls.find(c => c.name === "reviewAnnotationReply").payload.editorMayBeOpen, false)
  t.annotation.open = async (_id, before) => { await before(); return { editorOpened: true } }
  t.window.dispatchEvent({ type: "mn:reviewAnnotationOpen", detail: { requestId: "r2", target } })
  await new Promise(resolve => setImmediate(resolve))
  const replies = t.calls.filter(c => c.name === "reviewAnnotationReply")
  assert.match(replies[1].payload.error, /未确认/)
  assert.equal(replies[1].payload.editorMayBeOpen, true)
})

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

test('已接收侧边反馈请求等待用户操作不超时，接收失败及普通请求保留超时', async () => {
  let callback!: (event: any) => void, request: any, accepted = true, acknowledge = true
  const timers = new Map<number, () => void>(); let sequence = 0
  const scope: any = { exports: {}, require: () => windowSizeApi(),
    setTimeout: (handler: () => void) => { timers.set(++sequence, handler); return sequence },
    clearTimeout: (id: number) => timers.delete(id) }
  runInNewContext(transpileModule(readFileSync('web/src/lib/sceneTransport.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const window: any = { __MN_HOST_VERSION__: '4.5.0', addEventListener: (name: string, handler: any) => { if (name === 'mn:bridgeResponse') callback = handler } }
  const sdk: any = { on() {}, call: async (name: string, payload: any) => {
    if (name === 'sceneReady') return { enabled: true }
    if (name === 'bridgeRequest') { request = payload; if (!acknowledge) return new Promise(() => {}) }
    return { accepted }
  } }
  const transport = scope.exports.createSceneCommandTransport(sdk, window, async () => ({ json: async () => ({ state: { immersive: true } }) }), policy(),
    'card-menu-', (command: string, target: any) => command === 'cardMenuCommand' && target?.id === 'markMistake' ? null : 60000)
  let done = false
  const marking = transport.send('cardMenuCommand', { id: 'markMistake' }).then(() => { done = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers.size, 0)
  assert.equal(done, false)
  assert.equal(transport.busy(), true)
  callback({ detail: { requestId: request.requestId, payload: { cancelled: true } } })
  await marking
  assert.equal(transport.busy(), false)
  accepted = false
  await assert.rejects(transport.send('cardMenuCommand', { id: 'markMistake' }), /未被接收/)
  accepted = true; acknowledge = false
  const noAck = assert.rejects(transport.send('cardMenuCommand', { id: 'markMistake' }), /场景请求超时/)
  await new Promise(resolve => setImmediate(resolve)); [...timers.values()].forEach(handler => handler()); await noAck
  acknowledge = true
  const ordinary = assert.rejects(transport.send('cardMenuCommand', { id: 'findAnswer' }), /场景请求超时/)
  await new Promise(resolve => setImmediate(resolve)); [...timers.values()].forEach(handler => handler()); await ordinary
})

test('卡片命令宿主仅对标错等待保存取消，不解除查答案超时', async () => {
  let listener: any, timeout: any
  const scope: any = { exports: {}, window: { __MN_WORKBENCH_MOUNTING__: true, fetch() {}, CardLinkCardMenu: { listen(handler: any) { listener = handler } } },
    document: { getElementById: () => ({}) }, require: () => ({ createSceneCommandTransport: (...args: any[]) => { timeout = args[5]; return { send: async () => ({}) } } }) }
  runInNewContext(transpileModule(readFileSync('web/card-command-surface.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  scope.window.CardLinkCommandSurface.install({ call: async () => ({}) }, Promise.resolve())
  await listener({ id: 'markMistake', noteID: 'event' })
  assert.equal(timeout('cardMenuCommand', { id: 'markMistake' }), null)
  assert.equal(timeout('cardMenuCommand', { id: 'findAnswer' }), 60000)
  assert.equal(timeout('dashboard', {}), 60000)
})

test("小面板与已打开工作台请求并行时，回复不会串到另一条请求", async () => {
  const events: any[] = [], requests: any[] = []
  const scope: any = {exports:{},setTimeout,clearTimeout,require: () => windowSizeApi()}
  runInNewContext(transpileModule(readFileSync('web/src/lib/sceneTransport.js','utf8'),{compilerOptions:{module:1,target:7}}).outputText,scope)
  const window: any = {__MN_HOST_VERSION__:'4.5.0',addEventListener:(name:string,handler:any)=>{if(name==='mn:bridgeResponse')events.push(handler)}}
  const sdk: any = {on(){},call:async(name:string,payload:any)=>{if(name==='sceneReady')return {enabled:true};if(name==='bridgeRequest')requests.push(payload);return {accepted:true}}}
  const fetch = async()=>({json:async()=>({state:{immersive:true}})})
  const workbench=scope.exports.createSceneCommandTransport(sdk,window,fetch,policy(),'scene-')
  const menu=scope.exports.createSceneCommandTransport(sdk,window,fetch,policy(),'card-menu-')
  let workbenchDone=false,menuDone=false
  const a=workbench.send('dashboard',{}).then(()=>{workbenchDone=true})
  const b=menu.send('cardMenuCommand',{}).then(()=>{menuDone=true})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length,2);assert.notEqual(requests[0].requestId,requests[1].requestId)
  for(const handler of events)handler({detail:{requestId:requests[1].requestId,payload:{}}})
  await b;assert.equal(menuDone,true);assert.equal(workbenchDone,false)
  for(const handler of events)handler({detail:{requestId:requests[0].requestId,payload:{}}})
  await a;assert.equal(workbenchDone,true)
})


test("面板跟随宿主模式自动切换，旧版本保留经典", () => {
  const n = native()
  let enabled = false
  n.scope.__MN_ANSWER_CORE_GLOBAL__.isSceneMode = () => enabled
  n.owner.webController = n.controller
  n.legacy.isVisible = () => true
  n.legacy.showPanel(n.controller)
  assert.deepEqual(n.calls, ["classic"])
  enabled = true
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  assert.equal(n.helper.enabled(n.owner), true)
  enabled = false
  n.helper.syncMode(n.owner)
  assert.equal(n.helper.enabled(n.owner), false)
  assert.deepEqual(n.calls.slice(-2), ["hide", "classic"])
  const old = native("4.4.9")
  old.legacy.showPanel(old.controller)
  assert.deepEqual(old.calls, ["classic"])
})

test("场景面板和手写随宿主模式切换，并等待场景就绪", () => {
  const source = readFileSync("src/rails-core.ts", "utf8")
  const fn = source.match(/function sceneFeatures\([\s\S]*?\n\}/)![0]
  let enabled = false, confirmed = true
  const scope: any = { exports: {}, isSceneMode: () => enabled, self: {} }
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
  assert.ok(f.calls.includes("size:720x520"))
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
 assert.equal(n.calls.filter(c=>c==='closeMistakePanel').length,1, '真正关闭承接窗口必须清理原生错题面板')
})


test("启动没有默认选择时使用预设2，已有临时大小不覆盖默认", async () => {
  const value = await boot("4.5.0", { state: { immersive: true } }, { width: 1200, height: 900 })
  assert.ok(value.calls.includes("size:720x520"))
})

test("顶部重置使用所选默认预设，与尺寸弹窗共享读取规则", async () => {
  const t = transport()
  t.window.localStorage = { getItem: () => JSON.stringify({ width: 900, height: 720 }), setItem() {} }
  await t.client.send("resetPanelFrame", {})
  assert.deepEqual(t.calls.find(c => c.size).size, [900, 720])
})


test('误开旧批注即使先到关闭回执，也不能作为新作答评分或下一题', async () => {
  const t = transport()
  t.annotation.open = async (_id: string, verify: any) => {
    await verify()
    await t.handlers.practice({ noteid: 'question', saved: true, action: 'next', commentId: 'old' })
    throw Object.assign(new Error('old sheet'), { code: 'OLD_PRACTICE_SHEET_OPENED', editorMayBeOpen: true })
  }
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'old', target: { noteid: 'question', reviewToken: 'test', advance: 'next', newAttempt: true } } })
  await new Promise(resolve => setImmediate(resolve))
  const event = t.calls.find(c => c.name === 'reviewAnnotationClosed').payload
  assert.equal(event.saved, true)
  assert.equal(event.action, 'closed')
  assert.equal(event.commentId, 'old')
  assert.equal(event.identityUnconfirmed, true)
})

test('批注诊断分段经过原生长度上限后仍能完整关联请求与宿主响应', async () => {
  const t = transport()
  const scope: any = { setTimeout, clearTimeout }
  runInNewContext(readFileSync('web/annotation-client.js', 'utf8'), scope)
  const topic = 'A'.repeat(36), noteid = 'question', commentId = 'B'.repeat(36)
  Object.assign(t.annotation, scope.createCardLinkAnnotationClient({ api: async (_path: string, options: any) => !options
    ? { revision: 'R'.repeat(64), comments: [{ commentId, text: 'PRIVATE_TEXT', cardAnnotation: true,
      practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic, self: null } }] }
    : { editorOpened: true, continued: true, noteid, commentId, advance: 'next', bridgeApiVersion: '0.91',
      practice: { addon: 'marginnote.extension.mn4-answer-matcher', topic, card: noteid } } }))
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'trace-open', target: {
    noteid, topicid: topic, reviewToken: 'review-one', advance: 'next', newAttempt: true
  } } })
  await new Promise(resolve => setImmediate(resolve))
  const logs = t.calls.filter(c => c.name === 'sceneLog')
  function decoded(event: string) {
    const parts = logs.filter(c => c.payload.event === event).map(c => c.payload.detail)
    assert.ok(parts.length > 0)
    assert.ok(parts.every(p => p.length <= 400 && p.startsWith('trace=trace-open part=')))
    return JSON.parse(parts.map(p => p.slice(0, 400).replace(/^trace=\S+ part=\d+\/\d+ /, '')).join(''))
  }
  assert.equal(decoded('annotation.trace').reviewToken, 'review-one')
  assert.equal(decoded('annotation.editor.request').commentIdPresent, false)
  const response = decoded('annotation.editor.response')
  assert.equal(response.commentId, commentId)
  assert.equal(response.continued, true)
  assert.equal(response.practice.topic, topic)
  assert.equal(t.calls.find(c => c.name === 'reviewAnnotationReply' && c.payload.requestId === 'trace-open').payload.result.reusedExisting, true)
  assert.ok(!JSON.stringify(logs).includes('PRIVATE_TEXT'))
  await t.handlers.practice({ noteid, commentId, saved: true, action: 'next' })
  const closeParts = t.calls.filter(c => c.name === 'sceneLog' && c.payload.event === 'annotation.closed')
  const closed = JSON.parse(closeParts.map(c => c.payload.detail.replace(/^trace=\S+ part=\d+\/\d+ /, '')).join(''))
  assert.equal(closed.rejectedOldSheet, false)
  assert.equal(closed.hostSaved, true)
  assert.equal(closed.saved, true)
})

test('普通作答不要求宿主 advance 回显，保存关闭转为本地反馈，取消保持原题', async () => {
  const t = transport()
  const scope: any = { setTimeout, clearTimeout }, bodies: any[] = [], paths: string[] = []
  runInNewContext(readFileSync('web/annotation-client.js', 'utf8'), scope)
  Object.assign(t.annotation, scope.createCardLinkAnnotationClient({ api: async (path: string, options: any) => {
    paths.push(path)
    if (!options) return { revision: 'r', comments: [] }
    bodies.push(options.body)
    return { editorOpened: true, persisted: false }
  } }))
  const send = async (id: string, advance: string) => {
    t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: id, target: {
      noteid: 'question', reviewToken: id, ordinary: true, newAttempt: true, advance
    } } })
    await new Promise(resolve => setImmediate(resolve))
    const reply = t.calls.find(c => c.name === 'reviewAnnotationReply' && c.payload.requestId === id).payload
    assert.equal(reply.result.editorOpened, true)
    assert.equal(reply.error, undefined)
  }
  await send('save-one', 'next')
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['confirm', 'expectedRevision'])
  await t.handlers.practice({ noteid: 'question', action: 'saved', saved: true, commentId: 'paper-one' })
  const closed = t.calls.find(c => c.name === 'reviewAnnotationClosed').payload
  assert.equal(closed.action, 'next')
  assert.equal(closed.commentId, 'paper-one')
  assert.equal(closed.saved, true)
  await send('cancel-two', 'finish')
  await t.handlers.practice({ noteid: 'question', action: 'closed', saved: false })
  const events = t.calls.filter(c => c.name === 'reviewAnnotationClosed')
  assert.equal(events[1].payload.action, 'closed')
  assert.equal(events[1].payload.saved, false)
  await send('empty-complete', 'finish')
  await t.handlers.practice({ noteid: 'question', action: 'saved', saved: false })
  const closedEvents = t.calls.filter(c => c.name === 'reviewAnnotationClosed')
  const empty = closedEvents[closedEvents.length - 1].payload
  assert.equal(empty.action, 'finish', '明确完成但没有新笔迹也允许进入本地反馈')
  assert.equal(empty.saved, false)
  assert.ok(!paths.some(p => p.includes('verdict') || p.includes('template')))
})


test('首次安装不请求错题迁移，旧面板残留的迁移命令也不能改写标签', async () => {
  const source = readFileSync('src/rails-core.ts', 'utf8')
  const fn = source.slice(source.indexOf('async function bridgeInternal('), source.indexOf('async function bridge('))
  let writes = 0
  const scope: any = { exports: {}, self: {}, __APP_VERSION__: 'test', isAICommand: () => false,
    loadMatcherSettings: () => ({}), sceneFeatures: () => ({}), consumePendingLocateHint() {},
    beginMistakeWorkbenchTransfer: () => ({}), getManualTodayIds: () => [], answerMatchingSettingsData: () => ({}),
    clipperSnapshot: () => ({}), managedAnswerBindings: () => [],
    legacyMistakeTagMigrationCompleted: () => false,
    repairAndOrganizeMistakes: async () => { writes++ }, rememberLegacyMistakeTagMigration: () => { writes++ } }
  runInNewContext(transpileModule(fn + '\nexports.dispatch = bridgeInternal', { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const dashboard = await scope.exports.dispatch('dashboard', null)
  assert.equal(dashboard.mistakeRefreshConsentRequired, false)
  const retired = await scope.exports.dispatch('acceptMistakeRefreshConsent', null)
  assert.equal(retired.disabled, true)
  assert.equal(writes, 0)
})


test('丢弃命令只接受同令牌的新批注关闭回执；仍打开、旧令牌和退出场景均拒绝', async () => {
  const t = transport(), discarded: any[] = []
  t.annotation.open = async (_noteid, beforeWrite) => { await beforeWrite(); return { editorOpened: true, advance: 'next' } as any }
  ;(t.annotation as any).discardFresh = async (noteid: string, target: any, verify: any) => {
    await verify(); discarded.push({ noteid, commentId: target.commentId }); return { discarded: true, commentId: target.commentId }
  }
  const send = async (requestId: string, target: any) => {
    t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId, target } })
    await new Promise(resolve => setImmediate(resolve))
    return t.calls.find(c => c.name === 'reviewAnnotationReply' && c.payload.requestId === requestId).payload
  }
  await send('open-discard', { noteid: 'question', topicid: 'book', reviewToken: 'token', advance: 'next', newAttempt: true })
  const target = { operation: 'practice-discard', noteid: 'question', reviewToken: 'token', commentId: 'new' }
  assert.ok((await send('still-open', target)).error)
  await t.handlers.practice({ noteid: 'question', action: 'next', saved: true, commentId: 'new' })
  assert.ok((await send('stale-discard', { ...target, reviewToken: 'stale' })).error)
  assert.ok((await send('wrong-paper', { ...target, commentId: 'old' })).error)
  assert.equal(discarded.length, 0)
  assert.equal((await send('discard', target)).result.discarded, true)
  assert.deepEqual(discarded, [{ noteid: 'question', commentId: 'new' }])
  t.exit()
  assert.ok((await send('discard-exited', target)).error)
  assert.equal(discarded.length, 1)
})


test('卡片菜单与工作台共存，重复标错后练习请求只返回一次，宿主事件只处理一次', async () => {
  const t = transport()
  let menuListener: any, reads = 0, verdicts = 0, invalidations = 0, panelShows = 0, changes = 0
  Object.assign(t.annotation, {
    practiceConfig: async () => ({ available: true, reasons: [{ key: 'concept' }] }),
    read: async () => { reads++; return { comments: [] } },
    verdict: async () => { verdicts++; return { persisted: true } },
    invalidate: () => { invalidations++ }
  })
  t.window.__MN_WORKBENCH_MOUNTING__ = true
  t.window.fetch = async () => ({ json: async () => ({ state: { immersive: true } }) })
  t.window.CardLinkHostPolicy = policy()
  t.window.CardLinkCardMenu = { listen(handler: any) { menuListener = handler } }
  t.window.__onPanelShow = () => { panelShows++ }
  t.window.__onNativeDataChanged = () => { changes++ }
  const scope: any = { exports: {}, window: t.window, document: { getElementById: () => ({}) }, require: () => t.transportApi }
  runInNewContext(transpileModule(readFileSync('web/card-command-surface.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  t.window.CardLinkCommandSurface.install(t.sdk, Promise.resolve())
  for (let i = 0; i < 3; i++) {
    await menuListener({ id: 'markMistake', noteID: 'question' })
    for (const operation of ['practice-config', 'practice-history', 'practice-verdict', 'status']) {
      const requestId = `${operation}-${i}`
      t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId, target: { operation, noteid: 'question' } } })
      await new Promise(resolve => setImmediate(resolve))
      const replies = t.calls.filter(c => c.name === 'reviewAnnotationReply' && c.payload.requestId === requestId)
      assert.equal(replies.length, 1)
      assert.equal(replies[0].payload.error, undefined)
      if (operation === 'practice-config') assert.equal(replies[0].payload.result.available, true)
    }
  }
  assert.equal(reads, 3); assert.equal(verdicts, 3)
  await t.handlers.practice({ noteid: 'other', saved: false })
  await t.handlers.comments({ noteid: 'other' })
  assert.equal(invalidations, 2)
  t.window.dispatchEvent({ type: 'mn:panelShown' })
  t.window.dispatchEvent({ type: 'mn:nativeDataChanged' })
  assert.equal(panelShows, 1); assert.equal(changes, 1)
  assert.equal(t.events['mn:reviewAnnotationOpen'].length, 1)
})

test('工作台控制器替换和销毁后，旧 DOM 与 SDK 回调不再处理事件', async () => {
  const t = transport()
  let oldInvalidations = 0, newConfigs = 0
  Object.assign(t.annotation, { invalidate: () => { oldInvalidations++ } })
  const oldPractice = t.handlers.practice, oldComments = t.handlers.comments
  const replacement = t.transportApi.createSceneTransport(t.sdk, t.window, async () => ({ json: async () => ({ state: { immersive: true } }) }), policy(), {
    practiceConfig: async () => { newConfigs++; return { available: true } }
  })
  await oldPractice({ noteid: 'question' }); await oldComments({ noteid: 'question' })
  assert.equal(oldInvalidations, 0)
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'replacement', target: { operation: 'practice-config' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(newConfigs, 1)
  assert.equal(t.calls.filter(c => c.name === 'reviewAnnotationReply').length, 1)
  assert.equal(t.events['mn:reviewAnnotationOpen'].length, 1)
  replacement.dispose(); replacement.dispose()
  assert.equal(t.events['mn:reviewAnnotationOpen'].length, 0)
  assert.equal(t.events['mn:bridgeResponse'].length, 0)
  t.window.dispatchEvent({ type: 'mn:reviewAnnotationOpen', detail: { requestId: 'disposed', target: { operation: 'practice-config' } } })
  assert.equal(newConfigs, 1)
  await assert.rejects(replacement.send('dashboard', {}), /已销毁/)
})

test('缺少批注客户端时在注册监听前明确拒绝，命令通道销毁结束等待', async () => {
  const t = transport()
  assert.throws(() => t.transportApi.createSceneTransport(t.sdk, t.window, t.window.fetch, policy(), null), /练习批注客户端尚未初始化/)
  assert.equal(t.events['mn:reviewAnnotationOpen'].length, 1)
  const sdk = { call: async (name: string) => name === 'sceneReady' ? { enabled: true } : { accepted: true } }
  const menu = t.transportApi.createSceneCommandTransport(sdk, t.window, async () => ({ json: async () => ({ state: { immersive: true } }) }), policy())
  const waiting = assert.rejects(menu.send('cardMenuCommand', {}), /已销毁/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(menu.busy(), true)
  menu.dispose(); menu.dispose()
  await waiting
  assert.equal(menu.busy(), false)
  assert.equal(t.events['mn:bridgeResponse'].length, 1)
  await assert.rejects(menu.send('cardMenuCommand', {}), /已销毁/)
})


test('替换控制器后旧配置检查的迟到结果不再回传', async () => {
  const t = transport()
  let complete!: (value: any) => void
  Object.assign(t.annotation, { practiceConfig: () => new Promise(resolve => { complete = resolve }) })
  const request = { type: 'mn:reviewAnnotationOpen', detail: { requestId: 'pending-config', target: { operation: 'practice-config' } } }
  t.window.dispatchEvent(request)
  await new Promise(resolve => setImmediate(resolve))
  const replacement = t.transportApi.createSceneTransport(t.sdk, t.window, async () => ({ json: async () => ({ state: { immersive: true } }) }), policy(), {
    practiceConfig: async () => ({ available: true })
  })
  t.window.dispatchEvent(request)
  await new Promise(resolve => setImmediate(resolve))
  complete({ available: false })
  await new Promise(resolve => setImmediate(resolve))
  const replies = t.calls.filter(c => c.name === 'reviewAnnotationReply')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].payload.result.available, true)
  replacement.dispose()
})

test('销毁后重建同前缀命令通道，迟到回复不能完成新请求', async () => {
  const t = transport(), requests: any[] = []
  const sdk = { call: async (name: string, payload: any) => {
    if (name === 'bridgeRequest') requests.push(payload)
    return name === 'sceneReady' ? { enabled: true } : { accepted: true }
  } }
  const create = () => t.transportApi.createSceneCommandTransport(sdk, t.window, async () => ({ json: async () => ({ state: { immersive: true } }) }), policy())
  const old = create()
  const cancelled = assert.rejects(old.send('cardMenuCommand', {}), /已销毁/)
  await new Promise(resolve => setImmediate(resolve)); old.dispose(); await cancelled
  const current = create(); let done = false
  const waiting = current.send('cardMenuCommand', {}).then(() => { done = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(requests[0].requestId, requests[1].requestId)
  t.window.dispatchEvent({ type: 'mn:bridgeResponse', detail: { requestId: requests[0].requestId, payload: {} } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(done, false)
  t.window.dispatchEvent({ type: 'mn:bridgeResponse', detail: { requestId: requests[1].requestId, payload: {} } })
  await waiting; current.dispose()
})

const foldFlush = () => new Promise(resolve => setImmediate(resolve))

test("分支折叠只投递当前题卡与目标值，回执按请求ID完成；关闭面板取消未完成请求", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  n.panel.onMessage("bridgeRequest", { command: "runtimeLog", payload: { event: "boot.appRendered" } })
  const token = n.helper.sceneToken(n.owner)
  assert.ok(token, "已确认的场景会话应有身份")
  const pending = n.helper.foldBranch(n.owner, { noteid: "q1", notebookId: "book", folded: true })
  const posted = n.calls.filter(c => c.event === "foldBranch").slice(-1)[0].data
  assert.deepEqual([posted.noteid, posted.folded, posted.notebookId], ["q1", true, "book"])
  await assert.rejects(n.helper.foldBranch(n.owner, { noteid: "q2", folded: true }), /正在处理分支折叠请求/)
  assert.equal(n.panel.onMessage("foldBranchReply", { requestId: "stale", result: { folded: true } }).ignored, true)
  n.panel.onMessage("foldBranchReply", { requestId: posted.requestId, result: { folded: true, topicid: "book", changed: [] } })
  const result = await pending
  assert.equal(result.folded, true)
  assert.equal(result.noteid, "q1")
  assert.equal(result.sceneToken, token, "回执带回窗口会话身份")
  const closing = n.helper.foldBranch(n.owner, { noteid: "q1", folded: false })
  const rejected = assert.rejects(closing, /场景面板已关闭/)
  n.helper.dispose(n.owner)
  await rejected
})

test("场景通知保留空数据默认对象，显式 null 与关闭信号原样投递且只发给本窗口会话", () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  // 尚未确认的场景会话不投递通知。
  n.helper.notify(n.owner, "updatePrompt", null)
  assert.equal(n.calls.filter(call => call && call.event).length, 0)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  n.calls.length = 0
  n.helper.notify(n.owner, "nativeDataChanged")
  n.helper.notify(n.owner, "updatePrompt", null)
  n.helper.notify(n.owner, "updatePrompt", { promptId: "update-1", close: true })
  n.helper.notify({ cardLinkSceneToken: "other-window" }, "updatePrompt", { promptId: "other-window" })
  // 通知对象来自 vm 上下文，按 JSON 比较结构而不是原型。
  assert.deepEqual(JSON.parse(JSON.stringify(n.calls)), [
    { event: "nativeDataChanged", data: {} },
    { event: "updatePrompt", data: null },
    { event: "updatePrompt", data: { promptId: "update-1", close: true } }
  ])
})

test("场景面板未授权、未渲染或缺少题卡时不投递折叠请求，回执错误按错误拒绝", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  await assert.rejects(n.helper.foldBranch(n.owner, { noteid: "q", folded: true }), /尚未授权/)
  assert.equal(n.calls.some(c => c.event === "foldBranch"), false)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  await assert.rejects(n.helper.foldBranch(n.owner, { noteid: "q", folded: true }), /尚未完成渲染/)
  n.panel.onMessage("bridgeRequest", { command: "runtimeLog", payload: { event: "boot.appRendered" } })
  await assert.rejects(n.helper.foldBranch(n.owner, { noteid: "" }), /缺少题卡/)
  const pending = n.helper.foldBranch(n.owner, { noteid: "q", folded: true })
  const posted = n.calls.filter(c => c.event === "foldBranch").slice(-1)[0].data
  n.panel.onMessage("foldBranchReply", { requestId: posted.requestId, error: "无法写入", code: "IN_PROCESS_NOT_ALLOWED" })
  await assert.rejects(pending, /无法写入/)
})

test("折叠请求超时与回执错误都标记已派发，便于按可能已写入处理", async () => {
  const n = native()
  n.legacy.showPanel(n.controller)
  n.panel.onMessage("sceneReady", { state: { immersive: true } })
  n.panel.onMessage("bridgeRequest", { command: "runtimeLog", payload: { event: "boot.appRendered" } })
  const timeout = n.helper.foldBranch(n.owner, { noteid: "q", notebookId: "book", folded: true })
  n.timers.slice(-1)[0]()
  await assert.rejects(timeout, (error: any) => {
    assert.equal(error.dispatched, true, "已投递但无回执不能当作没写")
    assert.match(String(error.message), /超时/)
    return true
  })
  const replied = n.helper.foldBranch(n.owner, { noteid: "q", notebookId: "book", folded: false })
  const posted = n.calls.filter(c => c.event === "foldBranch").slice(-1)[0].data
  n.panel.onMessage("foldBranchReply", { requestId: posted.requestId, error: "场景已失效", code: "SCENE_GONE", dispatched: true, topicid: "book" })
  await assert.rejects(replied, (error: any) => {
    assert.equal(error.dispatched, true)
    assert.equal(error.code, "SCENE_GONE")
    assert.equal(error.topicid, "book")
    return true
  })
  // 未渲染、未授权等本地拒绝不带派发标记
  const offline = native()
  offline.legacy.showPanel(offline.controller)
  await assert.rejects(offline.helper.foldBranch(offline.owner, { noteid: "q", folded: true }), (error: any) => {
    assert.notEqual(error.dispatched, true)
    return true
  })
})


test("折叠请求经官方场景 SDK 下发，错误对象落在 resolve 时也必须报错", async () => {
  const t = transport()
  const api: any[] = []
  let reply: any = { changed: [], folded: true, topicid: "topic", bridgeApiVersion: "0.91" }
  t.sdk.api = async (path: string, options: any) => { api.push([path, options]); return reply }
  t.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "fold-1", noteid: "N1", notebookId: "topic", folded: true } })
  await foldFlush()
  assert.equal(api.length, 1)
  assert.equal(api[0][0], "/notes/fold")
  assert.equal(api[0][1].method, "POST")
  assert.equal(api[0][1].body.folded, true)
  assert.equal(api[0][1].body.confirm, true)
  assert.deepEqual([...api[0][1].body.noteIds], ["N1"])
  const sent = t.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload
  assert.equal(sent.requestId, "fold-1")
  assert.equal(sent.dispatched, true)
  assert.equal(sent.result.folded, true)
  assert.equal(sent.result.topicid, "topic")
  assert.equal(sent.result.sceneTopic, "topic", "回执带回校验过的场景学习集")
  assert.equal(sent.result.changed, 0)
  assert.equal(sent.error, undefined)
  reply = { error: { code: "IN_PROCESS_NOT_ALLOWED", message: "面板不可用" } }
  t.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "fold-2", noteid: "N1", notebookId: "topic", folded: false } })
  await foldFlush()
  const failed = t.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload
  assert.match(failed.error, /面板不可用/)
  assert.equal(failed.code, "IN_PROCESS_NOT_ALLOWED")
  t.client.dispose()
})

test("折叠写入前核对场景当前学习集：缺学习集、未知或错配都不下发", async () => {
  const t = transport()
  const api: any[] = []
  t.sdk.api = async (path: string, options: any) => { api.push([path, options]); return { folded: true, topicid: "topic" } }
  t.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "no-topic", noteid: "N1", folded: true } })
  await foldFlush()
  assert.match(t.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload.error, /缺少学习集/)
  t.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "wrong-topic", noteid: "N1", notebookId: "other", folded: true } })
  await foldFlush()
  const mismatch = t.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload
  assert.match(mismatch.error, /不一致/)
  assert.equal(mismatch.dispatched, false)
  assert.equal(mismatch.topicid, "topic", "回执带出场景实际学习集，便于诊断")
  assert.equal(api.length, 0, "作用域不确定时一次都不写")
  t.client.dispose()

  // 界面状态读不到学习集时也不能写
  const unknown = transport()
  unknown.setSceneTopic(null)
  let writes = 0
  unknown.sdk.api = async () => { writes++; return { folded: true, topicid: "topic" } }
  unknown.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "unknown-topic", noteid: "N1", notebookId: "topic", folded: true } })
  await foldFlush()
  const blind = unknown.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload
  assert.match(blind.error, /无法确认场景当前学习集/)
  assert.equal(blind.dispatched, false)
  assert.equal(writes, 0, "无法确认作用域时一次都不写")
  unknown.client.dispose()
})

test("折叠回执归一化跳过项，缺少题卡不回复，缺 mn.api 明确报错", async () => {
  const missing = transport()
  missing.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "fold-x", noteid: "N1", notebookId: "topic", folded: true } })
  await foldFlush()
  const failed = missing.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload
  assert.match(failed.error, /mn\.api/)
  assert.equal(failed.dispatched, true, "已过场景校验即按可能已派发记录")
  missing.client.dispose()

  const t = transport()
  t.sdk.api = async () => ({ changed: [], skipped: [{ noteid: "n1", reason: "no_children" }], folded: true, topicid: "topic" })
  t.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "fold-3" } })
  await foldFlush()
  assert.equal(t.calls.some(call => call.name === "foldBranchReply"), false, "没有题卡不下发")
  t.window.dispatchEvent({ type: "mn:foldBranch", detail: { requestId: "fold-4", noteid: "N1", notebookId: "topic", folded: true } })
  await foldFlush()
  const sent = t.calls.filter(call => call.name === "foldBranchReply").slice(-1)[0].payload
  assert.equal(sent.result.skipped.reason, "no_children")
  assert.equal(sent.result.skipped.noteid, "n1")
  t.client.dispose()
})
