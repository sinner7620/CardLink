import { delay, fetch, MN, popup, saveFile, showHUD, UIAlertViewStyle } from "marginnote"
import { backupBindings } from "./store"
import { CardLinkError } from "./errors"
import { compareVersions } from "./version"
import { describeError } from "./error-messages"
import { markdownToPlainText } from "./markdown"
import { captureDiagnosticError, recordRuntimeState } from "./note-navigation"
import { showPluginPanel } from "./plugin-panel"
import { cardLinkTempPath, ensureStorageDirectory } from "./storage-paths"
import { installedVersion, installUpdatePackage } from "./update-installer"
import { loadMatcherSettings, saveMatcherSettings } from "./settings"
import type { UpdatePromptPayload } from "./update-prompt"

export const DEBUG_RELEASES_URL = "https://2608204.xyz/updates/debug/releases.json"

const UPDATE_NOTES_LIMIT = 900
const UPDATE_PROMPT_TIMEOUT_SECONDS = 180
// 面板一直不可显示时，最多等这么久就改用原生弹窗（仍然先尝试把面板带到前台）。
const UPDATE_PROMPT_UNREACHABLE_SECONDS = 30
const UPDATE_PROMPT_REPEAT_DELAYS = [0.8, 2.4]

// 原生系统弹窗只放得下纯文本，过长的部分截断并标注省略。
export function updateNotesText(body: unknown): string {
  const text = markdownToPlainText(String(body ?? "")).trim()
  if (!text) return "暂无更新说明"
  return text.length > UPDATE_NOTES_LIMIT ? `${text.slice(0, UPDATE_NOTES_LIMIT).trimEnd()}…` : text
}

/**
 * Release 正文的原 Markdown，交给插件面板的更新确认弹窗渲染。
 * 只做换行归一与空正文判断，不按长度截断；空正文返回 undefined，
 * 让面板回退到 `notes` 的「暂无更新说明」。
 */
export function updateNotesMarkdown(body: unknown, sourceType?: GitHubRelease["source"]): string | undefined {
  const source = String(body ?? "").replace(/\r\n?/g, "\n").trim()
  if (sourceType === "debug") {
    const metadata = /^调试通道构建：([\w.+-]+\.mnaddon)（([\d.]+ [KMGT]?B)）\n发布时间：([\dTZ:.+-]+)\nGit 提交：([a-f0-9]{40,64}|unknown)\nSHA-256：([a-f0-9]{64})\n安装后请完整退出并重启 MarginNote。$/i.exec(source)
    if (metadata) {
      const [, filename, size, publishedAt, commit, checksum] = metadata
      return [
        "### 调试构建信息", "",
        "| 项目 | 内容 |",
        "| --- | --- |",
        `| 安装包 | \`${filename}\` |`,
        `| 大小 | ${size} |`,
        `| 发布时间（UTC） | ${publishedAt} |`,
        `| Git 提交 | \`${commit}\` |`,
        `| SHA-256 | \`${checksum}\` |`,
        "", "安装后请完整退出并重启 MarginNote。"
      ].join("\n")
    }
  }
  return source || undefined
}

export type UpdateChoice = "direct" | "manual" | "later"

export type { UpdatePromptPayload }

let pendingUpdateChoice: ((choice: UpdateChoice) => void) | undefined
let pendingPrompt: { id: string; payload: UpdatePromptPayload } | null = null
let promptSequence = 0

/** 面板收到的提示载荷：带身份用于回传选择，关闭信号只带身份。 */
type UpdatePromptMessage = (UpdatePromptPayload & { promptId: string }) | { promptId: string; close: true }

function nextPromptId(): string {
  promptSequence += 1
  return `update-${Date.now().toString(36)}-${promptSequence}`
}

/** 面板启动或重新显示时主动拉取当前待处理的更新提示；没有时返回 null。 */
export function pendingUpdatePrompt(): (UpdatePromptPayload & { promptId: string }) | null {
  return pendingPrompt ? { ...pendingPrompt.payload, promptId: pendingPrompt.id } : null
}

/** 场景面板按面板所属 addon 查找会话；不能读全局 self，否则会取到别的窗口。 */
function scenePanelAvailable(owner: any): boolean {
  try {
    return (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__?.enabled?.(owner) === true
  } catch {
    return false
  }
}

/** 面板网页未就绪时 evaluateJavaScript 会失败，只有 webReady 后才能推脚本。 */
function panelWebReady(owner: any): boolean {
  try {
    const controller = owner?.webController
    return Boolean(controller?.webReady && controller?.webView?.evaluateJavaScript)
  } catch {
    return false
  }
}

/** 面板此刻是否在屏上（经典面板与场景面板都由这个 API 反映，场景收起时为 false）。 */
function panelVisible(owner: any): boolean {
  try {
    const panel = (globalThis as any).__MNAM_WEB_PANEL_GLOBAL__
    const controller = owner?.webController
    if (!controller) return false
    // 宿主没有提供可见性 API 时不据此回退，避免误判成"没有面板"。
    if (typeof panel?.isVisible !== "function") return true
    return panel.isVisible(controller) === true
  } catch {
    return true
  }
}

/**
 * 提示能不能被用户看到：必须存在面板承载，且面板确实在屏上。
 * 隐藏的经典面板、收起的场景面板都算不可达——先把面板带到前台再判断。
 */
function promptReachable(owner: any): boolean {
  if (!scenePanelAvailable(owner) && !owner?.webController) return false
  return panelVisible(owner)
}

function updatePromptScript(message: UpdatePromptMessage): string {
  return `typeof window.__cardLinkUpdatePrompt==='function'&&window.__cardLinkUpdatePrompt(${JSON.stringify(message)})`
}

/** 快速路径：面板已就绪时直接推一条；面板启动时由 web 侧主动拉取兜底。 */
function pushUpdatePrompt(owner: any, message: UpdatePromptMessage): boolean {
  const scene = scenePanelAvailable(owner)
  const ready = panelWebReady(owner)
  if (!scene && !ready) return false
  let delivered = false
  try {
    if (scene) {
      (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.notify(owner, "updatePrompt", message)
      delivered = true
    }
  } catch {
    // 场景面板不可用时继续尝试经典面板。
  }
  try {
    const view = owner?.webController?.webView
    if (ready && view?.evaluateJavaScript) {
      view.evaluateJavaScript(updatePromptScript(message), () => undefined)
      delivered = true
    }
  } catch {
    // 面板脚本未就绪：面板侧的拉取会补上这条提示。
  }
  return delivered
}

/** 面板弹窗里的用户选择；返回 false 表示当前没有等待中的提示，或这条选择不属于它。
 *  旧面板不带 promptId 时沿用原行为；带身份的选择只能结束同一条提示。 */
export function resolveUpdateChoice(value: unknown, promptId?: unknown): boolean {
  if (value !== "direct" && value !== "manual" && value !== "later") return false
  const pending = pendingPrompt
  const resolve = pendingUpdateChoice
  if (!pending || !resolve) return false
  if (typeof promptId === "string" && promptId && promptId !== pending.id) return false
  pendingUpdateChoice = undefined
  pendingPrompt = null
  recordRuntimeState("更新", "prompt.choice", value)
  resolve(value)
  return true
}

async function popupUpdateChoice(payload: UpdatePromptPayload): Promise<UpdateChoice> {
  const result = await popup({
    title: `CardLink：发现${payload.channel} v${payload.version}`,
    message: `当前版本：v${payload.currentVersion}\n来源：${payload.source}\n\n${payload.notes}`,
    buttons: ["直接安装", "手动安装"],
    canCancel: true,
    multiLine: true
  })
  return result.buttonIndex === 0 ? "direct" : result.buttonIndex === 1 ? "manual" : "later"
}

/** 优先在插件面板里弹窗确认；只有完全没有面板承载时才退回原生弹窗。
 *  owner 是发起这次检查的窗口（场景面板经桥接、经典面板与原生菜单各有来源），
 *  等待联网和等待用户选择期间都不能再读全局 self。 */
async function requestUpdateChoice(owner: any, payload: UpdatePromptPayload): Promise<UpdateChoice> {
  const promptId = nextPromptId()
  pendingPrompt = { id: promptId, payload }
  const hasPanel = Boolean(owner?.webController)
  const panel = hasPanel ? showPluginPanel(owner) : false
  const scene = scenePanelAvailable(owner)
  const reachable = promptReachable(owner)
  recordRuntimeState("更新", "prompt.pending",
    `panel=${hasPanel} shown=${panel} scene=${scene} ready=${panelWebReady(owner)} visible=${panelVisible(owner)} reachable=${reachable}`)
  if (!hasPanel && !scene) {
    pendingPrompt = null
    recordRuntimeState("更新", "prompt.fallback", "没有可用的插件面板")
    return popupUpdateChoice(payload)
  }
  // 面板网页可能仍在加载：这里的推送只是快路径，失败由面板启动/显示时的拉取补上。
  const message: UpdatePromptMessage = { ...payload, promptId }
  if (!pushUpdatePrompt(owner, message)) {
    recordRuntimeState("更新", "prompt.deferred", "面板尚不能显示提示，等待面板拉取")
  }
  return new Promise<UpdateChoice>(resolve => {
    pendingUpdateChoice = resolve
    for (const seconds of UPDATE_PROMPT_REPEAT_DELAYS) {
      void delay(seconds).then(() => {
        // 只重推仍在等待的同一条提示；提示已被选择、超时或被新提示替换时不再投递。
        if (pendingPrompt?.id !== promptId) return
        pushUpdatePrompt(owner, message)
      })
    }
    // 面板一直不可显示时不要空等：有界等待后改走原生弹窗，并先清掉待处理提示，
    // 免得面板稍后就绪又弹一次。首选仍是插件面板，只有确实不可达才回退。
    void delay(UPDATE_PROMPT_UNREACHABLE_SECONDS).then(async () => {
      if (pendingPrompt?.id !== promptId || pendingUpdateChoice !== resolve) return
      if (promptReachable(owner)) return
      pendingUpdateChoice = undefined
      pendingPrompt = null
      recordRuntimeState("更新", "prompt.fallback", "面板不可显示，改用原生弹窗")
      pushUpdatePrompt(owner, { promptId, close: true })
      try { resolve(await popupUpdateChoice(payload)) } catch { resolve("later") }
    })
    void delay(UPDATE_PROMPT_TIMEOUT_SECONDS).then(() => {
      // 过期计时器属于发起的提示；它不能结束、替换或关闭之后的新提示。
      if (pendingPrompt?.id !== promptId) return
      const resolveLater = pendingUpdateChoice
      pendingUpdateChoice = undefined
      pendingPrompt = null
      recordRuntimeState("更新", "prompt.timeout", "")
      pushUpdatePrompt(owner, { promptId, close: true })
      resolveLater?.("later")
    })
  })
}

export function setDebugUpdateDownloads(enabled: boolean): { debugUpdateDownloadsEnabled: boolean } {
  if (!loadMatcherSettings().debugModeEnabled) throw new Error("请先开启调试模式")
  saveMatcherSettings({ debugUpdateDownloadsEnabled: enabled })
  return { debugUpdateDownloadsEnabled: enabled }
}

function usesDebugUpdateSource(): boolean {
  const settings = loadMatcherSettings()
  return settings.debugModeEnabled && settings.debugUpdateDownloadsEnabled
}

function automaticInstallationEnabled(): boolean {
  const settings = loadMatcherSettings()
  return settings.debugModeEnabled && settings.debugAutoInstallUpdatesEnabled
}

export async function setDebugAutoInstallUpdates(enabled: boolean): Promise<{ debugAutoInstallUpdatesEnabled: boolean }> {
  if (!loadMatcherSettings().debugModeEnabled) throw new Error("请先开启调试模式")
  saveMatcherSettings({ debugAutoInstallUpdatesEnabled: enabled })
  return { debugAutoInstallUpdatesEnabled: automaticInstallationEnabled() }
}

let updateInProgress = false
let installPath = ""

export function configureUpdatePath(path: string): void { installPath = path }

function currentInstallPath(): string {
  return installPath || (typeof self === "undefined" ? "" : String(self.mainPath || ""))
}

export async function showUpdateStatus(): Promise<void> {
  try {
    const disk = installedVersion(currentInstallPath())
    await popup({ title: "CardLink 更新状态", message: `当前运行版本：v${__APP_VERSION__}\n磁盘安装版本：v${disk}\n\n${disk === __APP_VERSION__ ? "运行版本与安装版本一致。" : "文件已更新，当前代码仍为旧版本。请完整退出并重启 MarginNote，以加载更新后的插件。"}`, buttons: ["确定"], multiLine: true })
  } catch (error) { showHUD(`读取更新状态失败：${String(error)}`, 5) }
}

function installDownloadedPackage(path: string, target: string, version?: string): void {
  backupBindings()
  const result = installUpdatePackage(path, target, version)
  showHUD(`CardLink v${result.version} 已安装，请完整退出并重启 MarginNote，使更新生效。`, 8)
}

function updateFailureMessage(error: unknown): string {
  // Preserve the installer's recovery result and backup location for manual recovery.
  if (error instanceof Error && error.message.startsWith("安装失败")) return error.message
  return describeError(error, "下载或安装失败，请稍后重试")
}

/** A direct package URL exercises the installer without publishing a release. */
export async function installUpdateFromLink(): Promise<void> {
  if (updateInProgress) { showHUD("正在处理更新，请稍候", 3); return }
  const target = currentInstallPath()
  updateInProgress = true
  try {
    const answer = await popup({ title: "CardLink：从链接安装更新", message: "输入可信的 .mnaddon 下载地址。直接安装会替换插件文件，完成后请重启 MarginNote；手动安装会打开保存面板，保存后请自行导入。", type: UIAlertViewStyle.PlainTextInput, buttons: ["直接安装", "手动安装"], canCancel: true, multiLine: true })
    if (answer.buttonIndex !== 0 && answer.buttonIndex !== 1) return
    const url = String(answer.inputContent || "").trim()
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("请输入 HTTP 或 HTTPS 安装包直链")
    const path = await downloadAsset({ tag_name: "direct" }, { browser_download_url: url })
    if (answer.buttonIndex === 0) installDownloadedPackage(path, target)
    else saveDownloadedPackage(path)
  } catch (error) { showHUD(`安装更新失败：${updateFailureMessage(error)}`, 6) }
  finally { updateInProgress = false }
}

const GITHUB_RELEASES_API = `https://api.github.com/repos/${__GITHUB_REPOSITORY__}/releases?per_page=10`
const GITEE_RELEASES_API = "https://gitee.com/api/v5/repos/baidreams/CardLink/releases?per_page=10"
const LAST_CHECK_KEY = "marginnote.extension.mn4-answer-matcher.update.last-check"
const AUTO_CHECK_INTERVAL = 12 * 60 * 60 * 1000

interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  assets?: ReleaseAsset[]
  source?: "github" | "gitee" | "debug"
}

function releaseHeaders(source: "github" | "gitee" | "debug"): Record<string, string> {
  return {
    Accept: source === "github" ? "application/vnd.github+json" : "application/json",
    "User-Agent": "CardLink"
  }
}

function releaseVersion(release: GitHubRelease): string {
  return String(release.tag_name ?? "").trim().replace(/^v/i, "")
}

function installableAsset(release: GitHubRelease): ReleaseAsset | undefined {
  const expected = `cardlink-v${releaseVersion(release)}.mnaddon`.toLowerCase()
  const legacy = `mn4-answer-matcher-v${releaseVersion(release)}.mnaddon`.toLowerCase()
  return release.assets?.find(asset => asset.name?.toLowerCase() === expected) ??
    release.assets?.find(asset => asset.name?.toLowerCase() === legacy) ??
    release.assets?.find(asset => asset.name?.toLowerCase().endsWith(".mnaddon"))
}

function lastCheckTime(): number {
  try {
    return NSUserDefaults.standardUserDefaults().doubleForKey(LAST_CHECK_KEY) || 0
  } catch {
    return 0
  }
}

function rememberCheck(): void {
  try {
    const defaults = NSUserDefaults.standardUserDefaults()
    defaults.setDoubleForKey(Date.now(), LAST_CHECK_KEY)
    defaults.synchronize()
  } catch {
    // Automatic throttling is optional; update checks still work without it.
  }
}

function newestRelease(releases: GitHubRelease[], source: "github" | "gitee" | "debug"): GitHubRelease | undefined {
  const currentUsesPrereleaseChannel = source === "debug" || __APP_VERSION__.includes("-")
  const release = releases
    .filter((item: GitHubRelease) =>
      !item.draft && releaseVersion(item) &&
      (currentUsesPrereleaseChannel || !item.prerelease)
    )
    .sort((a: GitHubRelease, b: GitHubRelease) =>
      compareVersions(releaseVersion(b), releaseVersion(a))
    )[0]
  return release ? { ...release, source } : undefined
}

async function fetchReleases(source: "github" | "gitee"): Promise<GitHubRelease[]> {
  const url = source === "github" ? GITHUB_RELEASES_API : GITEE_RELEASES_API
  const response = await fetch(url, { headers: releaseHeaders(source), timeout: 20 })
  const releases = response.json()
  if (!Array.isArray(releases)) throw new Error(`${source === "github" ? "GitHub" : "Gitee"} Releases 返回格式异常`)
  return releases
}

async function fetchNewestRelease(onGitHubFailure?: () => void): Promise<GitHubRelease | undefined> {
  if (usesDebugUpdateSource()) {
    try {
      const response = await fetch(DEBUG_RELEASES_URL, { headers: { ...releaseHeaders("debug"), "Cache-Control": "no-cache" }, timeout: 20 })
      const releases = response.json()
      if (!Array.isArray(releases)) throw new Error("调试更新清单格式异常")
      const release = newestRelease(releases, "debug")
      if (release && compareVersions(releaseVersion(release), __APP_VERSION__) > 0) {
        const asset = installableAsset(release)
        if (!asset?.browser_download_url?.startsWith("https://2608204.xyz/downloads/debug/")) throw new Error("调试安装包地址不属于网站下载目录")
        return release
      }
    } catch (error) { MN.error(error) }
  }
  try {
    return newestRelease(await fetchReleases("github"), "github")
  } catch (githubError) {
    MN.error(githubError)
    onGitHubFailure?.()
    try {
      return newestRelease(await fetchReleases("gitee"), "gitee")
    } catch (giteeError) {
      throw new Error(`GitHub 与 Gitee 均检查失败：${String(giteeError)}`)
    }
  }
}

async function downloadAsset(release: GitHubRelease, asset: ReleaseAsset): Promise<string> {
  const url = asset.browser_download_url
  const tempPath = MN.app.tempPath
  if (!url || !tempPath) throw new Error("更新包地址或临时目录不可用")
  showHUD("正在下载插件更新…", 3)
  const response = await fetch(url, {
    headers: { ...releaseHeaders(release.source ?? "github"), Accept: "application/octet-stream" },
    timeout: 60
  })
  const fileName = `CardLink-v${releaseVersion(release).replace(/[^a-zA-Z0-9.+-]/g, "_")}.mnaddon`
  const directory = cardLinkTempPath("updates")
  if (!directory || !ensureStorageDirectory(directory)) throw new Error("更新包临时目录不可用")
  const path = `${directory}/${fileName}`
  // 封装层拿不到 HTTP 状态码：404/限流页只有几 KB，用体积下限拦下坏包
  const size = Number(response.data?.length() || 0)
  if (size < 64 * 1024) {
    throw new CardLinkError("updatePackageIncomplete", { sizeKb: Math.round(size / 1024) })
  }
  if (!response.data.writeToFileAtomically(path, true)) {
    throw new Error("更新包下载或写入失败")
  }
  return path
}

async function downloadUpdate(release: GitHubRelease, asset: ReleaseAsset): Promise<string> {
  try {
    return await downloadAsset(release, asset)
  } catch (githubError) {
    if (release.source === "gitee" || release.source === "debug") throw githubError
    MN.error(githubError)
    const version = releaseVersion(release)
    const giteeRelease = (await fetchReleases("gitee"))
      .find(item => releaseVersion(item) === version)
    const giteeAsset = giteeRelease && installableAsset(giteeRelease)
    if (!giteeRelease || !giteeAsset) throw githubError
    showHUD("GitHub 下载失败，正在从 Gitee 下载…", 3)
    return downloadAsset({ ...giteeRelease, source: "gitee" }, giteeAsset)
  }
}

async function downloadAndInstall(release: GitHubRelease, asset: ReleaseAsset, target: string): Promise<void> {
  const path = await downloadUpdate(release, asset)
  installDownloadedPackage(path, target, releaseVersion(release))
}

function saveDownloadedPackage(path: string): void {
  backupBindings()
  showHUD("更新包已下载，请选择保存位置；保存后请自行导入 .mnaddon 文件安装。", 6)
  saveFile(path, "public.data")
}

function installedBaseline(target: string): string {
  try {
    const disk = installedVersion(target)
    return compareVersions(disk, __APP_VERSION__) > 0 ? disk : __APP_VERSION__
  } catch {
    // Manual saving remains available when the host does not expose an install path.
    return __APP_VERSION__
  }
}

export async function checkForUpdates(interactive = true, owner?: any): Promise<void> {
  // 入口捕获来源窗口：await 联网后不能再靠全局 self 找面板，否则场景面板会被当成没有面板。
  const source = owner ?? self
  if (updateInProgress) { if (interactive) showHUD("正在处理更新，请稍候", 3); return }
  const target = currentInstallPath()
  updateInProgress = true
  // The user declined the migration and opted out of this session entirely;
  // neither automatic nor interactive update prompts may interrupt them.
  try {
    if (!interactive && Date.now() - lastCheckTime() < AUTO_CHECK_INTERVAL) return
    if (interactive) showHUD(usesDebugUpdateSource() ? "正在检查调试更新…" : "正在检查 GitHub 更新…", 2)
    const release = await fetchNewestRelease(() => {
      if (interactive) showHUD("GitHub 检查失败，正在检查 Gitee…", 3)
    })
    // 只在成功拿到 Release 列表后才写节流：网络抖动不应让自动检查静默 12 小时。
    rememberCheck()
    if (!release) {
      if (interactive) showHUD("GitHub 上暂时没有可用版本", 3)
      return
    }
    const version = releaseVersion(release)
    const baseline = installedBaseline(target)
    if (compareVersions(version, baseline) <= 0) {
      if (interactive) showHUD(baseline !== __APP_VERSION__
        ? `CardLink v${baseline} 已安装，请完整退出并重启 MarginNote，使更新生效。`
        : `当前已是最新版本 v${__APP_VERSION__}`, 6)
      return
    }
    const asset = installableAsset(release)
    if (!asset) throw new Error(`v${version} Release 中没有 .mnaddon 安装包`)
    const channel = release.prerelease ? "测试版" : "正式版"
    const sourceLabel = release.source === "debug" ? "调试更新" : release.source === "gitee" ? "Gitee 备用源" : "GitHub"
    if (!interactive) {
      // An automatic check must never steal focus with a modal dialog.
      if (automaticInstallationEnabled()) {
        const path = await downloadUpdate(release, asset)
        // The user may disable debug mode or this switch while the download is pending.
        if (automaticInstallationEnabled() && compareVersions(version, installedBaseline(target)) > 0) {
          installDownloadedPackage(path, target, version)
        }
        return
      }
      showHUD(`CardLink 发现${channel} v${version}（${sourceLabel}），可在插件菜单选择「检查插件更新」安装`, 5)
      return
    }
    const choice = await requestUpdateChoice(source, {
      version,
      channel,
      source: sourceLabel,
      currentVersion: __APP_VERSION__,
      notes: updateNotesText(release.body),
      notesMarkdown: updateNotesMarkdown(release.body, release.source)
    })
    if (choice === "direct") await downloadAndInstall(release, asset, target)
    else if (choice === "manual") saveDownloadedPackage(await downloadUpdate(release, asset))
  } catch (error) {
    captureDiagnosticError(error, "更新")
    if (interactive || automaticInstallationEnabled()) showHUD(`检查更新失败：${updateFailureMessage(error)}`, 5)
  } finally { updateInProgress = false }
}

export function scheduleAutomaticUpdateCheck(owner?: any): void {
  // 在调用时捕获来源窗口；定时回调只使用这个来源，不再读全局 self。
  const source = owner ?? self
  void delay(3).then(() => checkForUpdates(false, source))
}
