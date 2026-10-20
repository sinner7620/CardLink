import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function fixture(stuck?: string, noSDK = false, commandOnly = false) {
  const scope: any = {}
  runInNewContext(readFileSync("web/host-policy.js", "utf8"), scope)
  let sequence = 0
  const timers = new Map<number, { delay: number; callback: () => any }>()
  const scripts: any[] = [], calls: any[] = [], events: Record<string, () => void> = {}
  const message: any = { textContent: "正在载入工作台" }, root: any = { style: {} }
  const response = async (name: string) => {
    calls.push(name)
    if (name === stuck) return new Promise(() => {})
    if (name === "hostInfo") return { version: "4.5.0" }
    if (name === "/ui-state") return { state: { immersive: true } }
    return { enabled: true }
  }
  const window: any = { __MN_SCENE_ENTRY__: true, __MN_ASSET_BASE__: "/pkg/web-dist/", CardLinkHostPolicy: scope.CardLinkHostPolicy, addEventListener: (name: string, fn: () => void) => { events[name] = fn } }
  if (commandOnly) window.CardLinkCommandSurface = { install: () => ({ active: () => true }) }
  if (!noSDK) window.mn = { call: response, api: response, mode: (value: string) => calls.push(["mode", value]), size: (w: number, h: number) => calls.push(["size", w, h]) }
  runInNewContext(readFileSync("web/boot.js", "utf8"), {
    window,
    document: {
      getElementById: (id: string) => id === "root" ? root : message,
      documentElement: { dataset: {} }, createElement: () => ({}), body: { style: {}, appendChild: (script: any) => scripts.push(script) }
    },
    setTimeout: (callback: () => any, delay: number) => { timers.set(++sequence, { callback, delay }); return sequence },
    clearTimeout: (id: number) => timers.delete(id)
  })
  const initial = [...timers.values()].find(timer => timer.delay === 0)!
  const start = initial.callback()
  return { start, scripts, calls, message, window, timers, events }
}

test("三个场景握手阶段任何一个不响应，都显示对应阶段并请求经典回退", async () => {
  for (const [command, label] of [["hostInfo", "读取宿主版本"], ["/ui-state", "检测场景状态"], ["sceneReady", "确认场景面板"]]) {
    const f = fixture(command)
    // Flush resolved earlier handshakes to reach the hanging operation.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    const timeout = [...f.timers.values()].find(timer => timer.delay === 5000)
    assert.ok(timeout)
    timeout.callback()
    await f.start
    for (let i = 0; i < 10; i++) await Promise.resolve()
    assert.match(f.message.textContent, new RegExp(label))
    assert.match(f.message.textContent, /超时/)
    assert.ok(f.calls.includes("sceneRejected"))
    assert.equal(f.scripts.length, 0)
    assert.equal(f.window.__MN_SCENE_ENABLED__, undefined)
  }
})

test("场景入口缺少注入 SDK 时明确报错，不加载应用或调用新 API", async () => {
  const f = fixture(undefined, true)
  await f.start
  assert.match(f.message.textContent, /宿主未注入 window.mn/)
  assert.equal(f.scripts.length, 0)
  assert.deepEqual(f.calls, [])
})

test("场景脚本按包根路径装载，资源加载失败能报告具体文件并回退", async () => {
  const f = fixture()
  await f.start
  assert.equal(f.scripts[0].src, "/pkg/web-dist/app.js")
  f.scripts[0].onerror()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.match(f.message.textContent, /app.js 资源加载失败/)
  assert.ok(f.calls.includes("sceneRejected"))
})


test("卡片菜单已进入小面板时完成场景握手但不加载工作台", async () => {
  const f = fixture(undefined, false, true)
  await f.start
  assert.equal(f.window.__MN_SCENE_ENABLED__, true)
  assert.equal(f.scripts.length, 0)
  assert.ok(f.calls.includes('sceneReady'))
})


test("工作台首次打开明确恢复workspace与标准尺寸，菜单小窗请求重开只加载一次应用", async () => {
  const normal = fixture()
  await normal.start
  assert.ok(normal.calls.some(c => Array.isArray(c) && c[0] === "mode" && c[1] === "workspace"))
  assert.ok(normal.calls.some(c => Array.isArray(c) && c[0] === "size" && c[1] === 640 && c[2] === 620))
  const menu = fixture(undefined, false, true)
  await menu.start
  assert.equal(menu.scripts.length, 0)
  menu.events["mn:workbenchRequested"]()
  assert.equal(menu.scripts.length, 1)
  assert.ok(menu.calls.some(c => Array.isArray(c) && c[0] === "size" && c[1] === 640 && c[2] === 620))
  menu.events["mn:workbenchRequested"]()
  assert.equal(menu.scripts.length, 1)
})
