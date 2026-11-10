import { delay, fetch, MN, popup, saveFile, showHUD, UIAlertViewStyle } from "marginnote"
import { backupBindings } from "./store"
import { CardLinkError } from "./errors"
import { compareVersions } from "./version"
import { describeError } from "./error-messages"
import { captureDiagnosticError } from "./note-navigation"
import { cardLinkTempPath, ensureStorageDirectory } from "./storage-paths"
import { installedVersion, installUpdatePackage } from "./update-installer"
import { loadMatcherSettings, saveMatcherSettings } from "./settings"

import { showUpdateDialog } from "./update-dialog"

export const DEBUG_RELEASES_URL = "https://2608204.xyz/updates/debug/releases.json"

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

export async function checkForUpdates(interactive = true): Promise<void> {
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
    const notes = String(release.body ?? "").trim() || "暂无更新说明"
    const dialog = showUpdateDialog(version, notes)
    let choice
    if (dialog) {
      choice = await dialog
    } else {
      const result = await popup({
        title: `CardLink：发现${channel} v${version}`,
        message: `当前版本：v${__APP_VERSION__}\n来源：${sourceLabel}\n\n${notes.slice(0, 900)}`,
        buttons: ["直接安装", "手动安装"],
        canCancel: true,
        multiLine: true
      })
      choice = result.buttonIndex === 0 ? "direct" : result.buttonIndex === 1 ? "manual" : "later"
    }
    if (choice === "direct") await downloadAndInstall(release, asset, target)
    else if (choice === "manual") saveDownloadedPackage(await downloadUpdate(release, asset))
  } catch (error) {
    captureDiagnosticError(error, "更新")
    if (interactive || automaticInstallationEnabled()) showHUD(`检查更新失败：${updateFailureMessage(error)}`, 5)
  } finally { updateInProgress = false }
}

export function scheduleAutomaticUpdateCheck(): void {
  void delay(3).then(() => checkForUpdates(false))
}
