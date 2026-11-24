/**
 * 更新流程行为级测试：mock marginnote 运行时与原生文件操作，
 * 真正执行 checkForUpdates 的分支逻辑——GitHub→Gitee 回退、节流、
 * 交互确认、附件下载与保存路径。
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { files, moves, options, target, readJSON, resetInstaller, installNativeMocks } from "./update-installer-fixture"

const calls = {
  fetches: [] as Array<{ url: string; init?: any }>,
  huds: [] as string[],
  popups: [] as any[],
  saved: [] as string[],
  writes: [] as string[]
}

let githubReleases: unknown[] = []
let giteeReleases: unknown[] = []
let debugReleases: unknown = []
let debugApiShouldFail = false
let githubApiShouldFail = false
let giteeApiShouldFail = false
let githubDownloadShouldFail = false
let tinyDownload = false
let popupResult: { buttonIndex: number; inputContent?: string } = { buttonIndex: 0 }
let lastCheckValue = 0
let onDownload: (() => void) | undefined
// 1 秒以上的等待（有界回退、180 秒超时）在用例里由 promptTimeouts 手动触发。
const promptTimeouts: Array<{ seconds: number; fire: () => void }> = []

function release(tag: string, withAsset = true, host = "github.com") {
  return {
    tag_name: `v${tag}`,
    name: `release ${tag}`,
    body: `更新说明 ${tag}`,
    draft: false,
    prerelease: tag.includes("-"),
    html_url: `https://example.com/releases/${tag}`,
    assets: withAsset
      ? [{ name: `CardLink-v${tag}.mnaddon`, browser_download_url: `https://${host}/CardLink-v${tag}.mnaddon` }]
      : []
  }
}

function response(payload: unknown, options: { failDownload?: boolean; tiny?: boolean } = {}) {
  return {
    json: () => payload,
    data: {
      length: () => (options.failDownload || options.tiny ? 4096 : 512 * 1024),
      writeToFileAtomically: (path: string) => {
        if (options.failDownload) return false
        calls.writes.push(path)
        return true
      }
    }
  }
}

const fetchMock = async (url: string, init?: any) => {
  calls.fetches.push({ url, init })
  if (url.includes("/updates/debug/releases.json")) {
    if (debugApiShouldFail) throw new Error("debug source down")
    return response(debugReleases)
  }
  if (url.includes("api.github.com")) {
    if (githubApiShouldFail) throw new Error("github down")
    return response(githubReleases)
  }
  if (url.includes("gitee.com")) {
    if (giteeApiShouldFail) throw new Error("gitee down")
    return response(giteeReleases)
  }
  // 附件下载
  onDownload?.()
  if (tinyDownload) return response({}, { tiny: true })
  if (githubDownloadShouldFail && url.includes("github.com")) throw new Error("download interrupted")
  return response({}, {})
}

const marginnoteMock = {
  fetch: fetchMock,
  delay: (seconds: number) => {
    // 0.8 秒重推立即执行；更长等待（30 秒有界回退、180 秒超时）由用例显式触发。
    if (seconds >= 1) return new Promise<void>(resolve => { promptTimeouts.push({ seconds, fire: resolve }) })
    return Promise.resolve()
  },
  showHUD: (message: string) => { calls.huds.push(message) },
  popup: async (options: unknown) => { calls.popups.push(options); return popupResult },
  saveFile: (path: string) => { calls.saved.push(path) },
  UIAlertViewStyle: { PlainTextInput: 2 },
  readJSON,
  MN: {
    error: () => {},
    app: { tempPath: "/tmp/mn-temp", cachePath: "/cache" }
  },
  getLocalDataByKey: () => undefined,
  setLocalDataByKey: () => {}
}

;(globalThis as Record<string, unknown>).NSUserDefaults = {
  standardUserDefaults: () => ({
    doubleForKey: () => lastCheckValue,
    setDoubleForKey: (_v: number) => { throttleWritten = true },
    synchronize: () => {},
    objectForKey: (key: string) => defaultsKv[key],
    setObjectForKey: (value: any, key: string) => { defaultsKv[key] = value }
  })
}
const defaultsKv: Record<string, any> = {}
let throttleWritten = false
;(globalThis as Record<string, unknown>).__GITHUB_REPOSITORY__ = "baidream/CardLink"
;(globalThis as Record<string, unknown>).__APP_VERSION__ = "2.3.3-beta.28"
;(globalThis as Record<string, unknown>).NSFileManager = {
  defaultManager: () => ({
    fileExistsAtPath: () => false,
    createDirectoryAtPathWithIntermediateDirectoriesAttributes: () => true
  })
}

mock.module("marginnote", { namedExports: marginnoteMock })
installNativeMocks()
;(globalThis as any).UIAlertViewStyle = { PlainTextInput: 2 }

// tsx 会把 .ts 编译为 CJS，不能用顶层 await；在用例内首次加载被测模块。
type Updater = typeof import("../src/updater")
let updater: Updater
let settings: typeof import("../src/settings")
async function loadModules() {
  if (!updater) {
    updater = await import("../src/updater")
    settings = await import("../src/settings")
  }
}

function reset() {
  settings.saveMatcherSettings({ debugModeEnabled: false })
  debugReleases = []
  debugApiShouldFail = false
  resetInstaller()
  calls.fetches.length = 0
  calls.huds.length = 0
  calls.popups.length = 0
  calls.saved.length = 0
  calls.writes.length = 0
  githubApiShouldFail = false
  giteeApiShouldFail = false
  githubDownloadShouldFail = false
  tinyDownload = false
  popupResult = { buttonIndex: 0 }
  lastCheckValue = 0
  throttleWritten = false
  onDownload = undefined
  promptTimeouts.length = 0
  delete (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__
  delete (globalThis as any).__MNAM_WEB_PANEL_GLOBAL__
  for (const key of Object.keys(defaultsKv)) delete defaultsKv[key]
  githubReleases = []
  giteeReleases = []
}

test("正式渠道自动检查受 12h 节流限制", async () => {
  await loadModules()

  reset()
  githubReleases = [release("9.9.9")]
  lastCheckValue = Date.now() - 60_000
  await updater.checkForUpdates(false)
  assert.equal(calls.fetches.length, 0)
  lastCheckValue = Date.now() - 13 * 60 * 60 * 1000
  await updater.checkForUpdates(false)
  assert.ok(calls.fetches.length >= 1)
  // 自动检查不允许弹模态框，只用 HUD 提示
  assert.equal(calls.popups.length, 0)
  assert.ok(calls.huds.some(message => message.includes("v9.9.9")))
})

test("已是最新版本时直接提示，不进入确认弹窗", async () => {
  await loadModules()

  reset()
  githubReleases = [release("0.0.1")]
  await updater.checkForUpdates(true)
  assert.equal(calls.fetches.length, 1)
  assert.equal(calls.popups.length, 0)
  assert.ok(calls.huds.some(message => message.includes("当前已是最新版本")))
})

test("GitHub 检查失败自动回退 Gitee，交互确认后不下载", async () => {
  await loadModules()

  reset()
  githubApiShouldFail = true
  giteeReleases = [release("9.9.9")]
  popupResult = { buttonIndex: -1 } // 取消
  await updater.checkForUpdates(true)
  assert.ok(calls.fetches.some(call => call.url.includes("gitee.com")))
  const popup = calls.popups[0]
  assert.match(popup.title, /^CardLink：/)
  assert.match(popup.title, /v9\.9\.9/)
  assert.match(popup.message, /Gitee 备用源/)
  assert.equal(calls.writes.length, 0)
  assert.equal(calls.saved.length, 0)
})

test("发现新版本并确认后：下载附件 → 写入临时目录 → 替换安装目录", async () => {
  await loadModules()

  reset()
  githubReleases = [release("9.9.9")]
  await updater.checkForUpdates(true)
  assert.equal(calls.popups.length, 1)
  assert.deepEqual(calls.popups[0].buttons, ["直接安装", "手动安装"])
  assert.match((calls.popups[0] as any).message, /更新说明 9\.9\.9/)
  const download = calls.fetches.find(call => call.url.endsWith(".mnaddon"))
  assert.ok(download, "缺少附件下载请求")
  assert.equal((download!.init as any).headers.Accept, "application/octet-stream")
  assert.equal(calls.writes.length, 1)
  assert.match(calls.writes[0], /^\/tmp\/mn-temp\/CardLink\/temp\/updates\/CardLink-v9\.9\.9\.mnaddon$/)
  assert.equal(calls.saved.length, 0)
  assert.equal(readJSON(`${target}/mnaddon.json`).version, "9.9.9")
  assert.equal(moves.length, 2)
  assert.ok(calls.huds.some(message => message.includes("重启 MarginNote")))
})

test("GitHub 附件下载失败时回退 Gitee 同版本附件", async () => {
  await loadModules()

  reset()
  githubReleases = [release("9.9.9")]
  giteeReleases = [release("9.9.9", true, "gitee.com")]
  githubDownloadShouldFail = true
  await updater.checkForUpdates(true)
  assert.ok(calls.huds.includes("GitHub 下载失败，正在从 Gitee 下载…"))
  assert.equal(calls.writes.length, 1)
  assert.equal(calls.saved.length, 0)
  assert.equal(readJSON(`${target}/mnaddon.json`).version, "9.9.9")
})

test("Release 中没有安装包附件时报错提示而不是崩溃", async () => {
  await loadModules()

  reset()
  githubReleases = [release("9.9.9", false)]
  await updater.checkForUpdates(true)
  assert.equal(calls.writes.length, 0)
  assert.ok(calls.huds.some(message => message.startsWith("检查更新失败")))
})

test("自动检查失败不写 12h 节流，成功检查才写", async () => {
  await loadModules()

  // 失败：两个源都挂
  reset()
  githubApiShouldFail = true
  giteeApiShouldFail = true
  await updater.checkForUpdates(false)
  assert.equal(throttleWritten, false, "检查失败不得写节流")

  // 成功：恢复 GitHub 后拿到列表（无新版本也算检查成功）
  giteeApiShouldFail = false
  giteeReleases = [release("0.0.1")]
  await updater.checkForUpdates(false)
  assert.equal(throttleWritten, true, "成功检查应写节流")
})

test("下载体积小于 64KB 判定为坏包，不写入不保存", async () => {
  await loadModules()

  reset()
  githubReleases = [release("9.9.9")]
  tinyDownload = true
  await updater.checkForUpdates(true)
  assert.equal(calls.writes.length, 0, "坏包不得写入")
  assert.equal(calls.saved.length, 0, "坏包不得调起保存")
  assert.ok(calls.huds.some(m => m.includes("更新包下载不完整")))
})

test("直链安装使用同一替换流程；取消和无效链接不下载", async () => {
  await loadModules()
  reset()
  popupResult = { buttonIndex: -1 }
  await updater.installUpdateFromLink()
  assert.equal(calls.fetches.length, 0)
  popupResult = { buttonIndex: 0, inputContent: "file:///bad" }
  await updater.installUpdateFromLink()
  assert.equal(calls.fetches.length, 0)
  popupResult = { buttonIndex: 0, inputContent: "http://192.168.1.2:8765/CardLink.mnaddon" }
  await updater.installUpdateFromLink()
  assert.equal(readJSON(`${target}/mnaddon.json`).version, "9.9.9")
  assert.equal(calls.fetches.length, 1)
})

test("更新状态区分磁盘与运行版本，不把目录替换当作热加载成功", async () => {
  await loadModules()
  reset()
  await updater.showUpdateStatus()
  assert.match(calls.popups[calls.popups.length - 1].message, /运行版本与安装版本一致/)
  files.set(`${target}/mnaddon.json`, { addonid: "marginnote.extension.mn4-answer-matcher", version: "9.9.9" })
  await updater.showUpdateStatus()
  assert.match(calls.popups[calls.popups.length - 1].message, /当前运行版本：v2.3.3-beta.28/)
  assert.match(calls.popups[calls.popups.length - 1].message, /磁盘安装版本：v9.9.9/)
  assert.match(calls.popups[calls.popups.length - 1].message, /当前代码仍为旧版本/)
})

test("更新中的第二次调用不重复下载或替换", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  await Promise.all([updater.checkForUpdates(true), updater.checkForUpdates(true)])
  assert.equal(moves.length, 2)
  assert.ok(calls.huds.includes("正在处理更新，请稍候"))
})

test("网站源需双开关，启用后优先检查并安装网站包", async () => {
  await loadModules(); reset()
  assert.throws(() => updater.setDebugUpdateDownloads(true), /调试模式/)
  settings.saveMatcherSettings({ debugModeEnabled: true })
  githubReleases = [release("0.0.1")]
  await updater.checkForUpdates(true)
  assert.ok(!calls.fetches.some(c => c.url === updater.DEBUG_RELEASES_URL))
  updater.setDebugUpdateDownloads(true)
  calls.fetches.length = 0
  debugReleases = [release("9.9.9", true, "2608204.xyz/downloads/debug")]
  await updater.checkForUpdates(true)
  assert.equal(calls.fetches[0].url, updater.DEBUG_RELEASES_URL)
  assert.ok(!calls.fetches.some(c => c.url.includes("api.github.com")))
  assert.equal(readJSON(`${target}/mnaddon.json`).version, "9.9.9")
  assert.match(calls.popups[calls.popups.length - 1].message, /调试更新/)
  assert.doesNotMatch(calls.popups[calls.popups.length - 1].message, /2608204\.xyz/)
  settings.saveMatcherSettings({ debugModeEnabled: false })
  assert.equal(settings.loadMatcherSettings().debugUpdateDownloadsEnabled, false)
})

test("网站不可用、空清单、旧版本或异常清单回退 GitHub；自动检查不弹窗", async () => {
  await loadModules()
  for (const payload of [[], {}, [release("0.0.1")], [release("9.9.9")], "network-failure"]) {
    reset(); settings.saveMatcherSettings({ debugModeEnabled: true }); updater.setDebugUpdateDownloads(true)
    debugReleases = payload; debugApiShouldFail = payload === "network-failure"
    githubReleases = [release("0.0.1")]
    await updater.checkForUpdates(true)
    assert.equal(calls.fetches[0].url, updater.DEBUG_RELEASES_URL)
    assert.ok(calls.fetches.some(c => c.url.includes("api.github.com")))
    assert.equal(moves.length, 0)
  }
  reset(); settings.saveMatcherSettings({ debugModeEnabled: true }); updater.setDebugUpdateDownloads(true)
  debugReleases = [release("9.9.9", true, "2608204.xyz/downloads/debug")]
  await updater.checkForUpdates(false)
  assert.equal(calls.popups.length, 0)
  assert.equal(moves.length, 0)
})


test("手动安装只下载并保存，不替换目录；直链也提供两种安装方式", async () => {
  await loadModules(); reset()
  githubReleases = [release("9.9.9")]
  popupResult = { buttonIndex: 1 }
  await updater.checkForUpdates(true)
  assert.equal(calls.saved.length, 1)
  assert.equal(calls.writes.length, 1)
  assert.equal(moves.length, 0)
  assert.equal(readJSON(`${target}/mnaddon.json`).version, __APP_VERSION__)
  reset()
  popupResult = { buttonIndex: 1, inputContent: "https://example.com/CardLink.mnaddon" }
  await updater.installUpdateFromLink()
  assert.equal(calls.saved.length, 1)
  assert.equal(moves.length, 0)
})

test("自动安装开关仅保存设置；后续自动检查遵守节流并按设置安装", async () => {
  await loadModules(); reset()
  assert.equal(settings.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
  await assert.rejects(updater.setDebugAutoInstallUpdates(true), /调试模式/)
  settings.saveMatcherSettings({ debugModeEnabled: true })
  lastCheckValue = Date.now()
  githubReleases = [release("9.9.9")]
  await updater.setDebugAutoInstallUpdates(true)
  assert.equal(settings.loadMatcherSettings().debugAutoInstallUpdatesEnabled, true)
  assert.equal(calls.fetches.length, 0, "开启设置不得发起更新检查")
  assert.equal(calls.writes.length, 0)
  assert.equal(moves.length, 0)
  await updater.checkForUpdates(false)
  assert.equal(calls.fetches.length, 0, "自动检查仍遵守 12 小时节流")
  lastCheckValue = Date.now() - 13 * 60 * 60 * 1000
  await updater.checkForUpdates(false)
  assert.equal(moves.length, 2)
  assert.equal(calls.popups.length, 0)
  assert.equal(calls.saved.length, 0)
  assert.ok(calls.huds.some(message => message.includes("重启 MarginNote")))
  calls.fetches.length = 0
  await updater.setDebugAutoInstallUpdates(false)
  assert.equal(calls.fetches.length, 0, "关闭设置不得发起更新检查")
  assert.equal(settings.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
  await updater.setDebugAutoInstallUpdates(true)
  assert.equal(calls.fetches.length, 0, "重新开启同样只保存设置")
  settings.saveMatcherSettings({ debugModeEnabled: false })
  assert.equal(settings.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
  settings.saveMatcherSettings({ debugModeEnabled: true })
  assert.equal(settings.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
})

test("后台自动安装走双源回退；未重启不重复下载已安装版本", async () => {
  await loadModules(); reset()
  settings.saveMatcherSettings({ debugModeEnabled: true, debugAutoInstallUpdatesEnabled: true })
  githubReleases = [release("9.9.9")]
  giteeReleases = [release("9.9.9", true, "gitee.com")]
  githubDownloadShouldFail = true
  await updater.checkForUpdates(false)
  assert.equal(moves.length, 2)
  assert.equal(calls.popups.length, 0)
  assert.ok(calls.fetches.some(call => call.url.endsWith(".mnaddon") && call.url.includes("gitee.com")))
  calls.fetches.length = 0
  await updater.checkForUpdates(false)
  assert.equal(moves.length, 2)
  assert.ok(!calls.fetches.some(call => call.url.endsWith(".mnaddon")))
  await updater.checkForUpdates(true)
  assert.equal(calls.popups.length, 0)
  assert.ok(calls.huds.some(message => message.includes("已安装") && message.includes("重启 MarginNote")))
})

test("自动下载期间关闭自动安装或退出调试模式，不执行安装", async () => {
  await loadModules()
  for (const exitDebug of [false, true]) {
    reset()
    settings.saveMatcherSettings({ debugModeEnabled: true, debugAutoInstallUpdatesEnabled: true })
    githubReleases = [release("9.9.9")]
    onDownload = () => settings.saveMatcherSettings(exitDebug ? { debugModeEnabled: false } : { debugAutoInstallUpdatesEnabled: false })
    await updater.checkForUpdates(false)
    assert.equal(calls.writes.length, 1)
    assert.equal(moves.length, 0)
    assert.equal(calls.popups.length, 0)
  }
})

test("自动安装失败提示错误并恢复旧目录；默认后台检查只提醒", async () => {
  await loadModules(); reset()
  githubReleases = [release("9.9.9")]
  await updater.checkForUpdates(false)
  assert.equal(calls.writes.length, 0)
  assert.equal(moves.length, 0)
  settings.saveMatcherSettings({ debugModeEnabled: true, debugAutoInstallUpdatesEnabled: true })
  options.failInstall = true
  await updater.checkForUpdates(false)
  assert.equal(readJSON(`${target}/mnaddon.json`).version, __APP_VERSION__)
  assert.ok(calls.huds.some(message => message.includes("已恢复旧版本")))
  assert.equal(calls.popups.length, 0)
})
test("更新弹窗复用插件统一弹窗，说明转纯文本并在超长时截断", async () => {
  await loadModules()
  reset()
  const candidate = release("9.9.9")
  candidate.body = "# 更新\n\n**完整说明末尾**\n\n| 项目 | 值 |\n| --- | --- |\n| 版本 | 9.9.9 |\n\n"
    + "说明".repeat(600) + "\n\n<script>alert(1)</script>"
  githubReleases = [candidate]
  for (const [index, expectedSaved] of [[-1, 0], [1, 1]] as const) {
    popupResult = { buttonIndex: index }
    await updater.checkForUpdates(true)
    const dialog = calls.popups[calls.popups.length - 1] as any
    assert.match(dialog.title, /^CardLink：发现正式版 v9\.9\.9$/)
    assert.ok(dialog.message.startsWith(`当前版本：v${__APP_VERSION__}\n来源：GitHub\n\n`))
    assert.match(dialog.message, /完整说明末尾/)
    assert.match(dialog.message, /版本 9\.9\.9/, "表格行应转成可读文本")
    assert.doesNotMatch(dialog.message, /<script>|alert\(1\)|\*\*|^\s*\|/m)
    assert.ok(dialog.message.length < 1000, "过长说明应截断")
    assert.ok(dialog.message.trimEnd().endsWith("…"))
    assert.deepEqual(dialog.buttons, ["直接安装", "手动安装"])
    assert.equal(dialog.canCancel, true)
    assert.equal(dialog.multiLine, true)
    assert.equal(calls.saved.length, expectedSaved)
    calls.saved.length = 0
  }
})

test("更新说明为空时使用占位文案，取消不触发下载或保存", async () => {
  await loadModules()
  reset()
  const candidate = release("9.9.9")
  candidate.body = ""
  githubReleases = [candidate]
  popupResult = { buttonIndex: -1 }
  await updater.checkForUpdates(true)
  const dialog = calls.popups[calls.popups.length - 1] as any
  assert.match(dialog.message, /暂无更新说明/)
  assert.equal(calls.saved.length, 0)
  assert.equal(calls.writes.length, 0)
  assert.ok(!calls.fetches.some(call => call.url.endsWith(".mnaddon")))
})

test("面板就绪时把更新提示推给插件面板，桥接选择后继续下载与保存", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const scripts: string[] = []
  const selfObject = (globalThis as any).self
  selfObject.webController = { webReady: true, webView: { evaluateJavaScript: (script: string) => { scripts.push(script) } } }
  try {
    const check = updater.checkForUpdates(true)
    for (let attempt = 0; attempt < 200 && !scripts.length; attempt++) await new Promise(resolve => setTimeout(resolve, 1))
    assert.ok(scripts.some(script => script.includes("__cardLinkUpdatePrompt") && script.includes("9.9.9")), "应把更新提示推给插件面板")
    assert.equal(calls.popups.length, 0, "面板可用时不再弹原生弹窗")
    assert.equal(updater.resolveUpdateChoice("unknown"), false)
    assert.equal(updater.resolveUpdateChoice("manual"), true)
    await check
    assert.equal(calls.saved.length, 1)
    assert.equal(updater.resolveUpdateChoice("direct"), false, "同一提示只能选择一次")
  } finally {
    delete selfObject.webController
  }
})

test("面板网页未就绪时不推脚本，由面板拉取 pendingUpdatePrompt 后确认", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const scripts: string[] = []
  const selfObject = (globalThis as any).self
  // 没有 webReady：真实面板刚打开时就是这个状态。
  selfObject.webController = { webView: { evaluateJavaScript: (script: string) => { scripts.push(script) } } }
  try {
    const check = updater.checkForUpdates(true)
    for (let attempt = 0; attempt < 200 && !updater.pendingUpdatePrompt(); attempt++) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(scripts.length, 0, "网页未就绪时不应推送脚本")
    assert.equal(calls.popups.length, 0, "有面板承载时不应退回原生弹窗")
    const pending = updater.pendingUpdatePrompt()
    assert.equal(pending?.version, "9.9.9")
    assert.match(pending!.notes, /更新说明 9\.9\.9/)
    assert.equal(updater.resolveUpdateChoice("later"), true)
    await check
    assert.equal(updater.pendingUpdatePrompt(), null, "选择后清空待处理提示")
    assert.equal(calls.saved.length, 0)
  } finally {
    delete selfObject.webController
  }
})

test("面板提示选择稍后时不下载也不保存", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const selfObject = (globalThis as any).self
  selfObject.webController = { webReady: true, webView: { evaluateJavaScript: () => {} } }
  try {
    const check = updater.checkForUpdates(true)
    for (let attempt = 0; attempt < 200 && !updater.pendingUpdatePrompt(); attempt++) await new Promise(resolve => setTimeout(resolve, 1))
    // 直接模拟用户在面板里取消：与超时走同一条 later 分支。
    assert.equal(updater.resolveUpdateChoice("later"), true)
    await check
    assert.equal(calls.saved.length, 0)
    assert.equal(calls.writes.length, 0)
  } finally {
    delete selfObject.webController
  }
})

async function waitFor(predicate: () => boolean, attempts = 400) {
  for (let attempt = 0; attempt < attempts && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 1))
}

/** 取出并返回某个时长的等待回调；未登记则 fail。 */
function takeDelay(seconds: number): () => void {
  const index = promptTimeouts.findIndex(entry => entry.seconds === seconds)
  assert.ok(index >= 0, `没有待触发的 ${seconds} 秒等待`)
  return promptTimeouts.splice(index, 1)[0].fire
}

function sceneEntry(token = "scene:1") {
  const owner: any = {
    cardLinkSceneToken: token,
    webController: { webReady: true, webView: { evaluateJavaScript: () => { throw new Error("场景窗口不应走经典推送") } } }
  }
  return owner
}

function installSceneStub(acceptedOwner: any) {
  const notices: Array<{ owner: any; event: string; data: any }> = []
  ;(globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__ = {
    enabled: (owner: any) => owner === acceptedOwner,
    notify: (owner: any, event: string, data: any) => { notices.push({ owner, event, data }) }
  }
  return notices
}

test("已就绪场景面板按发起窗口的 owner 投递提示，联网结束后不再读全局 self", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  const originalSelf = (globalThis as any).self
  let check: Promise<void>
  try {
    check = updater.checkForUpdates(true, owner)
    // 联网期间全局 self 换成另一个没有面板的窗口实例：修复后不得再回读它。
    ;(globalThis as any).self = { mainPath: target }
    await waitFor(() => notices.length > 0)
    assert.equal(notices[0].owner, owner, "提示应投递给发起检查的场景面板")
    assert.equal(notices[0].event, "updatePrompt")
    assert.equal(notices[0].data.version, "9.9.9")
    assert.equal(typeof notices[0].data.promptId, "string")
    assert.equal(calls.popups.length, 0, "已就绪的场景面板不应退回原生弹窗")
    assert.equal(updater.resolveUpdateChoice("direct", notices[0].data.promptId), true)
    await check
  } finally {
    ;(globalThis as any).self = originalSelf
  }
  assert.equal(moves.length, 2, "直接安装应替换安装目录")
})

test("经典面板按 owner 推送脚本，全局 self 已指向别的窗口也不影响手动安装", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const scripts: string[] = []
  const owner: any = { webController: { webReady: true, webView: { evaluateJavaScript: (script: string) => { scripts.push(script) } } } }
  const originalSelf = (globalThis as any).self
  try {
    const check = updater.checkForUpdates(true, owner)
    ;(globalThis as any).self = {}
    await waitFor(() => scripts.length > 0)
    assert.ok(scripts.some(script => script.includes("__cardLinkUpdatePrompt") && script.includes("9.9.9") && script.includes("promptId")))
    assert.equal(calls.popups.length, 0)
    assert.equal(updater.resolveUpdateChoice("manual", updater.pendingUpdatePrompt()?.promptId), true)
    await check
  } finally {
    ;(globalThis as any).self = originalSelf
  }
  assert.equal(calls.saved.length, 1, "手动安装应打开保存面板")
  assert.equal(moves.length, 0, "手动安装不替换安装目录")
})

test("面板网页尚未就绪时由面板拉取提示，拉取结果带身份且过期身份不能确认", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const scripts: string[] = []
  const owner: any = { webController: { webView: { evaluateJavaScript: (script: string) => { scripts.push(script) } } } }
  const originalSelf = (globalThis as any).self
  try {
    const check = updater.checkForUpdates(true, owner)
    ;(globalThis as any).self = {}
    await waitFor(() => updater.pendingUpdatePrompt() !== null)
    assert.equal(scripts.length, 0, "网页未就绪时不应推送脚本")
    assert.equal(calls.popups.length, 0, "有面板承载时不应退回原生弹窗")
    const pending = updater.pendingUpdatePrompt()!
    assert.equal(pending.version, "9.9.9")
    assert.equal(typeof pending.promptId, "string")
    assert.equal(updater.resolveUpdateChoice("later", "update-stale"), false, "旧身份不能结束当前提示")
    assert.equal(updater.pendingUpdatePrompt()?.promptId, pending.promptId)
    assert.equal(updater.resolveUpdateChoice("later", pending.promptId), true)
    await check
  } finally {
    ;(globalThis as any).self = originalSelf
  }
  assert.equal(updater.pendingUpdatePrompt(), null)
  assert.equal(calls.saved.length, 0)
  assert.equal(moves.length, 0)
})

test("真正没有面板承载时仍退回原生弹窗，取消不安装", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  installSceneStub({ cardLinkSceneToken: "other-window" })
  popupResult = { buttonIndex: -1 }
  await updater.checkForUpdates(true, { cardLinkSceneToken: "no-panel" })
  assert.equal(calls.popups.length, 1, "没有面板承载时才用原生弹窗")
  assert.equal(calls.writes.length, 0)
  assert.equal(calls.saved.length, 0)
  assert.equal(updater.pendingUpdatePrompt(), null)
})

test("面板存在但无法显示时先等待面板拉取，超过有界等待才回退原生弹窗", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const scripts: string[] = []
  const owner: any = { webController: { webReady: true, webView: { evaluateJavaScript: (script: string) => { scripts.push(script) } } } }
  const originalSelf = (globalThis as any).self
  try {
    const check = updater.checkForUpdates(true, owner)
    ;(globalThis as any).self = {}
    // 面板 API 报告隐藏：提示送不到用户眼前，但仍先按面板承载等待。
    ;(globalThis as any).__MNAM_WEB_PANEL_GLOBAL__ = { isVisible: () => false }
    await waitFor(() => promptTimeouts.some(entry => entry.seconds === 30) && promptTimeouts.some(entry => entry.seconds === 180))
    assert.equal(calls.popups.length, 0, "有界等待内不应弹原生弹窗")
    assert.ok(scripts.some(script => script.includes("__cardLinkUpdatePrompt")), "仍先尝试推给面板")
    popupResult = { buttonIndex: -1 }
    takeDelay(30)()
    await check
  } finally {
    delete (globalThis as any).__MNAM_WEB_PANEL_GLOBAL__
    ;(globalThis as any).self = originalSelf
  }
  assert.equal(calls.popups.length, 1, "面板确实不可显示时才回退原生弹窗")
  assert.equal(updater.pendingUpdatePrompt(), null)
  assert.equal(moves.length, 0)
})

test("过期计时器不能关闭或结束之后的新提示，超时关闭信号带身份", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  const first = updater.checkForUpdates(true, owner)
  await waitFor(() => updater.pendingUpdatePrompt() !== null)
  const firstId = updater.pendingUpdatePrompt()!.promptId
  assert.equal(updater.resolveUpdateChoice("later", firstId), true)
  await first
  const firstTimeout = takeDelay(180)
  const second = updater.checkForUpdates(true, owner)
  await waitFor(() => {
    const pending = updater.pendingUpdatePrompt()
    return pending !== null && pending.promptId !== firstId
  })
  const secondId = updater.pendingUpdatePrompt()!.promptId
  // 旧提示的 180 秒计时器到期：既不能结束新提示，也不能投递关闭信号。
  firstTimeout()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(updater.pendingUpdatePrompt()?.promptId, secondId, "旧计时器不能结束新提示")
  assert.equal(notices.filter(notice => notice.data && notice.data.close === true).length, 0, "旧计时器不能关闭新提示")
  // 新提示自己的计时器到期：投递带身份的关闭信号并按稍后结束。
  takeDelay(180)()
  await second
  assert.equal(updater.pendingUpdatePrompt(), null)
  const close = notices[notices.length - 1]
  assert.equal(close.data.close, true)
  assert.equal(close.data.promptId, secondId)
  assert.equal(calls.saved.length, 0)
  assert.equal(calls.writes.length, 0)
})





test("场景面板收起时不算已显示：有界等待后回退原生弹窗，回退后不留下可重复弹出的待处理提示", async () => {
  await loadModules()
  reset()
  githubReleases = [release("9.9.9")]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  // 场景会话仍然 enabled，但面板收起：用户看不到，不能当作已显示。
  ;(globalThis as any).__MNAM_WEB_PANEL_GLOBAL__ = { isVisible: () => false, showPanel: () => {} }
  popupResult = { buttonIndex: -1 }
  try {
    const check = updater.checkForUpdates(true, owner)
    await waitFor(() => promptTimeouts.some(entry => entry.seconds === 30))
    assert.ok(notices.some(notice => notice.event === "updatePrompt"), "仍然先投给插件面板")
    assert.equal(calls.popups.length, 0, "有界等待内先按插件面板处理，不提前弹原生窗口")
    takeDelay(30)()
    await check
  } finally {
    delete (globalThis as any).__MNAM_WEB_PANEL_GLOBAL__
  }
  assert.equal(calls.popups.length, 1, "面板不可显示时才回退原生弹窗")
  assert.equal(updater.pendingUpdatePrompt(), null, "回退后清空待处理提示，面板稍后拉取不会重复弹窗")
  assert.equal(updater.resolveUpdateChoice("later", "update-stale"), false, "过期身份不能结束已清理的提示")
  assert.equal(moves.length, 0)
})

const MARKDOWN_BODY = [
  "# 更新说明",
  "",
  "## 折叠优先",
  "",
  "- **重点**：画面证据与模型分开",
  "- 列表项：`mindmapBranchClose`",
  "",
  "| 版本 | 内容 |",
  "| --- | --- |",
  "| b84 | 表格 |",
  "",
  "```js",
  "const answer = 42",
  "```",
  "",
  "> 引用段落",
  "",
  "[Release 页](https://example.com/releases/9.9.9)",
  "",
  "补充说明".repeat(220)
].join("\n")

test("官网调试源的默认构建说明在面板显示为 Markdown 表格", async () => {
  await loadModules()
  reset()
  settings.saveMatcherSettings({ debugModeEnabled: true })
  updater.setDebugUpdateDownloads(true)
  const body = [
    "调试通道构建：CardLink-v9.9.9.mnaddon（1.45 MB）",
    "发布时间：2026-11-23T13:52:33.297Z",
    `Git 提交：${"a".repeat(40)}`,
    `SHA-256：${"b".repeat(64)}`,
    "安装后请完整退出并重启 MarginNote。"
  ].join("\n")
  debugReleases = [{ ...release("9.9.9", true, "2608204.xyz/downloads/debug"), body }]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  const check = updater.checkForUpdates(true, owner)
  await waitFor(() => notices.length > 0)
  const payload = notices[0].data
  assert.match(payload.notesMarkdown, /^### 调试构建信息/)
  assert.ok(payload.notesMarkdown.includes("| 安装包 | `CardLink-v9.9.9.mnaddon` |"))
  assert.equal(payload.notes, body)
  assert.equal(updater.updateNotesMarkdown(MARKDOWN_BODY, "debug"), MARKDOWN_BODY)
  assert.equal(updater.resolveUpdateChoice("later"), true)
  await check
})

test("面板更新提示带 Release 原 Markdown，纯文本摘要仍按 900 字截断", async () => {
  await loadModules()
  reset()
  githubReleases = [Object.assign(release("9.9.9"), { body: MARKDOWN_BODY })]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  const check = updater.checkForUpdates(true, owner)
  await waitFor(() => notices.length > 0)
  const payload = notices[0].data
  assert.equal(payload.notesMarkdown, MARKDOWN_BODY, "面板拿到原 Markdown，不经过纯文本转换")
  assert.ok(payload.notesMarkdown.includes("| 版本 | 内容 |"), "表格结构保留")
  assert.ok(payload.notesMarkdown.includes("```js"), "代码围栏保留")
  assert.ok(payload.notes.length <= 901, "纯文本摘要仍按 900 字截断")
  assert.ok(!payload.notes.includes("**"), "纯文本摘要去掉 Markdown 标记")
  assert.equal(updater.resolveUpdateChoice("later"), true)
  await check
})

test("空 Release 正文：面板回退默认文案，原 Markdown 字段留空", async () => {
  await loadModules()
  reset()
  githubReleases = [Object.assign(release("9.9.9"), { body: "" })]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  const check = updater.checkForUpdates(true, owner)
  await waitFor(() => notices.length > 0)
  assert.equal(notices[0].data.notes, "暂无更新说明")
  assert.equal(notices[0].data.notesMarkdown, undefined)
  assert.equal(updater.resolveUpdateChoice("later"), true)
  await check
})

test("原生兜底弹窗仍用纯文本说明，不出现 Markdown 标记", async () => {
  await loadModules()
  reset()
  githubReleases = [Object.assign(release("9.9.9"), { body: MARKDOWN_BODY })]
  installSceneStub({ cardLinkSceneToken: "other-window" })
  popupResult = { buttonIndex: -1 }
  await updater.checkForUpdates(true, { cardLinkSceneToken: "no-panel" })
  const dialog = calls.popups[calls.popups.length - 1] as any
  assert.ok(dialog, "没有面板承载时退回原生弹窗")
  assert.ok(!String(dialog.message).includes("# 更新说明"), "原生兜底不显示 Markdown 标题标记")
  assert.ok(!String(dialog.message).includes("| 版本 |"), "原生兜底不显示表格标记")
  assert.match(String(dialog.message), /补充说明/)
})

test("超过 20000 字的 Release 原文仍完整送到面板，纯文本摘要才有 900 字上限", async () => {
  await loadModules()
  reset()
  const huge = `# 超长说明\n\n${"长段落内容".repeat(5000)}`
  assert.ok(huge.length > 20000, `用例正文应超过 20000 字，实际 ${huge.length}`)
  githubReleases = [Object.assign(release("9.9.9"), { body: huge })]
  const owner = sceneEntry()
  const notices = installSceneStub(owner)
  const check = updater.checkForUpdates(true, owner)
  await waitFor(() => notices.length > 0)
  const payload = notices[0].data
  assert.equal(payload.notesMarkdown.length, huge.length, "原 Markdown 不截断")
  assert.equal(payload.notesMarkdown, huge)
  assert.ok(payload.notes.length <= 901, "只有纯文本摘要按 900 字截断")
  assert.equal(updater.resolveUpdateChoice("later"), true)
  await check
})
