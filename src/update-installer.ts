import { readJSON } from "marginnote"
import { compareVersions } from "./version"
import { cardLinkCachePath, ensureStorageDirectory } from "./storage-paths"

export const UPDATE_ADDON_ID = "marginnote.extension.mn4-answer-matcher"

export function installedVersion(path: string): string {
  const manifest = readJSON(`${path}/mnaddon.json`) as any
  if (manifest?.addonid !== UPDATE_ADDON_ID) throw new Error("安装目录不是正式 CardLink 插件")
  return String(manifest.version || "")
}

/** Like MN Utils: unzip, move the old directory aside, move the new one in.
 * Keep backups outside the installed directory; a failed replacement restores it.
 * This does not claim or force a host runtime reload.
 */
export function installUpdatePackage(file: string, target: string, expectedVersion?: string): { version: string; backup: string } {
  target = String(target || "").replace(/\/+$/, "")
  if (!target.startsWith("/") || target.split("/").includes("..") || !target.endsWith(`/${UPDATE_ADDON_ID}`)) {
    throw new Error("CardLink 安装目录不可用")
  }
  const current = installedVersion(target)
  const manager: any = NSFileManager.defaultManager()
  const cache = cardLinkCachePath("updates")
  if (!cache || !ensureStorageDirectory(cache)) throw new Error("更新备份目录不可用")
  const transaction = `${cache}/${Date.now()}-${Math.random().toString(36).slice(2)}`
  if (!ensureStorageDirectory(transaction)) throw new Error("更新工作目录不可用")
  const staged = `${transaction}/new`
  const backup = `${transaction}/previous`
  if (!ZipArchive.unzipFileAtPathToDestination(file, staged)) throw new Error("更新包解压失败，原版本未修改")
  const version = installedVersion(staged)
  if (!version || (expectedVersion && version !== expectedVersion) || compareVersions(version, current) <= 0) {
    throw new Error("更新包版本不匹配或不高于已安装版本，原版本未修改")
  }
  for (const name of ["main.js", "AnswerMatcherCore.js", "WebAddon.js", "WebPanelController.js", "web-dist/index.html", "web-dist/app.js"]) {
    if (!manager.fileExistsAtPath(`${staged}/${name}`)) throw new Error(`更新包缺少 ${name}，原版本未修改`)
  }
  if (!manager.moveItemAtPathToPath(target, backup)) throw new Error("旧版本备份失败，未安装更新")
  try {
    if (!manager.moveItemAtPathToPath(staged, target)) throw new Error("新版本目录替换失败")
    if (installedVersion(target) !== version) throw new Error("替换后的版本校验失败")
  } catch (error) {
    try {
      // Move a partial/new installation aside before restoring the old directory.
      if (manager.fileExistsAtPath(target) && !manager.moveItemAtPathToPath(target, `${transaction}/failed`)) throw new Error("无法移开失败目录")
      if (!manager.moveItemAtPathToPath(backup, target)) throw new Error("无法恢复旧目录")
    } catch {
      throw new Error(`安装失败且自动恢复失败；旧版本保留于 ${backup}。请用 MarginNote 内置导入重新安装 CardLink`)
    }
    throw new Error(`安装失败，已恢复旧版本：${String(error)}`)
  }
  return { version, backup }
}
