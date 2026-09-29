/**
 * 更新流程行为级测试：mock marginnote 运行时（fetch/popup/showHUD/saveFile），
 * 真正执行 checkForUpdates 的分支逻辑——GitHub→Gitee 回退、节流、
 * 交互确认、附件下载与保存路径。
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"

const calls = {
  fetches: [] as Array<{ url: string; init?: any }>,
  huds: [] as string[],
  popups: [] as any[],
  saved: [] as string[],
  writes: [] as string[]
}

let githubReleases: unknown[] = []
let giteeReleases: unknown[] = []
let githubApiShouldFail = false
let giteeApiShouldFail = false
let githubDownloadShouldFail = false
let tinyDownload = false
let popupResult = { buttonIndex: 0 }
let lastCheckValue = 0

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
  if (url.includes("api.github.com")) {
    if (githubApiShouldFail) throw new Error("github down")
    return response(githubReleases)
  }
  if (url.includes("gitee.com")) {
    if (giteeApiShouldFail) throw new Error("gitee down")
    return response(giteeReleases)
  }
  // 附件下载
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
  MN: {
    error: () => {},
    app: { tempPath: "/tmp/mn-temp" }
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

// tsx 会把 .ts 编译为 CJS，不能用顶层 await；在用例内首次加载被测模块。
type Updater = typeof import("../src/updater")
let updater: Updater
async function loadModules() {
  if (!updater) {
    updater = await import("../src/updater")
  }
}

function reset() {
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
  popupResult = { buttonIndex: 1 } // 取消
  await updater.checkForUpdates(true)
  assert.ok(calls.fetches.some(call => call.url.includes("gitee.com")))
  const popup = calls.popups[0]
  assert.match(popup.title, /^CardLink：/)
  assert.match(popup.title, /v9\.9\.9/)
  assert.match(popup.message, /Gitee 备用源/)
  assert.equal(calls.writes.length, 0)
  assert.equal(calls.saved.length, 0)
})

test("发现新版本并确认后：下载附件 → 写入临时目录 → 调起系统保存", async () => {
  await loadModules()

  reset()
  githubReleases = [release("9.9.9")]
  await updater.checkForUpdates(true)
  assert.equal(calls.popups.length, 1)
  assert.match((calls.popups[0] as any).message, /更新说明 9\.9\.9/)
  const download = calls.fetches.find(call => call.url.endsWith(".mnaddon"))
  assert.ok(download, "缺少附件下载请求")
  assert.equal((download!.init as any).headers.Accept, "application/octet-stream")
  assert.equal(calls.writes.length, 1)
  assert.match(calls.writes[0], /^\/tmp\/mn-temp\/CardLink\/temp\/updates\/CardLink-v9\.9\.9\.mnaddon$/)
  assert.equal(calls.saved.length, 1)
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
  assert.equal(calls.saved.length, 1)
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
