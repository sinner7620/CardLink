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
  delay: async () => {},
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
