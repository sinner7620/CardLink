import { MN } from "marginnote"

const CURRENT_DIRECTORY = "CardLink"
const LEGACY_DIRECTORY = "MNAnswerMatcher"
let migratedDocumentRoot = ""

function cleanRoot(value: unknown): string {
  return String(value ?? "").replace(/\/+$/, "")
}

export function ensureStorageDirectory(path: string): boolean {
  try {
    const manager: any = NSFileManager.defaultManager()
    if (manager.fileExistsAtPath(path)) return true
    return manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(path, true, null) !== false
  } catch {
    return false
  }
}

/** 复制确认成功后才删除旧位置；失败时保留旧文件，避免迁移造成数据丢失。 */
export function migrateLegacyFile(source: string, destination: string): boolean {
  try {
    const manager: any = NSFileManager.defaultManager()
    if (!manager.fileExistsAtPath(source)) return manager.fileExistsAtPath(destination)
    if (!manager.fileExistsAtPath(destination)) {
      ensureStorageDirectory(destination.slice(0, destination.lastIndexOf("/")))
      manager.copyItemAtPathToPath(source, destination)
    }
    if (!manager.fileExistsAtPath(destination)) return false
    manager.removeItemAtPath(source)
    return true
  } catch {
    return false
  }
}

function migrateLegacyDocumentDirectory(documentRoot: string, currentRoot: string): void {
  if (!documentRoot || migratedDocumentRoot === documentRoot) return
  migratedDocumentRoot = documentRoot
  try {
    const manager: any = NSFileManager.defaultManager()
    const legacyRoot = `${documentRoot}/${LEGACY_DIRECTORY}`
    if (!manager.fileExistsAtPath(legacyRoot)) return
    if (!manager.fileExistsAtPath(currentRoot)) {
      manager.copyItemAtPathToPath(legacyRoot, currentRoot)
      if (manager.fileExistsAtPath(currentRoot)) manager.removeItemAtPath(legacyRoot)
      return
    }
    for (const entry of Array.from(manager.contentsOfDirectoryAtPath(legacyRoot) || []) as string[]) {
      migrateLegacyFile(`${legacyRoot}/${entry}`, `${currentRoot}/${entry}`)
    }
    if (!(manager.contentsOfDirectoryAtPath(legacyRoot) || []).length) manager.removeItemAtPath(legacyRoot)
  } catch {
    // 旧目录保留，下次启动仍可重试；所有新写入始终使用 CardLink。
  }
}

export function cardLinkDocumentRoot(): string {
  const documentRoot = cleanRoot(MN.app.documentPath)
  if (!documentRoot) return ""
  const currentRoot = `${documentRoot}/${CURRENT_DIRECTORY}`
  migrateLegacyDocumentDirectory(documentRoot, currentRoot)
  return currentRoot
}

export function cardLinkDocumentPath(relative = ""): string {
  const root = cardLinkDocumentRoot()
  return relative ? `${root}/${String(relative).replace(/^\/+/, "")}` : root
}

export function cardLinkCacheRoot(): string {
  const root = cleanRoot(MN.app.cachePath)
  return root ? `${root}/${CURRENT_DIRECTORY}` : ""
}

export function cardLinkCachePath(relative = ""): string {
  const root = cardLinkCacheRoot()
  return relative ? `${root}/${String(relative).replace(/^\/+/, "")}` : root
}

export function cardLinkTempRoot(): string {
  const root = cleanRoot(MN.app.tempPath || MN.app.documentPath)
  const path = root ? `${root}/${CURRENT_DIRECTORY}/temp` : ""
  if (path) ensureStorageDirectory(path)
  return path
}

export function cardLinkTempPath(relative = ""): string {
  const root = cardLinkTempRoot()
  return relative ? `${root}/${String(relative).replace(/^\/+/, "")}` : root
}
